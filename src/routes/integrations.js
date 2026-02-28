require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const msal = require('@azure/msal-node');
const Integration = require('../models/Integration');

const router = express.Router();

// ── Google OAuth Configuration ──
const googleConfig = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
};

function createGoogleOAuthClient() {
    return new google.auth.OAuth2(
        googleConfig.clientId,
        googleConfig.clientSecret,
        googleConfig.redirectUri
    );
}

function getGoogleAuthUrl(schoolId) {
    if (!googleConfig.clientId || !googleConfig.clientSecret) {
        return null; // Not configured
    }
    const oauth2Client = createGoogleOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/userinfo.email',
        ],
        state: schoolId.toString(),
        prompt: 'consent',
    });
}

// ── Microsoft Outlook OAuth Configuration ──
const msalConfig = {
    auth: {
        clientId: process.env.OUTLOOK_CLIENT_ID || 'placeholder',
        authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID || 'common'}`,
        clientSecret: process.env.OUTLOOK_CLIENT_SECRET || 'placeholder',
    },
};

let pca;
try {
    pca = new msal.ConfidentialClientApplication(msalConfig);
} catch (e) {
    console.warn('[Integrations] MSAL init skipped (Outlook not configured):', e.message);
}

async function getOutlookAuthUrl(schoolId) {
    if (!pca || !process.env.OUTLOOK_CLIENT_ID) {
        return null; // Not configured
    }
    const authCodeUrlParameters = {
        scopes: ['user.read', 'calendars.readwrite', 'mail.send'],
        redirectUri: process.env.OUTLOOK_REDIRECT_URI,
        state: schoolId.toString(),
    };
    return await pca.getAuthCodeUrl(authCodeUrlParameters);
}

// ── Google OAuth Callback ──
router.get('/google/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
        return res.status(400).send('Missing code or state');
    }

    try {
        const schoolId = state;
        const oauth2Client = createGoogleOAuthClient();
        const { tokens } = await oauth2Client.getToken(code);

        await Integration.findOneAndUpdate(
            { schoolId, type: 'google' },
            { connected: true, connectedAt: new Date(), config: { tokens } },
            { upsert: true }
        );

        res.redirect(`${process.env.FORM_BASE_URL || 'http://localhost:5173'}/school/integrations?success=google`);
    } catch (err) {
        console.error('Google Callback Error:', err);
        res.redirect(`${process.env.FORM_BASE_URL || 'http://localhost:5173'}/school/integrations?error=google`);
    }
});

// ── Outlook OAuth Callback ──
router.get('/outlook/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
        return res.status(400).send('Missing code or state');
    }

    try {
        const schoolId = state;
        const tokenRequest = {
            code,
            scopes: ['user.read', 'calendars.readwrite', 'mail.send'],
            redirectUri: process.env.OUTLOOK_REDIRECT_URI,
        };

        const response = await pca.acquireTokenByCode(tokenRequest);

        await Integration.findOneAndUpdate(
            { schoolId, type: 'outlook' },
            {
                connected: true,
                connectedAt: new Date(),
                config: {
                    account: response.account,
                    accessToken: response.accessToken,
                },
            },
            { upsert: true }
        );

        res.redirect(`${process.env.FORM_BASE_URL || 'http://localhost:5173'}/school/integrations?success=outlook`);
    } catch (err) {
        console.error('Outlook Callback Error:', err);
        res.redirect(`${process.env.FORM_BASE_URL || 'http://localhost:5173'}/school/integrations?error=outlook`);
    }
});

module.exports = {
    router,
    getGoogleAuthUrl,
    getOutlookAuthUrl,
};
