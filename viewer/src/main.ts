import "./style.css";
import matchSpec from "../../matchSpec.json";
import { createSim, stepSim, getWeaponTipForRender } from "../../src/simCore";
console.log("Loaded matchSpec seed:", matchSpec.seed);

const canvas = document.getElementById("arena") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const playPauseBtn = document.getElementById("playPause") as HTMLButtonElement;
const speedSelect = document.getElementById("speed") as HTMLSelectElement;
const tickReadout = document.getElementById("tickReadout") as HTMLSpanElement;

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
const TICKS_PER_SEC = 60;
const MS_PER_TICK = 1000 / TICKS_PER_SEC;

let running = true;
let speed = Number(speedSelect.value); // 0.25, 0.5, 1, 2, 4, 8
let lastMs = performance.now();
let accumulatorMs = 0;

// --- Demo state (we’ll replace with real sim state next) ---
const sim = createSim(matchSpec as any);

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

  // Draw balls
  const Apos0 = { x: sim.A.pos.x / sim.SCALE, y: sim.A.pos.y / sim.SCALE };
  const Bpos0 = { x: sim.B.pos.x / sim.SCALE, y: sim.B.pos.y / sim.SCALE };

  const Apos = toScreen(Apos0.x, Apos0.y);
  const Bpos = toScreen(Bpos0.x, Bpos0.y);

  const Ar = (sim.A.r / sim.SCALE) * MAP * VISUAL_SCALE;
  const Br = (sim.B.r / sim.SCALE) * MAP * VISUAL_SCALE;

  drawBall(Apos.x, Apos.y, Ar, "red");
  drawBall(Bpos.x, Bpos.y, Br, "dodgerblue");

function withShadow(fn: () => void) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  fn();
  ctx.restore();
}

  // Draw weapon arms + tips
  const Atip0 = getWeaponTipForRender(sim, sim.A);
  const Btip0 = getWeaponTipForRender(sim, sim.B);

  const Atip = toScreen(Atip0.x, Atip0.y);
  const Btip = toScreen(Btip0.x, Btip0.y);

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
      ctx.strokeStyle = "#b00000";
      ctx.beginPath();
      ctx.moveTo(Apos.x, Apos.y);
      ctx.lineTo(Atip.x, Atip.y);
      ctx.stroke();

      // B arm
      ctx.strokeStyle = "#0b4ed6";
      ctx.beginPath();
      ctx.moveTo(Bpos.x, Bpos.y);
      ctx.lineTo(Btip.x, Btip.y);
      ctx.stroke();
    });

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

  tickReadout.textContent = sim.done
    ? `tick: ${sim.tick} (DONE winner: ${sim.winner})`
    : `tick: ${sim.tick}`;
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
  playPauseBtn.textContent = running ? "Pause" : "Play";
});

speedSelect.addEventListener("change", () => {
  speed = Number(speedSelect.value);
});

// Start
requestAnimationFrame(frame);