const crypto = require('crypto');
const db = require('./db');

const getGuildSettings = (guildId) => {
    return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
};

const getGuildByApiKey = (apiKey) => {
    return db.prepare('SELECT * FROM guild_settings WHERE api_key = ?').get(apiKey);
};

const createGuildSettings = (guildId) => {
    const existing = getGuildSettings(guildId);
    if (existing) return existing;

    const apiKey = crypto.randomBytes(32).toString('hex');
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO guild_settings (guild_id, api_key, webhook_secret) VALUES (?, ?, ?)')
        .run(guildId, apiKey, webhookSecret);
    return getGuildSettings(guildId);
};

const setWebhookUrl = (guildId, webhookUrl) => {
    db.prepare('UPDATE guild_settings SET webhook_url = ? WHERE guild_id = ?')
        .run(webhookUrl, guildId);
};

const activatePremium = (guildId, licenseKey, premiumUntil) => {
    createGuildSettings(guildId);
    db.prepare('UPDATE guild_settings SET is_premium = 1, license_key = ?, premium_until = ? WHERE guild_id = ?')
        .run(licenseKey, premiumUntil, guildId);
};

const deactivatePremium = (guildId) => {
    db.prepare('UPDATE guild_settings SET is_premium = 0, premium_until = NULL WHERE guild_id = ?')
        .run(guildId);
};

const isPremium = (guildId) => {
    const settings = getGuildSettings(guildId);
    if (!settings || !settings.is_premium) return false;
    if (!settings.premium_until) return true;
    return new Date(settings.premium_until) > new Date();
};

const getGuildByLicenseKey = (licenseKey) => {
    return db.prepare('SELECT * FROM guild_settings WHERE license_key = ?').get(licenseKey);
};

const getGuildLocale = (guildId) => {
    const settings = getGuildSettings(guildId);
    return settings?.locale || 'tr';
};

module.exports = {
    getGuildSettings,
    getGuildByApiKey,
    createGuildSettings,
    setWebhookUrl,
    activatePremium,
    deactivatePremium,
    isPremium,
    getGuildByLicenseKey,
    getGuildLocale,
};
