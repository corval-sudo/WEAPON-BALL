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

// Flail chain pendulum constants.
// GRAVITY:     downward acceleration in screen-pixels per second².
// DAMPING:     velocity multiplier per normalized 16.67ms step (air resistance).
// HANDLE_FRAC: rigid handle length as fraction of total reach.
//              The chain hangs from the handle tip, not the ball center.
//
// No ANCHOR_DRAG — the hard length constraint is the only coupling between the
// handle tip and the chain head.  When the handle moves, the chain goes taut
// and pulls the head via tension.  The head's own momentum (inertia) causes it
// to overshoot and swing freely, which is how a real flail works.
const CHAIN_GRAVITY  = 160;   // px/s² — keeps chain taut; stronger than before
const CHAIN_DAMPING  = 0.978; // more air resistance so head doesn't swing forever
const HANDLE_FRAC    = 0.38;  // 38% of reach is rigid handle

// Impact recoil — attacker bounces backwards on landing a hit.
const RECOIL_KICK  = 13;   // px instant positional offset applied each hit
const RECOIL_MAX   = 22;   // px cap on accumulated offset (prevents combo stacking)
const RECOIL_DECAY = 0.74; // fraction retained per normalized 60fps frame (~300ms half-life)

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

/** Simulated flail chain endpoint state (screen-space pixels). */
interface ChainState {
  x: number; y: number;      // chain head position
  vx: number; vy: number;    // chain head velocity
  prevAnchorX: number;       // handle-tip position last frame
  prevAnchorY: number;
  initialized: boolean;
}

/** Visual recoil offset applied to a ball's drawn position after it lands a hit. */
interface RecoilState { x: number; y: number; }

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

  // Flail chain visual state — only used when weapon type is "blunt"
  private chainA: ChainState = { x: 0, y: 0, vx: 0, vy: 0, prevAnchorX: 0, prevAnchorY: 0, initialized: false };
  private chainB: ChainState = { x: 0, y: 0, vx: 0, vy: 0, prevAnchorX: 0, prevAnchorY: 0, initialized: false };

  // Impact recoil visual offsets
  private recoilA: RecoilState = { x: 0, y: 0 };
  private recoilB: RecoilState = { x: 0, y: 0 };

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

    // ── Impact recoil ────────────────────────────────────────────────────────
    // When a ball's weapon lands a hit, push it backwards (away from opponent).
    // "A hits B" → ball A is attacker → A recoils away from B, and vice versa.
    const rcDtNorm = Math.min(delta, 50) / 16.667;
    const rcDamp   = Math.pow(RECOIL_DECAY, rcDtNorm);
    const aHitsB   = frame.events.some(ev => ev.includes("A hits B"));
    const bHitsA   = frame.events.some(ev => ev.includes("B hits A"));

    if (aHitsB) {
      const ddx = ax - bx, ddy = ay - by, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      this.recoilA.x = Math.max(-RECOIL_MAX, Math.min(RECOIL_MAX, this.recoilA.x + (ddx / dd) * RECOIL_KICK));
      this.recoilA.y = Math.max(-RECOIL_MAX, Math.min(RECOIL_MAX, this.recoilA.y + (ddy / dd) * RECOIL_KICK));
    }
    if (bHitsA) {
      const ddx = bx - ax, ddy = by - ay, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      this.recoilB.x = Math.max(-RECOIL_MAX, Math.min(RECOIL_MAX, this.recoilB.x + (ddx / dd) * RECOIL_KICK));
      this.recoilB.y = Math.max(-RECOIL_MAX, Math.min(RECOIL_MAX, this.recoilB.y + (ddy / dd) * RECOIL_KICK));
    }
    this.recoilA.x *= rcDamp; this.recoilA.y *= rcDamp;
    this.recoilB.x *= rcDamp; this.recoilB.y *= rcDamp;

    // Visual positions = physics + recoil offset.
    // Used for all rendering; chain physics also uses these so the weapon
    // visually stays attached to the ball during the recoil nudge.
    const vax = ax + this.recoilA.x, vay = ay + this.recoilA.y;
    const vbx = bx + this.recoilB.x, vby = by + this.recoilB.y;

    // ── Flail chain physics ───────────────────────────────────────────────────
    const chainTipA = this.computeChainTip(this.chainA, vax, vay, angleA, cfg.weaponA, delta);
    const chainTipB = this.computeChainTip(this.chainB, vbx, vby, angleB, cfg.weaponB, delta);

    // ── Weapons ──────────────────────────────────────────────────────────────
    this.wpnAGfx.clear();
    this.wpnBGfx.clear();
    this.drawWeapon(this.wpnAGfx, vax, vay, angleA, cfg.ballAColor, ballRA, cfg.weaponA, chainTipA);
    this.drawWeapon(this.wpnBGfx, vbx, vby, angleB, cfg.ballBColor, ballRB, cfg.weaponB, chainTipB);

    // ── Ball bodies ──────────────────────────────────────────────────────────
    this.ballAGfx.clear();
    this.ballBGfx.clear();
    this.drawBall(this.ballAGfx, vax, vay, ballRA, cfg.ballAColor, frame.a.hp / cfg.ballAHp);
    this.drawBall(this.ballBGfx, vbx, vby, ballRB, cfg.ballBColor, frame.b.hp / cfg.ballBHp);

    // ── HP bars ──────────────────────────────────────────────────────────────
    this.hpBarGfx.clear();
    this.drawHpBar(this.hpBarGfx, vax, vay - ballRA - 10, ballRA * 2.5, 4, frame.a.hp / cfg.ballAHp);
    this.drawHpBar(this.hpBarGfx, vbx, vby - ballRB - 10, ballRB * 2.5, 4, frame.b.hp / cfg.ballBHp);

    // ── Name labels ──────────────────────────────────────────────────────────
    const truncA = cfg.ballAName.length > 10 ? cfg.ballAName.slice(0, 10) + "…" : cfg.ballAName;
    const truncB = cfg.ballBName.length > 10 ? cfg.ballBName.slice(0, 10) + "…" : cfg.ballBName;
    this.txtA.setText(truncA).setPosition(vax, vay - ballRA - 14);
    this.txtB.setText(truncB).setPosition(vbx, vby - ballRB - 14);

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
      if (ringA) this.flashGfx.strokeCircle(vax, vay, ballRA + flashExtra);
      if (ringB) this.flashGfx.strokeCircle(vbx, vby, ballRB + flashExtra);
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

  // ─── Flail chain physics ────────────────────────────────────────────────────

  /**
   * For blunt weapons: simulate the chain head as a free pendulum bob hanging
   * from the rigid handle tip.
   *
   * Physics:
   *   1. Gravity pulls the head downward every frame.
   *   2. Light air resistance bleeds energy slowly.
   *   3. The head integrates freely (pure inertia) — no spring, no anchor drag.
   *   4. Hard inelastic length constraint: when dist > chainMax from handle tip,
   *      the head is projected back and its outward radial velocity is cancelled.
   *
   * Why no anchor drag:
   *   Injecting handle-tip velocity into the chain head creates forced in-phase
   *   oscillation (head mirrors the anchor → looks like a stiff pendulum).
   *   Instead, the inextensible constraint is the only coupling — when the
   *   handle tip moves away from the head, the chain goes taut and the head
   *   gets pulled tangentially, exactly like a real flail or ball-on-a-string.
   */
  private computeChainTip(
    chain: ChainState,
    cx: number, cy: number,
    angle: number,
    wDef: WeaponDef | null | undefined,
    delta: number,
  ): { x: number; y: number } | null {
    if (!wDef || wDef.type !== "blunt") return null;

    const reachPx   = this.arenaToScreen(wDef.reach);
    const handleLen = reachPx * HANDLE_FRAC;
    const chainMax  = reachPx - handleLen;
    const rad       = (angle / 65536) * 2 * Math.PI;

    // Handle tip — rigid, orbits with the weapon angle.
    const hx = cx + Math.cos(rad) * handleLen;
    const hy = cy + Math.sin(rad) * handleLen;

    // Physics tip (hitbox is always here, regardless of visual chain position).
    const physTipX = cx + Math.cos(rad) * reachPx;
    const physTipY = cy + Math.sin(rad) * reachPx;

    // Snap on first frame or if the ball teleported (new match).
    if (!chain.initialized) {
      chain.x = physTipX; chain.y = physTipY;
      chain.vx = 0;       chain.vy = 0;
      chain.prevAnchorX = hx; chain.prevAnchorY = hy;
      chain.initialized = true;
      return { x: chain.x, y: chain.y };
    }
    const snapDx = chain.x - hx;
    const snapDy = chain.y - hy;
    if (snapDx * snapDx + snapDy * snapDy > (reachPx * 2.5) ** 2) {
      chain.x = physTipX; chain.y = physTipY;
      chain.vx = 0;       chain.vy = 0;
      chain.prevAnchorX = hx; chain.prevAnchorY = hy;
      return { x: chain.x, y: chain.y };
    }

    const dtMs   = Math.min(delta, 50);
    const dt     = dtMs / 1000;        // seconds
    const dtNorm = dtMs / 16.667;      // normalized to 60 fps

    // ── Gravity (downward = +Y in screen space) ────────────────────────────
    chain.vy += CHAIN_GRAVITY * dt;

    // ── Air resistance ─────────────────────────────────────────────────────
    const dampFactor = Math.pow(CHAIN_DAMPING, dtNorm);
    chain.vx *= dampFactor;
    chain.vy *= dampFactor;

    // ── Free integration (no spring, no drag toward anchor) ───────────────
    chain.x += chain.vx * dt;
    chain.y += chain.vy * dt;

    // ── Hard inelastic length constraint from handle tip ───────────────────
    // When the chain is taut, only outward radial velocity is cancelled.
    // Tangential velocity is preserved — the head continues to swing along
    // the arc, which creates the natural flail/whip motion.
    const dx   = chain.x - hx;
    const dy   = chain.y - hy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > chainMax) {
      const inv = chainMax / dist;
      chain.x   = hx + dx * inv;
      chain.y   = hy + dy * inv;
      const rx  = dx / dist;
      const ry  = dy / dist;
      const radVel = chain.vx * rx + chain.vy * ry;
      if (radVel > 0) {
        chain.vx -= radVel * rx;
        chain.vy -= radVel * ry;
      }
    }

    chain.prevAnchorX = hx;
    chain.prevAnchorY = hy;

    return { x: chain.x, y: chain.y };
  }

  // ─── Drawing helpers ───────────────────────────────────────────────────────

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

  private clearGameObjects(): void {
    this.chainA.initialized = false;
    this.chainB.initialized = false;
    this.recoilA.x = 0; this.recoilA.y = 0;
    this.recoilB.x = 0; this.recoilB.y = 0;
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

    if (frac > 0.5) {
      g.fillStyle(color, 0.15 * frac);
      g.fillCircle(cx, cy, r + 8);
    }

    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, r);

    g.fillStyle(0x000000, 0.4);
    g.fillCircle(cx, cy, r * 0.5);
  }

  private drawHpBar(
    g: Phaser.GameObjects.Graphics,
    cx: number, barTopY: number,
    barW: number, barH: number,
    hpFrac: number,
  ): void {
    const frac  = Math.max(0, Math.min(1, hpFrac));
    const barX  = cx - barW / 2;
    g.fillStyle(0x222222, 1);
    g.fillRect(barX, barTopY, barW, barH);
    const fillColor = frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xff9800 : 0xf44336;
    g.fillStyle(fillColor, 1);
    g.fillRect(barX, barTopY, barW * frac, barH);
  }

  /**
   * Render a weapon.
   *
   * For blunt weapons a pre-computed `chainTip` is supplied — the visual chain
   * endpoint driven by spring/damper physics.  The mace head and chain are
   * drawn at that position while the dashed hitbox circle remains at the true
   * physics tip so it always matches the collision model.
   */
  private drawWeapon(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    angle: number,
    color: number,
    ballRpx: number,
    wDef: WeaponDef | null | undefined,
    chainTip: { x: number; y: number } | null = null,
  ): void {
    const rad   = (angle / 65536) * 2 * Math.PI;
    const cosA  = Math.cos(rad);
    const sinA  = Math.sin(rad);
    const perpX = -sinA;
    const perpY =  cosA;

    if (!wDef) {
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

    const reachPx = this.arenaToScreen(wDef.reach);
    const tipRPx  = Math.max(2, this.arenaToScreen(wDef.tipRadius));
    // Physics tip — always used for the hitbox circle.
    const tipX    = cx + cosA * reachPx;
    const tipY    = cy + sinA * reachPx;
    const surfX   = cx + cosA * ballRpx;
    const surfY   = cy + sinA * ballRpx;

    if (wDef.type === "blade") {
      // ── Sword / Katana ───────────────────────────────────────────────────
      const bladeStart = wDef.bladeStart ?? wDef.reach * 0.35;
      const bladeWidth = wDef.bladeWidth ?? wDef.tipRadius;
      const bsStartPx  = this.arenaToScreen(bladeStart);
      const bsX = cx + cosA * bsStartPx;
      const bsY = cy + sinA * bsStartPx;
      const bwPx = Math.max(1.5, this.arenaToScreen(bladeWidth));

      // Handle
      if (bsStartPx > ballRpx) {
        this.drawThickLine(g, surfX, surfY, bsX, bsY, bwPx * 1.4, color, 0.85);
      }

      // Crossguard
      const guardLen = Math.max(5, bwPx * 3.2);
      g.lineStyle(Math.max(1.5, bwPx * 0.9), color, 0.95);
      g.lineBetween(
        bsX + perpX * guardLen, bsY + perpY * guardLen,
        bsX - perpX * guardLen, bsY - perpY * guardLen,
      );

      // Tapered blade
      const baseW = Math.max(2.5, bwPx * 2.0);
      g.fillStyle(color, 0.93);
      g.fillTriangle(
        bsX + perpX * baseW, bsY + perpY * baseW,
        bsX - perpX * baseW, bsY - perpY * baseW,
        tipX, tipY,
      );

      // Edge highlight
      g.lineStyle(1, 0xffffff, 0.55);
      g.lineBetween(bsX + perpX * baseW, bsY + perpY * baseW, tipX, tipY);

    } else if (wDef.type === "blunt") {
      // ── Mace / Flail ─────────────────────────────────────────────────────
      // Visual head follows the lagging chain tip; hitbox stays at physics tip.
      const headX = chainTip?.x ?? tipX;
      const headY = chainTip?.y ?? tipY;

      // Rigid handle — tapered shaft from ball surface along the physics angle.
      const handleLen = reachPx * HANDLE_FRAC;
      const hx = cx + cosA * handleLen;
      const hy = cy + sinA * handleLen;
      const shaftR = Math.max(2, this.arenaToScreen(wDef.shaftRadius ?? 5));

      // Tapered trapezoid: wider at grip (ball end), narrower at chain end.
      const wBase = shaftR * 1.5;
      const wTip  = shaftR * 0.75;
      g.fillStyle(color, 0.92);
      g.fillTriangle(
        surfX + perpX * wBase, surfY + perpY * wBase,
        surfX - perpX * wBase, surfY - perpY * wBase,
        hx    + perpX * wTip,  hy    + perpY * wTip,
      );
      g.fillTriangle(
        surfX - perpX * wBase, surfY - perpY * wBase,
        hx    + perpX * wTip,  hy    + perpY * wTip,
        hx    - perpX * wTip,  hy    - perpY * wTip,
      );

      // Small ring at the chain attachment point.
      g.lineStyle(Math.max(1, shaftR * 0.7), color, 1);
      g.strokeCircle(hx, hy, shaftR * 0.95);

      // Curved chain from handle tip to visual head
      this.drawFlailChain(g, hx, hy, headX, headY, color);

      // Spikes: 6 triangular teeth radiating from the head center
      const numSpikes = 6;
      const innerR    = tipRPx;
      const outerR    = tipRPx * 1.65;
      // Use a fixed base angle (not linked to weapon angle) so spikes don't
      // "counter-rotate" as the chain swings — looks more natural.
      const spikeBaseAngle = Math.atan2(headY - cy, headX - cx);
      g.fillStyle(color, 0.88);
      for (let i = 0; i < numSpikes; i++) {
        const a1 = spikeBaseAngle + (i / numSpikes) * 2 * Math.PI;
        const a2 = spikeBaseAngle + ((i + 0.5) / numSpikes) * 2 * Math.PI;
        const a3 = spikeBaseAngle + ((i + 1) / numSpikes) * 2 * Math.PI;
        const midR = innerR * 1.12;
        g.fillTriangle(
          headX + Math.cos(a1) * midR,   headY + Math.sin(a1) * midR,
          headX + Math.cos(a2) * outerR, headY + Math.sin(a2) * outerR,
          headX + Math.cos(a3) * midR,   headY + Math.sin(a3) * midR,
        );
      }

      // Core ball
      g.fillStyle(color, 1);
      g.fillCircle(headX, headY, innerR);

      // Specular shine
      const shineDx = -Math.cos(spikeBaseAngle);
      const shineDy = -Math.sin(spikeBaseAngle);
      g.fillStyle(0xffffff, 0.28);
      g.fillCircle(
        headX + shineDx * tipRPx * 0.32,
        headY + shineDy * tipRPx * 0.32,
        tipRPx * 0.38,
      );

    } else {
      // ── Spear ─────────────────────────────────────────────────────────────
      const arrowBasePx = reachPx * 0.76;
      const abX = cx + cosA * arrowBasePx;
      const abY = cy + sinA * arrowBasePx;

      g.lineStyle(2.5, color, 1);
      g.lineBetween(surfX, surfY, abX, abY);

      // Diamond arrowhead
      const dLen = Math.max(6, tipRPx * 3.6);
      const dWid = Math.max(3, tipRPx * 1.6);
      const midX = tipX - cosA * (dLen * 0.45);
      const midY = tipY - sinA * (dLen * 0.45);
      const bakX = tipX - cosA * dLen;
      const bakY = tipY - sinA * dLen;

      g.fillStyle(color, 1);
      g.fillTriangle(tipX, tipY, midX + perpX * dWid, midY + perpY * dWid, midX - perpX * dWid, midY - perpY * dWid);
      g.fillTriangle(bakX, bakY, midX + perpX * dWid, midY + perpY * dWid, midX - perpX * dWid, midY - perpY * dWid);

      g.lineStyle(1, 0xffffff, 0.5);
      g.lineBetween(midX + perpX * dWid, midY + perpY * dWid, tipX, tipY);
    }

    // Dashed hitbox circle — blunt weapons track the visual chain head;
    // all other types show the physics tip.
    const hbX = (wDef.type === "blunt" && chainTip) ? chainTip.x : tipX;
    const hbY = (wDef.type === "blunt" && chainTip) ? chainTip.y : tipY;
    this.drawDashedCircle(g, hbX, hbY, tipRPx, color, 0.3);
  }

  /**
   * Draw a curved chain from the ball surface to the visual mace head.
   * Uses a quadratic Bézier with a small perpendicular sag to give the chain
   * a realistic droop/swing feel.  Small link dots are placed along the curve.
   */
  private drawFlailChain(
    g: Phaser.GameObjects.Graphics,
    x0: number, y0: number,
    x1: number, y1: number,
    color: number,
  ): void {
    const dx  = x1 - x0;
    const dy  = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return;

    // Gravity droop: Bézier midpoint pulled downward (screen +Y).
    // This makes the chain look like it sags under its own weight.
    const sag = len * 0.16;
    const cpX = (x0 + x1) * 0.5;
    const cpY = (y0 + y1) * 0.5 + sag;

    // Draw chain line as 12 sampled segments
    const SEG = 12;
    g.lineStyle(2.2, color, 0.88);
    let px = x0, py = y0;
    for (let i = 1; i <= SEG; i++) {
      const t  = i / SEG;
      const mt = 1 - t;
      const qx = mt * mt * x0 + 2 * mt * t * cpX + t * t * x1;
      const qy = mt * mt * y0 + 2 * mt * t * cpY + t * t * y1;
      g.lineBetween(px, py, qx, qy);
      px = qx; py = qy;
    }

    // Chain link dots evenly spaced along the curve
    const linkCount = Math.max(2, Math.min(10, Math.floor(len / 9)));
    g.fillStyle(color, 0.65);
    for (let i = 1; i < linkCount; i++) {
      const t  = i / linkCount;
      const mt = 1 - t;
      const lx = mt * mt * x0 + 2 * mt * t * cpX + t * t * x1;
      const ly = mt * mt * y0 + 2 * mt * t * cpY + t * t * y1;
      g.fillCircle(lx, ly, 2);
    }
  }

  /**
   * Draw a thick line by filling a rotated rectangle (two triangles).
   */
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

    const p1x = x1 + nx * halfW; const p1y = y1 + ny * halfW;
    const p2x = x1 - nx * halfW; const p2y = y1 - ny * halfW;
    const p3x = x2 - nx * halfW; const p3y = y2 - ny * halfW;
    const p4x = x2 + nx * halfW; const p4y = y2 + ny * halfW;

    g.fillStyle(color, alpha);
    g.fillTriangle(p1x, p1y, p2x, p2y, p3x, p3y);
    g.fillTriangle(p1x, p1y, p3x, p3y, p4x, p4y);
  }

  /**
   * Approximate dashed circle with 12 short line segments.
   */
  private drawDashedCircle(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    r: number,
    color: number,
    alpha: number,
  ): void {
    const segments = 12;
    const gap      = 0.4;
    const step     = (2 * Math.PI) / segments;

    g.lineStyle(1, color, alpha);
    for (let i = 0; i < segments; i++) {
      const startAngle = i * step;
      const endAngle   = startAngle + step - gap;
      if (endAngle <= startAngle) continue;
      g.lineBetween(
        cx + Math.cos(startAngle) * r, cy + Math.sin(startAngle) * r,
        cx + Math.cos(endAngle)   * r, cy + Math.sin(endAngle)   * r,
      );
    }
  }

  // ─── Scale helpers ─────────────────────────────────────────────────────────

  private updateScales(): void {
    if (!this.cfg) return;
    this.scaleX = this.cfg.canvasW / ARENA_W;
    this.scaleY = this.cfg.canvasH / ARENA_H;
  }

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

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 32768)  d -= 65536;
  if (d < -32768) d += 65536;
  return a + d * t;
}
