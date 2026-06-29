const axios = require('axios');
require('dotenv').config();

const RIOT_API_KEY = process.env.RIOT_API_KEY;

class RiotAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this._queue = Promise.resolve();
        this._lastDispatch = 0;
        // 100 req/2min = 0.83 req/s; 1.2s gap → ~50 req/min, burst limitinin de altında
        this.MIN_INTERVAL = 1200;
    }

    // Tüm Riot isteklerini seri kuyruğa alır; ardışık istekler arası en az MIN_INTERVAL ms bekler.
    // Chain'in bozulmaması için reject caller'a yansır ama this._queue hep resolved kalır.
    _enqueue(fn) {
        const step = this._queue.then(async () => {
            const gap = this.MIN_INTERVAL - (Date.now() - this._lastDispatch);
            if (gap > 0) await this.delay(gap);
            this._lastDispatch = Date.now();
            return fn();
        });
        this._queue = step.catch(() => {});
        return step;
    }

    async request({ baseURL, url, method = 'GET', params }) {
        return this._enqueue(() => this._dispatch({ baseURL, url, method, params }));
    }

    async _dispatch({ baseURL, url, method, params }) {
        try {
            const response = await axios({
                method, baseURL, url, params,
                headers: { 'X-Riot-Token': this.apiKey },
            });
            return response.status === 204 ? null : response.data;
        } catch (error) {
            if (error.response?.status === 429) {
                const retryAfter = parseInt(error.response.headers['retry-after'] || '1', 10);
                console.warn(`Rate limited. ${retryAfter}s bekleniyor.`);
                await this.delay(retryAfter * 1000);
                return this._dispatch({ baseURL, url, method, params });
            }
            return null;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    regionToCluster(region) {
        const clusterMap = {
            NA: 'americas', BR: 'americas', LAN: 'americas', LAS: 'americas',
            EUW: 'europe', EUNE: 'europe', TR: 'europe', RU: 'europe',
            KR: 'asia', JP: 'asia',
        };
        return clusterMap[region] || 'europe';
    }

    regionToPrefix(region) {
        const map = {
            NA: 'na1', EUW: 'euw1', EUNE: 'eun1',
            KR: 'kr', TR: 'tr1', JP: 'jp1',
            BR: 'br1', LAN: 'la1', LAS: 'la2',
        };
        return map[region] || 'euw1';
    }

    async getAccountBySummonerName(summonerName, tagline) {
        console.log(`Fetching account for ${summonerName}#${tagline}`);
        return this.request({
            baseURL: 'https://europe.api.riotgames.com',
            url: `/riot/account/v1/accounts/by-riot-id/${summonerName}/${tagline}`,
        });
    }

    async getActiveGameBySummonerId(region, summonerId) {
        return this.request({
            baseURL: `https://${this.regionToPrefix(region)}.api.riotgames.com`,
            url: `/lol/spectator/v5/active-games/by-summoner/${summonerId}`,
        });
    }

    async getRankByPuuid(puuid, region) {
        return this.request({
            baseURL: `https://${this.regionToPrefix(region)}.api.riotgames.com`,
            url: `/lol/league/v4/entries/by-puuid/${puuid}`,
        });
    }

    async getMatchesByPuuid(puuid) {
        return this.request({
            baseURL: 'https://europe.api.riotgames.com',
            url: `/lol/match/v5/matches/by-puuid/${puuid}/ids`,
            params: { count: 1 },
        });
    }

    async getMatchById(matchId, region) {
        const cluster = this.regionToCluster(region);
        return this.request({
            baseURL: `https://${cluster}.api.riotgames.com`,
            url: `/lol/match/v5/matches/${matchId}`,
        });
    }

    async getSideBetResults(matchId, region) {
        const match = await this.getMatchById(matchId, region);
        if (!match) return null;

        const firstBloodParticipant = match.info.participants.find(p => p.firstBloodKill);
        const firstBloodTeam = firstBloodParticipant
            ? (firstBloodParticipant.teamId === 100 ? 'blue' : 'red')
            : null;

        const blueTeam = match.info.teams.find(t => t.teamId === 100);
        const firstTowerTeam = blueTeam?.objectives?.tower?.first ? 'blue' : 'red';

        return { firstBlood: firstBloodTeam, firstTower: firstTowerTeam };
    }

    async isActiveGame(region, puuid) {
        const game = await this.getActiveGameBySummonerId(region, puuid);
        return game !== null;
    }

    async getMatchEndResult(matchId, summoner, region) {
        const match = await this.getMatchById(matchId, region);
        if (!match) return null;
        const participant = match.info.participants.find(p => p.puuid === summoner.puuid);
        if (!participant) return null;
        return participant.win ? 'win' : 'lose';
    }
}

module.exports = new RiotAPI(RIOT_API_KEY);
