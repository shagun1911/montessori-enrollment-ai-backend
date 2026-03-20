const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const School = require('./src/models/School');
const CallLog = require('./src/models/CallLog');

async function checkStats() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');
        
        // Find by ID directly since user gave suffix
        const schools = await School.find();
        const sunshine = schools.find(s => s._id.toString().endsWith('3116d6'));
        
        if (!sunshine) {
            console.log('Sunshine school (#3116d6) not found');
            process.exit(0);
        }
        
        console.log('\n--- Sunshine School Info ---');
        console.log('Name:', sunshine.name);
        console.log('ID:', sunshine._id.toString());
        console.log('AI Number:', sunshine.aiNumber);
        console.log('Agent ID:', sunshine.elevenlabsAgentId);
        
        const countById = await CallLog.countDocuments({ schoolId: sunshine._id });
        console.log('CallLog count for this ID:', countById);
        
        if (sunshine.aiNumber) {
            const countByNumber = await CallLog.countDocuments({ to_phone_number: sunshine.aiNumber });
            console.log('CallLog count by phone number:', countByNumber);
        }

        if (sunshine.elevenlabsAgentId) {
            const countByAgent = await CallLog.countDocuments({ agent_id: sunshine.elevenlabsAgentId });
            console.log('CallLog count by Agent ID:', countByAgent);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

checkStats();
