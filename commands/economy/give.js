const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { useT } = require('../../util/i18n');
const userRepository = require('../../db/userRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('give')
        .setDescription('Başka bir kullanıcıya JP gönder.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('JP göndermek istediğin kullanıcı')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Gönderilecek JP miktarı')
                .setMinValue(1)
                .setRequired(true)),

    async execute(interaction) {
        const t = useT(interaction);
        const target = interaction.options.getUser('target');
        const amount = interaction.options.getInteger('amount');

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: t('give.self_give'), flags: MessageFlags.Ephemeral });
        }

        // Alıcı yoksa oluştur
        if (!await userRepository.getUserById(target.id)) {
            await userRepository.addUser(target.id, target.username);
        }

        // Atomik transfer — race condition'sız
        const success = await userRepository.transferBalance(interaction.user.id, target.id, amount);
        if (!success) {
            return interaction.reply({ content: t('give.insufficient_balance'), flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: t('give.success', { user: `<@${target.id}>`, amount }) });
    },
};
