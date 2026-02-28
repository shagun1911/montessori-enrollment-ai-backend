const mongoose = require('mongoose');

const tourBookingSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    parentName: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    childAge: { type: String, default: '' },
    reason: { type: String, default: '' },
    scheduledAt: { type: Date, required: true },
    calendarEventId: { type: String, default: '' },
    calendarProvider: { type: String, enum: ['google', 'outlook', ''], default: '' },
    callLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'CallLog', default: null },
}, { timestamps: true });

tourBookingSchema.index({ schoolId: 1, scheduledAt: -1 });

module.exports = mongoose.model('TourBooking', tourBookingSchema);
