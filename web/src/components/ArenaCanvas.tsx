// web/src/components/ArenaCanvas.tsx
// HTML5 canvas renderer for live and replay arena matches.
// Accepts a TickFrame (position + HP snapshot) and renders both fighters.
// Ported from the viewer's rendering approach — rendering only, no physics.

import { useEffect, useRef } from "react";
import type { TickFrame } from "../hooks/useArenaSocket";

const ARENA_W = 400;
const ARENA_H = 700;
const SCALE = 1000; // sim units per arena unit

interface ArenaCanvasProps {
  frame: TickFrame | null;
  ballAName: string;
  ballBName: string;
  ballAColor?: string;
  ballBColor?: string;
  ballAHp: number;   // max HP for bar calculation
  ballBHp: number;
  width?: number;
  height?: number;
}

export function ArenaCanvas({
  frame,
  ballAName,
  ballBName,
  ballAColor = "#4fc3f7",
  ballBColor = "#ef5350",
  ballAHp,
  ballBHp,
  width = 320,
  height = 560,
}: ArenaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxOrNull = canvas.getContext("2d");
    if (!ctxOrNull) return;
    // Assign to a const that TypeScript knows is non-null inside nested functions
    const ctx: CanvasRenderingContext2D = ctxOrNull;

    // Scale canvas for crisp rendering on high-DPI screens
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const scaleX = width / ARENA_W;
    const scaleY = height / ARENA_H;

    function toScreen(simX: number, simY: number): [number, number] {
      return [(simX / SCALE) * scaleX, (simY / SCALE) * scaleY];
    }

    // ─── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, width, height);

    // Arena border
    ctx.strokeStyle = "#333355";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    // Grid lines (subtle)
    ctx.strokeStyle = "#111122";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    if (!frame) {
      // Idle state — just show "WAITING"
      ctx.fillStyle = "#444466";
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.fillText("WAITING FOR MATCH...", width / 2, height / 2);
      return;
    }

    const { a, b } = frame;
    const [ax, ay] = toScreen(a.x, a.y);
    const [bx, by] = toScreen(b.x, b.y);
    const ballR = 18;
    const weaponLen = 28;

    // ─── Weapon arms ─────────────────────────────────────────────────────────
    function drawWeapon(cx: number, cy: number, angle: number, color: string) {
      const rad = (angle / 65536) * 2 * Math.PI;
      const tx = cx + Math.cos(rad) * weaponLen;
      const ty = cy + Math.sin(rad) * weaponLen;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // Tip
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawWeapon(ax, ay, a.angle, ballAColor);
    drawWeapon(bx, by, b.angle, ballBColor);

    // ─── Ball bodies ─────────────────────────────────────────────────────────
    function drawBall(cx: number, cy: number, hp: number, maxHp: number, color: string, name: string) {
      const hpFrac = Math.max(0, hp / maxHp);
      // Glow for high HP
      if (hpFrac > 0.5) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 * hpFrac;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, ballR, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Inner circle (dark center)
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.arc(cx, cy, ballR * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // HP bar (above ball)
      const barW = ballR * 2.5;
      const barH = 4;
      const barX = cx - barW / 2;
      const barY = cy - ballR - 10;

      ctx.fillStyle = "#222";
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = hpFrac > 0.5 ? "#4caf50" : hpFrac > 0.25 ? "#ff9800" : "#f44336";
      ctx.fillRect(barX, barY, barW * hpFrac, barH);

      // Name label
      ctx.fillStyle = "#ccc";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(name.length > 10 ? name.slice(0, 10) + "…" : name, cx, cy - ballR - 14);
    }

    drawBall(ax, ay, a.hp, ballAHp, ballAColor, ballAName);
    drawBall(bx, by, b.hp, ballBHp, ballBColor, ballBName);

    // ─── Event flash text ────────────────────────────────────────────────────
    if (frame.events.length > 0) {
      const topEvent = frame.events[0] ?? "";
      if (topEvent.includes("hits") || topEvent.includes("eliminated")) {
        ctx.fillStyle = topEvent.includes("eliminated") ? "#ff4444" : "#ffcc00";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(topEvent.toUpperCase(), width / 2, height - 16);
      }
    }

    // ─── Tick counter ────────────────────────────────────────────────────────
    ctx.fillStyle = "#333";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`t:${frame.tick}`, width - 4, height - 4);

  }, [frame, ballAName, ballBName, ballAColor, ballBColor, ballAHp, ballBHp, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: "block", borderRadius: 4 }}
    />
  );
}
