const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const { flagUser, unflagUser, isRisky, getRiskyUsers } = require('../../db/riskRepository');
const { getReportsByUser } = require('../../db/reportRepository');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('risk')
        .setDescription('Riskli kullanıcı yönetimi.')
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Kullanıcıyı riskli grubuna ekle.')
            .addUserOption(opt => opt.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
            .addStringOption(opt => opt.setName('sebep').setDescription('Sebep').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Kullanıcıyı riskli grubundan çıkar.')
            .addUserOption(opt => opt.setName('kullanici').setDescription('Kullanıcı').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Riskli kullanıcıları listele.'))
        .addSubcommand(sub => sub
            .setName('reports')
            .setDescription('Bir kullanıcıya gelen raporları görüntüle.')
            .addUserOption(opt => opt.setName('kullanici').setDescription('Kullanıcı').setRequired(true))),

    async execute(interaction) {
        const t = useT(interaction);

        const hasPermission =
            interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers);

        if (!hasPermission) {
            return interaction.reply({ content: t('risk.no_permission'), flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const target = interaction.options.getUser('kullanici');
            const reason = interaction.options.getString('sebep') || 'Manuel';
            await flagUser(interaction.guildId, target.id, reason, interaction.user.id);
            return interaction.reply({
                content: t('risk.flagged', { user: `<@${target.id}>` }),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'remove') {
            const target = interaction.options.getUser('kullanici');
            if (!await isRisky(interaction.guildId, target.id)) {
                return interaction.reply({
                    content: t('risk.not_flagged', { user: `<@${target.id}>` }),
                    flags: MessageFlags.Ephemeral,
                });
            }
            await unflagUser(interaction.guildId, target.id);
            return interaction.reply({
                content: t('risk.unflagged', { user: `<@${target.id}>` }),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'list') {
            const riskyUsers = await getRiskyUsers(interaction.guildId);
            if (riskyUsers.length === 0) {
                return interaction.reply({ content: t('risk.list_empty'), flags: MessageFlags.Ephemeral });
            }

            const rows = riskyUsers.map(r => {
                const date = new Date(r.flagged_at).toLocaleDateString('tr-TR');
                const by = r.flagged_by ? `<@${r.flagged_by}>` : 'Otomatik';
                return `<@${r.user_id}> — ${r.reason || '—'} (${by}, ${date})`;
            });

            const embed = new EmbedBuilder()
                .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
                .setTitle(t('risk.embed.title'))
                .setDescription(rows.join('\n'))
                .setColor(COLORS.DANGER || 0xFF0000)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (sub === 'reports') {
            const target = interaction.options.getUser('kullanici');
            const reports = await getReportsByUser(interaction.guildId, target.id);

            if (reports.length === 0) {
                return interaction.reply({
                    content: t('risk.no_reports', { user: `<@${target.id}>` }),
                    flags: MessageFlags.Ephemeral,
                });
            }

            const rows = reports.map(r => {
                const date = new Date(r.created_at).toLocaleDateString('tr-TR');
                const matchInfo = r.match_id ? ` | Maç: \`${r.match_id}\`` : '';
                return `<@${r.reporter_id}> — ${r.reason || '—'}${matchInfo} (${date})`;
            });

            const embed = new EmbedBuilder()
                .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
                .setTitle(t('risk.embed.reports_title', { user: target.username }))
                .setDescription(rows.join('\n'))
                .setColor(COLORS.WARNING || 0xFFA500)
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    },
};
