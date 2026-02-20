// src/scripts/schedule.ts
// Long-running match scheduler for the Arena.
// Runs matches automatically every 30 seconds, logs results to console,
// and triggers Arena Master AI balance analysis every 10 matches.
//
// Usage:
//   npm run schedule
//
// Balance proposals are saved to DB for human review:
//   npm run balance -- --list

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { ArenaDatabase } from "../data/database";
import { ConfigStore } from "../data/config-store";
import { loadPersonality } from "../agent/character";
import { MatchRunner } from "../match/runner";
import { findBestMatchup } from "../simulation/matchmaker";
import { generateMatchSummary } from "../analysis/summary";
import { buildBalanceReport, formatBalanceReport } from "../agent/balance-analyzer";
import { ArenaMasterAgent } from "../agent/arena-master";
import { CommentaryAgent } from "../agent/commentary";
import { TelegramService } from "../services/telegram";
import { broadcaster } from "../api/ws-broadcaster";

// ─── DB + Config (loaded once at startup) ────────────────────────────────────

const db = new ArenaDatabase();
const configStore = new ConfigStore(db.getRawDb());

const MATCH_INTERVAL_MS   = configStore.getMatchIntervalMs();
const BALANCE_CHECK_EVERY = configStore.getBalanceCheckEvery();
const ARENA_NAME          = configStore.getArenaName();

// Physics params are not in the config store (changing them without
// understanding simCore implications can corrupt match physics).
const ARENA_CONFIG = { w: 400, h: 700, wallRestitution: 850 };
const SIM_CONFIG   = { scale: 1000, maxTicks: 18000 };

const WEAPONS_CATALOG: Record<string, any> = {
  short_sword: { type: "blade", reach: 60, tipRadius: 15, bladeStart: 25, bladeWidth: 8,  shaftRadius: 5, omega: 1800, baseDamage: 12, ramp: 3, speedMult: 1000, weight: 800  },
  katana:      { type: "blade", reach: 85, tipRadius: 12, bladeStart: 30, bladeWidth: 10, shaftRadius: 6, omega: 1600, baseDamage: 11, ramp: 3, speedMult: 1050, weight: 850  },
  spear:       { type: "point", reach: 110, tipRadius: 8,                                 shaftRadius: 5, omega: 1200, baseDamage: 18, ramp: 4, speedMult: 950,  weight: 900  },
  mace:        { type: "blunt", reach: 70, tipRadius: 35,                                 shaftRadius: 8, omega: 1400, baseDamage: 14, ramp: 2, speedMult: 900,  weight: 1400 },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function printBanner(): void {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║          ARENA SCHEDULER STARTED             ║");
  console.log(`║   Match every ${MATCH_INTERVAL_MS / 1000}s | Balance every ${BALANCE_CHECK_EVERY} matches  ║`);
  console.log(`║   Arena: ${ARENA_NAME.padEnd(36)}║`);
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
}

// ─── State ───────────────────────────────────────────────────────────────────

let matchCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const runner = new MatchRunner(db);
const commentator = new CommentaryAgent({
  personality:        loadPersonality(db),
  model:              configStore.getModelCommentary(),
  tokensAnnouncement: configStore.getCommentaryTokensAnnouncement(),
  tokensPostmatch:    configStore.getCommentaryTokensPostmatch(),
});

const telegram = new TelegramService(
  configStore.getTelegramBotToken(),
  configStore.getTelegramChannelId(),
  configStore.isTelegramEnabled(),
);

// ─── Balance Check ───────────────────────────────────────────────────────────

async function runBalanceCheck(): Promise<void> {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  Balance Check (after match #${matchCount})`);
  console.log("=".repeat(50));

  try {
    const report = buildBalanceReport(db);
    console.log("\n" + formatBalanceReport(report));

    const matchedFighters = report.fighters.filter(f => f.matchCount >= 3);
    if (matchedFighters.length < 2) {
      console.log("  ⚠  Not enough match data for AI analysis (need ≥3 matches per fighter).");
      console.log("=".repeat(50) + "\n");
      return;
    }

    console.log("  Calling Arena Master AI...");
    const agent = new ArenaMasterAgent(configStore.getModelBalance());
    const proposals = await agent.analyzeAndPropose(db, report);

    if (proposals.length === 0) {
      console.log("  Arena looks balanced — no proposals generated.");
    } else {
      for (const proposal of proposals) {
        db.saveProposal(proposal);
      }
      console.log(`  ${proposals.length} proposal(s) saved.`);
      console.log("  Run `npm run balance -- --list` to review and approve.");
    }
  } catch (e: any) {
    console.warn(`  ⚠  Balance check failed: ${e.message}`);
    if (e.message?.includes("ANTHROPIC_API_KEY")) {
      console.warn("     Add ANTHROPIC_API_KEY to your environment or .env file.");
    }
  }

  console.log("=".repeat(50) + "\n");
}

// ─── Match Loop ──────────────────────────────────────────────────────────────

async function runNextMatch(): Promise<void> {
  // Get fresh roster each tick (stats may have updated)
  const roster = db.getActiveBalls();

  const matchup = findBestMatchup(roster);
  if (!matchup) {
    console.log(`[${timestamp()}] Waiting for more fighters (need ≥2 active balls)...`);
    return;
  }

  const { ballA, ballB } = matchup;
  const seed = Math.floor(Math.random() * 1_000_000);

  // Broadcast upcoming match (fires before AI commentary, gives browser a countdown)
  broadcaster.broadcast({ type: "next_match", ballA, ballB, startsInMs: 5000 });

  // Pre-match announcement
  let announcement = "";
  try {
    const h2h = db.getHeadToHeadRecord(ballA.id, ballB.id);
    announcement = await commentator.generateAnnouncement(ballA, ballB, h2h);
    console.log(`\n🎙️  ${announcement}\n`);
    await telegram.sendAnnouncement(ballA, ballB, announcement);
  } catch (e: any) {
    // Commentary/Telegram failure should never block the match
  }

  // Broadcast match start with announcement text
  broadcaster.broadcast({ type: "match_start", ballA, ballB, matchNumber: matchCount + 1, announcement });

  let result;
  try {
    result = await runner.runMatch({
      ballAId: ballA.id,
      ballBId: ballB.id,
      arenaName: ARENA_NAME,
      seed,
      weapons: WEAPONS_CATALOG,
      arenaConfig: ARENA_CONFIG,
      simConfig: SIM_CONFIG,
    });
  } catch (e: any) {
    console.error(`[${timestamp()}] Match error: ${e.message}`);
    return;
  }

  matchCount++;

  // Reload fresh ball entities from DB (stats updated by runner)
  const freshA = db.getBallById(ballA.id) ?? ballA;
  const freshB = db.getBallById(ballB.id) ?? ballB;

  const summary = generateMatchSummary(result, freshA, freshB);
  const duration = (result.ticks / 30).toFixed(1);

  console.log(`[${timestamp()}] Match #${matchCount}: ${ballA.name} vs ${ballB.name}`);
  console.log(`  → ${summary.title} in ${duration}s`);
  if (summary.highlights.length > 0) {
    console.log("  → Highlights:");
    for (const h of summary.highlights.slice(0, 3)) {
      console.log(`      ${h}`);
    }
  }

  // Send match result card to Telegram (no AI needed — fires immediately)
  await telegram.sendMatchResult(matchCount, result, freshA, freshB, summary);

  // Replay match ticks to connected WebSocket clients
  broadcaster.replayMatch(result, freshA.baseHp, freshB.baseHp);

  // Post-match Arena Master commentary
  let postMatch = "";
  try {
    postMatch = await commentator.generatePostMatch(result, freshA, freshB, summary.highlights);
    console.log(`\n🎙️  ${postMatch}\n`);
    await telegram.sendPostMatchCommentary(postMatch);
  } catch (e: any) {
    // Commentary/Telegram failure should never block the scheduler
  }

  // Broadcast match end (fires after commentary so it includes the text)
  broadcaster.broadcast({
    type: "match_end",
    matchNumber: matchCount,
    winner: result.winner,
    ballA: freshA,
    ballB: freshB,
    ticks: result.ticks,
    commentary: postMatch,
  });

  // Trigger balance check every N matches
  if (matchCount % BALANCE_CHECK_EVERY === 0) {
    await runBalanceCheck();
  }
}

// ─── Startup & Shutdown ───────────────────────────────────────────────────────

function shutdown(): void {
  console.log("\n\nArena scheduler stopped. Goodbye!");
  if (timer !== null) clearInterval(timer);
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main(): Promise<void> {
  printBanner();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠  ANTHROPIC_API_KEY not set — balance checks will fail when they fire.");
    console.warn("   Set it in your shell, or run: ANTHROPIC_API_KEY=your_key npm run schedule");
    console.warn("");
  }

  const roster = db.getActiveBalls();
  if (roster.length < 2) {
    console.error("✗ Need at least 2 active balls to schedule matches.");
    console.error("  Run: npm run init-roster");
    db.close();
    process.exit(1);
  }

  console.log(`Found ${roster.length} active fighters. Starting match loop...\n`);

  // Run first match immediately, then every MATCH_INTERVAL_MS
  await runNextMatch();
  timer = setInterval(() => {
    runNextMatch().catch(e => console.error("Unhandled match error:", e));
  }, MATCH_INTERVAL_MS);
}

main().catch(e => {
  console.error("Fatal error:", e);
  db.close();
  process.exit(1);
});
