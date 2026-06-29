const db = require('./db');

const addReport = (guildId, reporterId, reportedId, matchId, reason) => {
    return db.prepare(`
        INSERT INTO reports (guild_id, reporter_id, reported_id, match_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(guildId, reporterId, reportedId, matchId || null, reason || null, Date.now());
};

const getReports = (guildId) => {
    return db.prepare('SELECT * FROM reports WHERE guild_id = ? ORDER BY created_at DESC').all(guildId);
};

const getReportsByUser = (guildId, reportedId) => {
    return db.prepare('SELECT * FROM reports WHERE guild_id = ? AND reported_id = ? ORDER BY created_at DESC').all(guildId, reportedId);
};

module.exports = { addReport, getReports, getReportsByUser };
