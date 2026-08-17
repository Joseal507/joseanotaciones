-- Adds password-based login alongside existing Google OAuth, without
-- touching `users`. Identity stays exactly users.id — this table only
-- carries a credential FOR that same id, never a competing identity.
CREATE TABLE IF NOT EXISTS password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  password_hash TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'scrypt',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
