const mongoose = require('mongoose');

const minuteLedgerSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    /** Negative = usage, positive = grant */
    deltaMinutes: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: {
        type: String,
        enum: [
            'call_usage',
            'monthly_allocation',
            'topup',
            'admin_adjustment',
            'subscription_start',
            'other',
        ],
        default: 'other',
    },
    webhookId: { type: mongoose.Schema.Types.ObjectId, ref: 'ElevenLabsWebhook', default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

minuteLedgerSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('MinuteLedger', minuteLedgerSchema);
