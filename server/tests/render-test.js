/**
 * Render test for renderGroupPreview.
 *
 * Run from the repo root:
 *   node server/tests/render-test.js
 *
 * Output PNGs are written to server/tests/output/.
 */

import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { renderGroupPreview, songForDate } from "../lib/renderGroupPreview.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "output");

// ---------------------------------------------------------------------------
// Mock game data: 8 motifs across all rarities
// ---------------------------------------------------------------------------
const MOTIF_SLUGS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const gameMotifs = {
  alpha:   { slug: "alpha",   rarity: 5, name: "Alpha",   albumName: "Vol. 1" },
  beta:    { slug: "beta",    rarity: 5, name: "Beta",    albumName: "Vol. 1" },
  gamma:   { slug: "gamma",   rarity: 4, name: "Gamma",   albumName: "Vol. 2" },
  delta:   { slug: "delta",   rarity: 4, name: "Delta",   albumName: "Vol. 2" },
  epsilon: { slug: "epsilon", rarity: 3, name: "Epsilon", albumName: "Vol. 3" },
  zeta:    { slug: "zeta",    rarity: 2, name: "Zeta",    albumName: "Vol. 3" },
  eta:     { slug: "eta",     rarity: 1, name: "Eta",     albumName: "Vol. 4" },
  theta:   { slug: "theta",   rarity: 1, name: "Theta",   albumName: "Vol. 4" },
};

// Epoch date resolves to index 0 → our test song
const TEST_DATE = "2023-08-09";
const gameSongs = [
  { name: "Test Song", leitmotifs: MOTIF_SLUGS, albumName: "Vol. 1", wikiUrl: "" },
];

// Sanity check
const song = songForDate(TEST_DATE, gameSongs);
if (song?.name !== "Test Song") throw new Error("songForDate sanity check failed");

// ---------------------------------------------------------------------------
// Helper: build allGuesses array from a player spec
// ---------------------------------------------------------------------------
function guesses(players) {
  return players.flatMap(({ userId, username, avatar = null, slugs }) =>
    slugs.map((motifSlug) => ({ userId, username, avatar, motifSlug }))
  );
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const scenarios = [
  {
    name: "0-players",
    players: [],
    sessionErrors: [],
  },
  {
    name: "1-player-partial",
    players: [
      { userId: "u1", username: "Alice", slugs: ["alpha", "gamma", "epsilon"] },
    ],
    sessionErrors: [],
  },
  {
    name: "1-player-all-motifs",
    players: [
      { userId: "u1", username: "Alice", slugs: MOTIF_SLUGS },
    ],
    sessionErrors: [{ userId: "u1", errorCount: 50 }],  // score penalised to 0
  },
  {
    name: "2-players",
    players: [
      { userId: "u1", username: "Alice",   slugs: ["alpha", "beta", "gamma", "delta"] },
      { userId: "u2", username: "Bob",     slugs: ["epsilon", "zeta"] },
    ],
    sessionErrors: [{ userId: "u2", errorCount: 100 }],
  },
  {
    name: "3-players",
    players: [
      { userId: "u1", username: "Alice",   slugs: ["alpha", "beta"] },
      { userId: "u2", username: "Bob",     slugs: ["gamma", "delta", "epsilon"] },
      { userId: "u3", username: "Charlie", slugs: ["zeta", "eta", "theta"] },
    ],
    sessionErrors: [],
  },
  {
    name: "5-players",
    players: [
      { userId: "u1", username: "Alice",      slugs: ["alpha", "beta", "gamma"] },
      { userId: "u2", username: "Bob",        slugs: ["delta", "epsilon"] },
      { userId: "u3", username: "Charlie",    slugs: ["zeta", "eta"] },
      { userId: "u4", username: "Diana",      slugs: ["alpha", "theta"] },
      { userId: "u5", username: "Eve",        slugs: [] },
    ],
    sessionErrors: [{ userId: "u3", errorCount: 75 }],
  },
  {
    name: "9-players",
    players: Array.from({ length: 9 }, (_, i) => ({
      userId: `u${i + 1}`,
      username: `Player${i + 1}`,
      slugs: MOTIF_SLUGS.slice(0, 8 - i),
    })),
    sessionErrors: [],
  },
  {
    name: "12-players-max",
    players: Array.from({ length: 12 }, (_, i) => ({
      userId: `u${i + 1}`,
      username: `Player${i + 1}`,
      slugs: MOTIF_SLUGS.slice(0, Math.max(1, 8 - i)),
    })),
    sessionErrors: [],
  },
  {
    name: "13-players-truncated-to-12",
    players: Array.from({ length: 13 }, (_, i) => ({
      userId: `u${i + 1}`,
      username: `Player${i + 1}`,
      slugs: MOTIF_SLUGS.slice(0, Math.max(1, 8 - i)),
    })),
    sessionErrors: [],
  },
  {
    name: "long-usernames",
    players: [
      { userId: "u1", username: "ThisIsAReallyLongDiscordUsername", slugs: ["alpha", "beta"] },
      { userId: "u2", username: "AnotherVeryLongUsernameHere1234", slugs: ["gamma"] },
      { userId: "u3", username: "Short",                           slugs: ["delta", "epsilon", "zeta"] },
    ],
    sessionErrors: [],
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

for (const scenario of scenarios) {
  const allGuesses = guesses(scenario.players);
  try {
    const buf = await renderGroupPreview(allGuesses, gameSongs, gameMotifs, TEST_DATE, scenario.sessionErrors);
    const outPath = path.join(OUT, `${scenario.name}.png`);
    writeFileSync(outPath, buf);
    console.log(`✓ ${scenario.name} → ${buf.length} bytes`);
    passed++;
  } catch (err) {
    console.error(`✗ ${scenario.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(`PNGs written to server/tests/output/`);
if (failed > 0) process.exit(1);
