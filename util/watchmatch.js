const riotApi = require('../services/riot');
const logger = require('./logger');
const timers = new Map();

function getInterval(elapsedMs) {
    const min = elapsedMs / 60_000;
    if (min <  3) return 3 * 60_000;
    if (min < 15) return 2 * 60_000;
    if (min < 25) return 60_000;
    if (min < 40) return 40_000;
    return 25_000;
}

async function watchMatchEnd(matchId, summoner, region, onMatchEnd, startedAt = Date.now()) {
    let nullCount = 0;

    return new Promise((resolve, reject) => {
        const tick = async () => {
            try {
                const isActive = await riotApi.isActiveGame(region, summoner.puuid);
                const elapsed  = Date.now() - startedAt;
                logger.debug('Polling match', { matchId, isActive, elapsedMin: Math.round(elapsed / 60_000) });

                if (!isActive) {
                    nullCount++;
                    if (nullCount < 2) {
                        // tek null güvenilir değil — kısa bekle, tekrar dene
                        timers.set(matchId, setTimeout(tick, 15_000));
                        return;
                    }
                    timers.delete(matchId);
                    const embed = await onMatchEnd(matchId, summoner, region);
                    resolve(embed);
                } else {
                    nullCount = 0;
                    timers.set(matchId, setTimeout(tick, getInterval(elapsed)));
                }
            } catch (error) {
                timers.delete(matchId);
                reject(error);
            }
        };

        const elapsed = Date.now() - startedAt;
        // İlk tick: remake penceresi için en erken 3. dakikada kontrol et
        const firstDelay = Math.max(0, (3 * 60_000) - elapsed);
        timers.set(matchId, setTimeout(tick, firstDelay));
    });
}

async function stopWatchingMatch(matchId) {
    const timer = timers.get(matchId);
    if (timer) {
        clearTimeout(timer);
        timers.delete(matchId);
        logger.info('Maç izleme durduruldu', { matchId });
    }
}

module.exports = { watchMatchEnd, stopWatchingMatch };
