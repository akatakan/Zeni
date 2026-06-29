const { pool } = require('./db');

const createMatchBet = async (matchId, creatorId, started_at, summoner_id, region, channel_id, mode = 'classic') => {
    await pool.query(
        'INSERT INTO matches_bets (match_id, creator_id, started_at, summoner_id, region, channel_id, mode) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [matchId, creatorId, started_at, summoner_id, region, channel_id, mode]
    );
};

const getMatchBetById = async (matchId) => {
    const res = await pool.query('SELECT * FROM matches_bets WHERE match_id = $1', [matchId]);
    return res.rows[0];
};

const closeMatchBet = async (matchId) => {
    await pool.query('UPDATE matches_bets SET is_open = 0, closed_at = NOW() WHERE match_id = $1', [matchId]);
};

const deleteMatchBets = async (matchId) => {
    await pool.query('DELETE FROM matches_bets WHERE match_id = $1', [matchId]);
};

const deleteBets = async (matchId) => {
    await pool.query('DELETE FROM bets WHERE match_id = $1', [matchId]);
};

const addBet = async (matchId, userId, amount, prediction, tournamentId = null) => {
    await pool.query(
        'INSERT INTO bets (match_id, user_id, amount, prediction, tournament_id) VALUES ($1,$2,$3,$4,$5)',
        [matchId, userId, amount, prediction, tournamentId]
    );
};

const getBetsByMatchId = async (matchId) => {
    const res = await pool.query('SELECT * FROM bets WHERE match_id = $1', [matchId]);
    return res.rows;
};

const hasActiveBet = async (userId, matchId) => {
    const res = await pool.query(
        'SELECT COUNT(*) as count FROM bets WHERE user_id = $1 AND match_id = $2',
        [userId, matchId]
    );
    return parseInt(res.rows[0].count) > 0;
};

const getOpenMatches = async () => {
    const res = await pool.query('SELECT * FROM matches_bets WHERE is_open = 1');
    return res.rows;
};

const getOpenMatchCount = async () => {
    const res = await pool.query('SELECT COUNT(*) as count FROM matches_bets WHERE is_open = 1');
    return parseInt(res.rows[0].count);
};

const getDailyMatchCount = async (userId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const res = await pool.query(
        'SELECT COUNT(*) as count FROM matches_bets WHERE creator_id = $1 AND started_at >= $2',
        [userId, todayStart]
    );
    return parseInt(res.rows[0].count);
};

const getOpenMatchCountByCreator = async (userId) => {
    const res = await pool.query(
        'SELECT COUNT(*) as count FROM matches_bets WHERE creator_id = $1 AND is_open = 1',
        [userId]
    );
    return parseInt(res.rows[0].count);
};

const markBetResult = async (matchId, matchResult) => {
    await pool.query(
        'UPDATE bets SET won = CASE WHEN prediction = $1 THEN 1 ELSE 0 END WHERE match_id = $2',
        [matchResult, matchId]
    );
};

const getStatsByUserId = async (userId) => {
    const res = await pool.query(`
        SELECT
            COUNT(*) as total_bets,
            SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as losses,
            SUM(amount) as total_wagered,
            SUM(CASE WHEN won = 1 THEN amount ELSE -amount END) as net_jp,
            MAX(amount) as biggest_bet
        FROM bets
        WHERE user_id = $1 AND won IS NOT NULL
    `, [userId]);
    return res.rows[0];
};

module.exports = {
    createMatchBet,
    getMatchBetById,
    closeMatchBet,
    deleteMatchBets,
    deleteBets,
    addBet,
    getBetsByMatchId,
    hasActiveBet,
    getOpenMatches,
    getOpenMatchCount,
    getDailyMatchCount,
    getOpenMatchCountByCreator,
    markBetResult,
    getStatsByUserId,
};
