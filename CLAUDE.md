# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Zeni** — A Discord.js v14 bot that lets server members bet on live League of Legends matches using a virtual currency (JP). Written in Node.js (CommonJS). All user-facing text is in Turkish via `locales/tr.json`.

## Commands

```bash
# Install dependencies
yarn install

# Register slash commands with Discord (run after adding/changing commands)
node deploy-commands.js

# Start the bot
node index.js

# Lint
npx eslint .
```

No build step or test suite exists. Set `LOG_LEVEL=debug` in `.env` to enable verbose polling logs.

## Required Environment Variables (`.env`)

```
TOKEN=                        # Discord bot token (required)
CLIENT_ID=                    # Discord application client ID (required)
GUILD_ID=                     # Discord server ID for slash command registration
RIOT_API_KEY=                 # Riot Games API key (required)
API_PORT=3000                 # REST API port (default: 3000)
LEMONSQUEEZY_API_KEY=         # LemonSqueezy API key
LEMONSQUEEZY_WEBHOOK_SECRET=  # LemonSqueezy webhook HMAC secret
```

`TOKEN`, `CLIENT_ID`, and `RIOT_API_KEY` are validated at startup — the process exits immediately with a clear error if any are missing.

## Project Structure

```
commands/
  admin/      — activate.js, apisetup.js  (server-admin only)
  betting/    — bet.js                    (core match betting)
  economy/    — daily.js, give.js, leaderboard.js
  general/    — help.js, ping.js
db/
  db.js             — SQLite connection + schema (CREATE TABLE + ALTER migrations)
  userRepository.js — user balance CRUD + atomic ops
  betRepository.js  — match/bet CRUD + limit queries
  guildRepository.js — guild settings, premium, locale
events/
  interactionCreate.js — single handler: routes commands, buttons, modals
  ready.js             — champion cache load + crash-recovery for open matches
  guildCreate.js       — auto-creates guild_settings on server join
services/
  riot.js           — Riot API client (rate-limit aware, region-routed)
  lemonsqueezy.js   — license activation + webhook HMAC verification
  webhookEmitter.js — signed outbound webhook POST
util/
  watchmatch.js   — polls Riot API every 30s until match ends (Map-based timers)
  resolveMatch.js — pays out winners, refunds on failure, builds result embed
  championCache.js — Data Dragon champion ID→name cache (refreshes every 6h)
  i18n.js         — t(key, vars, locale) + useT(interaction) guild-locale binding
  colors.js       — Discord embed color constants
  logger.js       — timestamp logger (LOG_LEVEL env, wraps console)
  premiumGuard.js — requirePremium(interaction) helper
api/
  server.js       — Express REST API: balance query/deduct + LemonSqueezy webhook
locales/
  tr.json         — all user-facing strings
```

## Architecture

### Entry Point & Bootstrapping

`index.js` validates env vars, starts the Express API server, dynamically loads all `.js` files under `commands/` subdirectories, and registers all event handlers from `events/`. Commands export `{ data: SlashCommandBuilder, execute }`. Events export `{ name, once?, execute }`.

### Interaction Routing

All Discord interactions go through a single `events/interactionCreate.js` handler which dispatches to `handleCommand`, `handleButton`, or `handleModal` based on interaction type.

### Core Betting Flow

1. `/bet` checks freemium limits (3 daily / 1 simultaneous for free guilds), fetches the active match from Riot API, displays teams/champions/bans embed, writes `matches_bets` row with `started_at = Date.now() - gameLength*1000`.
2. User clicks "Bahis Yap" button → time check uses `Date.now() - match.started_at` (no Riot API call) → modal shown.
3. User submits modal → `deductBalance` (atomic SQL) deducts JP → `addBet` inserts → embed updated with current bets.
4. `watchMatchEnd` polls `isMatchEnd` every 30s. On match end → `resolveMatch` waits 30s for Riot data → pays `amount*2` to correct predictors → refunds all if result unavailable.

### Database

SQLite via `better-sqlite3` (synchronous, intentional). File: `japbet.db` at project root (absolute path, CWD-independent).

- **users**: `user_id`, `balance` (default 1000 JP), `last_daily_claim`
- **matches_bets**: one row per watched match; `started_at` = Unix ms timestamp; `is_open` flag
- **bets**: `UNIQUE(match_id, user_id)` — one bet per user per match
- **guild_settings**: API key, webhook URL, premium status, license key, locale

`db.js` defines the full schema in `CREATE TABLE IF NOT EXISTS` plus `ALTER TABLE` migration stubs for existing databases.

### Riot API (`services/riot.js`)

Singleton `RiotAPI` instance. Reads `Retry-After` headers on 429, exponential backoff. Region routing: `regionToCluster()` maps short codes (`EUW`, `TR`, `KR`…) to Riot's regional clusters (`europe`, `asia`, `americas`).

### Freemium Model

- **Free**: 3 matches/day per user, 1 simultaneous open bet
- **Premium**: unlimited (checked via `isPremium(guildId)` from `guildRepository`)
- Limits enforced in `commands/betting/bet.js` before any API calls
- Activate with `/activate <licenseKey>` (LemonSqueezy license)

### i18n

`util/i18n.js` exports `t(key, vars, locale)` and `useT(interaction)`. `useT` binds to the guild's locale (default `'tr'`) via `getGuildLocale`. All user-facing strings in `locales/tr.json`.

### REST API (`api/server.js`)

- `GET /api/balance/:userId` — query JP balance (Bearer API key auth)
- `POST /api/balance/deduct` — deduct JP atomically (Bearer API key auth)
- `POST /api/lemonsqueezy/webhook` — HMAC-verified subscription lifecycle events

Rate limited: 60 req/min general, 10 req/min for deduct. Webhook URL validation: https-only, blocks private IP ranges (SSRF protection).

### Business Rules

- Bets accepted only within first 5 minutes of match start (checked via DB timestamp, no API call)
- `deductBalance` is atomic (`UPDATE ... WHERE balance >= ?`) — no race conditions
- `transferBalance` (give.js) wraps in a SQLite transaction
- Leaderboard `/lb` hardcodes a display-name easter egg for one specific Discord user ID
