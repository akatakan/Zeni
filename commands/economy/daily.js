const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const userRepository = require('../../db/userRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Günlük bonus JP al.'),

    async execute(interaction) {
        const t = useT(interaction);
        const userId = interaction.user.id;

        let user = await userRepository.getUserById(userId);
        if (!user) {
            await userRepository.addUser(userId, interaction.user.username);
        }

        if (!await userRepository.canClaimDaily(userId)) {
            const embed = new EmbedBuilder()
                .setTitle(t('daily.already_claimed.title'))
                .setDescription(t('daily.already_claimed.description'))
                .setColor(COLORS.ERROR)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        const dailyAmount = 200;
        await userRepository.claimDailyBalance(userId, dailyAmount);
        const newBalance = await userRepository.getUserBalance(userId);

        const embed = new EmbedBuilder()
            .setTitle(t('daily.claimed.title'))
            .setDescription(t('daily.claimed.description', { amount: dailyAmount }))
            .addFields({ name: t('daily.claimed.balance_field'), value: `${newBalance} JP`, inline: true })
            .setColor(COLORS.SUCCESS)
            .setFooter({ text: t('daily.claimed.footer') })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
