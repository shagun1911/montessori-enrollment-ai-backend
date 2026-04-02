const mongoose = require('mongoose');

const aiNumberRequestSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    schoolName: { type: String, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'completed'], 
        default: 'pending' 
    },
    requestedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAiNumber: { type: String, default: '' },
    notes: { type: String, default: '' },
    adminNotes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('AiNumberRequest', aiNumberRequestSchema);
