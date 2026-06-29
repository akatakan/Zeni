const db = require('./db');

const addTracking = (guildId, channelName, channelId, summonerName, tagline, region, minBet, discordChannelId) => {
    db.prepare(`
        INSERT INTO twitch_tracking
            (guild_id, twitch_channel_name, twitch_channel_id, summoner_name, tagline, region, min_bet, discord_channel_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, twitch_channel_name) DO UPDATE SET
            twitch_channel_id  = excluded.twitch_channel_id,
            summoner_name      = excluded.summoner_name,
            tagline            = excluded.tagline,
            region             = excluded.region,
            min_bet            = excluded.min_bet,
            discord_channel_id = excluded.discord_channel_id
    `).run(guildId, channelName, channelId, summonerName, tagline, region, minBet, discordChannelId);
};

const removeTracking = (guildId, channelName) => {
    return db.prepare('DELETE FROM twitch_tracking WHERE guild_id = ? AND twitch_channel_name = ?')
        .run(guildId, channelName).changes > 0;
};

const getTrackingsByGuild = (guildId) => {
    return db.prepare('SELECT * FROM twitch_tracking WHERE guild_id = ?').all(guildId);
};

const getAllTrackings = () => {
    return db.prepare('SELECT * FROM twitch_tracking').all();
};

const getTrackingByChannelId = (channelId) => {
    return db.prepare('SELECT * FROM twitch_tracking WHERE twitch_channel_id = ?').get(channelId);
};

const setEventSubId = (id, eventsubId) => {
    db.prepare('UPDATE twitch_tracking SET eventsub_id = ? WHERE id = ?').run(eventsubId, id);
};

module.exports = {
    addTracking,
    removeTracking,
    getTrackingsByGuild,
    getAllTrackings,
    getTrackingByChannelId,
    setEventSubId,
};
