const crypto = require('crypto');
const axios = require('axios');

const BASE_URL = 'https://api.lemonsqueezy.com/v1';

function lsRequest(method, path, data) {
    return axios({
        method,
        url: `${BASE_URL}${path}`,
        headers: {
            'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
            'Accept': 'application/vnd.api+json',
            'Content-Type': 'application/vnd.api+json',
        },
        data,
    });
}

async function activateLicense(licenseKey, guildId) {
    try {
        const res = await lsRequest('POST', '/licenses/activate', {
            license_key: licenseKey,
            instance_name: guildId,
        });
        return res.data;
    } catch (err) {
        return err.response?.data || null;
    }
}

async function deactivateLicense(licenseKey, instanceId) {
    try {
        const res = await lsRequest('POST', '/licenses/deactivate', {
            license_key: licenseKey,
            instance_id: instanceId,
        });
        return res.data;
    } catch (err) {
        return null;
    }
}

function verifyWebhookSignature(rawBody, signature) {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

module.exports = { activateLicense, deactivateLicense, verifyWebhookSignature };
