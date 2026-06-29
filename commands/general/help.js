const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Tüm komutların listesini göster.'),

    async execute(interaction) {
        const t = useT(interaction);

        const general = [
            t('help.commands.bet'),
            t('help.commands.lb'),
            t('help.commands.stats'),
            t('help.commands.tournament'),
            t('help.commands.follow'),
            t('help.commands.daily'),
            t('help.commands.give'),
            t('help.commands.ping'),
        ].join('\n');

        const admin = [
            t('help.commands.activate'),
            t('help.commands.apisetup'),
        ].join('\n');

        const embed = new EmbedBuilder()
            .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle(t('help.embed.title'))
            .setDescription(t('help.embed.description'))
            .addFields(
                { name: t('help.embed.general'), value: general },
                { name: t('help.embed.admin'), value: admin },
            )
            .setColor(COLORS.INFO)
            .setFooter({ text: t('help.embed.footer') })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
