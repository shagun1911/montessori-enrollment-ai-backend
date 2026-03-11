const express = require('express');
const mongoose = require('mongoose');
const School = require('../models/School');
const CallLog = require('../models/CallLog');
const Integration = require('../models/Integration');
const Followup = require('../models/Followup');
const FormQuestion = require('../models/FormQuestion');
const Referral = require('../models/Referral');
const ReferralLink = require('../models/ReferralLink');
const InquirySubmission = require('../models/InquirySubmission');
const TourBooking = require('../models/TourBooking');
const voiceAISchema = require('../models/VoiceAI');
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

        const school = await School.findById(schoolId).select('aiNumber').lean();
        const toursBooked = await TourBooking.countDocuments({ schoolId });

        let calls = [];
        if (school && school.aiNumber) {
            const digits = school.aiNumber.replace(/\D/g, '');
            const normalizedNumber = digits ? `+${digits}` : '';
            const participantId = `sip_${normalizedNumber}`;

            const bennyDb = mongoose.connection.useDb('benny');
            const collection = bennyDb.collection('voiceAI');

            // Get all logs for this school's AI number
            const rawLogs = await collection.find({ participant_id: participantId })
                .sort({ created_at: -1 })
                .toArray();

            // Map to a consistent format
            calls = rawLogs.map(log => ({
                id: log._id.toString(),
                callerPhone: log.participant_id ? log.participant_id.replace('sip_', '') : 'Unknown',
                callerName: 'Parent', // Generic since it's not in voiceAI DB
                duration: log.duration_seconds || 0,
                timestamp: log.created_at || log.timestamp || new Date(),
                recordingUrl: log.recording_url || null,
                callType: 'inquiry'
            }));
        }

        const totalCalls = calls.length;
        const totalDurationSeconds = calls.reduce((acc, c) => acc + (c.duration || 0), 0);
        const callMinutes = Math.floor(totalDurationSeconds / 60);

        // Generate chart data for the last 14 days
        const chartData = [];
        const today = new Date();

        for (let i = 13; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            const dayStart = new Date(date);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);

            const dayCalls = calls.filter(c => {
                const cDate = new Date(c.timestamp);
                return cDate >= dayStart && cDate <= dayEnd;
            });

            chartData.push({
                name: dateStr,
                calls: dayCalls.length
            });
        }

        const recentCalls = calls.slice(0, 10).map(c => ({
            id: c.id,
            callerName: c.callerName,
            callerPhone: c.callerPhone,
            callType: c.callType,
            duration: Math.round(c.duration),
            timestamp: c.timestamp,
            recordingUrl: c.recordingUrl,
        }));

        res.json({
            metrics: [
                { label: 'Total Calls', value: totalCalls },
                { label: 'Tours Booked', value: toursBooked },
                { label: 'Call Minutes', value: callMinutes },
            ],
            chartData,
            recentCalls,
        });
    } catch (err) {
        console.error('School dashboard error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/school/call-logs - Fetch detailed call logs from voiceAI collection in benny DB
router.get('/call-logs', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        const school = await School.findById(schoolId).select('aiNumber').lean();

        if (!school || !school.aiNumber) {
            return res.json([]);
        }

        // Normalize school AI number (digits and leading + only)
        const digits = school.aiNumber.replace(/\D/g, '');
        const normalizedNumber = digits ? `+${digits}` : '';
        const participantId = `sip_${normalizedNumber}`;

        const bennyDb = mongoose.connection.useDb('benny');
        const collection = bennyDb.collection('voiceAI');

        // 1. Find sessions associated with this participant
        const schoolLogs = await collection.find({ participant_id: participantId })
            .project({ session_id: 1 })
            .toArray();

        const sessionIds = [...new Set(schoolLogs.map(l => l.session_id))];

        if (sessionIds.length === 0) {
            return res.json([]);
        }

        // 2. Fetch ALL logs for these sessions to get the complete transcript (all participants)
        const allLogs = await collection.find({ session_id: { $in: sessionIds } })
            .sort({ created_at: -1 })
            .toArray();

        // 3. Group by session to merge transcripts
        const sessionsMap = {};
        allLogs.forEach(log => {
            const sid = log.session_id;
            if (!sessionsMap[sid]) {
                sessionsMap[sid] = {
                    id: log._id.toString(),
                    sessionId: sid,
                    participantId: log.participant_id, // Primary participant
                    transcript: [],
                    summary: log.transcript_summary || '',
                    recordingUrl: log.recording_url,
                    duration: log.duration_seconds || 0,
                    createdAt: log.created_at || log.timestamp
                };
            }

            // Add transcript items
            if (Array.isArray(log.transcript)) {
                log.transcript.forEach(t => {
                    sessionsMap[sid].transcript.push({
                        role: t.role || 'unknown',
                        text: t.content || t.text || t.message || (typeof t === 'string' ? t : ''),
                        timestamp: t.timestamp || log.created_at
                    });
                });
            }

            // Prefer summary if found in any leg
            if (log.transcript_summary && !sessionsMap[sid].summary) {
                sessionsMap[sid].summary = log.transcript_summary;
            }
            // Prefer recording URL if found
            if (log.recording_url && !sessionsMap[sid].recordingUrl) {
                sessionsMap[sid].recordingUrl = log.recording_url;
            }
        });

        const formattedLogs = Object.values(sessionsMap).map(session => {
            // Sort transcript items by timestamp
            session.transcript.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            // Filter out empty messages
            session.transcript = session.transcript.filter(t => t.text);
            return session;
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(formattedLogs);
    } catch (err) {
        console.error('Call logs error:', err);
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
        console.log('[GET /settings] schoolId:', schoolId);

        if (!schoolId) {
            return res.status(400).json({ error: 'No school associated with this account' });
        }

        const school = await School.findById(schoolId).lean();

        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const qaPairs = (school.qaPairs || []).map(p => ({
            question: p.question || '',
            answer: p.answer || ''
        }));

        console.log('[GET /settings] qaPairs count:', qaPairs.length);

        const integrations = await require('../models/Integration').find({ schoolId, connected: true }).lean();
        const googleConnected = integrations.some(i => i.type === 'google');
        const outlookConnected = integrations.some(i => i.type === 'outlook');

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
            qaPairs,
            preferredCalendar: school.preferredCalendar || 'google',
            googleConnected,
            outlookConnected,
        });
    } catch (err) {
        console.error('[GET /settings] Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/school/settings
router.put('/settings', async (req, res) => {
    try {
        const schoolId = req.user.schoolId;
        console.log('[PUT /settings] schoolId:', schoolId);
        console.log('[PUT /settings] body keys:', Object.keys(req.body));
        console.log('[PUT /settings] qaPairs received:', Array.isArray(req.body.qaPairs) ? req.body.qaPairs.length + ' pairs' : 'not an array / missing');

        if (!schoolId) {
            return res.status(400).json({ error: 'No school associated with this account' });
        }

        // Use findById + save() — most reliable for Mongoose subdocument arrays
        const school = await School.findById(schoolId);

        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const {
            aiNumber, routingNumber, escalationNumber, language, script,
            businessHoursStart, businessHoursEnd,
            twilioSid, twilioAuthToken, twilioPhoneNumber,
            smsAutoFollowup, emailAutoFollowup, smsTemplate, emailTemplate,
            qaPairs, preferredCalendar
        } = req.body;

        if (aiNumber !== undefined) school.aiNumber = aiNumber;
        if (routingNumber !== undefined) school.routingNumber = routingNumber;
        if (escalationNumber !== undefined) school.escalationNumber = escalationNumber;
        if (language !== undefined) school.language = language;
        if (script !== undefined) school.script = script;
        if (businessHoursStart !== undefined) school.businessHoursStart = businessHoursStart;
        if (businessHoursEnd !== undefined) school.businessHoursEnd = businessHoursEnd;
        if (twilioSid !== undefined) school.twilioSid = twilioSid;
        if (twilioAuthToken !== undefined) school.twilioAuthToken = twilioAuthToken;
        if (twilioPhoneNumber !== undefined) school.twilioPhoneNumber = twilioPhoneNumber;
        if (smsAutoFollowup !== undefined) school.smsAutoFollowup = smsAutoFollowup;
        if (emailAutoFollowup !== undefined) school.emailAutoFollowup = emailAutoFollowup;
        if (smsTemplate !== undefined) school.smsTemplate = smsTemplate;
        if (emailTemplate !== undefined) school.emailTemplate = emailTemplate;
        if (preferredCalendar !== undefined) school.preferredCalendar = preferredCalendar;

        if (Array.isArray(qaPairs)) {
            // splice-replace: most reliable way to update a Mongoose subdoc array
            school.qaPairs.splice(0, school.qaPairs.length, ...qaPairs.map(p => ({
                question: p.question || '',
                answer: p.answer || ''
            })));
            console.log('[PUT /settings] qaPairs set on document:', school.qaPairs.length);
        }

        await school.save();
        console.log('[PUT /settings] Saved successfully. qaPairs in DB:', school.qaPairs.length);

        res.json({
            message: 'Settings updated successfully',
            qaPairsCount: school.qaPairs.length
        });
    } catch (err) {
        console.error('[PUT /settings] Error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
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

