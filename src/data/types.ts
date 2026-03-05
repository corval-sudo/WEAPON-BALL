// src/data/types.ts
import type { Event } from "../simCore";

export interface BallEntity {
  id: string;                    // UUID
  name: string;                  // e.g., "Crimson Crusher"
  personality: string;           // e.g., "Aggressive brawler who never backs down"
  color: string;                 // Hex color e.g., "#FF4444"
  baseHp: number;                // Starting HP (typically 1000)
  radius: number;                // Ball size (typically 42)
  weaponId: string;              // References weapon in weapons catalog
  restitution?: number;          // Bounce coefficient (1000ths scale)
  attractionMult?: number;       // Chase aggression (1000ths): 1400=hunts, 1000=neutral, 700=defensive

  // Career statistics (updated after each match)
  wins: number;
  losses: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  longestWinStreak: number;
  currentStreak: number;         // Positive = win streak, negative = loss streak
  retired: boolean;
  createdAt: string;             // ISO date string
  retiredAt?: string;
}

export interface BallRoster {
  balls: BallEntity[];
  version: string;               // Schema version for migrations
}

/** Compact per-tick snapshot captured during the live simulation run. */
export interface ReplayFrame {
  tick: number;
  a: { x: number; y: number; angle: number; hp: number };
  b: { x: number; y: number; angle: number; hp: number };
}

export interface EnhancedMatchResult {
  seed: number;
  ticks: number;
  winner: "A" | "B";
  ballAId: string;               // References BallEntity.id
  ballBId: string;
  arenaName: string;
  inputsHash: string;
  eventsHash: string;
  resultHash: string;
  events: Event[];               // From simCore
  stats: MatchStats;             // NEW - detailed statistics
  timestamp: string;             // ISO date string
  /** Sampled physics frames for WebSocket replay (real positions, not orbital). */
  replayFrames?: ReplayFrame[];
}

export interface MatchStats {
  ballA: BallMatchStats;
  ballB: BallMatchStats;
}

export interface BallMatchStats {
  hitsLanded: number;
  hitsMissed: number;            // Estimated from event patterns
  accuracy: number;              // 0-100 percentage
  damageDealt: number;
  damageTaken: number;
  wallBounces: number;
  longestCombo: number;          // Consecutive hits without interruption
  maxExcitementEvent: number;    // 0-10 scale for highlight detection
}

// --- Balance & AI Agent Types ---

export interface WeaponOverride {
  ballId: string;
  weaponId: string;              // Which weapon this applies to
  baseDamage?: number;
  reach?: number;
  omega?: number;
  speedMult?: number;
  weight?: number;
  tipRadius?: number;
  appliedAt: string;             // ISO date
  proposalId: string;            // Links to proposal that created this
}

export interface StatProposal {
  id: string;                    // UUID
  ballId: string;
  ballName: string;
  reason: string;                // Claude's explanation
  currentStats: Record<string, unknown>;
  proposedStats: Record<string, unknown>;
  dryRunResults?: DryRunResult;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface DryRunResult {
  matchesSimulated: number;
  winRateBefore: number;         // 0-1
  winRateAfter: number;          // 0-1
  avgExcitementBefore: number;   // 0-10
  avgExcitementAfter: number;    // 0-10
  avgMatchDurationBefore: number; // ticks
  avgMatchDurationAfter: number;
}

export interface BalanceReport {
  generatedAt: string;
  totalMatches: number;
  fighters: FighterBalance[];
  weaponSummary: WeaponBalance[];
  overallEngagementScore: number; // 0-10
}

export interface FighterBalance {
  ball: BallEntity;
  winRate: number;               // 0-1
  avgDamageDealt: number;
  avgDamageTaken: number;
  avgExcitement: number;         // 0-10 estimated from damage ratios
  matchCount: number;
  balanceScore: number;          // 0-100, 50 = perfectly balanced
}

export interface WeaponBalance {
  weaponId: string;
  userCount: number;
  avgWinRate: number;
  avgDamageDealt: number;
  dominanceScore: number;        // >60 = overpowered, <40 = underpowered
}

// --- Tournament Types ---

export interface Tournament {
  id: number;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  bracketSize: number;           // Power of 2 (8, 16, 32)
  fighterCount: number;          // Actual fighters entered
  currentRound: number;
  totalRounds: number;           // log2(bracketSize)
  championId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TournamentEntry {
  id: number;
  tournamentId: number;
  ballId: string;
  seed: number;                  // 1 = top seed
  eliminatedInRound: number | null;
}

export interface TournamentMatch {
  id: number;
  tournamentId: number;
  round: number;                 // 1 = first round, increasing
  bracketPosition: number;       // Position within the round (0-indexed)
  matchId: number | null;        // FK to matches table (NULL until played)
  ballAId: string | null;        // NULL for TBD slots
  ballBId: string | null;        // NULL for TBD or bye
  winnerId: string | null;
  isBye: boolean;
}
