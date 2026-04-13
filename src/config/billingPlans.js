/**
 * Nora subscription plans — aligned with product pricing (monthly + onboarding + included minutes).
 * PayPal Billing Plan IDs are set via env (create plans in PayPal Dashboard or API with matching amounts).
 */

const PLAN_ORDER = ['starter', 'growth', 'full_enrollment'];

const PLAN_DEFS = {
    starter: {
        key: 'starter',
        tier: 'Starter',
        tagline: 'Stop missing calls',
        monthlyUsd: 195,
        onboardingUsd: 299,
        includedMinutesPerMonth: 250,
        /** Env var holding PayPal plan id P-xxx */
        paypalPlanEnvKey: 'PAYPAL_PLAN_STARTER',
        paypalPlanFoundingEnvKey: 'PAYPAL_PLAN_STARTER_FOUNDING',
    },
    growth: {
        key: 'growth',
        tier: 'Growth',
        tagline: 'Capture and schedule',
        monthlyUsd: 245,
        onboardingUsd: 399,
        includedMinutesPerMonth: 500,
        paypalPlanEnvKey: 'PAYPAL_PLAN_GROWTH',
        paypalPlanFoundingEnvKey: 'PAYPAL_PLAN_GROWTH_FOUNDING',
    },
    full_enrollment: {
        key: 'full_enrollment',
        tier: 'Full enrollment system',
        tagline: 'Full enrollment system',
        monthlyUsd: 290,
        onboardingUsd: 599,
        includedMinutesPerMonth: 750,
        paypalPlanEnvKey: 'PAYPAL_PLAN_FULL_ENROLLMENT',
        paypalPlanFoundingEnvKey: 'PAYPAL_PLAN_FULL_ENROLLMENT_FOUNDING',
    },
};

function getPlanDef(planKey) {
    return PLAN_DEFS[planKey] || null;
}

function listPlansPublic() {
    return PLAN_ORDER.map((k) => {
        const p = PLAN_DEFS[k];
        return {
            key: p.key,
            tier: p.tier,
            tagline: p.tagline,
            monthlyUsd: p.monthlyUsd,
            onboardingUsd: p.onboardingUsd,
            includedMinutesPerMonth: p.includedMinutesPerMonth,
        };
    });
}

/**
 * Resolve PayPal Plan ID from env. Prefer founding plan when school is founding partner and env is set.
 */
function resolvePaypalPlanId(planKey, { foundingPartner } = {}) {
    const def = getPlanDef(planKey);
    if (!def) return null;
    const foundingId = process.env[def.paypalPlanFoundingEnvKey];
    const standardId = process.env[def.paypalPlanEnvKey];
    if (foundingPartner && foundingId && String(foundingId).trim()) {
        return String(foundingId).trim();
    }
    return standardId && String(standardId).trim() ? String(standardId).trim() : null;
}

/** Which tiers have a usable PayPal Billing Plan ID in env (for UI / health checks). */
function paypalPlansConfigured({ foundingPartner } = {}) {
    const out = {};
    for (const k of PLAN_ORDER) {
        out[k] = Boolean(resolvePaypalPlanId(k, { foundingPartner }));
    }
    return out;
}

module.exports = {
    PLAN_ORDER,
    PLAN_DEFS,
    getPlanDef,
    listPlansPublic,
    resolvePaypalPlanId,
    paypalPlansConfigured,
};
