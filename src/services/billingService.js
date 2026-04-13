const School = require('../models/School');
const MinuteLedger = require('../models/MinuteLedger');
const BillingTransaction = require('../models/BillingTransaction');
const { getCallDurationSeconds } = require('../utils/webhookHelpers');
const { getPlanDef } = require('../config/billingPlans');

async function grantMinutes(schoolId, minutes, reason, meta = {}) {
    if (!minutes || minutes <= 0) return null;
    const school = await School.findById(schoolId);
    if (!school) return null;
    const prev = typeof school.minuteBalance === 'number' ? school.minuteBalance : 0;
    const next = prev + minutes;
    school.minuteBalance = next;
    school.billingMode = 'metered';
    await school.save();
    await MinuteLedger.create({
        schoolId,
        deltaMinutes: minutes,
        balanceAfter: next,
        reason,
        meta,
    });
    return { balanceAfter: next };
}

/**
 * Deduct minutes after an ElevenLabs call (canonical usage).
 */
async function deductCallMinutes(webhookDoc) {
    const schoolId = webhookDoc.schoolId;
    if (!schoolId) return null;

    const existing = await MinuteLedger.findOne({ webhookId: webhookDoc._id, reason: 'call_usage' }).lean();
    if (existing) return existing;

    const school = await School.findById(schoolId);
    if (!school || school.billingMode !== 'metered') return null;

    const secs = getCallDurationSeconds(webhookDoc);
    const minutes = Math.max(0, Math.ceil(secs / 60));
    if (minutes === 0) return null;

    const prev = typeof school.minuteBalance === 'number' ? school.minuteBalance : 0;
    const next = prev - minutes;
    school.minuteBalance = next;
    await school.save();

    await MinuteLedger.create({
        schoolId,
        deltaMinutes: -minutes,
        balanceAfter: next,
        reason: 'call_usage',
        webhookId: webhookDoc._id,
        meta: { seconds: secs },
    });

    return { deducted: minutes, balanceAfter: next };
}

async function applyMonthlyPlanAllocation(schoolId) {
    const school = await School.findById(schoolId);
    if (!school || !school.subscriptionPlanKey) return null;
    const def = getPlanDef(school.subscriptionPlanKey);
    if (!def) return null;
    return grantMinutes(schoolId, def.includedMinutesPerMonth, 'monthly_allocation', {
        planKey: school.subscriptionPlanKey,
    });
}

async function recordTransaction({
    schoolId,
    type,
    amount,
    currency,
    status,
    paypalEventId,
    paypalSubscriptionId,
    paypalOrderId,
    paypalSaleId,
    planKey,
    description,
    rawEventType,
}) {
    if (paypalEventId) {
        const dup = await BillingTransaction.findOne({ paypalEventId }).lean();
        if (dup) return dup;
    }
    return BillingTransaction.create({
        schoolId,
        type,
        amount,
        currency: currency || 'USD',
        status: status || 'completed',
        paypalEventId: paypalEventId || '',
        paypalSubscriptionId: paypalSubscriptionId || '',
        paypalOrderId: paypalOrderId || '',
        paypalSaleId: paypalSaleId || '',
        planKey: planKey || '',
        description: description || '',
        rawEventType: rawEventType || '',
    });
}

module.exports = {
    grantMinutes,
    deductCallMinutes,
    applyMonthlyPlanAllocation,
    recordTransaction,
};
