-- F27: the wearer's XToys Webhook ID per session. Never part of the session state; deleted on disconnect and session end.
CREATE TABLE IF NOT EXISTS toys (
  session_id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
