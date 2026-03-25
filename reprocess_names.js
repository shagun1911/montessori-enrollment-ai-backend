const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

const ElevenLabsWebhook = require('./src/models/ElevenLabsWebhook');
const { processTranscript } = require('./src/services/openaiService');

async function reprocessNames() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        // Find all transcription webhooks (recent first)
        const webhooks = await ElevenLabsWebhook.find({
            type: 'post_call_transcription'
        }).sort({ received_at: -1 });

        console.log(`Found ${webhooks.length} translation webhooks to process.`);

        let updatedCount = 0;
        let alreadyNamedCount = 0;
        let errorCount = 0;

        for (const webhook of webhooks) {
            // Check if the webhook already has a name extracted (other than null or "Parent")
            const currentName = webhook.tour_booking_extracted?.name;
            if (currentName && currentName !== 'Parent') {
                alreadyNamedCount++;
                continue;
            }

            if (!webhook.transcript || !Array.isArray(webhook.transcript) || webhook.transcript.length === 0) {
                continue;
            }

            console.log(`Reprocessing webhook for conversation ${webhook.conversation_id}...`);
            try {
                const aiResult = await processTranscript(webhook.transcript);
                
                // Only update if a name was actually found
                if (aiResult.tour_booking_extracted?.name) {
                    await ElevenLabsWebhook.findByIdAndUpdate(webhook._id, {
                        tour_booking_extracted: aiResult.tour_booking_extracted,
                        summary: aiResult.summary,
                        tour_booking_detected: aiResult.tour_booking_detected,
                        tour_booking_date: aiResult.tour_booking_date,
                        ai_processed: true
                    });
                    updatedCount++;
                    console.log(`  ✅ Extracted name: ${aiResult.tour_booking_extracted.name}`);
                } else {
                    console.log('  ❌ No name found in transcript.');
                }
            } catch (err) {
                console.error(`  ❌ Failed to process webhook ${webhook._id}:`, err.message);
                errorCount++;
            }
        }

        console.log('\n--- Reprocess Complete ---');
        console.log(`Total: ${webhooks.length}`);
        console.log(`Updated: ${updatedCount}`);
        console.log(`Already has name: ${alreadyNamedCount}`);
        console.log(`Errors: ${errorCount}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

reprocessNames().catch(console.error);
