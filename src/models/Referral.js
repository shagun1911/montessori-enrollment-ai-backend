const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    referrerSchoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    referrerSchoolName: { type: String, required: true },
    referredSchoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    newSchoolName: { type: String, required: true },
    referralCode: { type: String },
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'active', 'converted'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('Referral', referralSchema);
