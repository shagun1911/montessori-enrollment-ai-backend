const School = require('../models/School');
const Followup = require('../models/Followup');

async function triggerAutomation(schoolId, leadData) {
    try {
        const school = await School.findById(schoolId);
        if (!school) return;

        const { parentName, phone, email, childAge } = leadData;
        const formLink = `https://enrollmentai.com/inquiry/${school._id}`; // Example form link

        // SMS Automation
        if (school.smsAutoFollowup && school.twilioSid && school.twilioAuthToken && school.twilioPhoneNumber && phone) {
            const smsMessage = school.smsTemplate
                .replace('{parent_name}', parentName || 'Parent')
                .replace('{school_name}', school.name)
                .replace('{form_link}', formLink);

            console.log(`[SMS Automation] Sending to ${phone}: ${smsMessage}`);

            // Here you would use the twilio library:
            // const client = require('twilio')(school.twilioSid, school.twilioAuthToken);
            // await client.messages.create({ body: smsMessage, from: school.twilioPhoneNumber, to: phone });

            await Followup.create({
                schoolId,
                leadName: parentName || 'Unknown',
                type: 'SMS',
                status: 'sent',
                message: smsMessage,
                recipient: phone,
            });
        }

        // Email Automation
        if (school.emailAutoFollowup && email) {
            const emailMessage = school.emailTemplate
                .replace('{parent_name}', parentName || 'Parent')
                .replace('{school_name}', school.name)
                .replace('{form_link}', formLink)
                .replace('{child_age}', childAge || 'any');

            console.log(`[Email Automation] Sending to ${email}: ${emailMessage}`);

            // Here you would use nodemailer or a service like SendGrid

            await Followup.create({
                schoolId,
                leadName: parentName || 'Unknown',
                type: 'Email',
                status: 'sent',
                message: emailMessage,
                recipient: email,
            });
        }
    } catch (err) {
        console.error('Automation error:', err);
    }
}

module.exports = { triggerAutomation };
