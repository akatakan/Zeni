const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { useT } = require('../../util/i18n');
const { addReport } = require('../../db/reportRepository');
const { getRiskyUsers } = require('../../db/riskRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Şüpheli bir kullanıcıyı yetkililere bildir.')
        .addUserOption(opt => opt.setName('kullanici').setDescription('Raporlanacak kullanıcı').setRequired(true))
        .addStringOption(opt => opt.setName('sebep').setDescription('Raporlama sebebi').setRequired(false))
        .addStringOption(opt => opt.setName('mac_id').setDescription('İlgili maç ID (opsiyonel)').setRequired(false)),

    async execute(interaction) {
        const t = useT(interaction);
        const target = interaction.options.getUser('kullanici');
        const reason = interaction.options.getString('sebep') || null;
        const matchId = interaction.options.getString('mac_id') || null;

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: t('report.self'), flags: MessageFlags.Ephemeral });
        }
        if (target.bot) {
            return interaction.reply({ content: t('report.bot'), flags: MessageFlags.Ephemeral });
        }

        await addReport(interaction.guildId, interaction.user.id, target.id, matchId, reason);

        // Yönetim yetkisine sahip üyelere DM gönder
        try {
            const guild = interaction.guild;
            const members = await guild.members.fetch();
            const admins = members.filter(m =>
                !m.user.bot &&
                (m.permissions.has(PermissionFlagsBits.ManageGuild) || m.permissions.has(PermissionFlagsBits.ModerateMembers))
            );

            const reasonText = reason || '—';
            const matchText = matchId ? ` | Maç: \`${matchId}\`` : '';
            const dmText = t('report.dm_admin', {
                reporter: `${interaction.user.username}`,
                reported: `${target.username}`,
                reason: `${reasonText}${matchText}`,
            });

            for (const [, member] of admins) {
                try { await member.send(dmText); } catch (_) {}
            }
        } catch (_) {}

        return interaction.reply({ content: t('report.success'), flags: MessageFlags.Ephemeral });
    },
};
