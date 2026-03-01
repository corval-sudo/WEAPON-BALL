// src/api/server.ts
// Express HTTP + WebSocket API server for the WORBZ arena.
// Runs on Railway alongside the scheduler (both share the same SQLite DB).
//
// Usage:
//   npm run api
//
// REST endpoints:
//   GET  /api/fighters          — active roster ordered by wins
//   GET  /api/fighters/:id      — fighter profile + recent match history
//   GET  /api/matches           — recent matches (last 20)
//   GET  /api/matches/:id       — single match by row ID
//   GET  /api/next              — next scheduled fighters + countdown
//   GET  /health                — liveness probe for Railway
//   POST /api/admin/run-match   — trigger one match (manual mode only)
//
// WebSocket:
//   wss://<host>/ws            — subscribe for live match events
//   Messages: WsMessage (see ws-broadcaster.ts)

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { ArenaDatabase } from "../data/database";
import { ConfigStore } from "../data/config-store";
import { broadcaster } from "./ws-broadcaster";
import { createSim, stepSim } from "../simCore";
import type { TickFrame } from "./ws-broadcaster";
import { matchTrigger } from "../match/trigger";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
// Comma-separated list of allowed origins (set on Railway/Vercel)
const CORS_ORIGINS = (process.env["CORS_ORIGINS"] ?? "http://localhost:5174,http://localhost:5173")
  .split(",")
  .map(o => o.trim().replace(/\/$/, ""));  // trim spaces + trailing slashes

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  if (CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use(express.json());

// ─── DB ───────────────────────────────────────────────────────────────────────

const db = new ArenaDatabase();
const configStore = new ConfigStore(db.getRawDb());

// ─── REST Routes ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", clients: broadcaster.connectedCount, ts: new Date().toISOString() });
});

/** Active roster ordered by wins. */
app.get("/api/fighters", (_req, res) => {
  try {
    const fighters = db.getActiveBalls();
    res.json(fighters);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Fighter profile + last 20 matches. */
app.get("/api/fighters/:id", (req, res) => {
  try {
    const fighter = db.getBallById(req.params["id"] ?? "");
    if (!fighter) { res.status(404).json({ error: "Fighter not found" }); return; }
    const history = db.getMatchHistory(fighter.id, 20);
    res.json({ fighter, history });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Recent matches with joined fighter names. */
app.get("/api/matches", (_req, res) => {
  try {
    const matches = db.getRecentMatches(20);
    res.json(matches);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Single match by integer row ID. */
app.get("/api/matches/:id", (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid match id" }); return; }
    const match = db.getMatchById(id);
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }
    res.json(match);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Weapons catalog (must stay in sync with schedule.ts) ────────────────────
// These are the baseline stats used for every match. The runner applies
// per-ball DB overrides on top of these, just like schedule.ts does.
const WEAPONS_CATALOG: Record<string, any> = {
  short_sword: { type: "blade", reach: 60, tipRadius: 15, bladeStart: 25, bladeWidth: 8,  shaftRadius: 5, omega: 1800, baseDamage: 12, ramp: 3, speedMult: 1000, weight: 800  },
  katana:      { type: "blade", reach: 85, tipRadius: 12, bladeStart: 30, bladeWidth: 10, shaftRadius: 6, omega: 1600, baseDamage: 11, ramp: 3, speedMult: 1050, weight: 850  },
  spear:       { type: "point", reach: 110, tipRadius: 8,                                 shaftRadius: 5, omega: 1200, baseDamage: 18, ramp: 4, speedMult: 950,  weight: 900  },
  mace:        { type: "blunt", reach: 70, tipRadius: 35,                                 shaftRadius: 8, omega: 1400, baseDamage: 14, ramp: 2, speedMult: 900,  weight: 1400 },
};
const ARENA_CONFIG = { w: 400, h: 700, wallRestitution: 850 };
const SIM_CONFIG   = { scale: 1000, maxTicks: 18000 };

/**
 * Deterministic replay — re-runs the exact physics sim with the stored seed
 * and returns every tick as a TickFrame array. Because the sim is deterministic
 * the result is bit-for-bit identical to the original match.
 */
app.get("/api/matches/:id/replay", (req, res) => {
  try {
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid match id" }); return; }

    const match = db.getMatchById(id);
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }

    const ballA = db.getBallById((match as any).ball_a_id);
    const ballB = db.getBallById((match as any).ball_b_id);
    if (!ballA || !ballB) { res.status(404).json({ error: "Fighter not found" }); return; }

    // Apply any per-ball weapon overrides (same logic as MatchRunner)
    const weapons = { ...WEAPONS_CATALOG };
    const overrideA = db.getWeaponOverrides(ballA.id).find(o => o.weaponId === ballA.weaponId);
    const overrideB = db.getWeaponOverrides(ballB.id).find(o => o.weaponId === ballB.weaponId);

    let weaponIdA = ballA.weaponId;
    let weaponIdB = ballB.weaponId;

    if (overrideA) {
      weaponIdA = `${ballA.weaponId}_A`;
      weapons[weaponIdA] = { ...WEAPONS_CATALOG[ballA.weaponId], ...overrideA };
    }
    if (overrideB) {
      weaponIdB = `${ballB.weaponId}_B`;
      weapons[weaponIdB] = { ...WEAPONS_CATALOG[ballB.weaponId], ...overrideB };
    }

    // Reconstruct the exact MatchSpec used for the original match
    const matchSpec = {
      seed: (match as any).seed,
      sim: SIM_CONFIG,
      arena: ARENA_CONFIG,
      weapons,
      ballA: {
        id: "A" as const,
        hp: ballA.baseHp,
        radius: ballA.radius,
        pos: { x: 120, y: 200 },
        vel: { x: 25, y: 35 },
        weaponId: weaponIdA,
        ...(ballA.restitution !== undefined && { restitution: ballA.restitution }),
      },
      ballB: {
        id: "B" as const,
        hp: ballB.baseHp,
        radius: ballB.radius,
        pos: { x: 280, y: 200 },
        vel: { x: -20, y: 30 },
        weaponId: weaponIdB,
        ...(ballB.restitution !== undefined && { restitution: ballB.restitution }),
      },
    };

    // Re-run the sim tick by tick, capturing a frame at each step
    const sim = createSim(matchSpec);
    const frames: TickFrame[] = [];
    const SCALE = SIM_CONFIG.scale;
    const MAX_ITER = SIM_CONFIG.maxTicks * 2;
    let iter = 0;

    // Capture frame before first step (initial positions)
    frames.push({
      tick: 0,
      a: { x: sim.A.pos.x, y: sim.A.pos.y, angle: sim.A.theta, hp: sim.A.hp },
      b: { x: sim.B.pos.x, y: sim.B.pos.y, angle: sim.B.theta, hp: sim.B.hp },
      events: [],
    });

    while (!sim.done && iter < MAX_ITER) {
      stepSim(sim);
      iter++;

      // Collect human-readable event descriptions for this tick
      const tickEvents: string[] = [];
      for (const ev of sim.events) {
        if (ev.t === sim.tick) {
          switch (ev.e) {
            case "hit":     tickEvents.push(`${ev.from}→${ev.to} ${ev.dmg}dmg`); break;
            case "dead":    tickEvents.push(`${ev.id} eliminated`); break;
            case "collide": tickEvents.push(`${ev.a}↔${ev.b} collide`); break;
            case "wall":    tickEvents.push(`${ev.id} wall ${ev.side}`); break;
            case "timeout": tickEvents.push(`timeout → ${ev.winner} wins`); break;
          }
        }
      }

      frames.push({
        tick: sim.tick,
        a: { x: sim.A.pos.x, y: sim.A.pos.y, angle: sim.A.theta, hp: sim.A.hp },
        b: { x: sim.B.pos.x, y: sim.B.pos.y, angle: sim.B.theta, hp: sim.B.hp },
        events: tickEvents,
      });
    }

    res.json({
      matchId: id,
      totalTicks: sim.tick,
      scale: SCALE,
      arenaW: ARENA_CONFIG.w,
      arenaH: ARENA_CONFIG.h,
      ballAName: ballA.name,
      ballBName: ballB.name,
      ballAColor: ballA.color,
      ballBColor: ballB.color,
      ballAHp: ballA.baseHp,
      ballBHp: ballB.baseHp,
      ballARadius: ballA.radius,
      ballBRadius: ballB.radius,
      weaponA: weapons[weaponIdA] ? {
        type: weapons[weaponIdA].type,
        reach: weapons[weaponIdA].reach,
        tipRadius: weapons[weaponIdA].tipRadius,
        bladeStart: weapons[weaponIdA].bladeStart,
        bladeWidth: weapons[weaponIdA].bladeWidth,
        shaftRadius: weapons[weaponIdA].shaftRadius,
      } : null,
      weaponB: weapons[weaponIdB] ? {
        type: weapons[weaponIdB].type,
        reach: weapons[weaponIdB].reach,
        tipRadius: weapons[weaponIdB].tipRadius,
        bladeStart: weapons[weaponIdB].bladeStart,
        bladeWidth: weapons[weaponIdB].bladeWidth,
        shaftRadius: weapons[weaponIdB].shaftRadius,
      } : null,
      frames,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Next scheduled match info (set by broadcaster from schedule.ts). */
let nextMatchInfo: { ballAId: string; ballBId: string; startsAt: string } | null = null;

export function setNextMatch(ballAId: string, ballBId: string, startsInMs: number): void {
  nextMatchInfo = {
    ballAId,
    ballBId,
    startsAt: new Date(Date.now() + startsInMs).toISOString(),
  };
}

app.get("/api/next", (_req, res) => {
  try {
    // Use explicitly scheduled next match if available
    if (nextMatchInfo) {
      const ballA = db.getBallById(nextMatchInfo.ballAId);
      const ballB = db.getBallById(nextMatchInfo.ballBId);
      if (ballA && ballB) {
        res.json({ ballA, ballB, startsAt: nextMatchInfo.startsAt });
        return;
      }
    }

    // Fallback: compute startsAt from last match timestamp + configured interval.
    // This works immediately after a deploy before the scheduler has called setNextMatch.
    const recentMatches = db.getRecentMatches(1);
    if (recentMatches.length === 0) { res.json(null); return; }

    const lastMatch = recentMatches[0] as any;
    const intervalMs = configStore.getMatchIntervalMs();
    const startsAt = new Date(new Date(lastMatch.timestamp).getTime() + intervalMs).toISOString();

    // Pick best upcoming matchup for the preview fighters
    const { findBestMatchup } = require("../simulation/matchmaker");
    const roster = db.getActiveBalls();
    const matchup = findBestMatchup(roster);
    if (!matchup) { res.json(null); return; }

    res.json({ ballA: matchup.ballA, ballB: matchup.ballB, startsAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

/**
 * Trigger a single match manually (intended for MANUAL_MATCH=1 mode).
 * Emits to matchTrigger which schedule.ts listens to.
 * Safe to call in auto mode too — schedule.ts ignores it there.
 */
app.post("/api/admin/run-match", (_req, res) => {
  matchTrigger.emit("run");
  res.json({ ok: true, message: "Match triggered" });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  console.log(`[WS] Client connected from ${ip} (total: ${broadcaster.connectedCount + 1})`);
  broadcaster.registerClient(ws);
  ws.on("close", () => {
    console.log(`[WS] Client disconnected (total: ${broadcaster.connectedCount})`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`✗ Port ${PORT} is already in use. Exiting so Railway can restart cleanly.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║           WORBZ API SERVER STARTED           ║`);
  console.log(`║   HTTP:  http://localhost:${PORT}               ║`);
  console.log(`║   WS:    ws://localhost:${PORT}/ws              ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nAPI server shutting down...");
  wss.close();
  server.close();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  wss.close();
  server.close();
  db.close();
  process.exit(0);
});
