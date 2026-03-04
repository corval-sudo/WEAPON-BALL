// src/scripts/schedule.ts
// Long-running match scheduler for the Arena.
// Runs matches automatically every 30 seconds, logs results to console,
// and triggers Arena Master AI balance analysis every 10 matches.
//
// Usage:
//   npm run schedule               — auto mode (matches every 30s)
//   MANUAL_MATCH=1 npm run serve   — manual mode (no auto-scheduling)
//     → trigger via: POST /api/admin/run-match
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
import { ArenaPlannerAgent } from "../agent/planner";
import type { PlannerDecision } from "../agent/planner";
import { TelegramService } from "../services/telegram";
import { broadcaster } from "../api/ws-broadcaster";
import type { WsWeaponDef } from "../api/ws-broadcaster";
import { setNextMatch } from "../api/server";
import { matchTrigger } from "../match/trigger";
import { OracleContentPipeline } from "../services/OracleContentPipeline";

// ─── DB + Config (loaded once at startup) ────────────────────────────────────

const db = new ArenaDatabase();
const configStore = new ConfigStore(db.getRawDb());

const MATCH_INTERVAL_MS   = configStore.getMatchIntervalMs();
const BALANCE_CHECK_EVERY = configStore.getBalanceCheckEvery();
const PLANNER_EVERY       = configStore.getPlannerEvery();
const ARENA_NAME          = configStore.getArenaName();
const MANUAL_MODE         = process.env["MANUAL_MATCH"] === "1";

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
  const modeStr = MANUAL_MODE ? "MANUAL (POST /api/admin/run-match)" : `every ${MATCH_INTERVAL_MS / 1000}s`;
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║          ARENA SCHEDULER STARTED             ║");
  console.log(`║   Matches: ${modeStr.padEnd(34)}║`);
  console.log(`║   Balance every ${BALANCE_CHECK_EVERY} | Planner every ${PLANNER_EVERY} matches      ║`);
  console.log(`║   Arena: ${ARENA_NAME.padEnd(36)}║`);
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
}

// ─── State ───────────────────────────────────────────────────────────────────

let matchCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let plannerDecision: PlannerDecision | null = null;

const runner   = new MatchRunner(db);
const oracle   = new OracleContentPipeline();
const commentator = new CommentaryAgent({
  personality:        loadPersonality(db),
  model:              configStore.getModelCommentary(),
  tokensAnnouncement: configStore.getCommentaryTokensAnnouncement(),
  tokensPostmatch:    configStore.getCommentaryTokensPostmatch(),
});
const planner = new ArenaPlannerAgent(configStore.getModelPlanner());

const telegram = new TelegramService(
  configStore.getTelegramBotToken(),
  configStore.getTelegramChannelId(),
  configStore.isTelegramEnabled(),
);

// ─── Planner Tick ─────────────────────────────────────────────────────────────

async function runPlannerTick(): Promise<void> {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  [PLANNER] Running after match #${matchCount}...`);
  try {
    const decision = await planner.plan(db, matchCount);
    plannerDecision = decision;

    console.log(`  [PLANNER] Rationale: ${decision.plannerRationale}`);

    if (decision.matchup) {
      const a = db.getBallById(decision.matchup.ballAId);
      const b = db.getBallById(decision.matchup.ballBId);
      console.log(`  [PLANNER] Next fight: ${a?.name ?? decision.matchup.ballAId} vs ${b?.name ?? decision.matchup.ballBId}`);
      console.log(`  [PLANNER] Reason:     ${decision.matchup.rationale}`);
    } else {
      console.log(`  [PLANNER] Matchup:    deferring to matchmaker`);
    }

    if (decision.narrativeHooks.length > 0) {
      console.log(`  [PLANNER] Hooks:      ${decision.narrativeHooks.join(" | ")}`);
    }

    if (decision.retirementCandidates.length > 0) {
      const names = decision.retirementCandidates.map(id => db.getBallById(id)?.name ?? id);
      console.log(`  [PLANNER] ⚠ Retirement candidates (human review): ${names.join(", ")}`);
    }
  } catch (e: any) {
    console.warn(`  [PLANNER] Error: ${e.message}`);
    plannerDecision = null;
  }
  console.log("─".repeat(50) + "\n");
}

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

async function runNextMatch(opts?: { test?: boolean }): Promise<void> {
  const isTest = opts?.test ?? false;
  // Get fresh roster each tick (stats may have updated)
  const roster = db.getActiveBalls();

  // Use planner-chosen matchup if available; otherwise let matchmaker decide.
  // Consume the decision immediately so subsequent matches don't re-use it.
  const decision = plannerDecision;
  plannerDecision = null;

  const plannerMatchup = decision?.matchup
    ? (() => {
        const a = roster.find(b => b.id === decision.matchup!.ballAId);
        const b = roster.find(b => b.id === decision.matchup!.ballBId);
        if (a && b) return { ballA: a, ballB: b };
        console.warn("[PLANNER] Chosen fighters no longer on roster — falling back to matchmaker");
        return null;
      })()
    : null;

  const matchup = plannerMatchup
    ? { ...plannerMatchup, score: 0, factors: { skillGap: 0, streakInterest: 0, weaponDiversity: 0, underdog: 0, freshness: 0 } }
    : findBestMatchup(roster);

  if (!matchup) {
    console.log(`[${timestamp()}] Waiting for more fighters (need ≥2 active balls)...`);
    return;
  }

  const { ballA, ballB } = matchup;
  const narrativeHooks = decision?.narrativeHooks ?? [];
  const seed = Math.floor(Math.random() * 1_000_000);

  // Build weapon definitions for the browser renderer (picks up per-ball overrides if present).
  // Defined early so it's available for both next_match and match_start broadcasts.
  function resolveWeaponDef(ball: typeof ballA): WsWeaponDef {
    const overrideSuffix = `${ball.weaponId}_${ball.id === ballA.id ? "A" : "B"}`;
    // Check if an override weapon exists (runner creates these with _A/_B suffix)
    const raw: any = WEAPONS_CATALOG[overrideSuffix] ?? WEAPONS_CATALOG[ball.weaponId] ?? WEAPONS_CATALOG["short_sword"];
    return {
      type: raw.type ?? "point",
      reach: raw.reach,
      tipRadius: raw.tipRadius,
      ...(raw.bladeStart  !== undefined && { bladeStart:  raw.bladeStart }),
      ...(raw.bladeWidth  !== undefined && { bladeWidth:  raw.bladeWidth }),
      ...(raw.shaftRadius !== undefined && { shaftRadius: raw.shaftRadius }),
      ...(raw.baseDamage  !== undefined && { baseDamage:  raw.baseDamage }),
      ...(raw.omega       !== undefined && { omega:       raw.omega }),
      ...(raw.speedMult   !== undefined && { speedMult:   raw.speedMult }),
      ...(raw.weight      !== undefined && { weight:      raw.weight }),
    };
  }

  // Broadcast upcoming match with weapon defs — gives browser both countdown and
  // weapon metadata even if it connects during the pre-match announcement window.
  broadcaster.broadcast({
    type: "next_match",
    ballA, ballB,
    startsInMs: 5000,
    weaponA: resolveWeaponDef(ballA),
    weaponB: resolveWeaponDef(ballB),
  });

  // Pre-match announcement (passes narrative hooks to commentator)
  // Skipped for test matches — no commentary or Telegram needed.
  let announcement = "";
  if (!isTest) {
    try {
      const h2h = db.getHeadToHeadRecord(ballA.id, ballB.id);
      announcement = await commentator.generateAnnouncement(ballA, ballB, h2h, narrativeHooks);
      console.log(`\n🎙️  ${announcement}\n`);
      await telegram.sendAnnouncement(ballA, ballB, announcement);
    } catch (e: any) {
      // Commentary/Telegram failure should never block the match
    }
  }

  // Broadcast match start with announcement text and weapon definitions
  broadcaster.broadcast({
    type: "match_start",
    ballA, ballB,
    matchNumber: matchCount + 1,
    announcement,
    weaponA: resolveWeaponDef(ballA),
    weaponB: resolveWeaponDef(ballB),
  });

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
      isTest,
    });
  } catch (e: any) {
    console.error(`[${timestamp()}] Match error: ${e.message}`);
    return;
  }

  // Test matches don't increment the official match counter
  if (!isTest) {
    matchCount++;
  }

  // Reload fresh ball entities from DB (stats updated by runner for official matches)
  const freshA = db.getBallById(ballA.id) ?? ballA;
  const freshB = db.getBallById(ballB.id) ?? ballB;

  const summary = generateMatchSummary(result, freshA, freshB);
  const duration = (result.ticks / 30).toFixed(1);

  const testTag = isTest ? " [TEST]" : "";
  console.log(`[${timestamp()}] Match${testTag} #${matchCount}: ${ballA.name} vs ${ballB.name}`);
  console.log(`  → ${summary.title} in ${duration}s`);
  if (summary.highlights.length > 0) {
    console.log("  → Highlights:");
    for (const h of summary.highlights.slice(0, 3)) {
      console.log(`      ${h}`);
    }
  }

  // For test matches: still replay via WebSocket so admin can watch,
  // but skip commentary, Telegram, Oracle, balance, and planner.
  if (isTest) {
    await broadcaster.replayMatch(result, freshA.baseHp, freshB.baseHp);
    broadcaster.broadcast({
      type: "match_end",
      matchNumber: matchCount,
      winner: result.winner,
      ballA: freshA,
      ballB: freshB,
      ticks: result.ticks,
      commentary: "🧪 Test match — results not recorded to leaderboard.",
    });
    return;
  }

  // ── Official match post-processing below ──

  // Send match result card to Telegram (no AI needed — fires immediately)
  await telegram.sendMatchResult(matchCount, result, freshA, freshB, summary);

  // Run replay stream and post-match commentary concurrently:
  // - replayMatch() streams real physics frames at 30fps (~20s) and resolves when done
  // - generatePostMatch() calls Claude API (~2-3s) and resolves with commentary text
  // match_end is sent only after BOTH complete so the victory banner appears at
  // the right moment and includes the commentary text.
  let postMatch = "";
  const [, commentaryResult] = await Promise.allSettled([
    broadcaster.replayMatch(result, freshA.baseHp, freshB.baseHp),
    commentator.generatePostMatch(result, freshA, freshB, summary.highlights, narrativeHooks),
  ]);

  if (commentaryResult.status === "fulfilled") {
    postMatch = commentaryResult.value;
    console.log(`\n🎙️  ${postMatch}\n`);
    try {
      await telegram.sendPostMatchCommentary(postMatch);
    } catch {
      // Telegram failure should never block the scheduler
    }
  }

  // Broadcast match end — fires after replay completes so banner appears last
  broadcaster.broadcast({
    type: "match_end",
    matchNumber: matchCount,
    winner: result.winner,
    ballA: freshA,
    ballB: freshB,
    ticks: result.ticks,
    commentary: postMatch,
  });

  // Oracle content pipeline — non-blocking, fires after broadcast
  oracle.run({
    matchId:     matchCount,   // sequential match counter (DB rowId not returned by runner)
    matchNumber: matchCount,
    nameA:       freshA.name,
    nameB:       freshB.name,
    winner:      result.winner,
    ticks:       result.ticks,
    commentary:  postMatch,
  }).catch(e => console.warn("[Oracle] pipeline error:", e.message));

  // Trigger balance check every N matches
  if (matchCount % BALANCE_CHECK_EVERY === 0) {
    await runBalanceCheck();
  }

  // Trigger planner every N matches (non-blocking — runs async after current match)
  if (matchCount % PLANNER_EVERY === 0) {
    runPlannerTick().catch(e => console.warn("[PLANNER] Tick error:", e.message));
  }
}

// ─── Next-match advertisement ─────────────────────────────────────────────────

/**
 * Picks the best upcoming matchup and tells the API server when it will fire.
 * This populates /api/next so clients that load the page mid-interval see the
 * countdown immediately rather than waiting for the WebSocket next_match event.
 */
function scheduleNextMatchAd(delayMs: number): void {
  const roster = db.getActiveBalls();
  const matchup = findBestMatchup(roster);
  if (!matchup) return;
  setNextMatch(matchup.ballA.id, matchup.ballB.id, delayMs);
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
    console.warn("⚠  ANTHROPIC_API_KEY not set — AI features will fail when they fire.");
    console.warn("   Set it in your shell, or run: ANTHROPIC_API_KEY=your_key npm run serve");
    console.warn("");
  }

  const roster = db.getActiveBalls();
  if (roster.length < 2) {
    console.warn("⚠  No active fighters found yet — waiting for roster to be initialized.");
    console.warn("   Run: npm run init-roster (or railway ssh -- npm run init-roster)");
    console.warn("   Scheduler will start automatically once fighters are added.");
    console.warn("");
  }

  if (MANUAL_MODE) {
    console.log("⏸  Manual mode active — no matches will auto-run.");
    console.log("   Trigger a match: curl -X POST http://localhost:3001/api/admin/run-match");
    console.log("");
    // Listen for manual triggers from the API endpoint
    matchTrigger.on("run", (opts?: { test?: boolean }) => {
      runNextMatch(opts)
        .then(() => { if (!opts?.test) scheduleNextMatchAd(5000); })
        .catch(e => console.error("Match error:", e));
    });
    return; // process stays alive via the HTTP server started in main.ts
  }

  if (roster.length >= 2) {
    console.log(`Found ${roster.length} active fighters. Starting match loop...\n`);
  }

  // Run first match immediately, then every MATCH_INTERVAL_MS.
  // runNextMatch() handles the empty-roster case gracefully (logs + returns early).
  await runNextMatch();
  // After the first match, schedule the next one and advertise it via the API.
  scheduleNextMatchAd(MATCH_INTERVAL_MS);
  timer = setInterval(() => {
    runNextMatch()
      .then(() => scheduleNextMatchAd(MATCH_INTERVAL_MS))
      .catch(e => console.error("Unhandled match error:", e));
  }, MATCH_INTERVAL_MS);
}

main().catch(e => {
  console.error("Fatal error:", e);
  db.close();
  process.exit(1);
});
