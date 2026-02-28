const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    referrerSchoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    referrerSchoolName: { type: String, required: true },
    newSchoolName: { type: String, required: true },
    referralCode: { type: String },
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'active', 'converted'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('Referral', referralSchema);
