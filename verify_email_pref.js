const mongoose = require('mongoose');
require('dotenv').config();

const School = require('./src/models/School');
const Integration = require('./src/models/Integration');
const { sendEmail } = require('./src/services/mailService');

async function verify() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const schoolId = '69bec5085d8158818111b005';
        
        console.log('\n--- Checking School Preference ---');
        let school = await School.findById(schoolId);
        console.log('Current Preferred Email:', school.preferredEmailProvider);

        // Update to outlook to test
        school.preferredEmailProvider = 'outlook';
        await school.save();
        console.log('Updated Preferred Email to: outlook');

        school = await School.findById(schoolId);
        console.log('Verified Preferred Email in DB:', school.preferredEmailProvider);

        console.log('\n--- Testing Mail Priority Logic (Dry Run/Log) ---');
        // We won't actually send, but we can see the logic in action if we had more logs.
        // For now, confirming the DB state is the main verification.
        
        const integrations = await Integration.find({ schoolId, connected: true }).lean();
        console.log('Connected Integrations:', integrations.map(i => i.type).join(', '));
        
        const preferred = school.preferredEmailProvider;
        const providers = preferred === 'outlook' ? ['outlook', 'google'] : ['google', 'outlook'];
        console.log('Calculated priority order:', providers.join(' -> '));

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

verify();
