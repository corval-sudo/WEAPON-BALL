import "./style.css";
import matchSpecJson from "../../matchSpec.json";
import { createSim, stepSim, getWeaponTipForRender, getWeaponShapeForRender } from "../../src/simCore";
import type { MatchSpec, SimState, WeaponType, WeaponShapeRender } from "../../src/simCore";

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

// --- Simulation state (mutable — replaced between batch matches) ---
let sim: SimState = createSim(matchSpec);

function formatEvent(ev: SimState["events"][number]): { text: string; cls: string } {
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

function resetEventLog() {
  eventLogEl.innerHTML = "";
  lastEventIdx = 0;
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

function drawWeaponFallbackTyped(
  shape: WeaponShapeRender,
  fallbackColor: string
) {
  const { baseX, baseY, tipX, tipY, type } = shape;
  const bsX = toScreen(shape.bladeStartX, shape.bladeStartY);
  const base = toScreen(baseX, baseY);
  const tip = toScreen(tipX, tipY);
  const tipR = shape.tipR * MAP * VISUAL_SCALE;

  // Draw shaft (arm from ball center to damage zone start)
  ctx.strokeStyle = fallbackColor;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  if (type === "blade") {
    ctx.lineTo(bsX.x, bsX.y);
  } else {
    ctx.lineTo(tip.x, tip.y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  switch (type) {
    case "blade": {
      // Thick flat-ended blade stroke from bladeStart to tip
      const bladeW = Math.max(2, shape.bladeWidth * MAP * VISUAL_SCALE * 2);
      ctx.strokeStyle = fallbackColor;
      ctx.lineWidth = bladeW;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(bsX.x, bsX.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      // Edge highlight
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bsX.x, bsX.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      break;
    }
    case "point": {
      // Small white dot at tip
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(2, tipR), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = fallbackColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(2, tipR), 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "blunt":
    default: {
      // Large filled circle at tip
      ctx.fillStyle = fallbackColor;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(3, tipR), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.max(3, tipR), 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

function drawWeaponSpriteOrFallback(
  shape: WeaponShapeRender,
  theta: number,
  img: HTMLImageElement | null,
  fallbackColor: string
) {
  const ang = thetaToRad(theta);

  // Fallback: type-aware drawing
  if (!img) {
    drawWeaponFallbackTyped(shape, fallbackColor);
    return;
  }

  const base = toScreen(shape.baseX, shape.baseY);
  const tip = toScreen(shape.tipX, shape.tipY);

  // Draw sprite so it is always visible:
  const armLen = Math.hypot(tip.x - base.x, tip.y - base.y);
  const w = armLen * 1.35;
  const h = armLen * 0.45;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  ctx.translate(tip.x, tip.y);
  ctx.rotate(ang);

  const ox = -w * WEAPON_TIP_ANCHOR_X;
  const oy = -h * WEAPON_TIP_ANCHOR_Y;
  ctx.drawImage(img, ox, oy, w, h);

  ctx.restore();
}

// --- Banner overlay ---
const matchBanner = getElementByIdOrThrow<HTMLDivElement>("matchBanner", "div");
const matchBannerText = getElementByIdOrThrow<HTMLDivElement>("matchBannerText", "div");
const matchBannerCountdown = getElementByIdOrThrow<HTMLDivElement>("matchBannerCountdown", "div");
let bannerTimeout: ReturnType<typeof setTimeout> | null = null;
let bannerInterval: ReturnType<typeof setInterval> | null = null;

function clearBannerTimers() {
  if (bannerTimeout) { clearTimeout(bannerTimeout); bannerTimeout = null; }
  if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
}

function showBanner(text: string, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    clearBannerTimers();
    matchBannerText.textContent = text;
    matchBannerCountdown.textContent = "";
    matchBanner.classList.remove("hidden");
    bannerTimeout = setTimeout(() => {
      matchBanner.classList.add("hidden");
      clearBannerTimers();
      resolve();
    }, durationMs);
  });
}

const BREAK_DURATION_MS = 60_000;

function showBreakCountdown(nextMatchLabel: string): Promise<void> {
  return new Promise((resolve) => {
    clearBannerTimers();
    matchBanner.classList.remove("hidden");
    matchBannerText.textContent = nextMatchLabel;

    let remaining = Math.ceil(BREAK_DURATION_MS / 1000);
    matchBannerCountdown.textContent = `${remaining}s`;

    bannerInterval = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        matchBannerCountdown.textContent = `${remaining}s`;
      }
    }, 1000);

    bannerTimeout = setTimeout(() => {
      matchBanner.classList.add("hidden");
      clearBannerTimers();
      resolve();
    }, BREAK_DURATION_MS);
  });
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

  // Define weapon shapes for rendering
  const shapeA = getWeaponShapeForRender(sim, sim.A);
  const shapeB = getWeaponShapeForRender(sim, sim.B);

  const Atip = toScreen(shapeA.tipX, shapeA.tipY);
  const Btip = toScreen(shapeB.tipX, shapeB.tipY);

  // Draw weapons (behind balls) — type-aware fallback or sprite
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  drawWeaponSpriteOrFallback(shapeA, sim.A.theta, weaponAImg, "#b00000");
  drawWeaponSpriteOrFallback(shapeB, sim.B.theta, weaponBImg, "#0b4ed6");
  ctx.restore();

  // Draw balls (on top of weapons)
  drawBallSpriteOrFallback(Apos.x, Apos.y, Ar, ballAImg, "#e74c3c");
  drawBallSpriteOrFallback(Bpos.x, Bpos.y, Br, ballBImg, "#3498db");

  // End arena clip region
  ctx.restore();

  // Update HUD
  const batchLabel = batch ? `Match ${batch.currentIdx + 1}/${batch.totalCount}  ` : "";
  tickReadout.textContent = sim.done
    ? `${batchLabel}tick: ${sim.tick} (DONE - Winner: ${sim.winner})`
    : `${batchLabel}tick: ${sim.tick}`;

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

  if (running && !matchPaused) {
    // Time scaling happens HERE:
    // real time * speed => simulated time
    accumulatorMs += deltaMs * speed;

    // Process as many fixed ticks as we owe
    while (accumulatorMs >= MS_PER_TICK) {
      if (!sim.done) {
        stepSim(sim);
      } else if (batch) {
        // Match just ended — trigger next match in batch
        onMatchFinished();
        accumulatorMs = 0;
        break;
      }
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

// ============================================================
// Batch scheduler — each match is visualized on the canvas
// ============================================================
const batchCountInput = getElementByIdOrThrow<HTMLInputElement>("batchCount", "input");
const runBatchBtn = getElementByIdOrThrow<HTMLButtonElement>("runBatch", "button");
const batchPanel = getElementByIdOrThrow<HTMLDivElement>("batchPanel", "div");
const batchSummary = getElementByIdOrThrow<HTMLDivElement>("batchSummary", "div");
const batchLog = getElementByIdOrThrow<HTMLDivElement>("batchLog", "div");

type MatchResult = {
  matchNum: number;
  seed: number;
  winner: "A" | "B";
  ticks: number;
  hpA: number;
  hpB: number;
  reason: "kill" | "timeout";
};

type BatchState = {
  seeds: number[];
  totalCount: number;
  currentIdx: number;
  results: MatchResult[];
  rowElements: HTMLDivElement[];
  finished: boolean;
};

let batch: BatchState | null = null;
let matchPaused = false; // true during inter-match banner

function generateSeeds(count: number): number[] {
  const buf = new Uint32Array(count);
  crypto.getRandomValues(buf);
  return Array.from(buf);
}

function updateBatchSummary() {
  if (!batch) return;
  const total = batch.results.length;
  const winsA = batch.results.filter(r => r.winner === "A").length;
  const winsB = total - winsA;
  const pctA = total > 0 ? ((winsA / total) * 100).toFixed(1) : "0";
  const pctB = total > 0 ? ((winsB / total) * 100).toFixed(1) : "0";

  const progress = batch.finished ? "" : ` (${batch.currentIdx + 1}/${batch.totalCount} playing)`;
  batchSummary.innerHTML =
    `<strong>Results: ${total}/${batch.totalCount}${progress}</strong> &mdash; ` +
    `<span class="summary-a">A: ${winsA} (${pctA}%)</span> &mdash; ` +
    `<span class="summary-b">B: ${winsB} (${pctB}%)</span>`;
}

function appendMatchRow(matchNum: number): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "batch-row batch-pending";
  row.textContent = `#${matchNum}  playing...`;
  batchLog.appendChild(row);
  batchLog.scrollTop = batchLog.scrollHeight;
  return row;
}

function updateMatchRow(row: HTMLDivElement, r: MatchResult, showSeed: boolean) {
  row.className = `batch-row batch-winner-${r.winner.toLowerCase()}`;
  const seedStr = showSeed ? `seed:${r.seed}` : "seed:****";
  row.textContent =
    `#${r.matchNum}  ${seedStr}  winner:${r.winner}  ticks:${r.ticks}  ` +
    `HP[A:${r.hpA} B:${r.hpB}]  ${r.reason}`;
}

function revealAllSeeds() {
  if (!batch) return;
  for (let i = 0; i < batch.results.length; i++) {
    updateMatchRow(batch.rowElements[i]!, batch.results[i]!, true);
  }
}

function startMatch(seed: number) {
  const spec: MatchSpec = { ...matchSpec, seed };
  sim = createSim(spec);
  resetEventLog();
  accumulatorMs = 0;
}

function onMatchFinished() {
  if (!batch) return;

  const idx = batch.currentIdx;
  const lastEvent = sim.events[sim.events.length - 1];
  const reason = lastEvent && lastEvent.e === "timeout" ? "timeout" as const : "kill" as const;
  const result: MatchResult = {
    matchNum: idx + 1,
    seed: batch.seeds[idx]!,
    winner: sim.winner!,
    ticks: sim.tick,
    hpA: Math.max(0, sim.A.hp),
    hpB: Math.max(0, sim.B.hp),
    reason,
  };
  batch.results.push(result);
  updateMatchRow(batch.rowElements[idx]!, result, false);
  updateBatchSummary();

  // Next match or finish
  const nextIdx = idx + 1;
  if (nextIdx < batch.totalCount) {
    matchPaused = true;
    showBreakCountdown(`Next: Match ${nextIdx + 1} of ${batch.totalCount}`).then(() => {
      if (!batch) return;
      batch.currentIdx = nextIdx;
      const row = appendMatchRow(nextIdx + 1);
      batch.rowElements.push(row);
      startMatch(batch.seeds[nextIdx]!);
      matchPaused = false;
    });
  } else {
    // Batch complete — reveal seeds
    batch.finished = true;
    revealAllSeeds();
    updateBatchSummary();
    runBatchBtn.disabled = false;
    runBatchBtn.textContent = "Run Batch";
    showBanner("Batch Complete!", 2000);
  }
}

function startBatch(count: number) {
  if (batch && !batch.finished) return;

  const seeds = generateSeeds(count);
  batchLog.innerHTML = "";
  batchPanel.classList.remove("hidden");

  const firstRow = appendMatchRow(1);

  batch = {
    seeds,
    totalCount: count,
    currentIdx: 0,
    results: [],
    rowElements: [firstRow],
    finished: false,
  };

  runBatchBtn.disabled = true;
  runBatchBtn.textContent = "Running...";

  updateBatchSummary();

  // Ensure playback is running
  running = true;
  playPauseBtn.textContent = "Pause";

  showBanner(`Match 1 of ${count}`, 1500).then(() => {
    if (!batch) return;
    startMatch(seeds[0]!);
    matchPaused = false;
  });
}

runBatchBtn.addEventListener("click", () => {
  const count = Math.max(1, Math.min(1000, parseInt(batchCountInput.value, 10) || 10));
  batchCountInput.value = String(count);
  matchPaused = true;
  startBatch(count);
});

// ============================================================
// Admin panel — tabs, weapon editor, fighter editor, preview
// ============================================================

// --- Tab switching ---
const adminTabs = document.querySelectorAll<HTMLButtonElement>(".admin-tab");
const adminTabContents = document.querySelectorAll<HTMLDivElement>(".admin-tab-content");

adminTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    adminTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === target));
    adminTabContents.forEach((c) => c.classList.toggle("active", c.id === `tab-${target}`));
    if (target === "weapons") refreshWeaponPreview();
  });
});

// --- Weapon editor ---
const weaponSelect = getElementByIdOrThrow<HTMLSelectElement>("weaponSelect", "select");
const weaponNewBtn = getElementByIdOrThrow<HTMLButtonElement>("weaponNew", "button");
const weaponDeleteBtn = getElementByIdOrThrow<HTMLButtonElement>("weaponDelete", "button");
const weaponSaveBtn = getElementByIdOrThrow<HTMLButtonElement>("weaponSave", "button");

// Field inputs
const wfName = getElementByIdOrThrow<HTMLInputElement>("wf-name", "input");
const wfType = getElementByIdOrThrow<HTMLSelectElement>("wf-type", "select");
const wfReach = getElementByIdOrThrow<HTMLInputElement>("wf-reach", "input");
const wfTipRadius = getElementByIdOrThrow<HTMLInputElement>("wf-tipRadius", "input");
const wfOmega = getElementByIdOrThrow<HTMLInputElement>("wf-omega", "input");
const wfBaseDamage = getElementByIdOrThrow<HTMLInputElement>("wf-baseDamage", "input");
const wfRamp = getElementByIdOrThrow<HTMLInputElement>("wf-ramp", "input");
const wfSpeedMult = getElementByIdOrThrow<HTMLInputElement>("wf-speedMult", "input");
const wfWeight = getElementByIdOrThrow<HTMLInputElement>("wf-weight", "input");
const wfBladeStart = getElementByIdOrThrow<HTMLInputElement>("wf-bladeStart", "input");
const wfBladeWidth = getElementByIdOrThrow<HTMLInputElement>("wf-bladeWidth", "input");
const wfShaftRadius = getElementByIdOrThrow<HTMLInputElement>("wf-shaftRadius", "input");

const weaponPreviewCanvas = getElementByIdOrThrow<HTMLCanvasElement>("weaponPreview", "canvas");
const wpCtx = weaponPreviewCanvas.getContext("2d")!;
const previewHint = getElementByIdOrThrow<HTMLDivElement>("previewHint", "div");

function populateWeaponSelect() {
  weaponSelect.innerHTML = "";
  for (const name of Object.keys(matchSpec.weapons)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    weaponSelect.appendChild(opt);
  }
}

function updateBladeFieldVisibility() {
  const isBlade = wfType.value === "blade";
  document.querySelectorAll<HTMLElement>(".blade-field").forEach((el) => {
    el.style.display = isBlade ? "" : "none";
  });
}

function loadWeaponFields(name: string) {
  const w = matchSpec.weapons[name];
  if (!w) return;
  wfName.value = name;
  wfType.value = w.type ?? "point";
  wfReach.value = String(w.reach);
  wfTipRadius.value = String(w.tipRadius);
  wfOmega.value = String(w.omega);
  wfBaseDamage.value = String(w.baseDamage);
  wfRamp.value = String(w.ramp);
  wfSpeedMult.value = String(w.speedMult);
  wfWeight.value = String(w.weight);
  wfBladeStart.value = String(w.bladeStart ?? Math.round(w.reach * 0.4));
  wfBladeWidth.value = String(w.bladeWidth ?? w.tipRadius);
  wfShaftRadius.value = String(w.shaftRadius ?? 8);
  updateBladeFieldVisibility();
  refreshWeaponPreview();
}

function refreshWeaponPreview() {
  const W = weaponPreviewCanvas.width;
  const H = weaponPreviewCanvas.height;
  const cx = W / 2;
  const cy = H / 2;

  wpCtx.clearRect(0, 0, W, H);

  const wtype = (wfType.value || "point") as WeaponType;
  const reach = parseInt(wfReach.value, 10) || 60;
  const tipR = parseInt(wfTipRadius.value, 10) || 15;
  const bladeStart = parseInt(wfBladeStart.value, 10) || Math.round(reach * 0.4);
  const bladeWidth = parseInt(wfBladeWidth.value, 10) || tipR;
  const shaftR = parseInt(wfShaftRadius.value, 10) || 8;

  // Scale so reach+tipR fits in the canvas with padding
  const maxExtent = reach + tipR;
  const scale = (W * 0.42) / maxExtent;

  const ballR = 42 * scale; // reference ball size from matchSpec

  // Ball body
  wpCtx.fillStyle = "rgba(150,150,150,0.3)";
  wpCtx.strokeStyle = "#666";
  wpCtx.lineWidth = 1;
  wpCtx.beginPath();
  wpCtx.arc(cx, cy, ballR, 0, Math.PI * 2);
  wpCtx.fill();
  wpCtx.stroke();

  const tipX = cx + reach * scale;
  const tipY = cy;
  const bsX = cx + bladeStart * scale;

  // Shaft hitbox (deflection zone — transparent overlay)
  const shaftEndX = wtype === "blade" ? bsX : tipX;
  wpCtx.fillStyle = "rgba(100, 200, 255, 0.12)";
  wpCtx.strokeStyle = "rgba(100, 200, 255, 0.3)";
  wpCtx.lineWidth = 1;
  // Draw shaft capsule as a rounded rect approximation
  const shaftW = shaftR * scale;
  wpCtx.beginPath();
  wpCtx.moveTo(cx, cy - shaftW);
  wpCtx.lineTo(shaftEndX, cy - shaftW);
  wpCtx.arc(shaftEndX, cy, shaftW, -Math.PI / 2, Math.PI / 2);
  wpCtx.lineTo(cx, cy + shaftW);
  wpCtx.arc(cx, cy, shaftW, Math.PI / 2, -Math.PI / 2);
  wpCtx.closePath();
  wpCtx.fill();
  wpCtx.stroke();

  // Weapon arm line
  wpCtx.strokeStyle = "#888";
  wpCtx.lineWidth = 3;
  wpCtx.beginPath();
  wpCtx.moveTo(cx, cy);
  wpCtx.lineTo(tipX, tipY);
  wpCtx.stroke();

  // Type-specific damage hitbox
  switch (wtype) {
    case "blade": {
      // Capsule from bladeStart to tip
      const bw = bladeWidth * scale;
      wpCtx.fillStyle = "rgba(231, 76, 60, 0.25)";
      wpCtx.strokeStyle = "#e74c3c";
      wpCtx.lineWidth = 2;
      wpCtx.beginPath();
      wpCtx.moveTo(bsX, cy - bw);
      wpCtx.lineTo(tipX, cy - bw);
      wpCtx.arc(tipX, cy, bw, -Math.PI / 2, Math.PI / 2);
      wpCtx.lineTo(bsX, cy + bw);
      wpCtx.arc(bsX, cy, bw, Math.PI / 2, -Math.PI / 2);
      wpCtx.closePath();
      wpCtx.fill();
      wpCtx.stroke();
      // Edge highlight
      wpCtx.strokeStyle = "rgba(255,255,255,0.25)";
      wpCtx.lineWidth = 1;
      wpCtx.beginPath();
      wpCtx.moveTo(bsX, cy - bw);
      wpCtx.lineTo(tipX, cy - bw);
      wpCtx.stroke();
      previewHint.textContent = `blade: capsule ${bladeStart}\u2192${reach}, w=${bladeWidth}`;
      break;
    }
    case "point": {
      // Small circle at tip
      wpCtx.fillStyle = "rgba(255, 255, 255, 0.5)";
      wpCtx.strokeStyle = "#e74c3c";
      wpCtx.lineWidth = 2;
      wpCtx.beginPath();
      wpCtx.arc(tipX, tipY, tipR * scale, 0, Math.PI * 2);
      wpCtx.fill();
      wpCtx.stroke();
      previewHint.textContent = `point: circle r=${tipR} at reach=${reach}`;
      break;
    }
    case "blunt":
    default: {
      // Large circle at tip
      wpCtx.fillStyle = "rgba(231, 76, 60, 0.35)";
      wpCtx.strokeStyle = "#e74c3c";
      wpCtx.lineWidth = 2;
      wpCtx.beginPath();
      wpCtx.arc(tipX, tipY, tipR * scale, 0, Math.PI * 2);
      wpCtx.fill();
      wpCtx.stroke();
      previewHint.textContent = `blunt: circle r=${tipR} at reach=${reach}, 1.5\u00d7 knockback`;
      break;
    }
  }

  // Reach arc (dashed)
  wpCtx.strokeStyle = "rgba(255,255,255,0.15)";
  wpCtx.lineWidth = 1;
  wpCtx.setLineDash([4, 4]);
  wpCtx.beginPath();
  wpCtx.arc(cx, cy, reach * scale, 0, Math.PI * 2);
  wpCtx.stroke();
  wpCtx.setLineDash([]);

  // Labels
  wpCtx.fillStyle = "#888";
  wpCtx.font = "10px monospace";
  wpCtx.fillText(`type: ${wtype}`, 4, 14);
  wpCtx.fillText(`reach: ${reach}  tipR: ${tipR}`, 4, 26);
  wpCtx.fillText(`shaft: ${shaftR}`, 4, 38);
}

weaponSelect.addEventListener("change", () => {
  loadWeaponFields(weaponSelect.value);
});

// Live preview on field changes
[wfReach, wfTipRadius, wfBladeStart, wfBladeWidth, wfShaftRadius].forEach((input) => {
  input.addEventListener("input", refreshWeaponPreview);
});
wfType.addEventListener("change", () => {
  updateBladeFieldVisibility();
  refreshWeaponPreview();
});

weaponNewBtn.addEventListener("click", () => {
  let name = "new_weapon";
  let i = 1;
  while (matchSpec.weapons[name]) { name = `new_weapon_${i++}`; }
  matchSpec.weapons[name] = {
    type: "point" as WeaponType,
    reach: 60, tipRadius: 20, omega: 1500,
    baseDamage: 10, ramp: 2, speedMult: 1000, weight: 1000,
    shaftRadius: 8,
  };
  populateWeaponSelect();
  populateWeaponDropdowns();
  weaponSelect.value = name;
  loadWeaponFields(name);
});

weaponDeleteBtn.addEventListener("click", () => {
  const name = weaponSelect.value;
  if (Object.keys(matchSpec.weapons).length <= 1) return; // keep at least one
  delete matchSpec.weapons[name];
  populateWeaponSelect();
  populateWeaponDropdowns();
  loadWeaponFields(weaponSelect.value);
});

weaponSaveBtn.addEventListener("click", () => {
  const oldName = weaponSelect.value;
  const newName = wfName.value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!newName) return;

  const weaponType = (wfType.value || "point") as WeaponType;
  const reach = parseInt(wfReach.value, 10) || 60;
  const tipRadius = parseInt(wfTipRadius.value, 10) || 15;

  const def: Record<string, unknown> = {
    type: weaponType,
    reach,
    tipRadius,
    omega: parseInt(wfOmega.value, 10) || 1500,
    baseDamage: parseInt(wfBaseDamage.value, 10) || 10,
    ramp: parseInt(wfRamp.value, 10) || 2,
    speedMult: parseInt(wfSpeedMult.value, 10) || 1000,
    weight: parseInt(wfWeight.value, 10) || 1000,
    shaftRadius: parseInt(wfShaftRadius.value, 10) || 8,
  };

  // Blade-specific fields
  if (weaponType === "blade") {
    def.bladeStart = parseInt(wfBladeStart.value, 10) || Math.round(reach * 0.4);
    def.bladeWidth = parseInt(wfBladeWidth.value, 10) || tipRadius;
  }

  // If renamed, remove old key
  if (newName !== oldName) {
    delete matchSpec.weapons[oldName];
    // Update fighter refs if they pointed to the old name
    if (matchSpec.ballA.weaponId === oldName) matchSpec.ballA.weaponId = newName;
    if (matchSpec.ballB.weaponId === oldName) matchSpec.ballB.weaponId = newName;
  }
  matchSpec.weapons[newName] = def as unknown as MatchSpec["weapons"][string];
  populateWeaponSelect();
  populateWeaponDropdowns();
  weaponSelect.value = newName;
  loadWeaponFields(newName);

  // Restart sim with new spec
  sim = createSim(matchSpec);
  resetEventLog();
});

// --- Fighter editor ---
const ffAHp = getElementByIdOrThrow<HTMLInputElement>("ff-a-hp", "input");
const ffARadius = getElementByIdOrThrow<HTMLInputElement>("ff-a-radius", "input");
const ffAWeapon = getElementByIdOrThrow<HTMLSelectElement>("ff-a-weapon", "select");
const ffAPosX = getElementByIdOrThrow<HTMLInputElement>("ff-a-posX", "input");
const ffAPosY = getElementByIdOrThrow<HTMLInputElement>("ff-a-posY", "input");
const ffAVelX = getElementByIdOrThrow<HTMLInputElement>("ff-a-velX", "input");
const ffAVelY = getElementByIdOrThrow<HTMLInputElement>("ff-a-velY", "input");
const ffARestitution = getElementByIdOrThrow<HTMLInputElement>("ff-a-restitution", "input");

const ffBHp = getElementByIdOrThrow<HTMLInputElement>("ff-b-hp", "input");
const ffBRadius = getElementByIdOrThrow<HTMLInputElement>("ff-b-radius", "input");
const ffBWeapon = getElementByIdOrThrow<HTMLSelectElement>("ff-b-weapon", "select");
const ffBPosX = getElementByIdOrThrow<HTMLInputElement>("ff-b-posX", "input");
const ffBPosY = getElementByIdOrThrow<HTMLInputElement>("ff-b-posY", "input");
const ffBVelX = getElementByIdOrThrow<HTMLInputElement>("ff-b-velX", "input");
const ffBVelY = getElementByIdOrThrow<HTMLInputElement>("ff-b-velY", "input");
const ffBRestitution = getElementByIdOrThrow<HTMLInputElement>("ff-b-restitution", "input");

const fighterSaveBtn = getElementByIdOrThrow<HTMLButtonElement>("fighterSave", "button");

function populateWeaponDropdowns() {
  const names = Object.keys(matchSpec.weapons);
  [ffAWeapon, ffBWeapon].forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = "";
    for (const n of names) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    }
    if (names.includes(prev)) sel.value = prev;
  });
}

function loadFighterFields() {
  const a = matchSpec.ballA;
  const b = matchSpec.ballB;
  ffAHp.value = String(a.hp);
  ffARadius.value = String(a.radius);
  ffAWeapon.value = a.weaponId;
  ffAPosX.value = String(a.pos.x);
  ffAPosY.value = String(a.pos.y);
  ffAVelX.value = String(a.vel.x);
  ffAVelY.value = String(a.vel.y);
  ffARestitution.value = String(a.restitution ?? 1000);

  ffBHp.value = String(b.hp);
  ffBRadius.value = String(b.radius);
  ffBWeapon.value = b.weaponId;
  ffBPosX.value = String(b.pos.x);
  ffBPosY.value = String(b.pos.y);
  ffBVelX.value = String(b.vel.x);
  ffBVelY.value = String(b.vel.y);
  ffBRestitution.value = String(b.restitution ?? 1000);
}

fighterSaveBtn.addEventListener("click", () => {
  matchSpec.ballA.hp = parseInt(ffAHp.value, 10) || 1000;
  matchSpec.ballA.radius = parseInt(ffARadius.value, 10) || 42;
  matchSpec.ballA.weaponId = ffAWeapon.value;
  matchSpec.ballA.pos = { x: parseInt(ffAPosX.value, 10) || 0, y: parseInt(ffAPosY.value, 10) || 0 };
  matchSpec.ballA.vel = { x: parseInt(ffAVelX.value, 10) || 0, y: parseInt(ffAVelY.value, 10) || 0 };
  matchSpec.ballA.restitution = parseInt(ffARestitution.value, 10) || 1000;

  matchSpec.ballB.hp = parseInt(ffBHp.value, 10) || 1000;
  matchSpec.ballB.radius = parseInt(ffBRadius.value, 10) || 42;
  matchSpec.ballB.weaponId = ffBWeapon.value;
  matchSpec.ballB.pos = { x: parseInt(ffBPosX.value, 10) || 0, y: parseInt(ffBPosY.value, 10) || 0 };
  matchSpec.ballB.vel = { x: parseInt(ffBVelX.value, 10) || 0, y: parseInt(ffBVelY.value, 10) || 0 };
  matchSpec.ballB.restitution = parseInt(ffBRestitution.value, 10) || 1000;

  // Restart sim with new spec
  sim = createSim(matchSpec);
  resetEventLog();
});

// --- Initialize admin state ---
populateWeaponSelect();
populateWeaponDropdowns();
if (Object.keys(matchSpec.weapons).length > 0) {
  loadWeaponFields(weaponSelect.value);
}
loadFighterFields();

// Start
requestAnimationFrame(frame);
