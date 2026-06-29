const express = require('express');
const { getGuildByApiKey, getGuildByLicenseKey, activatePremium, deactivatePremium } = require('../db/guildRepository');
const { getUserById, getUserBalance, addUserBalance, deductBalance } = require('../db/userRepository');
const { sendWebhook } = require('../services/webhookEmitter');
const { verifyWebhookSignature } = require('../services/lemonsqueezy');
const { verifyEventSubSignature } = require('../services/twitch');
const twitchRepository = require('../db/twitchRepository');
const logger = require('../util/logger');

// Twitch EventSub olaylarını işlemek için Discord client lazım — startApiServer'a parametre ile geçirilir
let _discordClient = null;

const app = express();

// Basit in-memory rate limiter (harici bağımlılık gerektirmez)
const rateLimitWindows = new Map();
function rateLimit(windowMs, max) {
    return (req, res, next) => {
        const key = req.ip;
        const now = Date.now();
        const hits = (rateLimitWindows.get(key) || []).filter(t => now - t < windowMs);
        if (hits.length >= max) {
            return res.status(429).json({ error: 'Too many requests, slow down.' });
        }
        hits.push(now);
        rateLimitWindows.set(key, hits);
        next();
    };
}

const apiLimiter = rateLimit(60 * 1000, 60);       // 60 istek/dakika
const deductLimiter = rateLimit(60 * 1000, 10);    // deduct için daha katı

// LemonSqueezy webhook raw body için önce bu endpoint'i tanımla
app.post('/api/lemonsqueezy/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-signature'];
    if (!signature || !verifyWebhookSignature(req.body, signature)) {
        return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString());
    const eventName = event.meta?.event_name;
    const licenseKey = event.data?.attributes?.first_order_item?.license_key
        || event.data?.attributes?.license_key;

    if (!licenseKey) return res.sendStatus(200);

    if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
        const renewsAt = event.data?.attributes?.renews_at || null;
        const guild = await getGuildByLicenseKey(licenseKey);
        if (guild) await activatePremium(guild.guild_id, licenseKey, renewsAt);
    }

    if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
        const guild = await getGuildByLicenseKey(licenseKey);
        if (guild) await deactivatePremium(guild.guild_id);
    }

    res.sendStatus(200);
});

app.use(express.json());

async function authenticate(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const apiKey = auth.slice(7);
    const guild = await getGuildByApiKey(apiKey);
    if (!guild) return res.status(401).json({ error: 'Invalid API key' });
    req.guild = guild;
    next();
}

// GET /api/balance/:userId
app.get('/api/balance/:userId', apiLimiter, authenticate, async (req, res) => {
    const { userId } = req.params;
    let user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user_id: userId, balance: user.balance });
});

// POST /api/balance/deduct
app.post('/api/balance/deduct', deductLimiter, authenticate, async (req, res) => {
    const { user_id, amount, reason } = req.body;

    if (!user_id || !amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'user_id ve pozitif amount gerekli' });
    }

    const user = await getUserById(user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Atomik deduct — race condition yok
    const ok = await deductBalance(user_id, amount);
    if (!ok) {
        return res.status(400).json({ error: 'Yetersiz bakiye', balance: user.balance });
    }
    const newBalance = await getUserBalance(user_id);

    if (req.guild.webhook_url) {
        await sendWebhook(req.guild.webhook_url, req.guild.webhook_secret, {
            event: 'balance.deducted',
            guild_id: req.guild.guild_id,
            user_id,
            amount,
            new_balance: newBalance,
            reason: reason || null,
            timestamp: new Date().toISOString(),
        });
    }

    res.json({ success: true, user_id, amount, new_balance: newBalance });
});

// POST /api/twitch/eventsub — Twitch EventSub webhook
app.post('/api/twitch/eventsub', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!verifyEventSubSignature(req.body, req.headers)) {
        return res.status(403).json({ error: 'Invalid signature' });
    }

    const body      = JSON.parse(req.body.toString());
    const msgType   = req.headers['twitch-eventsub-message-type'];

    // Twitch challenge doğrulaması (subscribe sırasında bir kez gönderilir)
    if (msgType === 'webhook_callback_verification') {
        return res.status(200).send(body.challenge);
    }

    if (msgType === 'notification') {
        const eventType = body.subscription?.type;
        if (eventType === 'stream.online') {
            const channelId = body.event?.broadcaster_user_id;
            const tracking  = await twitchRepository.getTrackingByChannelId(channelId);
            if (tracking && _discordClient) {
                handleStreamOnline(tracking, _discordClient).catch(err =>
                    logger.error('Twitch stream.online işleme hatası', { error: err.message })
                );
            }
        }
    }

    res.sendStatus(200);
});

async function handleStreamOnline(tracking, client) {
    const riotApi     = require('../services/riot');
    const betRepository = require('../db/betRepository');
    const { watchMatchEnd } = require('../util/watchmatch');
    const { resolveMatch }  = require('../util/resolveMatch');
    const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
    const { getChampionName } = require('../util/championCache');
    const { t } = require('../util/i18n');
    const COLORS  = require('../util/colors');

    logger.info('Twitch yayın başladı, maç kontrol ediliyor', { channel: tracking.twitch_channel_name });

    const summoner = await riotApi.getAccountBySummonerName(tracking.summoner_name, tracking.tagline);
    if (!summoner) return;

    const activeGame = await riotApi.getActiveGameBySummonerId(tracking.region, summoner.puuid);
    if (!activeGame || activeGame.gameLength > 300) return;

    const matchId = `${activeGame.platformId}_${activeGame.gameId}`;
    const existing = await betRepository.getMatchBetById(matchId);
    if (existing) return; // zaten izleniyor

    const channel = await client.channels.fetch(tracking.discord_channel_id);
    if (!channel) return;

    const isBlue = activeGame.participants.some(p => p.teamId === 100 && p.puuid === summoner.puuid);

    const formatTeam = (teamId) => activeGame.participants
        .filter(p => p.teamId === teamId)
        .map(p => {
            const name = p.riotId.split('#')[0];
            const champ = getChampionName(p.championId);
            return p.puuid === summoner.puuid ? `**${name} — ${champ}** ◄` : `${name} — ${champ}`;
        }).join('\n');

    const matchStartedAt = Date.now() - activeGame.gameLength * 1000;
    await betRepository.createMatchBet(matchId, 'TWITCH_AUTO', matchStartedAt, summoner.puuid, tracking.region, tracking.discord_channel_id);

    const embed = new EmbedBuilder()
        .setAuthor({ name: '🔴 Zeni — Twitch Otomatik Bahis' })
        .setTitle(`${tracking.twitch_channel_name} CANLI!`)
        .setDescription(`**${tracking.summoner_name}#${tracking.tagline}** ${isBlue ? '(Mavi Takım)' : '(Kırmızı Takım)'}`)
        .setColor(COLORS.INFO)
        .addFields(
            { name: 'Mavi Takım',  value: formatTeam(100), inline: true },
            { name: 'Kırmızı Takım', value: formatTeam(200), inline: true },
            { name: 'Minimum Bahis', value: `${tracking.min_bet} JP`, inline: true },
        )
        .setTimestamp();

    const joinBtn = new ButtonBuilder()
        .setCustomId(`placeBet-${matchId}-${tracking.min_bet}`)
        .setLabel('Bahis Yap')
        .setStyle(ButtonStyle.Success);

    await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(joinBtn)] });

    const resolveWithClient = (mId, s, r) => resolveMatch(mId, s, r, client);
    watchMatchEnd(matchId, summoner, tracking.region, resolveWithClient)
        .then(async (resultEmbed) => {
            if (resultEmbed) await channel.send({ embeds: [resultEmbed] });
        })
        .catch(err => logger.error('Twitch maç izleme hatası', { matchId, error: err.message }));
}

function startApiServer(port = process.env.API_PORT || 3000, discordClient = null) {
    _discordClient = discordClient;
    app.listen(port, () => console.log(`API server çalışıyor: port ${port}`));
}

module.exports = { startApiServer };
