// src/analysis/summary.ts
import type { EnhancedMatchResult, BallEntity } from "../data/types";
import type { Event } from "../simCore";

export interface MatchSummary {
  title: string;
  description: string;
  highlights: string[];
  winnerStatement: string;
  stats: string;
}

export function generateMatchSummary(
  result: EnhancedMatchResult,
  ballA: BallEntity,
  ballB: BallEntity
): MatchSummary {
  const winner = result.winner === "A" ? ballA : ballB;
  const loser = result.winner === "A" ? ballB : ballA;
  const winnerStats = result.winner === "A" ? result.stats.ballA : result.stats.ballB;
  const loserStats = result.winner === "A" ? result.stats.ballB : result.stats.ballA;

  // Title
  const title = `${winner.name} defeats ${loser.name}`;

  // Description
  const duration = (result.ticks / 30).toFixed(1); // 30 ticks per second
  const intensity = getIntensityDescriptor(result);
  const totalHits = winnerStats.hitsLanded + loserStats.hitsLanded;

  const description =
    `In a ${intensity} battle, ${winner.name} emerged victorious after ${duration} seconds. ` +
    `The match saw ${totalHits} total hits landed.`;

  // Highlights
  const highlights = extractHighlights(result.events, ballA.name, ballB.name);

  // Winner statement
  const finalHpDiff = winnerStats.damageDealt - winnerStats.damageTaken;
  const margin = finalHpDiff > 300 ? "dominant" : finalHpDiff > 100 ? "significant" : "narrow";

  const winnerStatement =
    `${winner.name} finished with ${margin} HP advantage, ` +
    `landing ${winnerStats.hitsLanded} hits at ${winnerStats.accuracy}% accuracy.`;

  // Stats comparison
  const stats = formatStatsComparison(ballA.name, ballB.name, result.stats);

  return {
    title,
    description,
    highlights,
    winnerStatement,
    stats,
  };
}

function getIntensityDescriptor(result: EnhancedMatchResult): string {
  const totalHits = result.stats.ballA.hitsLanded + result.stats.ballB.hitsLanded;
  const maxCombo = Math.max(result.stats.ballA.longestCombo, result.stats.ballB.longestCombo);

  if (maxCombo >= 5 || totalHits >= 30) return "fierce";
  if (totalHits >= 20) return "intense";
  if (totalHits >= 10) return "competitive";
  return "tactical";
}

function extractHighlights(
  events: Event[],
  nameA: string,
  nameB: string
): string[] {
  const highlights: string[] = [];

  for (const event of events) {
    if (event.e === "hit" && event.dmg >= 25) {
      const from = event.from === "A" ? nameA : nameB;
      const to = event.to === "A" ? nameA : nameB;
      highlights.push(
        `Tick ${event.t}: ${from} lands devastating ${event.dmg} damage on ${to}`
      );
    }

    if (event.e === "dead") {
      const who = event.id === "A" ? nameA : nameB;
      highlights.push(`Tick ${event.t}: ${who} is eliminated`);
    }

    if (event.e === "timeout") {
      highlights.push(`Match goes to time limit - ${event.winner} wins on points`);
    }
  }

  return highlights.slice(0, 5); // Top 5 moments
}

function formatStatsComparison(
  nameA: string,
  nameB: string,
  stats: any
): string {
  return `
${nameA}:
  Hits Landed: ${stats.ballA.hitsLanded}
  Damage Dealt: ${stats.ballA.damageDealt}
  Accuracy: ${stats.ballA.accuracy}%
  Longest Combo: ${stats.ballA.longestCombo}

${nameB}:
  Hits Landed: ${stats.ballB.hitsLanded}
  Damage Dealt: ${stats.ballB.damageDealt}
  Accuracy: ${stats.ballB.accuracy}%
  Longest Combo: ${stats.ballB.longestCombo}
`.trim();
}
