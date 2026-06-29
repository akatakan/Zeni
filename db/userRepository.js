const db = require('./db');

const getUserById = (userId) => {
    const stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
    return stmt.get(userId);
};

const addUser = (userId, username) => {
    const stmt = db.prepare('INSERT INTO users (user_id, username) VALUES (?, ?)');
    return stmt.run(userId, username);
};

const setUserBalance = (userId, amount) => {
    const stmt = db.prepare('UPDATE users SET balance = ? WHERE user_id = ?');
    return stmt.run(amount, userId);
};

const addUserBalance = (userId, amount) => {
    const stmt = db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?');
    return stmt.run(amount, userId);
};

const getUserBalance = (userId) => {
    const stmt = db.prepare('SELECT balance FROM users WHERE user_id = ?');
    const row = stmt.get(userId);
    return row ? row.balance : null;
};

const getTopUsers = (limit = 10) => {
    const stmt = db.prepare('SELECT user_id, username, balance FROM users ORDER BY balance DESC LIMIT ?');
    return stmt.all(limit);
};

const canClaimDaily = (userId) => {
    const stmt = db.prepare('SELECT last_daily_claim FROM users WHERE user_id = ?');
    const user = stmt.get(userId);
    if (!user || !user.last_daily_claim) return true;
    const hoursSinceLastClaim = (new Date() - new Date(user.last_daily_claim)) / (1000 * 60 * 60);
    return hoursSinceLastClaim >= 24;
};

const claimDailyBalance = (userId, amount = 200) => {
    const stmt = db.prepare('UPDATE users SET balance = balance + ?, last_daily_claim = CURRENT_TIMESTAMP WHERE user_id = ?');
    return stmt.run(amount, userId);
};

// Atomik: balance yeterliyse düşür, yetmiyorsa false döner (TOCTOU-safe)
const deductBalance = (userId, amount) => {
    const result = db.prepare(
        'UPDATE users SET balance = balance - ? WHERE user_id = ? AND balance >= ?'
    ).run(amount, userId, amount);
    return result.changes > 0;
};

// Atomik transfer — transaction ile ikisi birlikte veya hiç
const transferBalance = (fromId, toId, amount) => {
    return db.transaction(() => {
        const ok = deductBalance(fromId, amount);
        if (!ok) return false;
        db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?').run(amount, toId);
        return true;
    })();
};

// Bahis serisi: doğru tahmin → artır, yanlış → sıfırla
const incrementStreak = (userId) => {
    db.prepare('UPDATE users SET bet_streak = bet_streak + 1 WHERE user_id = ?').run(userId);
    return db.prepare('SELECT bet_streak FROM users WHERE user_id = ?').get(userId)?.bet_streak || 0;
};

const resetStreak = (userId) => {
    db.prepare('UPDATE users SET bet_streak = 0 WHERE user_id = ?').run(userId);
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
