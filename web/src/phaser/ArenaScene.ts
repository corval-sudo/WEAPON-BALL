// web/src/phaser/ArenaScene.ts
// Phaser 3 Scene that renders the live arena match.
// Receives TickFrame + WeaponDef updates via updateFrame() / updateConfig() calls
// from the PhaserArena React wrapper.
//
// Coordinate system:
//   Sim positions are in "sim units" (scale 1000 per arena unit).
//   Arena is 400×700 arena units.
//   We map sim units → screen pixels via scaleX = canvasW/400/1000, scaleY = canvasH/700/1000.

import Phaser from "phaser";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

// ─── Constants ───────────────────────────────────────────────────────────────

const ARENA_W = 400; // arena units
const ARENA_H = 700;
const SIM_SCALE = 1000; // sim units per arena unit

const GRID_STEP = 40; // px between grid lines (in arena units)
const REPLAY_FPS = 30; // expected frame rate from broadcaster

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArenaSceneConfig {
  ballAName: string;
  ballBName: string;
  ballAColor: number;  // Phaser hex (0x4fc3f7)
  ballBColor: number;
  ballAHp: number;
  ballBHp: number;
  ballARadius: number; // arena units (typically 42)
  ballBRadius: number;
  weaponA: WeaponDef | null;
  weaponB: WeaponDef | null;
  canvasW: number;
  canvasH: number;
}

// ─── Scene ───────────────────────────────────────────────────────────────────

export class ArenaScene extends Phaser.Scene {
  // Config (updated from React)
  private cfg!: ArenaSceneConfig;

  // Scale helpers
  private scaleX = 1;
  private scaleY = 1;

  // Background & grid (static, only redrawn on resize)
  private bgGfx!: Phaser.GameObjects.Graphics;

  // Weapons (redrawn every frame)
  private wpnAGfx!: Phaser.GameObjects.Graphics;
  private wpnBGfx!: Phaser.GameObjects.Graphics;

  // Ball bodies
  private ballAGfx!: Phaser.GameObjects.Graphics;
  private ballBGfx!: Phaser.GameObjects.Graphics;

  // Flash ring on collision/hit/elim
  private flashGfx!: Phaser.GameObjects.Graphics;

  // Text labels
  private txtA!: Phaser.GameObjects.Text;
  private txtB!: Phaser.GameObjects.Text;
  private txtEvent!: Phaser.GameObjects.Text;
  private txtTick!: Phaser.GameObjects.Text;
  private txtWaiting!: Phaser.GameObjects.Text;

  // HP bar graphics
  private hpBarGfx!: Phaser.GameObjects.Graphics;

  // Current frame state
  private currentFrame: TickFrame | null = null;
  private prevFrame: TickFrame | null = null;
  private frameTime = 0;      // ms since last frame arrived
  private frameInterval = 1000 / REPLAY_FPS; // ~33ms

  constructor() {
    super({ key: "ArenaScene" });
  }

  // Called by PhaserArena wrapper to pass config before / after creation.
  updateConfig(cfg: ArenaSceneConfig): void {
    this.cfg = cfg;
    this.updateScales();
    // If already created, rebuild the static background
    if (this.bgGfx) this.drawBackground();
  }

  // Called by PhaserArena every time a new TickFrame arrives.
  updateFrame(frame: TickFrame): void {
    this.prevFrame = this.currentFrame;
    this.currentFrame = frame;
    this.frameTime = 0;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  create(): void {
    const { canvasW, canvasH } = this.cfg;

    this.updateScales();

    // Layer order: bg < weapons < balls < flash < hpbars < text
    this.bgGfx    = this.add.graphics();
    this.wpnAGfx  = this.add.graphics();
    this.wpnBGfx  = this.add.graphics();
    this.ballAGfx = this.add.graphics();
    this.ballBGfx = this.add.graphics();
    this.flashGfx = this.add.graphics();
    this.hpBarGfx = this.add.graphics();

    // Text style defaults
    const mono = { fontFamily: "monospace", fontSize: "10px", color: "#cccccc" };

    this.txtA = this.add.text(0, 0, "", { ...mono, fontStyle: "bold", fontSize: "10px" })
      .setOrigin(0.5, 1);
    this.txtB = this.add.text(0, 0, "", { ...mono, fontStyle: "bold", fontSize: "10px" })
      .setOrigin(0.5, 1);

    this.txtEvent = this.add.text(canvasW / 2, canvasH - 16, "", {
      ...mono, fontStyle: "bold", fontSize: "11px"
    }).setOrigin(0.5, 0.5);

    this.txtTick = this.add.text(canvasW - 4, canvasH - 4, "", {
      fontFamily: "monospace", fontSize: "9px", color: "#333355"
    }).setOrigin(1, 1);

    this.txtWaiting = this.add.text(canvasW / 2, canvasH / 2, "WAITING FOR MATCH...", {
      fontFamily: "monospace", fontSize: "16px", color: "#444466", fontStyle: "bold"
    }).setOrigin(0.5, 0.5);

    this.drawBackground();
  }

  update(_time: number, delta: number): void {
    if (!this.cfg) return;

    if (!this.currentFrame) {
      this.txtWaiting.setVisible(true);
      this.clearGameObjects();
      return;
    }
    this.txtWaiting.setVisible(false);

    // Interpolate between prevFrame and currentFrame
    this.frameTime += delta;
    const t = Math.min(1, this.frameTime / this.frameInterval);
    const frame = this.currentFrame;
    const prev = this.prevFrame ?? frame;

    const ax = lerp(simToScreenX(prev.a.x, this.scaleX), simToScreenX(frame.a.x, this.scaleX), t);
    const ay = lerp(simToScreenY(prev.a.y, this.scaleY), simToScreenY(frame.a.y, this.scaleY), t);
    const bx = lerp(simToScreenX(prev.b.x, this.scaleX), simToScreenX(frame.b.x, this.scaleX), t);
    const by = lerp(simToScreenY(prev.b.y, this.scaleY), simToScreenY(frame.b.y, this.scaleY), t);

    const angleA = lerpAngle(prev.a.angle, frame.a.angle, t);
    const angleB = lerpAngle(prev.b.angle, frame.b.angle, t);

    const { cfg } = this;
    const ballRA = Math.max(8, cfg.ballARadius * this.scaleX);
    const ballRB = Math.max(8, cfg.ballBRadius * this.scaleX);

    // ── Weapons ──────────────────────────────────────────────────────────────
    this.wpnAGfx.clear();
    this.wpnBGfx.clear();
    this.drawWeapon(this.wpnAGfx, ax, ay, angleA, cfg.ballAColor, ballRA, cfg.weaponA);
    this.drawWeapon(this.wpnBGfx, bx, by, angleB, cfg.ballBColor, ballRB, cfg.weaponB);

    // ── Ball bodies ──────────────────────────────────────────────────────────
    this.ballAGfx.clear();
    this.ballBGfx.clear();
    this.drawBall(this.ballAGfx, ax, ay, ballRA, cfg.ballAColor, frame.a.hp / cfg.ballAHp);
    this.drawBall(this.ballBGfx, bx, by, ballRB, cfg.ballBColor, frame.b.hp / cfg.ballBHp);

    // ── HP bars ──────────────────────────────────────────────────────────────
    this.hpBarGfx.clear();
    this.drawHpBar(this.hpBarGfx, ax, ay - ballRA - 10, ballRA * 2.5, 4, frame.a.hp / cfg.ballAHp);
    this.drawHpBar(this.hpBarGfx, bx, by - ballRB - 10, ballRB * 2.5, 4, frame.b.hp / cfg.ballBHp);

    // ── Name labels ──────────────────────────────────────────────────────────
    const truncA = cfg.ballAName.length > 10 ? cfg.ballAName.slice(0, 10) + "…" : cfg.ballAName;
    const truncB = cfg.ballBName.length > 10 ? cfg.ballBName.slice(0, 10) + "…" : cfg.ballBName;
    this.txtA.setText(truncA).setPosition(ax, ay - ballRA - 14);
    this.txtB.setText(truncB).setPosition(bx, by - ballRB - 14);

    // ── Flash rings ──────────────────────────────────────────────────────────
    this.flashGfx.clear();
    const hasCollide = frame.events.some(ev => ev.includes("collide"));
    const hasHit     = frame.events.some(ev => ev.includes(" hits "));
    const hasElim    = frame.events.some(ev => ev.includes("eliminated"));

    if (hasCollide || hasHit || hasElim) {
      const flashColor = hasElim ? 0xff4444 : hasHit ? 0xffcc00 : 0xaaddff;
      const flashExtra = hasElim ? 10 : hasHit ? 7 : 5;
      const flashAlpha = hasElim ? 0.9 : 0.7;
      const lw = hasElim ? 3 : 2;

      const ringA = hasCollide
        || frame.events.some(ev => ev.includes("hits A") || ev.startsWith("A is elim"));
      const ringB = hasCollide
        || frame.events.some(ev => ev.includes("hits B") || ev.startsWith("B is elim"));

      this.flashGfx.lineStyle(lw, flashColor, flashAlpha);
      if (ringA) {
        this.flashGfx.strokeCircle(ax, ay, ballRA + flashExtra);
      }
      if (ringB) {
        this.flashGfx.strokeCircle(bx, by, ballRB + flashExtra);
      }
    }

    // ── Event flash text ─────────────────────────────────────────────────────
    const topEvent = frame.events[0] ?? "";
    if (topEvent.includes("hits") || topEvent.includes("eliminated") || topEvent.includes("collide")) {
      const textColor = topEvent.includes("eliminated") ? "#ff4444"
                       : topEvent.includes("collide")    ? "#ffffff"
                       : "#ffcc00";
      this.txtEvent.setText(topEvent.toUpperCase()).setColor(textColor).setVisible(true);
    } else {
      this.txtEvent.setVisible(false);
    }

    // ── Tick counter ─────────────────────────────────────────────────────────
    this.txtTick.setText(`t:${frame.tick}`);
  }

  // ─── Drawing helpers ───────────────────────────────────────────────────────

  private drawBackground(): void {
    if (!this.bgGfx) return;
    const { canvasW, canvasH } = this.cfg;
    const g = this.bgGfx;
    g.clear();

    // Fill
    g.fillStyle(0x0a0a0f, 1);
    g.fillRect(0, 0, canvasW, canvasH);

    // Grid lines
    g.lineStyle(1, 0x111122, 1);
    for (let x = 0; x < canvasW; x += GRID_STEP) {
      g.lineBetween(x, 0, x, canvasH);
    }
    for (let y = 0; y < canvasH; y += GRID_STEP) {
      g.lineBetween(0, y, canvasW, y);
    }

    // Arena border
    g.lineStyle(2, 0x333355, 1);
    g.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  }

  private clearGameObjects(): void {
    this.wpnAGfx?.clear();
    this.wpnBGfx?.clear();
    this.ballAGfx?.clear();
    this.ballBGfx?.clear();
    this.flashGfx?.clear();
    this.hpBarGfx?.clear();
    this.txtA?.setText("");
    this.txtB?.setText("");
    this.txtEvent?.setVisible(false);
    this.txtTick?.setText("");
  }

  private drawBall(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number,
    color: number,
    hpFrac: number,
  ): void {
    const frac = Math.max(0, hpFrac);

    // Outer glow for high HP
    if (frac > 0.5) {
      g.fillStyle(color, 0.15 * frac);
      g.fillCircle(cx, cy, r + 8);
    }

    // Ball body
    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, r);

    // Dark center
    g.fillStyle(0x000000, 0.4);
    g.fillCircle(cx, cy, r * 0.5);
  }

  private drawHpBar(
    g: Phaser.GameObjects.Graphics,
    cx: number, barTopY: number,
    barW: number, barH: number,
    hpFrac: number,
  ): void {
    const frac = Math.max(0, Math.min(1, hpFrac));
    const barX = cx - barW / 2;
    // Background
    g.fillStyle(0x222222, 1);
    g.fillRect(barX, barTopY, barW, barH);
    // Fill
    const fillColor = frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xff9800 : 0xf44336;
    g.fillStyle(fillColor, 1);
    g.fillRect(barX, barTopY, barW * frac, barH);
  }

  private drawWeapon(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    angle: number,
    color: number,
    ballRpx: number,
    wDef: WeaponDef | null | undefined,
  ): void {
    const rad = (angle / 65536) * 2 * Math.PI;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    if (!wDef) {
      // Fallback: simple line + dot extending beyond ball surface
      const surfX = cx + cosA * ballRpx;
      const surfY = cy + sinA * ballRpx;
      const tx = cx + cosA * (ballRpx + 28);
      const ty = cy + sinA * (ballRpx + 28);
      g.lineStyle(3, color, 1);
      g.lineBetween(surfX, surfY, tx, ty);
      g.fillStyle(color, 1);
      g.fillCircle(tx, ty, 4);
      return;
    }

    const reachPx  = this.arenaToScreen(wDef.reach);
    const tipRPx   = Math.max(2, this.arenaToScreen(wDef.tipRadius));
    const tipX     = cx + cosA * reachPx;
    const tipY     = cy + sinA * reachPx;
    const surfX    = cx + cosA * ballRpx;
    const surfY    = cy + sinA * ballRpx;

    if (wDef.type === "blade") {
      const bladeStart = wDef.bladeStart ?? wDef.reach * 0.4;
      const bladeWidth = wDef.bladeWidth ?? wDef.tipRadius;
      const bsStartPx  = this.arenaToScreen(bladeStart);
      const bsX        = cx + cosA * bsStartPx;
      const bsY        = cy + sinA * bsStartPx;
      const bladeWPx   = Math.max(2, this.arenaToScreen(bladeWidth));

      // Shaft from ball surface to blade start
      if (bsStartPx > ballRpx) {
        g.lineStyle(2.5, color, 0.7);
        g.lineBetween(surfX, surfY, bsX, bsY);
      }

      // Blade capsule
      const bladeFromX = bsStartPx > ballRpx ? bsX : surfX;
      const bladeFromY = bsStartPx > ballRpx ? bsY : surfY;

      // Draw a thick line for the blade using fillRect rotated
      // Phaser 3 doesn't have a strokeCapsule primitive, so we draw a rotated thick rect.
      const bladeLen = Math.sqrt((tipX - bladeFromX) ** 2 + (tipY - bladeFromY) ** 2);
      if (bladeLen > 0) {
        g.fillStyle(color, 0.9);
        // Draw blade as rotated rect
        this.drawThickLine(g, bladeFromX, bladeFromY, tipX, tipY, bladeWPx * 2, color, 0.9);

        // Edge highlight
        this.drawThickLine(g, bladeFromX, bladeFromY, tipX, tipY, 1, 0xffffff, 0.45);
      }

    } else if (wDef.type === "blunt") {
      // Handle from ball surface to 72% reach
      const headStartPx = reachPx * 0.72;
      const hsX = cx + cosA * headStartPx;
      const hsY = cy + sinA * headStartPx;

      g.lineStyle(3, color, 1);
      g.lineBetween(surfX, surfY, hsX, hsY);

      // Mace head — large filled circle
      g.fillStyle(color, 0.9);
      g.fillCircle(tipX, tipY, tipRPx);

      // Outer ring
      g.lineStyle(1.5, color, 0.5);
      g.strokeCircle(tipX, tipY, tipRPx + 3);

    } else {
      // Point / spear
      const arrowBasePx = reachPx * 0.82;
      const abX = cx + cosA * arrowBasePx;
      const abY = cy + sinA * arrowBasePx;

      g.lineStyle(2.5, color, 1);
      g.lineBetween(surfX, surfY, abX, abY);

      // Arrowhead
      const perpX = -sinA;
      const perpY =  cosA;
      const halfW = Math.max(3, tipRPx * 0.7);

      g.fillStyle(color, 1);
      g.fillTriangle(
        abX + perpX * halfW, abY + perpY * halfW,
        abX - perpX * halfW, abY - perpY * halfW,
        tipX, tipY,
      );
    }

    // Dashed hitbox circle at tip — approximate dashes with tiny arcs
    this.drawDashedCircle(g, tipX, tipY, tipRPx, color, 0.3);
  }

  /**
   * Draw a thick line by filling a rotated rectangle.
   * Phaser's lineStyle is a stroke, not a fill — this gives a solid capsule appearance.
   */
  private drawThickLine(
    g: Phaser.GameObjects.Graphics,
    x1: number, y1: number,
    x2: number, y2: number,
    halfW: number,
    color: number,
    alpha: number,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const nx = -dy / len; // normal x
    const ny =  dx / len; // normal y

    const p1x = x1 + nx * halfW;
    const p1y = y1 + ny * halfW;
    const p2x = x1 - nx * halfW;
    const p2y = y1 - ny * halfW;
    const p3x = x2 - nx * halfW;
    const p3y = y2 - ny * halfW;
    const p4x = x2 + nx * halfW;
    const p4y = y2 + ny * halfW;

    g.fillStyle(color, alpha);
    g.fillTriangle(p1x, p1y, p2x, p2y, p3x, p3y);
    g.fillTriangle(p1x, p1y, p3x, p3y, p4x, p4y);
  }

  /**
   * Approximate dashed circle with 12 short arc segments.
   */
  private drawDashedCircle(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number,
    color: number,
    alpha: number,
  ): void {
    const segments = 12;
    const gap = 0.4; // radians gap between dashes
    const step = (2 * Math.PI) / segments;

    g.lineStyle(1, color, alpha);
    for (let i = 0; i < segments; i++) {
      const startAngle = i * step;
      const endAngle = startAngle + step - gap;
      if (endAngle <= startAngle) continue;

      const sx = cx + Math.cos(startAngle) * r;
      const sy = cy + Math.sin(startAngle) * r;
      const ex = cx + Math.cos(endAngle) * r;
      const ey = cy + Math.sin(endAngle) * r;
      g.lineBetween(sx, sy, ex, ey);
    }
  }

  // ─── Scale helpers ─────────────────────────────────────────────────────────

  private updateScales(): void {
    if (!this.cfg) return;
    this.scaleX = this.cfg.canvasW / ARENA_W;
    this.scaleY = this.cfg.canvasH / ARENA_H;
  }

  /** Convert arena-unit distance to screen pixels (for reach, radius, etc.) */
  private arenaToScreen(arenaUnits: number): number {
    return arenaUnits * this.scaleX;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function simToScreenX(simX: number, scaleX: number): number {
  return (simX / SIM_SCALE) * scaleX;
}

function simToScreenY(simY: number, scaleY: number): number {
  return (simY / SIM_SCALE) * scaleY;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp two sim angles (0..65535), handling wraparound. */
function lerpAngle(a: number, b: number, t: number): number {
  const diff = b - a;
  // Sim angle is 0..65535 (full circle); handle wrap
  let d = diff;
  if (d > 32768) d -= 65536;
  if (d < -32768) d += 65536;
  return a + d * t;
}
