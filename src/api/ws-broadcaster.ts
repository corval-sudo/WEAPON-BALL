// src/api/ws-broadcaster.ts
// Singleton WebSocket broadcaster.
// schedule.ts calls this at 4 points per match so connected browsers
// receive live match events without polling.
//
// replayMatch() streams real physics frames captured during the sim run
// at 30fps (≈20 seconds for a typical match), then resolves its Promise
// so schedule.ts can send match_end only after replay completes.

import WebSocket from "ws";
import type { BallEntity, EnhancedMatchResult, ReplayFrame } from "../data/types";
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

/**
 * Weapon definition sent to the browser so it can render accurate hitboxes.
 * Mirrors the WeaponDef shape from simCore (only visual fields needed).
 */
export interface WsWeaponDef {
  type: "blade" | "point" | "blunt";
  reach: number;       // arena units (unscaled)
  tipRadius: number;   // arena units (unscaled)
  bladeStart?: number; // blade-only: where damage zone begins
  bladeWidth?: number; // blade-only: capsule half-width
  shaftRadius?: number;
}

export type WsMessage =
  | { type: "next_match"; ballA: BallEntity; ballB: BallEntity; startsInMs: number }
  | { type: "match_start"; ballA: BallEntity; ballB: BallEntity; matchNumber: number; announcement: string; weaponA: WsWeaponDef; weaponB: WsWeaponDef }
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
   * Uses real physics frames captured during the simulation run.
   * Returns a Promise that resolves when the last frame has been sent,
   * so schedule.ts can await it before broadcasting match_end.
   *
   * If no clients are connected, resolves immediately.
   */
  replayMatch(
    result: EnhancedMatchResult,
    ballAHp: number,
    ballBHp: number,
    arenaW: number = 400,
    arenaH: number = 700
  ): Promise<void> {
    // No clients — nothing to stream, resolve immediately.
    if (this.clients.size === 0) return Promise.resolve();

    // Clear any previous replay that may still be running
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }

    // Build a tick → event descriptions lookup
    const eventsByTick = new Map<number, string[]>();
    for (const ev of result.events) {
      if (!eventsByTick.has(ev.t)) eventsByTick.set(ev.t, []);
      eventsByTick.get(ev.t)!.push(describeEvent(ev));
    }

    // Use real captured frames if available; fall back to orbital approximation.
    const frames: ReplayFrame[] = result.replayFrames && result.replayFrames.length > 0
      ? result.replayFrames
      : buildFallbackFrames(result, ballAHp, ballBHp, arenaW, arenaH);

    return new Promise<void>((resolve) => {
      let idx = 0;

      this.replayTimer = setInterval(() => {
        if (idx >= frames.length) {
          if (this.replayTimer !== null) {
            clearInterval(this.replayTimer);
            this.replayTimer = null;
          }
          resolve();
          return;
        }

        const f = frames[idx];
        if (!f) { idx++; return; }
        const tickFrame: TickFrame = {
          tick: f.tick,
          a: f.a,
          b: f.b,
          events: eventsByTick.get(f.tick) ?? [],
        };

        this.broadcast({ type: "match_tick", frame: tickFrame });
        idx++;
      }, 33); // ~30fps
    });
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
 * Fallback: approximate positions via circular orbits.
 * Used when result.replayFrames is missing (e.g. old DB matches loaded via API).
 */
function buildFallbackFrames(
  result: EnhancedMatchResult,
  ballAHp: number,
  ballBHp: number,
  arenaW: number,
  arenaH: number
): ReplayFrame[] {
  const SCALE = 1000;
  const totalTicks = result.ticks;
  const TARGET = 600;
  const step = Math.max(1, Math.floor(totalTicks / TARGET));

  const aCenterX = arenaW / 2 - 80, aCenterY = arenaH / 2;
  const bCenterX = arenaW / 2 + 80, bCenterY = arenaH / 2;
  const radius = 80;
  const angSpeed = (2 * Math.PI) / 300;

  // Track HP changes from hit events
  const hpChanges = new Map<number, { a: number; b: number }>();
  let runningAHp = ballAHp, runningBHp = ballBHp;
  for (const ev of result.events) {
    if (ev.e === "hit") {
      if (ev.to === "B") runningBHp = Math.max(0, runningBHp - ev.dmg);
      else runningAHp = Math.max(0, runningAHp - ev.dmg);
      hpChanges.set(ev.t, { a: runningAHp, b: runningBHp });
    }
  }

  const eventTicks = new Set(result.events.map(ev => ev.t));
  const frames: ReplayFrame[] = [];
  let currentAHp = ballAHp, currentBHp = ballBHp;

  for (let t = 0; t <= totalTicks; t++) {
    const hpAtTick = hpChanges.get(t);
    if (hpAtTick) { currentAHp = hpAtTick.a; currentBHp = hpAtTick.b; }

    if (t % step === 0 || eventTicks.has(t)) {
      const angle = t * angSpeed;
      frames.push({
        tick: t,
        a: {
          x: Math.round((aCenterX + Math.round(radius * Math.cos(angle))) * SCALE),
          y: Math.round((aCenterY + Math.round(radius * Math.sin(angle))) * SCALE),
          angle: Math.round(((t * 600) % 65536)),
          hp: currentAHp,
        },
        b: {
          x: Math.round((bCenterX + Math.round(radius * Math.cos(angle + Math.PI))) * SCALE),
          y: Math.round((bCenterY + Math.round(radius * Math.sin(angle + Math.PI))) * SCALE),
          angle: Math.round((((t * 600) + 32768) % 65536)),
          hp: currentBHp,
        },
      });
    }
  }

  return frames;
}
