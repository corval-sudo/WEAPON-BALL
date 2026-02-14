// src/analysis/excitement.ts
import type { Event } from "../simCore";

/**
 * Calculate excitement score for an event (0-10 scale)
 * Used by Arena Master to identify highlight moments
 */
export function calculateExcitement(
  event: Event,
  hpA: number,
  hpB: number
): number {
  switch (event.e) {
    case "hit": {
      let score = 3; // Base excitement for any hit

      // High damage hits are exciting
      if (event.dmg >= 30) score += 3;
      else if (event.dmg >= 20) score += 2;
      else if (event.dmg >= 15) score += 1;

      // Close HP scenarios increase tension
      const minHp = Math.min(hpA, hpB);
      if (minHp <= 100) score += 3;      // Clutch territory
      else if (minHp <= 300) score += 2;
      else if (minHp <= 500) score += 1;

      return Math.min(score, 10);
    }

    case "dead":
      return 10; // Always maximum excitement

    case "timeout":
      return 8;  // Close match that went the distance

    case "collide":
      return 2;  // Minor event

    case "wall":
      return 1;  // Low excitement

    default:
      return 0;
  }
}

export function getHighlights(events: Event[], threshold: number = 7): Event[] {
  // Simplified version - full implementation would track HP context
  return events.filter(e => {
    if (e.e === "dead" || e.e === "timeout") return true;
    if (e.e === "hit" && e.dmg >= 25) return true;
    return false;
  });
}
