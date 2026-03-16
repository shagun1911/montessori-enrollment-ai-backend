const cron = require('node-cron');
const TourBooking = require('../models/TourBooking');
const School = require('../models/School');
const Followup = require('../models/Followup');
const { sendTourConfirmation } = require('./automation');

/**
 * Initialize background cron jobs for reminders and follow-ups
 */
function initReminderService() {
    console.log('[Reminder Service] Initializing cron jobs...');

    // Run every hour to check for reminders and follow-ups
    cron.schedule('0 * * * *', async () => {
        console.log('[Reminder Service] Running hourly check...');
        await sendUpcomingReminders();
        await sendPostTourFollowups();
    });
}

/**
 * Send SMS reminders for tours happening tomorrow (24h before)
 */
async function sendUpcomingReminders() {
    try {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const soon = new Date(tomorrow.getTime() + 65 * 60 * 1000); // 1h buffer

        // Find bookings scheduled between 24 and 25 hours from now
        const bookings = await TourBooking.find({
            scheduledAt: { $gte: tomorrow, $lt: soon },
            reminderSent: false
        });

        console.log(`[Reminder Service] Found ${bookings.length} upcoming tours for reminders.`);

        for (const booking of bookings) {
            const school = await School.findById(booking.schoolId);
            if (!school) continue;

            const { sendTourConfirmation } = require('./automation'); // Avoid circular if any
            // Reuse the confirmation logic which includes SMS template
            // We can customize it if needed, but for now we'll trigger a simplified reminder
            await sendReminderSms(school, booking);

            booking.reminderSent = true;
            await booking.save();
        }
    } catch (err) {
        console.error('[Reminder Service] Error in upcoming reminders:', err);
    }
}

/**
 * Send SMS/Email follow-up "Thank you" 24 hours AFTER the tour
 */
async function sendPostTourFollowups() {
    try {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const older = new Date(yesterday.getTime() - 65 * 60 * 1000);

        // Find bookings that happened exactly 24h ago
        const bookings = await TourBooking.find({
            scheduledAt: { $gte: older, $lt: yesterday },
            followupSent: false
        });

        console.log(`[Reminder Service] Found ${bookings.length} completed tours for follow-ups.`);

        for (const booking of bookings) {
            const school = await School.findById(booking.schoolId);
            if (!school) continue;

            await sendFollowupMessage(school, booking);

            booking.followupSent = true;
            await booking.save();
        }
    } catch (err) {
        console.error('[Reminder Service] Error in post-tour follow-ups:', err);
    }
}

async function sendReminderSms(school, booking) {
    if (!booking.phone || !school.twilioSid || !school.twilioPhoneNumber) return;

    const { getTwilioClient } = require('./automation');
    const client = getTwilioClient(school.twilioSid, school.twilioAuthToken);
    if (!client) return;

    const tourDateStr = new Date(booking.scheduledAt).toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: school.timezone || 'UTC'
    });

    const body = (school.tourReminderSmsTemplate || 'Hi {parent_name}, reminder for your tour at {school_name} tomorrow at {tour_date}!')
        .replace(/\{parent_name\}/g, booking.parentName || 'Parent')
        .replace(/\{school_name\}/g, school.name)
        .replace(/\{tour_date\}/g, tourDateStr);

    try {
        await client.messages.create({
            body,
            from: school.twilioPhoneNumber,
            to: booking.phone
        });
        
        await Followup.create({
            schoolId: school._id,
            leadName: booking.parentName,
            type: 'SMS',
            status: 'sent',
            message: `[Reminder] ${body}`,
            recipient: booking.phone
        });
    } catch (err) {
        console.error('[Reminder Service] SMS failed:', err.message);
    }
}

async function sendFollowupMessage(school, booking) {
    // Send a "Thanks for visiting" text
    if (!booking.phone || !school.twilioSid || !school.twilioPhoneNumber) return;

    const { getTwilioClient } = require('./automation');
    const client = getTwilioClient(school.twilioSid, school.twilioAuthToken);
    if (!client) return;

    const body = `Hi ${booking.parentName || 'Parent'}, thank you for visiting ${school.name} yesterday! We hope you enjoyed the tour. Let us know if you have any further questions.`;

    try {
        await client.messages.create({
            body,
            from: school.twilioPhoneNumber,
            to: booking.phone
        });
        
        await Followup.create({
            schoolId: school._id,
            leadName: booking.parentName,
            type: 'SMS',
            status: 'sent',
            message: `[Follow-up] ${body}`,
            recipient: booking.phone
        });
    } catch (err) {
        console.error('[Reminder Service] Post-tour follow-up failed:', err.message);
    }
}

module.exports = { initReminderService };
