import "./style.css";
import matchSpecJson from "../../matchSpec.json";
import { createSim, stepSim, getWeaponTipForRender } from "../../src/simCore";
import type { MatchSpec } from "../../src/simCore";

// Constants for image validation
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

// Validate and type the match spec
function validateMatchSpec(spec: unknown): MatchSpec {
  if (typeof spec !== "object" || spec === null) {
    throw new Error("Match spec must be an object");
  }
  return spec as MatchSpec;
}

const matchSpec = validateMatchSpec(matchSpecJson);

// Get DOM elements with proper error handling
function getElementByIdOrThrow<T extends HTMLElement>(id: string, type: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required ${type} element with id "${id}" not found`);
  }
  return element as T;
}

const canvas = getElementByIdOrThrow<HTMLCanvasElement>("arena", "canvas");
const ctxNullable = canvas.getContext("2d");
if (!ctxNullable) {
  throw new Error("Failed to get 2D rendering context from canvas");
}
const ctx: CanvasRenderingContext2D = ctxNullable;

const playPauseBtn = getElementByIdOrThrow<HTMLButtonElement>("playPause", "button");
const speedSelect = getElementByIdOrThrow<HTMLSelectElement>("speed", "select");
const tickReadout = getElementByIdOrThrow<HTMLSpanElement>("tickReadout", "span");

// HP tracker elements
const hpBarA = getElementByIdOrThrow<HTMLDivElement>("hp-bar-a", "div");
const hpBarB = getElementByIdOrThrow<HTMLDivElement>("hp-bar-b", "div");
const hpTextA = getElementByIdOrThrow<HTMLDivElement>("hp-text-a", "div");
const hpTextB = getElementByIdOrThrow<HTMLDivElement>("hp-text-b", "div");
const hpStatsA = getElementByIdOrThrow<HTMLDivElement>("hp-stats-a", "div");
const hpStatsB = getElementByIdOrThrow<HTMLDivElement>("hp-stats-b", "div");

// Admin panel elements
const adminToggleBtn = getElementByIdOrThrow<HTMLButtonElement>("adminToggle", "button");
const adminPanel = getElementByIdOrThrow<HTMLDivElement>("adminPanel", "div");
const adminCloseBtn = getElementByIdOrThrow<HTMLButtonElement>("adminClose", "button");

adminToggleBtn.addEventListener("click", () => {
  adminPanel.classList.toggle("hidden");
});
adminCloseBtn.addEventListener("click", () => {
  adminPanel.classList.add("hidden");
});

// add skins
const ballAInput = getElementByIdOrThrow<HTMLInputElement>("ballAImg", "input");
const ballBInput = getElementByIdOrThrow<HTMLInputElement>("ballBImg", "input");
const weaponAInput = getElementByIdOrThrow<HTMLInputElement>("weaponAImg", "input");
const weaponBInput = getElementByIdOrThrow<HTMLInputElement>("weaponBImg", "input");

let ballAImg: HTMLImageElement | null = null;
let ballBImg: HTMLImageElement | null = null;
let weaponAImg: HTMLImageElement | null = null;
let weaponBImg: HTMLImageElement | null = null;

// Track object URLs for cleanup
const objectUrls: Set<string> = new Set();

// Cleanup function to revoke object URLs
function revokeObjectUrl(url: string) {
  if (objectUrls.has(url)) {
    URL.revokeObjectURL(url);
    objectUrls.delete(url);
  }
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  objectUrls.forEach(revokeObjectUrl);
});

async function loadPngFromInput(input: HTMLInputElement): Promise<HTMLImageElement | null> {
  const file = input.files?.[0];
  if (!file) return null;

  // Validate file type
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    console.warn(`Invalid image type: ${file.type}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(", ")}`);
    return null;
  }

  // Validate file size
  if (file.size > MAX_IMAGE_SIZE) {
    console.warn(`Image file too large: ${file.size} bytes. Maximum size: ${MAX_IMAGE_SIZE} bytes`);
    return null;
  }

  const url = URL.createObjectURL(file);
  objectUrls.add(url);

  const img = new Image();
  img.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => {
        revokeObjectUrl(url);
        reject(new Error("Failed to load image"));
      };
    });
    return img;
  } catch (error) {
    revokeObjectUrl(url);
    console.error("Error loading image:", error);
    return null;
  }
}

// Weapon sprite anchor point inside the PNG (0..1)
// 1.0 means right edge, 0.0 means left edge
const WEAPON_TIP_ANCHOR_X = 0.92; // tune this (0.85–0.98 is common)
const WEAPON_TIP_ANCHOR_Y = 0.50; // center vertically

// Image loading handlers with cleanup
ballAInput.addEventListener("change", async () => {
  if (ballAImg?.src && objectUrls.has(ballAImg.src)) {
    revokeObjectUrl(ballAImg.src);
  }
  ballAImg = await loadPngFromInput(ballAInput);
});

ballBInput.addEventListener("change", async () => {
  if (ballBImg?.src && objectUrls.has(ballBImg.src)) {
    revokeObjectUrl(ballBImg.src);
  }
  ballBImg = await loadPngFromInput(ballBInput);
});

weaponAInput.addEventListener("change", async () => {
  if (weaponAImg?.src && objectUrls.has(weaponAImg.src)) {
    revokeObjectUrl(weaponAImg.src);
  }
  weaponAImg = await loadPngFromInput(weaponAInput);
});

weaponBInput.addEventListener("change", async () => {
  if (weaponBImg?.src && objectUrls.has(weaponBImg.src)) {
    revokeObjectUrl(weaponBImg.src);
  }
  weaponBImg = await loadPngFromInput(weaponBInput);
});
//end add skins

// Fixed render resolution — portrait for mobile
const WIDTH = 500;
const HEIGHT = 800;
canvas.width = WIDTH;
canvas.height = HEIGHT;

// --- Map sim-space (matchSpec arena) into the drawn arena box ---
const SIM_ARENA_W = matchSpec.arena.w;
const SIM_ARENA_H = matchSpec.arena.h;

// --- Arena framing (visual only) ---
const ARENA_PAD = 20;
const ARENA_W = WIDTH - ARENA_PAD * 2;
const ARENA_H = Math.round(ARENA_W * (SIM_ARENA_H / SIM_ARENA_W));
const ARENA_X = ARENA_PAD;
const ARENA_Y = Math.floor((HEIGHT - ARENA_H) / 2);

const MAP_X = ARENA_W / SIM_ARENA_W;
const MAP_Y = ARENA_H / SIM_ARENA_H;

// If your sim arena is not square, this keeps it from stretching.
// (It letterboxes one dimension slightly.)
const MAP = Math.min(MAP_X, MAP_Y);

const MAP_OFF_X = ARENA_X + (ARENA_W - SIM_ARENA_W * MAP) / 2;
const MAP_OFF_Y = ARENA_Y + (ARENA_H - SIM_ARENA_H * MAP) / 2;
const PLAY_W = SIM_ARENA_W * MAP;
const PLAY_H = SIM_ARENA_H * MAP;
const PLAY_X = MAP_OFF_X;
const PLAY_Y = MAP_OFF_Y;

function toScreen(x: number, y: number) {
  return { x: MAP_OFF_X + x * MAP, y: MAP_OFF_Y + y * MAP };
}

// Visual scale matches sim hitboxes exactly (1.0 = pixel-accurate collisions)
const VISUAL_SCALE = 1.0;

// --- Sim timing ---
const TICKS_PER_SEC = 30;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;

let running = true;
let speed = Number(speedSelect.value); // 0.25, 0.5, 1, 2, 4, 8
let lastMs = performance.now();
let accumulatorMs = 0;

// --- Event log ---
const eventLogEl = getElementByIdOrThrow<HTMLDivElement>("eventLog", "div");
let lastEventIdx = 0;

// --- Simulation state ---
const sim = createSim(matchSpec);

function formatEvent(ev: (typeof sim.events)[number]): { text: string; cls: string } {
  switch (ev.e) {
    case "hit":
      return { text: `t${ev.t} HIT ${ev.from}\u2192${ev.to} dmg:${ev.dmg}`, cls: `ev ev-hit-${ev.from}` };
    case "collide":
      return { text: `t${ev.t} BUMP ${ev.a}\u2194${ev.b}`, cls: "ev ev-collide" };
    case "wall":
      return { text: `t${ev.t} WALL ${ev.id} ${ev.side}`, cls: "ev ev-wall" };
    case "dead":
      return { text: `t${ev.t} DEAD ${ev.id}`, cls: "ev ev-dead" };
    case "timeout":
      return { text: `t${ev.t} TIMEOUT winner:${ev.winner}`, cls: "ev ev-timeout" };
  }
}

function flushEventLog() {
  const events = sim.events;
  if (events.length === lastEventIdx) return;

  for (let i = lastEventIdx; i < events.length; i++) {
    const ev = events[i]!;
    // Only show hit, dead, and timeout events
    if (ev.e !== "hit" && ev.e !== "dead" && ev.e !== "timeout") continue;
    const { text, cls } = formatEvent(ev);
    const div = document.createElement("div");
    div.className = cls;
    div.textContent = text;
    eventLogEl.appendChild(div);
  }
  lastEventIdx = events.length;

  // Auto-scroll to bottom
  eventLogEl.scrollTop = eventLogEl.scrollHeight;
}

function stepSimOneTick() {
  if (!sim.done) stepSim(sim);
}

function drawBall(x: number, y: number, r: number, fill: string) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // outline
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBallSpriteOrFallback(
  x: number,
  y: number,
  r: number,
  img: HTMLImageElement | null,
  fallback: string
) {
  if (!img) {
    drawBall(x, y, r, fallback);
    return;
  }

  ctx.save();

  // Clip to circle
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // Draw sprite inside the clipped circle
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);

  ctx.restore();

  // Optional: outline for readability
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function thetaToRad(theta: number) {
  return (theta / 65536) * Math.PI * 2;
}

function drawWeaponSpriteOrFallback(
  baseX: number,
  baseY: number,
  tipX: number,
  tipY: number,
  theta: number,
  img: HTMLImageElement | null,
  fallbackColor: string
) {
  const ang = thetaToRad(theta);

  // Fallback: thick arm line + tip dot (keeps things visible even if sprite fails)
  if (!img) {
    ctx.strokeStyle = fallbackColor;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.fillStyle = fallbackColor;
    ctx.beginPath();
    ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Draw sprite so it is always visible:
  // - position at the TIP
  // - rotate to theta
  // - stretch length based on arm length
  const armLen = Math.hypot(tipX - baseX, tipY - baseY);
  const w = armLen * 1.35;   // sprite length
  const h = armLen * 0.45;   // sprite thickness

  ctx.save();

  // Subtle depth
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  // Move to tip and rotate
  ctx.translate(tipX, tipY);
  ctx.rotate(ang);

  // Compute draw origin so that (WEAPON_TIP_ANCHOR_X, WEAPON_TIP_ANCHOR_Y) lands at (0,0)
  const ox = -w * WEAPON_TIP_ANCHOR_X;
  const oy = -h * WEAPON_TIP_ANCHOR_Y;

  // Assumes PNG points RIGHT (→). We want it extending from tip back toward the ball.
  // So we draw it ending at x=0, extending leftwards.
  ctx.drawImage(img, ox, oy, w, h);

  ctx.restore();
}

function render() {
  // Page background (outside the arena)
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Arena fill (the pit)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H);

  // Arena outer border (thick)
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 6;
  ctx.strokeRect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H);

  // Arena inner inset (subtle depth)
  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 2;
  ctx.strokeRect(PLAY_X, PLAY_Y, PLAY_W, PLAY_H);

  // Clip all game content to the arena bounds
  ctx.save();
  ctx.beginPath();
  ctx.rect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H);
  ctx.clip();

  // Define balls
  const Apos0 = { x: sim.A.pos.x / sim.SCALE, y: sim.A.pos.y / sim.SCALE };
  const Bpos0 = { x: sim.B.pos.x / sim.SCALE, y: sim.B.pos.y / sim.SCALE };

  const Apos = toScreen(Apos0.x, Apos0.y);
  const Bpos = toScreen(Bpos0.x, Bpos0.y);

  const Ar = (sim.A.r / sim.SCALE) * MAP * VISUAL_SCALE;
  const Br = (sim.B.r / sim.SCALE) * MAP * VISUAL_SCALE;

  // Define weapon arms + tips
  const Atip0 = getWeaponTipForRender(sim, sim.A);
  const Btip0 = getWeaponTipForRender(sim, sim.B);

  const Atip = toScreen(Atip0.x, Atip0.y);
  const Btip = toScreen(Btip0.x, Btip0.y);

  // Draw weapons (behind balls)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;

  drawWeaponSpriteOrFallback(
    Apos.x, Apos.y, Atip.x, Atip.y,
    sim.A.theta, weaponAImg, "#b00000"
  );

  drawWeaponSpriteOrFallback(
    Bpos.x, Bpos.y, Btip.x, Btip.y,
    sim.B.theta, weaponBImg, "#0b4ed6"
  );
  ctx.restore();

  // Draw weapon tips
  const tipAR = (sim.A.tipR / sim.SCALE) * MAP * VISUAL_SCALE;
  const tipBR = (sim.B.tipR / sim.SCALE) * MAP * VISUAL_SCALE;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 4;

  ctx.fillStyle = "#b00000";
  ctx.beginPath();
  ctx.arc(Atip.x, Atip.y, tipAR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0b4ed6";
  ctx.beginPath();
  ctx.arc(Btip.x, Btip.y, tipBR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tip outlines
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.arc(Atip.x, Atip.y, tipAR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(Btip.x, Btip.y, tipBR, 0, Math.PI * 2);
  ctx.stroke();

  // Draw balls (on top of weapons)
  drawBallSpriteOrFallback(Apos.x, Apos.y, Ar, ballAImg, "#e74c3c");
  drawBallSpriteOrFallback(Bpos.x, Bpos.y, Br, ballBImg, "#3498db");

  // End arena clip region
  ctx.restore();

  // Update HUD
  tickReadout.textContent = sim.done
    ? `tick: ${sim.tick} (DONE - Winner: ${sim.winner})`
    : `tick: ${sim.tick}`;

  // Update HP trackers
  const maxHpA = matchSpec.ballA.hp;
  const maxHpB = matchSpec.ballB.hp;
  const curHpA = Math.max(0, sim.A.hp);
  const curHpB = Math.max(0, sim.B.hp);

  hpBarA.style.width = `${(curHpA / maxHpA) * 100}%`;
  hpBarB.style.width = `${(curHpB / maxHpB) * 100}%`;

  hpTextA.textContent = `${curHpA} / ${maxHpA}`;
  hpTextB.textContent = `${curHpB} / ${maxHpB}`;

  hpStatsA.textContent = `Hits: ${sim.A.hitCount} | Dmg: ${sim.A.damageDealt}`;
  hpStatsB.textContent = `Hits: ${sim.B.hitCount} | Dmg: ${sim.B.damageDealt}`;
}

function frame(nowMs: number) {
  const deltaMs = nowMs - lastMs;
  lastMs = nowMs;

  if (running) {
    // Time scaling happens HERE:
    // real time * speed => simulated time
    accumulatorMs += deltaMs * speed;

    // Process as many fixed ticks as we owe
    while (accumulatorMs >= MS_PER_TICK) {
      stepSimOneTick();
      accumulatorMs -= MS_PER_TICK;
    }
  }

  render();
  flushEventLog();
  requestAnimationFrame(frame);
}

// --- UI wiring ---
playPauseBtn.addEventListener("click", () => {
  running = !running;
  if (playPauseBtn) {
    playPauseBtn.textContent = running ? "Pause" : "Play";
  }
});

speedSelect.addEventListener("change", () => {
  if (speedSelect) {
    speed = Number(speedSelect.value);
  }
});

// Start
requestAnimationFrame(frame);
