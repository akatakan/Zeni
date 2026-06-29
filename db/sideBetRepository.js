const { pool } = require('./db');

const addSideBet = async (matchId, userId, eventType, prediction, amount) => {
    await pool.query(
        'INSERT INTO side_bets (match_id, user_id, event_type, prediction, amount, placed_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [matchId, userId, eventType, prediction, amount, new Date()]
    );
};

const hasSideBet = async (matchId, userId, eventType) => {
    const res = await pool.query(
        'SELECT 1 FROM side_bets WHERE match_id = $1 AND user_id = $2 AND event_type = $3',
        [matchId, userId, eventType]
    );
    return res.rows.length > 0;
};

const getSideBetsByMatch = async (matchId) => {
    const res = await pool.query('SELECT * FROM side_bets WHERE match_id = $1', [matchId]);
    return res.rows;
};

const markSideBetResults = async (matchId, firstBloodTeam, firstTowerTeam) => {
    await pool.query(`
        UPDATE side_bets SET won = CASE
            WHEN event_type = 'first_blood' AND prediction = $1 THEN 1
            WHEN event_type = 'first_blood' AND prediction != $1 THEN 0
            WHEN event_type = 'first_tower'  AND prediction = $2 THEN 1
            WHEN event_type = 'first_tower'  AND prediction != $2 THEN 0
            ELSE won
        END
        WHERE match_id = $3
    `, [firstBloodTeam, firstTowerTeam, matchId]);
};

const getSideBetStatsByUserId = async (userId) => {
    const res = await pool.query(`
        SELECT
            COUNT(*) as total_bets,
            SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as losses,
            SUM(amount) as total_wagered,
            SUM(CASE WHEN won = 1 THEN amount ELSE -amount END) as net_jp
        FROM side_bets
        WHERE user_id = $1 AND won IS NOT NULL
    `, [userId]);
    return res.rows[0];
};

module.exports = { addSideBet, hasSideBet, getSideBetsByMatch, markSideBetResults, getSideBetStatsByUserId };
