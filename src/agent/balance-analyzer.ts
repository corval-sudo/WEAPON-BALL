// src/agent/balance-analyzer.ts
// Pure data analysis — no LLM calls. Queries match history to produce a BalanceReport.

import type { ArenaDatabase } from "../data/database";
import type { BalanceReport, FighterBalance, WeaponBalance } from "../data/types";

export function buildBalanceReport(db: ArenaDatabase): BalanceReport {
  const allBalls = db.getActiveBalls();
  const recentMatches = db.getRecentMatches(100);
  const weaponAggregates = db.getWeaponAggregates();

  const fighters: FighterBalance[] = [];

  for (const ball of allBalls) {
    const perf = db.getBallPerformanceStats(ball.id) as any;

    if (!perf || perf.match_count === 0) {
      fighters.push({
        ball,
        winRate: 0,
        avgDamageDealt: 0,
        avgDamageTaken: 0,
        avgExcitement: 0,
        matchCount: 0,
        balanceScore: 50, // neutral — no data
      });
      continue;
    }

    const winRate = perf.wins / perf.match_count;
    const avgDamageDealt = perf.avg_damage_dealt ?? 0;
    const avgDamageTaken = perf.avg_damage_taken ?? 0;

    // Excitement estimated from damage ratio and match duration
    // High damage + short matches = exciting; low damage = boring
    const damageRatio = avgDamageTaken > 0 ? avgDamageDealt / avgDamageTaken : 1;
    const avgTicks = perf.avg_ticks ?? 9000;
    const durationScore = Math.max(0, 10 - (avgTicks / 18000) * 10); // longer = less exciting
    const avgExcitement = Math.min(10, (damageRatio * 3 + durationScore) / 2);

    // Balance score: 50 = perfect, 0 or 100 = extreme dominance/weakness
    // Based on win rate distance from 0.5
    const balanceScore = 100 - Math.abs(winRate - 0.5) * 200;

    fighters.push({
      ball,
      winRate,
      avgDamageDealt,
      avgDamageTaken,
      avgExcitement,
      matchCount: perf.match_count,
      balanceScore,
    });
  }

  const weaponSummary: WeaponBalance[] = weaponAggregates.map((w: any) => ({
    weaponId: w.weapon_id,
    userCount: w.user_count,
    avgWinRate: w.avg_win_rate ?? 0.5,
    avgDamageDealt: w.avg_damage_dealt ?? 0,
    dominanceScore: (w.avg_win_rate ?? 0.5) * 100,
  }));

  const overallEngagementScore =
    fighters.length > 0
      ? fighters.reduce((sum, f) => sum + f.avgExcitement, 0) / fighters.length
      : 5;

  return {
    generatedAt: new Date().toISOString(),
    totalMatches: recentMatches.length,
    fighters,
    weaponSummary,
    overallEngagementScore,
  };
}

export function formatBalanceReport(report: BalanceReport): string {
  const lines: string[] = [];

  lines.push("=== WORBZ ARENA BALANCE REPORT ===");
  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push(`Total matches analyzed: ${report.totalMatches}`);
  lines.push(`Overall engagement score: ${report.overallEngagementScore.toFixed(1)}/10`);
  lines.push("");

  lines.push("--- FIGHTER BALANCE ---");
  const sorted = [...report.fighters]
    .filter(f => f.matchCount > 0)
    .sort((a, b) => b.winRate - a.winRate);

  if (sorted.length === 0) {
    lines.push("  No match data yet. Run some matches first!");
  } else {
    lines.push(
      `  ${"Name".padEnd(24)} ${"W/L".padEnd(8)} ${"Win%".padEnd(7)} ${"Dmg Out".padEnd(9)} ${"Dmg In".padEnd(9)} ${"Balance".padEnd(8)} Excitement`
    );
    lines.push("  " + "-".repeat(82));

    for (const f of sorted) {
      const total = f.ball.wins + f.ball.losses;
      const wl = `${f.ball.wins}/${f.ball.losses}`;
      const winPct = (f.winRate * 100).toFixed(0) + "%";
      const balanceLabel =
        f.balanceScore >= 80 ? "Good" : f.balanceScore >= 50 ? "Fair" : "Poor";

      lines.push(
        `  ${f.ball.name.padEnd(24)} ${wl.padEnd(8)} ${winPct.padEnd(7)} ` +
        `${Math.round(f.avgDamageDealt).toString().padEnd(9)} ` +
        `${Math.round(f.avgDamageTaken).toString().padEnd(9)} ` +
        `${balanceLabel.padEnd(8)} ${f.avgExcitement.toFixed(1)}/10`
      );
    }
  }

  lines.push("");
  lines.push("--- WEAPON BALANCE ---");
  if (report.weaponSummary.length === 0) {
    lines.push("  No weapon data yet.");
  } else {
    lines.push(`  ${"Weapon".padEnd(16)} ${"Users".padEnd(7)} ${"Win Rate".padEnd(10)} ${"Avg Dmg".padEnd(10)} Status`);
    lines.push("  " + "-".repeat(55));
    for (const w of report.weaponSummary) {
      const status =
        w.dominanceScore > 60 ? "OVERPOWERED" :
        w.dominanceScore < 40 ? "UNDERPOWERED" : "Balanced";
      lines.push(
        `  ${w.weaponId.padEnd(16)} ${w.userCount.toString().padEnd(7)} ` +
        `${(w.avgWinRate * 100).toFixed(0).padEnd(9)}% ` +
        `${Math.round(w.avgDamageDealt).toString().padEnd(10)} ${status}`
      );
    }
  }

  return lines.join("\n");
}
