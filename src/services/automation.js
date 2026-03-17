const School = require('../models/School');
const Followup = require('../models/Followup');
const { sendEmail } = require('./mailService');

function getTwilioClient(sid, authToken) {
    try {
        return require('twilio')(sid, authToken);
    } catch (e) {
        return null;
    }
}







// Email transport logic moved to mailService.js

async function triggerAutomation(schoolId, leadData) {
    const result = { smsSent: false, emailSent: false, smsError: null, emailError: null };
    try {
        const school = await School.findById(schoolId);
        if (!school) {
            result.smsError = 'School not found';
            result.emailError = 'School not found';
            return result;
        }
        const { parentName, phone, email, childAge } = leadData;
        const formLink = process.env.FORM_BASE_URL
            ? `${process.env.FORM_BASE_URL}/inquiry/${school._id}`
            : `https://enrollmentai.com/inquiry/${school._id}`;

        // SMS via Twilio
        if (school.smsAutoFollowup && school.twilioSid && school.twilioAuthToken && school.twilioPhoneNumber && phone) {
            const smsMessage = (school.smsTemplate || '')
                .replace(/\{parent_name\}/g, parentName || 'Parent')
                .replace(/\{school_name\}/g, school.name)
                .replace(/\{form_link\}/g, formLink);

            let status = 'pending';
            const client = getTwilioClient(school.twilioSid, school.twilioAuthToken);
            if (client) {
                try {
                    await client.messages.create({
                        body: smsMessage,
                        from: school.twilioPhoneNumber,
                        to: phone,
                    });
                    status = 'sent';
                    result.smsSent = true;
                } catch (err) {
                    console.error('[SMS Automation] Twilio error:', err.message);
                    status = 'failed';
                    result.smsError = err.message || String(err.code || 'SMS failed');
                }
            } else {
                result.smsError = 'Twilio not configured. Check Account SID, Auth Token, and install twilio package.';
            }





            
            await Followup.create({
                schoolId,
                leadName: parentName || 'Unknown',
                type: 'SMS',
                status,
                message: smsMessage,
                recipient: phone,
            });
        } else if (phone && (!school.smsAutoFollowup || !school.twilioPhoneNumber)) {
            result.smsError = 'Enable "Send SMS follow-up" in Settings and add Twilio phone number, then Save.';
        }

        // Email via SMTP (nodemailer)
        if (school.emailAutoFollowup && email) {
            const emailBody = (school.emailTemplate || '')
                .replace(/\{parent_name\}/g, parentName || 'Parent')
                .replace(/\{school_name\}/g, school.name)
                .replace(/\{form_link\}/g, formLink)
                .replace(/\{child_age\}/g, childAge || 'any');

            try {
                await sendEmail(schoolId, {
                    to: email,
                    subject: `Follow-up from ${school.name}`,
                    text: emailBody,
                });
                status = 'sent';
                result.emailSent = true;
            } catch (err) {
                console.error('[Email Automation] Send error:', err.message);
                status = 'failed';
                result.emailError = err.message || 'Email send failed';
            }

            await Followup.create({
                schoolId,
                leadName: parentName || 'Unknown',
                type: 'Email',
                status,
                message: emailBody,
                recipient: email,
            });
        } else if (email && !school.emailAutoFollowup) {
            result.emailError = 'Enable "Send Email follow-up" in Settings and Save.';
        }
    } catch (err) {
        console.error('Automation error:', err);
        result.smsError = result.smsError || err.message;
        result.emailError = result.emailError || err.message;
    }
    return result;
}

async function sendTourConfirmation(schoolId, tourBooking) {
    try {
        const school = await School.findById(schoolId);
        if (!school) return;

        const { parentName, phone, email, scheduledAt } = tourBooking;
        const tourDateStr = new Date(scheduledAt).toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: school.timezone || 'UTC'
        });

        // 1. Send Confirmation Email
        if (email) {
            const emailBody = (school.tourConfirmationEmailTemplate || '')
                .replace(/\{parent_name\}/g, parentName || 'Parent')
                .replace(/\{school_name\}/g, school.name)
                .replace(/\{tour_date\}/g, tourDateStr)
                .replace(/\{school_address\}/g, school.address || 'our campus');

            try {
                await sendEmail(schoolId, {
                    to: email,
                    subject: `Tour Confirmation: ${school.name}`,
                    text: emailBody,
                });
                
                await Followup.create({
                    schoolId,
                    leadName: parentName || 'Unknown',
                    type: 'Email',
                    status: 'sent',
                    message: emailBody,
                    recipient: email,
                });
            } catch (err) {
                console.error('[Tour Confirmation Email] Error:', err.message);
            }
        }

        // 2. Send SMS Confirmation (Optional/Immediate)
        if (phone && school.smsAutoFollowup && school.twilioSid && school.twilioPhoneNumber) {
            const smsBody = (school.tourReminderSmsTemplate || '')
                .replace(/\{parent_name\}/g, parentName || 'Parent')
                .replace(/\{school_name\}/g, school.name)
                .replace(/\{tour_date\}/g, tourDateStr);

            const client = getTwilioClient(school.twilioSid, school.twilioAuthToken);
            if (client) {
                try {
                    await client.messages.create({
                        body: smsBody,
                        from: school.twilioPhoneNumber,
                        to: phone,
                    });
                    
                    await Followup.create({
                        schoolId,
                        leadName: parentName || 'Unknown',
                        type: 'SMS',
                        status: 'sent',
                        message: smsBody,
                        recipient: phone,
                    });
                } catch (err) {
                    console.error('[Tour Confirmation SMS] Error:', err.message);
                }
            }
        }
    } catch (err) {
        console.error('sendTourConfirmation error:', err);
    }
}

module.exports = { triggerAutomation, sendTourConfirmation };
