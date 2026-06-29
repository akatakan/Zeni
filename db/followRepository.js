const db = require('./db');

const follow = (followerId, followedId, amount) => {
    db.prepare(`
        INSERT INTO follow_bets (follower_id, followed_id, amount)
        VALUES (?, ?, ?)
        ON CONFLICT(follower_id, followed_id) DO UPDATE SET amount = excluded.amount
    `).run(followerId, followedId, amount);
};

const unfollow = (followerId, followedId) => {
    return db.prepare('DELETE FROM follow_bets WHERE follower_id = ? AND followed_id = ?')
        .run(followerId, followedId).changes > 0;
};

const isFollowing = (followerId, followedId) => {
    return !!db.prepare('SELECT 1 FROM follow_bets WHERE follower_id = ? AND followed_id = ?')
        .get(followerId, followedId);
};

// Takipçi listesi (X'i kimin takip ettiği)
const getFollowers = (followedId) => {
    return db.prepare('SELECT * FROM follow_bets WHERE followed_id = ?').all(followedId);
};

// Takip listesi (X'in kimleri takip ettiği)
const getFollowing = (followerId) => {
    return db.prepare('SELECT * FROM follow_bets WHERE follower_id = ?').all(followerId);
};

module.exports = { follow, unfollow, isFollowing, getFollowers, getFollowing };
