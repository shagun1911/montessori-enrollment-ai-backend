const mongoose = require('mongoose');

const billingTransactionSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', index: true },
    type: {
        type: String,
        enum: [
            'subscription_payment',
            'subscription_activated',
            'onboarding',
            'topup',
            'refund',
            'adjustment',
            'other',
        ],
        required: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
    paypalEventId: { type: String, default: '' },
    paypalSubscriptionId: { type: String, default: '' },
    paypalOrderId: { type: String, default: '' }, // Checkout Orders v2
    paypalSaleId: { type: String, default: '' },
    planKey: { type: String, default: '' },
    description: { type: String, default: '' },
    rawEventType: { type: String, default: '' },
}, { timestamps: true });

billingTransactionSchema.index({ createdAt: -1 });
billingTransactionSchema.index({ schoolId: 1, createdAt: -1 });
billingTransactionSchema.index({ paypalEventId: 1 });

module.exports = mongoose.model('BillingTransaction', billingTransactionSchema);
