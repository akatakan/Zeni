const { pool } = require('./db');

const flagUser = async (guildId, userId, reason, flaggedBy) => {
    await pool.query(`
        INSERT INTO risk_users (guild_id, user_id, reason, flagged_by, flagged_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (guild_id, user_id) DO UPDATE
            SET reason = EXCLUDED.reason, flagged_by = EXCLUDED.flagged_by, flagged_at = EXCLUDED.flagged_at
    `, [guildId, userId, reason || null, flaggedBy || null, new Date()]);
};

const unflagUser = async (guildId, userId) => {
    await pool.query('DELETE FROM risk_users WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
};

const isRisky = async (guildId, userId) => {
    const res = await pool.query(
        'SELECT 1 FROM risk_users WHERE guild_id = $1 AND user_id = $2',
        [guildId, userId]
    );
    return res.rows.length > 0;
};

const getRiskyUsers = async (guildId) => {
    const res = await pool.query(
        'SELECT * FROM risk_users WHERE guild_id = $1 ORDER BY flagged_at DESC',
        [guildId]
    );
    return res.rows;
};

module.exports = { flagUser, unflagUser, isRisky, getRiskyUsers };
