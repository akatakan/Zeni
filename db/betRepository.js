const db = require('./db');

const createMatchBet = (matchId, creatorId, started_at, summoner_id, region, channel_id, mode = 'classic') => {
    const stmt = db.prepare('INSERT OR IGNORE INTO matches_bets (match_id, creator_id, started_at, summoner_id, region, channel_id, mode) VALUES (?, ?, ?, ?, ?, ?, ?)');
    return stmt.run(matchId, creatorId, started_at, summoner_id, region, channel_id, mode);
};

const getMatchBetById = (matchId) => {
    const stmt = db.prepare('SELECT * FROM matches_bets WHERE match_id = ?');
    return stmt.get(matchId);
};

const closeMatchBet = (matchId) => {
    const stmt = db.prepare('UPDATE matches_bets SET is_open = 0, closed_at = CURRENT_TIMESTAMP WHERE match_id = ?');
    return stmt.run(matchId);
};

const deleteMatchBets = (matchId) => {
    const stmt = db.prepare('DELETE FROM matches_bets WHERE match_id = ?');
    return stmt.run(matchId);
};

const deleteBets = (matchId) => {
    const stmt = db.prepare('DELETE FROM bets WHERE match_id = ?');
    return stmt.run(matchId);
};

const addBet = (matchId, userId, amount, prediction, tournamentId = null) => {
    const stmt = db.prepare('INSERT INTO bets (match_id, user_id, amount, prediction, tournament_id) VALUES (?, ?, ?, ?, ?)');
    return stmt.run(matchId, userId, amount, prediction, tournamentId);
};

const getBetsByMatchId = (matchId) => {
    const stmt = db.prepare('SELECT * FROM bets WHERE match_id = ?');
    return stmt.all(matchId);
};

const hasActiveBet = (userId, matchId) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM bets WHERE user_id = ? AND match_id = ?');
    const result = stmt.get(userId, matchId);
    return result.count > 0;
};

const getOpenMatches = () => {
    const stmt = db.prepare('SELECT * FROM matches_bets WHERE is_open = 1');
    return stmt.all();
};

// Kullanıcının bugün kaç maç açtığı (started_at = Unix ms timestamp)
const getDailyMatchCount = (userId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const stmt = db.prepare('SELECT COUNT(*) as count FROM matches_bets WHERE creator_id = ? AND started_at >= ?');
    return stmt.get(userId, todayStart.getTime()).count;
};

// Kullanıcının şu an kaç açık maçı var
const getOpenMatchCountByCreator = (userId) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM matches_bets WHERE creator_id = ? AND is_open = 1');
    return stmt.get(userId).count;
};

// Tüm bets'i sonuca göre işaretle (won=1 doğru, won=0 yanlış)
const markBetResult = (matchId, matchResult) => {
    db.prepare(`
        UPDATE bets SET won = CASE WHEN prediction = ? THEN 1 ELSE 0 END
        WHERE match_id = ?
    `).run(matchResult, matchId);
};

// Kullanıcının geçmiş bahis istatistikleri (sadece çözülmüş bahisler)
const getStatsByUserId = (userId) => {
    return db.prepare(`
        SELECT
            COUNT(*) as total_bets,
            SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as losses,
            SUM(amount) as total_wagered,
            SUM(CASE WHEN won = 1 THEN amount ELSE -amount END) as net_jp,
            MAX(amount) as biggest_bet
        FROM bets
        WHERE user_id = ? AND won IS NOT NULL
    `).get(userId);
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
    getDailyMatchCount,
    getOpenMatchCountByCreator,
    markBetResult,
    getStatsByUserId,
};
