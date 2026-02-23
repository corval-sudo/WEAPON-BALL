// web/src/hooks/useArenaSocket.ts
// WebSocket hook for live arena match data.
// Connects to the Railway API server's /ws endpoint.
// Manages reconnect logic and exposes typed match state.

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types (mirrored from ws-broadcaster.ts — no shared build needed) ─────────

export interface TickFrame {
  tick: number;
  a: { x: number; y: number; angle: number; hp: number };
  b: { x: number; y: number; angle: number; hp: number };
  events: string[];
}

/** Weapon definition sent in match_start for accurate hitbox rendering. */
export interface WeaponDef {
  type: "blade" | "point" | "blunt";
  reach: number;
  tipRadius: number;
  bladeStart?: number;
  bladeWidth?: number;
  shaftRadius?: number;
}

export interface Fighter {
  id: string;
  name: string;
  weaponId: string;
  wins: number;
  losses: number;
  currentStreak: number;
  baseHp: number;
  radius: number;
  color: string;
}

export type ArenaPhase =
  | "idle"
  | "countdown"   // next_match received, waiting for match_start
  | "live"        // match_start received, receiving tick frames
  | "result";     // match_end received, showing result card

export interface ArenaState {
  phase: ArenaPhase;
  connected: boolean;
  // countdown
  nextBallA: Fighter | null;
  nextBallB: Fighter | null;
  startsInMs: number;
  // live match
  matchNumber: number;
  liveBallA: Fighter | null;
  liveBallB: Fighter | null;
  announcement: string;
  currentFrame: TickFrame | null;
  /** Weapon defs received in match_start — used for accurate hitbox rendering. */
  weaponA: WeaponDef | null;
  weaponB: WeaponDef | null;
  // result
  winner: "A" | "B" | null;
  resultBallA: Fighter | null;
  resultBallB: Fighter | null;
  ticks: number;
  commentary: string;
}

const INITIAL_STATE: ArenaState = {
  phase: "idle",
  connected: false,
  nextBallA: null,
  nextBallB: null,
  startsInMs: 0,
  matchNumber: 0,
  liveBallA: null,
  liveBallB: null,
  announcement: "",
  currentFrame: null,
  weaponA: null,
  weaponB: null,
  winner: null,
  resultBallA: null,
  resultBallB: null,
  ticks: 0,
  commentary: "",
};

const RECONNECT_DELAY_MS = 3000;
const WS_URL = (import.meta.env["VITE_API_URL"] ?? "http://localhost:3001")
  .replace(/^http/, "ws") + "/ws";

export function useArenaSocket(): ArenaState {
  const [state, setState] = useState<ArenaState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        handleMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };
  }, []);

  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case "next_match":
        setState(prev => ({
          ...prev,
          phase: "countdown",
          nextBallA: msg.ballA,
          nextBallB: msg.ballB,
          startsInMs: msg.startsInMs,
          currentFrame: null,
          // Pick up weapon defs from next_match so browsers joining during
          // countdown already know the weapon metadata before match_start.
          weaponA: msg.weaponA ?? prev.weaponA,
          weaponB: msg.weaponB ?? prev.weaponB,
        }));
        break;

      case "match_start":
        setState(prev => ({
          ...prev,
          phase: "live",
          matchNumber: msg.matchNumber,
          liveBallA: msg.ballA,
          liveBallB: msg.ballB,
          announcement: msg.announcement ?? "",
          currentFrame: null,
          winner: null,
          weaponA: msg.weaponA ?? null,
          weaponB: msg.weaponB ?? null,
        }));
        break;

      case "match_tick":
        setState(prev => ({
          ...prev,
          currentFrame: msg.frame as TickFrame,
        }));
        break;

      case "match_end":
        setState(prev => ({
          ...prev,
          phase: "result",
          winner: msg.winner,
          resultBallA: msg.ballA,
          resultBallB: msg.ballB,
          ticks: msg.ticks,
          commentary: msg.commentary ?? "",
          matchNumber: msg.matchNumber,
        }));
        break;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
