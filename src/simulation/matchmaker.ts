// src/simulation/matchmaker.ts
// Basic matchmaking algorithm for selecting interesting matchups
import type { BallEntity } from "../data/types";

export interface MatchupScore {
  ballA: BallEntity;
  ballB: BallEntity;
  score: number;
  factors: {
    skillGap: number;
    streakInterest: number;
    weaponDiversity: number;
    underdog: number;
    freshness: number;
  };
}

export interface MatchmakingOptions {
  preferCloseSkill?: boolean;      // Prefer evenly matched opponents
  allowRepeats?: boolean;           // Allow recent rematches
  favorUnderdogs?: boolean;         // Boost underdog matchups
  weaponVariety?: boolean;          // Prefer different weapon types
}

const DEFAULT_OPTIONS: MatchmakingOptions = {
  preferCloseSkill: true,
  allowRepeats: true,
  favorUnderdogs: true,
  weaponVariety: true,
};

/**
 * Calculate a skill rating for a ball based on their record and stats
 */
export function calculateSkill(ball: BallEntity): number {
  const totalMatches = ball.wins + ball.losses;

  if (totalMatches === 0) {
    // Unproven fighter - use HP and stats as proxy
    return 1000 + (ball.baseHp - 1000) + (ball.totalDamageDealt / 10);
  }

  // Win rate component (0-1000 points)
  const winRate = ball.wins / totalMatches;
  const winRateScore = winRate * 1000;

  // Streak bonus (hot fighters get boost)
  const streakBonus = ball.currentStreak > 0 ? Math.min(ball.currentStreak * 50, 200) : 0;

  // Damage efficiency (damage dealt vs taken)
  const damageRatio = ball.totalDamageTaken > 0
    ? ball.totalDamageDealt / ball.totalDamageTaken
    : 1;
  const damageScore = Math.min(damageRatio * 100, 200);

  return winRateScore + streakBonus + damageScore;
}

/**
 * Score a potential matchup based on various factors
 */
export function scoreMatchup(
  ballA: BallEntity,
  ballB: BallEntity,
  options: MatchmakingOptions = DEFAULT_OPTIONS
): MatchupScore {
  const skillA = calculateSkill(ballA);
  const skillB = calculateSkill(ballB);

  // Factor 1: Skill gap (closer = better for competitive matches)
  const skillGap = Math.abs(skillA - skillB);
  const skillGapScore = options.preferCloseSkill
    ? Math.max(0, 100 - (skillGap / 10)) // Prefer close matches
    : Math.min(100, skillGap / 5);       // Prefer mismatches

  // Factor 2: Streak interest (one fighter on streak = exciting)
  const hasStreak = Math.abs(ballA.currentStreak) >= 3 || Math.abs(ballB.currentStreak) >= 3;
  const bothOnStreak = Math.abs(ballA.currentStreak) >= 3 && Math.abs(ballB.currentStreak) >= 3;
  const streakScore = bothOnStreak ? 100 : hasStreak ? 60 : 20;

  // Factor 3: Weapon diversity (different weapons = more interesting)
  const weaponDiversityScore = options.weaponVariety && ballA.weaponId !== ballB.weaponId
    ? 80
    : 30;

  // Factor 4: Underdog potential (mismatch with potential upset)
  const underdogScore = skillGap > 100 && options.favorUnderdogs
    ? 70
    : 20;

  // Factor 5: Freshness (both undefeated = fresh matchup)
  const bothUndefeated = (ballA.wins + ballA.losses === 0) && (ballB.wins + ballB.losses === 0);
  const freshnessScore = bothUndefeated ? 50 : 30;

  // Calculate total score (weighted average)
  const totalScore =
    skillGapScore * 0.3 +
    streakScore * 0.25 +
    weaponDiversityScore * 0.2 +
    underdogScore * 0.15 +
    freshnessScore * 0.1;

  return {
    ballA,
    ballB,
    score: totalScore,
    factors: {
      skillGap: skillGapScore,
      streakInterest: streakScore,
      weaponDiversity: weaponDiversityScore,
      underdog: underdogScore,
      freshness: freshnessScore,
    },
  };
}

/**
 * Find the best matchup from a roster of balls
 */
export function findBestMatchup(
  roster: BallEntity[],
  options: MatchmakingOptions = DEFAULT_OPTIONS
): MatchupScore | null {
  const activeBalls = roster.filter(b => !b.retired);

  if (activeBalls.length < 2) {
    return null;
  }

  let bestMatchup: MatchupScore | null = null;

  // Score all possible pairings
  for (let i = 0; i < activeBalls.length; i++) {
    for (let j = i + 1; j < activeBalls.length; j++) {
      const ballA = activeBalls[i]!;
      const ballB = activeBalls[j]!;

      const matchup = scoreMatchup(ballA, ballB, options);

      if (!bestMatchup || matchup.score > bestMatchup.score) {
        bestMatchup = matchup;
      }
    }
  }

  return bestMatchup;
}

/**
 * Find N best matchups for a round-robin or tournament
 */
export function findTopMatchups(
  roster: BallEntity[],
  count: number,
  options: MatchmakingOptions = DEFAULT_OPTIONS
): MatchupScore[] {
  const activeBalls = roster.filter(b => !b.retired);

  if (activeBalls.length < 2) {
    return [];
  }

  const allMatchups: MatchupScore[] = [];

  // Score all possible pairings
  for (let i = 0; i < activeBalls.length; i++) {
    for (let j = i + 1; j < activeBalls.length; j++) {
      const ballA = activeBalls[i]!;
      const ballB = activeBalls[j]!;

      allMatchups.push(scoreMatchup(ballA, ballB, options));
    }
  }

  // Sort by score descending and return top N
  return allMatchups
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

/**
 * Find a random matchup (for variety)
 */
export function findRandomMatchup(roster: BallEntity[]): MatchupScore | null {
  const activeBalls = roster.filter(b => !b.retired);

  if (activeBalls.length < 2) {
    return null;
  }

  const ballA = activeBalls[Math.floor(Math.random() * activeBalls.length)]!;
  let ballB = activeBalls[Math.floor(Math.random() * activeBalls.length)]!;

  // Ensure different balls
  while (ballB.id === ballA.id) {
    ballB = activeBalls[Math.floor(Math.random() * activeBalls.length)]!;
  }

  return scoreMatchup(ballA, ballB);
}
