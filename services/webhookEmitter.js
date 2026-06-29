const crypto = require('crypto');
const axios = require('axios');

async function sendWebhook(webhookUrl, secret, payload) {
    const body = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    try {
        await axios.post(webhookUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Signature': signature,
            },
            timeout: 5000,
        });
    } catch (err) {
        console.error(`Webhook gönderilemedi (${webhookUrl}):`, err.message);
    }
}

module.exports = { sendWebhook };
