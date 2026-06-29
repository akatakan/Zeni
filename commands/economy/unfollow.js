const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { useT } = require('../../util/i18n');
const followRepository = require('../../db/followRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unfollow')
        .setDescription('Bir kullanıcının bahis takibini durdur.')
        .addUserOption(opt =>
            opt.setName('kullanici').setDescription('Takibi bırakmak istediğin kullanıcı.').setRequired(true)),

    async execute(interaction) {
        const t = useT(interaction);
        const target = interaction.options.getUser('kullanici');

        const removed = await followRepository.unfollow(interaction.user.id, target.id);
        if (!removed) {
            return interaction.reply({ content: t('follow.not_following', { user: `<@${target.id}>` }), flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: t('follow.unfollowed', { user: `<@${target.id}>` }), flags: MessageFlags.Ephemeral });
    },
};
