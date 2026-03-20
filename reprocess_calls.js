const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const ElevenLabsWebhook = require('./src/models/ElevenLabsWebhook');
const CallLog = require('./src/models/CallLog');

async function reprocessWebhooks() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');
        
        // Find all webhooks for Sunshine Montessori
        const schoolId = new mongoose.Types.ObjectId('69a2a7bf84844ca0d53116d6');
        const webhooks = await ElevenLabsWebhook.find({ schoolId: schoolId, type: 'post_call_transcription' }).sort({ received_at: 1 });
        
        console.log(`Found ${webhooks.length} webhooks for Sunshine Montessori`);
        
        let createdCount = 0;
        let skippedCount = 0;

        for (const webhook of webhooks) {
            // Check if CallLog already exists for this conversation
            const exists = await CallLog.findOne({ conversation_id: webhook.conversation_id });
            
            if (exists) {
                skippedCount++;
                continue;
            }

            // Create CallLog
            await CallLog.create({
                schoolId: schoolId,
                conversation_id: webhook.conversation_id,
                agent_id: webhook.agent_id,
                agent_name: webhook.agent_name,
                from_phone_number: webhook.metadata?.phone_call?.from_number || 'unknown',
                to_phone_number: webhook.metadata?.phone_call?.to_number || '+13527903711',
                callType: 'inquiry', // Most are inquiries
                transcript: webhook.transcript || [],
                summary: webhook.summary || 'Summary not available',
                duration: webhook.metadata?.phone_call?.call_duration_secs || 0,
                createdAt: webhook.received_at || new Date()
            });
            
            createdCount++;
        }
        
        console.log(`Final results: Created ${createdCount} CallLogs, Skipped ${skippedCount} existing ones.`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

reprocessWebhooks();
