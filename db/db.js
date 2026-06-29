const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'japbet.db'));
db.pragma('FOREIGN_KEYS = ON');

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    balance INTEGER DEFAULT 1000,
    last_daily_claim DATETIME DEFAULT NULL,
    bet_streak INTEGER DEFAULT 0
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS matches_bets (
    match_id    TEXT PRIMARY KEY,
    creator_id  TEXT,
    is_open     INTEGER DEFAULT 1,
    started_at  INTEGER,
    closed_at   DATETIME,
    summoner_id TEXT,
    region      TEXT,
    channel_id  TEXT,
    mode        TEXT DEFAULT 'classic',
    FOREIGN KEY(creator_id) REFERENCES users(user_id) ON DELETE CASCADE
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS bets (
    bet_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id      TEXT,
    user_id       TEXT,
    amount        INTEGER,
    prediction    TEXT,
    won           INTEGER DEFAULT NULL,
    tournament_id INTEGER DEFAULT NULL,
    joined_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(match_id)      REFERENCES matches_bets(match_id) ON DELETE CASCADE,
    FOREIGN KEY(user_id)       REFERENCES users(user_id) ON DELETE SET NULL,
    FOREIGN KEY(tournament_id) REFERENCES tournaments(tournament_id) ON DELETE SET NULL,
    UNIQUE(match_id, user_id)
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id       TEXT PRIMARY KEY,
    api_key        TEXT UNIQUE,
    webhook_url    TEXT,
    webhook_secret TEXT,
    is_premium     INTEGER DEFAULT 0,
    premium_until  DATETIME DEFAULT NULL,
    license_key    TEXT UNIQUE,
    locale         TEXT DEFAULT 'tr'
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS follow_bets (
    follower_id TEXT NOT NULL,
    followed_id TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followed_id)
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS tournaments (
    tournament_id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL,
    status        TEXT DEFAULT 'active',
    entry_fee     INTEGER DEFAULT 500,
    prize_pool    INTEGER DEFAULT 0,
    started_at    INTEGER,
    ends_at       INTEGER
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS tournament_participants (
    tournament_id       INTEGER NOT NULL,
    user_id             TEXT NOT NULL,
    tournament_balance  INTEGER NOT NULL,
    eliminated          INTEGER DEFAULT 0,
    PRIMARY KEY (tournament_id, user_id),
    FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id) ON DELETE CASCADE
);
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS twitch_tracking (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
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
);
`).run();

// Migrations: eski kurulumlar için eksik sütunları ekle
try { db.prepare('ALTER TABLE users         ADD COLUMN bet_streak INTEGER DEFAULT 0').run(); }      catch (_) {}
try { db.prepare('ALTER TABLE bets          ADD COLUMN won INTEGER DEFAULT NULL').run(); }           catch (_) {}
try { db.prepare('ALTER TABLE bets          ADD COLUMN tournament_id INTEGER DEFAULT NULL').run(); } catch (_) {}
try { db.prepare('ALTER TABLE matches_bets  ADD COLUMN channel_id TEXT').run(); }                   catch (_) {}
try { db.prepare("ALTER TABLE matches_bets  ADD COLUMN mode TEXT DEFAULT 'classic'").run(); }       catch (_) {}
try { db.prepare('ALTER TABLE guild_settings ADD COLUMN is_premium INTEGER DEFAULT 0').run(); }     catch (_) {}
try { db.prepare('ALTER TABLE guild_settings ADD COLUMN premium_until DATETIME').run(); }           catch (_) {}
try { db.prepare('ALTER TABLE guild_settings ADD COLUMN license_key TEXT').run(); }                 catch (_) {}
try { db.prepare("ALTER TABLE guild_settings ADD COLUMN locale TEXT DEFAULT 'tr'").run(); }         catch (_) {}

module.exports = db;
