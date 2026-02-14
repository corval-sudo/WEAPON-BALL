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
