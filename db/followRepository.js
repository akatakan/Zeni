const { pool } = require('./db');

const follow = async (followerId, followedId, amount) => {
    await pool.query(`
        INSERT INTO follow_bets (follower_id, followed_id, amount)
        VALUES ($1, $2, $3)
        ON CONFLICT (follower_id, followed_id) DO UPDATE SET amount = EXCLUDED.amount
    `, [followerId, followedId, amount]);
};

const unfollow = async (followerId, followedId) => {
    const res = await pool.query(
        'DELETE FROM follow_bets WHERE follower_id = $1 AND followed_id = $2',
        [followerId, followedId]
    );
    return res.rowCount > 0;
};

const isFollowing = async (followerId, followedId) => {
    const res = await pool.query(
        'SELECT 1 FROM follow_bets WHERE follower_id = $1 AND followed_id = $2',
        [followerId, followedId]
    );
    return res.rows.length > 0;
};

const getFollowers = async (followedId) => {
    const res = await pool.query('SELECT * FROM follow_bets WHERE followed_id = $1', [followedId]);
    return res.rows;
};

const getFollowing = async (followerId) => {
    const res = await pool.query('SELECT * FROM follow_bets WHERE follower_id = $1', [followerId]);
    return res.rows;
};

module.exports = { follow, unfollow, isFollowing, getFollowers, getFollowing };
