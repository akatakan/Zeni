const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { useT } = require('../../util/i18n');
const followRepository = require('../../db/followRepository');
const userRepository = require('../../db/userRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('follow')
        .setDescription('Bir kullanıcının bahislerini otomatik olarak kopyala.')
        .addUserOption(opt =>
            opt.setName('kullanici').setDescription('Takip etmek istediğin kullanıcı.').setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('miktar').setDescription('Her kopya bahiste yatırılacak JP miktarı.').setMinValue(50).setRequired(true)),

    async execute(interaction) {
        const t = useT(interaction);
        const target = interaction.options.getUser('kullanici');
        const amount = interaction.options.getInteger('miktar');

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: t('follow.self'), flags: MessageFlags.Ephemeral });
        }
        if (target.bot) {
            return interaction.reply({ content: t('follow.bot'), flags: MessageFlags.Ephemeral });
        }

        // Takip edilecek kişinin kayıtlı olup olmadığını kontrol et
        const targetUser = await userRepository.getUserById(target.id);
        if (!targetUser) {
            return interaction.reply({ content: t('follow.target_not_found'), flags: MessageFlags.Ephemeral });
        }

        const wasAlready = await followRepository.isFollowing(interaction.user.id, target.id);
        await followRepository.follow(interaction.user.id, target.id, amount);

        const msg = wasAlready
            ? t('follow.updated', { user: `<@${target.id}>`, amount })
            : t('follow.success', { user: `<@${target.id}>`, amount });

        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    },
};
