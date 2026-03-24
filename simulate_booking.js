const mongoose = require('mongoose');
require('dotenv').config();

const { isSlotAvailable, createCalendarEvent } = require('./src/services/calendarService');

async function simulate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const schoolId = '69bec5085d8158818111b005';
        const start = new Date('2026-03-26T20:00:00.000Z');
        const end = new Date(start.getTime() + 15 * 60 * 1000);

        console.log(`\n--- Simulating isSlotAvailable for ${start.toISOString()} ---`);
        const availResult = await isSlotAvailable(schoolId, start, end);
        console.log('Available:', availResult.available);
        if (availResult.error) console.log('Error:', availResult.error);

        console.log(`\n--- Simulating createCalendarEvent for ${start.toISOString()} ---`);
        const calResult = await createCalendarEvent(schoolId, {
            title: 'DEBUG: School Tour - Haru Karnani',
            startDateTime: start,
            endDateTime: end,
            description: 'Simulation for troubleshooting',
            parentEmail: 'HaruKarnani@gmail.com'
        });
        console.log('Success:', calResult.success);
        if (calResult.error) console.log('Error:', calResult.error);
        if (calResult.eventId) console.log('Event ID:', calResult.eventId);
        if (calResult.provider) console.log('Provider:', calResult.provider);

    } catch (err) {
        console.error('Simulation failed:', err);
    } finally {
        await mongoose.disconnect();
    }
}

simulate();
