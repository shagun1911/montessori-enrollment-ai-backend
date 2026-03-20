const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const ElevenLabsWebhook = require('./src/models/ElevenLabsWebhook');

async function debugWebhooks() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');
        
        const total = await ElevenLabsWebhook.countDocuments();
        console.log('Total ElevenLabsWebhook entries in DB:', total);
        
        const unprocessed = await ElevenLabsWebhook.countDocuments({ ai_processed: false });
        console.log('Unprocessed (ai_processed: false):', unprocessed);

        // Group by type
        const typeAggregation = await ElevenLabsWebhook.aggregate([
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        console.log('\n--- Grouped by Type ---');
        typeAggregation.forEach(group => {
            console.log(`Type: ${group._id || 'NULL'}, Count: ${group.count}`);
        });

        // Group by schoolId
        const schoolAggregation = await ElevenLabsWebhook.aggregate([
            {
                $group: {
                    _id: '$schoolId',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        console.log('\n--- Grouped by schoolId ---');
        schoolAggregation.forEach(group => {
            console.log(`School ID: ${group._id || 'NULL'}, Count: ${group.count}`);
        });

        // Sample one recent call webhook to see the agent_id
        const sample = await ElevenLabsWebhook.findOne({ type: 'post_call_transcription' }).sort({ received_at: -1 });
        if (sample) {
            console.log('\n--- Sample Webhook (Recent) ---');
            console.log('Agent ID:', sample.agent_id);
            console.log('School ID:', sample.schoolId);
            console.log('Conversation ID:', sample.conversation_id);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

debugWebhooks();
