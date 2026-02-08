import "./style.css";
import matchSpecJson from "../../matchSpec.json";
import { createSim, stepSim, getWeaponTipForRender, MatchSpec } from "../../src/simCore";

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
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Failed to get 2D rendering context from canvas");
}

const playPauseBtn = getElementByIdOrThrow<HTMLButtonElement>("playPause", "button");
const speedSelect = getElementByIdOrThrow<HTMLSelectElement>("speed", "select");
const tickReadout = getElementByIdOrThrow<HTMLSpanElement>("tickReadout", "span");

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

// Fixed render resolution (you can scale visually later)
const WIDTH = 1000;
const HEIGHT = 600;
canvas.width = WIDTH;
canvas.height = HEIGHT;

// --- Arena framing (visual only) ---
const ARENA_W = 520;
const ARENA_H = 520;
const ARENA_X = Math.floor((WIDTH - ARENA_W) / 2);
const ARENA_Y = Math.floor((HEIGHT - ARENA_H) / 2);

// --- Map sim-space (matchSpec arena) into the drawn arena box ---
const SIM_ARENA_W = matchSpec.arena.w;
const SIM_ARENA_H = matchSpec.arena.h;

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

// If you later want “bigger presence” without changing sim:
// multiply ball + weapon sizes in drawing only.
const VISUAL_SCALE = 1.3;

// --- Sim timing ---
// Your sim is tick-based. We'll treat it as 60 ticks/sec for replay pacing.
// (Even if your sim doesn't "use dt", this is just for playback speed.)
const TICKS_PER_SEC = 30;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;

let running = true;
let speed = Number(speedSelect.value); // 0.25, 0.5, 1, 2, 4, 8
let lastMs = performance.now();
let accumulatorMs = 0;

// --- Simulation state ---
const sim = createSim(matchSpec);

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
  ctx.fillStyle = "#f4efe6"; // warm parchment like your reference
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
  ctx.strokeRect(
  PLAY_X,
  PLAY_Y,
  PLAY_W,
  PLAY_H
  );

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

  function withShadow(fn: () => void) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    fn();
    ctx.restore();
  }

  // arms
  ctx.strokeStyle = "red";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
    withShadow(() => {
      // Weapon arms: thick + rounded
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 8;

      // A arm
      drawWeaponSpriteOrFallback(
        Apos.x,
        Apos.y,
        Atip.x,
        Atip.y,
        sim.A.theta,
        weaponAImg,
        "#b00000"
      );

       // B arm
      drawWeaponSpriteOrFallback(
        Bpos.x,
        Bpos.y,
        Btip.x,
        Btip.y,
        sim.B.theta,
        weaponBImg,
        "#0b4ed6"
      );
    });


  drawBallSpriteOrFallback(Apos.x, Apos.y, Ar, ballAImg, "red");
  drawBallSpriteOrFallback(Bpos.x, Bpos.y, Br, ballBImg, "dodgerblue");

  ctx.strokeStyle = "dodgerblue";
  ctx.beginPath();
  ctx.moveTo(Bpos.x, Bpos.y);
  ctx.lineTo(Btip.x, Btip.y);
  ctx.stroke();

  // tips
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(Atip.x, Atip.y, (sim.A.tipR / sim.SCALE) * MAP * VISUAL_SCALE, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "dodgerblue";
  ctx.beginPath();
  ctx.arc(Btip.x, Btip.y, (sim.B.tipR / sim.SCALE) * MAP * VISUAL_SCALE, 0, Math.PI * 2);
  ctx.fill();

  if (tickReadout) {
    tickReadout.textContent = sim.done
      ? `tick: ${sim.tick} (DONE winner: ${sim.winner})`
      : `tick: ${sim.tick}`;
  }
    withShadow(() => {
  const tipAR = (sim.A.tipR / sim.SCALE) * MAP * VISUAL_SCALE;
  const tipBR = (sim.B.tipR / sim.SCALE) * MAP * VISUAL_SCALE;

  // Tip fill
  ctx.fillStyle = "#b00000";
  ctx.beginPath();
  ctx.arc(Atip.x, Atip.y, tipAR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#0b4ed6";
  ctx.beginPath();
  ctx.arc(Btip.x, Btip.y, tipBR, 0, Math.PI * 2);
  ctx.fill();

  // Tip outline (adds crispness)
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(Atip.x, Atip.y, tipAR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(Btip.x, Btip.y, tipBR, 0, Math.PI * 2);
  ctx.stroke();
});
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