require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const mongoose = require('mongoose');
const Integration = require('../models/Integration');
const TourBooking = require('../models/TourBooking');

const googleConfig = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
};

function createGoogleOAuthClient() {
    return new google.auth.OAuth2(
        googleConfig.clientId,
        googleConfig.clientSecret,
        googleConfig.redirectUri
    );
}

/**
 * Get busy time slots from the school's calendar (Google or Outlook) and from TourBooking.
 * @param {string} schoolId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<{ busySlots: Array<{ start: Date, end: Date }>, error?: string }>}
 */
async function getBusySlots(schoolId, startDate, endDate) {
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    const busySlots = [];

    const School = require('../models/School');
    const school = await School.findById(schoolId).select('preferredCalendar').lean();
    const preference = school?.preferredCalendar || 'google';

    const integrationCriteria = {
        schoolId,
        connected: true,
        type: { $in: ['google', 'outlook'] },
    };

    if (preference === 'google') integrationCriteria.type = 'google';
    else if (preference === 'outlook') integrationCriteria.type = 'outlook';
    else if (preference === 'none') return { busySlots };

    const integrations = await Integration.find(integrationCriteria).lean();

    for (const integration of integrations) {
        if (integration.type === 'google') {
            const result = await getGoogleBusySlots(integration, start, end);
            if (result.error) console.error('[Calendar] Error fetching Google busy slots:', result.error);
            else busySlots.push(...result.busySlots);
        } else if (integration.type === 'outlook') {
            const result = await getOutlookBusySlots(integration, start, end);
            if (result.error) console.error('[Calendar] Error fetching Outlook busy slots:', result.error);
            else busySlots.push(...result.busySlots);
        }
    }

    const bookings = await TourBooking.find({
        schoolId,
        scheduledAt: { $gte: start, $lt: end },
    }).select('scheduledAt').lean();

    const blockMinutes = 15;
    bookings.forEach(b => {
        const slotStart = new Date(b.scheduledAt);
        const slotEnd = new Date(slotStart.getTime() + blockMinutes * 60 * 1000);
        busySlots.push({ start: slotStart, end: slotEnd });
    });

    return { busySlots };
}

async function getGoogleBusySlots(integration, start, end) {
    try {
        const oauth2Client = createGoogleOAuthClient();
        const tokens = integration.config?.tokens;
        if (!tokens?.access_token) return { busySlots: [], error: 'Google not authorized' };

        oauth2Client.setCredentials(tokens);

        // Listen for refreshed tokens
        oauth2Client.on('tokens', async (newTokens) => {
            console.log('[Calendar] Google tokens refreshed for school:', integration.schoolId);
            await Integration.updateOne(
                { _id: integration._id },
                { $set: { 'config.tokens': { ...tokens, ...newTokens } } }
            );
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        const busySlots = (res.data.items || []).map(ev => {
            const s = ev.start?.dateTime || ev.start?.date;
            const e = ev.end?.dateTime || ev.end?.date;
            return { start: new Date(s), end: new Date(e) };
        });
        return { busySlots };
    } catch (err) {
        console.error('[Calendar] Google busy slots error:', err.message);
        return { busySlots: [], error: err.message };
    }
}

async function getOutlookBusySlots(integration, start, end) {
    try {
        const accessToken = integration.config?.accessToken;
        if (!accessToken) return { busySlots: [], error: 'Outlook not authorized' };
        const res = await axios.get(
            'https://graph.microsoft.com/v1.0/me/calendarView',
            {
                params: {
                    startDateTime: start.toISOString(),
                    endDateTime: end.toISOString(),
                },
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );
        const busySlots = (res.data.value || []).map(ev => ({
            start: new Date(ev.start?.dateTime || ev.start),
            end: new Date(ev.end?.dateTime || ev.end),
        }));
        return { busySlots };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error('[Calendar] Outlook busy slots error:', msg);
        return { busySlots: [], error: msg };
    }
}

/**
 * Check if a time slot is available (no overlap with calendar events or existing tour bookings).
 * @param {string} schoolId
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<{ available: boolean, error?: string }>}
 */
async function isSlotAvailable(schoolId, start, end) {
    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return { available: false, error: 'Invalid date range' };
    }

    // Check if weekend (0 = Sunday, 6 = Saturday) based on local time or school timezone
    const day = startDate.getDay();
    if (day === 0 || day === 6) {
        return { available: false, error: 'Tour bookings are not available on weekends.' };
    }

    const { busySlots, error } = await getBusySlots(schoolId, startDate, endDate);
    if (error) return { available: false, error };

    const overlaps = busySlots.some(slot => {
        return startDate < slot.end && endDate > slot.start;
    });
    return { available: !overlaps };
}

/**
 * Get free slots for a given day (business hours, 15-min blocks, excluding busy slots).
 * @param {string} schoolId
 * @param {string} dateStr - YYYY-MM-DD
 * @param {object} businessHours - { start: '09:00', end: '17:00' }
 * @returns {Promise<{ freeSlots: Array<{ start: string, end: string }>, error?: string }>}
 */
async function getFreeSlots(schoolId, dateStr, businessHours = { start: '09:00', end: '17:00' }) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return { freeSlots: [], error: 'Invalid date. Use YYYY-MM-DD.' };

    // Determine school timezone for range calculations
    const School = require('../models/School');
    const school = await School.findById(schoolId).select('businessHoursStart businessHoursEnd timezone').lean();
    const tz = school?.timezone || 'America/Chicago';

    // Check if weekend in the school's local timezone
    // Use Intl to get the local day of week for the school
    const localDateForWeekend = new Date(`${dateStr}T12:00:00Z`);
    const localDayOfWeek = parseInt(
        new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(localDateForWeekend)
            === 'Sun' ? '0' :
        new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(localDateForWeekend)
            === 'Sat' ? '6' : '1'
    );
    const weekdayStr = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(localDateForWeekend);
    if (weekdayStr === 'Sun' || weekdayStr === 'Sat') {
        return { freeSlots: [], error: 'Weekend bookings are not allowed.' };
    }

    const [startH, startM] = (school?.businessHoursStart || '09:00').split(':').map(Number);
    const [endH, endM] = (school?.businessHoursEnd || '17:00').split(':').map(Number);

    // Build the business hour range in the school's local timezone.
    // We construct a local time string and parse it properly so UTC offset is respected.
    const toUtcFromLocal = (dateStr, hours, minutes, tz) => {
        // Use Intl to figure out the UTC offset at that specific date/time in the school's tz
        // Strategy: create an ambiguous ISO without tz, then find how JS interprets it vs local
        const localStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        // Parse as UTC, then determine offset for the school's timezone at that moment
        const guessUtc = new Date(localStr + 'Z');
        // Get what 'hour' the school timezone sees at the guessed UTC time
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: 'numeric',
            minute: 'numeric',
            hour12: false
        });
        const parts = formatter.formatToParts(guessUtc);
        const actualH = parseInt(parts.find(p => p.type === 'hour').value);
        const actualM = parseInt(parts.find(p => p.type === 'minute').value);
        // Calculate difference and apply correction
        const diffMs = ((hours - actualH) * 60 + (minutes - actualM)) * 60 * 1000;
        return new Date(guessUtc.getTime() + diffMs);
    };

    const rangeStart = toUtcFromLocal(dateStr, startH || 9, startM || 0, tz);
    const rangeEnd = toUtcFromLocal(dateStr, endH || 17, endM || 0, tz);

    const { busySlots, error } = await getBusySlots(schoolId, rangeStart, rangeEnd);
    if (error) return { freeSlots: [], error };

    const freeSlots = [];
    const blockMs = 15 * 60 * 1000;
    let slotStart = new Date(rangeStart);
    while (slotStart.getTime() + blockMs <= rangeEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + blockMs);
        const overlaps = busySlots.some(b => slotStart < b.end && slotEnd > b.start);
        if (!overlaps) {
            freeSlots.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
            });
        }
        slotStart = slotEnd;
    }
    return { freeSlots };
}

/**
 * Create a calendar event for a school (Google or Outlook).
 * @param {string} schoolId - MongoDB ObjectId string
 * @param {object} opts - { title, startDateTime (Date or ISO string), endDateTime (Date or ISO string), description }
 * @returns {Promise<{ success: boolean, eventId?: string, provider?: 'google'|'outlook', error?: string }>}
 */
async function createCalendarEvent(schoolId, opts) {
    const { title, startDateTime, endDateTime, description, parentEmail } = opts;
    const start = startDateTime instanceof Date ? startDateTime : new Date(startDateTime);
    const end = endDateTime instanceof Date ? endDateTime : new Date(endDateTime);

    if (!title || !start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { success: false, error: 'Invalid title or date range' };
    }

    const School = require('../models/School');
    const school = await School.findById(schoolId).select('preferredCalendar').lean();
    const preference = school?.preferredCalendar || 'google';

    console.log(`[Calendar] Creating event for school: ${schoolId}`);
    console.log(`[Calendar] School preference: ${preference}`);

    if (preference === 'none') {
        console.log('[Calendar] Calendar sync disabled for this school');
        return { success: true, message: 'Calendar sync disabled' };
    }

    // Convert schoolId to ObjectId if it's a string
    const schoolObjectId = mongoose.Types.ObjectId.isValid(schoolId) 
        ? (schoolId instanceof mongoose.Types.ObjectId ? schoolId : new mongoose.Types.ObjectId(schoolId))
        : schoolId;

    const integrationCriteria = {
        schoolId: schoolObjectId,
        connected: true,
        type: { $in: ['google', 'outlook'] }
    };

    // Set the type filter based on preference
    if (preference === 'google') {
        integrationCriteria.type = 'google';
    } else if (preference === 'outlook') {
        integrationCriteria.type = 'outlook';
    } else if (preference === 'both') {
        // Keep both types in the $in array
        integrationCriteria.type = { $in: ['google', 'outlook'] };
    }
    // If preference is 'none', we already returned earlier

    console.log(`[Calendar] Searching for integrations with criteria:`, JSON.stringify({
        schoolId: schoolId.toString(),
        connected: true,
        type: integrationCriteria.type
    }));

    const integrations = await Integration.find(integrationCriteria).lean();
    console.log(`[Calendar] Found ${integrations.length} integration(s) matching criteria`);

    if (integrations.length > 0) {
        integrations.forEach((int, idx) => {
            console.log(`[Calendar] Integration ${idx + 1}: type=${int.type}, connected=${int.connected}, hasTokens=${!!int.config?.tokens?.access_token || !!int.config?.accessToken}`);
        });
    }

    if (!integrations || integrations.length === 0) {
        // Check if there are any integrations at all for this school
        const allIntegrations = await Integration.find({ schoolId: schoolObjectId }).lean();
        console.warn(`[Calendar] No connected integration found for preference: ${preference}`);
        console.warn(`[Calendar] Total integrations for school: ${allIntegrations.length}`);
        if (allIntegrations.length > 0) {
            allIntegrations.forEach((int, idx) => {
                console.warn(`[Calendar] Integration ${idx + 1}: type=${int.type}, connected=${int.connected}`);
            });
        }
        return { success: false, error: 'Calendar provider not connected or mismatched preference.' };
    }

    let overallSuccess = false;
    let mainProvider = null;
    let mainEventId = null;
    let errors = [];

    for (const integration of integrations) {
        let result;
        if (integration.type === 'google') {
            result = await createGoogleCalendarEvent(integration, { title, start, end, description, parentEmail });
        } else if (integration.type === 'outlook') {
            result = await createOutlookCalendarEvent(integration, { title, start, end, description, parentEmail });
        }

        if (result && result.success) {
            overallSuccess = true;
            if (!mainEventId) {
                mainEventId = result.eventId;
                mainProvider = integration.type;
            }
        } else if (result && result.error) {
            errors.push(`${integration.type}: ${result.error}`);
        }
    }

    if (overallSuccess) {
        return { success: true, eventId: mainEventId, provider: mainProvider };
    } else {
        return { success: false, error: errors.join(', ') || 'Failed to create calendar event' };
    }
}

async function createGoogleCalendarEvent(integration, { title, start, end, description, parentEmail }) {
    try {
        const oauth2Client = createGoogleOAuthClient();
        const tokens = integration.config?.tokens;
        if (!tokens || !tokens.access_token) {
            return { success: false, error: 'Google calendar not authorized. Reconnect in Integrations.' };
        }
        oauth2Client.setCredentials(tokens);

        // Listen for refreshed tokens
        oauth2Client.on('tokens', async (newTokens) => {
            console.log('[Calendar] Google tokens refreshed (during event creation) for school:', integration.schoolId);
            await Integration.updateOne(
                { _id: integration._id },
                { $set: { 'config.tokens': { ...tokens, ...newTokens } } }
            );
        });

        // Fetch school timezone for this event
        const School = require('../models/School');
        const school = await School.findById(integration.schoolId).select('timezone').lean();
        const tz = school?.timezone || 'America/Chicago';

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const event = {
            summary: title,
            description: description || '',
            start: { dateTime: start.toISOString(), timeZone: tz },
            end: { dateTime: end.toISOString(), timeZone: tz },
            attendees: parentEmail ? [{ email: parentEmail }] : [],
        };
        const insertOptions = {
            calendarId: 'primary',
            requestBody: event,
        };
        if (parentEmail) {
            insertOptions.sendUpdates = 'all'; // Send calendar invite email to attendees
        }
        const res = await calendar.events.insert(insertOptions);
        const eventId = res.data.id || '';
        console.log('[Calendar] Google event created:', eventId, parentEmail ? `(invite sent to ${parentEmail})` : '');
        return { success: true, eventId, provider: 'google' };
    } catch (err) {
        console.error('[Calendar] Google creation error:', err.message);
        return { success: false, error: err.message || 'Failed to create Google Calendar event' };
    }
}

async function createOutlookCalendarEvent(integration, { title, start, end, description, parentEmail }) {
    try {
        const accessToken = integration.config?.accessToken;
        if (!accessToken) {
            return { success: false, error: 'Outlook not authorized. Reconnect in Integrations.' };
        }

        // Fetch school timezone
        const School = require('../models/School');
        const school = await School.findById(integration.schoolId).select('timezone').lean();
        const tz = school?.timezone || 'America/Chicago';

        const fmtDate = (d) => d.toISOString().replace('Z', '').replace(/\.000$/, '');
        const event = {
            subject: title,
            body: { contentType: 'text', content: description || '' },
            start: { dateTime: fmtDate(start), timeZone: tz },
            end: { dateTime: fmtDate(end), timeZone: tz },
            attendees: parentEmail ? [
                { emailAddress: { address: parentEmail }, type: 'required' }
            ] : []
        };
        const res = await axios.post(
            'https://graph.microsoft.com/v1.0/me/events',
            event,
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
        const eventId = res.data.id || '';
        return { success: true, eventId, provider: 'outlook' };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error('[Calendar] Outlook error:', msg);
        return { success: false, error: msg || 'Failed to create Outlook event' };
    }
}

module.exports = { createCalendarEvent, getBusySlots, getFreeSlots, isSlotAvailable };
