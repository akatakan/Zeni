const { EmbedBuilder } = require('discord.js');
const { t } = require('./i18n');
const COLORS = require('./colors');
const riotApi = require('../services/riot');
const betRepository = require('../db/betRepository');
const userRepository = require('../db/userRepository');
const tournamentRepository = require('../db/tournamentRepository');
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
    const stats = betRepository.getStatsByUserId(userId);
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

    const matchBets = betRepository.getBetsByMatchId(matchId);
    const match     = betRepository.getMatchBetById(matchId);

    if (!matchBets || matchBets.length === 0) {
        logger.info('Maça ait bahis bulunamadı', { matchId });
        betRepository.deleteMatchBets(matchId);
        return null;
    }

    const matchResult = await riotApi.getMatchEndResult(matchId, summoner, region);
    if (!matchResult) {
        logger.error('Maç sonucu alınamadı, bahisler iade ediliyor', { matchId });
        for (const b of matchBets) {
            if (b.tournament_id) {
                tournamentRepository.addTournamentBalance(b.tournament_id, b.user_id, b.amount);
            } else {
                userRepository.addUserBalance(b.user_id, b.amount);
            }
            await sendDM(client, b.user_id, t('resolve.dm.refund', { matchId, amount: b.amount }));
        }
        betRepository.deleteMatchBets(matchId);
        return null;
    }

    const winners = matchBets.filter(b => b.prediction === matchResult);
    const losers  = matchBets.filter(b => b.prediction !== matchResult);
    const mode    = match?.mode || 'classic';
    logger.info('Maç sonuçlandı', { matchId, result: matchResult, mode, winners: winners.length });

    betRepository.markBetResult(matchId, matchResult);
    betRepository.closeMatchBet(matchId);

    // Kazananlara ödeme
    for (const winner of winners) {
        const payout = calcPayout(winner.amount, matchBets, matchResult, mode);

        if (winner.tournament_id) {
            tournamentRepository.addTournamentBalance(winner.tournament_id, winner.user_id, payout);
            // Eleme kontrolü: eğer turnuvada sadece 1 kişi kaldıysa otomatik bitir
            const activeCount = tournamentRepository.getActiveParticipantCount(winner.tournament_id);
            if (activeCount <= 1) {
                logger.info('Turnuvada son kişi kaldı, turnuva bitiyor', { tournamentId: winner.tournament_id });
            }
        } else {
            userRepository.addUserBalance(winner.user_id, payout);
            const newStreak = userRepository.incrementStreak(winner.user_id);
            const bonus = getStreakBonus(newStreak);
            if (bonus > 0) userRepository.addUserBalance(winner.user_id, bonus);

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
            const participant = tournamentRepository.getParticipant(loser.tournament_id, loser.user_id);
            if (participant && participant.tournament_balance <= 0) {
                tournamentRepository.eliminateParticipant(loser.tournament_id, loser.user_id);
                await sendDM(client, loser.user_id, t('tournament.dm.eliminated'));
            }
        } else {
            userRepository.resetStreak(loser.user_id);
            await sendDM(client, loser.user_id, t('resolve.dm.lost', { matchId, amount: loser.amount }));
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
