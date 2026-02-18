// src/data/roster.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { BallEntity, BallRoster } from "./types";

const DEFAULT_ROSTER_PATH = path.join(__dirname, "../../config/roster.json");

export function loadRoster(filePath: string = DEFAULT_ROSTER_PATH): BallRoster {
  if (!fs.existsSync(filePath)) {
    return { balls: [], version: "1.0.0" };
  }
  const data = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(data) as BallRoster;
}

export function saveRoster(roster: BallRoster, filePath: string = DEFAULT_ROSTER_PATH): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(roster, null, 2), "utf-8");
}

export function getBallById(roster: BallRoster, id: string): BallEntity | undefined {
  return roster.balls.find(b => b.id === id);
}

export function getActiveBalls(roster: BallRoster): BallEntity[] {
  return roster.balls.filter(b => !b.retired);
}

export function updateBallStats(
  roster: BallRoster,
  ballId: string,
  update: Partial<BallEntity>
): void {
  const ball = getBallById(roster, ballId);
  if (!ball) throw new Error(`Ball ${ballId} not found in roster`);
  Object.assign(ball, update);
}

export function createBall(ball: Omit<BallEntity, "createdAt">): BallEntity {
  return {
    ...ball,
    createdAt: new Date().toISOString(),
  };
}

export function addBallToRoster(roster: BallRoster, ball: BallEntity): void {
  if (getBallById(roster, ball.id)) {
    throw new Error(`Ball ${ball.id} already exists in roster`);
  }
  roster.balls.push(ball);
}
