const { EmbedBuilder } = require('discord.js');
const { t } = require('./i18n');
const COLORS = require('./colors');
const riotApi = require('../services/riot');
const betRepository = require('../db/betRepository');
const userRepository = require('../db/userRepository');
const tournamentRepository = require('../db/tournamentRepository');
const sideBetRepository = require('../db/sideBetRepository');
const logger = require('./logger');

function getStreakBonus(streak) {
    if (streak === 3)                      return 100;
    if (streak === 5)                      return 250;
    if (streak >= 10 && streak % 5 === 0) return 500;
    return 0;
}

// Pari-mutuel veya sabit 2x hesabı
function calcPayout(betAmount, allBets, matchResult, mode) {
    if (mode !== 'pool') return betAmount * 2;

    const totalPool = allBets.reduce((sum, b) => sum + b.amount, 0);
    const winPool   = allBets.filter(b => b.prediction === matchResult).reduce((sum, b) => sum + b.amount, 0);
    if (winPool === 0) return betAmount; // teorik edge case
    return Math.floor((betAmount / winPool) * totalPool);
}

async function sendDM(client, userId, content) {
    if (!client) return;
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
    } catch (_) {}
}

async function checkAnomaly(client, channelId, userId) {
    const stats = await betRepository.getStatsByUserId(userId);
    if (!stats || stats.total_bets < 15) return;
    const winRate = stats.wins / stats.total_bets;
    if (winRate < 0.85) return;

    logger.warn('Yüksek kazanma oranı tespit edildi', {
        userId, wins: stats.wins, total: stats.total_bets, rate: Math.round(winRate * 100),
    });

    if (!client || !channelId) return;
    try {
        const channel = await client.channels.fetch(channelId);
        await channel.send(t('resolve.anomaly_warning', {
            user: `<@${userId}>`, total: stats.total_bets, rate: Math.round(winRate * 100),
        }));
    } catch (_) {}
}

async function resolveMatch(matchId, summoner, region, client) {
    logger.info('Maç bitti, bahisler işleniyor', { matchId });
    await riotApi.delay(30000);

    const matchBets = await betRepository.getBetsByMatchId(matchId);
    const match     = await betRepository.getMatchBetById(matchId);

    if (!matchBets || matchBets.length === 0) {
        logger.info('Maça ait bahis bulunamadı', { matchId });
        await betRepository.deleteMatchBets(matchId);
        return null;
    }

    const sideBetResults = await riotApi.getSideBetResults(matchId, region);
    const matchResult = await riotApi.getMatchEndResult(matchId, summoner, region);
    if (!matchResult) {
        logger.error('Maç sonucu alınamadı, bahisler iade ediliyor', { matchId });
        for (const b of matchBets) {
            if (b.tournament_id) {
                await tournamentRepository.addTournamentBalance(b.tournament_id, b.user_id, b.amount);
            } else {
                await userRepository.addUserBalance(b.user_id, b.amount);
            }
            await sendDM(client, b.user_id, t('resolve.dm.refund', { matchId, amount: b.amount }));
        }

        const sideBets = await sideBetRepository.getSideBetsByMatch(matchId);
        for (const sb of sideBets) await userRepository.addUserBalance(sb.user_id, sb.amount);

        await betRepository.deleteMatchBets(matchId);
        return null;
    }

    const winners = matchBets.filter(b => b.prediction === matchResult);
    const losers  = matchBets.filter(b => b.prediction !== matchResult);
    const mode    = match?.mode || 'classic';
    logger.info('Maç sonuçlandı', { matchId, result: matchResult, mode, winners: winners.length });

    await betRepository.markBetResult(matchId, matchResult);
    await betRepository.closeMatchBet(matchId);

    // Kazananlara ödeme
    for (const winner of winners) {
        const payout = calcPayout(winner.amount, matchBets, matchResult, mode);

        if (winner.tournament_id) {
            await tournamentRepository.addTournamentBalance(winner.tournament_id, winner.user_id, payout);
            // Eleme kontrolü: eğer turnuvada sadece 1 kişi kaldıysa otomatik bitir
            const activeCount = await tournamentRepository.getActiveParticipantCount(winner.tournament_id);
            if (activeCount <= 1) {
                logger.info('Turnuvada son kişi kaldı, turnuva bitiyor', { tournamentId: winner.tournament_id });
            }
        } else {
            await userRepository.addUserBalance(winner.user_id, payout);
            const newStreak = await userRepository.incrementStreak(winner.user_id);
            const bonus = getStreakBonus(newStreak);
            if (bonus > 0) await userRepository.addUserBalance(winner.user_id, bonus);

            let dmContent = t('resolve.dm.won', { matchId, amount: payout });
            if (bonus > 0) dmContent += t('resolve.dm.streak_bonus', { streak: newStreak, bonus });
            await sendDM(client, winner.user_id, dmContent);

            await checkAnomaly(client, match?.channel_id, winner.user_id);
        }
    }

    // Kaybedenlere seri sıfırlama + eleme kontrolü
    for (const loser of losers) {
        if (loser.tournament_id) {
            // Turnuva bakiyesi zaten deduct edilmişti; 0'a düştü mü kontrol et
            const participant = await tournamentRepository.getParticipant(loser.tournament_id, loser.user_id);
            if (participant && participant.tournament_balance <= 0) {
                await tournamentRepository.eliminateParticipant(loser.tournament_id, loser.user_id);
                await sendDM(client, loser.user_id, t('tournament.dm.eliminated'));
            }
        } else {
            await userRepository.resetStreak(loser.user_id);
            await sendDM(client, loser.user_id, t('resolve.dm.lost', { matchId, amount: loser.amount }));
        }
    }

    // Side bet çözümü + combo takibi
    if (sideBetResults) {
        const sideBets = await sideBetRepository.getSideBetsByMatch(matchId);
        if (sideBets.length > 0) {
            await sideBetRepository.markSideBetResults(matchId, sideBetResults.firstBlood, sideBetResults.firstTower);

            // Kullanıcı başına combo verisi: { correctCount, totalWagered }
            const comboMap = new Map();

            // Main bet kazananlarını combo map'e ekle
            for (const w of winners) {
                if (!w.tournament_id) {
                    comboMap.set(w.user_id, { correctCount: 1, totalWagered: w.amount });
                }
            }

            for (const sb of sideBets) {
                const isWin = (sb.event_type === 'first_blood' && sb.prediction === sideBetResults.firstBlood) ||
                              (sb.event_type === 'first_tower'  && sb.prediction === sideBetResults.firstTower);

                const payout = isWin ? Math.floor(sb.amount * 2.5) : 0;
                if (payout > 0) await userRepository.addUserBalance(sb.user_id, payout);

                const eventKey = sb.event_type === 'first_blood' ? 'side_bet.event_blood' : 'side_bet.event_tower';
                if (isWin) {
                    await sendDM(client, sb.user_id, t('side_bet.dm.won', { event: t(eventKey), amount: payout, wagered: sb.amount, profit: payout - sb.amount }));
                } else {
                    await sendDM(client, sb.user_id, t('side_bet.dm.lost', { event: t(eventKey), amount: sb.amount }));
                }

                // Combo takibi
                const entry = comboMap.get(sb.user_id) || { correctCount: 0, totalWagered: 0 };
                if (isWin) entry.correctCount++;
                entry.totalWagered += sb.amount;
                comboMap.set(sb.user_id, entry);
            }

            // Combo bonusu uygula
            for (const [userId, { correctCount, totalWagered }] of comboMap) {
                if (correctCount < 2) continue;
                const bonusPct = correctCount === 3 ? 0.75 : 0.25;
                const comboBonus = Math.floor(totalWagered * bonusPct);
                if (comboBonus <= 0) continue;
                await userRepository.addUserBalance(userId, comboBonus);
                await sendDM(client, userId, t('side_bet.dm.combo', { count: correctCount, bonus: comboBonus }));
            }
        }
    }

    // Topluluk özeti
    const totalPool = matchBets.reduce((sum, b) => sum + b.amount, 0);
    const winBets   = matchBets.filter(b => b.prediction === 'win');
    const loseBets  = matchBets.filter(b => b.prediction === 'lose');
    const winPool   = winBets.reduce((sum, b) => sum + b.amount, 0);
    const losePool  = loseBets.reduce((sum, b) => sum + b.amount, 0);
    const accuracy  = Math.round((winners.length / matchBets.length) * 100);

    const winnersValue = winners.length > 0
        ? winners.map(w => {
            const payout = calcPayout(w.amount, matchBets, matchResult, mode);
            return `<@${w.user_id}>: ${w.amount} JP → **${payout} JP**`;
          }).join('\n')
        : t('resolve.embed.no_winners');

    return new EmbedBuilder()
        .setAuthor({ name: t('common.bot_name'), iconURL: client?.user?.displayAvatarURL() })
        .setTitle(t('resolve.embed.title'))
        .setDescription(t(matchResult === 'win' ? 'resolve.embed.result_win' : 'resolve.embed.result_lose'))
        .setColor(winners.length > 0 ? COLORS.SUCCESS : COLORS.ERROR)
        .addFields(
            { name: t('resolve.embed.winners'),      value: winnersValue,                                    inline: false },
            { name: t('resolve.embed.participants'), value: `${matchBets.length} kişi`,                     inline: true },
            { name: t('resolve.embed.total_pool'),   value: `${totalPool} JP`,                              inline: true },
            { name: t('resolve.embed.accuracy'),     value: `%${accuracy}`,                                 inline: true },
            { name: t('resolve.embed.win_side'),     value: `${winBets.length} kişi • ${winPool} JP`,       inline: true },
            { name: t('resolve.embed.lose_side'),    value: `${loseBets.length} kişi • ${losePool} JP`,     inline: true },
        )
        .setFooter({ text: t('common.bot_name') })
        .setTimestamp();
}

module.exports = { resolveMatch };
