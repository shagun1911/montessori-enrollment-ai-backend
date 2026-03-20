const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const CallLog = require('./src/models/CallLog');

async function debugAllCalls() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');
        
        const total = await CallLog.countDocuments();
        console.log('Total CallLog entries in DB:', total);
        
        // Group by schoolId
        const aggregation = await CallLog.aggregate([
            {
                $group: {
                    _id: '$schoolId',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        console.log('\n--- Grouped by schoolId ---');
        aggregation.forEach(group => {
            console.log(`School ID: ${group._id || 'NULL'}, Count: ${group.count}`);
        });

        // Group by to_phone_number
        const phoneAggregation = await CallLog.aggregate([
            {
                $group: {
                    _id: '$to_phone_number',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        console.log('\n--- Grouped by to_phone_number ---');
        phoneAggregation.forEach(group => {
            console.log(`Phone: ${group._id || 'NULL'}, Count: ${group.count}`);
        });

        // Group by agent_id
        const agentAggregation = await CallLog.aggregate([
            {
                $group: {
                    _id: '$agent_id',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        console.log('\n--- Grouped by Agent ID ---');
        agentAggregation.forEach(group => {
            console.log(`Agent ID: ${group._id || 'NULL'}, Count: ${group.count}`);
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

debugAllCalls();
