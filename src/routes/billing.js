const express = require('express');
const School = require('../models/School');
const BillingTransaction = require('../models/BillingTransaction');
const { authMiddleware, schoolOnly } = require('../middleware/auth');
const { listPlansPublic, getPlanDef, resolvePaypalPlanId, paypalPlansConfigured } = require('../config/billingPlans');

function formatPayPalApiError(err) {
    const d = err.response?.data;
    if (!d) return err.message || 'Failed to create subscription';
    if (typeof d === 'string') return d;
    if (d.message) return d.message;
    if (Array.isArray(d.details) && d.details.length) {
        const parts = d.details
            .map((x) => x.description || x.issue || (typeof x === 'string' ? x : ''))
            .filter(Boolean);
        if (parts.length) return parts.join(' ');
    }
    if (d.name && d.message) return `${d.name}: ${d.message}`;
    return err.message || 'Failed to create subscription';
}
const {
    createSubscription,
    createOrder,
    getSubscription,
} = require('../services/paypalService');
const { grantMinutes, recordTransaction } = require('../services/billingService');

const router = express.Router();

/** Public plan catalog (for pricing page) */
router.get('/plans', (req, res) => {
    try {
        res.json({ plans: listPlansPublic() });
    } catch (err) {
        console.error('[billing/plans]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.use(authMiddleware, schoolOnly);

// GET /api/billing/status
router.get('/status', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        if (!schoolId) {
            return res.status(400).json({ error: 'No school associated with this account' });
        }
        const school = await School.findById(schoolId).lean();
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        const plan = school.subscriptionPlanKey ? getPlanDef(school.subscriptionPlanKey) : null;
        const topupUsd = parseFloat(process.env.PAYPAL_TOPUP_USD || '15', 10);
        const topupMinutes = parseInt(process.env.PAYPAL_TOPUP_MINUTES || '50', 10);

        res.json({
            billingMode: school.billingMode || 'none',
            subscriptionPlanKey: school.subscriptionPlanKey || '',
            subscriptionStatus: school.subscriptionStatus || 'none',
            minuteBalance: typeof school.minuteBalance === 'number' ? school.minuteBalance : null,
            foundingPartner: Boolean(school.foundingPartner),
            onboardingFeePaid: Boolean(school.onboardingFeePaid),
            paypalSubscriptionId: school.paypalSubscriptionId || '',
            lastBillingCyclePaymentAt: school.lastBillingCyclePaymentAt || null,
            planDetails: plan
                ? {
                      monthlyUsd: plan.monthlyUsd,
                      onboardingUsd: plan.onboardingUsd,
                      includedMinutesPerMonth: plan.includedMinutesPerMonth,
                  }
                : null,
            topup: {
                usd: topupUsd,
                minutes: topupMinutes,
            },
            paypalPlansConfigured: paypalPlansConfigured({
                foundingPartner: Boolean(school.foundingPartner),
            }),
        });
    } catch (err) {
        console.error('[billing/status]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/billing/subscribe  { planKey: 'starter'|'growth'|'full_enrollment'|'demo', returnUrl, cancelUrl }
router.post('/subscribe', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { planKey, returnUrl, cancelUrl } = req.body || {};
        if (!planKey || !getPlanDef(planKey)) {
            return res.status(400).json({ error: 'Invalid planKey' });
        }
        if (!returnUrl || !cancelUrl) {
            return res.status(400).json({ error: 'returnUrl and cancelUrl are required' });
        }

        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const planId = resolvePaypalPlanId(planKey, { foundingPartner: school.foundingPartner });
        if (!planId) {
            return res.status(503).json({
                error:
                    'PayPal plan is not configured for this tier. Set the matching PAYPAL_PLAN_* env var in the server.',
            });
        }

        const customId = `school:${school._id.toString()};plan:${planKey}`;
        const sub = await createSubscription({
            planId,
            customId,
            returnUrl,
            cancelUrl,
            brandName: process.env.PAYPAL_BRAND_NAME || 'Nora',
        });

        school.subscriptionPlanKey = planKey;
        school.subscriptionStatus = 'approval_pending';
        school.paypalSubscriptionId = sub.id || '';
        await school.save();

        const approve = Array.isArray(sub.links)
            ? sub.links.find((l) => l.rel === 'approve' && l.href)
            : null;

        res.json({
            subscriptionId: sub.id,
            status: sub.status,
            approvalUrl: approve?.href || null,
        });
    } catch (err) {
        console.error('[billing/subscribe]', err.response?.data || err.message);
        const status = err.response?.status;
        const httpStatus = status && status >= 400 && status < 600 ? status : 500;
        res.status(httpStatus).json({
            error: formatPayPalApiError(err),
        });
    }
});

// POST /api/billing/sync-subscription  { subscriptionId } — after return from PayPal (optional; webhook is authoritative)
router.post('/sync-subscription', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { subscriptionId } = req.body || {};
        if (!subscriptionId) {
            return res.status(400).json({ error: 'subscriptionId is required' });
        }

        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const remote = await getSubscription(subscriptionId);
        if (remote.id !== school.paypalSubscriptionId && school.paypalSubscriptionId) {
            return res.status(403).json({ error: 'Subscription does not match this school' });
        }

        school.paypalSubscriptionId = remote.id;
        const st = (remote.status || '').toUpperCase();
        if (st === 'ACTIVE') {
            school.subscriptionStatus = 'active';
            school.billingMode = 'metered';
        }
        await school.save();

        res.json({
            subscriptionId: remote.id,
            status: remote.status,
            subscriptionStatus: school.subscriptionStatus,
        });
    } catch (err) {
        console.error('[billing/sync-subscription]', err.response?.data || err.message);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

// POST /api/billing/onboarding-order { planKey } — one-time onboarding fee (waived for founding partners)
router.post('/onboarding-order', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { planKey } = req.body || {};
        const def = planKey ? getPlanDef(planKey) : null;
        if (!def) {
            return res.status(400).json({ error: 'Invalid planKey' });
        }

        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        if (school.foundingPartner) {
            return res.json({
                skipped: true,
                reason: 'founding_partner',
                message: 'Onboarding fee waived for founding partners.',
            });
        }
        if (school.onboardingFeePaid) {
            return res.json({
                skipped: true,
                reason: 'already_paid',
                message: 'Onboarding fee already recorded as paid.',
            });
        }

        const customId = `school:${school._id.toString()};type:onboarding;plan:${planKey}`;
        const { returnUrl, cancelUrl } = req.body || {};
        const base = (returnUrl && cancelUrl)
            ? { returnUrl, cancelUrl }
            : {
                returnUrl: `${req.protocol}://${req.get('host')}/school/billing?sub=return`,
                cancelUrl: `${req.protocol}://${req.get('host')}/school/billing?sub=cancel`,
            };
        const order = await createOrder({
            amountUsd: def.onboardingUsd,
            currency: 'USD',
            customId,
            description: `Nora onboarding — ${def.tier}`,
            returnUrl: base.returnUrl,
            cancelUrl: base.cancelUrl,
        });

        const approve = Array.isArray(order.links)
            ? order.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve')
            : null;

        res.json({
            orderId: order.id,
            status: order.status,
            approvalUrl: approve?.href || null,
            amountUsd: def.onboardingUsd,
        });
    } catch (err) {
        console.error('[billing/onboarding-order]', err.response?.data || err.message);
        res.status(500).json({
            error: err.response?.data?.message || err.message || 'Failed to create onboarding order',
        });
    }
});

// POST /api/billing/topup-order — create PayPal order for extra minutes (capture on client or separate endpoint)
router.post('/topup-order', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const topupUsd = parseFloat(process.env.PAYPAL_TOPUP_USD || '15', 10);
        const topupMinutes = parseInt(process.env.PAYPAL_TOPUP_MINUTES || '50', 10);

        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        if (school.billingMode !== 'metered' || school.subscriptionStatus !== 'active') {
            return res.status(400).json({
                error: 'Top-up is available for schools with an active metered subscription.',
            });
        }

        const customId = `school:${school._id.toString()};type:topup;minutes:${topupMinutes}`;
        const { returnUrl, cancelUrl } = req.body || {};
        const base = (returnUrl && cancelUrl)
            ? { returnUrl, cancelUrl }
            : {
                returnUrl: `${req.protocol}://${req.get('host')}/school/billing?sub=return`,
                cancelUrl: `${req.protocol}://${req.get('host')}/school/billing?sub=cancel`,
            };
        const order = await createOrder({
            amountUsd: topupUsd,
            currency: 'USD',
            customId,
            description: `Nora top-up: ${topupMinutes} minutes`,
            returnUrl: base.returnUrl,
            cancelUrl: base.cancelUrl,
        });

        const approve = Array.isArray(order.links)
            ? order.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve')
            : null;

        res.json({
            orderId: order.id,
            status: order.status,
            approvalUrl: approve?.href || null,
            topupMinutes,
            amountUsd: topupUsd,
        });
    } catch (err) {
        console.error('[billing/topup-order]', err.response?.data || err.message);
        res.status(500).json({
            error: err.response?.data?.message || err.message || 'Failed to create order',
        });
    }
});

// POST /api/billing/capture-order { orderId } — after PayPal redirects back (Orders API)
router.post('/capture-order', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { orderId } = req.body || {};
        if (!orderId) {
            return res.status(400).json({ error: 'orderId is required' });
        }

        const school = await School.findById(schoolId);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const { captureOrder } = require('../services/paypalService');
        const captured = await captureOrder(orderId);

        const purchaseUnit = captured.purchase_units && captured.purchase_units[0];
        const cap = purchaseUnit?.payments?.captures?.[0];
        const captureId = cap?.id || '';
        const customId = cap?.custom_id || purchaseUnit?.custom_id || '';
        const sid = customId.match(/school:([^;]+)/);
        if (!sid || sid[1] !== school._id.toString()) {
            return res.status(403).json({ error: 'Order does not belong to this school' });
        }

        if (captureId) {
            const dup = await BillingTransaction.findOne({
                paypalSaleId: captureId,
                type: 'topup',
            }).lean();
            if (dup) {
                const refreshed = await School.findById(schoolId).lean();
                return res.json({
                    ok: true,
                    duplicate: true,
                    minuteBalance: refreshed?.minuteBalance ?? null,
                });
            }
        }

        let minutes = parseInt(process.env.PAYPAL_TOPUP_MINUTES || '50', 10);
        const m = customId.match(/minutes:(\d+)/);
        if (m) minutes = parseInt(m[1], 10);

        const amount = cap ? parseFloat(cap.amount.value) : 0;

        await grantMinutes(school._id, minutes, 'topup', { orderId, captureId });
        await recordTransaction({
            schoolId: school._id,
            type: 'topup',
            amount,
            currency: cap?.amount?.currency_code || 'USD',
            status: 'completed',
            paypalOrderId: orderId,
            paypalSaleId: captureId,
            description: `Top-up ${minutes} minutes`,
            rawEventType: 'capture_order',
        });

        const refreshed = await School.findById(schoolId).lean();
        res.json({
            ok: true,
            minutesAdded: minutes,
            minuteBalance: refreshed?.minuteBalance ?? null,
        });
    } catch (err) {
        console.error('[billing/capture-order]', err.response?.data || err.message);
        res.status(500).json({
            error: err.response?.data?.message || err.message || 'Capture failed',
        });
    }
});

module.exports = router;
