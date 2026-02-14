-- Balls table: persistent fighter identities
CREATE TABLE balls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  personality TEXT NOT NULL,
  color TEXT NOT NULL,
  base_hp INTEGER NOT NULL,
  radius INTEGER NOT NULL,
  weapon_id TEXT NOT NULL,
  restitution INTEGER,

  -- Career statistics
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_damage_dealt INTEGER NOT NULL DEFAULT 0,
  total_damage_taken INTEGER NOT NULL DEFAULT 0,
  longest_win_streak INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  retired BOOLEAN NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  retired_at TEXT
);

-- Matches table: complete match records
CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed INTEGER NOT NULL,
  ball_a_id TEXT NOT NULL,
  ball_b_id TEXT NOT NULL,
  arena_name TEXT NOT NULL,
  winner TEXT NOT NULL CHECK(winner IN ('A', 'B')),
  ticks INTEGER NOT NULL,
  inputs_hash TEXT NOT NULL,
  events_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL,

  -- Denormalized stats for fast queries
  ball_a_damage_dealt INTEGER,
  ball_a_damage_taken INTEGER,
  ball_a_accuracy INTEGER,
  ball_b_damage_dealt INTEGER,
  ball_b_damage_taken INTEGER,
  ball_b_accuracy INTEGER,

  FOREIGN KEY (ball_a_id) REFERENCES balls(id),
  FOREIGN KEY (ball_b_id) REFERENCES balls(id)
);

-- Events table: optional detailed event storage
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  data TEXT NOT NULL,              -- JSON blob
  excitement_score INTEGER,

  FOREIGN KEY (match_id) REFERENCES matches(id)
);

-- Performance indexes
CREATE INDEX idx_matches_ball_a ON matches(ball_a_id);
CREATE INDEX idx_matches_ball_b ON matches(ball_b_id);
CREATE INDEX idx_matches_timestamp ON matches(timestamp DESC);
CREATE INDEX idx_events_match ON events(match_id);
CREATE INDEX idx_balls_wins ON balls(wins DESC);
CREATE INDEX idx_balls_active ON balls(retired) WHERE retired = 0;
