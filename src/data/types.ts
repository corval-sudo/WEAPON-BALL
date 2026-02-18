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
