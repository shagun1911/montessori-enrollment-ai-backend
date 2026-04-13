const axios = require('axios');

function apiBase() {
    return process.env.PAYPAL_MODE === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
}

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) {
        throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set');
    }
    if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
        return tokenCache.token;
    }
    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const { data } = await axios.post(
        `${apiBase()}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }
    );
    tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
    };
    return tokenCache.token;
}

async function paypalRequest(method, path, body) {
    const token = await getAccessToken();
    const url = `${apiBase()}${path}`;
    const { data } = await axios({
        method,
        url,
        data: body,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
    });
    return data;
}

/**
 * Create a billing subscription; returns { id, status, links }.
 */
async function createSubscription({ planId, customId, returnUrl, cancelUrl, brandName }) {
    const payload = {
        plan_id: planId,
        custom_id: customId,
        application_context: {
            brand_name: brandName || 'Nora',
            locale: 'en-US',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'SUBSCRIBE_NOW',
            payment_method: {
                payer_selected: 'PAYPAL',
                payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
            },
            return_url: returnUrl,
            cancel_url: cancelUrl,
        },
    };
    return paypalRequest('POST', '/v1/billing/subscriptions', payload);
}

async function getSubscription(subscriptionId) {
    return paypalRequest('GET', `/v1/billing/subscriptions/${subscriptionId}`, undefined);
}

/**
 * One-time order (top-up or onboarding capture).
 */
async function createOrder({ amountUsd, currency, customId, description, returnUrl, cancelUrl }) {
    const payload = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                description: description || 'Nora minutes',
                amount: {
                    currency_code: currency || 'USD',
                    value: Number(amountUsd).toFixed(2),
                },
                custom_id: customId,
            },
        ],
    };
    if (returnUrl && cancelUrl) {
        payload.application_context = {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            user_action: 'PAY_NOW',
        };
    }
    return paypalRequest('POST', '/v2/checkout/orders', payload);
}

async function captureOrder(orderId) {
    return paypalRequest('POST', `/v2/checkout/orders/${orderId}/capture`, {});
}

/**
 * Verify webhook signature (PayPal REST v1 notifications).
 * @param {Buffer|string} rawBody - raw JSON body as sent
 * @param {Object} headers - req.headers
 */
async function verifyWebhookSignature(rawBody, headers) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
        console.warn('[PayPal] PAYPAL_WEBHOOK_ID not set — skipping signature verification');
        return true;
    }
    const token = await getAccessToken();
    const bodyObj = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    const verifyPayload = {
        transmission_id: headers['paypal-transmission-id'],
        transmission_time: headers['paypal-transmission-time'],
        cert_url: headers['paypal-cert-url'],
        auth_algo: headers['paypal-auth-algo'],
        transmission_sig: headers['paypal-transmission-sig'],
        webhook_id: webhookId,
        webhook_event: bodyObj,
    };
    try {
        const { data } = await axios.post(
            `${apiBase()}/v1/notifications/verify-webhook-signature`,
            verifyPayload,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        return data.verification_status === 'SUCCESS';
    } catch (err) {
        console.error('[PayPal] Webhook verify error:', err.response?.data || err.message);
        return false;
    }
}

module.exports = {
    apiBase,
    getAccessToken,
    createSubscription,
    getSubscription,
    createOrder,
    captureOrder,
    verifyWebhookSignature,
};
