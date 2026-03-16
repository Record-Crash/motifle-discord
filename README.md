# Motifle

A Wordle-style music guessing game for Discord voice channels. Each day, players listen to a Homestuck fan song and identify its leitmotifs, the recurring melodies sampled or referenced in the track. Built as a Discord [Embedded Activity](https://discord.com/developers/docs/activities/overview).

## How it works

- A new song is played each day (rotates through a pool of Creative Commons Homestuck fan music, think UMSPAF)
- Players guess which leitmotifs appear in the song using a search bar
- Motifs are scored by rarity (100–500 pts); wrong guesses cost a life
- Results are posted to the Discord channel

All audio is sourced from [HS Music Wiki](https://hsmusic.wiki) and licensed under Creative Commons.

## Stack

| Layer | Tech |
|-------|------|
| Server | Node.js + Express (ESM) |
| Client | Svelte 5 + Vite 8 |
| Database | SQLite (better-sqlite3) |
| Discord bot | Gateway WebSocket + REST |

## Setup

### Prerequisites

- Node.js 20+
- Python 3.10+ with `pip install pyyaml requests Pillow yt-dlp`
- `ffmpeg` on PATH
- A Discord application with Embedded Activity enabled ([Developer Portal](https://discord.com/developers/applications))

### 1. Clone and configure

```bash
git clone <this-repo>
cd motifle-discord
cp .env.example .env
# Fill in your Discord credentials in .env
```

### 2. Generate game data

Requires a local clone of [hsmusic-data](https://github.com/hsmusic/hsmusic-data) at `old-app/hsmusic-data/`.

```bash
python3 musicToSongs.py        # generates game_songs.json, game_motifs.json, download CSVs
python3 download-audio.py      # downloads audio as .opus (resumable)
python3 resize-images.py       # resizes album art to 60×60
```

### 3. Run in dev

```bash
bash scripts/dev-start.sh
```

This starts the Express server (port 3001) and the Vite dev server (port 5173). The client proxies all API/asset requests to Express.

To expose the activity to Discord during development, use a tunnel (e.g. Cloudflare Tunnel) pointing at port 5173, and update the URL mapping in the Discord Developer Portal.

### 4. Deploy to production

See `deploy/motifle.service` for a systemd unit template and `.github/workflows/main.yml` for the GitHub Actions auto-deploy workflow (push to master → SSH → git pull → build → restart).

```bash
# On the server, first-time setup:
cd client && npm ci && npm run build
cd ../server && npm ci --omit=dev
sudo cp ../deploy/motifle.service /etc/systemd/system/motifle.service
# Edit the service file to set the correct Node path (run: nvm which 20)
sudo systemctl daemon-reload && sudo systemctl enable --now motifle
```

In production, Express serves the built Svelte client as static files — no Vite process needed.

## Environment variables

See `.env.example` for the full list. Key variables:

| Variable | Purpose |
|----------|---------|
| `VITE_DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_CLIENT_SECRET` | OAuth2 secret |
| `DISCORD_BOT_TOKEN` | Bot token for posting channel messages |
| `VITE_SERVER_BASE` | Public URL of the server (for embed preview images) |
| `PORT` | Express listen port (default: 3001) |

## Credits

- **Makin** — Developer
- **[HS Music Wiki](https://hsmusic.wiki)** — Data sourcing (quasarNebula, Niklink, and contributors)
- **The Homestuck Music Team and fan composers** — CANMT, UMSPAF, and others

All fan music used is licensed under Creative Commons.
