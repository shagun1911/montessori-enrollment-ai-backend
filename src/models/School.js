const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
    name: { type: String, required: true },
    aiNumber: { type: String, default: '' },
    routingNumber: { type: String, default: '' },
    escalationNumber: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    language: { type: String, enum: ['EN', 'ES'], default: 'EN' },
    script: { type: String, default: 'Welcome to our school. How can I help you today?' },
    systemPrompt: { type: String, default: '' }, // System prompt for agent configuration
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
    // AI Knowledge Base
    qaPairs: [{
        question: { type: String, default: '' },
        answer: { type: String, default: '' }
    }],
    knowledgeBaseDocumentId: { type: String, default: '' },
    preferredCalendar: { type: String, enum: ['google', 'outlook', 'both', 'none'], default: 'google' },
    address: { type: String, default: '' },
    timezone: { type: String, default: 'America/Chicago' }, // School's local timezone
    adminEmail: { type: String, default: '' }, // Admin email for webhook notifications
    elevenlabsAgentId: { type: String, default: '' }, // ElevenLabs Agent ID for inbound call identification
    // Tour confirmation templates
    tourConfirmationEmailTemplate: { type: String, default: 'Dear {parent_name},\n\nYour tour at {school_name} has been scheduled for {tour_date}.\n\nLocation: {school_address}\n\nWe look forward to seeing you!\n\nWarm regards,\n{school_name}' },
    tourReminderSmsTemplate: { type: String, default: 'Hi {parent_name}, this is a reminder for your tour at {school_name} tomorrow, {tour_date}. See you then!' }
}, { timestamps: true });

module.exports = mongoose.model('School', schoolSchema);
