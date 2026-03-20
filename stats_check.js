const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// We are running from backend/ delete for now or fix path
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const School = require('./src/models/School');
const CallLog = require('./src/models/CallLog');

async function checkStats() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');
        
        const sunshine = await School.findOne({ name: /Sunshine/i });
        if (!sunshine) {
            console.log('Sunshine school not found');
            process.exit(0);
        }
        
        console.log('\n--- Sunshine School Info ---');
        console.log('Name:', sunshine.name);
        console.log('ID:', sunshine._id.toString());
        console.log('AI Number:', sunshine.aiNumber);
        
        const countById = await CallLog.countDocuments({ schoolId: sunshine._id });
        console.log('CallLog count for this ID:', countById);
        
        if (sunshine.aiNumber) {
            const countByNumber = await CallLog.countDocuments({ to_phone_number: sunshine.aiNumber });
            console.log('CallLog count by phone number:', countByNumber);
        }

        const allSunshines = await School.find({ name: /Sunshine/i });
        console.log('\nAll Sunshine-related schools found:', allSunshines.length);
        for (const s of allSunshines) {
            const c = await CallLog.countDocuments({ schoolId: s._id });
            console.log(`- ID: ${s._id}, Name: ${s.name}, AI Number: ${s.aiNumber}, Calls: ${c}`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

checkStats();
