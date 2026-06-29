const { isPremium } = require('../db/guildRepository');
const { MessageFlags } = require('discord.js');
const { useT } = require('./i18n');

async function requirePremium(interaction) {
    if (isPremium(interaction.guildId)) return true;
    const t = useT(interaction);
    await interaction.reply({
        content: t('premium.required'),
        flags: MessageFlags.Ephemeral,
    });
    return false;
}

module.exports = { requirePremium };
