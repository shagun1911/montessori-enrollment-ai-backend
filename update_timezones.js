require('dotenv').config();
const mongoose = require('mongoose');
const School = require('./src/models/School');

async function updateAllTimezones() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const result = await School.updateMany({}, { $set: { timezone: 'America/Chicago' } });
        console.log(`Successfully updated ${result.modifiedCount} schools to CST (America/Chicago).`);

        await mongoose.connection.close();
        process.exit(0);
    } catch (err) {
        console.error('Error updating timezones:', err);
        process.exit(1);
    }
}

updateAllTimezones();
