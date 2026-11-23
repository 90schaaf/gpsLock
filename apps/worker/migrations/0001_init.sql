-- Lockation worker storage (Cloudflare D1 / SQLite).
-- Apply with: npx wrangler d1 migrations apply lockation --remote

-- Check-in / background-update history, last 200 per session (F9).
CREATE TABLE IF NOT EXISTS history (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS history_session ON history (session_id);

-- OwnTracks device credentials (F14); only a SHA-256 hash of the password.
CREATE TABLE IF NOT EXISTS devices (
  username TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ntfy topics per session and audience (wearer / keyholder).
CREATE TABLE IF NOT EXISTS topics (
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  topic TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, role)
);

-- Next time a session needs a tick (1-minute cron only touches due sessions).
CREATE TABLE IF NOT EXISTS due (
  session_id TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS due_next ON due (next_at);

-- Sent notifications (dedupe) and rate-limit markers.
CREATE TABLE IF NOT EXISTS sent (
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (session_id, key)
);
CREATE INDEX IF NOT EXISTS sent_at ON sent (at);

-- Small key/value settings (cron cursor).
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
