const { google } = require('googleapis');
const axios = require('axios');
const nodemailer = require('nodemailer');
const Integration = require('../models/Integration');
const School = require('../models/School');

/**
 * Creates a Google OAuth2 client for a school's integration.
 */
function createGoogleOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
}

/**
 * Sends an email using the best available method for the school.
 * Priorities: 
 * 1. Gmail API (if Google connected)
 * 2. Outlook/Graph API (if Outlook connected)
 * 3. Fallback to System SMTP
 * 
 * @param {string} schoolId - MongoDB ObjectId
 * @param {object} opts - { to, subject, text, html }
 */
async function sendEmail(schoolId, opts) {
    const { to, subject, text, html } = opts;
    
    try {
        const integrations = await Integration.find({ schoolId, connected: true }).lean();
        
        // 1. Try Google/Gmail
        const googleIntegration = integrations.find(i => i.type === 'google');
        if (googleIntegration && googleIntegration.config?.tokens) {
            try {
                return await sendViaGmail(googleIntegration, opts);
            } catch (err) {
                console.error('[MailService] Gmail send failed, falling back:', err.message);
            }
        }
        
        // 2. Try Outlook
        const outlookIntegration = integrations.find(i => i.type === 'outlook');
        if (outlookIntegration && outlookIntegration.config?.accessToken) {
            try {
                return await sendViaOutlook(outlookIntegration, opts);
            } catch (err) {
                console.error('[MailService] Outlook send failed, falling back:', err.message);
            }
        }
        
        // 3. Fallback to SMTP
        return await sendViaSMTP(opts);

    } catch (err) {
        console.error('[MailService] Unified send error:', err.message);
        // Last resort: try SMTP even if integration lookup failed
        return await sendViaSMTP(opts);
    }
}

async function sendViaGmail(integration, { to, subject, text, html }) {
    const oauth2Client = createGoogleOAuthClient();
    const tokens = integration.config.tokens;
    oauth2Client.setCredentials(tokens);

    // Refresh token listener
    oauth2Client.on('tokens', async (newTokens) => {
        await Integration.updateOne(
            { _id: integration._id },
            { $set: { 'config.tokens': { ...tokens, ...newTokens } } }
        );
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Create RFC 2822 formatted email
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
        `To: ${to}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        html || text.replace(/\n/g, '<br>')
    ];
    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage }
    });
    
    console.log('[MailService] Email sent via Gmail API:', res.data.id);
    return { success: true, method: 'gmail', messageId: res.data.id };
}

async function sendViaOutlook(integration, { to, subject, text, html }) {
    const accessToken = integration.config.accessToken;
    
    const emailData = {
        message: {
            subject: subject,
            body: {
                contentType: html ? 'HTML' : 'Text',
                content: html || text
            },
            toRecipients: [
                { emailAddress: { address: to } }
            ]
        }
    };

    const res = await axios.post(
        'https://graph.microsoft.com/v1.0/me/sendMail',
        emailData,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    console.log('[MailService] Email sent via Outlook API');
    return { success: true, method: 'outlook' };
}

async function sendViaSMTP({ to, subject, text, html }) {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
    const from = process.env.MAIL_FROM || process.env.EMAIL_FROM || user || 'noreply@enrollmentai.com';

    if (!host || !user || !pass) {
        throw new Error('SMTP not configured');
    }

    const transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user, pass },
    });

    const info = await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html
    });

    console.log('[MailService] Email sent via SMTP:', info.messageId);
    return { success: true, method: 'smtp', messageId: info.messageId };
}

module.exports = { sendEmail };
