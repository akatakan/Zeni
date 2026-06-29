const { pool } = require('./db');

const addReport = async (guildId, reporterId, reportedId, matchId, reason) => {
    await pool.query(
        'INSERT INTO reports (guild_id, reporter_id, reported_id, match_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [guildId, reporterId, reportedId, matchId || null, reason || null, new Date()]
    );
};

const getReports = async (guildId) => {
    const res = await pool.query(
        'SELECT * FROM reports WHERE guild_id = $1 ORDER BY created_at DESC',
        [guildId]
    );
    return res.rows;
};

const getReportsByUser = async (guildId, reportedId) => {
    const res = await pool.query(
        'SELECT * FROM reports WHERE guild_id = $1 AND reported_id = $2 ORDER BY created_at DESC',
        [guildId, reportedId]
    );
    return res.rows;
};

module.exports = { addReport, getReports, getReportsByUser };
