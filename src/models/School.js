const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
    name: { type: String, required: true },
    aiNumber: { type: String, default: '' },
    routingNumber: { type: String, default: '' },
    escalationNumber: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    language: { type: String, enum: ['EN', 'ES'], default: 'EN' },
    script: { type: String, default: 'Welcome to our school. How can I help you today?' },
    businessHoursStart: { type: String, default: '09:00' },
    businessHoursEnd: { type: String, default: '17:00' },
    // Twilio
    twilioSid: { type: String, default: '' },
    twilioAuthToken: { type: String, default: '' },
    twilioPhoneNumber: { type: String, default: '' },
    // Automation
    smsAutoFollowup: { type: Boolean, default: false },
    emailAutoFollowup: { type: Boolean, default: false },
    smsTemplate: { type: String, default: 'Thank you for your interest in our school! Please complete our inquiry form here: {form_link}' },
    emailTemplate: { type: String, default: 'Dear {parent_name},\n\nThank you for contacting us regarding enrollment.\n\nPlease find the inquiry form at: {form_link}\n\nWarm regards,\n{school_name}' },
}, { timestamps: true });

module.exports = mongoose.model('School', schoolSchema);
