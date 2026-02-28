const express = require('express');
const School = require('../models/School');
const CallLog = require('../models/CallLog');
const Integration = require('../models/Integration');
const Followup = require('../models/Followup');
const FormQuestion = require('../models/FormQuestion');
const Referral = require('../models/Referral');
const ReferralLink = require('../models/ReferralLink');
const InquirySubmission = require('../models/InquirySubmission');
const TourBooking = require('../models/TourBooking');
const { authMiddleware, schoolOnly } = require('../middleware/auth');
const { getGoogleAuthUrl, getOutlookAuthUrl } = require('./integrations');

const router = express.Router();

// Apply auth middleware to all school routes
router.use(authMiddleware, schoolOnly);

// GET /api/school/dashboard - School-specific metrics
router.get('/dashboard', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        if (!schoolId) {
            return res.status(400).json({ error: 'No school associated with this user' });
        }

        const totalCalls = await CallLog.countDocuments({ schoolId });
        const inquiryCalls = await CallLog.countDocuments({ schoolId, callType: 'inquiry' });
        const totalFollowups = await Followup.countDocuments({ schoolId });
        const sentFollowups = await Followup.countDocuments({ schoolId, status: 'sent' });
        const formsSent = await FormQuestion.countDocuments({ schoolId });
        const inquirySubmissions = await InquirySubmission.countDocuments({ schoolId });
        const toursBooked = await TourBooking.countDocuments({ schoolId });

        const recentCalls = await CallLog.find({ schoolId })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        res.json({
            metrics: [
                { label: 'Total Calls', value: totalCalls },
                { label: 'Inquiry Calls', value: inquiryCalls },
                { label: 'Tours Booked', value: toursBooked },
                { label: 'Forms Sent', value: formsSent },
                { label: 'Inquiry Forms Submitted', value: inquirySubmissions },
            ],
            recentCalls: recentCalls.map(c => ({
                id: c._id,
                callerName: c.callerName,
                callerPhone: c.callerPhone,
                callType: c.callType,
                duration: c.duration,
                timestamp: c.createdAt,
                recordingUrl: c.recordingUrl || null,
            })),
        });
    } catch (err) {
        console.error('School dashboard error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/integrations - School's integrations
router.get('/integrations', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const integrations = await Integration.find({ schoolId }).lean();

        const formatted = integrations.map(i => ({
            id: i._id.toString(),
            name: i.name,
            type: i.type,
            connected: i.connected,
            connectedAt: i.connectedAt,
        }));

        res.json(formatted);
    } catch (err) {
        console.error('School integrations error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/school/integrations/:type/connect
router.post('/integrations/:type/connect', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { type } = req.params;

        if (!['outlook', 'google'].includes(type)) {
            return res.status(400).json({ error: 'Invalid integration type' });
        }

        let authUrl = null;
        if (type === 'google') {
            authUrl = getGoogleAuthUrl(schoolId);
        } else if (type === 'outlook') {
            authUrl = await getOutlookAuthUrl(schoolId);
        }

        if (!authUrl) {
            return res.status(400).json({
                error: `${type === 'google' ? 'Google' : 'Outlook'} OAuth is not configured. Add the required credentials to the server .env file.`
            });
        }

        res.json({ message: `${type} connection initiated`, authUrl });
    } catch (err) {
        console.error('Connect integration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/school/integrations/:type/disconnect
router.post('/integrations/:type/disconnect', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { type } = req.params;

        await Integration.updateOne(
            { schoolId, type },
            { $set: { connected: false, connectedAt: null }, $unset: { config: 1 } }
        );

        res.json({ message: `${type} disconnected successfully` });
    } catch (err) {
        console.error('Disconnect integration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/settings
router.get('/settings', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const school = await School.findById(schoolId).lean();

        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        res.json({
            id: school._id.toString(),
            name: school.name,
            aiNumber: school.aiNumber || '',
            routingNumber: school.routingNumber || '',
            escalationNumber: school.escalationNumber || '',
            language: school.language || 'en',
            script: school.script || '',
            businessHoursStart: school.businessHoursStart || '09:00',
            businessHoursEnd: school.businessHoursEnd || '17:00',
            twilioSid: school.twilioSid || '',
            twilioAuthToken: school.twilioAuthToken || '',
            twilioPhoneNumber: school.twilioPhoneNumber || '',
            smsAutoFollowup: school.smsAutoFollowup || false,
            emailAutoFollowup: school.emailAutoFollowup || false,
            smsTemplate: school.smsTemplate || 'Thank you for your interest in our school! Please complete our inquiry form here: {form_link}',
            emailTemplate: school.emailTemplate || 'Dear {parent_name},\n\nThank you for contacting us regarding enrollment at {school_name}.\n\nPlease find the inquiry form at: {form_link}\n\nWarm regards,\n{school_name}',
        });
    } catch (err) {
        console.error('School settings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/school/settings
router.put('/settings', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const {
            aiNumber, routingNumber, escalationNumber, language, script,
            businessHoursStart, businessHoursEnd,
            twilioSid, twilioAuthToken, twilioPhoneNumber,
            smsAutoFollowup, emailAutoFollowup, smsTemplate, emailTemplate
        } = req.body;

        const update = {};
        if (aiNumber !== undefined) update.aiNumber = aiNumber;
        if (routingNumber !== undefined) update.routingNumber = routingNumber;
        if (escalationNumber !== undefined) update.escalationNumber = escalationNumber;
        if (language !== undefined) update.language = language;
        if (script !== undefined) update.script = script;
        if (businessHoursStart !== undefined) update.businessHoursStart = businessHoursStart;
        if (businessHoursEnd !== undefined) update.businessHoursEnd = businessHoursEnd;
        if (twilioSid !== undefined) update.twilioSid = twilioSid;
        if (twilioAuthToken !== undefined) update.twilioAuthToken = twilioAuthToken;
        if (twilioPhoneNumber !== undefined) update.twilioPhoneNumber = twilioPhoneNumber;
        if (smsAutoFollowup !== undefined) update.smsAutoFollowup = smsAutoFollowup;
        if (emailAutoFollowup !== undefined) update.emailAutoFollowup = emailAutoFollowup;
        if (smsTemplate !== undefined) update.smsTemplate = smsTemplate;
        if (emailTemplate !== undefined) update.emailTemplate = emailTemplate;


        await School.findByIdAndUpdate(schoolId, update);

        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        console.error('Update settings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/inquiry-submissions - Form submissions from public inquiry form
router.get('/inquiry-submissions', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        if (!schoolId) {
            return res.status(400).json({ error: 'No school associated with this user' });
        }

        const submissions = await InquirySubmission.find({ schoolId })
            .sort({ submittedAt: -1 })
            .limit(50)
            .lean();

        res.json(submissions.map(s => ({
            id: s._id.toString(),
            parentName: s.parentName,
            email: s.email,
            phone: s.phone,
            answers: s.answers || [],
            submittedAt: s.submittedAt,
        })));
    } catch (err) {
        console.error('Inquiry submissions error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/tour-bookings
router.get('/tour-bookings', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const bookings = await TourBooking.find({ schoolId })
            .sort({ scheduledAt: -1 })
            .limit(50)
            .lean();

        res.json(bookings.map(b => ({
            id: b._id.toString(),
            parentName: b.parentName,
            phone: b.phone,
            email: b.email,
            childAge: b.childAge,
            reason: b.reason,
            scheduledAt: b.scheduledAt,
            calendarProvider: b.calendarProvider || null,
        })));
    } catch (err) {
        console.error('Tour bookings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/followups
router.get('/followups', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const followups = await Followup.find({ schoolId })
            .sort({ createdAt: -1 })
            .lean();

        const formatted = followups.map(f => ({
            id: f._id.toString(),
            leadName: f.leadName,
            type: f.type,
            status: f.status,
            message: f.message,
            recipient: f.recipient,
            timestamp: f.createdAt,
        }));

        res.json(formatted);
    } catch (err) {
        console.error('School followups error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/forms
router.get('/forms', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const questions = await FormQuestion.find({ schoolId })
            .sort({ position: 1 })
            .lean();

        const formatted = questions.map(q => ({
            id: q._id.toString(),
            question: q.question,
            required: q.required,
        }));

        res.json(formatted);
    } catch (err) {
        console.error('School forms error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/school/forms - Save form questions (bulk replace)
router.post('/forms', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const { questions } = req.body;

        if (!Array.isArray(questions)) {
            return res.status(400).json({ error: 'Questions must be an array' });
        }

        // Delete old questions
        await FormQuestion.deleteMany({ schoolId });

        // Insert new ones
        if (questions.length > 0) {
            await FormQuestion.insertMany(
                questions.map((q, index) => ({
                    schoolId,
                    question: q.question,
                    required: q.required || false,
                    position: index,
                }))
            );
        }

        res.json({ message: 'Form questions saved successfully' });
    } catch (err) {
        console.error('Save forms error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/referrals
router.get('/referrals', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;

        const referralLink = await ReferralLink.findOne({ schoolId }).lean();

        const referrals = await Referral.find({ referrerSchoolId: schoolId })
            .sort({ date: -1 })
            .lean();

        const formatted = referrals.map(r => ({
            id: r._id.toString(),
            referrerSchool: r.referrerSchoolName,
            newSchool: r.newSchoolName,
            date: r.date,
            status: r.status,
        }));

        res.json({
            referralCode: referralLink ? referralLink.code : null,
            referralLink: referralLink ? `${process.env.FORM_BASE_URL || 'http://localhost:5173'}/refer/${referralLink.code}` : null,
            referrals: formatted,
        });
    } catch (err) {
        console.error('School referrals error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/school/referrals/generate
router.post('/referrals/generate', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const school = await School.findById(schoolId);

        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const code = `ref-${school.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`;

        await ReferralLink.findOneAndUpdate(
            { schoolId },
            { code },
            { upsert: true, new: true }
        );

        res.json({
            referralCode: code,
            referralLink: `${process.env.FORM_BASE_URL || 'http://localhost:5173'}/refer/${code}`,
        });
    } catch (err) {
        console.error('Generate referral error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/school/test-call - Simulate an incoming inquiry call for testing
router.post('/test-call', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const testLead = {
            parentName: 'Test Parent',
            phone: '+1 (555) 000-0000',
            email: 'test@example.com',
            childAge: '3 years',
            reason: 'Enrollment inquiry for next fall',
        };

        // 1. Create call log
        const callLog = await CallLog.create({
            schoolId,
            callerName: testLead.parentName,
            callerPhone: testLead.phone,
            callType: 'inquiry',
            duration: 125,
            recordingUrl: 'https://example.com/recording.mp3',
        });

        // 2. Trigger automation
        const { triggerAutomation } = require('../services/automation');
        await triggerAutomation(schoolId, testLead);

        res.json({ message: 'Test call simulated successfully', callLogId: callLog._id });
    } catch (err) {
        console.error('Test call error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Normalize phone to E.164 (strip spaces/dashes, ensure + prefix)
function normalizePhone(value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim().replace(/[\s\-\(\)]/g, '');
    if (!trimmed) return null;
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

// POST /api/school/test-followup - Send test SMS and/or email to YOUR number/email (no call)
// Body: { phone?: string, email?: string } - at least one required. Uses your templates + form link.
router.post('/test-followup', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        let { phone, email } = req.body || {};

        if (!phone && !email) {
            return res.status(400).json({
                error: 'Provide at least one of phone or email to receive the test follow-up.',
            });
        }

        phone = phone ? normalizePhone(phone) : undefined;
        email = email ? String(email).trim() || undefined : undefined;

        const testLead = {
            parentName: 'Test Parent',
            phone,
            email,
            childAge: '3 years',
            reason: 'Test follow-up',
        };

        const { triggerAutomation } = require('../services/automation');
        const result = await triggerAutomation(schoolId, testLead);

        const sent = [];
        if (result.smsSent) sent.push('SMS');
        if (result.emailSent) sent.push('Email');

        const errors = [];
        if (phone && !result.smsSent && result.smsError) errors.push(`SMS: ${result.smsError}`);
        if (email && !result.emailSent && result.emailError) errors.push(`Email: ${result.emailError}`);

        if (sent.length > 0) {
            return res.json({
                message: `Test sent (${sent.join(' + ')}). Check your ${sent.includes('SMS') ? 'phone' : ''}${sent.length === 2 ? ' and ' : ''}${sent.includes('Email') ? 'inbox' : ''}.`,
                sent,
                ...(errors.length > 0 && { partialErrors: errors }),
            });
        }

        const errorMessage = errors.length > 0 ? errors.join(' ') : 'Send failed. Enable follow-ups in Settings and save Twilio/SMTP.';
        return res.status(400).json({ error: errorMessage });
    } catch (err) {
        console.error('Test followup error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

module.exports = router;

