const riotApi = require('../services/riot');
const logger = require('./logger');
const timers = new Map();

async function watchMatchEnd(matchId, summoner, region, onMatchEnd, interval = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const isEnded = await riotApi.isMatchEnd(matchId, region);
        logger.debug(`Polling match`, { matchId, ended: isEnded });
        if (isEnded) {
          clearInterval(timer);
          timers.delete(matchId);
          const embed = await onMatchEnd(matchId, summoner, region);
          resolve(embed);
        }
      } catch (error) {
        clearInterval(timer);
        timers.delete(matchId);
        reject(error);
      }
    }, interval);
    timers.set(matchId, timer);
  });
}

async function stopWatchingMatch(matchId) {
  const timer = timers.get(matchId);
  if (timer) {
    clearInterval(timer);
    timers.delete(matchId);
    logger.info('Maç izleme durduruldu', { matchId });
  }
}

module.exports = { watchMatchEnd, stopWatchingMatch };
