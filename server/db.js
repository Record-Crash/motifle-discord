import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'motifle.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS guesses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  TEXT NOT NULL,
    date        TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    username    TEXT,
    avatar      TEXT,
    motif_slug  TEXT NOT NULL,
    guessed_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, date, user_id, motif_slug)
  );
  CREATE INDEX IF NOT EXISTS idx_guesses_room ON guesses(channel_id, date);

  CREATE TABLE IF NOT EXISTS session_messages (
    channel_id     TEXT NOT NULL,
    date           TEXT NOT NULL,
    message_id     TEXT NOT NULL,
    started_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (channel_id, date)
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    channel_id     TEXT PRIMARY KEY,
    webhook_id     TEXT NOT NULL,
    webhook_token  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_invites (
    channel_id   TEXT PRIMARY KEY,
    invite_code  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_errors (
    channel_id   TEXT NOT NULL,
    date         TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    error_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, date, user_id)
  );
`);

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO guesses (channel_id, date, user_id, username, avatar, motif_slug)
  VALUES (@channelId, @date, @userId, @username, @avatar, @motifSlug)
`);

const stmtSelect = db.prepare(`
  SELECT user_id AS userId, username, avatar, motif_slug AS motifSlug
  FROM guesses
  WHERE channel_id = ? AND date = ?
  ORDER BY guessed_at ASC
`);

// Migrations for columns added after initial schema (try/catch: no-op if column already exists)
// Constant literal required — ALTER TABLE ADD COLUMN does not allow function-call defaults.
// Rows from before the migration get '1970-01-01 00:00:00' which is safely ancient (will expire).
for (const col of [
  `ALTER TABLE session_messages ADD COLUMN started_at     TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'`,
  `ALTER TABLE session_messages ADD COLUMN last_active_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'`,
]) {
  try { db.exec(col); } catch { /* already exists */ }
}

const stmtGetSession = db.prepare(`
  SELECT message_id     AS messageId,
         started_at     AS startedAt,
         last_active_at AS lastActiveAt
  FROM session_messages WHERE channel_id = ? AND date = ?
`);
const stmtGetLatestSession = db.prepare(`
  SELECT message_id AS messageId FROM session_messages
  WHERE channel_id = ? AND message_id != ''
  ORDER BY date DESC LIMIT 1
`);
const stmtUpsertSession = db.prepare(`
  INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
  VALUES (?, ?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(channel_id, date) DO UPDATE SET
    message_id     = excluded.message_id,
    last_active_at = datetime('now')
`);
const stmtResetRoom = db.prepare(`
  INSERT INTO session_messages (channel_id, date, message_id, started_at, last_active_at)
  VALUES (?, ?, '', datetime('now'), datetime('now'))
  ON CONFLICT(channel_id, date) DO UPDATE SET
    message_id     = '',
    started_at     = datetime('now'),
    last_active_at = datetime('now')
`);
const stmtSelectSince = db.prepare(`
  SELECT user_id AS userId, username, avatar, motif_slug AS motifSlug
  FROM guesses
  WHERE channel_id = ? AND date = ? AND guessed_at >= ?
  ORDER BY guessed_at ASC
`);

export function insertGuess(row) {
  return stmtInsert.run(row);
}

export function getGuesses(channelId, date, since = null) {
  return since ? stmtSelectSince.all(channelId, date, since) : stmtSelect.all(channelId, date);
}

export function getSessionMessage(channelId, date) {
  return stmtGetSession.get(channelId, date);
}

export function upsertSessionMessage(channelId, date, messageId) {
  return stmtUpsertSession.run(channelId, date, messageId);
}

export function resetRoom(channelId, date) {
  return stmtResetRoom.run(channelId, date);
}

export function getLatestSessionMessage(channelId) {
  return stmtGetLatestSession.get(channelId);
}

export function getAllChannelsForDate(date) {
  return db.prepare(`SELECT DISTINCT channel_id AS channelId FROM guesses WHERE date = ?`).all(date);
}

const stmtStoreWebhook = db.prepare(`
  INSERT OR REPLACE INTO webhooks (channel_id, webhook_id, webhook_token) VALUES (?, ?, ?)
`);
const stmtGetWebhook = db.prepare(`
  SELECT webhook_id AS webhookId, webhook_token AS webhookToken FROM webhooks WHERE channel_id = ?
`);

export function storeWebhook(channelId, webhookId, webhookToken) {
  return stmtStoreWebhook.run(channelId, webhookId, webhookToken);
}

export function getWebhook(channelId) {
  return stmtGetWebhook.get(channelId);
}

const stmtGetInvite = db.prepare(`SELECT invite_code AS inviteCode FROM channel_invites WHERE channel_id = ?`);
const stmtStoreInvite = db.prepare(`INSERT OR REPLACE INTO channel_invites (channel_id, invite_code) VALUES (?, ?)`);

export function getInviteCode(channelId) {
  return stmtGetInvite.get(channelId)?.inviteCode ?? null;
}

export function storeInviteCode(channelId, code) {
  return stmtStoreInvite.run(channelId, code);
}

const stmtUpsertError = db.prepare(`
  INSERT INTO session_errors (channel_id, date, user_id, error_count)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(channel_id, date, user_id) DO UPDATE SET error_count = excluded.error_count
`);
const stmtGetErrors = db.prepare(`
  SELECT user_id AS userId, error_count AS errorCount
  FROM session_errors WHERE channel_id = ? AND date = ?
`);

export function upsertSessionError(channelId, date, userId, errorCount) {
  return stmtUpsertError.run(channelId, date, userId, errorCount);
}

export function getSessionErrors(channelId, date) {
  return stmtGetErrors.all(channelId, date);
}
