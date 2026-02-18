// src/scripts/suggest-matchup.ts
// Use matchmaking algorithm to suggest interesting matches
import { ArenaDatabase } from "../data/database";
import { findBestMatchup, findTopMatchups, findRandomMatchup } from "../simulation/matchmaker";

function suggestMatchups() {
  const args = process.argv.slice(2);
  const mode = args[0] || "best";
  const count = parseInt(args[1] || "1", 10);

  const db = new ArenaDatabase();
  const roster = db.getActiveBalls();

  if (roster.length < 2) {
    console.error("❌ Not enough active balls in roster");
    db.close();
    process.exit(1);
  }

  console.log("\n" + "=".repeat(70));
  console.log("🎲 MATCHMAKING SUGGESTIONS");
  console.log("=".repeat(70) + "\n");

  switch (mode) {
    case "best":
      const best = findBestMatchup(roster);
      if (best) {
        displayMatchup(best, 1, 1);
      }
      break;

    case "top":
      const top = findTopMatchups(roster, Math.min(count, 10));
      top.forEach((matchup, idx) => displayMatchup(matchup, idx + 1, top.length));
      break;

    case "random":
      const random = findRandomMatchup(roster);
      if (random) {
        displayMatchup(random, 1, 1);
      }
      break;

    case "help":
      showHelp();
      break;

    default:
      console.error(`Unknown mode: ${mode}`);
      showHelp();
      process.exit(1);
  }

  db.close();
}

function displayMatchup(matchup: any, index: number, total: number) {
  const { ballA, ballB, score, factors } = matchup;

  if (total > 1) {
    console.log(`#${index} — Score: ${score.toFixed(1)}/100`);
    console.log("-".repeat(70));
  }

  console.log(`${ballA.name} (${ballA.weaponId})`);
  console.log(`  Record: ${ballA.wins}-${ballA.losses} | Streak: ${ballA.currentStreak > 0 ? '+' : ''}${ballA.currentStreak}`);
  console.log(`  HP: ${ballA.baseHp} | Dmg: ${ballA.totalDamageDealt}/${ballA.totalDamageTaken}`);
  console.log("");
  console.log("                         VS");
  console.log("");
  console.log(`${ballB.name} (${ballB.weaponId})`);
  console.log(`  Record: ${ballB.wins}-${ballB.losses} | Streak: ${ballB.currentStreak > 0 ? '+' : ''}${ballB.currentStreak}`);
  console.log(`  HP: ${ballB.baseHp} | Dmg: ${ballB.totalDamageDealt}/${ballB.totalDamageTaken}`);
  console.log("");

  if (total === 1) {
    console.log("MATCHUP QUALITY:");
    console.log(`  Overall Score:     ${score.toFixed(1)}/100`);
    console.log(`  Skill Balance:     ${factors.skillGap.toFixed(1)}`);
    console.log(`  Streak Interest:   ${factors.streakInterest.toFixed(1)}`);
    console.log(`  Weapon Diversity:  ${factors.weaponDiversity.toFixed(1)}`);
    console.log(`  Underdog Potential: ${factors.underdog.toFixed(1)}`);
    console.log(`  Freshness:         ${factors.freshness.toFixed(1)}`);
    console.log("");
  }

  console.log("RUN THIS MATCH:");
  console.log(`  npm run match '${ballA.name}' '${ballB.name}'`);

  if (total > 1 && index < total) {
    console.log("\n" + "=".repeat(70) + "\n");
  } else {
    console.log();
  }
}

function showHelp() {
  console.log("\nUsage: npm run suggest [mode] [count]");
  console.log("\nModes:");
  console.log("  best              Find the single best matchup (default)");
  console.log("  top <n>           Find top N matchups (default: 5, max: 10)");
  console.log("  random            Find a random matchup");
  console.log("  help              Show this help message");
  console.log("\nExamples:");
  console.log("  npm run suggest");
  console.log("  npm run suggest best");
  console.log("  npm run suggest top 5");
  console.log("  npm run suggest random");
  console.log();
}

suggestMatchups();
