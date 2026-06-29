const axios = require('axios');
const crypto = require('crypto');
const logger = require('../util/logger');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAppToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

    const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
            client_id:     process.env.TWITCH_CLIENT_ID,
            client_secret: process.env.TWITCH_CLIENT_SECRET,
            grant_type:    'client_credentials',
        },
    });

    cachedToken    = res.data.access_token;
    tokenExpiresAt = Date.now() + res.data.expires_in * 1000 - 60_000; // 1 dk erken yenile
    return cachedToken;
}

async function getChannelId(channelName) {
    const token = await getAppToken();
    const res = await axios.get('https://api.twitch.tv/helix/users', {
        params:  { login: channelName },
        headers: {
            'Client-ID':    process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
        },
    });
    return res.data.data[0]?.id || null;
}

async function subscribeToStreamOnline(channelId) {
    const token       = await getAppToken();
    const callbackUrl = `${process.env.PUBLIC_URL}/api/twitch/eventsub`;
    const secret      = process.env.TWITCH_EVENTSUB_SECRET;

    const res = await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
        type:      'stream.online',
        version:   '1',
        condition: { broadcaster_user_id: channelId },
        transport: {
            method:   'webhook',
            callback: callbackUrl,
            secret,
        },
    }, {
        headers: {
            'Client-ID':     process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
        },
    });

    return res.data.data[0]?.id || null;
}

async function deleteSubscription(eventsubId) {
    try {
        const token = await getAppToken();
        await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${eventsubId}`, {
            headers: {
                'Client-ID':     process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${token}`,
            },
        });
    } catch (_) {}
}

// Twitch EventSub webhook imza doğrulaması
function verifyEventSubSignature(rawBody, headers) {
    const secret    = process.env.TWITCH_EVENTSUB_SECRET;
    const msgId     = headers['twitch-eventsub-message-id'];
    const timestamp = headers['twitch-eventsub-message-timestamp'];
    const signature = headers['twitch-eventsub-message-signature'];

    if (!secret || !msgId || !timestamp || !signature) return false;

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(msgId + timestamp + rawBody.toString());
    const expected = 'sha256=' + hmac.digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (_) {
        return false;
    }
}

// Tüm izlenen kanalları yeniden subscribe et (bot restart sonrası)
async function resubscribeAll(trackings) {
    if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || !process.env.PUBLIC_URL) return;

    for (const tracking of trackings) {
        if (!tracking.twitch_channel_id) continue;
        try {
            await subscribeToStreamOnline(tracking.twitch_channel_id);
            logger.info('Twitch EventSub yenilendi', { channel: tracking.twitch_channel_name });
        } catch (err) {
            logger.warn('Twitch EventSub yenilenemedi', { channel: tracking.twitch_channel_name, error: err.message });
        }
    }
}

module.exports = {
    getAppToken,
    getChannelId,
    subscribeToStreamOnline,
    deleteSubscription,
    verifyEventSubSignature,
    resubscribeAll,
};
