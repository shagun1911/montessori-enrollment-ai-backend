const express = require('express');
const mongoose = require('mongoose');
const CallLog = require('../models/CallLog');
const School = require('../models/School');
const TourBooking = require('../models/TourBooking');
const { triggerAutomation } = require('../services/automation');
const { createCalendarEvent, getFreeSlots, isSlotAvailable } = require('../services/calendarService');

const router = express.Router();

// Normalize phone for lookup (digits only, optional + prefix)
function normalizePhone(s) {
    if (!s || typeof s !== 'string') return '';
    const digits = s.replace(/\D/g, '');
    return digits ? `+${digits}` : '';
}

/**
 * AGENT INTEGRATION
 * Your AI voice agent (Vapi, Bland, Retell, or custom) should:
 *
 * 1. When a call starts: GET /api/voice/agent-config?to=+15551234567
 *    (use the Twilio "To" number). Response: schoolId, script, businessHours, formLink, etc.
 *
 * 2. During the call: Use script to answer; collect parentName, phone, email, childAge, reason.
 *    If they want a tour, collect preferred date/time and send it in call-end as leadData.tourScheduledAt (ISO).
 *
 * 3. When call ends: POST /api/voice/call-end with body:
 *    { schoolId, callerName, callerPhone, callType: 'inquiry'|'general', duration, recordingUrl?, leadData?: { parentName, phone, email, childAge, reason, tourScheduledAt? } }
 *    We will: create call log, send SMS/email with form link, and if tourScheduledAt present, book tour in Google/Outlook.
 */

// GET /api/voice/agent-config - No auth. Agent calls with the number that was dialed (Twilio "To").
// Query: to=+15551234567  OR  schoolId=507f1f77bcf86cd799439011
router.get('/agent-config', async (req, res) => {
    try {
        const { to, schoolId: schoolIdParam } = req.query;
        let school = null;

        if (schoolIdParam && mongoose.Types.ObjectId.isValid(schoolIdParam)) {
            school = await School.findById(schoolIdParam).select('name script businessHoursStart businessHoursEnd language routingNumber escalationNumber').lean();
        }
        if (!school && to) {
            const normalizedTo = normalizePhone(to);
            if (normalizedTo) {
                const all = await School.find({}).select('name script businessHoursStart businessHoursEnd language routingNumber escalationNumber twilioPhoneNumber aiNumber').lean();
                school = all.find(s => normalizePhone(s.twilioPhoneNumber) === normalizedTo || normalizePhone(s.aiNumber) === normalizedTo) || null;
            }
        }

        if (!school) {
            return res.status(404).json({ error: 'School not found for this number. Set twilioPhoneNumber or aiNumber in Settings.' });
        }

        const formLink = process.env.FORM_BASE_URL
            ? `${process.env.FORM_BASE_URL}/inquiry/${school._id}`
            : `https://enrollmentai.com/inquiry/${school._id}`;

        res.json({
            schoolId: school._id.toString(),
            schoolName: school.name,
            script: school.script || 'Welcome to our school. How can I help you today?',
            businessHoursStart: school.businessHoursStart || '09:00',
            businessHoursEnd: school.businessHoursEnd || '17:00',
            formLink,
            language: school.language || 'EN',
            routingNumber: school.routingNumber || '',
            escalationNumber: school.escalationNumber || '',
        });
    } catch (err) {
        console.error('Agent config error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/voice/availability - No auth. Agent calls to get free 15-min slots for a day (respects blocked times, no overlaps).
// Query: schoolId=xxx&date=YYYY-MM-DD
router.get('/availability', async (req, res) => {
    try {
        const { schoolId, date } = req.query;
        if (!schoolId || !date) {
            return res.status(400).json({ error: 'schoolId and date (YYYY-MM-DD) are required' });
        }
        const school = await School.findById(schoolId).select('businessHoursStart businessHoursEnd').lean();
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }
        const { freeSlots, error } = await getFreeSlots(schoolId, date, {
            start: school.businessHoursStart || '09:00',
            end: school.businessHoursEnd || '17:00',
        });
        if (error) {
            return res.status(400).json({ error });
        }
        res.json({ date, freeSlots });
    } catch (err) {
        console.error('Availability error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── TWILIO INCOMING CALL WEBHOOK (For testing connections) ──
// POST /api/voice/incoming
router.post('/incoming', (req, res) => {
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna-Neural">
        Hello from your Montessori Enrollment AI Platform! The system is active and connected to Twilio.
    </Say>
    <Pause length="2"/>
    <Say voice="Polly.Joanna-Neural">
        Goodbye!
    </Say>
</Response>`);
});

// POST /api/voice/call-end - Called by AI agent when call completes
router.post('/call-end', async (req, res) => {
    try {
        const { schoolId, callerName, callerPhone, callType, duration, recordingUrl, leadData } = req.body;

        if (!schoolId) {
            return res.status(400).json({ error: 'schoolId is required' });
        }

        const callLog = await CallLog.create({
            schoolId,
            callerName: callerName || 'Unknown',
            callerPhone: callerPhone || '',
            callType: callType || 'inquiry',
            duration: duration || 0,
            recordingUrl: recordingUrl || '',
        });

        const parentName = leadData?.parentName || callerName;
        const phone = leadData?.phone || callerPhone;
        const email = leadData?.email;
        const childAge = leadData?.childAge;
        const reason = leadData?.reason;
        const tourScheduledAt = leadData?.tourScheduledAt; // ISO date string if parent booked a tour

        if (callType === 'inquiry' && leadData) {
            await triggerAutomation(schoolId, {
                parentName,
                phone,
                email,
                childAge,
                reason,
            });
        }

        let tourBooking = null;
        let tourError = null;
        if (tourScheduledAt) {
            const start = new Date(tourScheduledAt);
            if (!isNaN(start.getTime())) {
                const end = new Date(start.getTime() + 15 * 60 * 1000); // 15-min block (per Phase 1 spec)
                const { available, error: slotError } = await isSlotAvailable(schoolId, start, end);
                if (!available) {
                    tourError = slotError || 'That time is no longer available or overlaps an existing event.';
                } else {
                    const school = await School.findById(schoolId).select('name').lean();
                    const title = `School Tour – ${parentName || 'Parent'}`;
                    const calResult = await createCalendarEvent(schoolId, {
                        title,
                        startDateTime: start,
                        endDateTime: end,
                        description: `Tour for ${parentName || 'Parent'}. Phone: ${phone || 'N/A'}. Email: ${email || 'N/A'}. Reason: ${reason || 'Inquiry'}.`,
                    });
                    tourBooking = await TourBooking.create({
                        schoolId,
                        parentName,
                        phone: phone || '',
                        email: email || '',
                        childAge: childAge || '',
                        reason: reason || '',
                        scheduledAt: start,
                        calendarEventId: calResult.success ? calResult.eventId : '',
                        calendarProvider: calResult.success ? calResult.provider : '',
                        callLogId: callLog._id,
                    });
                }
            }
        }

        res.json({
            success: true,
            callLogId: callLog._id,
            recordingUrl: callLog.recordingUrl || undefined,
            tourBooked: !!tourBooking,
            tourBookingId: tourBooking?._id?.toString(),
            tourError: tourError || undefined,
        });
    } catch (err) {
        console.error('Voice call-end error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
