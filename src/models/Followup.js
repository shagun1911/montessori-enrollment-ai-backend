const mongoose = require('mongoose');

const followupSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    leadName: { type: String, required: true },
    type: { type: String, enum: ['SMS', 'Email'], required: true },
    status: { type: String, enum: ['sent', 'pending', 'failed'], default: 'pending' },
    message: { type: String, default: '' },
    recipient: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Followup', followupSchema);
