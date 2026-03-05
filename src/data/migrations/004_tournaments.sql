-- Migration 004: Tournament system + X/Twitter config
-- Single-elimination bracket tournaments running 3x/day.

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  bracket_size INTEGER NOT NULL,
  fighter_count INTEGER NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  total_rounds INTEGER NOT NULL,
  champion_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  ball_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  eliminated_in_round INTEGER,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
  FOREIGN KEY (ball_id) REFERENCES balls(id),
  UNIQUE(tournament_id, ball_id)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  bracket_position INTEGER NOT NULL,
  match_id INTEGER,
  ball_a_id TEXT,
  ball_b_id TEXT,
  winner_id TEXT,
  is_bye INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_entries_tid ON tournament_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_tid ON tournament_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- Tournament and X/Twitter config seeds
INSERT OR IGNORE INTO arena_master_config (key, value, updated_at, description) VALUES
  ('tournament_match_delay_ms', '15000', datetime('now'), 'Milliseconds between tournament bracket matches'),
  ('tournament_enabled', 'true', datetime('now'), 'Set to "false" to disable automatic tournaments'),
  ('x_api_key', '', datetime('now'), 'Twitter/X API key (OAuth 1.0a)'),
  ('x_api_secret', '', datetime('now'), 'Twitter/X API key secret'),
  ('x_access_token', '', datetime('now'), 'Twitter/X access token'),
  ('x_access_token_secret', '', datetime('now'), 'Twitter/X access token secret'),
  ('x_enabled', 'false', datetime('now'), 'Set to "true" to enable posting tournament finals to X'),
  ('x_last_post_date', '', datetime('now'), 'ISO date of the last X post (auto-updated)');
