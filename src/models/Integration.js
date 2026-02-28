const mongoose = require('mongoose');

const integrationSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    type: { type: String, enum: ['outlook', 'google'], required: true },
    name: { type: String, required: true },
    connected: { type: Boolean, default: false },
    connectedAt: { type: Date, default: null },
    config: { type: Object, default: {} },
}, { timestamps: true });

integrationSchema.index({ schoolId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Integration', integrationSchema);
