CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tema_id TEXT NOT NULL,
  enfoque TEXT NOT NULL,
  material_ids TEXT NOT NULL DEFAULT '[]',
  selected_pages TEXT,
  flashcards TEXT,
  notes TEXT,
  material_text TEXT,
  current_phase TEXT,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_tema ON study_sessions(user_id, tema_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_updated ON study_sessions(user_id, last_opened_at);
