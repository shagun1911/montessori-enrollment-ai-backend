/**
 * Tiered per-minute top-up pricing (USD).
 * First 100 minutes → 16¢/min, next 500 → 14¢/min, then 12¢/min.
 */

const SEGMENTS = [
    { maxMinutes: 100, centsPerMinute: 16, description: 'First 100 minutes' },
    { maxMinutes: 500, centsPerMinute: 14, description: 'Next 500 minutes' },
    { maxMinutes: null, centsPerMinute: 12, description: 'Beyond 600 minutes' },
];

function getLimits() {
    const raw = parseInt(process.env.PAYPAL_TOPUP_MAX_MINUTES || '5000', 10);
    const maxMinutes = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 50000) : 5000;
    return { minMinutes: 1, maxMinutes };
}

/**
 * @param {number} minutes - whole minutes
 * @returns {number} total USD, 2 decimal places
 */
function computeTopupUsd(minutes) {
    const n = Math.floor(Number(minutes));
    if (!Number.isFinite(n) || n < 1) return 0;
    let remaining = n;
    let totalCents = 0;
    for (const seg of SEGMENTS) {
        const cap = seg.maxMinutes == null ? remaining : Math.min(remaining, seg.maxMinutes);
        totalCents += cap * seg.centsPerMinute;
        remaining -= cap;
        if (remaining <= 0) break;
    }
    return Math.round(totalCents) / 100;
}

function getTopupPricingForClient() {
    const { minMinutes, maxMinutes } = getLimits();
    return {
        minMinutes,
        maxMinutes,
        segments: SEGMENTS.map((s) => ({
            maxMinutes: s.maxMinutes,
            centsPerMinute: s.centsPerMinute,
            description: s.description,
        })),
    };
}

/**
 * @param {number} minutes
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateTopupMinutes(minutes) {
    const { minMinutes, maxMinutes } = getLimits();
    const n = Math.floor(Number(minutes));
    if (!Number.isFinite(n)) {
        return { ok: false, error: 'Minutes must be a number.' };
    }
    if (n < minMinutes || n > maxMinutes) {
        return { ok: false, error: `Minutes must be between ${minMinutes} and ${maxMinutes}.` };
    }
    return { ok: true };
}

module.exports = {
    SEGMENTS,
    getLimits,
    computeTopupUsd,
    getTopupPricingForClient,
    validateTopupMinutes,
};
