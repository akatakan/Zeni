const { pool } = require('./db');

const getUserById = async (userId) => {
    const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    return res.rows[0];
};

const addUser = async (userId, username) => {
    await pool.query(
        'INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, username]
    );
};

const setUserBalance = async (userId, amount) => {
    await pool.query('UPDATE users SET balance = $1 WHERE user_id = $2', [amount, userId]);
};

const addUserBalance = async (userId, amount) => {
    await pool.query('UPDATE users SET balance = balance + $1 WHERE user_id = $2', [amount, userId]);
};

const getUserBalance = async (userId) => {
    const res = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
    return res.rows[0]?.balance ?? null;
};

const getTopUsers = async (limit = 10) => {
    const res = await pool.query(
        'SELECT user_id, username, balance FROM users ORDER BY balance DESC LIMIT $1',
        [limit]
    );
    return res.rows;
};

const canClaimDaily = async (userId) => {
    const res = await pool.query('SELECT last_daily_claim FROM users WHERE user_id = $1', [userId]);
    const user = res.rows[0];
    if (!user || !user.last_daily_claim) return true;
    const hoursSince = (Date.now() - new Date(user.last_daily_claim)) / (1000 * 60 * 60);
    return hoursSince >= 24;
};

const claimDailyBalance = async (userId, amount = 200) => {
    await pool.query(
        'UPDATE users SET balance = balance + $1, last_daily_claim = NOW() WHERE user_id = $2',
        [amount, userId]
    );
};

const deductBalance = async (userId, amount) => {
    const res = await pool.query(
        'UPDATE users SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1',
        [amount, userId]
    );
    return res.rowCount > 0;
};

const transferBalance = async (fromId, toId, amount) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            'UPDATE users SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1',
            [amount, fromId]
        );
        if (res.rowCount === 0) {
            await client.query('ROLLBACK');
            return false;
        }
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
            [amount, toId]
        );
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const incrementStreak = async (userId) => {
    const res = await pool.query(
        'UPDATE users SET bet_streak = bet_streak + 1 WHERE user_id = $1 RETURNING bet_streak',
        [userId]
    );
    return res.rows[0]?.bet_streak || 0;
};

const resetStreak = async (userId) => {
    await pool.query('UPDATE users SET bet_streak = 0 WHERE user_id = $1', [userId]);
};

module.exports = {
    getUserById,
    addUser,
    addUserBalance,
    getUserBalance,
    getTopUsers,
    canClaimDaily,
    claimDailyBalance,
    setUserBalance,
    deductBalance,
    transferBalance,
    incrementStreak,
    resetStreak,
};
