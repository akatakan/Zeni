const { Events } = require('discord.js');
const { watchMatchEnd } = require('../util/watchmatch');
const { resolveMatch } = require('../util/resolveMatch');
const { loadChampions, scheduleChampionRefresh } = require('../util/championCache');
const { loadAllLocales } = require('../util/i18n');
const betRepository = require('../db/betRepository');
const twitchRepository = require('../db/twitchRepository');
const twitchService = require('../services/twitch');
const { createGuildSettings } = require('../db/guildRepository');
const logger = require('../util/logger');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        logger.info(`Bot hazır: ${client.user.tag}`);

        await loadAllLocales();

        try {
            await loadChampions();
        } catch (err) {
            logger.error('Champion cache yüklenemedi, bot çalışmaya devam ediyor', { error: err.message });
        }
        scheduleChampionRefresh(6);

        // Twitch EventSub abonelikleri yenile (env ayarlıysa)
        if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.PUBLIC_URL) {
            const trackings = await twitchRepository.getAllTrackings();
            twitchService.resubscribeAll(trackings).catch(err =>
                logger.warn('Twitch resubscribe tamamlanamadı', { error: err.message })
            );
        }

        const openMatches = await betRepository.getOpenMatches();
        if (openMatches.length === 0) return;

        logger.info(`${openMatches.length} açık maç bulundu, izleme devam ettiriliyor`);

        for (const match of openMatches) {
            const summoner = { puuid: match.summoner_id };
            const resolveWithClient = (mId, s, r) => resolveMatch(mId, s, r, client);
            watchMatchEnd(match.match_id, summoner, match.region, resolveWithClient, match.started_at)
                .then(async (embed) => {
                    if (!embed || !match.channel_id) return;
                    try {
                        const channel = await client.channels.fetch(match.channel_id);
                        await channel.send({ embeds: [embed] });
                    } catch (err) {
                        console.error(`Kanal bulunamadı (${match.channel_id}):`, err.message);
                    }
                })
                .catch(err => logger.error(`Maç izleme hatası`, { matchId: match.match_id, error: err.message }));
        }
    }
};
