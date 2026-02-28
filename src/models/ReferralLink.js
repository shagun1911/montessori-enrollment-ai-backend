const mongoose = require('mongoose');

const referralLinkSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, unique: true },
    code: { type: String, unique: true, required: true },
}, { timestamps: true });

module.exports = mongoose.model('ReferralLink', referralLinkSchema);
