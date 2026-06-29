const db = require('./db');

const createTournament = (guildId, entryFee, durationDays) => {
    const startedAt = Date.now();
    const endsAt = startedAt + durationDays * 24 * 60 * 60 * 1000;
    return db.prepare(`
        INSERT INTO tournaments (guild_id, entry_fee, prize_pool, started_at, ends_at)
        VALUES (?, ?, 0, ?, ?)
    `).run(guildId, entryFee, startedAt, endsAt);
};

const getActiveTournament = (guildId) => {
    return db.prepare(`
        SELECT * FROM tournaments WHERE guild_id = ? AND status = 'active'
    `).get(guildId);
};

const getTournamentById = (tournamentId) => {
    return db.prepare('SELECT * FROM tournaments WHERE tournament_id = ?').get(tournamentId);
};

const endTournament = (tournamentId) => {
    db.prepare("UPDATE tournaments SET status = 'ended' WHERE tournament_id = ?").run(tournamentId);
};

// Katılım: entry fee → prize pool + tournament balance (3x)
const joinTournament = (tournamentId, userId, entryFee) => {
    db.prepare('UPDATE tournaments SET prize_pool = prize_pool + ? WHERE tournament_id = ?').run(entryFee, tournamentId);
    db.prepare(`
        INSERT OR IGNORE INTO tournament_participants (tournament_id, user_id, tournament_balance)
        VALUES (?, ?, ?)
    `).run(tournamentId, userId, entryFee * 3);
};

const isParticipant = (tournamentId, userId) => {
    return !!db.prepare(`
        SELECT 1 FROM tournament_participants
        WHERE tournament_id = ? AND user_id = ? AND eliminated = 0
    `).get(tournamentId, userId);
};

const hasJoined = (tournamentId, userId) => {
    return !!db.prepare('SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?')
        .get(tournamentId, userId);
};

// Atomik deduct — TOCTOU-safe
const deductTournamentBalance = (tournamentId, userId, amount) => {
    const result = db.prepare(`
        UPDATE tournament_participants
        SET tournament_balance = tournament_balance - ?
        WHERE tournament_id = ? AND user_id = ? AND tournament_balance >= ? AND eliminated = 0
    `).run(amount, tournamentId, userId, amount);
    return result.changes > 0;
};

const addTournamentBalance = (tournamentId, userId, amount) => {
    db.prepare(`
        UPDATE tournament_participants SET tournament_balance = tournament_balance + ?
        WHERE tournament_id = ? AND user_id = ?
    `).run(amount, tournamentId, userId);
};

const eliminateParticipant = (tournamentId, userId) => {
    db.prepare(`
        UPDATE tournament_participants SET eliminated = 1, tournament_balance = 0
        WHERE tournament_id = ? AND user_id = ?
    `).run(tournamentId, userId);
};

// Elenmemiş katılımcılar, bakiyeye göre sıralı
const getLeaderboard = (tournamentId) => {
    return db.prepare(`
        SELECT * FROM tournament_participants
        WHERE tournament_id = ?
        ORDER BY eliminated ASC, tournament_balance DESC
    `).all(tournamentId);
};

// Elenmemiş katılımcı sayısı
const getActiveParticipantCount = (tournamentId) => {
    return db.prepare(`
        SELECT COUNT(*) as count FROM tournament_participants
        WHERE tournament_id = ? AND eliminated = 0
    `).get(tournamentId).count;
};

// Belirli bir kullanıcının tournament bakiyesi
const getParticipant = (tournamentId, userId) => {
    return db.prepare('SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?')
        .get(tournamentId, userId);
};

module.exports = {
    createTournament,
    getActiveTournament,
    getTournamentById,
    endTournament,
    joinTournament,
    isParticipant,
    hasJoined,
    deductTournamentBalance,
    addTournamentBalance,
    eliminateParticipant,
    getLeaderboard,
    getActiveParticipantCount,
    getParticipant,
};
