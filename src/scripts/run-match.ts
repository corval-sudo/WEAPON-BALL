// src/scripts/run-match.ts
// CLI tool to run a match between two roster balls
import { ArenaDatabase } from "../data/database";
import { MatchRunner } from "../match/runner";
import { generateMatchSummary } from "../analysis/summary";
import * as fs from "node:fs";
import * as path from "node:path";

async function runMatch() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: npm run match <ball1_name> <ball2_name> [seed]");
    console.error("");
    console.error("Example: npm run match 'Crimson Crusher' 'Azure Assassin'");
    console.error("         npm run match 'Crimson Crusher' 'Azure Assassin' 12345");
    process.exit(1);
  }

  const ball1Name = args[0]!;
  const ball2Name = args[1]!;
  const customSeed = args[2] ? parseInt(args[2], 10) : undefined;

  const db = new ArenaDatabase();
  const balls = db.getAllBalls();

  // Find balls by name (case-insensitive partial match)
  const ballA = balls.find(b =>
    b.name.toLowerCase().includes(ball1Name.toLowerCase())
  );
  const ballB = balls.find(b =>
    b.name.toLowerCase().includes(ball2Name.toLowerCase())
  );

  if (!ballA) {
    console.error(`❌ Ball not found: "${ball1Name}"`);
    console.error("\nAvailable balls:");
    balls.forEach(b => console.error(`  - ${b.name}`));
    db.close();
    process.exit(1);
  }

  if (!ballB) {
    console.error(`❌ Ball not found: "${ball2Name}"`);
    console.error("\nAvailable balls:");
    balls.forEach(b => console.error(`  - ${b.name}`));
    db.close();
    process.exit(1);
  }

  if (ballA.id === ballB.id) {
    console.error("❌ Cannot match a ball against itself");
    db.close();
    process.exit(1);
  }

  // Display matchup
  console.log("\n" + "=".repeat(60));
  console.log("⚔️  MATCH SETUP");
  console.log("=".repeat(60) + "\n");

  console.log(`${ballA.name} (${ballA.weaponId})`);
  console.log(`  Record: ${ballA.wins}-${ballA.losses}`);
  console.log(`  HP: ${ballA.baseHp} | Radius: ${ballA.radius}`);
  console.log(`  Streak: ${ballA.currentStreak > 0 ? '+' : ''}${ballA.currentStreak}`);
  console.log(`  "${ballA.personality}"`);
  console.log("");
  console.log("                       VS");
  console.log("");
  console.log(`${ballB.name} (${ballB.weaponId})`);
  console.log(`  Record: ${ballB.wins}-${ballB.losses}`);
  console.log(`  HP: ${ballB.baseHp} | Radius: ${ballB.radius}`);
  console.log(`  Streak: ${ballB.currentStreak > 0 ? '+' : ''}${ballB.currentStreak}`);
  console.log(`  "${ballB.personality}"`);
  console.log("");

  // Load match configuration
  const matchSpecPath = path.join(__dirname, "../../matchSpec.json");
  const matchSpec = JSON.parse(fs.readFileSync(matchSpecPath, "utf-8"));

  // Run the match
  const seed = customSeed ?? Math.floor(Math.random() * 1000000);
  console.log("=".repeat(60));
  console.log(`⚡ RUNNING SIMULATION (seed: ${seed})`);
  console.log("=".repeat(60) + "\n");

  const runner = new MatchRunner(db);
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

  // Generate and display summary
  const summary = generateMatchSummary(result, ballA, ballB);

  console.log("=".repeat(60));
  console.log("📊 MATCH RESULT");
  console.log("=".repeat(60) + "\n");

  console.log(`🏆 ${summary.title.toUpperCase()}\n`);
  console.log(summary.description + "\n");
  console.log(summary.winnerStatement + "\n");

  if (summary.highlights.length > 0) {
    console.log("🎬 HIGHLIGHTS:");
    summary.highlights.forEach(h => console.log(`   ${h}`));
    console.log();
  }

  console.log("📈 DETAILED STATISTICS:\n");
  console.log(summary.stats);
  console.log();

  // Show updated records
  const updatedA = db.getBallById(ballA.id)!;
  const updatedB = db.getBallById(ballB.id)!;

  console.log("=".repeat(60));
  console.log("📝 UPDATED CAREER RECORDS");
  console.log("=".repeat(60) + "\n");

  console.log(`${updatedA.name}:`);
  console.log(`  Record: ${updatedA.wins}-${updatedA.losses} (was ${ballA.wins}-${ballA.losses})`);
  console.log(`  Streak: ${updatedA.currentStreak > 0 ? '+' : ''}${updatedA.currentStreak} (was ${ballA.currentStreak > 0 ? '+' : ''}${ballA.currentStreak})`);
  console.log(`  Total Damage: ${updatedA.totalDamageDealt} dealt / ${updatedA.totalDamageTaken} taken`);
  console.log("");

  console.log(`${updatedB.name}:`);
  console.log(`  Record: ${updatedB.wins}-${updatedB.losses} (was ${ballB.wins}-${ballB.losses})`);
  console.log(`  Streak: ${updatedB.currentStreak > 0 ? '+' : ''}${updatedB.currentStreak} (was ${ballB.currentStreak > 0 ? '+' : ''}${ballB.currentStreak})`);
  console.log(`  Total Damage: ${updatedB.totalDamageDealt} dealt / ${updatedB.totalDamageTaken} taken`);
  console.log("");

  db.close();
}

runMatch().catch(error => {
  console.error("\n❌ Error running match:", error.message);
  process.exit(1);
});
