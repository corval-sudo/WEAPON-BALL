// src/api/server.ts
// Express HTTP + WebSocket API server for the WORBZ arena.
// Runs on Railway alongside the scheduler (both share the same SQLite DB).
//
// Usage:
//   npm run api
//
// REST endpoints (read-only):
//   GET /api/fighters          — active roster ordered by wins
//   GET /api/fighters/:id      — fighter profile + recent match history
//   GET /api/matches           — recent matches (last 20)
//   GET /api/matches/:id       — single match by row ID
//   GET /api/next              — next scheduled fighters + countdown
//   GET /health                — liveness probe for Railway
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
import { broadcaster } from "./ws-broadcaster";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
// Comma-separated list of allowed origins (set on Railway/Vercel)
const CORS_ORIGINS = (process.env["CORS_ORIGINS"] ?? "http://localhost:5174,http://localhost:5173").split(",");

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  if (CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use(express.json());

// ─── DB ───────────────────────────────────────────────────────────────────────

const db = new ArenaDatabase();

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
  if (!nextMatchInfo) { res.json(null); return; }
  const ballA = db.getBallById(nextMatchInfo.ballAId);
  const ballB = db.getBallById(nextMatchInfo.ballBId);
  res.json({ ballA, ballB, startsAt: nextMatchInfo.startsAt });
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
