// src/agent/proposal-engine.ts
// Runs dry-run simulations to validate stat proposals before DB writes.

import { createSim, stepSim } from "../simCore";
import type { MatchSpec, BallSpec } from "../simCore";
import { calculateMatchStats } from "../analysis/stats";
import { calculateExcitement } from "../analysis/excitement";
import { calculateSkill } from "../simulation/matchmaker";
import type { ArenaDatabase } from "../data/database";
import type { StatProposal, DryRunResult, BallEntity, WeaponOverride } from "../data/types";

const DEFAULT_MATCH_CONFIG = {
  arenaConfig: { w: 400, h: 700, wallRestitution: 850 },
  simConfig: { scale: 1000, maxTicks: 18000 },
};

const WEAPONS_CATALOG: Record<string, any> = {
  short_sword: { type: "blade", reach: 60, tipRadius: 15, bladeStart: 25, bladeWidth: 8, shaftRadius: 5, omega: 1800, baseDamage: 12, ramp: 3, speedMult: 1000, weight: 800 },
  katana:      { type: "blade", reach: 85, tipRadius: 12, bladeStart: 30, bladeWidth: 10, shaftRadius: 6, omega: 1600, baseDamage: 11, ramp: 3, speedMult: 1050, weight: 850 },
  spear:       { type: "point", reach: 110, tipRadius: 8, shaftRadius: 5, omega: 1200, baseDamage: 18, ramp: 4, speedMult: 950, weight: 900 },
  mace:        { type: "blunt", reach: 70, tipRadius: 35, shaftRadius: 8, omega: 1400, baseDamage: 14, ramp: 2, speedMult: 900, weight: 1400 },
};

function runSingleSim(spec: MatchSpec): { winner: "A" | "B"; ticks: number; excitement: number } {
  const sim = createSim(spec);
  const MAX = spec.sim.maxTicks * 2;
  let i = 0;

  while (!sim.done && i < MAX) {
    stepSim(sim);
    i++;
  }

  // Compute average excitement from all events
  const avgExcitement = sim.events.length > 0
    ? sim.events.reduce((sum, e) => sum + calculateExcitement(e, sim.A.hp, sim.B.hp), 0) / sim.events.length
    : 0;

  return {
    winner: sim.winner ?? "A",
    ticks: sim.tick,
    excitement: avgExcitement,
  };
}

function buildBallSpec(
  ball: BallEntity,
  side: "A" | "B",
  weaponOverride?: WeaponOverride
): { spec: BallSpec; weaponKey: string; weaponDef: any } {
  const pos = side === "A" ? { x: 120, y: 200 } : { x: 280, y: 200 };
  const vel = side === "A" ? { x: 25, y: 35 } : { x: -20, y: 30 };

  let weaponKey = ball.weaponId;
  let weaponDef = { ...WEAPONS_CATALOG[ball.weaponId] };

  if (weaponOverride) {
    weaponKey = `${ball.weaponId}_${side}`;
    weaponDef = {
      ...weaponDef,
      ...(weaponOverride.baseDamage !== undefined && { baseDamage: weaponOverride.baseDamage }),
      ...(weaponOverride.reach !== undefined && { reach: weaponOverride.reach }),
      ...(weaponOverride.omega !== undefined && { omega: weaponOverride.omega }),
      ...(weaponOverride.speedMult !== undefined && { speedMult: weaponOverride.speedMult }),
      ...(weaponOverride.weight !== undefined && { weight: weaponOverride.weight }),
      ...(weaponOverride.tipRadius !== undefined && { tipRadius: weaponOverride.tipRadius }),
    };
  }

  const ballSpec: BallSpec = {
    id: side,
    hp: ball.baseHp,
    radius: ball.radius,
    pos,
    vel,
    weaponId: weaponKey,
    ...(ball.restitution !== undefined && { restitution: ball.restitution }),
  };

  return { spec: ballSpec, weaponKey, weaponDef };
}

export async function runDryRun(
  proposal: StatProposal,
  db: ArenaDatabase
): Promise<DryRunResult> {
  const targetBall = db.getBallById(proposal.ballId);
  if (!targetBall) throw new Error(`Ball ${proposal.ballId} not found`);

  // Pick 3 opponents: best, worst, mid-tier by skill score
  const opponents = db.getActiveBalls()
    .filter(b => b.id !== targetBall.id && (b.wins + b.losses) >= 1)
    .sort((a, b) => calculateSkill(b) - calculateSkill(a));

  if (opponents.length < 1) {
    // Not enough opponents with match history — return neutral result
    return {
      matchesSimulated: 0,
      winRateBefore: 0.5,
      winRateAfter: 0.5,
      avgExcitementBefore: 5,
      avgExcitementAfter: 5,
      avgMatchDurationBefore: 9000,
      avgMatchDurationAfter: 9000,
    };
  }

  // Select up to 3 opponents (top, bottom, middle)
  const selected: BallEntity[] = [];
  const best = opponents[0];
  const worst = opponents[opponents.length - 1];
  const mid = opponents[Math.floor(opponents.length / 2)];
  if (best) selected.push(best);
  if (opponents.length >= 2 && worst && worst.id !== best?.id) selected.push(worst);
  if (opponents.length >= 3 && mid && mid.id !== best?.id && mid.id !== worst?.id) selected.push(mid);

  // Build the "before" ball (current stats + existing overrides)
  const existingOverride = db.getWeaponOverrides(targetBall.id)
    .find(o => o.weaponId === targetBall.weaponId);

  // Build the "after" ball (proposed stats)
  const proposed = proposal.proposedStats as any;
  const afterBall: BallEntity = {
    ...targetBall,
    ...(proposed.baseHp !== undefined && { baseHp: proposed.baseHp }),
    ...(proposed.radius !== undefined && { radius: proposed.radius }),
    ...(proposed.restitution !== undefined && { restitution: proposed.restitution }),
    ...(proposed.weaponId !== undefined && { weaponId: proposed.weaponId }),
  };

  const afterOverride: WeaponOverride | undefined = proposed.weaponOverride
    ? {
        ballId: targetBall.id,
        weaponId: afterBall.weaponId,
        ...proposed.weaponOverride,
        appliedAt: new Date().toISOString(),
        proposalId: proposal.id,
      }
    : undefined;

  // Run before/after simulations against each opponent
  const SEEDS = [42001, 42002, 42003];
  const beforeResults: Array<{ winner: "A" | "B"; ticks: number; excitement: number }> = [];
  const afterResults: Array<{ winner: "A" | "B"; ticks: number; excitement: number }> = [];

  for (const opponent of selected) {
    for (const seed of SEEDS.slice(0, Math.ceil(3 / selected.length))) {
      const opponentOverride = db.getWeaponOverrides(opponent.id)
        .find(o => o.weaponId === opponent.weaponId);

      // Before run
      const beforeA = buildBallSpec(targetBall, "A", existingOverride);
      const beforeB = buildBallSpec(opponent, "B", opponentOverride);
      beforeResults.push(runSingleSim({
        seed,
        sim: DEFAULT_MATCH_CONFIG.simConfig,
        arena: DEFAULT_MATCH_CONFIG.arenaConfig,
        weapons: { ...WEAPONS_CATALOG, [beforeA.weaponKey]: beforeA.weaponDef, [beforeB.weaponKey]: beforeB.weaponDef },
        ballA: beforeA.spec,
        ballB: beforeB.spec,
      }));

      // After run
      const afterA = buildBallSpec(afterBall, "A", afterOverride);
      const afterB = buildBallSpec(opponent, "B", opponentOverride);
      afterResults.push(runSingleSim({
        seed,
        sim: DEFAULT_MATCH_CONFIG.simConfig,
        arena: DEFAULT_MATCH_CONFIG.arenaConfig,
        weapons: { ...WEAPONS_CATALOG, [afterA.weaponKey]: afterA.weaponDef, [afterB.weaponKey]: afterB.weaponDef },
        ballA: afterA.spec,
        ballB: afterB.spec,
      }));
    }
  }

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    matchesSimulated: beforeResults.length,
    winRateBefore: beforeResults.filter(r => r.winner === "A").length / beforeResults.length,
    winRateAfter: afterResults.filter(r => r.winner === "A").length / afterResults.length,
    avgExcitementBefore: avg(beforeResults.map(r => r.excitement)),
    avgExcitementAfter: avg(afterResults.map(r => r.excitement)),
    avgMatchDurationBefore: avg(beforeResults.map(r => r.ticks)),
    avgMatchDurationAfter: avg(afterResults.map(r => r.ticks)),
  };
}

export function formatDryRunResult(result: DryRunResult, ballName: string): string {
  const winDelta = ((result.winRateAfter - result.winRateBefore) * 100).toFixed(1);
  const excDelta = (result.avgExcitementAfter - result.avgExcitementBefore).toFixed(2);
  const sign = (n: number) => n >= 0 ? "+" : "";

  const winImproved = Math.abs(result.winRateAfter - 0.5) < Math.abs(result.winRateBefore - 0.5);
  const excImproved = result.avgExcitementAfter > result.avgExcitementBefore;
  const verdict = winImproved || excImproved ? "RECOMMENDED" : "MARGINAL";

  return [
    `  Dry-run: ${result.matchesSimulated} simulated matches vs current roster`,
    `  Win rate:   ${(result.winRateBefore * 100).toFixed(0)}% → ${(result.winRateAfter * 100).toFixed(0)}%  (${sign(+winDelta)}${winDelta}%)  ${winImproved ? "✓ more balanced" : ""}`,
    `  Excitement: ${result.avgExcitementBefore.toFixed(2)} → ${result.avgExcitementAfter.toFixed(2)}  (${sign(+excDelta)}${excDelta})  ${excImproved ? "✓ more exciting" : ""}`,
    `  Duration:   ${Math.round(result.avgMatchDurationBefore / 30)}s → ${Math.round(result.avgMatchDurationAfter / 30)}s avg`,
    `  Verdict: ${verdict}`,
  ].join("\n");
}
