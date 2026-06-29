jest.mock('discord.js', () => ({
    EmbedBuilder: jest.fn(() => ({
        setTitle: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        setColor: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setFooter: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis(),
        data: { title: 'result' },
    })),
}));

jest.mock('../db/betRepository');
jest.mock('../db/userRepository');
jest.mock('../db/sideBetRepository');
jest.mock('../db/tournamentRepository');
jest.mock('../services/riot', () => ({
    delay: jest.fn(),
    getSideBetResults: jest.fn(),
    getMatchEndResult: jest.fn(),
}));
jest.mock('../util/i18n', () => ({ t: (key) => key }));
jest.mock('../util/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../util/colors', () => ({ SUCCESS: 0x00ff00, ERROR: 0xff0000 }));

const betRepository     = require('../db/betRepository');
const userRepository    = require('../db/userRepository');
const sideBetRepository = require('../db/sideBetRepository');
const riotApi           = require('../services/riot');
const { resolveMatch }  = require('../util/resolveMatch');

const MATCH_ID = 'EUW1_999';
const SUMMONER = { puuid: 'puuid-abc' };
const REGION   = 'EUW';

const winBet  = (userId, amount = 100) => ({ user_id: userId, amount, prediction: 'win',  tournament_id: null });
const loseBet = (userId, amount = 100) => ({ user_id: userId, amount, prediction: 'lose', tournament_id: null });

beforeEach(() => {
    riotApi.delay.mockResolvedValue();
    riotApi.getSideBetResults.mockResolvedValue(null);
    riotApi.getMatchEndResult.mockResolvedValue('win');

    betRepository.getBetsByMatchId.mockResolvedValue([]);
    betRepository.getMatchBetById.mockResolvedValue({ mode: 'classic', channel_id: 'ch1' });
    betRepository.deleteMatchBets.mockResolvedValue();
    betRepository.markBetResult.mockResolvedValue();
    betRepository.closeMatchBet.mockResolvedValue();
    betRepository.getStatsByUserId.mockResolvedValue({ total_bets: 1, wins: 0 });

    userRepository.addUserBalance.mockResolvedValue();
    userRepository.incrementStreak.mockResolvedValue(1);
    userRepository.resetStreak.mockResolvedValue();

    sideBetRepository.getSideBetsByMatch.mockResolvedValue([]);
    sideBetRepository.markSideBetResults.mockResolvedValue();
});

// ─── No bets ─────────────────────────────────────────────────────────────────

describe('no bets on match', () => {
    test('returns null', async () => {
        expect(await resolveMatch(MATCH_ID, SUMMONER, REGION, null)).toBeNull();
    });

    test('deletes the match record', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(betRepository.deleteMatchBets).toHaveBeenCalledWith(MATCH_ID);
    });

    test('never calls getMatchEndResult', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(riotApi.getMatchEndResult).not.toHaveBeenCalled();
    });
});

// ─── Match result unavailable ─────────────────────────────────────────────────

describe('match result unavailable', () => {
    beforeEach(() => {
        betRepository.getBetsByMatchId.mockResolvedValue([winBet('u1', 100), loseBet('u2', 200)]);
        riotApi.getMatchEndResult.mockResolvedValue(null);
    });

    test('returns null', async () => {
        expect(await resolveMatch(MATCH_ID, SUMMONER, REGION, null)).toBeNull();
    });

    test('refunds all main bets', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u1', 100);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u2', 200);
    });

    test('refunds side bets when match result is unavailable', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u1', amount: 50 },
            { user_id: 'u3', amount: 75 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u1', 50);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u3', 75);
    });

    test('same user receives both main and side bet refunds separately', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([{ user_id: 'u1', amount: 50 }]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        const u1Calls = userRepository.addUserBalance.mock.calls.filter(c => c[0] === 'u1');
        expect(u1Calls).toHaveLength(2);
        expect(u1Calls.map(c => c[1]).sort((a, b) => a - b)).toEqual([50, 100]);
    });

    test('does not pay any winner when result is unavailable', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(betRepository.markBetResult).not.toHaveBeenCalled();
    });
});

// ─── Happy path — classic mode ────────────────────────────────────────────────

describe('happy path — classic mode', () => {
    beforeEach(() => {
        betRepository.getBetsByMatchId.mockResolvedValue([winBet('u1', 100), loseBet('u2', 200)]);
        riotApi.getMatchEndResult.mockResolvedValue('win');
    });

    test('pays winner 2x their bet amount', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u1', 200);
    });

    test('does not credit the loser', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).not.toHaveBeenCalledWith('u2', expect.anything());
    });

    test('increments winner streak', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.incrementStreak).toHaveBeenCalledWith('u1');
    });

    test('resets loser streak', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.resetStreak).toHaveBeenCalledWith('u2');
    });

    test('marks bet result in database', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(betRepository.markBetResult).toHaveBeenCalledWith(MATCH_ID, 'win');
    });

    test('closes the match', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(betRepository.closeMatchBet).toHaveBeenCalledWith(MATCH_ID);
    });

    test('returns a non-null embed', async () => {
        const result = await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(result).not.toBeNull();
        expect(result.setTitle).toBeDefined();
    });

    test('waits 30s before processing (Riot API propagation delay)', async () => {
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(riotApi.delay).toHaveBeenCalledWith(30000);
    });
});

// ─── Pool mode ────────────────────────────────────────────────────────────────

describe('pool mode payout', () => {
    beforeEach(() => {
        betRepository.getMatchBetById.mockResolvedValue({ mode: 'pool', channel_id: 'ch1' });
        riotApi.getMatchEndResult.mockResolvedValue('win');
    });

    test('sole winner receives the entire pool', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([winBet('u1', 100), loseBet('u2', 300)]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // total=400, winPool=100 → floor((100/100)*400) = 400
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u1', 400);
    });

    test('pool is split proportionally among multiple winners', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([
            winBet('u1', 100), winBet('u2', 100), loseBet('u3', 200),
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // total=400, winPool=200 → each winner: floor((100/200)*400) = 200
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u1', 200);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u2', 200);
    });

    test('unequal stakes pay proportionally', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([
            winBet('u1', 100), winBet('u2', 300), loseBet('u3', 200),
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // total=600, winPool=400 → u1: floor((100/400)*600)=150, u2: floor((300/400)*600)=450
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u1', 150);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u2', 450);
    });
});

// ─── Streak bonuses ───────────────────────────────────────────────────────────

describe('streak bonuses', () => {
    beforeEach(() => {
        betRepository.getBetsByMatchId.mockResolvedValue([winBet('u1', 100)]);
        riotApi.getMatchEndResult.mockResolvedValue('win');
    });

    test.each([
        [1, 0], [2, 0], [3, 100], [4, 0], [5, 250],
        [6, 0], [9, 0], [10, 500], [15, 500], [20, 500],
    ])('streak %i → %i JP bonus', async (streak, bonus) => {
        userRepository.incrementStreak.mockResolvedValue(streak);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        const u1Calls = userRepository.addUserBalance.mock.calls.filter(c => c[0] === 'u1');
        if (bonus === 0) {
            expect(u1Calls).toHaveLength(1);
        } else {
            expect(u1Calls).toHaveLength(2);
            expect(u1Calls[1][1]).toBe(bonus);
        }
    });
});

// ─── Side bets — result resolution ───────────────────────────────────────────

describe('side bets — result resolution', () => {
    beforeEach(() => {
        betRepository.getBetsByMatchId.mockResolvedValue([winBet('u1', 100)]);
        riotApi.getMatchEndResult.mockResolvedValue('win');
        riotApi.getSideBetResults.mockResolvedValue({ firstBlood: 'blue', firstTower: 'red' });
    });

    test('pays first_blood winner 2.5x', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u2', event_type: 'first_blood', prediction: 'blue', amount: 100 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u2', 250);
    });

    test('pays first_tower winner 2.5x', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u2', event_type: 'first_tower', prediction: 'red', amount: 80 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).toHaveBeenCalledWith('u2', 200); // floor(80*2.5)
    });

    test('does not pay first_blood loser', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u2', event_type: 'first_blood', prediction: 'red', amount: 100 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(userRepository.addUserBalance).not.toHaveBeenCalledWith('u2', expect.anything());
    });

    test('does not resolve side bets when getSideBetResults returns null', async () => {
        riotApi.getSideBetResults.mockResolvedValue(null);
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u2', event_type: 'first_blood', prediction: 'blue', amount: 100 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(sideBetRepository.markSideBetResults).not.toHaveBeenCalled();
        expect(userRepository.addUserBalance).not.toHaveBeenCalledWith('u2', expect.anything());
    });

    test('marks side bet results in database', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u2', event_type: 'first_blood', prediction: 'blue', amount: 100 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        expect(sideBetRepository.markSideBetResults).toHaveBeenCalledWith(MATCH_ID, 'blue', 'red');
    });
});

// ─── Combo bonus ──────────────────────────────────────────────────────────────

describe('combo bonus', () => {
    beforeEach(() => {
        betRepository.getBetsByMatchId.mockResolvedValue([winBet('u1', 100)]);
        riotApi.getMatchEndResult.mockResolvedValue('win');
        riotApi.getSideBetResults.mockResolvedValue({ firstBlood: 'blue', firstTower: 'red' });
        userRepository.incrementStreak.mockResolvedValue(1);
    });

    test('25% bonus when main + 1 side bet both correct (2 correct total)', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u1', event_type: 'first_blood', prediction: 'blue', amount: 50 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // correctCount=2 → 25%, wagered=100+50=150 → bonus=floor(150*0.25)=37
        const amounts = userRepository.addUserBalance.mock.calls.filter(c => c[0] === 'u1').map(c => c[1]);
        expect(amounts).toContain(37);
    });

    test('75% bonus when main + both side bets correct (3 correct total)', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u1', event_type: 'first_blood', prediction: 'blue', amount: 50 },
            { user_id: 'u1', event_type: 'first_tower', prediction: 'red', amount: 50 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // correctCount=3 → 75%, wagered=100+50+50=200 → bonus=floor(200*0.75)=150
        const amounts = userRepository.addUserBalance.mock.calls.filter(c => c[0] === 'u1').map(c => c[1]);
        expect(amounts).toContain(150);
    });

    test('no combo when user has only 1 correct prediction', async () => {
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u1', event_type: 'first_blood', prediction: 'red', amount: 50 }, // wrong
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // correctCount=1 → no combo; only payout(200), no bonus at streak 1
        const calls = userRepository.addUserBalance.mock.calls.filter(c => c[0] === 'u1');
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toBe(200);
    });

    test('no combo when main bet lost even with correct side bets', async () => {
        betRepository.getBetsByMatchId.mockResolvedValue([loseBet('u1', 100)]);
        sideBetRepository.getSideBetsByMatch.mockResolvedValue([
            { user_id: 'u1', event_type: 'first_blood', prediction: 'blue', amount: 50 },
        ]);
        await resolveMatch(MATCH_ID, SUMMONER, REGION, null);
        // u1 lost main bet → not in comboMap from winners → correctCount=1 from side bet only → no combo
        const amounts = userRepository.addUserBalance.mock.calls.filter(c => c[0] === 'u1').map(c => c[1]);
        expect(amounts).toContain(125); // side bet win: floor(50*2.5)
        // combo bonus of 37 (25% of 50) should NOT appear — only 1 correct
        expect(amounts).not.toContain(37);
    });
});
