jest.mock('axios');
const axios = require('axios');

process.env.RIOT_API_KEY = 'test-api-key';
const riotApi = require('../services/riot');

beforeEach(() => {
    axios.mockReset();
    // Seri queue'yu her test için temiz başlat
    riotApi._lastDispatch = 0;
    riotApi._queue = Promise.resolve();
    jest.restoreAllMocks();
});

function respond(data, status = 200, headers = {}) {
    axios.mockResolvedValueOnce({ status, data, headers });
}
function respondError(status, headers = {}) {
    const err = new Error('HTTP error');
    err.response = { status, headers, data: {} };
    axios.mockRejectedValueOnce(err);
}

// ─── regionToCluster ──────────────────────────────────────────────────────────

describe('regionToCluster', () => {
    test.each([
        ['NA', 'americas'], ['BR', 'americas'], ['LAN', 'americas'], ['LAS', 'americas'],
        ['EUW', 'europe'],  ['EUNE', 'europe'], ['TR', 'europe'],    ['RU', 'europe'],
        ['KR', 'asia'],     ['JP', 'asia'],
    ])('%s → %s', (region, expected) => {
        expect(riotApi.regionToCluster(region)).toBe(expected);
    });

    test('unknown region defaults to europe', () => {
        expect(riotApi.regionToCluster('ZZ')).toBe('europe');
    });
});

// ─── regionToPrefix ───────────────────────────────────────────────────────────

describe('regionToPrefix', () => {
    test.each([
        ['NA', 'na1'], ['EUW', 'euw1'], ['EUNE', 'eun1'],
        ['KR', 'kr'],  ['TR', 'tr1'],   ['JP', 'jp1'],
        ['BR', 'br1'], ['LAN', 'la1'],  ['LAS', 'la2'],
    ])('%s → %s', (region, expected) => {
        expect(riotApi.regionToPrefix(region)).toBe(expected);
    });

    test('unknown region defaults to euw1', () => {
        expect(riotApi.regionToPrefix('ZZ')).toBe('euw1');
    });
});

// ─── request() ───────────────────────────────────────────────────────────────

describe('request', () => {
    test('returns parsed response data on 200', async () => {
        respond({ name: 'Faker' });
        const result = await riotApi.request({ baseURL: 'https://euw1.api.riotgames.com', url: '/test' });
        expect(result).toEqual({ name: 'Faker' });
    });

    test('returns null on HTTP 204 (no content)', async () => {
        axios.mockResolvedValueOnce({ status: 204, data: null, headers: {} });
        const result = await riotApi.request({ baseURL: 'https://euw1.api.riotgames.com', url: '/test' });
        expect(result).toBeNull();
    });

    test('returns null on non-429 HTTP errors (e.g. 404, 403)', async () => {
        respondError(404);
        expect(await riotApi.request({ baseURL: 'https://x', url: '/not-found' })).toBeNull();
    });

    test('sends X-Riot-Token header with the API key', async () => {
        respond({});
        await riotApi.request({ baseURL: 'https://euw1.api.riotgames.com', url: '/test' });
        expect(axios.mock.calls[0][0].headers['X-Riot-Token']).toBe('test-api-key');
    });

    test('retries once after a 429 and returns the retry result', async () => {
        jest.spyOn(riotApi, 'delay').mockResolvedValue();
        respondError(429, { 'retry-after': '2' });
        respond({ ok: true });

        const result = await riotApi.request({ baseURL: 'https://x', url: '/throttled' });
        expect(riotApi.delay).toHaveBeenCalledWith(2000);
        expect(result).toEqual({ ok: true });
    });

    test('defaults Retry-After to 1s when header is absent', async () => {
        jest.spyOn(riotApi, 'delay').mockResolvedValue();
        respondError(429, {});
        respond({});

        await riotApi.request({ baseURL: 'https://x', url: '/t' });
        expect(riotApi.delay).toHaveBeenCalledWith(1000);
    });
});

// ─── queue (seri istek kuyruğu) ───────────────────────────────────────────────

describe('queue', () => {
    test('_lastDispatch is updated after a successful request', async () => {
        respond({});
        const before = Date.now();
        await riotApi.request({ baseURL: 'https://x', url: '/test' });
        expect(riotApi._lastDispatch).toBeGreaterThanOrEqual(before);
    });

    test('calls delay when last dispatch was within MIN_INTERVAL', async () => {
        jest.spyOn(riotApi, 'delay').mockResolvedValue();
        riotApi._lastDispatch = Date.now(); // sanki az önce bir istek gönderildi
        respond({});
        await riotApi.request({ baseURL: 'https://x', url: '/test' });

        // delay en az bir kez pozitif bir değerle çağrılmış olmalı (MIN_INTERVAL gap)
        const gapCall = riotApi.delay.mock.calls.find(([ms]) => ms > 0);
        expect(gapCall).toBeDefined();
        expect(gapCall[0]).toBeLessThanOrEqual(riotApi.MIN_INTERVAL);
    });

    test('skips delay when last dispatch was long ago', async () => {
        jest.spyOn(riotApi, 'delay').mockResolvedValue();
        riotApi._lastDispatch = 0; // çok eski → gap negatif → bekleme yok
        respond({});
        await riotApi.request({ baseURL: 'https://x', url: '/test' });
        expect(riotApi.delay).not.toHaveBeenCalled();
    });

    test('serializes concurrent requests — second starts after first finishes', async () => {
        const order = [];
        axios
            .mockImplementationOnce(async () => {
                order.push('req1-start');
                await Promise.resolve(); // microtask yield
                order.push('req1-end');
                return { status: 200, data: 'a', headers: {} };
            })
            .mockImplementationOnce(async () => {
                order.push('req2-start');
                return { status: 200, data: 'b', headers: {} };
            });

        jest.spyOn(riotApi, 'delay').mockResolvedValue(); // MIN_INTERVAL beklemesini atla

        await Promise.all([
            riotApi.request({ baseURL: 'https://x', url: '/r1' }),
            riotApi.request({ baseURL: 'https://x', url: '/r2' }),
        ]);

        // İkinci istek, birincinin bitişinden sonra başlamış olmalı
        const r1End = order.indexOf('req1-end');
        const r2Start = order.indexOf('req2-start');
        expect(r1End).toBeLessThan(r2Start);
    });
});

// ─── getMatchEndResult ────────────────────────────────────────────────────────

describe('getMatchEndResult', () => {
    const summoner = { puuid: 'puuid-abc' };

    function matchData(win) {
        return {
            info: {
                participants: [
                    { puuid: 'puuid-abc', win },
                    { puuid: 'other', win: !win },
                ],
            },
        };
    }

    test('returns "win" when tracked participant won', async () => {
        respond(matchData(true));
        expect(await riotApi.getMatchEndResult('EUW1_1', summoner, 'EUW')).toBe('win');
    });

    test('returns "lose" when tracked participant lost', async () => {
        respond(matchData(false));
        expect(await riotApi.getMatchEndResult('EUW1_1', summoner, 'EUW')).toBe('lose');
    });

    test('returns null when match data is unavailable (API returned null)', async () => {
        axios.mockResolvedValueOnce({ status: 204, data: null, headers: {} });
        expect(await riotApi.getMatchEndResult('EUW1_1', summoner, 'EUW')).toBeNull();
    });

    test('returns null when participant puuid is not found in the match', async () => {
        respond({ info: { participants: [{ puuid: 'stranger', win: true }] } });
        expect(await riotApi.getMatchEndResult('EUW1_1', summoner, 'EUW')).toBeNull();
    });

    test('routes request through the correct regional cluster', async () => {
        respond(matchData(true));
        await riotApi.getMatchEndResult('KR_9999', summoner, 'KR');
        expect(axios.mock.calls[0][0].baseURL).toContain('asia');
    });
});

// ─── getSideBetResults ────────────────────────────────────────────────────────

describe('getSideBetResults', () => {
    function matchData(firstBloodTeamId, blueTowerFirst) {
        return {
            info: {
                participants: [
                    { teamId: firstBloodTeamId, firstBloodKill: true },
                    { teamId: firstBloodTeamId === 100 ? 200 : 100, firstBloodKill: false },
                ],
                teams: [
                    { teamId: 100, objectives: { tower: { first: blueTowerFirst } } },
                    { teamId: 200, objectives: { tower: { first: !blueTowerFirst } } },
                ],
            },
        };
    }

    test('firstBlood = blue when teamId 100 gets first kill', async () => {
        respond(matchData(100, true));
        expect((await riotApi.getSideBetResults('EUW1_1', 'EUW')).firstBlood).toBe('blue');
    });

    test('firstBlood = red when teamId 200 gets first kill', async () => {
        respond(matchData(200, false));
        expect((await riotApi.getSideBetResults('EUW1_1', 'EUW')).firstBlood).toBe('red');
    });

    test('firstTower = blue when blue team takes first tower', async () => {
        respond(matchData(100, true));
        expect((await riotApi.getSideBetResults('EUW1_1', 'EUW')).firstTower).toBe('blue');
    });

    test('firstTower = red when red team takes first tower', async () => {
        respond(matchData(200, false));
        expect((await riotApi.getSideBetResults('EUW1_1', 'EUW')).firstTower).toBe('red');
    });

    test('returns null when match data is unavailable', async () => {
        axios.mockResolvedValueOnce({ status: 204, data: null, headers: {} });
        expect(await riotApi.getSideBetResults('EUW1_1', 'EUW')).toBeNull();
    });

    test('firstBlood is null when no participant has firstBloodKill=true', async () => {
        respond({
            info: {
                participants: [{ teamId: 100, firstBloodKill: false }],
                teams: [{ teamId: 100, objectives: { tower: { first: true } } }],
            },
        });
        const result = await riotApi.getSideBetResults('EUW1_1', 'EUW');
        expect(result.firstBlood).toBeNull();
    });
});

// ─── isActiveGame ─────────────────────────────────────────────────────────────

describe('isActiveGame', () => {
    test('returns true when spectator data is present', async () => {
        respond({ gameId: 12345 });
        expect(await riotApi.isActiveGame('EUW', 'puuid-abc')).toBe(true);
    });

    test('returns false when spectator returns null (no active game)', async () => {
        axios.mockResolvedValueOnce({ status: 204, data: null, headers: {} });
        expect(await riotApi.isActiveGame('EUW', 'puuid-abc')).toBe(false);
    });

    test('returns false when API call fails (player not in game)', async () => {
        respondError(404);
        expect(await riotApi.isActiveGame('EUW', 'puuid-abc')).toBe(false);
    });

    test('uses the correct region prefix in the spectator URL', async () => {
        respond({ gameId: 1 });
        await riotApi.isActiveGame('TR', 'puuid-abc');
        expect(axios.mock.calls[0][0].baseURL).toContain('tr1');
    });

    test('uses KR prefix for KR region', async () => {
        respond({ gameId: 1 });
        await riotApi.isActiveGame('KR', 'puuid-abc');
        expect(axios.mock.calls[0][0].baseURL).toContain('kr.api');
    });
});
