const crypto = require('crypto');
const { pool } = require('./db');

const getGuildSettings = async (guildId) => {
    const res = await pool.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
    return res.rows[0];
};

const getGuildByApiKey = async (apiKey) => {
    const res = await pool.query('SELECT * FROM guild_settings WHERE api_key = $1', [apiKey]);
    return res.rows[0];
};

const createGuildSettings = async (guildId) => {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    const res = await pool.query(`
        INSERT INTO guild_settings (guild_id, api_key, webhook_secret)
        VALUES ($1, $2, $3)
        ON CONFLICT (guild_id) DO NOTHING
        RETURNING *
    `, [guildId, apiKey, webhookSecret]);
    return res.rows[0] ?? await getGuildSettings(guildId);
};

const setWebhookUrl = async (guildId, webhookUrl) => {
    await pool.query('UPDATE guild_settings SET webhook_url = $1 WHERE guild_id = $2', [webhookUrl, guildId]);
};

const activatePremium = async (guildId, licenseKey, premiumUntil) => {
    await createGuildSettings(guildId);
    await pool.query(
        'UPDATE guild_settings SET is_premium = 1, license_key = $1, premium_until = $2 WHERE guild_id = $3',
        [licenseKey, premiumUntil, guildId]
    );
};

const deactivatePremium = async (guildId) => {
    await pool.query(
        'UPDATE guild_settings SET is_premium = 0, premium_until = NULL WHERE guild_id = $1',
        [guildId]
    );
};

const isPremium = async (guildId) => {
    const settings = await getGuildSettings(guildId);
    if (!settings || !settings.is_premium) return false;
    if (!settings.premium_until) return true;
    return new Date(settings.premium_until) > new Date();
};

const getGuildByLicenseKey = async (licenseKey) => {
    const res = await pool.query('SELECT * FROM guild_settings WHERE license_key = $1', [licenseKey]);
    return res.rows[0];
};

const getGuildLocale = async (guildId) => {
    const res = await pool.query('SELECT locale FROM guild_settings WHERE guild_id = $1', [guildId]);
    return res.rows[0]?.locale || 'tr';
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
