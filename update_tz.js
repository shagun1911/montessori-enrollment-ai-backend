const mongoose = require('mongoose');
const School = require('./src/models/School');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to DB');
    const result = await School.updateMany({}, { $set: { timezone: 'America/Chicago' } });
    console.log(`Updated ${result.modifiedCount} schools to America/Chicago`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
