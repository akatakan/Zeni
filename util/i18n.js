const { getGuildLocale } = require('../db/guildRepository');

const locales = {
    tr: require('../locales/tr.json'),
};

function t(key, vars = {}, locale = 'tr') {
    const strings = locales[locale] || locales.tr;
    const value = key.split('.').reduce((obj, k) => obj?.[k], strings);
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function useT(interaction) {
    const locale = getGuildLocale(interaction.guildId);
    return (key, vars = {}) => t(key, vars, locale);
}

module.exports = { t, useT };
