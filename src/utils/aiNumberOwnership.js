/**
 * When an AI phone number is reassigned to a new school, data keyed only by phone
 * (e.g. VoiceAI logs) must not appear for the new tenant. We stamp the time of the
 * last change to the canonical aiNumber string so readers can filter historical rows.
 */

function normalizeAiDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

/**
 * Returns fields to merge into a School update when aiNumber changes.
 * @param {string} previousRaw - prior aiNumber (before update)
 * @param {string} nextRaw - new aiNumber value
 */
function aiNumberAssignmentPatch(previousRaw, nextRaw) {
    const prev = normalizeAiDigits(previousRaw);
    const next = normalizeAiDigits(nextRaw);
    if (next && next !== prev) {
        return { aiNumberAssignedAt: new Date() };
    }
    if (!next && prev) {
        return { aiNumberAssignedAt: null };
    }
    return {};
}

module.exports = {
    normalizeAiDigits,
    aiNumberAssignmentPatch,
};
