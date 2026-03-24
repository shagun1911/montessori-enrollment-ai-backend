const mongoose = require('mongoose');
require('dotenv').config();

const ElevenLabsWebhook = require('./src/models/ElevenLabsWebhook');
const TourBooking = require('./src/models/TourBooking');

async function debug() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const schoolId = '69bec5085d8158818111b005';

        console.log('\n--- TourBooking for Haru ---');
        const haruBooking = await TourBooking.findOne({ parentName: 'Haru Karnani', schoolId }).lean();
        console.log(JSON.stringify(haruBooking, null, 2));

        console.log('\n--- Searching for matching Webhook ---');
        // Find webhooks around the time Haru's booking was created (2026-03-23T20:54:17)
        const webhooks = await ElevenLabsWebhook.find({
            schoolId,
            received_at: {
                $gte: new Date('2026-03-23T20:50:00Z'),
                $lte: new Date('2026-03-23T21:00:00Z')
            }
        }).select('type conversation_id summary tour_booking_detected tour_booking_date metadata').lean();

        console.log(`Found ${webhooks.length} webhooks in range.`);
        webhooks.forEach(w => {
            console.log(`\nID: ${w._id}`);
            console.log(`Type: ${w.type}`);
            console.log(`Conversation ID: ${w.conversation_id}`);
            console.log(`Tour Detected: ${w.tour_booking_detected}`);
            console.log(`Tour Date: ${w.tour_booking_date}`);
            console.log(`Summary: ${w.summary}`);
            if (w.metadata?.ai_processing_error) {
                console.log(`AI Error: ${w.metadata.ai_processing_error}`);
            }
        });

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

debug();
