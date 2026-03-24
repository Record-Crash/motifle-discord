import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
GlobalFonts.registerFromPath(path.join(__dirname, "../fonts/Inter-Regular.otf"), "Inter");
GlobalFonts.registerFromPath(path.join(__dirname, "../fonts/Inter-Bold.otf"), "Inter");

export const RARITY_POINTS = { 1: 500, 2: 250, 3: 175, 4: 125, 5: 100 };
// Colors are calibrated for perceived brightness on the dark panel (#313338, ~20% luminance).
// Human eyes weight channels as R=21%, G=72%, B=7%, so pure blue/purple need much higher L
// to match the perceived brightness of gold/green. Inner fills target ~35% luminance;
// outer borders stay clearly above the panel (~25%) and clearly below inner (~35%).
const RARITY_COLORS = { 5: "#c70000", 4: "#c8a000", 3: "#1e8200", 2: "#3355ee", 1: "#9955ee" };
const RARITY_BG     = { 5: "#a30000", 4: "#a58400", 3: "#165e00", 2: "#1144bb", 1: "#6622bb" };

export function songForDate(date, gameSongs) {
  const EPOCH = new Date("2023-08-09T00:00:00Z");
  const d = new Date(date + "T00:00:00Z");
  const days = Math.round((d - EPOCH) / 86400000);
  const idx = ((days % gameSongs.length) + gameSongs.length) % gameSongs.length;
  return gameSongs[idx] ?? null;
}

/**
 * Aggregate guesses into scored, sorted player objects.
 *
 * @param {Array}  allGuesses    - Rows with { userId, username, avatar, motifSlug }
 * @param {Array}  motifList     - Today's motifs: [{ slug, rarity }], already filtered/sorted
 * @param {Array}  sessionErrors - Rows with { userId, errorCount } (default [])
 * @returns {Array} [{userId, username, avatar, slugs (Set), nCorrect, pts}], pts desc, max 12
 */
export function scorePlayers(allGuesses, motifList, sessionErrors = []) {
  const errMap = Object.fromEntries(sessionErrors.map((r) => [r.userId, r.errorCount]));
  const byUser = new Map();
  for (const g of allGuesses) {
    if (!byUser.has(g.userId)) {
      byUser.set(g.userId, { userId: g.userId, username: g.username ?? g.userId, avatar: g.avatar ?? null, slugs: new Set() });
    }
    byUser.get(g.userId).slugs.add(g.motifSlug);
  }
  const players = [...byUser.values()].map((u) => {
    const correct = motifList.filter((m) => u.slugs.has(m.slug));
    const raw = correct.reduce((s, m) => s + (RARITY_POINTS[m.rarity] ?? 0), 0);
    const pts = Math.max(raw - (errMap[u.userId] ?? 0), 0);
    return { ...u, nCorrect: correct.length, pts };
  });
  players.sort((a, b) => b.pts - a.pts);
  return players.slice(0, 12);
}

/**
 * Render the group score card as a PNG buffer.
 *
 * @param {Array}  allGuesses    - Rows with { userId, username, avatar, motifSlug }
 * @param {Array}  gameSongs     - Full songs array (used to determine today's song)
 * @param {Object} gameMotifs    - Map of slug → { slug, rarity, name, albumName }
 * @param {string} date          - YYYY-MM-DD
 * @param {Array}  sessionErrors - Rows with { userId, errorCount } (default [])
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderGroupPreview(allGuesses, gameSongs, gameMotifs, date, sessionErrors = []) {
  const song = songForDate(date, gameSongs);
  const motifList = (song?.leitmotifs ?? [])
    .map((slug) => gameMotifs[slug])
    .filter(Boolean)
    .sort((a, b) => b.rarity - a.rarity);

  const players = scorePlayers(allGuesses, motifList, sessionErrors);

  const n = players.length;
  const COLS = n <= 1 ? 1 : n <= 2 ? 2 : 3;
  const ROWS = Math.ceil(Math.max(n, 1) / COLS);

  const SQ_SIZE = n <= 1 ? 36 : n <= 4 ? 28 : 22;
  const SQ_GAP  = n <= 1 ? 7  : n <= 4 ? 6  : 5;
  const NAME_FONT = n <= 1 ? 22 : n <= 2 ? 20 : 18;
  const SCORE_FONT = n <= 1 ? 28 : n <= 2 ? 24 : 22;
  const PANEL_GAP = 16;
  const HEADER_H = 100;

  const W = n <= 1 ? 640 : n <= 2 ? 900 : 1280;
  const PANEL_W = Math.floor((W - (COLS + 1) * PANEL_GAP) / COLS);

  const motifsPerRow = Math.max(1, Math.floor((PANEL_W - 24) / (SQ_SIZE + SQ_GAP)));
  const motifRows = motifList.length === 0 ? 1 : Math.ceil(motifList.length / motifsPerRow);
  const nameAreaH = NAME_FONT + 20;
  const motifAreaH = motifRows * (SQ_SIZE + SQ_GAP);
  const scoreAreaH = SCORE_FONT + 16;
  const PANEL_H = nameAreaH + motifAreaH + scoreAreaH;

  const H = HEADER_H + ROWS * (PANEL_H + PANEL_GAP) + PANEL_GAP;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, W, H);

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

    const AV = NAME_FONT + 4;
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

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${SCORE_FONT}px Inter`;
    ctx.textAlign = "right";
    ctx.fillText(`${p.pts} pts`, px + PANEL_W - 12, py + PANEL_H - 12);
  }

  return canvas.toBuffer("image/png");
}
