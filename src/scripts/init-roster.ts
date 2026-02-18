// src/scripts/init-roster.ts
import { ArenaDatabase } from "../data/database";
import { createBall } from "../data/roster";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const STARTER_BALLS_PATH = path.join(__dirname, "../../config/starter-balls.json");

function initializeRoster() {
  const db = new ArenaDatabase();

  // Load starter template
  const starterData = JSON.parse(
    fs.readFileSync(STARTER_BALLS_PATH, "utf-8")
  );

  console.log(`Initializing roster with ${starterData.balls.length} balls...\n`);

  for (const template of starterData.balls) {
    const ball = createBall({
      id: randomUUID(),
      name: template.name,
      personality: template.personality,
      color: template.color,
      baseHp: template.baseHp,
      radius: template.radius,
      weaponId: template.weaponId,
      restitution: template.restitution ?? 1000,
      wins: 0,
      losses: 0,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      longestWinStreak: 0,
      currentStreak: 0,
      retired: false,
    });

    db.insertBall(ball);
    console.log(`✓ Created: ${ball.name} (${ball.weaponId})`);
  }

  db.close();
  console.log(`\n✓ Roster initialized successfully!`);
}

initializeRoster();
