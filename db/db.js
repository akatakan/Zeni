const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const initDb = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id          TEXT PRIMARY KEY,
            username         TEXT,
            balance          INTEGER DEFAULT 1000,
            last_daily_claim TIMESTAMPTZ DEFAULT NULL,
            bet_streak       INTEGER DEFAULT 0
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS matches_bets (
            match_id    TEXT PRIMARY KEY,
            creator_id  TEXT REFERENCES users(user_id) ON DELETE CASCADE,
            is_open     SMALLINT DEFAULT 1,
            started_at  BIGINT,
            closed_at   TIMESTAMPTZ,
            summoner_id TEXT,
            region      TEXT,
            channel_id  TEXT,
            mode        TEXT DEFAULT 'classic'
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tournaments (
            tournament_id SERIAL PRIMARY KEY,
            guild_id      TEXT NOT NULL,
            status        TEXT DEFAULT 'active',
            entry_fee     INTEGER DEFAULT 500,
            prize_pool    INTEGER DEFAULT 0,
            started_at    BIGINT,
            ends_at       BIGINT
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS bets (
            bet_id        SERIAL PRIMARY KEY,
            match_id      TEXT REFERENCES matches_bets(match_id) ON DELETE CASCADE,
            user_id       TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            amount        INTEGER,
            prediction    TEXT,
            won           SMALLINT DEFAULT NULL,
            tournament_id INTEGER REFERENCES tournaments(tournament_id) ON DELETE SET NULL,
            joined_at     TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(match_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id       TEXT PRIMARY KEY,
            api_key        TEXT UNIQUE,
            webhook_url    TEXT,
            webhook_secret TEXT,
            is_premium     SMALLINT DEFAULT 0,
            premium_until  TIMESTAMPTZ DEFAULT NULL,
            license_key    TEXT UNIQUE,
            locale         TEXT DEFAULT 'tr'
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS follow_bets (
            follower_id TEXT NOT NULL,
            followed_id TEXT NOT NULL,
            amount      INTEGER NOT NULL,
            PRIMARY KEY (follower_id, followed_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tournament_participants (
            tournament_id      INTEGER NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
            user_id            TEXT NOT NULL,
            tournament_balance INTEGER NOT NULL,
            eliminated         SMALLINT DEFAULT 0,
            PRIMARY KEY (tournament_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS twitch_tracking (
            id                  SERIAL PRIMARY KEY,
            guild_id            TEXT NOT NULL,
            twitch_channel_name TEXT NOT NULL,
            twitch_channel_id   TEXT,
            summoner_name       TEXT NOT NULL,
            tagline             TEXT NOT NULL,
            region              TEXT NOT NULL,
            min_bet             INTEGER DEFAULT 50,
            discord_channel_id  TEXT NOT NULL,
            eventsub_id         TEXT,
            UNIQUE(guild_id, twitch_channel_name)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS side_bets (
            side_bet_id SERIAL PRIMARY KEY,
            match_id    TEXT NOT NULL REFERENCES matches_bets(match_id) ON DELETE CASCADE,
            user_id     TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            event_type  TEXT NOT NULL,
            prediction  TEXT NOT NULL,
            amount      INTEGER NOT NULL,
            won         SMALLINT DEFAULT NULL,
            placed_at   BIGINT,
            UNIQUE(match_id, user_id, event_type)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS risk_users (
            guild_id   TEXT NOT NULL,
            user_id    TEXT NOT NULL,
            reason     TEXT,
            flagged_by TEXT,
            flagged_at BIGINT,
            PRIMARY KEY (guild_id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS reports (
            report_id   SERIAL PRIMARY KEY,
            guild_id    TEXT NOT NULL,
            reporter_id TEXT NOT NULL,
            reported_id TEXT NOT NULL,
            match_id    TEXT,
            reason      TEXT,
            created_at  BIGINT
        )
    `);
};

module.exports = { pool, initDb };
