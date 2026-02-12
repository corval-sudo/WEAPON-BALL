// src/simCore.ts
export type Vec = { x: number; y: number };

export type WeaponType = "blade" | "point" | "blunt";

export type WeaponDef = {
  type?: WeaponType;   // defaults to "point" if omitted (backward compat)
  reach: number;
  tipRadius: number;
  omega: number;       // angle units per tick (0..65535 wraps full circle)
  baseDamage: number;
  ramp: number;        // damage ramps per hit (never resets during match)
  speedMult: number;   // 1000 = 1.0x
  weight: number;      // 1000ths. 1000 = normal, 1500 = heavy, 700 = light
  bladeStart?: number;   // where blade damage zone begins (blade only, defaults to reach*0.4)
  bladeWidth?: number;   // capsule half-width for blade (defaults to tipRadius)
  shaftRadius?: number;  // deflection hitbox radius for the arm (defaults to 8)
};

export type BallSpec = {
  id: "A" | "B";
  hp: number;
  radius: number;
  pos: Vec;
  vel: Vec;
  weaponId: string;
  restitution?: number; // 1000ths
};

export type MatchSpec = {
  seed: number;
  weaponSetVersion?: string;
  sim: { scale: number; maxTicks: number };
  arena: { w: number; h: number; wallRestitution: number }; // 1000ths
  weapons: Record<string, WeaponDef>;
  ballA: BallSpec;
  ballB: BallSpec;
};

export type Event =
  | { t: number; e: "wall"; id: "A" | "B"; side: "L" | "R" | "T" | "B" }
  | { t: number; e: "collide"; a: "A" | "B"; b: "A" | "B" }
  | { t: number; e: "hit"; from: "A" | "B"; to: "A" | "B"; dmg: number }
  | { t: number; e: "dead"; id: "A" | "B" }
  | { t: number; e: "timeout"; winner: "A" | "B" };

export type BallState = {
  id: "A" | "B";
  hp: number;
  r: number; // scaled
  pos: Vec;  // scaled
  vel: Vec;  // scaled per tick
  theta: number; // 0..65535
  omega: number;
  weaponReach: number; // scaled
  tipR: number;        // scaled
  tipCooldown: number;
  baseDamage: number;
  ramp: number;
  hitCount: number; // never resets
  alive: boolean;
  speedMult: number; // 1000ths
  damageDealt: number;
  restitution: number; // 1000ths
  weaponWeight: number; // 1000ths
  weaponType: WeaponType;
  bladeStart: number;  // scaled
  bladeWidth: number;  // scaled
  shaftRadius: number; // scaled
};

export type SimState = {
  spec: MatchSpec;
  SCALE: number;
  arenaW: number; // scaled
  arenaH: number; // scaled
  wallRest: number; // 1000ths
  tick: number;
  A: BallState;
  B: BallState;
  events: Event[];
  rng: () => number;
  done: boolean;
  winner?: "A" | "B";
};

// ---------- Deterministic PRNG ----------
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Trig lookup ----------
export const ANGLE_FULL = 65536;
export const TRIG_SCALE = 1_000_000;

const COS = new Int32Array(ANGLE_FULL);
const SIN = new Int32Array(ANGLE_FULL);

//other constants for some reason
// --- Collision tuning (all deterministic) ---
const TIP_BOUNCE_BOOST = 1.12;       // tip-tip bounce multiplies impulse a bit
const TIP_HIT_KNOCKBACK = 600;       // pixels-per-tick-ish in *scaled* units (we'll scale it)
const BALL_COLLIDE_DAMP = 0.94;      // ball-ball collision loses a bit of speed
const TIP_COLLIDE_COOLDOWN_TICKS = 2; // prevents repeated tip-tip collisions every tick


for (let a = 0; a < ANGLE_FULL; a++) {
  const rad = (a / ANGLE_FULL) * Math.PI * 2;
  COS[a] = Math.round(Math.cos(rad) * TRIG_SCALE);
  SIN[a] = Math.round(Math.sin(rad) * TRIG_SCALE);
}

// ---------- Helpers ----------
function scaleVec(v: Vec, scale: number): Vec {
  return { x: Math.round(v.x * scale), y: Math.round(v.y * scale) };
}

function dist2(a: Vec, b: Vec) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function approxInvSqrt(n: number): number {
  return 1 / Math.sqrt(n);
}

// Point-to-line-segment squared distance (integer math, no sqrt).
// Uses t1000 fixed-point to avoid overflow with SCALE=1000.
function segmentPointDist2(
  ax: number, ay: number,
  bx: number, by: number,
  px: number, py: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const denom = vx * vx + vy * vy;
  if (denom === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return ddx * ddx + ddy * ddy;
  }
  const wx = px - ax;
  const wy = py - ay;
  const numer = wx * vx + wy * vy;
  let t1000: number;
  if (numer <= 0) t1000 = 0;
  else if (numer >= denom) t1000 = 1000;
  else t1000 = Math.round((numer * 1000) / denom);

  const cx = ax + Math.round((vx * t1000) / 1000);
  const cy = ay + Math.round((vy * t1000) / 1000);
  const ddx = px - cx;
  const ddy = py - cy;
  return ddx * ddx + ddy * ddy;
}

// Closest point on segment to a point (for shaft deflection push direction)
function segmentClosestPoint(
  ax: number, ay: number,
  bx: number, by: number,
  px: number, py: number
): Vec {
  const vx = bx - ax;
  const vy = by - ay;
  const denom = vx * vx + vy * vy;
  if (denom === 0) return { x: ax, y: ay };
  const wx = px - ax;
  const wy = py - ay;
  const numer = wx * vx + wy * vy;
  let t1000: number;
  if (numer <= 0) t1000 = 0;
  else if (numer >= denom) t1000 = 1000;
  else t1000 = Math.round((numer * 1000) / denom);
  return {
    x: ax + Math.round((vx * t1000) / 1000),
    y: ay + Math.round((vy * t1000) / 1000),
  };
}

export function canonicalEventsString(events: Event[]): string {
  return events
    .map((ev) => {
      if (ev.e === "hit") return `${ev.t}|hit|${ev.from}|${ev.to}|${ev.dmg}`;
      if (ev.e === "dead") return `${ev.t}|dead|${ev.id}`;
      if (ev.e === "wall") return `${ev.t}|wall|${ev.id}|${ev.side}`;
      if (ev.e === "collide") return `${ev.t}|collide|${ev.a}|${ev.b}`;
      if (ev.e === "timeout") return `${ev.t}|timeout|${ev.winner}`;
      const _exhaustive: never = ev;
      return _exhaustive;
    })
    .join("\n");
}

export function canonicalInputs(spec: MatchSpec) {
  return {
    seed: spec.seed,
    weaponSetVersion: spec.weaponSetVersion ?? "none",
    sim: spec.sim,
    arena: spec.arena,
    weapons: spec.weapons,
    ballA: spec.ballA,
    ballB: spec.ballB,
  };
}

// ---------- Core engine ----------
function weaponTipScaled(ball: BallState): Vec {
  // Safe: ball.theta is always in range [0, 65535] and arrays are sized to ANGLE_FULL (65536)
  const c = COS[ball.theta]!;
  const s = SIN[ball.theta]!;
  return {
    x: ball.pos.x + Math.round((ball.weaponReach * c) / TRIG_SCALE),
    y: ball.pos.y + Math.round((ball.weaponReach * s) / TRIG_SCALE),
  };
}

function weaponTipScaledAt(ball: BallState, theta: number): Vec {
  // Safe: theta is masked to [0, 65535] and arrays are sized to ANGLE_FULL (65536)
  const maskedTheta = theta & 0xffff;
  const c = COS[maskedTheta]!;
  const s = SIN[maskedTheta]!;
  return {
    x: ball.pos.x + Math.round((ball.weaponReach * c) / TRIG_SCALE),
    y: ball.pos.y + Math.round((ball.weaponReach * s) / TRIG_SCALE),
  };
}

// Matches how you move balls each tick (includes speedMult)
function effectiveBodyVel(ball: BallState): Vec {
  return {
    x: Math.round((ball.vel.x * ball.speedMult) / 1000),
    y: Math.round((ball.vel.y * ball.speedMult) / 1000),
  };
}

// Per-tick tip velocity = body displacement + rotation-induced displacement
function tipVelScaled(ball: BallState): Vec {
  const tipNow = weaponTipScaledAt(ball, ball.theta);
  const tipNext = weaponTipScaledAt(ball, (ball.theta + ball.omega) & 0xffff);

  const rotDx = tipNext.x - tipNow.x;
  const rotDy = tipNext.y - tipNow.y;

  const v = effectiveBodyVel(ball);
  return { x: v.x + rotDx, y: v.y + rotDy };
}


function applyWallBounce(state: SimState, ball: BallState) {
  const t = state.tick;
  const arenaW = state.arenaW;
  const arenaH = state.arenaH;
  const rest = state.wallRest;

  if (ball.pos.x - ball.r < 0) {
    ball.pos.x = ball.r;
    ball.vel.x = Math.round((-ball.vel.x * rest) / 1000);
    state.events.push({ t, e: "wall", id: ball.id, side: "L" });
  } else if (ball.pos.x + ball.r > arenaW) {
    ball.pos.x = arenaW - ball.r;
    ball.vel.x = Math.round((-ball.vel.x * rest) / 1000);
    state.events.push({ t, e: "wall", id: ball.id, side: "R" });
  }

  if (ball.pos.y - ball.r < 0) {
    ball.pos.y = ball.r;
    ball.vel.y = Math.round((-ball.vel.y * rest) / 1000);
    state.events.push({ t, e: "wall", id: ball.id, side: "T" });
  } else if (ball.pos.y + ball.r > arenaH) {
    ball.pos.y = arenaH - ball.r;
    ball.vel.y = Math.round((-ball.vel.y * rest) / 1000);
    state.events.push({ t, e: "wall", id: ball.id, side: "B" });
  }
}

function resolveBallBallCollision(state: SimState, A: BallState, B: BallState) {
  if (!A.alive || !B.alive) return;

  const dx = B.pos.x - A.pos.x;
  const dy = B.pos.y - A.pos.y;
  const rSum = A.r + B.r;

  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return;
  if (d2 > rSum * rSum) return;

  const invLen = approxInvSqrt(d2);
  const nx = dx * invLen;
  const ny = dy * invLen;

  const rvx = B.vel.x - A.vel.x;
  const rvy = B.vel.y - A.vel.y;
  const velAlongNormal = rvx * nx + rvy * ny;

  const e = Math.min(A.restitution, B.restitution) / 1000;
  const invMassA = 1;
  const invMassB = 1;

  const j = -(1 + e) * velAlongNormal / (invMassA + invMassB);
  const impulseX = j * nx;
  const impulseY = j * ny;

  A.vel.x -= Math.round(impulseX * invMassA);
  A.vel.y -= Math.round(impulseY * invMassA);
  B.vel.x += Math.round(impulseX * invMassB);
  B.vel.y += Math.round(impulseY * invMassB);

    // Dampen speed slightly on ball-ball collisions
  A.vel.x = Math.round(A.vel.x * BALL_COLLIDE_DAMP);
  A.vel.y = Math.round(A.vel.y * BALL_COLLIDE_DAMP);
  B.vel.x = Math.round(B.vel.x * BALL_COLLIDE_DAMP);
  B.vel.y = Math.round(B.vel.y * BALL_COLLIDE_DAMP);

  state.events.push({ t: state.tick, e: "collide", a: A.id, b: B.id });

  const dist = 1 / invLen;
  const overlap = rSum - dist;
  if (overlap > 0) {
    const pushX = nx * (overlap / 2);
    const pushY = ny * (overlap / 2);

    A.pos.x -= Math.round(pushX);
    A.pos.y -= Math.round(pushY);
    B.pos.x += Math.round(pushX);
    B.pos.y += Math.round(pushY);
  }
}

function resolveTipTipCollision(state: SimState, A: BallState, B: BallState): boolean {
  if (!A.alive || !B.alive) return false;
  if (A.tipCooldown > 0 || B.tipCooldown > 0) return false;

  const tipA = weaponTipScaled(A);
  const tipB = weaponTipScaled(B);

  const dx = tipB.x - tipA.x;
  const dy = tipB.y - tipA.y;
  const rSum = A.tipR + B.tipR;

  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return false;
  if (d2 > rSum * rSum) return false;

  // Normal from A tip -> B tip
  const invLen = approxInvSqrt(d2);
  const nx = dx * invLen;
  const ny = dy * invLen;

  // Relative TIP velocity along normal (includes rotation + body motion)
  const vA = tipVelScaled(A);
  const vB = tipVelScaled(B);

  const rvx = vB.x - vA.x;
  const rvy = vB.y - vA.y;

  const velAlongNormal = rvx * nx + rvy * ny;

  // Closing speed (>=0)
  const closing = Math.max(0, -velAlongNormal);

  // Baseline pop scales with reach (more consistent across weapons)
  const baseline = Math.round(A.weaponReach * 0.02);

  // Total impulse magnitude
  const totalJ = closing * TIP_BOUNCE_BOOST + baseline;

  // Weight-proportional distribution:
  // Heavier weapon pushes the lighter one more.
  // A gets pushed proportional to B's weight, B gets pushed proportional to A's weight.
  const wSum = A.weaponWeight + B.weaponWeight;
  // pushRatioA = B.weight / wSum (how much A gets pushed)
  // pushRatioB = A.weight / wSum (how much B gets pushed)
  const pushA = Math.round((totalJ * B.weaponWeight) / wSum);
  const pushB = Math.round((totalJ * A.weaponWeight) / wSum);

  // Launch both balls away from clash line (proportional to opponent's weight)
  A.vel.x -= Math.round(pushA * nx);
  A.vel.y -= Math.round(pushA * ny);
  B.vel.x += Math.round(pushB * nx);
  B.vel.y += Math.round(pushB * ny);

  // Positional separation to avoid repeated collisions from overlap
  const dist = 1 / invLen;
  const overlap = rSum - dist;
  if (overlap > 0) {
    const pushX = nx * (overlap / 2);
    const pushY = ny * (overlap / 2);
    A.pos.x -= Math.round(pushX);
    A.pos.y -= Math.round(pushY);
    B.pos.x += Math.round(pushX);
    B.pos.y += Math.round(pushY);
  }

  A.tipCooldown = TIP_COLLIDE_COOLDOWN_TICKS;
  B.tipCooldown = TIP_COLLIDE_COOLDOWN_TICKS;

  return true;
}

// --- Shape-based collision helpers ---

function bladeSegmentScaled(ball: BallState): { sx: number; sy: number; ex: number; ey: number } {
  const c = COS[ball.theta]!;
  const s = SIN[ball.theta]!;
  return {
    sx: ball.pos.x + Math.round((ball.bladeStart * c) / TRIG_SCALE),
    sy: ball.pos.y + Math.round((ball.bladeStart * s) / TRIG_SCALE),
    ex: ball.pos.x + Math.round((ball.weaponReach * c) / TRIG_SCALE),
    ey: ball.pos.y + Math.round((ball.weaponReach * s) / TRIG_SCALE),
  };
}

function checkBladeHit(attacker: BallState, victim: BallState): boolean {
  const seg = bladeSegmentScaled(attacker);
  const d2 = segmentPointDist2(seg.sx, seg.sy, seg.ex, seg.ey, victim.pos.x, victim.pos.y);
  const rr = attacker.bladeWidth + victim.r;
  return d2 <= rr * rr;
}

function shaftSegmentScaled(ball: BallState): { sx: number; sy: number; ex: number; ey: number } {
  const c = COS[ball.theta]!;
  const s = SIN[ball.theta]!;
  // Shaft goes from ball edge (not center, to avoid overlap with body) to bladeStart
  const startDist = ball.r; // start at body surface
  return {
    sx: ball.pos.x + Math.round((startDist * c) / TRIG_SCALE),
    sy: ball.pos.y + Math.round((startDist * s) / TRIG_SCALE),
    ex: ball.pos.x + Math.round((ball.bladeStart * c) / TRIG_SCALE),
    ey: ball.pos.y + Math.round((ball.bladeStart * s) / TRIG_SCALE),
  };
}

const SHAFT_PUSH = 300;

function resolveShaftDeflections(state: SimState, A: BallState, B: BallState) {
  if (!A.alive || !B.alive) return;

  // A's shaft pushes B
  {
    const seg = shaftSegmentScaled(A);
    const d2 = segmentPointDist2(seg.sx, seg.sy, seg.ex, seg.ey, B.pos.x, B.pos.y);
    const rr = A.shaftRadius + B.r;
    if (d2 <= rr * rr && d2 > 0) {
      const cp = segmentClosestPoint(seg.sx, seg.sy, seg.ex, seg.ey, B.pos.x, B.pos.y);
      const dx = B.pos.x - cp.x;
      const dy = B.pos.y - cp.y;
      const cd2 = dx * dx + dy * dy;
      if (cd2 > 0) {
        const invLen = approxInvSqrt(cd2);
        const nx = dx * invLen;
        const ny = dy * invLen;
        const pushBase = Math.round((SHAFT_PUSH * state.SCALE) / 1000);
        const push = Math.round((pushBase * A.weaponWeight) / 1000);
        B.vel.x += Math.round(nx * push);
        B.vel.y += Math.round(ny * push);
        const dist = 1 / invLen;
        const overlap = rr - dist;
        if (overlap > 0) {
          B.pos.x += Math.round(nx * (overlap + 1));
          B.pos.y += Math.round(ny * (overlap + 1));
        }
      }
    }
  }

  // B's shaft pushes A
  {
    const seg = shaftSegmentScaled(B);
    const d2 = segmentPointDist2(seg.sx, seg.sy, seg.ex, seg.ey, A.pos.x, A.pos.y);
    const rr = B.shaftRadius + A.r;
    if (d2 <= rr * rr && d2 > 0) {
      const cp = segmentClosestPoint(seg.sx, seg.sy, seg.ex, seg.ey, A.pos.x, A.pos.y);
      const dx = A.pos.x - cp.x;
      const dy = A.pos.y - cp.y;
      const cd2 = dx * dx + dy * dy;
      if (cd2 > 0) {
        const invLen = approxInvSqrt(cd2);
        const nx = dx * invLen;
        const ny = dy * invLen;
        const pushBase = Math.round((SHAFT_PUSH * state.SCALE) / 1000);
        const push = Math.round((pushBase * B.weaponWeight) / 1000);
        A.vel.x += Math.round(nx * push);
        A.vel.y += Math.round(ny * push);
        const dist = 1 / invLen;
        const overlap = rr - dist;
        if (overlap > 0) {
          A.pos.x += Math.round(nx * (overlap + 1));
          A.pos.y += Math.round(ny * (overlap + 1));
        }
      }
    }
  }
}

const BLUNT_KNOCKBACK_MULT = 1500; // 1.5x in 1000ths

function doesWeaponHit(attacker: BallState, victim: BallState): boolean {
  switch (attacker.weaponType) {
    case "blade":
      return checkBladeHit(attacker, victim);
    case "point":
    case "blunt":
    default: {
      // Circle-circle: tip vs victim body
      const tip = weaponTipScaled(attacker);
      const rr = attacker.tipR + victim.r;
      return dist2(tip, victim.pos) <= rr * rr;
    }
  }
}

function checkHit(state: SimState, attacker: BallState, victim: BallState) {
  if (!attacker.alive || !victim.alive) return;

  if (!doesWeaponHit(attacker, victim)) return;

  attacker.hitCount += 1;
  const dmg = attacker.baseDamage + attacker.ramp * (attacker.hitCount - 1);

  victim.hp -= dmg;
  attacker.damageDealt += dmg;

  state.events.push({ t: state.tick, e: "hit", from: attacker.id, to: victim.id, dmg });

  // Compute impact point (for knockback direction)
  let impactX: number;
  let impactY: number;
  if (attacker.weaponType === "blade") {
    // Closest point on the blade segment to the victim
    const seg = bladeSegmentScaled(attacker);
    const cp = segmentClosestPoint(seg.sx, seg.sy, seg.ex, seg.ey, victim.pos.x, victim.pos.y);
    impactX = cp.x;
    impactY = cp.y;
  } else {
    const tip = weaponTipScaled(attacker);
    impactX = tip.x;
    impactY = tip.y;
  }

  // Knockback: push victim away from impact point
  const kdx = victim.pos.x - impactX;
  const kdy = victim.pos.y - impactY;
  const kd2 = kdx * kdx + kdy * kdy;

  if (kd2 > 0) {
    const inv = approxInvSqrt(kd2);
    const kx = kdx * inv;
    const ky = kdy * inv;

    let kbBase = Math.round((TIP_HIT_KNOCKBACK * state.SCALE) / 1000);
    kbBase = Math.round((kbBase * attacker.weaponWeight) / 1000);

    // Blunt weapons get 1.5x knockback
    if (attacker.weaponType === "blunt") {
      kbBase = Math.round((kbBase * BLUNT_KNOCKBACK_MULT) / 1000);
    }

    victim.vel.x += Math.round(kx * kbBase);
    victim.vel.y += Math.round(ky * kbBase);
  }

  // --- Physical separation (prevents clipping) ---
  const dx = victim.pos.x - impactX;
  const dy = victim.pos.y - impactY;
  const d2val = dx * dx + dy * dy;

  if (d2val > 0) {
    const dval = Math.sqrt(d2val);
    // Combined collision radius depends on type
    const rr = attacker.weaponType === "blade"
      ? attacker.bladeWidth + victim.r
      : attacker.tipR + victim.r;
    const pen = rr - dval;
    if (pen > 0) {
      const nx = dx / dval;
      const ny = dy / dval;

      victim.pos.x += Math.round(nx * (pen + 1));
      victim.pos.y += Math.round(ny * (pen + 1));

      // Tiny recoil on attacker
      const recoilBase = Math.round((TIP_HIT_KNOCKBACK * state.SCALE) / 1000);
      attacker.vel.x -= Math.round(nx * (recoilBase * 0.2));
      attacker.vel.y -= Math.round(ny * (recoilBase * 0.2));
    }
  }

  // Deterministic tiny jitter
  const jx = Math.round((state.rng() - 0.5) * 6 * state.SCALE);
  const jy = Math.round((state.rng() - 0.5) * 6 * state.SCALE);
  victim.vel.x += jx;
  victim.vel.y += jy;

  if (victim.hp <= 0) {
    victim.alive = false;
    state.events.push({ t: state.tick, e: "dead", id: victim.id });
  }
}

function initBall(spec: MatchSpec, SCALE: number, b: BallSpec, jitter: number): BallState {
  const weapon = spec.weapons[b.weaponId];
  if (!weapon) throw new Error(`Unknown weaponId: ${b.weaponId}`);

  const rng = mulberry32((spec.seed ^ jitter) >>> 0);
  const theta0 = (Math.floor(rng() * ANGLE_FULL) & 0xffff) >>> 0;

  const wtype: WeaponType = weapon.type ?? "point";
  const reach = weapon.reach;
  const bladeStartRaw = weapon.bladeStart ?? Math.round(reach * 0.4);
  const bladeWidthRaw = weapon.bladeWidth ?? weapon.tipRadius;
  const shaftRadiusRaw = weapon.shaftRadius ?? 8;

  return {
    id: b.id,
    hp: b.hp,
    r: Math.round(b.radius * SCALE),
    pos: scaleVec(b.pos, SCALE),
    vel: scaleVec(b.vel, SCALE),
    theta: theta0,
    omega: weapon.omega,
    weaponReach: Math.round(reach * SCALE),
    tipR: Math.round(weapon.tipRadius * SCALE),
    tipCooldown: 0,
    baseDamage: weapon.baseDamage,
    ramp: weapon.ramp,
    hitCount: 0,
    alive: true,
    speedMult: weapon.speedMult,
    damageDealt: 0,
    restitution: b.restitution ?? 1000,
    weaponWeight: weapon.weight ?? 1000,
    weaponType: wtype,
    bladeStart: Math.round(bladeStartRaw * SCALE),
    bladeWidth: Math.round(bladeWidthRaw * SCALE),
    shaftRadius: Math.round(shaftRadiusRaw * SCALE),
  };
}

export function createSim(spec: MatchSpec): SimState {
  const SCALE = spec.sim.scale;
  const arenaW = Math.round(spec.arena.w * SCALE);
  const arenaH = Math.round(spec.arena.h * SCALE);

  const state: SimState = {
    spec,
    SCALE,
    arenaW,
    arenaH,
    wallRest: spec.arena.wallRestitution,
    tick: 0,
    A: initBall(spec, SCALE, spec.ballA, 0xA1B2C3D4),
    B: initBall(spec, SCALE, spec.ballB, 0xB4C3D2A1),
    events: [],
    rng: mulberry32(spec.seed),
    done: false,
  };

  return state;
}

export function stepSim(state: SimState) {
  if (state.done) return;

  const { A, B } = state;
  let tipClashedThisTick = false;

  if (!A.alive || !B.alive) {
    state.done = true;
    state.winner = A.alive ? "A" : "B";
    return;
  }

  if (state.tick >= state.spec.sim.maxTicks) {
    // Timeout resolution
    let winner: "A" | "B";
    if (A.hp !== B.hp) winner = A.hp > B.hp ? "A" : "B";
    else if (A.damageDealt !== B.damageDealt) winner = A.damageDealt > B.damageDealt ? "A" : "B";
    else winner = state.rng() < 0.5 ? "A" : "B";

    state.events.push({ t: state.tick, e: "timeout", winner });
    state.done = true;
    state.winner = winner;
    return;
  }

  // 1) update weapon angles
  A.theta = (A.theta + A.omega) & 0xffff;
  B.theta = (B.theta + B.omega) & 0xffff;

  // 2) move (speedMult scales velocity)
  A.pos.x += Math.round((A.vel.x * A.speedMult) / 1000);
  A.pos.y += Math.round((A.vel.y * A.speedMult) / 1000);
  B.pos.x += Math.round((B.vel.x * B.speedMult) / 1000);
  B.pos.y += Math.round((B.vel.y * B.speedMult) / 1000);

  // downward gravity (positive Y = down in screen space)
  const GRAVITY = Math.round(0.15 * state.SCALE);
  A.vel.y += GRAVITY;
  B.vel.y += GRAVITY;

  // mutual attraction so balls collide more often
  const adx = B.pos.x - A.pos.x;
  const ady = B.pos.y - A.pos.y;
  A.vel.x += Math.round(adx * 0.0008);
  A.vel.y += Math.round(ady * 0.0008);
  B.vel.x -= Math.round(adx * 0.0008);
  B.vel.y -= Math.round(ady * 0.0008);

  // 3) wall bounce
  applyWallBounce(state, A);
  applyWallBounce(state, B);

  // 4) ball-ball collision
  resolveBallBallCollision(state, A, B);

  // 5) shaft deflections (push-only, no damage)
  resolveShaftDeflections(state, A, B);

  // 6) tip-tip collision (clash cancels hits this tick)
  tipClashedThisTick = resolveTipTipCollision(state, A, B);

  // 7) hits (fixed order) — skipped if tips clashed
  if (!tipClashedThisTick) {
    checkHit(state, A, B);
    checkHit(state, B, A);
  }

  // Cooldowns (prevents repeated tip-tip clashes while overlapped)
  if (A.tipCooldown > 0) A.tipCooldown -= 1;
  if (B.tipCooldown > 0) B.tipCooldown -= 1;
  state.tick += 1;

  // If someone died this tick, mark done next stepSim call (keeps logic simple)
  if (!A.alive || !B.alive) {
    state.done = true;
    state.winner = A.alive ? "A" : "B";
  }
}

export function getWeaponTipForRender(state: SimState, ball: BallState): Vec {
  // Return *unscaled* for canvas drawing
  const tip = weaponTipScaled(ball);
  return { x: tip.x / state.SCALE, y: tip.y / state.SCALE };
}

export type WeaponShapeRender = {
  type: WeaponType;
  baseX: number; baseY: number;       // ball center (unscaled)
  tipX: number; tipY: number;         // weapon tip (unscaled)
  tipR: number;                        // tip radius (unscaled)
  bladeStartX: number; bladeStartY: number; // blade start point (unscaled)
  bladeWidth: number;                  // capsule half-width (unscaled)
  shaftRadius: number;                 // shaft deflection radius (unscaled)
  reach: number;                       // full reach (unscaled)
  bladeStartDist: number;             // distance from center to blade start (unscaled)
};

export function getWeaponShapeForRender(state: SimState, ball: BallState): WeaponShapeRender {
  const S = state.SCALE;
  const tip = weaponTipScaled(ball);
  const c = COS[ball.theta]!;
  const s = SIN[ball.theta]!;
  const bsX = ball.pos.x + Math.round((ball.bladeStart * c) / TRIG_SCALE);
  const bsY = ball.pos.y + Math.round((ball.bladeStart * s) / TRIG_SCALE);

  return {
    type: ball.weaponType,
    baseX: ball.pos.x / S,
    baseY: ball.pos.y / S,
    tipX: tip.x / S,
    tipY: tip.y / S,
    tipR: ball.tipR / S,
    bladeStartX: bsX / S,
    bladeStartY: bsY / S,
    bladeWidth: ball.bladeWidth / S,
    shaftRadius: ball.shaftRadius / S,
    reach: ball.weaponReach / S,
    bladeStartDist: ball.bladeStart / S,
  };
}