/**
 * Logic tests for core game functions.
 *
 * Run from the repo root:
 *   node server/tests/logic-test.js
 */

import assert from "node:assert/strict";
import { songForDate, scorePlayers, RARITY_POINTS } from "../lib/renderGroupPreview.js";
import { buildContentText } from "../bot.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SONGS = [
  { name: "Song A", leitmotifs: ["a1", "a2"] },
  { name: "Song B", leitmotifs: ["b1"] },
  { name: "Song C", leitmotifs: ["c1", "c2", "c3"] },
];

// motifList for Song A: rarity 5 + rarity 3
const MOTIF_LIST_A = [
  { slug: "a1", rarity: 5 },  // 100 pts
  { slug: "a2", rarity: 3 },  // 175 pts
];
const RAW_A_FULL = RARITY_POINTS[5] + RARITY_POINTS[3]; // 100 + 175 = 275

function g(userId, motifSlug, username = `User${userId}`) {
  return { userId, username, avatar: null, motifSlug };
}

// ---------------------------------------------------------------------------
// songForDate
// ---------------------------------------------------------------------------

console.log("\n── songForDate ──");

test("epoch date → index 0", () => {
  assert.equal(songForDate("2023-08-09", SONGS).name, "Song A");
});

test("epoch + 1 day → index 1", () => {
  assert.equal(songForDate("2023-08-10", SONGS).name, "Song B");
});

test("epoch + 2 days → index 2", () => {
  assert.equal(songForDate("2023-08-11", SONGS).name, "Song C");
});

test("epoch + songs.length days → wraps to index 0", () => {
  assert.equal(songForDate("2023-08-12", SONGS).name, "Song A");
});

test("date before epoch → wraps correctly (no crash)", () => {
  const song = songForDate("2023-08-08", SONGS);
  assert.ok(SONGS.includes(song), "should return one of the songs");
});

// ---------------------------------------------------------------------------
// scorePlayers
// ---------------------------------------------------------------------------

console.log("\n── scorePlayers ──");

test("no guesses → empty array", () => {
  const result = scorePlayers([], MOTIF_LIST_A);
  assert.deepEqual(result, []);
});

test("one player guesses nothing → 0 pts, 0 correct", () => {
  const result = scorePlayers([g("u1", "unrelated-motif")], MOTIF_LIST_A);
  assert.equal(result.length, 1);
  assert.equal(result[0].pts, 0);
  assert.equal(result[0].nCorrect, 0);
});

test("one player, all motifs guessed, no errors → full raw score", () => {
  const result = scorePlayers([g("u1", "a1"), g("u1", "a2")], MOTIF_LIST_A);
  assert.equal(result[0].pts, RAW_A_FULL);
  assert.equal(result[0].nCorrect, 2);
});

test("error penalty reduces score", () => {
  const result = scorePlayers(
    [g("u1", "a1"), g("u1", "a2")],
    MOTIF_LIST_A,
    [{ userId: "u1", errorCount: 100 }]
  );
  assert.equal(result[0].pts, Math.max(RAW_A_FULL - 100, 0));
});

test("error penalty exceeding raw score → pts floored at 0", () => {
  const result = scorePlayers(
    [g("u1", "a1")],
    MOTIF_LIST_A,
    [{ userId: "u1", errorCount: 9999 }]
  );
  assert.equal(result[0].pts, 0);
});

test("two players sorted highest pts first", () => {
  const result = scorePlayers(
    [g("u1", "a2"), g("u2", "a1"), g("u2", "a2")],
    MOTIF_LIST_A
  );
  assert.equal(result[0].userId, "u2");
  assert.equal(result[1].userId, "u1");
  assert.ok(result[0].pts > result[1].pts);
});

test("duplicate guess rows for same user/motif counted only once", () => {
  const result = scorePlayers(
    [g("u1", "a1"), g("u1", "a1"), g("u1", "a1")],
    MOTIF_LIST_A
  );
  assert.equal(result[0].nCorrect, 1);
  assert.equal(result[0].pts, RARITY_POINTS[5]);
});

test("guessing a motif not in today's song doesn't affect score", () => {
  const result = scorePlayers(
    [g("u1", "a1"), g("u1", "completely-unrelated")],
    MOTIF_LIST_A
  );
  assert.equal(result[0].nCorrect, 1);
  assert.equal(result[0].pts, RARITY_POINTS[5]);
});

test("13 players truncated to 12", () => {
  const guesses = Array.from({ length: 13 }, (_, i) => g(`u${i}`, "a1"));
  const result = scorePlayers(guesses, MOTIF_LIST_A);
  assert.equal(result.length, 12);
});

test("errors for a player not in guesses are ignored (no crash)", () => {
  const result = scorePlayers(
    [g("u1", "a1")],
    MOTIF_LIST_A,
    [{ userId: "ghost", errorCount: 999 }]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].pts, RARITY_POINTS[5]);
});

// ---------------------------------------------------------------------------
// buildContentText
// ---------------------------------------------------------------------------

console.log("\n── buildContentText ──");

test("0 players, not done", () => {
  assert.equal(buildContentText([], false), "Someone is playing Motifle");
});

test("0 players, done", () => {
  assert.equal(buildContentText([], true), "Someone was playing Motifle");
});

test("1 player, not done", () => {
  assert.equal(buildContentText([{ username: "Alice" }], false), "**Alice** is playing Motifle");
});

test("1 player, done", () => {
  assert.equal(buildContentText([{ username: "Alice" }], true), "**Alice** was playing Motifle");
});

test("2 players, not done", () => {
  assert.equal(
    buildContentText([{ username: "Alice" }, { username: "Bob" }], false),
    "**Alice and Bob** are playing Motifle"
  );
});

test("3 players, not done", () => {
  assert.equal(
    buildContentText([{ username: "Alice" }, { username: "Bob" }, { username: "Charlie" }], false),
    "**Alice, Bob and Charlie** are playing Motifle"
  );
});

test("2 players, done", () => {
  assert.equal(
    buildContentText([{ username: "Alice" }, { username: "Bob" }], true),
    "**Alice and Bob** were playing Motifle"
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
