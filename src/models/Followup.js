const mongoose = require('mongoose');

const followupSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    leadName: { type: String, required: true },
    type: { type: String, enum: ['SMS', 'Email'], required: true },
    status: { type: String, enum: ['sent', 'pending', 'failed'], default: 'pending' },
    message: { type: String, default: '' },
    recipient: { type: String, default: '' },
    // Addressed = manager/front desk closed the loop for this follow-up.
    addressed: { type: Boolean, default: false },
    addressedNote: { type: String, default: '' },
    addressedAt: { type: Date, default: null },
    addressedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Followup', followupSchema);
