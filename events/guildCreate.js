const { Events } = require('discord.js');
const { createGuildSettings } = require('../db/guildRepository');
const logger = require('../util/logger');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        try {
            await createGuildSettings(guild.id);
            logger.info('Yeni sunucuya katıldı, ayarlar oluşturuldu', { guildId: guild.id, guildName: guild.name });
        } catch (err) {
            logger.error('Guild ayarları oluşturulamadı', { guildId: guild.id, error: err.message });
        }
    }
};
