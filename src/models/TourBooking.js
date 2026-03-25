const mongoose = require('mongoose');

const tourBookingSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    parentName: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    childName: { type: String, default: '' },
    childAge: { type: String, default: '' },
    reason: { type: String, default: '' },
    scheduledAt: { type: Date, required: true },
    calendarEventId: { type: String, default: '' },
    calendarProvider: { type: String, enum: ['google', 'outlook', ''], default: '' },
    calendarEmail: { type: String, default: '' },
    callLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'CallLog', default: null },
    reminderSent: { type: Boolean, default: false },
    followupSent: { type: Boolean, default: false },
    // AI Insights (Cached)
    aiProcessed: { type: Boolean, default: false },
    questionsAsked: [{ type: String, default: '' }],
    highlights: { type: String, default: '' },
}, { timestamps: true });

tourBookingSchema.index({ schoolId: 1, scheduledAt: -1 });

module.exports = mongoose.model('TourBooking', tourBookingSchema);
