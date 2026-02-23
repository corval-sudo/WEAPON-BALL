// src/match/runner.ts
import { createSim, stepSim, canonicalEventsString, canonicalInputs, MatchSpec, BallSpec } from "../simCore";
import { ArenaDatabase } from "../data/database";
import { calculateMatchStats } from "../analysis/stats";
import type { BallEntity, EnhancedMatchResult, ReplayFrame } from "../data/types";
import * as crypto from "node:crypto";

// Target ~600 frames for WebSocket replay (≈20 seconds at 30fps).
// For a 18000-tick match this samples every 30th tick; shorter matches sample more densely.
const REPLAY_TARGET_FRAMES = 600;

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface MatchRequest {
  ballAId: string;
  ballBId: string;
  arenaName: string;
  seed: number;
  weapons: Record<string, any>;     // WeaponDef from matchSpec
  arenaConfig: { w: number; h: number; wallRestitution: number };
  simConfig: { scale: number; maxTicks: number };
  weaponSetVersion?: string;
}

export class MatchRunner {
  constructor(private db: ArenaDatabase) {}

  async runMatch(request: MatchRequest): Promise<EnhancedMatchResult> {
    // 1. Load ball entities
    const ballA = this.db.getBallById(request.ballAId);
    const ballB = this.db.getBallById(request.ballBId);

    if (!ballA) throw new Error(`Ball A (${request.ballAId}) not found`);
    if (!ballB) throw new Error(`Ball B (${request.ballBId}) not found`);

    // 2. Create MatchSpec from entities
    const matchSpec = this.createMatchSpec(ballA, ballB, request);

    // 3. Run simulation — capture sampled frames for WebSocket replay.
    //    We don't know totalTicks upfront, so we collect every tick and
    //    downsample afterward to REPLAY_TARGET_FRAMES.
    const sim = createSim(matchSpec);
    const MAX_ITERATIONS = matchSpec.sim.maxTicks * 2;
    let iterations = 0;
    const rawFrames: ReplayFrame[] = [];

    while (!sim.done && iterations < MAX_ITERATIONS) {
      stepSim(sim);
      iterations++;
      // Capture state after each step (positions are in scaled sim units)
      rawFrames.push({
        tick: sim.tick,
        a: { x: sim.A.pos.x, y: sim.A.pos.y, angle: sim.A.theta, hp: sim.A.hp },
        b: { x: sim.B.pos.x, y: sim.B.pos.y, angle: sim.B.theta, hp: sim.B.hp },
      });
    }

    if (iterations >= MAX_ITERATIONS && !sim.done) {
      throw new Error("Simulation exceeded max iterations");
    }

    // Downsample to ~REPLAY_TARGET_FRAMES, always keeping event ticks for accuracy.
    const eventTicks = new Set(sim.events.map(ev => ev.t));
    const step = Math.max(1, Math.floor(rawFrames.length / REPLAY_TARGET_FRAMES));
    const replayFrames: ReplayFrame[] = [];
    for (let i = 0; i < rawFrames.length; i++) {
      const f = rawFrames[i];
      if (f && (i % step === 0 || eventTicks.has(f.tick))) {
        replayFrames.push(f);
      }
    }

    // 4. Calculate statistics
    const stats = calculateMatchStats(
      sim.events,
      sim.A.hp,
      sim.B.hp,
      sim.A.baseDamage,
      sim.B.baseDamage
    );

    // 5. Create enhanced result
    const inputsHash = sha256Hex(JSON.stringify(canonicalInputs(matchSpec)));
    const eventsHash = sha256Hex(canonicalEventsString(sim.events));
    const resultHash = sha256Hex(
      JSON.stringify({ inputsHash, eventsHash, winner: sim.winner })
    );

    const result: EnhancedMatchResult = {
      seed: request.seed,
      ticks: sim.tick,
      winner: sim.winner!,
      ballAId: ballA.id,
      ballBId: ballB.id,
      arenaName: request.arenaName,
      inputsHash,
      eventsHash,
      resultHash,
      events: sim.events,
      stats,
      timestamp: new Date().toISOString(),
      replayFrames,
    };

    // 6. Save to database
    this.db.insertMatch(result);

    // 7. Update ball careers
    this.updateBallCareers(ballA, ballB, result);

    return result;
  }

  private createMatchSpec(
    ballA: BallEntity,
    ballB: BallEntity,
    request: MatchRequest
  ): MatchSpec {
    const weapons = { ...request.weapons };

    // Apply per-ball weapon overrides if present
    const overrideA = this.db.getWeaponOverrides(ballA.id)
      .find(o => o.weaponId === ballA.weaponId);
    const overrideB = this.db.getWeaponOverrides(ballB.id)
      .find(o => o.weaponId === ballB.weaponId);

    let weaponIdA = ballA.weaponId;
    let weaponIdB = ballB.weaponId;

    if (overrideA) {
      weaponIdA = `${ballA.weaponId}_A`;
      weapons[weaponIdA] = {
        ...request.weapons[ballA.weaponId],
        ...(overrideA.baseDamage !== undefined && { baseDamage: overrideA.baseDamage }),
        ...(overrideA.reach !== undefined && { reach: overrideA.reach }),
        ...(overrideA.omega !== undefined && { omega: overrideA.omega }),
        ...(overrideA.speedMult !== undefined && { speedMult: overrideA.speedMult }),
        ...(overrideA.weight !== undefined && { weight: overrideA.weight }),
        ...(overrideA.tipRadius !== undefined && { tipRadius: overrideA.tipRadius }),
      };
    }

    if (overrideB) {
      weaponIdB = `${ballB.weaponId}_B`;
      weapons[weaponIdB] = {
        ...request.weapons[ballB.weaponId],
        ...(overrideB.baseDamage !== undefined && { baseDamage: overrideB.baseDamage }),
        ...(overrideB.reach !== undefined && { reach: overrideB.reach }),
        ...(overrideB.omega !== undefined && { omega: overrideB.omega }),
        ...(overrideB.speedMult !== undefined && { speedMult: overrideB.speedMult }),
        ...(overrideB.weight !== undefined && { weight: overrideB.weight }),
        ...(overrideB.tipRadius !== undefined && { tipRadius: overrideB.tipRadius }),
      };
    }

    const ballASpec: BallSpec = {
      id: "A",
      hp: ballA.baseHp,
      radius: ballA.radius,
      pos: { x: 120, y: 200 },
      vel: { x: 25, y: 35 },
      weaponId: weaponIdA,
      ...(ballA.restitution !== undefined && { restitution: ballA.restitution }),
    };

    const ballBSpec: BallSpec = {
      id: "B",
      hp: ballB.baseHp,
      radius: ballB.radius,
      pos: { x: 280, y: 200 },
      vel: { x: -20, y: 30 },
      weaponId: weaponIdB,
      ...(ballB.restitution !== undefined && { restitution: ballB.restitution }),
    };

    const matchSpec: MatchSpec = {
      seed: request.seed,
      sim: request.simConfig,
      arena: request.arenaConfig,
      weapons,
      ballA: ballASpec,
      ballB: ballBSpec,
    };

    if (request.weaponSetVersion !== undefined) {
      (matchSpec as any).weaponSetVersion = request.weaponSetVersion;
    }

    return matchSpec;
  }

  private updateBallCareers(
    ballA: BallEntity,
    ballB: BallEntity,
    result: EnhancedMatchResult
  ): void {
    const winnerId = result.winner === "A" ? ballA.id : ballB.id;
    const loserId = result.winner === "A" ? ballB.id : ballA.id;

    // Update winner
    const winner = winnerId === ballA.id ? ballA : ballB;
    const winnerStats = result.winner === "A" ? result.stats.ballA : result.stats.ballB;

    winner.wins++;
    winner.totalDamageDealt += winnerStats.damageDealt;
    winner.totalDamageTaken += winnerStats.damageTaken;
    winner.currentStreak = winner.currentStreak >= 0
      ? winner.currentStreak + 1
      : 1;
    winner.longestWinStreak = Math.max(
      winner.longestWinStreak,
      winner.currentStreak
    );

    this.db.updateBallStats(winner.id, {
      wins: winner.wins,
      totalDamageDealt: winner.totalDamageDealt,
      totalDamageTaken: winner.totalDamageTaken,
      currentStreak: winner.currentStreak,
      longestWinStreak: winner.longestWinStreak,
    });

    // Update loser
    const loser = loserId === ballA.id ? ballA : ballB;
    const loserStats = result.winner === "A" ? result.stats.ballB : result.stats.ballA;

    loser.losses++;
    loser.totalDamageDealt += loserStats.damageDealt;
    loser.totalDamageTaken += loserStats.damageTaken;
    loser.currentStreak = loser.currentStreak <= 0
      ? loser.currentStreak - 1
      : -1;

    this.db.updateBallStats(loser.id, {
      losses: loser.losses,
      totalDamageDealt: loser.totalDamageDealt,
      totalDamageTaken: loser.totalDamageTaken,
      currentStreak: loser.currentStreak,
    });
  }
}
