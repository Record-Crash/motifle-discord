# Motifle — Discord Activity

A Wordle-style game where players guess video game music leitmotifs, playable inside Discord voice channels as an Embedded Activity.

## Architecture

| Layer | Tech | Port | Entry point |
|-------|------|------|-------------|
| Server | Node.js + Express (ESM) | 3001 | `server/server.js` |
| Client | Svelte 4 + Vite | 5173 | `client/src/App.svelte` |
| Database | SQLite (better-sqlite3) | — | `server/db.js` |
| Discord bot | Gateway WebSocket + REST | — | `server/bot.js` |

Client proxies `/api`, `/audio`, `/images` to the server via Vite (`client/vite.config.js`).

## Key files

- `server/server.js` — Express app: OAuth2 token exchange, guess API, WebSocket, cron, image generation
- `server/bot.js` — Discord bot: posts/edits channel messages, daily summaries, canvas image rendering
- `server/db.js` — All DB access; tables: `guesses`, `session_messages`, `webhooks`, `channel_invites`
- `client/src/App.svelte` — Main component: Discord SDK init, game state, WebSocket, UI
- `client/src/models/Game.js` — Game logic: scoring, ballpark detection, error tracking
- `client/src/assets.js` — Audio/image URL helpers (CDN or local)
- `client/public/game_motifs.json` — Motif definitions (source of truth for guessing)
- `client/public/game_songs.json` — Song metadata

## Environment variables (`.env` in project root)

| Key | Purpose |
|-----|---------|
| `VITE_DISCORD_CLIENT_ID` | Discord OAuth2 client ID (also used in client) |
| `DISCORD_CLIENT_SECRET` | OAuth2 secret (server-only) |
| `DISCORD_BOT_TOKEN` | Bot token for posting messages |
| `DISCORD_PUBLIC_KEY` | Ed25519 key for verifying interaction signatures |
| `VITE_STATIC_BASE` | CDN root for audio/images (empty = served by Express) |
| `VITE_SERVER_BASE` | Public server URL for embed preview images (empty in local dev) |

## Dev commands

```bash
# Servers are auto-started on container start via scripts/dev-start.sh
# To restart manually:
bash scripts/dev-start.sh

# Check server health
tail -n 100 logs/server.log
tail -n 100 logs/client.log

# Check for errors
grep -i error logs/server.log | tail -n 20

# Check if processes are running
pgrep -a node
pgrep -a vite
```

## Known quirks

- **WSL2**: `@browser` tool not supported (Native Messaging doesn't cross WSL boundary)
- **Vite HMR**: Uses `usePolling: true` in vite.config.js — required for WSL2 file change detection
- **HMR port**: `clientPort: 443` — needed because the devcontainer forwards over HTTPS
- **`.env` location**: Root of repo, not inside `server/` or `client/` — both load from `../`
- **ESM**: Both server and client use ES modules (`"type": "module"` in server package.json)
- **No test suite** — verify changes by checking logs and browser

## DB schema (SQLite)

```sql
guesses(id, channel_id, date, user_id, username, avatar, motif_slug, guessed_at)
  UNIQUE(channel_id, date, user_id, motif_slug)
session_messages(channel_id, date, message_id)   -- tracks Discord message per session
webhooks(channel_id, webhook_id, webhook_token)
channel_invites(channel_id, invite_code)
```
