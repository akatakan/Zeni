const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const userRepository = require('../../db/userRepository');
const betRepository = require('../../db/betRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Bahis istatistiklerini göster.')
        .addUserOption(option =>
            option.setName('kullanici')
                .setDescription('İstatistiklerini görmek istediğin kullanıcı (boş bırakırsan kendinkini gösterir).')
                .setRequired(false)),

    async execute(interaction) {
        const t = useT(interaction);
        const target = interaction.options.getUser('kullanici') || interaction.user;

        const user = userRepository.getUserById(target.id);
        if (!user) {
            return interaction.reply({ content: t('stats.not_found'), flags: MessageFlags.Ephemeral });
        }

        const stats = betRepository.getStatsByUserId(target.id);
        if (!stats || stats.total_bets === 0) {
            return interaction.reply({ content: t('stats.no_bets'), flags: MessageFlags.Ephemeral });
        }

        const wr      = Math.round(stats.wins / stats.total_bets * 100);
        const netSign = stats.net_jp >= 0 ? '+' : '';

        const embed = new EmbedBuilder()
            .setAuthor({ name: t('common.bot_name') })
            .setTitle(t('stats.embed.title', { user: target.username }))
            .setColor(COLORS.INFO)
            .addFields(
                { name: t('stats.embed.total_bets'),     value: `${stats.total_bets}`,              inline: true },
                { name: t('stats.embed.wins'),            value: `${stats.wins} (%${wr})`,            inline: true },
                { name: t('stats.embed.losses'),          value: `${stats.losses}`,                   inline: true },
                { name: t('stats.embed.net_jp'),          value: `${netSign}${stats.net_jp} JP`,      inline: true },
                { name: t('stats.embed.total_wagered'),   value: `${stats.total_wagered} JP`,          inline: true },
                { name: t('stats.embed.biggest_bet'),     value: `${stats.biggest_bet} JP`,            inline: true },
                { name: t('stats.embed.current_streak'),  value: `${user.bet_streak}`,                 inline: true },
                { name: t('stats.embed.balance'),         value: `${user.balance} JP`,                 inline: true },
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
