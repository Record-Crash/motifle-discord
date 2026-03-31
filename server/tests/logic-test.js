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
// getGuesses startedAt filtering (regression: first guess dropped from embed)
// ---------------------------------------------------------------------------

import Database from "better-sqlite3";

console.log("\n── getGuesses startedAt filtering ──");

function makeTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL, date TEXT NOT NULL,
      user_id TEXT NOT NULL, username TEXT, avatar TEXT,
      motif_slug TEXT NOT NULL,
      guessed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, date, user_id, motif_slug)
    );
    CREATE TABLE session_messages (
      channel_id TEXT NOT NULL, date TEXT NOT NULL,
      message_id TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, date)
    );
  `);
  return db;
}

test("regression: startedAt set after first guess excludes that guess (documents the old bug)", () => {
  const db = makeTestDb();
  const pastTs  = "2026-01-01 10:00:00"; // first guess time
  const laterTs = "2026-01-01 10:00:02"; // startedAt set 2s later (Discord API roundtrip)

  db.prepare(`INSERT INTO guesses (channel_id, date, user_id, motif_slug, guessed_at)
              VALUES ('ch', '2026-01-01', 'u1', 'motif-a', ?)`).run(pastTs);
  db.prepare(`INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', 'msg1', ?, ?)`).run(laterTs, laterTs);

  const session = db.prepare(`SELECT started_at AS startedAt FROM session_messages
                               WHERE channel_id='ch' AND date='2026-01-01'`).get();
  const guesses = db.prepare(`SELECT * FROM guesses
                               WHERE channel_id='ch' AND date='2026-01-01'
                               AND guessed_at >= ?`).all(session.startedAt);
  // Under the old flow the first guess was invisible to editGroupMessage
  assert.equal(guesses.length, 0, "old flow: first guess is filtered out when startedAt > guessed_at");
});

test("fix: initSession before first guess keeps that guess visible in subsequent queries", () => {
  const db = makeTestDb();
  const sessionTs = "2026-01-01 10:00:00"; // session initialised on WS connect
  const guessTs   = "2026-01-01 10:00:02"; // guess arrives after WS connect

  // initSession (INSERT OR IGNORE) fires on WS connect — before any guess
  db.prepare(`INSERT OR IGNORE INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', '', ?, ?)`).run(sessionTs, sessionTs);

  // Guess arrives
  db.prepare(`INSERT INTO guesses (channel_id, date, user_id, motif_slug, guessed_at)
              VALUES ('ch', '2026-01-01', 'u1', 'motif-a', ?)`).run(guessTs);

  // upsertSessionMessage (called after Discord POST) updates message_id only; startedAt unchanged
  db.prepare(`INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', 'msg1', datetime('now'), datetime('now'))
              ON CONFLICT(channel_id, date) DO UPDATE SET
                message_id     = excluded.message_id,
                last_active_at = datetime('now')`).run();

  const session = db.prepare(`SELECT started_at AS startedAt FROM session_messages
                               WHERE channel_id='ch' AND date='2026-01-01'`).get();
  const guesses = db.prepare(`SELECT * FROM guesses
                               WHERE channel_id='ch' AND date='2026-01-01'
                               AND guessed_at >= ?`).all(session.startedAt);
  assert.equal(guesses.length, 1, "fix: first guess is included when startedAt was set before it");
});

test("initSession is a no-op when session already exists (does not reset startedAt)", () => {
  const db = makeTestDb();
  const originalTs = "2026-01-01 09:00:00";

  db.prepare(`INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', 'existing-msg', ?, ?)`).run(originalTs, originalTs);

  // Simulate calling initSession again (INSERT OR IGNORE should do nothing)
  db.prepare(`INSERT OR IGNORE INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', '', datetime('now'), datetime('now'))`).run();

  const session = db.prepare(`SELECT started_at AS startedAt, message_id AS messageId
                               FROM session_messages WHERE channel_id='ch' AND date='2026-01-01'`).get();
  assert.equal(session.startedAt, originalTs, "startedAt must not be overwritten by initSession");
  assert.equal(session.messageId, "existing-msg", "messageId must not be overwritten by initSession");
});

test("resetRoom resets startedAt so guesses from the previous session are excluded", () => {
  const db = makeTestDb();
  const oldTs = "2026-01-01 08:00:00";

  db.prepare(`INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', 'old-msg', ?, ?)`).run(oldTs, oldTs);
  db.prepare(`INSERT INTO guesses (channel_id, date, user_id, motif_slug, guessed_at)
              VALUES ('ch', '2026-01-01', 'u1', 'motif-a', ?)`).run(oldTs);

  // resetRoom fires after 4h idle
  const resetTs = "2026-01-01 13:00:00";
  db.prepare(`INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
              VALUES ('ch', '2026-01-01', '', ?, ?)
              ON CONFLICT(channel_id, date) DO UPDATE SET
                message_id='', started_at=excluded.started_at, last_active_at=excluded.last_active_at`)
    .run(resetTs, resetTs);

  const session = db.prepare(`SELECT started_at AS startedAt FROM session_messages
                               WHERE channel_id='ch' AND date='2026-01-01'`).get();
  const guesses = db.prepare(`SELECT * FROM guesses
                               WHERE channel_id='ch' AND date='2026-01-01'
                               AND guessed_at >= ?`).all(session.startedAt);
  assert.equal(guesses.length, 0, "old-session guesses are correctly excluded after room reset");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
