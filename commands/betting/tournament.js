const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { useT } = require('../../util/i18n');
const COLORS = require('../../util/colors');
const tournamentRepository = require('../../db/tournamentRepository');
const userRepository = require('../../db/userRepository');

const PRIZE_SHARES = [0.5, 0.3, 0.2]; // 1., 2., 3. için oran

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tournament')
        .setDescription('Sunucu turnuvası yönetimi.')
        .addSubcommand(sub => sub
            .setName('start')
            .setDescription('Yeni bir turnuva başlat (yönetici).')
            .addIntegerOption(opt =>
                opt.setName('giris_ucreti').setDescription('Giriş ücreti JP (varsayılan: 500)').setMinValue(100).setRequired(false))
            .addIntegerOption(opt =>
                opt.setName('sure').setDescription('Süre (gün, varsayılan: 7)').setMinValue(1).setMaxValue(30).setRequired(false)))
        .addSubcommand(sub => sub
            .setName('join')
            .setDescription('Aktif turnuvaya katıl.'))
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Turnuva sıralamasını göster.'))
        .addSubcommand(sub => sub
            .setName('end')
            .setDescription('Aktif turnuvayı bitir ve ödülleri dağıt (yönetici).')),

    async execute(interaction) {
        const t = useT(interaction);
        const sub = interaction.options.getSubcommand();

        if (sub === 'start') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: t('tournament.no_permission'), flags: MessageFlags.Ephemeral });
            }

            const existing = await tournamentRepository.getActiveTournament(interaction.guildId);
            if (existing) {
                return interaction.reply({ content: t('tournament.already_active'), flags: MessageFlags.Ephemeral });
            }

            const entryFee     = interaction.options.getInteger('giris_ucreti') ?? 500;
            const durationDays = interaction.options.getInteger('sure') ?? 7;
            await tournamentRepository.createTournament(interaction.guildId, entryFee, durationDays);

            return interaction.reply({
                content: t('tournament.started', { fee: entryFee, days: durationDays }),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'join') {
            const tournament = await tournamentRepository.getActiveTournament(interaction.guildId);
            if (!tournament) {
                return interaction.reply({ content: t('tournament.no_active'), flags: MessageFlags.Ephemeral });
            }
            if (await tournamentRepository.hasJoined(tournament.tournament_id, interaction.user.id)) {
                return interaction.reply({ content: t('tournament.already_joined'), flags: MessageFlags.Ephemeral });
            }

            let user = await userRepository.getUserById(interaction.user.id);
            if (!user) {
                await userRepository.addUser(interaction.user.id, interaction.user.username);
                user = await userRepository.getUserById(interaction.user.id);
            }

            const ok = await userRepository.deductBalance(interaction.user.id, tournament.entry_fee);
            if (!ok) {
                return interaction.reply({
                    content: t('tournament.insufficient_balance', { fee: tournament.entry_fee, balance: user.balance }),
                    flags: MessageFlags.Ephemeral,
                });
            }

            await tournamentRepository.joinTournament(tournament.tournament_id, interaction.user.id, tournament.entry_fee);
            return interaction.reply({
                content: t('tournament.joined', { fee: tournament.entry_fee, start: tournament.entry_fee * 3 }),
                flags: MessageFlags.Ephemeral,
            });
        }

        if (sub === 'status') {
            const tournament = await tournamentRepository.getActiveTournament(interaction.guildId);
            if (!tournament) {
                return interaction.reply({ content: t('tournament.no_active'), flags: MessageFlags.Ephemeral });
            }

            const participants = await tournamentRepository.getLeaderboard(tournament.tournament_id);
            if (participants.length === 0) {
                return interaction.reply({ content: t('tournament.no_participants'), flags: MessageFlags.Ephemeral });
            }

            const endsAt = new Date(tournament.ends_at);
            const rows = participants.slice(0, 15).map((p, i) => {
                const status = p.eliminated ? '💀' : `${i + 1}.`;
                return `${status} <@${p.user_id}>: **${p.tournament_balance} JP**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(t('tournament.embed.title'))
                .setDescription(rows)
                .setColor(COLORS.INFO)
                .addFields(
                    { name: t('tournament.embed.prize_pool'), value: `${tournament.prize_pool} JP`, inline: true },
                    { name: t('tournament.embed.entry'),      value: `${tournament.entry_fee} JP`,  inline: true },
                    { name: t('tournament.embed.ends_at'),    value: `<t:${Math.floor(tournament.ends_at / 1000)}:R>`, inline: true },
                )
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'end') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: t('tournament.no_permission'), flags: MessageFlags.Ephemeral });
            }

            const tournament = await tournamentRepository.getActiveTournament(interaction.guildId);
            if (!tournament) {
                return interaction.reply({ content: t('tournament.no_active'), flags: MessageFlags.Ephemeral });
            }

            const participants = (await tournamentRepository.getLeaderboard(tournament.tournament_id))
                .filter(p => !p.eliminated);

            await tournamentRepository.endTournament(tournament.tournament_id);

            if (participants.length === 0) {
                return interaction.reply({ content: t('tournament.ended_no_winners') });
            }

            // Ödül dağıtımı (en fazla 3 kişi)
            const winners = participants.slice(0, 3);
            const prizeParts = [];

            for (let i = 0; i < winners.length; i++) {
                const prize = Math.floor(tournament.prize_pool * (PRIZE_SHARES[i] || 0));
                if (prize > 0) {
                    await userRepository.addUserBalance(winners[i].user_id, prize);
                    prizeParts.push(`${i + 1}. <@${winners[i].user_id}>: +**${prize} JP**`);
                }
            }

            const embed = new EmbedBuilder()
                .setTitle(t('tournament.embed.ended_title'))
                .setDescription(prizeParts.join('\n'))
                .setColor(COLORS.SUCCESS)
                .addFields({ name: t('tournament.embed.total_distributed'), value: `${tournament.prize_pool} JP`, inline: true })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }
    },
};
