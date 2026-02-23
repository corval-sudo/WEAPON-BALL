// web/src/components/ArenaCanvas.tsx
// HTML5 canvas renderer for live and replay arena matches.
// Accepts a TickFrame (position + HP snapshot) and renders both fighters
// with accurate weapon hitboxes matching the physics simulation.

import { useEffect, useRef } from "react";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

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
  /** Ball radius in arena units (from BallEntity.radius, typically 40-42). */
  ballARadius?: number;
  ballBRadius?: number;
  /** Weapon definition for accurate hitbox rendering (sent in match_start). */
  weaponA?: WeaponDef | null;
  weaponB?: WeaponDef | null;
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
  ballARadius = 42,
  ballBRadius = 42,
  weaponA,
  weaponB,
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

    // Convert sim-scaled position to screen pixels
    function toScreen(simX: number, simY: number): [number, number] {
      return [(simX / SCALE) * scaleX, (simY / SCALE) * scaleY];
    }

    // Convert an unscaled arena-unit distance to screen pixels
    // (reach, tipRadius, bladeWidth are all in arena units)
    function arenaToScreenLen(arenaUnits: number): number {
      return arenaUnits * scaleX; // arena is square so scaleX == scaleY
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
    // Ball radius in screen pixels — derived from the actual arena-unit radius
    // (ballARadius/ballBRadius are in arena units; multiply by scaleX to get pixels).
    const ballRA = Math.max(8, ballARadius * scaleX);
    const ballRB = Math.max(8, ballBRadius * scaleX);

    // ─── Weapon rendering ─────────────────────────────────────────────────────
    // Uses real weapon metadata when available, falls back to fixed-length approx.
    //
    // Sim formula: tip = center + (reach × cos(θ), reach × sin(θ)) in arena units
    // where θ = (angle / 65536) × 2π

    function drawWeapon(
      cx: number, cy: number,
      angle: number,
      color: string,
      wDef?: WeaponDef | null,
    ) {
      const rad = (angle / 65536) * 2 * Math.PI;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      if (!wDef) {
        // Fallback: fixed 28px line + 4px tip (old behaviour)
        const tLen = 28;
        const tx = cx + cosA * tLen;
        const ty = cy + sinA * tLen;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      const reachPx     = arenaToScreenLen(wDef.reach);
      const tipRPx      = Math.max(2, arenaToScreenLen(wDef.tipRadius));
      const tipX        = cx + cosA * reachPx;
      const tipY        = cy + sinA * reachPx;

      if (wDef.type === "blade") {
        // ── Blade: shaft + damage-zone capsule (bladeStart → reach) ───────────
        const bladeStart  = wDef.bladeStart ?? wDef.reach * 0.4;
        const bladeWidth  = wDef.bladeWidth ?? wDef.tipRadius;
        const bsStartPx   = arenaToScreenLen(bladeStart);
        const bsX         = cx + cosA * bsStartPx;
        const bsY         = cy + sinA * bsStartPx;
        const bladeWPx    = Math.max(1.5, arenaToScreenLen(bladeWidth));

        // Shaft (ball center → blade start): thin line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bsX, bsY);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Blade zone: thick capsule (wide stroke from bladeStart to tip)
        ctx.strokeStyle = color;
        ctx.lineWidth = bladeWPx * 2; // stroke width = 2× half-width
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(bsX, bsY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        // Edge highlight
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(bsX, bsY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        ctx.globalAlpha = 1;

      } else if (wDef.type === "blunt") {
        // ── Blunt (mace): handle + large round head ───────────────────────────
        const headStart = wDef.reach * 0.7;
        const hsStartPx = arenaToScreenLen(headStart);
        const hsX       = cx + cosA * hsStartPx;
        const hsY       = cy + sinA * hsStartPx;

        // Handle
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(hsX, hsY);
        ctx.stroke();

        // Mace head: large filled circle at tip
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(tipX, tipY, tipRPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Spikes hint
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tipX, tipY, tipRPx + 3, 0, Math.PI * 2);
        ctx.stroke();

      } else {
        // ── Point (spear): long narrow shaft + sharp tip ──────────────────────
        // Shaft: thin line from ball center to near-tip
        const shaftEndPx = reachPx * 0.85;
        const sEx = cx + cosA * shaftEndPx;
        const sEy = cy + sinA * shaftEndPx;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sEx, sEy);
        ctx.stroke();

        // Tip: narrowing triangle pointing toward tipX/tipY
        const perpX = -sinA;
        const perpY =  cosA;
        const halfW = Math.max(2.5, tipRPx * 0.6);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sEx + perpX * halfW, sEy + perpY * halfW);
        ctx.lineTo(sEx - perpX * halfW, sEy - perpY * halfW);
        ctx.lineTo(tipX, tipY);
        ctx.closePath();
        ctx.fill();
      }

      // Tip hitbox indicator (semi-transparent circle) — shows actual collision radius
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(tipX, tipY, tipRPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawWeapon(ax, ay, a.angle, ballAColor, weaponA);
    drawWeapon(bx, by, b.angle, ballBColor, weaponB);

    // ─── Ball bodies ─────────────────────────────────────────────────────────
    function drawBall(cx: number, cy: number, ballR: number, hp: number, maxHp: number, color: string, name: string) {
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

    drawBall(ax, ay, ballRA, a.hp, ballAHp, ballAColor, ballAName);
    drawBall(bx, by, ballRB, b.hp, ballBHp, ballBColor, ballBName);

    // ─── Collision / hit flash rings ──────────────────────────────────────────
    // Draw a ring around ball(s) when they collide, take a hit, or are eliminated.
    const hasCollide = frame.events.some(ev => ev.includes("collide"));
    const hasHit     = frame.events.some(ev => ev.includes(" hits "));
    const hasElim    = frame.events.some(ev => ev.includes("eliminated"));

    if (hasCollide || hasHit || hasElim) {
      const flashColor = hasElim ? "#ff4444" : hasHit ? "#ffcc00" : "#aaddff";
      const flashAlpha = hasElim ? 0.9 : 0.7;
      const flashExtra = hasElim ? 10 : hasHit ? 7 : 5; // extra px beyond ball edge

      ctx.save();
      ctx.globalAlpha = flashAlpha;
      ctx.strokeStyle = flashColor;
      ctx.lineWidth = hasElim ? 3 : 2;
      ctx.shadowColor = flashColor;
      ctx.shadowBlur = 18;

      // On body collide: flash both balls. On hit/elim: flash only the target.
      // event text format: "A hits B for N damage" | "B is eliminated" | "A and B collide"
      const ringA = hasCollide
        || frame.events.some(ev => ev.includes("hits A") || ev.startsWith("A is elim"));
      const ringB = hasCollide
        || frame.events.some(ev => ev.includes("hits B") || ev.startsWith("B is elim"));

      if (ringA) {
        ctx.beginPath();
        ctx.arc(ax, ay, ballRA + flashExtra, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (ringB) {
        ctx.beginPath();
        ctx.arc(bx, by, ballRB + flashExtra, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ─── Event flash text ────────────────────────────────────────────────────
    if (frame.events.length > 0) {
      const topEvent = frame.events[0] ?? "";
      if (topEvent.includes("hits") || topEvent.includes("eliminated") || topEvent.includes("collide")) {
        ctx.fillStyle = topEvent.includes("eliminated") ? "#ff4444"
                      : topEvent.includes("collide")    ? "#ffffff"
                      : "#ffcc00";
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

  }, [frame, ballAName, ballBName, ballAColor, ballBColor, ballAHp, ballBHp, ballARadius, ballBRadius, weaponA, weaponB, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: "block", borderRadius: 4 }}
    />
  );
}
