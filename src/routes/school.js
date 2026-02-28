const express = require('express');
const School = require('../models/School');
const CallLog = require('../models/CallLog');
const Integration = require('../models/Integration');
const Followup = require('../models/Followup');
const FormQuestion = require('../models/FormQuestion');
const Referral = require('../models/Referral');
const ReferralLink = require('../models/ReferralLink');
const { authMiddleware, schoolOnly } = require('../middleware/auth');

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

        // Recent calls
        const recentCalls = await CallLog.find({ schoolId })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        res.json({
            metrics: [
                { label: 'Total Calls', value: totalCalls, change: 12 },
                { label: 'Inquiry Calls', value: inquiryCalls, change: 8 },
                { label: 'Tours Booked', value: Math.floor(inquiryCalls * 0.26), change: 15 },
                { label: 'Forms Sent', value: formsSent, change: -3 },
            ],
            recentCalls: recentCalls.map(c => ({
                id: c._id,
                callerName: c.callerName,
                callerPhone: c.callerPhone,
                callType: c.callType,
                duration: c.duration,
                timestamp: c.createdAt,
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

        await Integration.updateOne(
            { schoolId, type },
            { connected: true, connectedAt: new Date() }
        );

        res.json({ message: `${type} connected successfully` });
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
            { connected: false, connectedAt: null }
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
            aiNumber: school.aiNumber,
            routingNumber: school.routingNumber,
            escalationNumber: school.escalationNumber || '',
            language: school.language,
            script: school.script,
            businessHoursStart: school.businessHoursStart,
            businessHoursEnd: school.businessHoursEnd,
            twilioSid: school.twilioSid || '',
            twilioAuthToken: school.twilioAuthToken || '',
            twilioPhoneNumber: school.twilioPhoneNumber || '',
            smsAutoFollowup: school.smsAutoFollowup || false,
            emailAutoFollowup: school.emailAutoFollowup || false,
            smsTemplate: school.smsTemplate || '',
            emailTemplate: school.emailTemplate || '',
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
            referralLink: referralLink ? `https://enrollmentai.com/refer/${referralLink.code}` : null,
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
            referralLink: `https://enrollmentai.com/refer/${code}`,
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

module.exports = router;

