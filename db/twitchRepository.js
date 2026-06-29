const { pool } = require('./db');

const addTracking = async (guildId, channelName, channelId, summonerName, tagline, region, minBet, discordChannelId) => {
    await pool.query(`
        INSERT INTO twitch_tracking
            (guild_id, twitch_channel_name, twitch_channel_id, summoner_name, tagline, region, min_bet, discord_channel_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (guild_id, twitch_channel_name) DO UPDATE SET
            twitch_channel_id  = EXCLUDED.twitch_channel_id,
            summoner_name      = EXCLUDED.summoner_name,
            tagline            = EXCLUDED.tagline,
            region             = EXCLUDED.region,
            min_bet            = EXCLUDED.min_bet,
            discord_channel_id = EXCLUDED.discord_channel_id
    `, [guildId, channelName, channelId, summonerName, tagline, region, minBet, discordChannelId]);
};

const removeTracking = async (guildId, channelName) => {
    const res = await pool.query(
        'DELETE FROM twitch_tracking WHERE guild_id = $1 AND twitch_channel_name = $2',
        [guildId, channelName]
    );
    return res.rowCount > 0;
};

const getTrackingsByGuild = async (guildId) => {
    const res = await pool.query('SELECT * FROM twitch_tracking WHERE guild_id = $1', [guildId]);
    return res.rows;
};

const getAllTrackings = async () => {
    const res = await pool.query('SELECT * FROM twitch_tracking');
    return res.rows;
};

const getTrackingByChannelId = async (channelId) => {
    const res = await pool.query('SELECT * FROM twitch_tracking WHERE twitch_channel_id = $1', [channelId]);
    return res.rows[0];
};

const setEventSubId = async (id, eventsubId) => {
    await pool.query('UPDATE twitch_tracking SET eventsub_id = $1 WHERE id = $2', [eventsubId, id]);
};

module.exports = {
    addTracking,
    removeTracking,
    getTrackingsByGuild,
    getAllTrackings,
    getTrackingByChannelId,
    setEventSubId,
};
