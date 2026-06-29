const { Events, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { useT } = require('../util/i18n');
const logger = require('../util/logger');
const userRepository = require('../db/userRepository');
const betRepository = require('../db/betRepository');
const followRepository = require('../db/followRepository');
const tournamentRepository = require('../db/tournamentRepository');
const { stopWatchingMatch } = require('../util/watchmatch');
const { isRisky } = require('../db/riskRepository');
const sideBetRepository = require('../db/sideBetRepository');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (interaction.isChatInputCommand())  return handleCommand(interaction);
        if (interaction.isButton())            return handleButton(interaction);
        if (interaction.isStringSelectMenu())  return handleSelect(interaction);
        if (interaction.isModalSubmit())       return handleModal(interaction);
    }
};

// ─── Slash komutları ────────────────────────────────────────────────────────

async function handleCommand(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.error('Komut hatası', { command: interaction.commandName, error: error.message });
        const t = useT(interaction);
        const msg = t('common.command_error');
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
    }
}

// ─── Buton etkileşimleri ────────────────────────────────────────────────────

async function handleButton(interaction) {
    const t = useT(interaction);
    const { customId } = interaction;

    if (customId.startsWith('placeBet-')) {
        const parts = customId.split('-');
        if (parts.length !== 3) {
            return interaction.reply({ content: t('button.invalid'), flags: MessageFlags.Ephemeral });
        }
        const matchId = parts[1];
        const minBetAmount = parseInt(parts[2], 10);
        if (isNaN(minBetAmount) || minBetAmount <= 0) {
            return interaction.reply({ content: t('button.invalid_amount'), flags: MessageFlags.Ephemeral });
        }

        if (await isRisky(interaction.guildId, interaction.user.id)) {
            return interaction.reply({ content: t('risk.blocked'), flags: MessageFlags.Ephemeral });
        }

        let user = await userRepository.getUserById(interaction.user.id);
        if (!user) {
            await userRepository.addUser(interaction.user.id, interaction.user.username);
            user = await userRepository.getUserById(interaction.user.id);
        }
        if (user.balance < minBetAmount) {
            return interaction.reply({ content: t('button.insufficient_balance', { min: minBetAmount }), flags: MessageFlags.Ephemeral });
        }
        if (await betRepository.hasActiveBet(interaction.user.id, matchId)) {
            return interaction.reply({ content: t('button.already_bet'), flags: MessageFlags.Ephemeral });
        }

        const match = await betRepository.getMatchBetById(matchId);
        if (!match) {
            return interaction.reply({ content: t('button.match_not_found'), flags: MessageFlags.Ephemeral });
        }
        const elapsedMs = Date.now() - match.started_at;
        if (elapsedMs > 5 * 60 * 1000) {
            return interaction.reply({ content: t('button.time_expired'), flags: MessageFlags.Ephemeral });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`betSelect-${matchId}-${minBetAmount}-${interaction.message.id}`)
            .setPlaceholder(t('bet.select_placeholder'))
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel(t('bet.select_win')).setValue('win'),
                new StringSelectMenuOptionBuilder().setLabel(t('bet.select_lose')).setValue('lose'),
            );

        await interaction.reply({
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (customId.startsWith('sideBet-')) {
        const parts = customId.split('-');
        // sideBet-{matchId}-{minBetAmount}-{eventType}  (eventType may contain '_')
        if (parts.length < 4) {
            return interaction.reply({ content: t('button.invalid'), flags: MessageFlags.Ephemeral });
        }
        const matchId     = parts[1];
        const minBetAmount = parseInt(parts[2], 10);
        const eventType   = parts.slice(3).join('-'); // 'first_blood' or 'first_tower'

        if (await isRisky(interaction.guildId, interaction.user.id)) {
            return interaction.reply({ content: t('risk.blocked'), flags: MessageFlags.Ephemeral });
        }

        const match = await betRepository.getMatchBetById(matchId);
        if (!match) {
            return interaction.reply({ content: t('button.match_not_found'), flags: MessageFlags.Ephemeral });
        }
        if (Date.now() - match.started_at > 5 * 60 * 1000) {
            return interaction.reply({ content: t('button.time_expired'), flags: MessageFlags.Ephemeral });
        }
        if (await sideBetRepository.hasSideBet(matchId, interaction.user.id, eventType)) {
            return interaction.reply({ content: t('side_bet.already_bet'), flags: MessageFlags.Ephemeral });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`sideBetSelect-${matchId}-${minBetAmount}-${eventType}-${interaction.message.id}`)
            .setPlaceholder(t('side_bet.select_placeholder'))
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel(t('side_bet.team_blue')).setValue('blue'),
                new StringSelectMenuOptionBuilder().setLabel(t('side_bet.team_red')).setValue('red'),
            );

        await interaction.reply({
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (customId.startsWith('quitBet-')) {
        const parts = customId.split('-');
        if (parts.length !== 3) {
            return interaction.reply({ content: t('button.invalid'), flags: MessageFlags.Ephemeral });
        }
        const matchId = parts[1];
        const userId  = parts[2];

        if (interaction.user.id !== userId) {
            return interaction.reply({ content: t('button.no_permission'), flags: MessageFlags.Ephemeral });
        }

        const bets = await betRepository.getBetsByMatchId(matchId);
        for (const bet of bets) await userRepository.addUserBalance(bet.user_id, bet.amount);

        const sideBets = await sideBetRepository.getSideBetsByMatch(matchId);
        for (const sb of sideBets) await userRepository.addUserBalance(sb.user_id, sb.amount);

        await betRepository.closeMatchBet(matchId);
        await betRepository.deleteMatchBets(matchId);
        await betRepository.deleteBets(matchId);
        await stopWatchingMatch(matchId);
        await interaction.reply({ content: t('button.cancelled'), flags: MessageFlags.Ephemeral });
        interaction.message.delete();
    }
}

// ─── Select menu etkileşimleri ───────────────────────────────────────────────

async function handleSelect(interaction) {
    const t = useT(interaction);
    const { customId } = interaction;
    const prediction = interaction.values[0];

    if (customId.startsWith('betSelect-')) {
        const parts = customId.split('-');
        if (parts.length !== 4) return interaction.update({ components: [] });
        const matchId      = parts[1];
        const minBetAmount = parts[2];
        const messageId    = parts[3];

        const modal = new ModalBuilder()
            .setCustomId(`betModal-${matchId}-${minBetAmount}-${prediction}-${messageId}`)
            .setTitle(t('bet.embed.title'));

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('betAmountInput')
                    .setLabel(`Bahis Miktarı (Min. ${minBetAmount} JP)`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Bahis miktarınızı girin')
                    .setRequired(true),
            ),
        );
        await interaction.showModal(modal);
    }

    else if (customId.startsWith('sideBetSelect-')) {
        // sideBetSelect-{matchId}-{minBetAmount}-{eventType}-{messageId}
        const parts      = customId.split('-');
        if (parts.length !== 5) return interaction.update({ components: [] });
        const matchId      = parts[1];
        const minBetAmount = parts[2];
        const eventType    = parts[3];
        const messageId    = parts[4];

        const title = eventType === 'first_blood' ? t('side_bet.modal_title_blood') : t('side_bet.modal_title_tower');
        const modal = new ModalBuilder()
            .setCustomId(`sideBetModal-${matchId}-${eventType}-${prediction}-${messageId}`)
            .setTitle(title);

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('sideBetAmount')
                    .setLabel(`Bahis Miktarı (Min. ${minBetAmount} JP)`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Bahis miktarınızı girin')
                    .setRequired(true),
            ),
        );
        await interaction.showModal(modal);
    }
}

// ─── Modal gönderileri ──────────────────────────────────────────────────────

async function handleModal(interaction) {
    const t = useT(interaction);
    const { customId } = interaction;

    if (customId.startsWith('sideBetModal-')) {
        // sideBetModal-{matchId}-{eventType}-{prediction}-{messageId}
        const parts = customId.split('-');
        if (parts.length !== 5) {
            return interaction.reply({ content: t('modal.invalid'), flags: MessageFlags.Ephemeral });
        }
        const matchId    = parts[1];
        const eventType  = parts[2];
        const prediction = parts[3];
        const messageId  = parts[4];

        if (prediction !== 'blue' && prediction !== 'red') {
            return interaction.reply({ content: t('modal.invalid'), flags: MessageFlags.Ephemeral });
        }

        const match = await betRepository.getMatchBetById(matchId);
        if (!match) {
            return interaction.reply({ content: t('button.match_not_found'), flags: MessageFlags.Ephemeral });
        }

        const betAmount = parseInt(interaction.fields.getTextInputValue('sideBetAmount'), 10);
        if (isNaN(betAmount) || betAmount <= 0) {
            return interaction.reply({ content: t('side_bet.invalid_amount'), flags: MessageFlags.Ephemeral });
        }

        const user = await userRepository.getUserById(interaction.user.id);
        if (!user) {
            return interaction.reply({ content: t('modal.user_not_found'), flags: MessageFlags.Ephemeral });
        }

        const deducted = await userRepository.deductBalance(interaction.user.id, betAmount);
        if (deducted === null) {
            return interaction.reply({ content: t('modal.insufficient_balance', { balance: user.balance }), flags: MessageFlags.Ephemeral });
        }

        try {
            await sideBetRepository.addSideBet(matchId, interaction.user.id, eventType, prediction, betAmount);
        } catch (err) {
            await userRepository.addUserBalance(interaction.user.id, betAmount);
            const msg = err.message?.includes('UNIQUE') ? t('side_bet.already_bet') : t('modal.bet_failed');
            return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const channel = await interaction.client.channels.fetch(match.channel_id);
            const originalMsg = await channel.messages.fetch(messageId);
            const sourceEmbed = originalMsg.embeds[0];

            if (sourceEmbed) {
                const allSideBets = await sideBetRepository.getSideBetsByMatch(matchId);
                const bloodBets   = allSideBets.filter(b => b.event_type === 'first_blood');
                const towerBets   = allSideBets.filter(b => b.event_type === 'first_tower');

                const formatSideBets = (bets) => {
                    const blue = bets.filter(b => b.prediction === 'blue').map(b => `<@${b.user_id}>: ${b.amount} JP`).join('\n');
                    const red  = bets.filter(b => b.prediction === 'red').map(b => `<@${b.user_id}>: ${b.amount} JP`).join('\n');
                    return `🔵 ${t('side_bet.team_blue')}:\n${blue || '-'}\n🔴 ${t('side_bet.team_red')}:\n${red || '-'}`;
                };

                const bloodName = t('side_bet.event_blood');
                const towerName = t('side_bet.event_tower');
                const existingFields = sourceEmbed.fields.filter(f => f.name !== bloodName && f.name !== towerName);

                const newFields = [...existingFields];
                if (bloodBets.length > 0) newFields.push({ name: bloodName, value: formatSideBets(bloodBets), inline: false });
                if (towerBets.length > 0) newFields.push({ name: towerName, value: formatSideBets(towerBets), inline: false });

                await originalMsg.edit({ embeds: [EmbedBuilder.from(sourceEmbed).setFields(newFields).setTimestamp()] });
            }
        } catch (_) {}

        await interaction.deleteReply();
        return;
    }

    if (!customId.startsWith('betModal-')) return;

    // betModal-{matchId}-{minBetAmount}-{prediction}-{messageId}
    const parts = customId.split('-');
    if (parts.length !== 5) {
        return interaction.reply({ content: t('modal.invalid'), flags: MessageFlags.Ephemeral });
    }

    const matchId      = parts[1];
    const minBetAmount = parseInt(parts[2], 10);
    const winOrLose    = parts[3];
    const messageId    = parts[4];

    if (isNaN(minBetAmount) || minBetAmount <= 0) {
        return interaction.reply({ content: t('modal.invalid_amount'), flags: MessageFlags.Ephemeral });
    }
    if (winOrLose !== 'win' && winOrLose !== 'lose') {
        return interaction.reply({ content: t('modal.invalid'), flags: MessageFlags.Ephemeral });
    }

    const betAmount = parseInt(interaction.fields.getTextInputValue('betAmountInput'), 10);
    if (isNaN(betAmount) || betAmount < minBetAmount) {
        return interaction.reply({ content: t('modal.invalid_bet', { min: minBetAmount }), flags: MessageFlags.Ephemeral });
    }

    const user = await userRepository.getUserById(interaction.user.id);
    if (!user) {
        return interaction.reply({ content: t('modal.user_not_found'), flags: MessageFlags.Ephemeral });
    }

    // Turnuva katılımı kontrolü — aktif turnuva varsa turnuva bakiyesi kullanılır
    const activeTournament = await tournamentRepository.getActiveTournament(interaction.guildId);
    const inTournament = activeTournament && await tournamentRepository.isParticipant(activeTournament.tournament_id, interaction.user.id);
    const tournamentId = inTournament ? activeTournament.tournament_id : null;

    let deducted;
    if (inTournament) {
        deducted = await tournamentRepository.deductTournamentBalance(tournamentId, interaction.user.id, betAmount);
        if (!deducted) {
            // Bakiye yetersiz — eleme kontrolü
            const participant = await tournamentRepository.getParticipant(tournamentId, interaction.user.id);
            if (participant && participant.tournament_balance <= 0) {
                await tournamentRepository.eliminateParticipant(tournamentId, interaction.user.id);
                return interaction.reply({ content: t('tournament.eliminated'), flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: t('tournament.bet_insufficient'), flags: MessageFlags.Ephemeral });
        }
    } else {
        deducted = await userRepository.deductBalance(interaction.user.id, betAmount);
        if (deducted === null) {
            return interaction.reply({ content: t('modal.insufficient_balance', { balance: user.balance }), flags: MessageFlags.Ephemeral });
        }
    }

    try {
        await betRepository.addBet(matchId, interaction.user.id, betAmount, winOrLose, tournamentId);
    } catch (err) {
        // İade
        if (inTournament) {
            await tournamentRepository.addTournamentBalance(tournamentId, interaction.user.id, betAmount);
        } else {
            await userRepository.addUserBalance(interaction.user.id, betAmount);
        }
        const msg = err.message?.includes('UNIQUE') ? t('modal.already_bet') : t('modal.bet_failed');
        return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    // Copy-bet: sadece normal (turnuva dışı) bahislerde tetiklenir
    if (!inTournament) {
        triggerCopyBets(interaction.client, matchId, interaction.user.id, betAmount, winOrLose, minBetAmount)
            .catch(err => logger.error('Copy-bet hatası', { error: err.message }));
    }

    const bets = await betRepository.getBetsByMatchId(matchId);
    const winBets  = bets.filter(b => b.prediction === 'win').map(b => `<@${b.user_id}>: ${b.amount} JP`);
    const loseBets = bets.filter(b => b.prediction === 'lose').map(b => `<@${b.user_id}>: ${b.amount} JP`);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const match = await betRepository.getMatchBetById(matchId);
        const channel = await interaction.client.channels.fetch(match.channel_id);
        const originalMsg = await channel.messages.fetch(messageId);
        const sourceEmbed = originalMsg.embeds[0];

        if (sourceEmbed) {
            const matchFields = sourceEmbed.fields.slice(0, 5);
            const embed = new EmbedBuilder()
                .setAuthor({ name: t('common.bot_name'), iconURL: interaction.client.user.displayAvatarURL() })
                .setTitle(t('modal.embed.title'))
                .setColor(0xFFD700)
                .setDescription(sourceEmbed.description)
                .addFields(
                    ...matchFields,
                    { name: t('modal.embed.win_bets'),  value: winBets.length  > 0 ? winBets.join('\n')  : t('modal.embed.no_bets'), inline: true },
                    { name: t('modal.embed.lose_bets'), value: loseBets.length > 0 ? loseBets.join('\n') : t('modal.embed.no_bets'), inline: true },
                    { name: t('modal.embed.total'), value: `${bets.reduce((sum, b) => sum + b.amount, 0)} JP`, inline: false },
                )
                .setTimestamp();
            await originalMsg.edit({ embeds: [embed] });
        }
    } catch (_) {}

    await interaction.deleteReply();
}

// ─── Copy-bet tetikleyici ────────────────────────────────────────────────────

async function triggerCopyBets(client, matchId, userId, amount, prediction, minBetAmount) {
    const followers = await followRepository.getFollowers(userId);
    for (const follow of followers) {
        if (follow.amount < minBetAmount) continue;
        if (await betRepository.hasActiveBet(follow.follower_id, matchId)) continue;

        const followerUser = await userRepository.getUserById(follow.follower_id);
        if (!followerUser) continue;

        if (followerUser.balance < follow.amount) {
            try {
                const dUser = await client.users.fetch(follow.follower_id);
                await dUser.send(`❌ Otomatik bahis başarısız: Yeterli bakiyeniz yok. (Gerekli: ${follow.amount} JP, Mevcut: ${followerUser.balance} JP)`);
            } catch (_) {}
            continue;
        }

        const ok = await userRepository.deductBalance(follow.follower_id, follow.amount);
        if (ok === null) continue;

        try {
            await betRepository.addBet(matchId, follow.follower_id, follow.amount, prediction, null);
            try {
                const dUser = await client.users.fetch(follow.follower_id);
                await dUser.send(`✅ Otomatik bahis: <@${userId}> kullanıcısının **${prediction}** tahmini kopyalandı. ${follow.amount} JP yatırıldı.`);
            } catch (_) {}
        } catch (_) {
            await userRepository.addUserBalance(follow.follower_id, follow.amount);
        }
    }
}
