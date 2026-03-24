import fetch from "node-fetch";
import WebSocket from "ws";
import { getGuesses, getAllChannelsForDate, getSessionMessage, upsertSessionMessage, getSessionErrors, getLatestSessionMessage } from "./db.js";
import { renderGroupPreview, scorePlayers, songForDate } from "./lib/renderGroupPreview.js";

const DISCORD_API = "https://discord.com/api/v10";
const LIVE_LAUNCH_ROW = { type: 1, components: [{ type: 2, style: 1, label: "Play now!", custom_id: "live_game_launch" }] };

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

export function buildContentText(players, done) {
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
  const pngBuf = await renderGroupPreview(allGuesses, gameSongs, gameMotifs, date, getSessionErrors(channelId, date));
  const prevMsg = getLatestSessionMessage(channelId);
  const payload = { content, components: [LIVE_LAUNCH_ROW] };
  if (prevMsg?.messageId) payload.message_reference = { message_id: prevMsg.messageId };
  const form = buildMultipartForm(payload, pngBuf);

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
  const pngBuf = await renderGroupPreview(allGuesses, gameSongs, gameMotifs, date, getSessionErrors(channelId, date));
  const form = buildMultipartForm({ content, attachments: [], components: [LIVE_LAUNCH_ROW] }, pngBuf);

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
  const motifList = (song?.leitmotifs ?? []).map((s) => gameMotifs[s]).filter(Boolean).sort((a, b) => b.rarity - a.rarity);
  const total = motifList.length;
  const sessionErrors = getSessionErrors(channelId, date);
  const players = scorePlayers(guesses, motifList, sessionErrors);

  const grouped = new Map();
  for (const p of players) {
    if (!grouped.has(p.pts)) grouped.set(p.pts, []);
    grouped.get(p.pts).push(p);
  }

  const lines = [`**Motifle · ${date} Results** *(${song?.name ?? "?"})*`, ""];
  let first = true;
  for (const [pts, group] of [...grouped.entries()].sort((a, b) => b[0] - a[0])) {
    const prefix = first ? "👑 " : "";
    first = false;
    const mentions = group.map((p) => `<@${p.userId}> (${p.nCorrect}/${total})`).join("  ");
    lines.push(`${prefix}**${pts} pts**: ${mentions}`);
  }

  const sessionMsg = getSessionMessage(channelId, date);
  const pngBuf = await renderGroupPreview(guesses, gameSongs, gameMotifs, date, sessionErrors);
  const payload = {
    content: lines.join("\n"),
    allowed_mentions: { users: players.map((p) => p.userId) },
    components: [LIVE_LAUNCH_ROW],
  };
  if (sessionMsg?.messageId) payload.message_reference = { message_id: sessionMsg.messageId };
  const form = buildMultipartForm(payload, pngBuf);

  const res = await botFetch(`/channels/${channelId}/messages`, { method: "POST", body: form });
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

