// web/src/phaser/ArenaScene.ts
// Phaser 3 Scene that renders the live arena match.
// Receives TickFrame + WeaponDef updates via updateFrame() / updateConfig() calls
// from the PhaserArena React wrapper.
//
// ─── SVG asset convention ──────────────────────────────────────────────────────
// Drop SVG files into web/public/ at these exact paths.
// The scene checks each texture key after preload; any missing file falls back
// to the procedural graphics renderer automatically — no code change needed.
//
//   web/public/orbs/orb.svg          — ball body (design in white/grey; tinted at runtime)
//   web/public/weapons/blade.svg      — short_sword / katana (pointing RIGHT, origin LEFT edge)
//   web/public/weapons/spear.svg      — spear              (pointing RIGHT, origin LEFT edge)
//   web/public/weapons/mace.svg       — mace               (pointing RIGHT, origin LEFT edge)
//
// SVG sizing hints (passed to this.load.svg):
//   orb:   { width: 100, height: 100 }   — square, centered
//   blade: { width: 100, height: 20  }   — wider than tall
//   spear: { width: 120, height: 14  }
//   mace:  { width:  90, height: 50  }   — short, fat head
//
// Design rules:
//   • Orb: white/light-grey base — Phaser multiplies tint colour onto it.
//   • Weapons: draw pointing RIGHT (0 rad). The leftmost edge is the pivot
//     (ball attachment point); the rightmost pixel is the tip.
//   • Use white/grey fill so the ball's colour tint carries through.
//     Or use full colour if you want weapon colours fixed regardless of ball tint.
//
// ─── Coordinate system ────────────────────────────────────────────────────────
// Sim positions are in "sim units" (scale 1000 per arena unit).
// Arena is 400×700 arena units.
// We map sim units → screen pixels via scaleX = canvasW/400, scaleY = canvasH/700.

import Phaser from "phaser";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

// ─── Constants ───────────────────────────────────────────────────────────────

const ARENA_W   = 400;  // arena units
const ARENA_H   = 700;
const SIM_SCALE = 1000; // sim units per arena unit
const GRID_STEP = 40;   // px between grid lines
const REPLAY_FPS = 30;  // expected tick rate from broadcaster

// ─── SVG texture keys & load specs ───────────────────────────────────────────
// Each entry: the Phaser texture key, the public URL, and the rasterisation size.
// Phaser renders SVG → bitmap at (svgW × svgH) — larger = crisper at display size.

const SVG_ORB   = "orb";
const SVG_BLADE = "blade";
const SVG_SPEAR = "spear";
const SVG_MACE  = "mace";

const SVG_ASSETS = [
  { key: SVG_ORB,   url: "orbs/orb.svg",       svgW: 100, svgH: 100 },
  { key: SVG_BLADE, url: "weapons/blade.svg",   svgW: 100, svgH: 20  },
  { key: SVG_SPEAR, url: "weapons/spear.svg",   svgW: 120, svgH: 14  },
  { key: SVG_MACE,  url: "weapons/mace.svg",    svgW: 90,  svgH: 50  },
] as const;

// Map WeaponDef.type → svg weapon key
function weaponKey(type: WeaponDef["type"] | undefined): string {
  switch (type) {
    case "blade": return SVG_BLADE;
    case "blunt": return SVG_MACE;
    case "point": return SVG_SPEAR;
    default:      return SVG_BLADE;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArenaSceneConfig {
  ballAName: string;
  ballBName: string;
  ballAColor: number;   // Phaser hex (0x4fc3f7)
  ballBColor: number;
  ballAHp: number;
  ballBHp: number;
  ballARadius: number;  // arena units (typically 42)
  ballBRadius: number;
  weaponA: WeaponDef | null;
  weaponB: WeaponDef | null;
  canvasW: number;
  canvasH: number;
}

// ─── Scene ───────────────────────────────────────────────────────────────────

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaSceneConfig;
  private scaleX = 1;
  private scaleY = 1;

  // Tracks which SVG textures actually loaded (vs 404 / not yet added)
  private loadedTextures = new Set<string>();

  // ── Static background layer ───────────────────────────────────────────────
  private bgGfx!: Phaser.GameObjects.Graphics;

  // ── Weapon layer — one Image (SVG) or Graphics (fallback) per fighter ─────
  // We keep both; exactly one is visible depending on texture availability.
  private wpnAImg!: Phaser.GameObjects.Image;
  private wpnBImg!: Phaser.GameObjects.Image;
  private wpnAGfx!: Phaser.GameObjects.Graphics;
  private wpnBGfx!: Phaser.GameObjects.Graphics;

  // ── Ball layer — one Image (SVG) or Graphics (fallback) per fighter ───────
  private ballAImg!: Phaser.GameObjects.Image;
  private ballBImg!: Phaser.GameObjects.Image;
  private ballAGfx!: Phaser.GameObjects.Graphics;
  private ballBGfx!: Phaser.GameObjects.Graphics;

  // ── Overlay layers (always graphics / text) ───────────────────────────────
  private flashGfx!: Phaser.GameObjects.Graphics;
  private hpBarGfx!: Phaser.GameObjects.Graphics;
  private txtA!: Phaser.GameObjects.Text;
  private txtB!: Phaser.GameObjects.Text;
  private txtEvent!: Phaser.GameObjects.Text;
  private txtTick!: Phaser.GameObjects.Text;
  private txtWaiting!: Phaser.GameObjects.Text;

  // ── Frame state ───────────────────────────────────────────────────────────
  private currentFrame: TickFrame | null = null;
  private prevFrame:    TickFrame | null = null;
  private frameTime = 0;
  private frameInterval = 1000 / REPLAY_FPS;

  constructor() {
    super({ key: "ArenaScene" });
  }

  // ─── Public API (called from PhaserArena React wrapper) ───────────────────

  updateConfig(cfg: ArenaSceneConfig): void {
    const prevW = this.cfg?.canvasW;
    const prevH = this.cfg?.canvasH;
    this.cfg = cfg;
    this.updateScales();
    // Only redraw static background when canvas size actually changes
    if (this.bgGfx && (cfg.canvasW !== prevW || cfg.canvasH !== prevH)) {
      this.drawBackground();
    }
    // Sync tints whenever fighter colours change
    if (this.ballAImg) this.ballAImg.setTint(cfg.ballAColor);
    if (this.ballBImg) this.ballBImg.setTint(cfg.ballBColor);
    if (this.wpnAImg)  this.wpnAImg.setTint(cfg.ballAColor);
    if (this.wpnBImg)  this.wpnBImg.setTint(cfg.ballBColor);
    // Swap weapon textures if weapon type changed
    if (this.wpnAImg && cfg.weaponA) this.swapWeaponTexture(this.wpnAImg, cfg.weaponA.type);
    if (this.wpnBImg && cfg.weaponB) this.swapWeaponTexture(this.wpnBImg, cfg.weaponB.type);
  }

  updateFrame(frame: TickFrame): void {
    this.prevFrame    = this.currentFrame;
    this.currentFrame = frame;
    this.frameTime    = 0;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  preload(): void {
    // Load each SVG, but record which ones actually arrive.
    // Phaser fires load.on("filecomplete") for each success and
    // load.on("loaderror") for each failure.
    this.load.on("filecomplete", (key: string) => {
      this.loadedTextures.add(key);
    });

    for (const { key, url, svgW, svgH } of SVG_ASSETS) {
      this.load.svg(key, url, { width: svgW, height: svgH });
    }
  }

  create(): void {
    const { canvasW, canvasH } = this.cfg;
    this.updateScales();

    // ── Background ───────────────────────────────────────────────────────────
    this.bgGfx = this.add.graphics();
    this.drawBackground();

    // ── Weapon Images (SVG, hidden until loaded) ──────────────────────────
    // Pivot at left edge (x=0, y=0.5) so the weapon rotates from its attachment point.
    // Use __DEFAULT (Phaser's built-in white pixel) so Images are always created
    // with a valid texture â SVG textures are swapped in by renderWeapon() once loaded.
    this.wpnAImg = this.add.image(0, 0, "__DEFAULT").setOrigin(0, 0.5).setVisible(false);
    this.wpnBImg = this.add.image(0, 0, "__DEFAULT").setOrigin(0, 0.5).setVisible(false);

    // ── Weapon Graphics fallback ──────────────────────────────────────────
    this.wpnAGfx = this.add.graphics();
    this.wpnBGfx = this.add.graphics();

    // ── Ball Images (SVG, hidden until loaded) ────────────────────────────
    // Centered pivot.
    this.ballAImg = this.add.image(0, 0, "__DEFAULT").setOrigin(0.5, 0.5).setVisible(false);
    this.ballBImg = this.add.image(0, 0, "__DEFAULT").setOrigin(0.5, 0.5).setVisible(false);

    // ── Ball Graphics fallback ────────────────────────────────────────────
    this.ballAGfx = this.add.graphics();
    this.ballBGfx = this.add.graphics();

    // ── Overlay layers ────────────────────────────────────────────────────
    this.flashGfx = this.add.graphics();
    this.hpBarGfx = this.add.graphics();

    // Apply initial tints
    this.ballAImg.setTint(this.cfg.ballAColor);
    this.ballBImg.setTint(this.cfg.ballBColor);
    this.wpnAImg.setTint(this.cfg.ballAColor);
    this.wpnBImg.setTint(this.cfg.ballBColor);

    // ── Text ──────────────────────────────────────────────────────────────
    const mono = { fontFamily: "monospace", fontSize: "10px", color: "#cccccc" };

    this.txtA = this.add.text(0, 0, "", { ...mono, fontStyle: "bold" }).setOrigin(0.5, 1);
    this.txtB = this.add.text(0, 0, "", { ...mono, fontStyle: "bold" }).setOrigin(0.5, 1);

    this.txtEvent = this.add.text(canvasW / 2, canvasH - 16, "", {
      ...mono, fontStyle: "bold", fontSize: "11px",
    }).setOrigin(0.5, 0.5).setVisible(false);

    this.txtTick = this.add.text(canvasW - 4, canvasH - 4, "", {
      fontFamily: "monospace", fontSize: "9px", color: "#333355",
    }).setOrigin(1, 1);

    this.txtWaiting = this.add.text(canvasW / 2, canvasH / 2, "WAITING FOR MATCH...", {
      fontFamily: "monospace", fontSize: "16px", color: "#444466", fontStyle: "bold",
    }).setOrigin(0.5, 0.5);
  }

  update(_time: number, delta: number): void {
    if (!this.cfg) return;

    if (!this.currentFrame) {
      this.txtWaiting.setVisible(true);
      this.clearDynamic();
      return;
    }
    this.txtWaiting.setVisible(false);

    // Interpolate positions between frames for smooth 60fps motion
    this.frameTime += delta;
    const t     = Math.min(1, this.frameTime / this.frameInterval);
    const frame = this.currentFrame;
    const prev  = this.prevFrame ?? frame;

    const ax = lerp(simToScreenX(prev.a.x, this.scaleX), simToScreenX(frame.a.x, this.scaleX), t);
    const ay = lerp(simToScreenY(prev.a.y, this.scaleY), simToScreenY(frame.a.y, this.scaleY), t);
    const bx = lerp(simToScreenX(prev.b.x, this.scaleX), simToScreenX(frame.b.x, this.scaleX), t);
    const by = lerp(simToScreenY(prev.b.y, this.scaleY), simToScreenY(frame.b.y, this.scaleY), t);

    const angleA = lerpAngle(prev.a.angle, frame.a.angle, t);
    const angleB = lerpAngle(prev.b.angle, frame.b.angle, t);
    const radA   = (angleA / 65536) * 2 * Math.PI;
    const radB   = (angleB / 65536) * 2 * Math.PI;

    const { cfg } = this;
    const ballRA = Math.max(8, cfg.ballARadius * this.scaleX);
    const ballRB = Math.max(8, cfg.ballBRadius * this.scaleX);

    // ── Weapons ──────────────────────────────────────────────────────────────
    this.renderWeapon(
      this.wpnAImg, this.wpnAGfx,
      ax, ay, radA, cfg.ballAColor, ballRA, cfg.weaponA,
    );
    this.renderWeapon(
      this.wpnBImg, this.wpnBGfx,
      bx, by, radB, cfg.ballBColor, ballRB, cfg.weaponB,
    );

    // ── Balls ─────────────────────────────────────────────────────────────────
    this.renderBall(
      this.ballAImg, this.ballAGfx,
      ax, ay, ballRA, cfg.ballAColor, frame.a.hp / cfg.ballAHp,
    );
    this.renderBall(
      this.ballBImg, this.ballBGfx,
      bx, by, ballRB, cfg.ballBColor, frame.b.hp / cfg.ballBHp,
    );

    // ── HP bars ───────────────────────────────────────────────────────────────
    this.hpBarGfx.clear();
    this.drawHpBar(this.hpBarGfx, ax, ay - ballRA - 10, ballRA * 2.5, 4, frame.a.hp / cfg.ballAHp);
    this.drawHpBar(this.hpBarGfx, bx, by - ballRB - 10, ballRB * 2.5, 4, frame.b.hp / cfg.ballBHp);

    // ── Name labels ───────────────────────────────────────────────────────────
    const truncA = cfg.ballAName.length > 10 ? cfg.ballAName.slice(0, 10) + "…" : cfg.ballAName;
    const truncB = cfg.ballBName.length > 10 ? cfg.ballBName.slice(0, 10) + "…" : cfg.ballBName;
    this.txtA.setText(truncA).setPosition(ax, ay - ballRA - 14);
    this.txtB.setText(truncB).setPosition(bx, by - ballRB - 14);

    // ── Flash rings ───────────────────────────────────────────────────────────
    this.flashGfx.clear();
    const hasCollide = frame.events.some(ev => ev.includes("collide"));
    const hasHit     = frame.events.some(ev => ev.includes(" hits "));
    const hasElim    = frame.events.some(ev => ev.includes("eliminated"));

    if (hasCollide || hasHit || hasElim) {
      const flashColor = hasElim ? 0xff4444 : hasHit ? 0xffcc00 : 0xaaddff;
      const flashAlpha = hasElim ? 0.9 : 0.7;
      const flashExtra = hasElim ? 10 : hasHit ? 7 : 5;
      const lw         = hasElim ? 3 : 2;

      const ringA = hasCollide || frame.events.some(ev => ev.includes("hits A") || ev.startsWith("A is elim"));
      const ringB = hasCollide || frame.events.some(ev => ev.includes("hits B") || ev.startsWith("B is elim"));

      this.flashGfx.lineStyle(lw, flashColor, flashAlpha);
      if (ringA) this.flashGfx.strokeCircle(ax, ay, ballRA + flashExtra);
      if (ringB) this.flashGfx.strokeCircle(bx, by, ballRB + flashExtra);
    }

    // ── Event flash text ──────────────────────────────────────────────────────
    const topEvent = frame.events[0] ?? "";
    if (topEvent.includes("hits") || topEvent.includes("eliminated") || topEvent.includes("collide")) {
      const textColor = topEvent.includes("eliminated") ? "#ff4444"
                       : topEvent.includes("collide")    ? "#ffffff"
                       : "#ffcc00";
      this.txtEvent.setText(topEvent.toUpperCase()).setColor(textColor).setVisible(true);
    } else {
      this.txtEvent.setVisible(false);
    }

    // ── Tick counter ──────────────────────────────────────────────────────────
    this.txtTick.setText(`t:${frame.tick}`);
  }

  // ─── SVG-aware render helpers ─────────────────────────────────────────────

  /**
   * Render a weapon: SVG Image if the texture loaded, Graphics fallback otherwise.
   * The Image pivot is at its left edge (attachment point at ball surface).
   */
  private renderWeapon(
    img: Phaser.GameObjects.Image,
    gfx: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    radians: number,
    color: number,
    ballRpx: number,
    wDef: WeaponDef | null | undefined,
  ): void {
    const wKey = wDef ? weaponKey(wDef.type) : null;
    const useImg = wKey !== null && this.loadedTextures.has(wKey);

    if (useImg) {
      // Place pivot at ball surface (ballRpx along weapon direction from centre)
      const pivotX = cx + Math.cos(radians) * ballRpx;
      const pivotY = cy + Math.sin(radians) * ballRpx;

      // Scale image so it spans exactly reach - ballRpx in length
      const reachPx    = wDef ? this.arenaToScreen(wDef.reach) : ballRpx + 28;
      const shaftLen   = Math.max(4, reachPx - ballRpx);
      const srcW       = img.width  || 100;
      const scaleForW  = shaftLen / srcW;
      // Keep aspect ratio but clamp height to avoid enormous maces, etc.
      const scaleForH  = scaleForW;

      img
        .setTexture(wKey)
        .setPosition(pivotX, pivotY)
        .setRotation(radians)
        .setScale(scaleForW, scaleForH)
        .setTint(color)
        .setVisible(true);

      gfx.clear();
      gfx.setVisible(false);
    } else {
      img.setVisible(false);
      gfx.setVisible(true);
      gfx.clear();
      // Draw procedural weapon (angle is in sim units; convert back to radians inline)
      const simAngle = (radians / (2 * Math.PI)) * 65536;
      this.drawWeaponGfx(gfx, cx, cy, simAngle, color, ballRpx, wDef);
    }
  }

  /**
   * Render a ball: SVG Image if the texture loaded, Graphics fallback otherwise.
   */
  private renderBall(
    img: Phaser.GameObjects.Image,
    gfx: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number,
    color: number,
    hpFrac: number,
  ): void {
    const useImg = this.loadedTextures.has(SVG_ORB);

    if (useImg) {
      const diameter = r * 2;
      img
        .setPosition(cx, cy)
        .setDisplaySize(diameter, diameter)
        .setTint(color)
        .setVisible(true);

      gfx.clear();
      gfx.setVisible(false);

      // HP-based alpha pulse on glow ring (drawn on top of the image)
      if (hpFrac > 0.5) {
        gfx.setVisible(true);
        gfx.fillStyle(color, 0.15 * hpFrac);
        gfx.fillCircle(cx, cy, r + 8);
      }
    } else {
      img.setVisible(false);
      gfx.setVisible(true);
      gfx.clear();
      this.drawBallGfx(gfx, cx, cy, r, color, hpFrac);
    }
  }

  /** Swap weapon Image to the correct SVG texture for the given weapon type. */
  private swapWeaponTexture(img: Phaser.GameObjects.Image, type: WeaponDef["type"]): void {
    const key = weaponKey(type);
    if (this.loadedTextures.has(key) && img.texture.key !== key) {
      img.setTexture(key);
    }
  }

  // ─── Procedural graphics fallbacks ───────────────────────────────────────

  private drawBallGfx(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number,
    color: number,
    hpFrac: number,
  ): void {
    const frac = Math.max(0, hpFrac);
    if (frac > 0.5) {
      g.fillStyle(color, 0.15 * frac);
      g.fillCircle(cx, cy, r + 8);
    }
    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, r);
    g.fillStyle(0x000000, 0.4);
    g.fillCircle(cx, cy, r * 0.5);
  }

  private drawWeaponGfx(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    angle: number,        // sim angle 0..65535
    color: number,
    ballRpx: number,
    wDef: WeaponDef | null | undefined,
  ): void {
    const rad  = (angle / 65536) * 2 * Math.PI;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    if (!wDef) {
      const surfX = cx + cosA * ballRpx;
      const surfY = cy + sinA * ballRpx;
      const tx    = cx + cosA * (ballRpx + 28);
      const ty    = cy + sinA * (ballRpx + 28);
      g.lineStyle(3, color, 1);
      g.lineBetween(surfX, surfY, tx, ty);
      g.fillStyle(color, 1);
      g.fillCircle(tx, ty, 4);
      return;
    }

    const reachPx = this.arenaToScreen(wDef.reach);
    const tipRPx  = Math.max(2, this.arenaToScreen(wDef.tipRadius));
    const tipX    = cx + cosA * reachPx;
    const tipY    = cy + sinA * reachPx;
    const surfX   = cx + cosA * ballRpx;
    const surfY   = cy + sinA * ballRpx;

    if (wDef.type === "blade") {
      const bladeStart = wDef.bladeStart ?? wDef.reach * 0.4;
      const bladeWidth = wDef.bladeWidth ?? wDef.tipRadius;
      const bsStartPx  = this.arenaToScreen(bladeStart);
      const bsX        = cx + cosA * bsStartPx;
      const bsY        = cy + sinA * bsStartPx;
      const bladeWPx   = Math.max(2, this.arenaToScreen(bladeWidth));

      if (bsStartPx > ballRpx) {
        g.lineStyle(2.5, color, 0.7);
        g.lineBetween(surfX, surfY, bsX, bsY);
      }

      const fromX = bsStartPx > ballRpx ? bsX : surfX;
      const fromY = bsStartPx > ballRpx ? bsY : surfY;
      this.drawThickLine(g, fromX, fromY, tipX, tipY, bladeWPx * 2, color, 0.9);
      this.drawThickLine(g, fromX, fromY, tipX, tipY, 1, 0xffffff, 0.45);

    } else if (wDef.type === "blunt") {
      const hsX = cx + cosA * reachPx * 0.72;
      const hsY = cy + sinA * reachPx * 0.72;
      g.lineStyle(3, color, 1);
      g.lineBetween(surfX, surfY, hsX, hsY);
      g.fillStyle(color, 0.9);
      g.fillCircle(tipX, tipY, tipRPx);
      g.lineStyle(1.5, color, 0.5);
      g.strokeCircle(tipX, tipY, tipRPx + 3);

    } else {
      const abX = cx + cosA * reachPx * 0.82;
      const abY = cy + sinA * reachPx * 0.82;
      g.lineStyle(2.5, color, 1);
      g.lineBetween(surfX, surfY, abX, abY);
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

    this.drawDashedCircle(g, tipX, tipY, tipRPx, color, 0.3);
  }

  // ─── Shared drawing primitives ────────────────────────────────────────────

  private drawHpBar(
    g: Phaser.GameObjects.Graphics,
    cx: number, barTopY: number,
    barW: number, barH: number,
    hpFrac: number,
  ): void {
    const frac = Math.max(0, Math.min(1, hpFrac));
    const barX = cx - barW / 2;
    g.fillStyle(0x222222, 1);
    g.fillRect(barX, barTopY, barW, barH);
    const fillColor = frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xff9800 : 0xf44336;
    g.fillStyle(fillColor, 1);
    g.fillRect(barX, barTopY, barW * frac, barH);
  }

  private drawBackground(): void {
    if (!this.bgGfx) return;
    const { canvasW, canvasH } = this.cfg;
    const g = this.bgGfx;
    g.clear();
    g.fillStyle(0x0a0a0f, 1);
    g.fillRect(0, 0, canvasW, canvasH);
    g.lineStyle(1, 0x111122, 1);
    for (let x = 0; x < canvasW; x += GRID_STEP) g.lineBetween(x, 0, x, canvasH);
    for (let y = 0; y < canvasH; y += GRID_STEP) g.lineBetween(0, y, canvasW, y);
    g.lineStyle(2, 0x333355, 1);
    g.strokeRect(1, 1, canvasW - 2, canvasH - 2);
  }

  private clearDynamic(): void {
    this.wpnAGfx?.clear();    this.wpnBGfx?.clear();
    this.ballAGfx?.clear();   this.ballBGfx?.clear();
    this.flashGfx?.clear();   this.hpBarGfx?.clear();
    this.wpnAImg?.setVisible(false);  this.wpnBImg?.setVisible(false);
    this.ballAImg?.setVisible(false); this.ballBImg?.setVisible(false);
    this.txtA?.setText("");   this.txtB?.setText("");
    this.txtEvent?.setVisible(false);
    this.txtTick?.setText("");
  }

  // ─── Geometry helpers ─────────────────────────────────────────────────────

  private drawThickLine(
    g: Phaser.GameObjects.Graphics,
    x1: number, y1: number,
    x2: number, y2: number,
    halfW: number,
    color: number,
    alpha: number,
  ): void {
    const dx  = x2 - x1;
    const dy  = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const nx = -dy / len;
    const ny =  dx / len;
    const p1x = x1 + nx * halfW, p1y = y1 + ny * halfW;
    const p2x = x1 - nx * halfW, p2y = y1 - ny * halfW;
    const p3x = x2 - nx * halfW, p3y = y2 - ny * halfW;
    const p4x = x2 + nx * halfW, p4y = y2 + ny * halfW;
    g.fillStyle(color, alpha);
    g.fillTriangle(p1x, p1y, p2x, p2y, p3x, p3y);
    g.fillTriangle(p1x, p1y, p3x, p3y, p4x, p4y);
  }

  private drawDashedCircle(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number,
    color: number,
    alpha: number,
  ): void {
    const segments = 12;
    const gap  = 0.4;
    const step = (2 * Math.PI) / segments;
    g.lineStyle(1, color, alpha);
    for (let i = 0; i < segments; i++) {
      const s = i * step;
      const e = s + step - gap;
      if (e <= s) continue;
      g.lineBetween(
        cx + Math.cos(s) * r, cy + Math.sin(s) * r,
        cx + Math.cos(e) * r, cy + Math.sin(e) * r,
      );
    }
  }

  // ─── Scale helpers ────────────────────────────────────────────────────────

  private updateScales(): void {
    if (!this.cfg) return;
    this.scaleX = this.cfg.canvasW / ARENA_W;
    this.scaleY = this.cfg.canvasH / ARENA_H;
  }

  private arenaToScreen(arenaUnits: number): number {
    return arenaUnits * this.scaleX;
  }
}

// ─── Module-level utilities ───────────────────────────────────────────────────

function simToScreenX(simX: number, scaleX: number): number {
  return (simX / SIM_SCALE) * scaleX;
}

function simToScreenY(simY: number, scaleY: number): number {
  return (simY / SIM_SCALE) * scaleY;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 32768)  d -= 65536;
  if (d < -32768) d += 65536;
  return a + d * t;
}
