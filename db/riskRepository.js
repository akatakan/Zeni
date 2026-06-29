const db = require('./db');

const flagUser = (guildId, userId, reason, flaggedBy) => {
    return db.prepare(`
        INSERT INTO risk_users (guild_id, user_id, reason, flagged_by, flagged_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, flagged_by = excluded.flagged_by, flagged_at = excluded.flagged_at
    `).run(guildId, userId, reason || null, flaggedBy || null, Date.now());
};

const unflagUser = (guildId, userId) => {
    return db.prepare('DELETE FROM risk_users WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
};

const isRisky = (guildId, userId) => {
    const row = db.prepare('SELECT 1 FROM risk_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return !!row;
};

const getRiskyUsers = (guildId) => {
    return db.prepare('SELECT * FROM risk_users WHERE guild_id = ? ORDER BY flagged_at DESC').all(guildId);
};

module.exports = { flagUser, unflagUser, isRisky, getRiskyUsers };
