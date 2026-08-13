CREATE TABLE IF NOT EXISTS xp_events (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  amount INTEGER NOT NULL,
  metadata TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user_occurred
  ON xp_events(user_id, occurred_at DESC);
