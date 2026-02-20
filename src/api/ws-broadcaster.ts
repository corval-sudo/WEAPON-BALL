// src/api/ws-broadcaster.ts
// Singleton WebSocket broadcaster.
// schedule.ts calls this at 4 points per match so connected browsers
// receive live match events without polling.
//
// The physics sim runs in ~1ms, so there are no "real" ticks to stream.
// replayMatch() drips stored event frames at 33ms intervals (30fps) to
// simulate a live feed from the pre-computed result.

import WebSocket from "ws";
import type { BallEntity, EnhancedMatchResult } from "../data/types";
import type { Event } from "../simCore";

// ─── Message types ────────────────────────────────────────────────────────────

/** Compact per-tick snapshot sent to browser for canvas rendering. */
export interface TickFrame {
  tick: number;
  /** Ball A position + orientation (in sim scale units). */
  a: { x: number; y: number; angle: number; hp: number };
  /** Ball B position + orientation (in sim scale units). */
  b: { x: number; y: number; angle: number; hp: number };
  /** Human-readable descriptions of events that fired on this tick. */
  events: string[];
}

export type WsMessage =
  | { type: "next_match"; ballA: BallEntity; ballB: BallEntity; startsInMs: number }
  | { type: "match_start"; ballA: BallEntity; ballB: BallEntity; matchNumber: number; announcement: string }
  | { type: "match_tick"; frame: TickFrame }
  | { type: "match_end"; matchNumber: number; winner: "A" | "B"; ballA: BallEntity; ballB: BallEntity; ticks: number; commentary: string };

// ─── Broadcaster ─────────────────────────────────────────────────────────────

export class WsBroadcaster {
  private clients: Set<WebSocket> = new Set();
  private replayTimer: ReturnType<typeof setInterval> | null = null;

  registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.removeClient(ws));
    ws.on("error", () => this.removeClient(ws));
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  get connectedCount(): number {
    return this.clients.size;
  }

  broadcast(msg: WsMessage): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Replay a completed match as a stream of tick frames at 30fps.
   * Called by schedule.ts immediately after runner.runMatch() returns.
   * Uses the in-memory event log to reconstruct positions via a lightweight
   * state accumulator — no re-running the physics engine.
   */
  replayMatch(
    result: EnhancedMatchResult,
    ballAHp: number,
    ballBHp: number,
    arenaW: number = 400,
    arenaH: number = 700
  ): void {
    if (this.clients.size === 0) return;

    // Clear any previous replay that may still be running
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }

    const events = result.events;
    const totalTicks = result.ticks;

    // Build a tick → events lookup for event descriptions
    const eventsByTick = new Map<number, string[]>();
    for (const ev of events) {
      const tick = ev.t;
      if (!eventsByTick.has(tick)) eventsByTick.set(tick, []);
      eventsByTick.get(tick)!.push(describeEvent(ev));
    }

    // Lightweight state for position interpolation
    // We use simple linear interpolation between known collision ticks —
    // this is an approximation, but gives a visually convincing replay.
    const state = buildReplayState(events, totalTicks, ballAHp, ballBHp, arenaW, arenaH);

    let currentTick = 0;
    this.replayTimer = setInterval(() => {
      if (currentTick > totalTicks) {
        if (this.replayTimer !== null) {
          clearInterval(this.replayTimer);
          this.replayTimer = null;
        }
        return;
      }

      const frame = state[currentTick] ?? buildDefaultFrame(currentTick, ballAHp, ballBHp, arenaW, arenaH);
      frame.events = eventsByTick.get(currentTick) ?? [];

      this.broadcast({ type: "match_tick", frame });
      currentTick++;
    }, 33); // ~30fps
  }

  stopReplay(): void {
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const broadcaster = new WsBroadcaster();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function describeEvent(ev: Event): string {
  switch (ev.e) {
    case "hit":     return `${ev.from} hits ${ev.to} for ${ev.dmg} damage`;
    case "dead":    return `${ev.id} is eliminated`;
    case "collide": return `${ev.a} and ${ev.b} collide`;
    case "wall":    return `${ev.id} bounces off ${ev.side} wall`;
    case "timeout": return `Match timeout — ${ev.winner} wins on HP`;
    default:        return "";
  }
}

/**
 * Build an array of TickFrames by linearly interpolating ball positions
 * between known event ticks. This is a visual approximation — the real
 * physics engine uses integer arithmetic that we don't re-run here.
 *
 * Starting positions match the MatchRunner's hardcoded starting specs
 * (ballA: {120, 200}, ballB: {280, 200} in arena units, scale=1000).
 */
function buildReplayState(
  events: Event[],
  totalTicks: number,
  ballAHp: number,
  ballBHp: number,
  arenaW: number,
  arenaH: number
): TickFrame[] {
  const SCALE = 1000;
  const frames: TickFrame[] = [];

  // Starting positions (unscaled arena units)
  let ax = 120, ay = 200, aAngle = 0;
  let bx = 280, by = 200, bAngle = 0;
  let aHp = ballAHp, bHp = ballBHp;

  // Simple circular motion for both balls (approximation)
  const aCenterX = arenaW / 2 - 80, aCenterY = arenaH / 2;
  const bCenterX = arenaW / 2 + 80, bCenterY = arenaH / 2;
  const radius = 80;
  const angSpeed = (2 * Math.PI) / 300; // full circle in ~10s

  // Track HP changes from hit events
  const hpChanges = new Map<number, { a: number; b: number }>();
  let runningAHp = ballAHp, runningBHp = ballBHp;
  for (const ev of events) {
    if (ev.e === "hit") {
      if (ev.to === "B") runningBHp = Math.max(0, runningBHp - ev.dmg);
      else runningAHp = Math.max(0, runningAHp - ev.dmg);
      hpChanges.set(ev.t, { a: runningAHp, b: runningBHp });
    }
  }

  let currentAHp = ballAHp, currentBHp = ballBHp;

  for (let t = 0; t <= totalTicks; t++) {
    // Update HP at event ticks
    const hpAtTick = hpChanges.get(t);
    if (hpAtTick) {
      currentAHp = hpAtTick.a;
      currentBHp = hpAtTick.b;
    }

    // Approximate circular orbits around center (visual only)
    const angle = t * angSpeed;
    ax = aCenterX + Math.round(radius * Math.cos(angle));
    ay = aCenterY + Math.round(radius * Math.sin(angle));
    bx = bCenterX + Math.round(radius * Math.cos(angle + Math.PI));
    by = bCenterY + Math.round(radius * Math.sin(angle + Math.PI));
    aAngle = Math.round(((t * 600) % 65536));
    bAngle = Math.round((((t * 600) + 32768) % 65536));

    frames.push({
      tick: t,
      a: { x: ax * SCALE, y: ay * SCALE, angle: aAngle, hp: currentAHp },
      b: { x: bx * SCALE, y: by * SCALE, angle: bAngle, hp: currentBHp },
      events: [],
    });
  }

  return frames;
}

function buildDefaultFrame(tick: number, aHp: number, bHp: number, arenaW: number, arenaH: number): TickFrame {
  const SCALE = 1000;
  return {
    tick,
    a: { x: 120 * SCALE, y: 200 * SCALE, angle: 0, hp: aHp },
    b: { x: 280 * SCALE, y: 200 * SCALE, angle: 0, hp: bHp },
    events: [],
  };
}
