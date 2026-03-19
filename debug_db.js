const mongoose = require('mongoose');
require('dotenv').config();

async function debugData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/childcare-enrollment-ai');
        console.log('Connected to MongoDB');

        const schoolId = '69a2a7bf84844ca0d53116d6';
        const date = '2026-03-19';
        const start = new Date(`${date}T00:00:00.000Z`);
        const end = new Date(`${date}T23:59:59.999Z`);

        const Integration = require('./src/models/Integration');
        const TourBooking = require('./src/models/TourBooking');

        console.log('\n--- INTEGRATIONS ---');
        const integrations = await Integration.find({ schoolId }).lean();
        console.log(JSON.stringify(integrations, null, 2));

        console.log('\n--- TOUR BOOKINGS (for 2026-03-19) ---');
        const bookings = await TourBooking.find({
            schoolId,
            scheduledAt: { $gte: start, $lt: end }
        }).sort({ scheduledAt: 1 }).lean();
        bookings.forEach(b => {
            console.log(`${b.scheduledAt.toISOString()} | Prov: ${b.calendarProvider || 'none'} | ID: ${b.calendarEventId ? 'SET' : 'MISSING'} | Email: ${b.calendarEmail || 'MISSING'}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugData();
