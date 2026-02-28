const express = require('express');
const router = express.Router();

const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_TRANSLATE_API_KEY;

/**
 * POST /api/translate
 * Body: { text: string | string[], target: string }
 * Target: 'es' | 'en'
 * Returns: { translated: string | string[] }
 */
router.post('/translate', async (req, res) => {
    try {
        if (!API_KEY) {
            return res.status(503).json({
                error: 'Translation not configured. Set GOOGLE_TRANSLATE_API_KEY in server .env.',
            });
        }

        const { text, target } = req.body;
        if (!text || !target || !['en', 'es'].includes(target)) {
            return res.status(400).json({
                error: 'Missing or invalid body. Required: text (string or array), target ("en" or "es").',
            });
        }

        const strings = Array.isArray(text) ? text : [text];
        if (strings.length === 0) {
            return res.json({ translated: Array.isArray(text) ? [] : '' });
        }

        const url = new URL('https://translation.googleapis.com/language/translate/v2');
        url.searchParams.set('key', API_KEY);

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                q: strings,
                target: target === 'en' ? 'en' : 'es',
                format: 'text',
            }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('Google Translate API error:', response.status, errBody);
            return res.status(502).json({
                error: 'Translation service error. Check your API key and quota.',
            });
        }

        const data = await response.json();
        const translations = (data.data?.translations || []).map((t) => t.translatedText || '');

        const result = Array.isArray(text) ? translations : translations[0] || '';
        res.json({ translated: result });
    } catch (err) {
        console.error('Translate error:', err);
        res.status(500).json({ error: 'Translation failed.' });
    }
});

module.exports = router;
