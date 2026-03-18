// web/src/phaser/ArenaScene.ts
// Phaser 3 Scene — live arena match renderer.
//
// Rendering strategy:
//   • SVG sprites loaded in preload() for ball + weapons — tinted per fighter color via setTint().
//   • Procedural Graphics layers retained for: background, HP bars, flash rings, name badges.
//   • drawBall()   — replaced by ballAImg / ballBImg sprites (orb-wireframe.svg)
//   • drawWeapon() — replaced by weapon sprites (shortsword/spear/mace/katana.svg)
//   • buildArenaBackground() — hex grid + border, drawn once to bgGfx on create()
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

const REPLAY_FPS  = 30;
/** Native rasterization size for all SVG sprites (power of 2 for GPU). */
const SPRITE_SIZE = 256;
/** orb-wireframe.svg sphere r=46 in viewBox half=50 → 0.92 of sprite extent. */
const SVG_SPHERE_FRAC = 46 / 50;

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
  /** Arena dimensions from server (defaults to 400×700 constants). */
  arenaW?: number;
  arenaH?: number;
  /** When true, renders recording-only overlays (side cards + winner banner). */
  recordingMode?: boolean;
  /** When true, draws simulation hitbox shapes over sprites. */
  debugHitboxes?: boolean;
  /** Set to "A" or "B" when the match ends — triggers the winner overlay. */
  winner?: "A" | "B" | null;
  /** Fighter W/L record — displayed on recording side cards. */
  ballAWins?: number;
  ballALosses?: number;
  ballBWins?: number;
  ballBLosses?: number;
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class ArenaScene extends Phaser.Scene {
  private cfg!: ArenaSceneConfig;
  private scaleX = 1;
  private scaleY = 1;

  // Static background (drawn once to bgGfx, never cleared)
  private bgBuilt = false;

  // ── SVG sprite images ──────────────────────────────────────────────────────
  private ballAImg!:  Phaser.GameObjects.Image;
  private ballBImg!:  Phaser.GameObjects.Image;
  private wpnAImg!:   Phaser.GameObjects.Image;
  private wpnBImg!:   Phaser.GameObjects.Image;

  // ── Graphics layers (retained for HP bars, flash rings, badges, hitboxes) ─
  private bgGfx!:     Phaser.GameObjects.Graphics;
  private flashGfx!:  Phaser.GameObjects.Graphics;
  private hpBarGfx!:  Phaser.GameObjects.Graphics;
  private badgeGfx!:  Phaser.GameObjects.Graphics;
  private hitboxGfx!: Phaser.GameObjects.Graphics;

  // Text
  private txtA!:       Phaser.GameObjects.Text;
  private txtB!:       Phaser.GameObjects.Text;
  private txtEvent!:   Phaser.GameObjects.Text;
  private txtTick!:    Phaser.GameObjects.Text;
  private txtWaiting!: Phaser.GameObjects.Text;

  // Recording overlay objects (only visible when cfg.recordingMode === true)
  private cardAGfx!:     Phaser.GameObjects.Graphics;
  private cardBGfx!:     Phaser.GameObjects.Graphics;
  private txtCardAName!: Phaser.GameObjects.Text;
  private txtCardBName!: Phaser.GameObjects.Text;
  private txtCardAInfo!: Phaser.GameObjects.Text;
  private txtCardBInfo!: Phaser.GameObjects.Text;
  private resultGfx!:    Phaser.GameObjects.Graphics;
  private txtResult!:    Phaser.GameObjects.Text;

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
      this.bgBuilt = false;
      this.buildArenaBackground();
    }
  }

  updateFrame(frame: TickFrame): void {
    this.prevFrame    = this.currentFrame;
    this.currentFrame = frame;
    this.frameTime    = 0;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  preload(): void {
    // Rasterize SVGs at SPRITE_SIZE × SPRITE_SIZE for high-quality game sprites.
    // White stroke/fill on transparent — tinted per fighter with setTint(color).
    this.load.svg("orb-wireframe", "/orbs/orb-wireframe.svg",     { width: SPRITE_SIZE, height: SPRITE_SIZE });
    this.load.svg("shortsword",    "/weapons/shortsword.svg",     { width: SPRITE_SIZE, height: SPRITE_SIZE });
    this.load.svg("spear",         "/weapons/spear.svg",          { width: SPRITE_SIZE, height: SPRITE_SIZE });
    this.load.svg("mace",          "/weapons/mace.svg",           { width: SPRITE_SIZE, height: SPRITE_SIZE });
    this.load.svg("katana",        "/weapons/katana.svg",         { width: SPRITE_SIZE, height: SPRITE_SIZE });
  }

  create(): void {
    const { canvasW, canvasH } = this.cfg;
    this.updateScales();

    // ── Background (depth 0) ──────────────────────────────────────────────
    this.bgGfx = this.add.graphics().setDepth(0);
    this.buildArenaBackground();

    // ── Weapon sprites (depth 5–6, behind balls) ─────────────────────────
    this.wpnAImg = this.add.image(0, 0, "shortsword")
      .setOrigin(0, 0.5)
      .setVisible(false)
      .setDepth(5);
    this.wpnBImg = this.add.image(0, 0, "shortsword")
      .setOrigin(0, 0.5)
      .setVisible(false)
      .setDepth(6);

    // ── Ball sprites (depth 10–11, above weapons) ─────────────────────────
    this.ballAImg = this.add.image(0, 0, "orb-wireframe")
      .setVisible(false)
      .setDepth(10);
    this.ballBImg = this.add.image(0, 0, "orb-wireframe")
      .setVisible(false)
      .setDepth(11);

    // ── Flash rings (depth 15) ────────────────────────────────────────────
    this.flashGfx = this.add.graphics().setDepth(15);

    // ── HP bars (depth 20) ────────────────────────────────────────────────
    this.hpBarGfx = this.add.graphics().setDepth(20);

    // ── Name badges + labels (depth 25–26) ───────────────────────────────
    this.badgeGfx = this.add.graphics().setDepth(25);

    // ── Debug hitbox overlay (depth 30 — above badges, below recording) ─
    this.hitboxGfx = this.add.graphics().setDepth(30);

    const mono = { fontFamily: "'Courier New', Courier, monospace", fontSize: "10px", color: "#4DFF91" };

    this.txtA = this.add.text(0, 0, "", { ...mono, fontStyle: "bold" }).setOrigin(0.5, 1).setDepth(26);
    this.txtB = this.add.text(0, 0, "", { ...mono, fontStyle: "bold" }).setOrigin(0.5, 1).setDepth(26);

    this.txtEvent = this.add.text(canvasW / 2, canvasH - 16, "", {
      ...mono, fontStyle: "bold", fontSize: "11px",
    }).setOrigin(0.5, 0.5).setVisible(false).setDepth(26);

    this.txtTick = this.add.text(canvasW - 4, canvasH - 4, "", {
      fontFamily: "'Courier New', Courier, monospace", fontSize: "9px", color: "#0d2a1c",
    }).setOrigin(1, 1).setDepth(26);

    this.txtWaiting = this.add.text(canvasW / 2, canvasH / 2, "WAITING FOR MATCH...", {
      fontFamily: "'Orbitron', sans-serif", fontSize: "16px", color: "#1a5530", fontStyle: "bold",
    }).setOrigin(0.5, 0.5).setDepth(26);

    // ── Recording overlays (depth 100–201) ───────────────────────────────
    this.cardAGfx = this.add.graphics().setDepth(100);
    this.cardBGfx = this.add.graphics().setDepth(100);
    this.txtCardAName = this.add.text(0, 0, "", {
      fontFamily: "'Orbitron', sans-serif", fontSize: "60px", fontStyle: "bold",
    }).setOrigin(0, 0).setDepth(101);
    this.txtCardBName = this.add.text(0, 0, "", {
      fontFamily: "'Orbitron', sans-serif", fontSize: "60px", fontStyle: "bold",
    }).setOrigin(0, 0).setDepth(101);
    this.txtCardAInfo = this.add.text(0, 0, "", {
      fontFamily: "'Courier New', Courier, monospace", fontSize: "48px", color: "#4a5a4e", lineSpacing: 16,
    }).setOrigin(0, 0).setDepth(101);
    this.txtCardBInfo = this.add.text(0, 0, "", {
      fontFamily: "'Courier New', Courier, monospace", fontSize: "48px", color: "#4a5a4e", lineSpacing: 16,
    }).setOrigin(0, 0).setDepth(101);
    this.resultGfx = this.add.graphics().setDepth(200);
    this.txtResult = this.add.text(canvasW / 2, canvasH * 0.4, "", {
      fontFamily: "'Orbitron', sans-serif", fontSize: "32px", fontStyle: "bold", color: "#4DFF91",
    }).setOrigin(0.5, 0.5).setDepth(201);
  }

  update(_time: number, delta: number): void {
    if (!this.cfg) return;

    if (!this.currentFrame) {
      this.txtWaiting.setVisible(true);
      this.clearDynamic();
      this.renderRecordingOverlays();
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

    const { cfg } = this;
    const ballRA = Math.max(8, cfg.ballARadius * this.scaleX);
    const ballRB = Math.max(8, cfg.ballBRadius * this.scaleX);

    // ── Weapon sprites ────────────────────────────────────────────────────
    this.updateWeaponSprite(this.wpnAImg, ax, ay, angleA, cfg.ballAColor, ballRA, cfg.weaponA);
    this.updateWeaponSprite(this.wpnBImg, bx, by, angleB, cfg.ballBColor, ballRB, cfg.weaponB);

    // ── Ball sprites ──────────────────────────────────────────────────────
    // SVG sphere r=46 in viewBox half=50 → visual fills 92% of sprite.
    // Scale up by 1/0.92 so the visible sphere edge matches the hitbox radius.
    const ballAScale = (ballRA * 2) / (SPRITE_SIZE * SVG_SPHERE_FRAC);
    this.ballAImg
      .setVisible(true)
      .setPosition(ax, ay)
      .setScale(ballAScale)
      .setTint(cfg.ballAColor);

    const ballBScale = (ballRB * 2) / (SPRITE_SIZE * SVG_SPHERE_FRAC);
    this.ballBImg
      .setVisible(true)
      .setPosition(bx, by)
      .setScale(ballBScale)
      .setTint(cfg.ballBColor);

    // ── HP bars ────────────────────────────────────────────────────────────
    this.hpBarGfx.clear();
    this.drawHpBar(this.hpBarGfx, ax, ay - ballRA - 10, ballRA * 2.5, 4, frame.a.hp / cfg.ballAHp);
    this.drawHpBar(this.hpBarGfx, bx, by - ballRB - 10, ballRB * 2.5, 4, frame.b.hp / cfg.ballBHp);

    // ── Name labels + badges (hidden in recording mode) ───────────────────
    if (!cfg.recordingMode) {
      const truncA = cfg.ballAName.length > 10 ? cfg.ballAName.slice(0, 10) + "…" : cfg.ballAName;
      const truncB = cfg.ballBName.length > 10 ? cfg.ballBName.slice(0, 10) + "…" : cfg.ballBName;
      this.badgeGfx.clear();
      this.drawNameBadge(this.badgeGfx, ax, ay - ballRA - 14, truncA, cfg.ballAColor);
      this.drawNameBadge(this.badgeGfx, bx, by - ballRB - 14, truncB, cfg.ballBColor);
      this.txtA.setText(truncA).setPosition(ax, ay - ballRA - 14)
        .setColor("#" + cfg.ballAColor.toString(16).padStart(6, "0"));
      this.txtB.setText(truncB).setPosition(bx, by - ballRB - 14)
        .setColor("#" + cfg.ballBColor.toString(16).padStart(6, "0"));
    } else {
      this.badgeGfx.clear();
      this.txtA.setText("");
      this.txtB.setText("");
    }

    // ── Flash rings ────────────────────────────────────────────────────────
    this.flashGfx.clear();
    const hasCollide = frame.events.some(ev => ev.includes("collide"));
    const hasHit     = frame.events.some(ev => ev.includes(" hits "));
    const hasElim    = frame.events.some(ev => ev.includes("eliminated"));

    if (hasCollide || hasHit || hasElim) {
      const flashColor = hasElim ? 0xff3d00 : hasHit ? 0xff3d00 : 0x4dff91;
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
      const textColor = topEvent.includes("eliminated") ? "#FF3D00"
                       : topEvent.includes("collide")    ? "#4DFF91"
                       : "#FF3D00";
      this.txtEvent.setText(topEvent.toUpperCase()).setColor(textColor).setVisible(true);
    } else {
      this.txtEvent.setVisible(false);
    }

    this.txtTick.setText(`t:${frame.tick}`);

    // ── Debug hitbox overlay ────────────────────────────────────────────
    this.renderHitboxOverlay(ax, ay, ballRA, angleA, cfg.weaponA, cfg.ballAColor,
                             bx, by, ballRB, angleB, cfg.weaponB, cfg.ballBColor);

    // ── Recording overlays ────────────────────────────────────────────────
    this.renderRecordingOverlays();
  }

  // ─── Weapon sprite helper ─────────────────────────────────────────────────

  private updateWeaponSprite(
    img: Phaser.GameObjects.Image,
    cx: number, cy: number,
    angle: number,
    color: number,
    _ballRpx: number,
    wDef: WeaponDef | null | undefined,
  ): void {
    if (!wDef) {
      img.setVisible(false);
      return;
    }

    const rad     = (angle / 65536) * 2 * Math.PI;
    const reachPx = this.au(wDef.reach);
    const key     = weaponTextureKey(wDef);

    // Swap texture if the weapon type changed mid-match
    if (img.texture.key !== key) img.setTexture(key);

    // Origin (0, 0.5): left edge = pivot, positioned at ball center.
    // The hilt portion (x≈5–12% of sprite) sits inside the ball naturally.
    // The weapon extends outward to reachPx screen pixels.
    img
      .setVisible(true)
      .setPosition(cx, cy)
      .setRotation(rad)
      .setScale(reachPx / SPRITE_SIZE)
      .setTint(color);
  }

  // ─── Recording overlays ──────────────────────────────────────────────────

  private renderRecordingOverlays(): void {
    const { cfg } = this;
    if (!cfg?.recordingMode) {
      this.cardAGfx?.setVisible(false);
      this.cardBGfx?.setVisible(false);
      this.txtCardAName?.setVisible(false);
      this.txtCardBName?.setVisible(false);
      this.txtCardAInfo?.setVisible(false);
      this.txtCardBInfo?.setVisible(false);
      this.resultGfx?.setVisible(false);
      this.txtResult?.setVisible(false);
      // Restore base font sizes for live viewer
      this.txtEvent?.setFontSize(11);
      this.txtTick?.setFontSize(9);
      this.txtWaiting?.setFontSize(16);
      return;
    }

    const { canvasW, canvasH } = cfg;

    // ── Scale arena text up for recording legibility ───────────────────
    this.txtEvent?.setFontSize(28);
    this.txtTick?.setFontSize(16);
    this.txtWaiting?.setFontSize(32);

    // ── Fighter info cards ──────────────────────────────────────────────
    const cardW   = 500;
    const cardH   = 280;
    const margin  = 20;
    const pad     = 24;
    const accent  = 6;
    const corner  = 14;

    const hpA = this.currentFrame?.a.hp ?? cfg.ballAHp;
    const hpB = this.currentFrame?.b.hp ?? cfg.ballBHp;

    const drawCard = (
      gfx: Phaser.GameObjects.Graphics,
      txtName: Phaser.GameObjects.Text,
      txtInfo: Phaser.GameObjects.Text,
      x: number, color: number, name: string,
      hp: number, maxHp: number,
      wpnType: string, wpnDmg: number,
      side: "left" | "right",
    ) => {
      const hex = "#" + color.toString(16).padStart(6, "0");

      gfx.clear();
      gfx.setVisible(true);
      gfx.fillStyle(0x000000, 0.6);
      gfx.fillRoundedRect(x, margin, cardW, cardH, corner);

      gfx.fillStyle(color, 1);
      if (side === "left") {
        gfx.fillRect(x, margin + corner, accent, cardH - corner * 2);
      } else {
        gfx.fillRect(x + cardW - accent, margin + corner, accent, cardH - corner * 2);
      }

      const sepY = margin + 80;
      gfx.lineStyle(1, 0x1a5530, 0.6);
      gfx.lineBetween(x + pad, sepY, x + cardW - pad, sepY);

      const textX = x + pad + (side === "left" ? accent + 2 : 0);
      txtName.setVisible(true);
      txtName.setText(name.toUpperCase());
      txtName.setColor(hex);
      txtName.setPosition(textX, margin + 12);

      txtInfo.setVisible(true);
      txtInfo.setText(
        `HP: ${Math.round(hp)} / ${maxHp}\n` +
        `${wpnType} · DMG ${wpnDmg}`,
      );
      txtInfo.setPosition(textX, sepY + 10);
    };

    drawCard(
      this.cardAGfx, this.txtCardAName, this.txtCardAInfo,
      margin, cfg.ballAColor, cfg.ballAName,
      hpA, cfg.ballAHp,
      cfg.weaponA?.type ?? "???", cfg.weaponA?.baseDamage ?? 0,
      "left",
    );

    drawCard(
      this.cardBGfx, this.txtCardBName, this.txtCardBInfo,
      canvasW - margin - cardW, cfg.ballBColor, cfg.ballBName,
      hpB, cfg.ballBHp,
      cfg.weaponB?.type ?? "???", cfg.weaponB?.baseDamage ?? 0,
      "right",
    );

    // ── Winner overlay ────────────────────────────────────────────────────
    if (cfg.winner) {
      const winnerName = cfg.winner === "A" ? cfg.ballAName : cfg.ballBName;
      const text = `🏆 ${winnerName.toUpperCase()} WINS!`;

      this.txtResult.setFontSize(42);
      this.txtResult.setVisible(true);
      this.txtResult.setText(text);
      this.txtResult.setPosition(canvasW / 2, canvasH * 0.4);

      const bounds = this.txtResult.getBounds();
      const padR = 24;
      this.resultGfx.clear();
      this.resultGfx.setVisible(true);
      this.resultGfx.fillStyle(0x000000, 0.7);
      this.resultGfx.fillRoundedRect(
        bounds.x - padR, bounds.y - padR,
        bounds.width + padR * 2, bounds.height + padR * 2,
        12,
      );
    } else {
      this.resultGfx.clear();
      this.resultGfx.setVisible(false);
      this.txtResult.setVisible(false);
    }
  }

  // ─── Debug hitbox overlay ─────────────────────────────────────────────────

  private renderHitboxOverlay(
    ax: number, ay: number, ballRA: number, angleA: number, wA: WeaponDef | null,  colA: number,
    bx: number, by: number, ballRB: number, angleB: number, wB: WeaponDef | null, colB: number,
  ): void {
    this.hitboxGfx.clear();
    if (!this.cfg.debugHitboxes) return;
    const g = this.hitboxGfx;

    this.drawFighterHitbox(g, ax, ay, ballRA, angleA, wA, colA);
    this.drawFighterHitbox(g, bx, by, ballRB, angleB, wB, colB);
  }

  private drawFighterHitbox(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number, ballR: number,
    angle: number, wDef: WeaponDef | null, color: number,
  ): void {
    // Ball body circle
    g.lineStyle(1.5, color, 0.7);
    g.strokeCircle(cx, cy, ballR);

    if (!wDef) return;

    const rad     = (angle / 65536) * 2 * Math.PI;
    const cosA    = Math.cos(rad);
    const sinA    = Math.sin(rad);
    const reachPx = this.au(wDef.reach);
    const tipX    = cx + cosA * reachPx;
    const tipY    = cy + sinA * reachPx;
    const tipRPx  = this.au(wDef.tipRadius);

    // Shaft deflection zone (ball surface → bladeStart or reach)
    const shaftRPx    = this.au(wDef.shaftRadius ?? 8);
    const bladeStart  = wDef.bladeStart ?? Math.round(wDef.reach * 0.4);
    const shaftEndPx  = wDef.type === "blade" ? this.au(bladeStart) : reachPx;
    const shaftSX     = cx + cosA * ballR;
    const shaftSY     = cy + sinA * ballR;
    const shaftEX     = cx + cosA * shaftEndPx;
    const shaftEY     = cy + sinA * shaftEndPx;

    // Shaft — semi-transparent blue capsule (approximated as thick line)
    g.lineStyle(shaftRPx * 2, 0x64c8ff, 0.12);
    g.lineBetween(shaftSX, shaftSY, shaftEX, shaftEY);
    g.lineStyle(1, 0x64c8ff, 0.35);
    g.lineBetween(shaftSX, shaftSY, shaftEX, shaftEY);

    if (wDef.type === "blade") {
      // Blade capsule — from bladeStart to reach, width = bladeWidth*2
      const bwPx   = this.au(wDef.bladeWidth ?? wDef.tipRadius);
      const bsPx   = this.au(bladeStart);
      const bsSX   = cx + cosA * bsPx;
      const bsSY   = cy + sinA * bsPx;

      g.lineStyle(bwPx * 2, 0xff3d00, 0.18);
      g.lineBetween(bsSX, bsSY, tipX, tipY);
      g.lineStyle(1.5, 0xff3d00, 0.55);
      g.lineBetween(bsSX, bsSY, tipX, tipY);
    }

    // Tip circle (damage zone for point/blunt, visual reference for blade)
    g.lineStyle(1.5, 0xff3d00, 0.6);
    g.fillStyle(0xff3d00, 0.15);
    g.fillCircle(tipX, tipY, tipRPx);
    g.strokeCircle(tipX, tipY, tipRPx);
  }

  // ─── Procedural drawing — HP bars + badges (retained) ────────────────────

  private drawHpBar(
    g: Phaser.GameObjects.Graphics,
    cx: number, barY: number, barW: number, barH: number, frac: number,
  ): void {
    frac = Math.max(0, Math.min(1, frac));
    const barX = cx - barW / 2;
    const rad = 2;
    g.fillStyle(0x0a0f0b, 0.85);
    g.fillRoundedRect(barX, barY, barW, barH, rad);
    const col = frac > 0.5 ? 0x4dff91 : 0xff3d00;
    if (frac > 0) {
      g.fillStyle(col, 1);
      g.fillRoundedRect(barX, barY, barW * frac, barH, rad);
      g.fillStyle(0xffffff, 0.18);
      g.fillRoundedRect(barX, barY, barW * frac, barH * 0.4, rad);
    }
  }

  private buildArenaBackground(): void {
    if (!this.cfg || this.bgBuilt) return;
    this.bgBuilt = true;
    const g = this.bgGfx;
    const { canvasW, canvasH } = this.cfg;

    g.clear();

    // 1. Background — pure black void
    g.fillStyle(0x000000, 1);
    g.fillRect(0, 0, canvasW, canvasH);

    // 2. Hexagonal grid — green-tinted CRT lines
    g.lineStyle(1, 0x0d2a1c, 0.65);
    const size = 28;
    const colW  = size * Math.sqrt(3);
    const rowH  = size * 1.5;
    for (let row = -1; row * rowH < canvasH + rowH; row++) {
      for (let col = -1; col * colW < canvasW + colW; col++) {
        const hx = col * colW + (row % 2 !== 0 ? colW / 2 : 0);
        const hy = row * rowH;
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          return { x: hx + size * Math.cos(a), y: hy + size * Math.sin(a) };
        });
        g.strokePoints(pts, true);
      }
    }

    // 3. Center spotlight glow — subtle green
    g.fillStyle(0x4dff91, 0.02);
    g.fillCircle(canvasW / 2, canvasH / 2, canvasH * 0.42);

    // 4. Double border — brand green
    g.lineStyle(2, 0x1a5530, 0.85);
    g.strokeRect(1, 1, canvasW - 2, canvasH - 2);
    g.lineStyle(1, 0x4dff91, 0.15);
    g.strokeRect(5, 5, canvasW - 10, canvasH - 10);

    // 5. Corner L-brackets — brand green
    g.lineStyle(2, 0x4dff91, 0.7);
    const L = 18;
    [[0, 0], [canvasW, 0], [0, canvasH], [canvasW, canvasH]].forEach(([cx, cy]) => {
      const sx = cx === 0 ? 1 : -1;
      const sy = cy === 0 ? 1 : -1;
      g.lineBetween(cx, cy, cx + sx * L, cy);
      g.lineBetween(cx, cy, cx, cy + sy * L);
    });
  }

  private drawNameBadge(
    g: Phaser.GameObjects.Graphics,
    cx: number, topY: number,
    _label: string,
    color: number,
  ): void {
    const charW = 6;
    const maxChars = 10;
    const len = Math.min(_label.length, maxChars);
    const padX = 5, padY = 2;
    const w = len * charW + padX * 2;
    const h = 12 + padY * 2;
    g.fillStyle(color, 0.28);
    g.fillRoundedRect(cx - w / 2, topY - h, w, h, 4);
  }

  private clearDynamic(): void {
    this.wpnAImg?.setVisible(false);   this.wpnBImg?.setVisible(false);
    this.ballAImg?.setVisible(false);  this.ballBImg?.setVisible(false);
    this.flashGfx?.clear();
    this.hpBarGfx?.clear();
    this.badgeGfx?.clear();
    this.hitboxGfx?.clear();
    this.txtA?.setText("");            this.txtB?.setText("");
    this.txtEvent?.setVisible(false);
    this.txtTick?.setText("");
  }

  // ─── Scale helpers ────────────────────────────────────────────────────────

  private updateScales(): void {
    if (!this.cfg) return;
    this.scaleX = this.cfg.canvasW / (this.cfg.arenaW ?? ARENA_W);
    this.scaleY = this.cfg.canvasH / (this.cfg.arenaH ?? ARENA_H);
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

/**
 * Select sprite texture key from WeaponDef.
 * Blade default = shortsword. Add `name` field to WeaponDef to distinguish katana.
 */
function weaponTextureKey(wDef: WeaponDef): string {
  if (wDef.type === "blunt") return "mace";
  if (wDef.type === "point") return "spear";
  // blade — check for optional name field (future: server passes weapon name)
  const name = (wDef as WeaponDef & { name?: string }).name?.toLowerCase() ?? "";
  if (name.includes("katana")) return "katana";
  return "shortsword";
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 32768)  d -= 65536;
  if (d < -32768) d += 65536;
  return a + d * t;
}
