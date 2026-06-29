const { Events, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
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
        if (interaction.isChatInputCommand()) return handleCommand(interaction);
        if (interaction.isButton())          return handleButton(interaction);
        if (interaction.isModalSubmit())     return handleModal(interaction);
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

        if (isRisky(interaction.guildId, interaction.user.id)) {
            return interaction.reply({ content: t('risk.blocked'), flags: MessageFlags.Ephemeral });
        }

        let user = userRepository.getUserById(interaction.user.id);
        if (!user) {
            userRepository.addUser(interaction.user.id, interaction.user.username);
            user = userRepository.getUserById(interaction.user.id);
        }
        if (user.balance < minBetAmount) {
            return interaction.reply({ content: t('button.insufficient_balance', { min: minBetAmount }), flags: MessageFlags.Ephemeral });
        }
        if (betRepository.hasActiveBet(interaction.user.id, matchId)) {
            return interaction.reply({ content: t('button.already_bet'), flags: MessageFlags.Ephemeral });
        }

        const match = betRepository.getMatchBetById(matchId);
        if (!match) {
            return interaction.reply({ content: t('button.match_not_found'), flags: MessageFlags.Ephemeral });
        }
        const elapsedMs = Date.now() - match.started_at;
        if (elapsedMs > 5 * 60 * 1000) {
            return interaction.reply({ content: t('button.time_expired'), flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId(`betModal-${matchId}-${minBetAmount}`)
            .setTitle(t('bet.embed.title'));

        const betAmountInput = new TextInputBuilder()
            .setCustomId('betAmountInput')
            .setLabel(`Bahis Miktarı (Min. ${minBetAmount} JP)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Bahis miktarınızı girin')
            .setRequired(true);

        const winPredictionInput = new TextInputBuilder()
            .setCustomId('winPredictionInput')
            .setLabel('Tahmin: Win ya da Lose')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Win / Lose')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(betAmountInput),
            new ActionRowBuilder().addComponents(winPredictionInput),
        );
        await interaction.showModal(modal);
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

        if (isRisky(interaction.guildId, interaction.user.id)) {
            return interaction.reply({ content: t('risk.blocked'), flags: MessageFlags.Ephemeral });
        }

        const match = betRepository.getMatchBetById(matchId);
        if (!match) {
            return interaction.reply({ content: t('button.match_not_found'), flags: MessageFlags.Ephemeral });
        }
        if (Date.now() - match.started_at > 5 * 60 * 1000) {
            return interaction.reply({ content: t('button.time_expired'), flags: MessageFlags.Ephemeral });
        }
        if (sideBetRepository.hasSideBet(matchId, interaction.user.id, eventType)) {
            return interaction.reply({ content: t('side_bet.already_bet'), flags: MessageFlags.Ephemeral });
        }

        const label = eventType === 'first_blood' ? t('side_bet.modal_title_blood') : t('side_bet.modal_title_tower');
        const modal = new ModalBuilder()
            .setCustomId(`sideBetModal-${matchId}-${eventType}`)
            .setTitle(label);

        const amountInput = new TextInputBuilder()
            .setCustomId('sideBetAmount')
            .setLabel(`Bahis Miktarı (Min. ${minBetAmount} JP)`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Bahis miktarınızı girin')
            .setRequired(true);

        const predictionInput = new TextInputBuilder()
            .setCustomId('sideBetPrediction')
            .setLabel('Tahmin: Mavi veya Kırmızı')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Mavi / Kırmızı')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(amountInput),
            new ActionRowBuilder().addComponents(predictionInput),
        );
        await interaction.showModal(modal);
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

        const bets = betRepository.getBetsByMatchId(matchId);
        bets.forEach(bet => userRepository.addUserBalance(bet.user_id, bet.amount));

        betRepository.closeMatchBet(matchId);
        betRepository.deleteMatchBets(matchId);
        betRepository.deleteBets(matchId);
        await stopWatchingMatch(matchId);
        await interaction.reply({ content: t('button.cancelled'), flags: MessageFlags.Ephemeral });
        interaction.message.delete();
    }
}

// ─── Modal gönderileri ──────────────────────────────────────────────────────

async function handleModal(interaction) {
    const t = useT(interaction);
    const { customId } = interaction;

    if (customId.startsWith('sideBetModal-')) {
        const parts = customId.split('-');
        if (parts.length < 3) {
            return interaction.reply({ content: t('modal.invalid'), flags: MessageFlags.Ephemeral });
        }
        const matchId   = parts[1];
        const eventType = parts.slice(2).join('-');

        const match = betRepository.getMatchBetById(matchId);
        if (!match) {
            return interaction.reply({ content: t('button.match_not_found'), flags: MessageFlags.Ephemeral });
        }

        const betAmount = parseInt(interaction.fields.getTextInputValue('sideBetAmount'), 10);
        if (isNaN(betAmount) || betAmount <= 0) {
            return interaction.reply({ content: t('side_bet.invalid_amount'), flags: MessageFlags.Ephemeral });
        }

        const rawPrediction = interaction.fields.getTextInputValue('sideBetPrediction').toLowerCase().trim();
        const prediction = rawPrediction === 'mavi' || rawPrediction === 'blue' ? 'blue'
                         : rawPrediction === 'kırmızı' || rawPrediction === 'red' ? 'red'
                         : null;
        if (!prediction) {
            return interaction.reply({ content: t('side_bet.invalid_prediction'), flags: MessageFlags.Ephemeral });
        }

        const user = userRepository.getUserById(interaction.user.id);
        if (!user) {
            return interaction.reply({ content: t('modal.user_not_found'), flags: MessageFlags.Ephemeral });
        }

        const deducted = userRepository.deductBalance(interaction.user.id, betAmount);
        if (!deducted) {
            return interaction.reply({ content: t('modal.insufficient_balance', { balance: user.balance }), flags: MessageFlags.Ephemeral });
        }

        try {
            sideBetRepository.addSideBet(matchId, interaction.user.id, eventType, prediction, betAmount);
        } catch (err) {
            userRepository.addUserBalance(interaction.user.id, betAmount);
            const msg = err.message?.includes('UNIQUE') ? t('side_bet.already_bet') : t('modal.bet_failed');
            return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }

        const eventLabel = eventType === 'first_blood' ? t('side_bet.event_blood') : t('side_bet.event_tower');
        const predLabel  = prediction === 'blue' ? t('side_bet.team_blue') : t('side_bet.team_red');
        return interaction.reply({
            content: t('side_bet.success', { event: eventLabel, prediction: predLabel, amount: betAmount }),
            flags: MessageFlags.Ephemeral,
        });
    }

    if (!customId.startsWith('betModal-')) return;

    const parts = customId.split('-');
    if (parts.length !== 3) {
        return interaction.reply({ content: t('modal.invalid'), flags: MessageFlags.Ephemeral });
    }

    const matchId = parts[1];
    const minBetAmount = parseInt(parts[2], 10);
    if (isNaN(minBetAmount) || minBetAmount <= 0) {
        return interaction.reply({ content: t('modal.invalid_amount'), flags: MessageFlags.Ephemeral });
    }

    const betAmount = parseInt(interaction.fields.getTextInputValue('betAmountInput'), 10);
    if (isNaN(betAmount) || betAmount < minBetAmount) {
        return interaction.reply({ content: t('modal.invalid_bet', { min: minBetAmount }), flags: MessageFlags.Ephemeral });
    }

    const winOrLose = interaction.fields.getTextInputValue('winPredictionInput').toLowerCase();
    if (winOrLose !== 'win' && winOrLose !== 'lose') {
        return interaction.reply({ content: t('modal.invalid_prediction'), flags: MessageFlags.Ephemeral });
    }

    const user = userRepository.getUserById(interaction.user.id);
    if (!user) {
        return interaction.reply({ content: t('modal.user_not_found'), flags: MessageFlags.Ephemeral });
    }

    // Turnuva katılımı kontrolü — aktif turnuva varsa turnuva bakiyesi kullanılır
    const activeTournament = tournamentRepository.getActiveTournament(interaction.guildId);
    const inTournament = activeTournament && tournamentRepository.isParticipant(activeTournament.tournament_id, interaction.user.id);
    const tournamentId = inTournament ? activeTournament.tournament_id : null;

    let deducted;
    if (inTournament) {
        deducted = tournamentRepository.deductTournamentBalance(tournamentId, interaction.user.id, betAmount);
        if (!deducted) {
            // Bakiye yetersiz — eleme kontrolü
            const participant = tournamentRepository.getParticipant(tournamentId, interaction.user.id);
            if (participant && participant.tournament_balance <= 0) {
                tournamentRepository.eliminateParticipant(tournamentId, interaction.user.id);
                return interaction.reply({ content: t('tournament.eliminated'), flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: t('tournament.bet_insufficient'), flags: MessageFlags.Ephemeral });
        }
    } else {
        deducted = userRepository.deductBalance(interaction.user.id, betAmount);
        if (!deducted) {
            return interaction.reply({ content: t('modal.insufficient_balance', { balance: user.balance }), flags: MessageFlags.Ephemeral });
        }
    }

    try {
        betRepository.addBet(matchId, interaction.user.id, betAmount, winOrLose, tournamentId);
    } catch (err) {
        // İade
        if (inTournament) {
            tournamentRepository.addTournamentBalance(tournamentId, interaction.user.id, betAmount);
        } else {
            userRepository.addUserBalance(interaction.user.id, betAmount);
        }
        const msg = err.message?.includes('UNIQUE') ? t('modal.already_bet') : t('modal.bet_failed');
        return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }

    // Copy-bet: sadece normal (turnuva dışı) bahislerde tetiklenir
    if (!inTournament) {
        triggerCopyBets(interaction.client, matchId, interaction.user.id, betAmount, winOrLose, minBetAmount)
            .catch(err => logger.error('Copy-bet hatası', { error: err.message }));
    }

    const bets = betRepository.getBetsByMatchId(matchId);
    const winBets  = bets.filter(b => b.prediction === 'win').map(b => `<@${b.user_id}>: ${b.amount} JP`);
    const loseBets = bets.filter(b => b.prediction === 'lose').map(b => `<@${b.user_id}>: ${b.amount} JP`);

    const sourceEmbed = interaction.message.embeds[0];
    if (!sourceEmbed) {
        return interaction.reply({ content: t('common.error'), flags: MessageFlags.Ephemeral });
    }
    const matchFields = sourceEmbed.fields.slice(0, 5);

    const embed = new EmbedBuilder()
        .setAuthor({ name: t('common.bot_name') })
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

    await interaction.update({ embeds: [embed] });
}

// ─── Copy-bet tetikleyici ────────────────────────────────────────────────────

async function triggerCopyBets(client, matchId, userId, amount, prediction, minBetAmount) {
    const followers = followRepository.getFollowers(userId);
    for (const follow of followers) {
        if (follow.amount < minBetAmount) continue;
        if (betRepository.hasActiveBet(follow.follower_id, matchId)) continue;

        const followerUser = userRepository.getUserById(follow.follower_id);
        if (!followerUser) continue;

        if (followerUser.balance < follow.amount) {
            try {
                const dUser = await client.users.fetch(follow.follower_id);
                await dUser.send(`❌ Otomatik bahis başarısız: Yeterli bakiyeniz yok. (Gerekli: ${follow.amount} JP, Mevcut: ${followerUser.balance} JP)`);
            } catch (_) {}
            continue;
        }

        const ok = userRepository.deductBalance(follow.follower_id, follow.amount);
        if (!ok) continue;

        try {
            betRepository.addBet(matchId, follow.follower_id, follow.amount, prediction, null);
            try {
                const dUser = await client.users.fetch(follow.follower_id);
                await dUser.send(`✅ Otomatik bahis: <@${userId}> kullanıcısının **${prediction}** tahmini kopyalandı. ${follow.amount} JP yatırıldı.`);
            } catch (_) {}
        } catch (_) {
            userRepository.addUserBalance(follow.follower_id, follow.amount);
        }
    }
}
