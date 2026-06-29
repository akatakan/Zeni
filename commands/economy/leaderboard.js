const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const userRepository = require('../../db/userRepository');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lb')
        .setDescription('En yüksek bakiyeli 10 kullanıcıyı göster.'),

    async execute(interaction) {
        const t = useT(interaction);
        const topUsers = await userRepository.getTopUsers(10);

        if (topUsers.length === 0) {
            return interaction.reply(t('leaderboard.empty'));
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle(t('leaderboard.embed.title'))
            .setDescription(t('leaderboard.embed.description'))
            .addFields(
                { name: t('leaderboard.embed.rank'), value: topUsers.map((_, i) => MEDALS[i] || `${i + 1}.`).join('\n'), inline: true },
                { name: t('leaderboard.embed.user'), value: topUsers.map(u => `<@${u.user_id}>`).join('\n'), inline: true },
                { name: t('leaderboard.embed.balance'), value: topUsers.map(u => u.user_id === '194784929991753728' ? `${u.balance} Çekirge` : `${u.balance} JP`).join('\n'), inline: true }
            )
            .setColor(COLORS.INFO)
            .setFooter({ text: t('leaderboard.embed.footer') });

        await interaction.reply({ embeds: [embed] });
    }
};
