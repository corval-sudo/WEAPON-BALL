// src/scripts/roster.ts
// CLI tool to view and query the roster
import { ArenaDatabase } from "../data/database";

function displayRoster() {
  const args = process.argv.slice(2);
  const command = args[0] || "list";

  const db = new ArenaDatabase();

  switch (command) {
    case "list":
    case "ls":
      listAllBalls(db);
      break;

    case "rankings":
    case "rank":
      showRankings(db, parseInt(args[1] || "20", 10));
      break;

    case "info":
    case "show":
      if (!args[1]) {
        console.error("Usage: npm run roster info <ball_name>");
        process.exit(1);
      }
      showBallInfo(db, args[1]);
      break;

    case "stats":
      showRosterStats(db);
      break;

    case "help":
      showHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }

  db.close();
}

function listAllBalls(db: any) {
  const balls = db.getAllBalls();

  console.log("\n" + "=".repeat(80));
  console.log(`📋 ROSTER (${balls.length} fighters)`);
  console.log("=".repeat(80) + "\n");

  balls.forEach((ball: any) => {
    const record = `${ball.wins}-${ball.losses}`;
    const streak = ball.currentStreak > 0 ? `+${ball.currentStreak}` : ball.currentStreak < 0 ? `${ball.currentStreak}` : '0';
    const retired = ball.retired ? " [RETIRED]" : "";

    console.log(`${ball.name.padEnd(25)} ${record.padEnd(8)} Streak: ${streak.padEnd(4)} ${ball.weaponId.padEnd(15)}${retired}`);
  });

  console.log();
}

function showRankings(db: any, limit: number) {
  const rankings = db.getRankings(limit);

  console.log("\n" + "=".repeat(80));
  console.log(`🏆 TOP ${limit} RANKINGS`);
  console.log("=".repeat(80) + "\n");

  console.log("Rank  Fighter                  Record    Streak  Weapon          Dmg Dealt");
  console.log("-".repeat(80));

  rankings.forEach((ball: any, idx: number) => {
    const rank = `${idx + 1}.`.padEnd(6);
    const name = ball.name.padEnd(25);
    const record = `${ball.wins}-${ball.losses}`.padEnd(10);
    const streak = (ball.currentStreak > 0 ? `+${ball.currentStreak}` : ball.currentStreak < 0 ? `${ball.currentStreak}` : '0').padEnd(8);
    const weapon = ball.weaponId.padEnd(16);
    const damage = ball.totalDamageDealt.toString();

    console.log(`${rank}${name}${record}${streak}${weapon}${damage}`);
  });

  console.log();
}

function showBallInfo(db: any, ballName: string) {
  const balls = db.getAllBalls();
  const ball = balls.find((b: any) =>
    b.name.toLowerCase().includes(ballName.toLowerCase())
  );

  if (!ball) {
    console.error(`❌ Ball not found: "${ballName}"`);
    console.error("\nAvailable balls:");
    balls.forEach((b: any) => console.error(`  - ${b.name}`));
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`⚔️  ${ball.name.toUpperCase()}`);
  console.log("=".repeat(60) + "\n");

  console.log(`Personality: "${ball.personality}"`);
  console.log("");
  console.log("STATS:");
  console.log(`  Record:        ${ball.wins}-${ball.losses}`);
  console.log(`  Win Rate:      ${ball.wins + ball.losses > 0 ? ((ball.wins / (ball.wins + ball.losses)) * 100).toFixed(1) : '0.0'}%`);
  console.log(`  Current Streak: ${ball.currentStreak > 0 ? '+' : ''}${ball.currentStreak}`);
  console.log(`  Longest Win Streak: ${ball.longestWinStreak}`);
  console.log("");
  console.log("ATTRIBUTES:");
  console.log(`  HP:       ${ball.baseHp}`);
  console.log(`  Radius:   ${ball.radius}`);
  console.log(`  Weapon:   ${ball.weaponId}`);
  console.log(`  Color:    ${ball.color}`);
  console.log("");
  console.log("CAREER TOTALS:");
  console.log(`  Damage Dealt: ${ball.totalDamageDealt}`);
  console.log(`  Damage Taken: ${ball.totalDamageTaken}`);
  console.log(`  Damage Diff:  ${ball.totalDamageDealt - ball.totalDamageTaken > 0 ? '+' : ''}${ball.totalDamageDealt - ball.totalDamageTaken}`);
  console.log("");
  console.log(`Status: ${ball.retired ? 'RETIRED' : 'ACTIVE'}`);
  console.log(`Created: ${new Date(ball.createdAt).toLocaleDateString()}`);
  console.log();

  // Show recent matches
  const matches = db.getMatchHistory(ball.id, 5);
  if (matches.length > 0) {
    console.log("RECENT MATCHES (last 5):");
    console.log("-".repeat(60));
    matches.forEach((match: any) => {
      const isA = match.ball_a_id === ball.id;
      const opponent = isA ? "vs Ball B" : "vs Ball A";
      const result = match.winner === (isA ? "A" : "B") ? "WIN" : "LOSS";
      const resultColor = result === "WIN" ? "✓" : "✗";
      const damage = isA ? `${match.ball_a_damage_dealt}/${match.ball_a_damage_taken}` : `${match.ball_b_damage_dealt}/${match.ball_b_damage_taken}`;

      console.log(`  ${resultColor} ${result.padEnd(6)} ${opponent.padEnd(15)} Dmg: ${damage.padEnd(12)} Ticks: ${match.ticks}`);
    });
    console.log();
  }
}

function showRosterStats(db: any) {
  const balls = db.getAllBalls();
  const active = balls.filter((b: any) => !b.retired);

  const totalMatches = balls.reduce((sum: number, b: any) => sum + b.wins + b.losses, 0) / 2;
  const totalDamage = balls.reduce((sum: number, b: any) => sum + b.totalDamageDealt, 0);
  const avgWins = balls.reduce((sum: number, b: any) => sum + b.wins, 0) / balls.length;

  // Weapon distribution
  const weaponCount: Record<string, number> = {};
  balls.forEach((b: any) => {
    weaponCount[b.weaponId] = (weaponCount[b.weaponId] || 0) + 1;
  });

  console.log("\n" + "=".repeat(60));
  console.log("📊 ROSTER STATISTICS");
  console.log("=".repeat(60) + "\n");

  console.log(`Total Fighters:  ${balls.length}`);
  console.log(`Active Fighters: ${active.length}`);
  console.log(`Retired:         ${balls.length - active.length}`);
  console.log("");
  console.log(`Total Matches:   ${totalMatches}`);
  console.log(`Total Damage:    ${totalDamage.toLocaleString()}`);
  console.log(`Avg Wins/Ball:   ${avgWins.toFixed(1)}`);
  console.log("");
  console.log("WEAPON DISTRIBUTION:");
  Object.entries(weaponCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([weapon, count]) => {
      console.log(`  ${weapon.padEnd(15)} ${count} (${((count / balls.length) * 100).toFixed(1)}%)`);
    });
  console.log();
}

function showHelp() {
  console.log("\nUsage: npm run roster <command> [args]");
  console.log("\nCommands:");
  console.log("  list, ls              List all balls in roster");
  console.log("  rankings [limit]      Show top N ranked balls (default: 20)");
  console.log("  info <name>           Show detailed info for a specific ball");
  console.log("  stats                 Show overall roster statistics");
  console.log("  help                  Show this help message");
  console.log("\nExamples:");
  console.log("  npm run roster list");
  console.log("  npm run roster rankings 10");
  console.log("  npm run roster info 'Crimson Crusher'");
  console.log("  npm run roster stats");
  console.log();
}

displayRoster();
