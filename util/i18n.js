const { pool } = require('../db/db');

const locales = {
    tr: require('../locales/tr.json'),
};

// Guild locale in-memory cache — startup'ta doldurulur, değişince güncellenir
const localeCache = new Map();

function t(key, vars = {}, locale = 'tr') {
    const strings = locales[locale] || locales.tr;
    const value = key.split('.').reduce((obj, k) => obj?.[k], strings);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

// Tüm guild locale'lerini DB'den yükle (ready.js'de çağrılır)
async function loadAllLocales() {
    const res = await pool.query('SELECT guild_id, locale FROM guild_settings');
    for (const row of res.rows) {
        localeCache.set(row.guild_id, row.locale || 'tr');
    }
}

// Tek guild locale'ini güncelle (guild ayarı değişince çağrılır)
function setLocaleCache(guildId, locale) {
    localeCache.set(guildId, locale || 'tr');
}

function useT(interaction) {
    const locale = localeCache.get(interaction.guildId) || 'tr';
    return (key, vars = {}) => t(key, vars, locale);
}

module.exports = { t, useT, loadAllLocales, setLocaleCache };
