// src/analysis/stats.ts
import type { Event } from "../simCore";
import type { MatchStats, BallMatchStats } from "../data/types";
import { calculateExcitement } from "./excitement";

export function calculateMatchStats(
  events: Event[],
  finalHpA: number,
  finalHpB: number,
  ballABaseDamage: number,
  ballBBaseDamage: number
): MatchStats {
  const statsA: BallMatchStats = {
    hitsLanded: 0,
    hitsMissed: 0,
    accuracy: 0,
    damageDealt: 0,
    damageTaken: 0,
    wallBounces: 0,
    longestCombo: 0,
    maxExcitementEvent: 0,
  };

  const statsB: BallMatchStats = { ...statsA };

  let currentComboA = 0;
  let currentComboB = 0;
  let lastHitBy: "A" | "B" | null = null;

  for (const event of events) {
    const excitement = calculateExcitement(event, finalHpA, finalHpB);

    switch (event.e) {
      case "hit":
        if (event.from === "A") {
          statsA.hitsLanded++;
          statsA.damageDealt += event.dmg;
          statsB.damageTaken += event.dmg;
          statsA.maxExcitementEvent = Math.max(statsA.maxExcitementEvent, excitement);

          // Combo tracking: consecutive hits by same fighter
          if (lastHitBy === "A") {
            currentComboA++;
          } else {
            currentComboA = 1;
            currentComboB = 0;
          }
          lastHitBy = "A";
          statsA.longestCombo = Math.max(statsA.longestCombo, currentComboA);
        } else {
          // Mirror logic for B
          statsB.hitsLanded++;
          statsB.damageDealt += event.dmg;
          statsA.damageTaken += event.dmg;
          statsB.maxExcitementEvent = Math.max(statsB.maxExcitementEvent, excitement);

          if (lastHitBy === "B") {
            currentComboB++;
          } else {
            currentComboB = 1;
            currentComboA = 0;
          }
          lastHitBy = "B";
          statsB.longestCombo = Math.max(statsB.longestCombo, currentComboB);
        }
        break;

      case "wall":
        if (event.id === "A") statsA.wallBounces++;
        else statsB.wallBounces++;
        break;
    }
  }

  // Accuracy estimation: hits / (hits + wall bounces + opponent hits)
  // This approximates: successful attacks vs total engagement events
  const totalEventsA = statsA.hitsLanded + statsA.wallBounces + statsB.hitsLanded;
  const totalEventsB = statsB.hitsLanded + statsB.wallBounces + statsA.hitsLanded;

  statsA.accuracy = totalEventsA > 0
    ? Math.round((statsA.hitsLanded / totalEventsA) * 100)
    : 0;
  statsB.accuracy = totalEventsB > 0
    ? Math.round((statsB.hitsLanded / totalEventsB) * 100)
    : 0;

  // Estimate misses (for future improvement: track actual weapon swing cycles)
  statsA.hitsMissed = totalEventsA - statsA.hitsLanded;
  statsB.hitsMissed = totalEventsB - statsB.hitsLanded;

  return { ballA: statsA, ballB: statsB };
}
