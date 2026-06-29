const db = require('./db');

const addSideBet = (matchId, userId, eventType, prediction, amount) => {
    return db.prepare(`
        INSERT INTO side_bets (match_id, user_id, event_type, prediction, amount, placed_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(matchId, userId, eventType, prediction, amount, Date.now());
};

const hasSideBet = (matchId, userId, eventType) => {
    const row = db.prepare('SELECT 1 FROM side_bets WHERE match_id = ? AND user_id = ? AND event_type = ?').get(matchId, userId, eventType);
    return !!row;
};

const getSideBetsByMatch = (matchId) => {
    return db.prepare('SELECT * FROM side_bets WHERE match_id = ?').all(matchId);
};

const markSideBetResults = (matchId, firstBloodTeam, firstTowerTeam) => {
    db.prepare(`
        UPDATE side_bets SET won = CASE
            WHEN event_type = 'first_blood' AND prediction = ? THEN 1
            WHEN event_type = 'first_blood' AND prediction != ? THEN 0
            WHEN event_type = 'first_tower' AND prediction = ? THEN 1
            WHEN event_type = 'first_tower' AND prediction != ? THEN 0
            ELSE won
        END
        WHERE match_id = ?
    `).run(firstBloodTeam, firstBloodTeam, firstTowerTeam, firstTowerTeam, matchId);
};

module.exports = { addSideBet, hasSideBet, getSideBetsByMatch, markSideBetResults };
