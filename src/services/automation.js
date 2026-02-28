const School = require('../models/School');
const Followup = require('../models/Followup');

function getTwilioClient(sid, authToken) {
    try {
        return require('twilio')(sid, authToken);
    } catch (e) {
        return null;
    }
}







function getEmailTransport() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
    const secure = process.env.SMTP_SECURE === 'true';
    if (!host || !user || !pass) return null;
    try {
        const nodemailer = require('nodemailer');
        return nodemailer.createTransport({
            host,
            port: Number(port),
            secure,
            auth: { user, pass },
        });
    } catch (e) {
        return null;
    }
}

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

            let status = 'pending';
            const transport = getEmailTransport();
            const from = process.env.MAIL_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@enrollmentai.com';

            if (transport) {
                try {
                    await transport.sendMail({
                        from,
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
            } else {
                result.emailError = 'SMTP not configured in server .env (SMTP_HOST, SMTP_USER, SMTP_PASS).';
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

module.exports = { triggerAutomation };
