import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { readFileSync } from "fs";
import cron from "node-cron";
import { insertGuess, getGuesses, storeWebhook, upsertSessionError } from "./db.js";
import { upsertBotMessage, postDailySummaries, startGateway } from "./bot.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, "../.env") });

const port = process.env.PORT ?? 3001;

GlobalFonts.registerFromPath(path.join(__dirname, "fonts/Inter-Regular.otf"), "Inter");
GlobalFonts.registerFromPath(path.join(__dirname, "fonts/Inter-Bold.otf"), "Inter");

app.use(express.json());

// ---------------------------------------------------------------------------
// Game data (loaded once at startup for preview image generation)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, "../client/public");
const EPOCH = new Date("2023-08-09T00:00:00Z");

let gameSongs = [];
let gameMotifs = {};

try {
  gameSongs = JSON.parse(readFileSync(path.join(DATA_DIR, "game_songs.json"), "utf8"));
  const motifsArr = JSON.parse(readFileSync(path.join(DATA_DIR, "game_motifs.json"), "utf8"));
  gameMotifs = Object.fromEntries(motifsArr.map((m) => [m.slug, m]));
  console.log(`Loaded ${gameSongs.length} songs, ${Object.keys(gameMotifs).length} motifs`);
} catch (e) {
  console.warn("Could not load game data for preview generation:", e.message);
}

function songForDate(dateString) {
  const date = new Date(dateString + "T00:00:00Z");
  const days = Math.round((date - EPOCH) / (1000 * 60 * 60 * 24));
  const index = ((days % gameSongs.length) + gameSongs.length) % gameSongs.length;
  return gameSongs[index] ?? null;
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------
app.use("/audio", express.static(path.join(__dirname, "audio")));
app.use("/images", express.static(path.join(__dirname, "images")));

// ---------------------------------------------------------------------------
// OAuth2 token exchange
// ---------------------------------------------------------------------------
app.post("/api/token", async (req, res) => {
  console.log("[token] req.body:", req.body);
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });
  const body = await response.json();
  console.log("[token] Discord response status:", response.status, "body:", JSON.stringify(body));
  const { access_token, webhook } = body;
  console.log("[token] webhook:", JSON.stringify(webhook));
  if (webhook?.id && webhook?.channel_id) {
    storeWebhook(webhook.channel_id, webhook.id, webhook.token);
    console.log(`[token] stored webhook for channel ${webhook.channel_id}`);
  }
  res.send({ access_token });
});

// ---------------------------------------------------------------------------
// Debounced bot message updates (prevents Discord rate limit hits)
// ---------------------------------------------------------------------------
const pendingBotUpdates = new Map(); // key -> { timer, done }
const BOT_DEBOUNCE_MS = 1500;

function scheduleBotMessage(channelId, date, done) {
  const key = `${channelId}:${date}`;
  const existing = pendingBotUpdates.get(key);

  // done=true is sticky: once set, always use true
  const nextDone = done || (existing?.done ?? false);

  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pendingBotUpdates.delete(key);
    upsertBotMessage(channelId, date, nextDone, gameSongs, gameMotifs)
      .catch((e) => console.warn("[bot]", e.message));
  }, BOT_DEBOUNCE_MS);

  pendingBotUpdates.set(key, { timer, done: nextDone });
}

// ---------------------------------------------------------------------------
// Guess API
// ---------------------------------------------------------------------------
app.post("/api/guess", (req, res) => {
  const { channelId, date, userId, username, avatar, motifSlug } = req.body;
  if (!channelId || !date || !userId || !motifSlug) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  insertGuess({ channelId, date, userId, username, avatar, motifSlug });
  broadcastToRoom(channelId, date, { type: "guess", userId, username, avatar, motifSlug });
  scheduleBotMessage(channelId, date, false);
  res.json({ ok: true });
});

app.get("/api/guesses", (req, res) => {
  const { channelId, date } = req.query;
  if (!channelId || !date) return res.status(400).json({ error: "Missing channelId or date" });
  res.json(getGuesses(channelId, date));
});

app.post("/api/session-error", (req, res) => {
  const { channelId, date, userId, errorCount } = req.body;
  if (!channelId || !date || !userId || errorCount == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  upsertSessionError(channelId, date, userId, errorCount);
  res.json({ ok: true });
});

app.post("/api/session-update", (req, res) => {
  const { channelId, date, done } = req.body;
  if (!channelId || !date) return res.status(400).json({ error: "Missing channelId or date" });
  scheduleBotMessage(channelId, date, !!done);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Preview image endpoint — single player
// ---------------------------------------------------------------------------
const RARITY_COLORS = { 5: "#5865f2", 4: "#fee75c", 3: "#57f287", 2: "#5865f2", 1: "#eb459e" };
const RARITY_BG     = { 5: "#3c45c5", 4: "#d4af00", 3: "#2d8a50", 2: "#3c45c5", 1: "#a0295c" };
const RARITY_POINTS = { 1: 500, 2: 250, 3: 175, 4: 125, 5: 100 };

app.get("/api/preview/:channelId/:userId/:date.png", (req, res) => {
  try {
    const { channelId, userId, date } = req.params;
    const song = songForDate(date);

    const allGuesses = getGuesses(channelId, date);
    const userGuessed = new Set(
      allGuesses.filter((g) => g.userId === userId).map((g) => g.motifSlug)
    );

    const motifList = (song?.leitmotifs ?? [])
      .map((slug) => gameMotifs[slug])
      .filter(Boolean)
      .sort((a, b) => b.rarity - a.rarity);

    const maxPoints = motifList.reduce((s, m) => s + (RARITY_POINTS[m.rarity] ?? 0), 0);
    const points = motifList.reduce((s, m) =>
      userGuessed.has(m.slug) ? s + (RARITY_POINTS[m.rarity] ?? 0) : s, 0);
    const nGuessed = motifList.filter((m) => userGuessed.has(m.slug)).length;

    const W = 1280, H = 720;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 48px Inter";
    ctx.textAlign = "center";
    ctx.fillText("Motifle", W / 2, 90);

    ctx.fillStyle = "#b5bac1";
    ctx.font = "32px Inter";
    ctx.fillText(date, W / 2, 140);

    const sqSize = 64, sqGap = 12;
    const totalW = motifList.length * sqSize + (motifList.length - 1) * sqGap;
    let sx = (W - totalW) / 2;
    const sy = 220;

    for (const motif of motifList) {
      const guessed = userGuessed.has(motif.slug);
      ctx.fillStyle = guessed ? (RARITY_BG[motif.rarity] ?? "#5865f2") : "#313338";
      ctx.beginPath();
      ctx.roundRect(sx, sy, sqSize, sqSize, 8);
      ctx.fill();
      if (guessed) {
        ctx.fillStyle = RARITY_COLORS[motif.rarity] ?? "#5865f2";
        ctx.beginPath();
        ctx.roundRect(sx + 4, sy + 4, sqSize - 8, sqSize - 8, 5);
        ctx.fill();
      }
      sx += sqSize + sqGap;
    }

    ctx.fillStyle = "#b5bac1";
    ctx.font = "28px Inter";
    ctx.textAlign = "center";
    ctx.fillText(`${nGuessed} / ${motifList.length} motifs`, W / 2, sy + sqSize + 50);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 56px Inter";
    ctx.fillText(`${points}`, W / 2, sy + sqSize + 120);
    ctx.fillStyle = "#b5bac1";
    ctx.font = "28px Inter";
    ctx.fillText(`/ ${maxPoints} pts`, W / 2, sy + sqSize + 165);

    if (song && nGuessed === motifList.length) {
      ctx.fillStyle = "#b5bac1";
      ctx.font = "italic 24px Inter";
      ctx.fillText(song.name, W / 2, sy + sqSize + 215);
    }

    const buf = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) {
    console.error("Preview generation error:", err);
    res.status(500).send("Error generating preview");
  }
});

// ---------------------------------------------------------------------------
// Preview image endpoint — group (all players)
// ---------------------------------------------------------------------------
app.get("/api/preview-group/:channelId/:date.png", (req, res) => {
  try {
    const { channelId, date } = req.params;
    const song = songForDate(date);
    const allGuesses = getGuesses(channelId, date);

    const motifList = (song?.leitmotifs ?? [])
      .map((slug) => gameMotifs[slug])
      .filter(Boolean)
      .sort((a, b) => b.rarity - a.rarity);

    // Aggregate per user (preserve first username seen)
    const byUser = new Map();
    for (const g of allGuesses) {
      if (!byUser.has(g.userId)) {
        byUser.set(g.userId, { userId: g.userId, username: g.username ?? g.userId, slugs: new Set() });
      }
      byUser.get(g.userId).slugs.add(g.motifSlug);
    }

    let players = [...byUser.values()].map((u) => {
      const pts = motifList.reduce((s, m) => u.slugs.has(m.slug) ? s + (RARITY_POINTS[m.rarity] ?? 0) : s, 0);
      return { ...u, pts };
    });
    players.sort((a, b) => b.pts - a.pts);
    players = players.slice(0, 12);

    // Canvas layout
    const W = 1280, H = 720;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 40px Inter";
    ctx.textAlign = "center";
    ctx.fillText("Motifle", W / 2, 52);
    ctx.fillStyle = "#b5bac1";
    ctx.font = "28px Inter";
    ctx.fillText(date, W / 2, 90);

    if (players.length === 0) {
      ctx.fillStyle = "#b5bac1";
      ctx.font = "24px Inter";
      ctx.fillText("No guesses yet", W / 2, 400);
      const buf = canvas.toBuffer("image/png");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.send(buf);
    }

    // Grid: 3 columns, up to 4 rows
    const COLS = 3;
    const PANEL_GAP = 16;
    const PANEL_W = Math.floor((W - (COLS + 1) * PANEL_GAP) / COLS); // ~400px
    const PANEL_H = 148;
    const GRID_TOP = 110;

    for (let i = 0; i < players.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const px = PANEL_GAP + col * (PANEL_W + PANEL_GAP);
      const py = GRID_TOP + row * (PANEL_H + PANEL_GAP);

      const p = players[i];

      // Panel background
      ctx.fillStyle = "#313338";
      ctx.beginPath();
      ctx.roundRect(px, py, PANEL_W, PANEL_H, 10);
      ctx.fill();

      // Username
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 18px Inter";
      ctx.textAlign = "left";
      const name = p.username.length > 20 ? p.username.slice(0, 19) + "…" : p.username;
      ctx.fillText(name, px + 12, py + 26);

      // Motif squares
      const sqSize = 22, sqGap = 5;
      let sx = px + 12;
      const sy = py + 40;
      for (const motif of motifList) {
        const guessed = p.slugs.has(motif.slug);
        ctx.fillStyle = guessed ? (RARITY_BG[motif.rarity] ?? "#5865f2") : "#1e1f22";
        ctx.beginPath();
        ctx.roundRect(sx, sy, sqSize, sqSize, 4);
        ctx.fill();
        if (guessed) {
          ctx.fillStyle = RARITY_COLORS[motif.rarity] ?? "#5865f2";
          ctx.beginPath();
          ctx.roundRect(sx + 2, sy + 2, sqSize - 4, sqSize - 4, 3);
          ctx.fill();
        }
        sx += sqSize + sqGap;
        // Wrap to second row if many motifs
        if (sx + sqSize > px + PANEL_W - 12) {
          sx = px + 12;
        }
      }

      // Score
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px Inter";
      ctx.textAlign = "right";
      ctx.fillText(`${p.pts} pts`, px + PANEL_W - 12, py + PANEL_H - 12);
    }

    const buf = canvas.toBuffer("image/png");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (err) {
    console.error("Group preview generation error:", err);
    res.status(500).send("Error generating group preview");
  }
});

// ---------------------------------------------------------------------------
// Debug endpoint — trigger daily summary manually
// ---------------------------------------------------------------------------
app.post("/api/debug/daily-summary", async (req, res) => {
  const date = req.query.date ?? new Date().toISOString().slice(0, 10);
  try {
    await postDailySummaries(date, gameSongs, gameMotifs);
    res.json({ ok: true, date });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Midnight cron — daily summary
// ---------------------------------------------------------------------------
cron.schedule("0 0 * * *", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  console.log(`[cron] posting daily summaries for ${yesterday}`);
  postDailySummaries(yesterday, gameSongs, gameMotifs).catch((e) =>
    console.warn("[cron] daily summary failed:", e.message)
  );
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// rooms: Map<"channelId:date", Set<WebSocket>>
const rooms = new Map();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const channelId = url.searchParams.get("channelId");
  const date      = url.searchParams.get("date");

  if (!channelId || !date) { ws.close(); return; }

  const key = `${channelId}:${date}`;
  if (!rooms.has(key)) rooms.set(key, new Set());
  rooms.get(key).add(ws);

  ws.on("close", () => {
    rooms.get(key)?.delete(ws);
    if (rooms.get(key)?.size === 0) {
      rooms.delete(key);
      scheduleBotMessage(channelId, date, true);
    }
  });
});

function broadcastToRoom(channelId, date, payload) {
  const room = rooms.get(`${channelId}:${date}`);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const client of room) {
    if (client.readyState === 1 /* OPEN */) client.send(msg);
  }
}

// Serve built Svelte client (production only — in dev Vite handles this)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '../client/dist/index.html'))
);

server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
  startGateway();
});
