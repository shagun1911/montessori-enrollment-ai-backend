const mongoose = require('mongoose');
require('dotenv').config();

const Integration = require('./src/models/Integration');

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const integration = await Integration.findOne({ schoolId: '69bec5085d8158818111b005', type: 'outlook' }).lean();
        console.log(JSON.stringify(integration, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}

check();
