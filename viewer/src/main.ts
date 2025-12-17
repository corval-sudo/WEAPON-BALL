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

function drawBall(x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Draw balls
  const Ax = sim.A.pos.x / sim.SCALE;
  const Ay = sim.A.pos.y / sim.SCALE;
  const Ar = sim.A.r / sim.SCALE;

  const Bx = sim.B.pos.x / sim.SCALE;
  const By = sim.B.pos.y / sim.SCALE;
  const Br = sim.B.r / sim.SCALE;

  drawBall(Ax, Ay, Ar, "red");
  drawBall(Bx, By, Br, "dodgerblue");

  // Draw weapon arms + tips
  const Atip = getWeaponTipForRender(sim, sim.A);
  const Btip = getWeaponTipForRender(sim, sim.B);

  // arms
  ctx.strokeStyle = "red";
  ctx.beginPath();
  ctx.moveTo(Ax, Ay);
  ctx.lineTo(Atip.x, Atip.y);
  ctx.stroke();

  ctx.strokeStyle = "dodgerblue";
  ctx.beginPath();
  ctx.moveTo(Bx, By);
  ctx.lineTo(Btip.x, Btip.y);
  ctx.stroke();

  // tips
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(Atip.x, Atip.y, sim.A.tipR / sim.SCALE, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "dodgerblue";
  ctx.beginPath();
  ctx.arc(Btip.x, Btip.y, sim.B.tipR / sim.SCALE, 0, Math.PI * 2);
  ctx.fill();

  tickReadout.textContent = sim.done
    ? `tick: ${sim.tick} (DONE winner: ${sim.winner})`
    : `tick: ${sim.tick}`;
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