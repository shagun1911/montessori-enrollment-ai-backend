const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    callerName: { type: String, default: '' },
    callerPhone: { type: String, default: '' },
    callType: { type: String, enum: ['inquiry', 'general', 'routing'], default: 'inquiry' },
    duration: { type: Number, default: 0 },
    recordingUrl: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('CallLog', callLogSchema);
