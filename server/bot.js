import fetch from "node-fetch";
import WebSocket from "ws";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { getGuesses, getAllChannelsForDate, getSessionMessage, upsertSessionMessage } from "./db.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
GlobalFonts.registerFromPath(path.join(__dirname, "fonts/Inter-Regular.otf"), "Inter");
GlobalFonts.registerFromPath(path.join(__dirname, "fonts/Inter-Bold.otf"), "Inter");

const DISCORD_API = "https://discord.com/api/v10";
const RARITY_POINTS = { 1: 500, 2: 250, 3: 175, 4: 125, 5: 100 };
const RARITY_COLORS = { 5: "#5865f2", 4: "#fee75c", 3: "#57f287", 2: "#5865f2", 1: "#eb459e" };
const RARITY_BG     = { 5: "#3c45c5", 4: "#d4af00", 3: "#2d8a50", 2: "#3c45c5", 1: "#a0295c" };

function botFetch(path, options = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN not set");
  return fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

function buildContentText(players, done) {
  if (players.length === 0) return done ? "Someone was playing Motifle" : "Someone is playing Motifle";
  const names = players.map((p) => p.username);
  let joined;
  if (names.length === 1) {
    joined = `**${names[0]}**`;
  } else {
    joined = `**${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}**`;
  }
  const verb = done
    ? (names.length === 1 ? "was" : "were")
    : (names.length === 1 ? "is" : "are");
  return `${joined} ${verb} playing Motifle`;
}

function songForDate(date, gameSongs) {
  const EPOCH = new Date("2023-08-09T00:00:00Z");
  const d = new Date(date + "T00:00:00Z");
  const days = Math.round((d - EPOCH) / 86400000);
  const idx = ((days % gameSongs.length) + gameSongs.length) % gameSongs.length;
  return gameSongs[idx] ?? null;
}

async function renderGroupPreview(allGuesses, gameSongs, gameMotifs, date) {
  const song = songForDate(date, gameSongs);
  const motifList = (song?.leitmotifs ?? [])
    .map((slug) => gameMotifs[slug])
    .filter(Boolean)
    .sort((a, b) => b.rarity - a.rarity);

  // Aggregate per user
  const byUser = new Map();
  for (const g of allGuesses) {
    if (!byUser.has(g.userId)) {
      byUser.set(g.userId, { userId: g.userId, username: g.username ?? g.userId, avatar: g.avatar ?? null, slugs: new Set() });
    }
    byUser.get(g.userId).slugs.add(g.motifSlug);
  }
  let players = [...byUser.values()].map((u) => {
    const pts = motifList.reduce((s, m) => u.slugs.has(m.slug) ? s + (RARITY_POINTS[m.rarity] ?? 0) : s, 0);
    return { ...u, pts };
  });
  players.sort((a, b) => b.pts - a.pts);
  players = players.slice(0, 12);

  const n = players.length;
  const COLS = n <= 1 ? 1 : n <= 2 ? 2 : 3;
  const ROWS = Math.ceil(Math.max(n, 1) / COLS);

  // Per-player sizing: larger panels when fewer players
  const SQ_SIZE = n <= 1 ? 36 : n <= 4 ? 28 : 22;
  const SQ_GAP  = n <= 1 ? 7  : n <= 4 ? 6  : 5;
  const NAME_FONT = n <= 1 ? 22 : n <= 2 ? 20 : 18;
  const SCORE_FONT = n <= 1 ? 28 : n <= 2 ? 24 : 22;
  const PANEL_GAP = 16;
  const HEADER_H = 100;

  const W = n <= 1 ? 640 : n <= 2 ? 900 : 1280;
  const PANEL_W = Math.floor((W - (COLS + 1) * PANEL_GAP) / COLS);

  // Compute how many motif rows fit per panel
  const motifsPerRow = Math.max(1, Math.floor((PANEL_W - 24) / (SQ_SIZE + SQ_GAP)));
  const motifRows = motifList.length === 0 ? 1 : Math.ceil(motifList.length / motifsPerRow);
  const nameAreaH = NAME_FONT + 20; // name text + padding
  const motifAreaH = motifRows * (SQ_SIZE + SQ_GAP);
  const scoreAreaH = SCORE_FONT + 16;
  const PANEL_H = nameAreaH + motifAreaH + scoreAreaH;

  const H = HEADER_H + ROWS * (PANEL_H + PANEL_GAP) + PANEL_GAP;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${n <= 2 ? 36 : 40}px Inter`;
  ctx.textAlign = "center";
  ctx.fillText("Motifle", W / 2, 52);
  ctx.fillStyle = "#b5bac1";
  ctx.font = `${n <= 2 ? 24 : 28}px Inter`;
  ctx.fillText(date, W / 2, 88);

  if (players.length === 0) {
    ctx.fillStyle = "#b5bac1";
    ctx.font = "24px Inter";
    ctx.fillText("No guesses yet", W / 2, H / 2);
    return canvas.toBuffer("image/png");
  }

  for (let i = 0; i < players.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const px = PANEL_GAP + col * (PANEL_W + PANEL_GAP);
    const py = HEADER_H + row * (PANEL_H + PANEL_GAP);
    const p = players[i];

    ctx.fillStyle = "#313338";
    ctx.beginPath();
    ctx.roundRect(px, py, PANEL_W, PANEL_H, 10);
    ctx.fill();

    // Avatar + username row
    const AV = NAME_FONT + 4; // avatar diameter = slightly larger than font
    let nameX = px + 12;
    if (p.avatar) {
      try {
        const avatarUrl = `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=64`;
        const img = await loadImage(avatarUrl);
        const ax = px + 12, ay = py + 8;
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, ax, ay, AV, AV);
        ctx.restore();
        nameX = ax + AV + 8;
      } catch { /* skip avatar on error */ }
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${NAME_FONT}px Inter`;
    ctx.textAlign = "left";
    const maxChars = n <= 1 ? 30 : n <= 2 ? 24 : 18;
    const name = p.username.length > maxChars ? p.username.slice(0, maxChars - 1) + "…" : p.username;
    ctx.fillText(name, nameX, py + AV / 2 + NAME_FONT / 2 + 6);

    // Motif squares (with row wrapping)
    let sx = px + 12;
    let sy = py + nameAreaH;
    for (const motif of motifList) {
      if (sx + SQ_SIZE > px + PANEL_W - 12) {
        sx = px + 12;
        sy += SQ_SIZE + SQ_GAP;
      }
      const guessed = p.slugs.has(motif.slug);
      ctx.fillStyle = guessed ? (RARITY_BG[motif.rarity] ?? "#5865f2") : "#1e1f22";
      ctx.beginPath();
      ctx.roundRect(sx, sy, SQ_SIZE, SQ_SIZE, 4);
      ctx.fill();
      if (guessed) {
        ctx.fillStyle = RARITY_COLORS[motif.rarity] ?? "#5865f2";
        ctx.beginPath();
        ctx.roundRect(sx + 2, sy + 2, SQ_SIZE - 4, SQ_SIZE - 4, 3);
        ctx.fill();
      }
      sx += SQ_SIZE + SQ_GAP;
    }

    // Score
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${SCORE_FONT}px Inter`;
    ctx.textAlign = "right";
    ctx.fillText(`${p.pts} pts`, px + PANEL_W - 12, py + PANEL_H - 12);
  }

  return canvas.toBuffer("image/png");
}

function buildMultipartForm(payloadJson, pngBuf) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payloadJson));
  form.append("files[0]", new Blob([pngBuf], { type: "image/png" }), "motifle.png");
  return form;
}

function collectPlayers(allGuesses) {
  const byUser = new Map();
  for (const g of allGuesses) {
    if (!byUser.has(g.userId)) byUser.set(g.userId, { username: g.username ?? g.userId });
  }
  return [...byUser.values()];
}

async function postGroupMessage(channelId, date, done, gameSongs, gameMotifs) {
  const allGuesses = getGuesses(channelId, date);
  const players = collectPlayers(allGuesses);
  const content = buildContentText(players, done);
  const pngBuf = await renderGroupPreview(allGuesses, gameSongs, gameMotifs, date);
  const form = buildMultipartForm({ content }, pngBuf);

  const res = await botFetch(`/channels/${channelId}/messages`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postGroupMessage failed ${res.status}: ${text}`);
  }
  const msg = await res.json();
  upsertSessionMessage(channelId, date, msg.id);
  console.log(`[bot] posted message ${msg.id} for ${channelId} ${date}`);
}

async function editGroupMessage(channelId, date, messageId, done, gameSongs, gameMotifs) {
  const allGuesses = getGuesses(channelId, date);
  const players = collectPlayers(allGuesses);
  const content = buildContentText(players, done);
  const pngBuf = await renderGroupPreview(allGuesses, gameSongs, gameMotifs, date);
  const form = buildMultipartForm({ content, attachments: [] }, pngBuf);

  const res = await botFetch(`/channels/${channelId}/messages/${messageId}`, { method: "PATCH", body: form });
  if (!res.ok) {
    if (res.status === 404) {
      upsertSessionMessage(channelId, date, "");
      await postGroupMessage(channelId, date, done, gameSongs, gameMotifs);
      return;
    }
    const text = await res.text();
    throw new Error(`editGroupMessage failed ${res.status}: ${text}`);
  }
  console.log(`[bot] edited message ${messageId} for ${channelId} ${date}`);
}

export async function upsertBotMessage(channelId, date, done = false, gameSongs = [], gameMotifs = {}) {
  if (!process.env.DISCORD_BOT_TOKEN) return;
  const existing = getSessionMessage(channelId, date);
  if (existing?.messageId) {
    await editGroupMessage(channelId, date, existing.messageId, done, gameSongs, gameMotifs);
  } else {
    await postGroupMessage(channelId, date, done, gameSongs, gameMotifs);
  }
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

export async function postDailySummaries(date, gameSongs, gameMotifs) {
  if (!process.env.DISCORD_BOT_TOKEN) return;
  const channels = getAllChannelsForDate(date);
  for (const { channelId } of channels) {
    try {
      await postDailySummary(channelId, date, gameSongs, gameMotifs);
    } catch (e) {
      console.warn(`[bot] daily summary failed for ${channelId}:`, e.message);
    }
  }
}

async function postDailySummary(channelId, date, gameSongs, gameMotifs) {
  const guesses = getGuesses(channelId, date);
  if (guesses.length === 0) return;

  const song = songForDate(date, gameSongs);
  const motifList = (song?.leitmotifs ?? []).map((s) => gameMotifs[s]).filter(Boolean);
  const total = motifList.length;

  const byUser = new Map();
  for (const g of guesses) {
    if (!byUser.has(g.userId)) {
      byUser.set(g.userId, { userId: g.userId, username: g.username, slugs: new Set() });
    }
    byUser.get(g.userId).slugs.add(g.motifSlug);
  }

  const players = [...byUser.values()].map((u) => {
    const correct = motifList.filter((m) => u.slugs.has(m.slug));
    const pts = correct.reduce((s, m) => s + (RARITY_POINTS[m.rarity] ?? 0), 0);
    return { userId: u.userId, nCorrect: correct.length, pts };
  });
  players.sort((a, b) => b.nCorrect - a.nCorrect || b.pts - a.pts);

  const grouped = new Map();
  for (const p of players) {
    if (!grouped.has(p.nCorrect)) grouped.set(p.nCorrect, []);
    grouped.get(p.nCorrect).push(p);
  }

  const lines = [`**Motifle · ${date} Results** *(${song?.name ?? "?"})*`, ""];
  let first = true;
  for (const [n, group] of [...grouped.entries()].sort((a, b) => b[0] - a[0])) {
    const prefix = first ? "👑 " : "";
    first = false;
    const mentions = group.map((p) => `<@${p.userId}> (${p.pts} pts)`).join("  ");
    lines.push(`${prefix}**${n}/${total}**: ${mentions}`);
  }

  const res = await botFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: lines.join("\n"),
      allowed_mentions: { users: players.map((p) => p.userId) },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postDailySummary failed ${res.status}: ${text}`);
  }
  console.log(`[bot] posted daily summary for ${channelId} ${date}`);
}

// ---------------------------------------------------------------------------
// Discord Gateway client — receives INTERACTION_CREATE without an HTTP endpoint
// ---------------------------------------------------------------------------

let _heartbeatTimer = null;
let _lastSeq = null;
let _sessionId = null;
let _resumeUrl = null;

function respondToInteraction(id, token, data) {
  return fetch(`${DISCORD_API}/interactions/${id}/${token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function handleInteraction(interaction) {
  const { id, token, type, data } = interaction;

  // Entry Point command (PRIMARY_ENTRY_POINT = command type 4)
  if (type === 2 && data?.type === 4) {
    console.log("[gateway] Entry Point — LAUNCH_ACTIVITY");
    respondToInteraction(id, token, { type: 12 }).catch(console.error);
    return;
  }

  // "Play now!" button (kept for future use)
  if (type === 3 && data?.custom_id === "live_game_launch") {
    console.log("[gateway] live_game_launch button — LAUNCH_ACTIVITY");
    respondToInteraction(id, token, { type: 12 }).catch(console.error);
    return;
  }
}

export function startGateway() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  const url = _resumeUrl ?? "wss://gateway.discord.gg/?v=10&encoding=json";
  const ws = new WebSocket(url);

  ws.on("open", () => console.log("[gateway] connected"));

  ws.on("message", (raw) => {
    const { op, d, s, t } = JSON.parse(raw.toString());
    if (s != null) _lastSeq = s;

    if (op === 10) { // HELLO
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = setInterval(() => ws.send(JSON.stringify({ op: 1, d: _lastSeq })), d.heartbeat_interval);

      if (_sessionId && _resumeUrl) {
        ws.send(JSON.stringify({ op: 6, d: { token, session_id: _sessionId, seq: _lastSeq } }));
      } else {
        ws.send(JSON.stringify({ op: 2, d: { token, intents: 0, properties: { os: "linux", browser: "motifle", device: "motifle" } } }));
      }
    } else if (op === 0) { // DISPATCH
      if (t === "READY") {
        _sessionId = d.session_id;
        _resumeUrl = d.resume_gateway_url;
        console.log(`[gateway] ready as ${d.user.username}#${d.user.discriminator}`);
        patchEntryPointToAppHandler(token, d.application.id);
      } else if (t === "INTERACTION_CREATE") {
        handleInteraction(d);
      }
    } else if (op === 7) { // RECONNECT
      ws.close();
    } else if (op === 9) { // INVALID_SESSION
      _sessionId = null;
      _resumeUrl = null;
      ws.close();
    }
  });

  ws.on("close", (code) => {
    clearInterval(_heartbeatTimer);
    console.log(`[gateway] closed (${code}), reconnecting in 5s`);
    setTimeout(startGateway, 5000);
  });

  ws.on("error", (err) => console.warn("[gateway] error:", err.message));
}

async function patchEntryPointToAppHandler(token, appId) {
  try {
    const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) { console.warn("[gateway] fetch commands failed:", res.status); return; }
    const commands = await res.json();

    const ep = commands.find((c) => c.type === 4);
    if (!ep) { console.log("[gateway] no entry point command found"); return; }
    if (ep.handler === 1) { console.log("[gateway] entry point already APP_HANDLER"); return; }

    const patch = await fetch(`${DISCORD_API}/applications/${appId}/commands/${ep.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ handler: 1 }),
    });
    if (patch.ok) {
      console.log("[gateway] entry point patched to APP_HANDLER");
    } else {
      console.warn("[gateway] patch entry point failed:", patch.status, await patch.text());
    }
  } catch (e) {
    console.warn("[gateway] patchEntryPointToAppHandler error:", e.message);
  }
}

