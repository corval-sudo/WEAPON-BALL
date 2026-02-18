-- Migration 002: Balance proposals and per-ball weapon overrides

CREATE TABLE weapon_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ball_id TEXT NOT NULL,
  weapon_id TEXT NOT NULL,
  base_damage INTEGER,
  reach INTEGER,
  omega INTEGER,
  speed_mult INTEGER,
  weight INTEGER,
  tip_radius INTEGER,
  applied_at TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  FOREIGN KEY (ball_id) REFERENCES balls(id)
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  ball_id TEXT NOT NULL,
  ball_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  current_stats TEXT NOT NULL,   -- JSON blob
  proposed_stats TEXT NOT NULL,  -- JSON blob
  dry_run_results TEXT,          -- JSON blob, nullable
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (ball_id) REFERENCES balls(id)
);

CREATE INDEX idx_proposals_ball ON proposals(ball_id);
CREATE INDEX idx_proposals_status ON proposals(status);
CREATE INDEX idx_weapon_overrides_ball ON weapon_overrides(ball_id);
