jest.mock('../db/db', () => ({
    pool: { query: jest.fn() },
}));

const { pool } = require('../db/db');
const {
    addSideBet,
    hasSideBet,
    getSideBetsByMatch,
    markSideBetResults,
    getSideBetStatsByUserId,
} = require('../db/sideBetRepository');

// ─── addSideBet ───────────────────────────────────────────────────────────────

describe('addSideBet', () => {
    test('inserts a side bet with correct parameters', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await addSideBet('EUW1_1', 'user1', 'first_blood', 'blue', 100);
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO side_bets');
        expect(params).toEqual(['EUW1_1', 'user1', 'first_blood', 'blue', 100, expect.any(Date)]);
    });

    test('placed_at is a Date object representing the current time', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const before = new Date();
        await addSideBet('m1', 'u1', 'first_tower', 'red', 50);
        const after = new Date();
        const placedAt = pool.query.mock.calls[0][1][5];
        expect(placedAt).toBeInstanceOf(Date);
        expect(placedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(placedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('works for both event types', async () => {
        for (const eventType of ['first_blood', 'first_tower']) {
            pool.query.mockResolvedValueOnce({ rows: [] });
            await addSideBet('m1', 'u1', eventType, 'blue', 100);
            const params = pool.query.mock.calls.at(-1)[1];
            expect(params[2]).toBe(eventType);
        }
    });
});

// ─── hasSideBet ───────────────────────────────────────────────────────────────

describe('hasSideBet', () => {
    test('returns true when a matching row exists', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{}] });
        expect(await hasSideBet('m1', 'u1', 'first_blood')).toBe(true);
    });

    test('returns false when no matching row exists', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect(await hasSideBet('m1', 'u1', 'first_blood')).toBe(false);
    });

    test('queries with correct match_id, user_id, event_type', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await hasSideBet('matchX', 'userY', 'first_tower');
        const params = pool.query.mock.calls[0][1];
        expect(params).toEqual(['matchX', 'userY', 'first_tower']);
    });
});

// ─── getSideBetsByMatch ───────────────────────────────────────────────────────

describe('getSideBetsByMatch', () => {
    test('returns all side bets for the match', async () => {
        const rows = [
            { side_bet_id: 1, match_id: 'm1', user_id: 'u1', amount: 100 },
            { side_bet_id: 2, match_id: 'm1', user_id: 'u2', amount: 200 },
        ];
        pool.query.mockResolvedValueOnce({ rows });
        expect(await getSideBetsByMatch('m1')).toEqual(rows);
    });

    test('returns empty array when no side bets exist', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect(await getSideBetsByMatch('m1')).toEqual([]);
    });

    test('queries with the correct match_id', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await getSideBetsByMatch('EUW1_99');
        expect(pool.query.mock.calls[0][1]).toEqual(['EUW1_99']);
    });
});

// ─── markSideBetResults ───────────────────────────────────────────────────────

describe('markSideBetResults', () => {
    test('calls UPDATE with firstBlood and firstTower teams in correct param order', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await markSideBetResults('m1', 'blue', 'red');
        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain('UPDATE side_bets');
        expect(params).toEqual(['blue', 'red', 'm1']);
    });

    test('works with reversed outcome (red blood, blue tower)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await markSideBetResults('m2', 'red', 'blue');
        expect(pool.query.mock.calls[0][1]).toEqual(['red', 'blue', 'm2']);
    });

    test('SQL sets won=1 for correct first_blood prediction', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await markSideBetResults('m1', 'blue', 'red');
        const [sql] = pool.query.mock.calls[0];
        expect(sql).toMatch(/event_type = 'first_blood' AND prediction = \$1 THEN 1/);
    });

    test('SQL sets won=0 for incorrect first_blood prediction', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        await markSideBetResults('m1', 'blue', 'red');
        const [sql] = pool.query.mock.calls[0];
        expect(sql).toMatch(/event_type = 'first_blood' AND prediction != \$1 THEN 0/);
    });
});

// ─── getSideBetStatsByUserId ───────────────────────────────────────────────────

describe('getSideBetStatsByUserId', () => {
    test('returns aggregated stats row', async () => {
        const fakeRow = { total_bets: '5', wins: '3', losses: '2', total_wagered: '750', net_jp: '250' };
        pool.query.mockResolvedValueOnce({ rows: [fakeRow] });
        expect(await getSideBetStatsByUserId('u1')).toEqual(fakeRow);
    });

    test('returns undefined when user has no resolved side bets', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect(await getSideBetStatsByUserId('nobody')).toBeUndefined();
    });

    test('queries only resolved bets (won IS NOT NULL)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{}] });
        await getSideBetStatsByUserId('u42');
        const [sql, params] = pool.query.mock.calls[0];
        expect(params).toEqual(['u42']);
        expect(sql).toMatch(/won IS NOT NULL/i);
    });

    test('includes wins, losses, total_wagered and net_jp in SELECT', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{}] });
        await getSideBetStatsByUserId('u1');
        const [sql] = pool.query.mock.calls[0];
        expect(sql).toContain('total_bets');
        expect(sql).toContain('total_wagered');
        expect(sql).toContain('net_jp');
    });
});
