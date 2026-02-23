// web/src/phaser/ArenaScene.ts
// Phaser 3 Scene — live arena match renderer.
//
// Rendering strategy:
//   • All shapes drawn via Phaser.GameObjects.Graphics (reliable, no texture deps).
//   • SVG files are loaded in preload(). If they arrive, they are stamped onto
//     RenderTextures and used in place of the procedural fallback.
//     Missing files are silently ignored — no crash, no code change needed.
//
// ─── SVG asset convention ─────────────────────────────────────────────────────
//   web/public/orbs/orb.svg          — ball body (design in white/grey; tinted at runtime)
//   web/public/weapons/blade.svg      — points RIGHT, pivot at LEFT edge
//   web/public/weapons/spear.svg      — points RIGHT, pivot at LEFT edge
//   web/public/weapons/mace.svg       — points RIGHT, pivot at LEFT edge
//
// ─── Coordinate system ────────────────────────────────────────────────────────
//   Sim units: 1000 per arena unit.  Arena: 400×700 arena units.
//   Screen: scaleX = canvasW/400, scaleY = canvasH/700.

import Phaser from "phaser";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

// ─── Constants ────────────────────────────────────────────────────────────────

const ARENA_W    = 400;
const ARENA_H    = 700;
const SIM_SCALE  = 1000;
const GRID_STEP  = 40;
const REPLAY_FPS = 30;

// SVG asset registry — keys used for Phaser texture cache
const SVG_ORB   = "svg_orb";
const SVG_BLADE = "svg_blade";
const SVG_SPEAR = "svg_spear";
const SVG_MACE  = "svg_mace";

const SVG_ASSETS = [
  { key: SVG_ORB,   url: "orbs/orb.svg",      svgW: 100, svgH: 100 },
  { key: SVG_BLADE, url: "weapons/blade.svg",  svgW: 100, svgH: 20  },
  { key: SVG_SPEAR, url: "weapons/spear.svg",  svgW: 120, svgH: 14  },
  { key: SVG_MACE,  url: "weapons/mace.svg",   svgW: 90,  svgH: 50  },
] as const;

function weaponSvgKey(type: WeaponDef["type"] | undefined): string {
  if (type === "blunt") return SVG_MACE;
  if (type === "point") return SVG_SPEAR;
  return SVG_BLADE;
}

// ─── Public config type ───────────────────────────────────────────────────────

export interface ArenaSceneConfig {
  ballAName: string;
  ballBName: string;
  ballAColor: number;   // 0xRRGGBB
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

// ─── Scene ────────────────────────────────────────────────────────────────────

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaSceneConfig;
  private scaleX = 1;
  private scaleY = 1;

  // Which SVG textures actually loaded successfully
  private loadedSvgs = new Set<string>();

  // Graphics layers (always present, never crash)
  private bgGfx!:    Phaser.GameObjects.Graphics;
  private wpnAGfx!:  Phaser.GameObjects.Graphics;
  private wpnBGfx!:  Phaser.GameObjects.Graphics;
  private ballAGfx!: Phaser.GameObjects.Graphics;
  private ballBGfx!: Phaser.GameObjects.Graphics;
  private flashGfx!: Phaser.GameObjects.Graphics;
  private hpBarGfx!: Phaser.GameObjects.Graphics;

  // Text
  private txtA!:       Phaser.GameObjects.Text;
  private txtB!:       Phaser.GameObjects.Text;
  private txtEvent!:   Phaser.GameObjects.Text;
  private txtTick!:    Phaser.GameObjects.Text;
  private txtWaiting!: Phaser.GameObjects.Text;

  // SVG sprite containers — created lazily once textures load
  private wpnASprite!:  Phaser.GameObjects.Image;
  private wpnBSprite!:  Phaser.GameObjects.Image;
  private ballASprite!: Phaser.GameObjects.Image;
  private ballBSprite!: Phaser.GameObjects.Image;
  private spritesCreated = false;

  // Frame state
  private currentFrame: TickFrame | null = null;
  private prevFrame:    TickFrame | null = null;
  private frameTime    = 0;
  private frameInterval = 1000 / REPLAY_FPS;

  constructor() {
    super({ key: "ArenaScene" });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  updateConfig(cfg: ArenaSceneConfig): void {
    const prevW = this.cfg?.canvasW;
    const prevH = this.cfg?.canvasH;
    this.cfg = cfg;
    this.updateScales();
    if (this.bgGfx && (cfg.canvasW !== prevW || cfg.canvasH !== prevH)) {
      this.drawBackground();
    }
    // Sync tints on sprites if they exist
    if (this.ballASprite) this.ballASprite.setTint(cfg.ballAColor);
    if (this.ballBSprite) this.ballBSprite.setTint(cfg.ballBColor);
    if (this.wpnASprite)  this.wpnASprite.setTint(cfg.ballAColor);
    if (this.wpnBSprite)  this.wpnBSprite.setTint(cfg.ballBColor);
  }

  updateFrame(frame: TickFrame): void {
    this.prevFrame    = this.currentFrame;
    this.currentFrame = frame;
    this.frameTime    = 0;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  preload(): void {
    this.load.on("filecomplete", (key: string) => {
      this.loadedSvgs.add(key);
    });
    // loaderror fires for 404s — we just don't add to loadedSvgs, fallback stays
    for (const { key, url, svgW, svgH } of SVG_ASSETS) {
      this.load.svg(key, url, { width: svgW, height: svgH });
    }
  }

  create(): void {
    const { canvasW, canvasH } = this.cfg;
    this.updateScales();

    // ── Graphics layers (always safe — no texture deps) ───────────────────
    this.bgGfx    = this.add.graphics();
    this.wpnAGfx  = this.add.graphics();
    this.wpnBGfx  = this.add.graphics();
    this.ballAGfx = this.add.graphics();
    this.ballBGfx = this.add.graphics();
    this.flashGfx = this.add.graphics();
    this.hpBarGfx = this.add.graphics();

    this.drawBackground();

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

    // SVG sprites created lazily in update() once loadedSvgs is populated
  }

  update(_time: number, delta: number): void {
    if (!this.cfg) return;

    // Lazily create SVG sprites on first update after textures load
    if (!this.spritesCreated && this.loadedSvgs.size > 0) {
      this.createSvgSprites();
    }

    if (!this.currentFrame) {
      this.txtWaiting.setVisible(true);
      this.clearDynamic();
      return;
    }
    this.txtWaiting.setVisible(false);

    // Interpolate between frames
    this.frameTime += delta;
    const t     = Math.min(1, this.frameTime / this.frameInterval);
    const frame = this.currentFrame;
    const prev  = this.prevFrame ?? frame;

    const ax = lerp(toScreenX(prev.a.x, this.scaleX), toScreenX(frame.a.x, this.scaleX), t);
    const ay = lerp(toScreenY(prev.a.y, this.scaleY), toScreenY(frame.a.y, this.scaleY), t);
    const bx = lerp(toScreenX(prev.b.x, this.scaleX), toScreenX(frame.b.x, this.scaleX), t);
    const by = lerp(toScreenY(prev.b.y, this.scaleY), toScreenY(frame.b.y, this.scaleY), t);

    const angleA = lerpAngle(prev.a.angle, frame.a.angle, t);
    const angleB = lerpAngle(prev.b.angle, frame.b.angle, t);
    const radA   = (angleA / 65536) * 2 * Math.PI;
    const radB   = (angleB / 65536) * 2 * Math.PI;

    const { cfg } = this;
    const ballRA = Math.max(8, cfg.ballARadius * this.scaleX);
    const ballRB = Math.max(8, cfg.ballBRadius * this.scaleX);

    // ── Weapons ────────────────────────────────────────────────────────────
    const hasSvgWpnA = this.spritesCreated && this.loadedSvgs.has(weaponSvgKey(cfg.weaponA?.type));
    const hasSvgWpnB = this.spritesCreated && this.loadedSvgs.has(weaponSvgKey(cfg.weaponB?.type));

    this.wpnAGfx.setVisible(!hasSvgWpnA);
    this.wpnBGfx.setVisible(!hasSvgWpnB);

    if (hasSvgWpnA) {
      this.positionWeaponSprite(this.wpnASprite, ax, ay, radA, ballRA, cfg.weaponA, cfg.ballAColor);
    } else {
      this.wpnAGfx.clear();
      this.drawWeapon(this.wpnAGfx, ax, ay, angleA, cfg.ballAColor, ballRA, cfg.weaponA);
    }

    if (hasSvgWpnB) {
      this.positionWeaponSprite(this.wpnBSprite, bx, by, radB, ballRB, cfg.weaponB, cfg.ballBColor);
    } else {
      this.wpnBGfx.clear();
      this.drawWeapon(this.wpnBGfx, bx, by, angleB, cfg.ballBColor, ballRB, cfg.weaponB);
    }

    // ── Balls ──────────────────────────────────────────────────────────────
    const hasSvgOrb = this.spritesCreated && this.loadedSvgs.has(SVG_ORB);

    this.ballAGfx.setVisible(!hasSvgOrb);
    this.ballBGfx.setVisible(!hasSvgOrb);

    if (hasSvgOrb) {
      this.positionBallSprite(this.ballASprite, ax, ay, ballRA, cfg.ballAColor, frame.a.hp / cfg.ballAHp);
      this.positionBallSprite(this.ballBSprite, bx, by, ballRB, cfg.ballBColor, frame.b.hp / cfg.ballBHp);
    } else {
      this.ballAGfx.clear();
      this.ballBGfx.clear();
      this.drawBall(this.ballAGfx, ax, ay, ballRA, cfg.ballAColor, frame.a.hp / cfg.ballAHp);
      this.drawBall(this.ballBGfx, bx, by, ballRB, cfg.ballBColor, frame.b.hp / cfg.ballBHp);
    }

    // ── HP bars ────────────────────────────────────────────────────────────
    this.hpBarGfx.clear();
    this.drawHpBar(this.hpBarGfx, ax, ay - ballRA - 10, ballRA * 2.5, 4, frame.a.hp / cfg.ballAHp);
    this.drawHpBar(this.hpBarGfx, bx, by - ballRB - 10, ballRB * 2.5, 4, frame.b.hp / cfg.ballBHp);

    // ── Name labels ────────────────────────────────────────────────────────
    const truncA = cfg.ballAName.length > 10 ? cfg.ballAName.slice(0, 10) + "…" : cfg.ballAName;
    const truncB = cfg.ballBName.length > 10 ? cfg.ballBName.slice(0, 10) + "…" : cfg.ballBName;
    this.txtA.setText(truncA).setPosition(ax, ay - ballRA - 14);
    this.txtB.setText(truncB).setPosition(bx, by - ballRB - 14);

    // ── Flash rings ────────────────────────────────────────────────────────
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

    // ── Event text ─────────────────────────────────────────────────────────
    const topEvent = frame.events[0] ?? "";
    if (topEvent.includes("hits") || topEvent.includes("eliminated") || topEvent.includes("collide")) {
      const textColor = topEvent.includes("eliminated") ? "#ff4444"
                       : topEvent.includes("collide")    ? "#ffffff"
                       : "#ffcc00";
      this.txtEvent.setText(topEvent.toUpperCase()).setColor(textColor).setVisible(true);
    } else {
      this.txtEvent.setVisible(false);
    }

    this.txtTick.setText(`t:${frame.tick}`);
  }

  // ─── SVG sprite management ────────────────────────────────────────────────

  /** Called once on first update() after any SVG textures have loaded. */
  private createSvgSprites(): void {
    if (this.spritesCreated) return;
    this.spritesCreated = true;

    // Ball sprites — centered origin, tinted to fighter color
    this.ballASprite = this.add.image(0, 0, SVG_ORB)
      .setOrigin(0.5, 0.5).setVisible(false).setTint(this.cfg.ballAColor);
    this.ballBSprite = this.add.image(0, 0, SVG_ORB)
      .setOrigin(0.5, 0.5).setVisible(false).setTint(this.cfg.ballBColor);

    // Weapon sprites — left-edge origin (pivot at ball attachment point)
    const wpnKeyA = weaponSvgKey(this.cfg.weaponA?.type);
    const wpnKeyB = weaponSvgKey(this.cfg.weaponB?.type);
    this.wpnASprite = this.add.image(0, 0, wpnKeyA)
      .setOrigin(0, 0.5).setVisible(false).setTint(this.cfg.ballAColor);
    this.wpnBSprite = this.add.image(0, 0, wpnKeyB)
      .setOrigin(0, 0.5).setVisible(false).setTint(this.cfg.ballBColor);

    // Ensure sprites render above the Graphics layers by re-adding them
    // (they're already at the top of the display list from add.image)
  }

  private positionBallSprite(
    sprite: Phaser.GameObjects.Image,
    cx: number, cy: number,
    r: number,
    color: number,
    hpFrac: number,
  ): void {
    if (!this.loadedSvgs.has(SVG_ORB)) { sprite.setVisible(false); return; }
    const diameter = r * 2;
    sprite.setPosition(cx, cy).setDisplaySize(diameter, diameter).setTint(color).setVisible(true);
    // Glow ring on top via ballGfx when HP is high
    const g = sprite === this.ballASprite ? this.ballAGfx : this.ballBGfx;
    g.clear();
    if (hpFrac > 0.5) {
      g.setVisible(true);
      g.fillStyle(color, 0.15 * hpFrac);
      g.fillCircle(cx, cy, r + 8);
    } else {
      g.setVisible(false);
    }
  }

  private positionWeaponSprite(
    sprite: Phaser.GameObjects.Image,
    cx: number, cy: number,
    radians: number,
    ballRpx: number,
    wDef: WeaponDef | null | undefined,
    color: number,
  ): void {
    const key = weaponSvgKey(wDef?.type);
    if (!this.loadedSvgs.has(key)) { sprite.setVisible(false); return; }

    // Swap texture if weapon type changed
    if (sprite.texture.key !== key) sprite.setTexture(key);

    const reachPx  = wDef ? this.au(wDef.reach) : ballRpx + 28;
    const shaftLen = Math.max(4, reachPx - ballRpx);
    const pivotX   = cx + Math.cos(radians) * ballRpx;
    const pivotY   = cy + Math.sin(radians) * ballRpx;
    const scaleW   = shaftLen / (sprite.width || 100);

    sprite
      .setPosition(pivotX, pivotY)
      .setRotation(radians)
      .setScale(scaleW, scaleW)
      .setTint(color)
      .setVisible(true);
  }

  // ─── Procedural drawing (always-available fallback) ───────────────────────

  private drawBall(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number, color: number, hpFrac: number,
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

  private drawWeapon(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    angle: number,       // sim angle 0..65535
    color: number,
    ballRpx: number,
    wDef: WeaponDef | null | undefined,
  ): void {
    const rad  = (angle / 65536) * 2 * Math.PI;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    if (!wDef) {
      const sx = cx + cosA * ballRpx, sy = cy + sinA * ballRpx;
      const tx = cx + cosA * (ballRpx + 28), ty = cy + sinA * (ballRpx + 28);
      g.lineStyle(3, color, 1);
      g.lineBetween(sx, sy, tx, ty);
      g.fillStyle(color, 1);
      g.fillCircle(tx, ty, 4);
      return;
    }

    const reachPx = this.au(wDef.reach);
    const tipRPx  = Math.max(2, this.au(wDef.tipRadius));
    const tipX    = cx + cosA * reachPx, tipY = cy + sinA * reachPx;
    const surfX   = cx + cosA * ballRpx, surfY = cy + sinA * ballRpx;

    if (wDef.type === "blade") {
      const bsStart = wDef.bladeStart ?? wDef.reach * 0.4;
      const bsPx    = this.au(bsStart);
      const bsX     = cx + cosA * bsPx, bsY = cy + sinA * bsPx;
      const bladeW  = Math.max(2, this.au(wDef.bladeWidth ?? wDef.tipRadius));

      if (bsPx > ballRpx) {
        g.lineStyle(2.5, color, 0.7);
        g.lineBetween(surfX, surfY, bsX, bsY);
      }
      const fx = bsPx > ballRpx ? bsX : surfX;
      const fy = bsPx > ballRpx ? bsY : surfY;
      this.thickLine(g, fx, fy, tipX, tipY, bladeW * 2, color, 0.9);
      this.thickLine(g, fx, fy, tipX, tipY, 1, 0xffffff, 0.45);

    } else if (wDef.type === "blunt") {
      const hx = cx + cosA * reachPx * 0.72, hy = cy + sinA * reachPx * 0.72;
      g.lineStyle(3, color, 1);
      g.lineBetween(surfX, surfY, hx, hy);
      g.fillStyle(color, 0.9);
      g.fillCircle(tipX, tipY, tipRPx);
      g.lineStyle(1.5, color, 0.5);
      g.strokeCircle(tipX, tipY, tipRPx + 3);

    } else { // point
      const ax2 = cx + cosA * reachPx * 0.82, ay2 = cy + sinA * reachPx * 0.82;
      g.lineStyle(2.5, color, 1);
      g.lineBetween(surfX, surfY, ax2, ay2);
      const halfW = Math.max(3, tipRPx * 0.7);
      g.fillStyle(color, 1);
      g.fillTriangle(
        ax2 + (-sinA) * halfW, ay2 + cosA * halfW,
        ax2 - (-sinA) * halfW, ay2 - cosA * halfW,
        tipX, tipY,
      );
    }

    this.dashedCircle(g, tipX, tipY, tipRPx, color, 0.3);
  }

  private drawHpBar(
    g: Phaser.GameObjects.Graphics,
    cx: number, barY: number, barW: number, barH: number, frac: number,
  ): void {
    frac = Math.max(0, Math.min(1, frac));
    const barX = cx - barW / 2;
    g.fillStyle(0x222222, 1);
    g.fillRect(barX, barY, barW, barH);
    const col = frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xff9800 : 0xf44336;
    g.fillStyle(col, 1);
    g.fillRect(barX, barY, barW * frac, barH);
  }

  private drawBackground(): void {
    if (!this.bgGfx || !this.cfg) return;
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
    this.wpnAGfx?.clear();     this.wpnBGfx?.clear();
    this.ballAGfx?.clear();    this.ballBGfx?.clear();
    this.flashGfx?.clear();    this.hpBarGfx?.clear();
    this.wpnASprite?.setVisible(false);  this.wpnBSprite?.setVisible(false);
    this.ballASprite?.setVisible(false); this.ballBSprite?.setVisible(false);
    this.txtA?.setText("");    this.txtB?.setText("");
    this.txtEvent?.setVisible(false);
    this.txtTick?.setText("");
  }

  // ─── Geometry helpers ─────────────────────────────────────────────────────

  private thickLine(
    g: Phaser.GameObjects.Graphics,
    x1: number, y1: number, x2: number, y2: number,
    halfW: number, color: number, alpha: number,
  ): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const nx = -dy / len, ny = dx / len;
    g.fillStyle(color, alpha);
    g.fillTriangle(x1 + nx*halfW, y1 + ny*halfW, x1 - nx*halfW, y1 - ny*halfW, x2 - nx*halfW, y2 - ny*halfW);
    g.fillTriangle(x1 + nx*halfW, y1 + ny*halfW, x2 - nx*halfW, y2 - ny*halfW, x2 + nx*halfW, y2 + ny*halfW);
  }

  private dashedCircle(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number, r: number, color: number, alpha: number,
  ): void {
    const segs = 12, gap = 0.4, step = (2 * Math.PI) / segs;
    g.lineStyle(1, color, alpha);
    for (let i = 0; i < segs; i++) {
      const s = i * step, e = s + step - gap;
      if (e <= s) continue;
      g.lineBetween(cx + Math.cos(s)*r, cy + Math.sin(s)*r, cx + Math.cos(e)*r, cy + Math.sin(e)*r);
    }
  }

  // ─── Scale helpers ────────────────────────────────────────────────────────

  private updateScales(): void {
    if (!this.cfg) return;
    this.scaleX = this.cfg.canvasW / ARENA_W;
    this.scaleY = this.cfg.canvasH / ARENA_H;
  }

  /** Arena units → screen pixels */
  private au(arenaUnits: number): number {
    return arenaUnits * this.scaleX;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toScreenX(simX: number, scaleX: number): number { return (simX / SIM_SCALE) * scaleX; }
function toScreenY(simY: number, scaleY: number): number { return (simY / SIM_SCALE) * scaleY; }
function lerp(a: number, b: number, t: number): number   { return a + (b - a) * t; }

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 32768)  d -= 65536;
  if (d < -32768) d += 65536;
  return a + d * t;
}
