// src/simCore.ts
export type Vec = { x: number; y: number };

export type WeaponDef = {
  reach: number;
  tipRadius: number;
  omega: number;      // angle units per tick (0..65535 wraps full circle)
  baseDamage: number;
  ramp: number;       // damage ramps per hit (never resets during match)
  speedMult: number;  // 1000 = 1.0x
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
  baseDamage: number;
  ramp: number;
  hitCount: number; // never resets
  alive: boolean;
  speedMult: number; // 1000ths
  damageDealt: number;
  restitution: number; // 1000ths
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
  const c = COS[ball.theta]!;
  const s = SIN[ball.theta]!;
  return {
    x: ball.pos.x + Math.round((ball.weaponReach * c) / TRIG_SCALE),
    y: ball.pos.y + Math.round((ball.weaponReach * s) / TRIG_SCALE),
  };
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

function checkHit(state: SimState, attacker: BallState, victim: BallState) {
  if (!attacker.alive || !victim.alive) return;

  const tip = weaponTipScaled(attacker);
  const rr = attacker.tipR + victim.r;

  if (dist2(tip, victim.pos) <= rr * rr) {
    attacker.hitCount += 1;
    const dmg = attacker.baseDamage + attacker.ramp * (attacker.hitCount - 1);

    victim.hp -= dmg;
    attacker.damageDealt += dmg;

    state.events.push({ t: state.tick, e: "hit", from: attacker.id, to: victim.id, dmg });

    // Deterministic tiny jitter
    const jx = Math.round((state.rng() - 0.5) * 20 * state.SCALE);
    const jy = Math.round((state.rng() - 0.5) * 20 * state.SCALE);
    victim.vel.x += jx;
    victim.vel.y += jy;

    if (victim.hp <= 0) {
      victim.alive = false;
      state.events.push({ t: state.tick, e: "dead", id: victim.id });
    }
  }
}

function initBall(spec: MatchSpec, SCALE: number, b: BallSpec, jitter: number): BallState {
  const weapon = spec.weapons[b.weaponId];
  if (!weapon) throw new Error(`Unknown weaponId: ${b.weaponId}`);

  const rng = mulberry32((spec.seed ^ jitter) >>> 0);
  const theta0 = (Math.floor(rng() * ANGLE_FULL) & 0xffff) >>> 0;

  return {
    id: b.id,
    hp: b.hp,
    r: Math.round(b.radius * SCALE),
    pos: scaleVec(b.pos, SCALE),
    vel: scaleVec(b.vel, SCALE),
    theta: theta0,
    omega: weapon.omega,
    weaponReach: Math.round(weapon.reach * SCALE),
    tipR: Math.round(weapon.tipRadius * SCALE),
    baseDamage: weapon.baseDamage,
    ramp: weapon.ramp,
    hitCount: 0,
    alive: true,
    speedMult: weapon.speedMult,
    damageDealt: 0,
    restitution: b.restitution ?? 1000,
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

  // 3) wall bounce
  applyWallBounce(state, A);
  applyWallBounce(state, B);

  // 4) ball-ball collision
  resolveBallBallCollision(state, A, B);

  // 5) hits (fixed order)
  checkHit(state, A, B);
  checkHit(state, B, A);

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