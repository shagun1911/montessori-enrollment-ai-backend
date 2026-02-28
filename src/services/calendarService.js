require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
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

    const integration = await Integration.findOne({
        schoolId,
        connected: true,
        type: { $in: ['google', 'outlook'] },
    }).sort({ type: 1 }).lean();

    if (integration) {
        if (integration.type === 'google') {
            const result = await getGoogleBusySlots(integration, start, end);
            if (result.error) return { busySlots: [], error: result.error };
            busySlots.push(...result.busySlots);
        } else if (integration.type === 'outlook') {
            const result = await getOutlookBusySlots(integration, start, end);
            if (result.error) return { busySlots: [], error: result.error };
            busySlots.push(...result.busySlots);
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

    const dayStart = new Date(Date.UTC(y, m - 1, d));
    const [startH, startM] = (businessHours.start || '09:00').split(':').map(Number);
    const [endH, endM] = (businessHours.end || '17:00').split(':').map(Number);
    const rangeStart = new Date(dayStart);
    rangeStart.setUTCHours(startH || 9, startM || 0, 0, 0);
    const rangeEnd = new Date(dayStart);
    rangeEnd.setUTCHours(endH || 17, endM || 0, 0, 0);

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
    const { title, startDateTime, endDateTime, description } = opts;
    const start = startDateTime instanceof Date ? startDateTime : new Date(startDateTime);
    const end = endDateTime instanceof Date ? endDateTime : new Date(endDateTime);

    if (!title || !start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { success: false, error: 'Invalid title or date range' };
    }

    const integration = await Integration.findOne({
        schoolId,
        connected: true,
        type: { $in: ['google', 'outlook'] },
    }).sort({ type: 1 }).lean(); // prefer google (alphabetically first)

    if (!integration) {
        return { success: false, error: 'No calendar connected. Connect Google or Outlook in Integrations.' };
    }

    if (integration.type === 'google') {
        return createGoogleCalendarEvent(integration, { title, start, end, description });
    }
    if (integration.type === 'outlook') {
        return createOutlookCalendarEvent(integration, { title, start, end, description });
    }
    return { success: false, error: 'Unsupported calendar provider' };
}

async function createGoogleCalendarEvent(integration, { title, start, end, description }) {
    try {
        const oauth2Client = createGoogleOAuthClient();
        const tokens = integration.config?.tokens;
        if (!tokens || !tokens.access_token) {
            return { success: false, error: 'Google calendar not authorized. Reconnect in Integrations.' };
        }
        oauth2Client.setCredentials(tokens);

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const event = {
            summary: title,
            description: description || '',
            start: { dateTime: start.toISOString(), timeZone: 'UTC' },
            end: { dateTime: end.toISOString(), timeZone: 'UTC' },
        };
        const res = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: event,
        });
        const eventId = res.data.id || '';
        return { success: true, eventId, provider: 'google' };
    } catch (err) {
        console.error('[Calendar] Google error:', err.message);
        return { success: false, error: err.message || 'Failed to create Google Calendar event' };
    }
}

async function createOutlookCalendarEvent(integration, { title, start, end, description }) {
    try {
        const accessToken = integration.config?.accessToken;
        if (!accessToken) {
            return { success: false, error: 'Outlook not authorized. Reconnect in Integrations.' };
        }
        const event = {
            subject: title,
            body: { contentType: 'text', content: description || '' },
            start: { dateTime: start.toISOString(), timeZone: 'UTC' },
            end: { dateTime: end.toISOString(), timeZone: 'UTC' },
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
