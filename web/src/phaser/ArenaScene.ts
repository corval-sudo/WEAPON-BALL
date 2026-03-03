// web/src/phaser/ArenaScene.ts
// Phaser 3 Scene — live arena match renderer.
//
// Rendering strategy:
//   • All shapes drawn via Phaser.GameObjects.Graphics (pure procedural, no texture deps).
//   • drawBall()   — layered circles: glow ring + gradient body + specular highlight
//   • drawWeapon() — procedural blade/spear/mace in fighter color
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

const REPLAY_FPS = 30;

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
  /** When true, renders recording-only overlays (side cards + winner banner). */
  recordingMode?: boolean;
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

  // Graphics layers (always present, never crash)
  private bgGfx!:    Phaser.GameObjects.Graphics;
  private wpnAGfx!:  Phaser.GameObjects.Graphics;
  private wpnBGfx!:  Phaser.GameObjects.Graphics;
  private ballAGfx!: Phaser.GameObjects.Graphics;
  private ballBGfx!: Phaser.GameObjects.Graphics;
  private flashGfx!: Phaser.GameObjects.Graphics;
  private hpBarGfx!: Phaser.GameObjects.Graphics;
  private badgeGfx!: Phaser.GameObjects.Graphics;

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
  private txtCardAInfo!: Phaser.GameObjects.Text;   // multiline: record + HP + weapon
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
    this.badgeGfx = this.add.graphics();

    this.buildArenaBackground();

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

    // ── Recording overlays (side cards + winner banner) ─────────────────
    // Created last + depth-sorted so they always render on top of all arena content.
    this.cardAGfx = this.add.graphics().setDepth(100);
    this.cardBGfx = this.add.graphics().setDepth(100);
    this.txtCardAName = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "60px", fontStyle: "bold",
    }).setOrigin(0, 0).setDepth(101);
    this.txtCardBName = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "60px", fontStyle: "bold",
    }).setOrigin(0, 0).setDepth(101);
    this.txtCardAInfo = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "48px", color: "#cccccc", lineSpacing: 16,
    }).setOrigin(0, 0).setDepth(101);
    this.txtCardBInfo = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "48px", color: "#cccccc", lineSpacing: 16,
    }).setOrigin(0, 0).setDepth(101);
    this.resultGfx = this.add.graphics().setDepth(200);
    this.txtResult = this.add.text(canvasW / 2, canvasH * 0.4, "", {
      fontFamily: "monospace", fontSize: "32px", fontStyle: "bold", color: "#ffd700",
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

    // ── Weapons ────────────────────────────────────────────────────────────
    this.wpnAGfx.clear();
    this.drawWeapon(this.wpnAGfx, ax, ay, angleA, cfg.ballAColor, ballRA, cfg.weaponA);
    this.wpnBGfx.clear();
    this.drawWeapon(this.wpnBGfx, bx, by, angleB, cfg.ballBColor, ballRB, cfg.weaponB);

    // ── Balls ──────────────────────────────────────────────────────────────
    this.ballAGfx.clear();
    this.ballBGfx.clear();
    this.drawBall(this.ballAGfx, ax, ay, ballRA, cfg.ballAColor, frame.a.hp / cfg.ballAHp, cfg.weaponA?.type);
    this.drawBall(this.ballBGfx, bx, by, ballRB, cfg.ballBColor, frame.b.hp / cfg.ballBHp, cfg.weaponB?.type);

    // ── HP bars ────────────────────────────────────────────────────────────
    this.hpBarGfx.clear();
    this.drawHpBar(this.hpBarGfx, ax, ay - ballRA - 10, ballRA * 2.5, 4, frame.a.hp / cfg.ballAHp);
    this.drawHpBar(this.hpBarGfx, bx, by - ballRB - 10, ballRB * 2.5, 4, frame.b.hp / cfg.ballBHp);

    // ── Name labels + badges (hidden in recording mode — side cards show names) ──
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

    // ── Recording overlays ───────────────────────────────────────────────
    this.renderRecordingOverlays();
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
    const pad     = 24;      // inner padding
    const accent  = 6;       // colored border width
    const corner  = 14;      // rounded corner radius

    // Live HP (fall back to max HP if no frame yet)
    const hpA = this.currentFrame?.a.hp ?? cfg.ballAHp;
    const hpB = this.currentFrame?.b.hp ?? cfg.ballBHp;

    // ── Draw card helper ──────────────────────────────────────────────
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

      // Background
      gfx.clear();
      gfx.setVisible(true);
      gfx.fillStyle(0x000000, 0.6);
      gfx.fillRoundedRect(x, margin, cardW, cardH, corner);

      // Colored accent border on the inner edge
      gfx.fillStyle(color, 1);
      if (side === "left") {
        gfx.fillRect(x, margin + corner, accent, cardH - corner * 2);
      } else {
        gfx.fillRect(x + cardW - accent, margin + corner, accent, cardH - corner * 2);
      }

      // Separator line under name
      const sepY = margin + 80;
      gfx.lineStyle(1, 0x444466, 0.6);
      gfx.lineBetween(x + pad, sepY, x + cardW - pad, sepY);

      // Name (bold, fighter color)
      const textX = x + pad + (side === "left" ? accent + 2 : 0);
      txtName.setVisible(true);
      txtName.setText(name.toUpperCase());
      txtName.setColor(hex);
      txtName.setPosition(textX, margin + 12);

      // Stats (multiline: HP + weapon only)
      txtInfo.setVisible(true);
      txtInfo.setText(
        `HP: ${Math.round(hp)} / ${maxHp}\n` +
        `${wpnType} · DMG ${wpnDmg}`,
      );
      txtInfo.setPosition(textX, sepY + 10);
    };

    // ── Left card (Fighter A) ─────────────────────────────────────────
    drawCard(
      this.cardAGfx, this.txtCardAName, this.txtCardAInfo,
      margin, cfg.ballAColor, cfg.ballAName,
      hpA, cfg.ballAHp,
      cfg.weaponA?.type ?? "???", cfg.weaponA?.baseDamage ?? 0,
      "left",
    );

    // ── Right card (Fighter B) ────────────────────────────────────────
    drawCard(
      this.cardBGfx, this.txtCardBName, this.txtCardBInfo,
      canvasW - margin - cardW, cfg.ballBColor, cfg.ballBName,
      hpB, cfg.ballBHp,
      cfg.weaponB?.type ?? "???", cfg.weaponB?.baseDamage ?? 0,
      "right",
    );

    // ── Winner overlay ─────────────────────────────────────────────────
    if (cfg.winner) {
      const winnerName = cfg.winner === "A" ? cfg.ballAName : cfg.ballBName;
      const text = `🏆 ${winnerName.toUpperCase()} WINS!`;

      this.txtResult.setFontSize(42);
      this.txtResult.setVisible(true);
      this.txtResult.setText(text);
      this.txtResult.setPosition(canvasW / 2, canvasH * 0.4);

      // Dark rounded backdrop behind the text
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

  // ─── Procedural drawing ───────────────────────────────────────────────────

  private drawBall(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number, color: number, hpFrac: number,
    weaponType?: string,
  ): void {
    const frac = Math.max(0, hpFrac);

    // 1. Archetype glow ring (weapon-type based)
    if (weaponType === "blunt") {
      g.fillStyle(0xff8800, 0.09 * Math.max(frac, 0.2));
      g.fillCircle(cx, cy, r + 10);
      g.lineStyle(3, 0xff8800, 0.5);
      g.strokeCircle(cx, cy, r + 2);
    } else if (weaponType === "point") {
      g.fillStyle(0x44aaff, 0.07 * Math.max(frac, 0.2));
      g.fillCircle(cx, cy, r + 9);
      g.lineStyle(1.5, 0x44aaff, 0.45);
      g.strokeCircle(cx, cy, r + 1);
    } else {
      // blade — thin bright ring
      g.lineStyle(1.5, 0xffffff, 0.3);
      g.strokeCircle(cx, cy, r + 2);
    }

    // 2. Ball body — layered circles for gradient feel
    const bright = shiftColor(color, 70);
    g.fillStyle(bright, 0.9);
    g.fillCircle(cx - r * 0.18, cy - r * 0.22, r * 0.75);
    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, r);
    g.fillStyle(0x000000, 0.32);
    g.fillCircle(cx + r * 0.14, cy + r * 0.18, r * 0.52);

    // 3. Specular highlight
    g.fillStyle(0xffffff, 0.32);
    g.fillCircle(cx - r * 0.28, cy - r * 0.3, r * 0.18);

    // 4. Damage state ring (hpFrac < 0.35)
    if (frac < 0.35) {
      g.lineStyle(2, 0xff2222, 0.55 * (1 - frac));
      g.strokeCircle(cx, cy, r + 1);
    }
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
    const rad = 2;
    // Background pill
    g.fillStyle(0x111111, 0.85);
    g.fillRoundedRect(barX, barY, barW, barH, rad);
    // Filled portion
    const col = frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xff9800 : 0xf44336;
    if (frac > 0) {
      g.fillStyle(col, 1);
      g.fillRoundedRect(barX, barY, barW * frac, barH, rad);
      // Shine strip at top of fill
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

    // 1. Background — dark navy top, dark purple bottom
    g.fillStyle(0x050510, 1);
    g.fillRect(0, 0, canvasW, Math.ceil(canvasH * 0.5));
    g.fillStyle(0x0a0518, 1);
    g.fillRect(0, Math.floor(canvasH * 0.5), canvasW, Math.ceil(canvasH * 0.5) + 1);

    // 2. Hexagonal grid
    g.lineStyle(1, 0x111133, 0.65);
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

    // 3. Center spotlight glow
    g.fillStyle(0x2040ff, 0.035);
    g.fillCircle(canvasW / 2, canvasH / 2, canvasH * 0.42);

    // 4. Double border
    g.lineStyle(2, 0x2233aa, 0.85);
    g.strokeRect(1, 1, canvasW - 2, canvasH - 2);
    g.lineStyle(1, 0x5566cc, 0.28);
    g.strokeRect(5, 5, canvasW - 10, canvasH - 10);

    // 5. Corner L-brackets
    g.lineStyle(2, 0x4455cc, 1);
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
    // Approximate text width at 10px monospace (~6px per char)
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
    this.wpnAGfx?.clear();     this.wpnBGfx?.clear();
    this.ballAGfx?.clear();    this.ballBGfx?.clear();
    this.flashGfx?.clear();    this.hpBarGfx?.clear();
    this.badgeGfx?.clear();
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

/** Shift each RGB channel of a packed hex color by `delta` (0–255). */
function shiftColor(hex: number, delta: number): number {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 0xff) + delta));
  const g = Math.min(255, Math.max(0, ((hex >>  8) & 0xff) + delta));
  const b = Math.min(255, Math.max(0, ( hex        & 0xff) + delta));
  return (r << 16) | (g << 8) | b;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 32768)  d -= 65536;
  if (d < -32768) d += 65536;
  return a + d * t;
}
