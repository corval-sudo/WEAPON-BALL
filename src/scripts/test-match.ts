// src/scripts/test-match.ts
// Test script to verify the complete workflow: roster → match → stats → summary
import { ArenaDatabase } from "../data/database";
import { MatchRunner } from "../match/runner";
import { generateMatchSummary } from "../analysis/summary";
import * as fs from "node:fs";
import * as path from "node:path";

async function testMatch() {
  console.log("🎮 WORBZ Arena - Match Test\n");
  console.log("=" + "=".repeat(50) + "\n");

  // 1. Load database and get active balls
  const db = new ArenaDatabase();
  const balls = db.getActiveBalls();

  if (balls.length < 2) {
    console.error("❌ Not enough balls in roster. Run 'npm run init-roster' first.");
    db.close();
    return;
  }

  console.log(`✓ Loaded roster with ${balls.length} active balls\n`);

  // 2. Select two random balls for the match
  const ballA = balls[Math.floor(Math.random() * balls.length)]!;
  let ballB = balls[Math.floor(Math.random() * balls.length)]!;

  // Ensure different balls
  while (ballB.id === ballA.id) {
    ballB = balls[Math.floor(Math.random() * balls.length)]!;
  }

  console.log(`⚔️  MATCHUP:\n`);
  console.log(`   ${ballA.name} (${ballA.weaponId})`);
  console.log(`   Record: ${ballA.wins}-${ballA.losses}`);
  console.log(`   HP: ${ballA.baseHp} | Streak: ${ballA.currentStreak > 0 ? '+' : ''}${ballA.currentStreak}\n`);

  console.log(`   vs\n`);

  console.log(`   ${ballB.name} (${ballB.weaponId})`);
  console.log(`   Record: ${ballB.wins}-${ballB.losses}`);
  console.log(`   HP: ${ballB.baseHp} | Streak: ${ballB.currentStreak > 0 ? '+' : ''}${ballB.currentStreak}\n`);

  console.log("=" + "=".repeat(50) + "\n");

  // 3. Load match configuration from matchSpec.json
  const matchSpecPath = path.join(__dirname, "../../matchSpec.json");
  const matchSpec = JSON.parse(fs.readFileSync(matchSpecPath, "utf-8"));

  // 4. Run the match
  const runner = new MatchRunner(db);
  const seed = Math.floor(Math.random() * 1000000);

  console.log(`⚡ Running simulation (seed: ${seed})...\n`);

  const result = await runner.runMatch({
    ballAId: ballA.id,
    ballBId: ballB.id,
    arenaName: "The Pit",
    seed,
    weapons: matchSpec.weapons,
    arenaConfig: matchSpec.arena,
    simConfig: matchSpec.sim,
    weaponSetVersion: matchSpec.weaponSetVersion,
  });

  console.log("✓ Match complete!\n");
  console.log("=" + "=".repeat(50) + "\n");

  // 5. Generate and display summary
  const summary = generateMatchSummary(result, ballA, ballB);

  console.log(`📊 MATCH SUMMARY\n`);
  console.log(`${summary.title}\n`);
  console.log(`${summary.description}\n`);
  console.log(`${summary.winnerStatement}\n`);

  if (summary.highlights.length > 0) {
    console.log(`🎬 HIGHLIGHTS:`);
    summary.highlights.forEach(h => console.log(`   ${h}`));
    console.log();
  }

  console.log(`📈 STATISTICS:\n${summary.stats}\n`);
  console.log("=" + "=".repeat(50) + "\n");

  // 6. Display updated records
  const updatedBallA = db.getBallById(ballA.id)!;
  const updatedBallB = db.getBallById(ballB.id)!;

  console.log(`📝 UPDATED RECORDS:\n`);
  console.log(`   ${updatedBallA.name}: ${updatedBallA.wins}-${updatedBallA.losses} (Streak: ${updatedBallA.currentStreak > 0 ? '+' : ''}${updatedBallA.currentStreak})`);
  console.log(`   ${updatedBallB.name}: ${updatedBallB.wins}-${updatedBallB.losses} (Streak: ${updatedBallB.currentStreak > 0 ? '+' : ''}${updatedBallB.currentStreak})\n`);

  // 7. Show current rankings
  console.log(`🏆 TOP 5 RANKINGS:\n`);
  const rankings = db.getRankings(5);
  rankings.forEach((ball, idx) => {
    const record = `${ball.wins}-${ball.losses}`;
    const streak = ball.currentStreak > 0 ? `+${ball.currentStreak}` : ball.currentStreak < 0 ? `${ball.currentStreak}` : '0';
    console.log(`   ${idx + 1}. ${ball.name.padEnd(20)} ${record.padEnd(8)} Streak: ${streak}`);
  });

  db.close();
  console.log("\n✅ Test complete!\n");
}

testMatch().catch(error => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
