// src/tournament/scheduler.ts
// Orchestrates running a full single-elimination tournament end-to-end.
// Creates bracket → runs matches with delays → broadcasts updates → returns result.
//
// Each tournament match uses the same MatchRunner, CommentaryAgent, and
// TelegramService as continuous matches, so the viewer experience is identical.

import type { ArenaDatabase } from "../data/database";
import type { ConfigStore } from "../data/config-store";
import type { MatchRunner } from "../match/runner";
import type { CommentaryAgent } from "../agent/commentary";
import type { TelegramService } from "../services/telegram";
import type { WsBroadcaster, WsWeaponDef } from "../api/ws-broadcaster";
import type { BallEntity, Tournament, EnhancedMatchResult } from "../data/types";
import { TournamentEngine } from "./engine";
import type { BracketState } from "./engine";
import { generateMatchSummary } from "../analysis/summary";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TournamentConfig {
  arenaName: string;
  weapons: Record<string, any>;
  arenaConfig: { w: number; h: number; wallRestitution: number };
  simConfig: { scale: number; maxTicks: number };
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

export class TournamentScheduler {
  private engine: TournamentEngine;

  constructor(
    private db: ArenaDatabase,
    private configStore: ConfigStore,
    private matchRunner: MatchRunner,
    private commentator: CommentaryAgent,
    private telegram: TelegramService,
    private broadcaster: WsBroadcaster,
    private tournamentConfig: TournamentConfig,
    private resolveWeaponDef: (ball: BallEntity, side: "A" | "B") => WsWeaponDef,
  ) {
    this.engine = new TournamentEngine(db);
  }

  /**
   * Run a full tournament from bracket creation to champion crowned.
   * Blocks until the tournament is complete (or cancelled on error).
   */
  async runTournament(): Promise<Tournament> {
    console.log("\n" + "═".repeat(50));
    console.log("  🏆 TOURNAMENT STARTING");
    console.log("═".repeat(50));

    const tournament = this.engine.createTournament();
    const bracket = this.engine.getBracketState(tournament.id);

    console.log(`  Bracket: ${bracket.fighterCount} fighters → ${bracket.bracketSize}-slot bracket`);
    console.log(`  Rounds:  ${bracket.totalRounds}`);
    console.log(`  Seeds:`);
    for (const s of bracket.seeds) {
      console.log(`    #${s.seed} ${s.name}`);
    }
    console.log("");

    // Broadcast tournament start
    this.broadcaster.broadcast({
      type: "tournament_start",
      tournamentId: tournament.id,
      bracket,
    } as any);

    // Telegram announcement
    try {
      await this.telegram.sendTournamentStart(tournament, bracket);
    } catch {
      // Never crash
    }

    const delayMs = this.configStore.getTournamentMatchDelay();
    let matchesPlayed = 0;

    // Process matches round by round
    while (true) {
      const nextMatch = this.engine.getNextUnplayedMatch(tournament.id);
      if (!nextMatch) break;

      // Delay between matches (skip delay before first match)
      if (matchesPlayed > 0) {
        await sleep(delayMs);
      }

      const ballA = this.db.getBallById(nextMatch.ballAId!);
      const ballB = this.db.getBallById(nextMatch.ballBId!);
      if (!ballA || !ballB) {
        console.warn(`[TOURNAMENT] Missing fighter for match slot #${nextMatch.id}, cancelling`);
        this.db.updateTournamentStatus(tournament.id, "cancelled");
        return this.db.getTournamentById(tournament.id)!;
      }

      const currentRound = nextMatch.round;
      const roundName = this.getRoundName(currentRound, bracket.totalRounds);
      console.log(`\n  [TOURNAMENT ${roundName}] ${ballA.name} vs ${ballB.name}`);

      // Update current round
      this.db.updateTournamentStatus(tournament.id, "in_progress", { currentRound });

      try {
        const result = await this.runTournamentMatch(ballA, ballB, matchesPlayed);
        matchesPlayed++;

        // Determine winner
        const winnerId = result.winner === "A" ? ballA.id : ballB.id;
        const winnerName = result.winner === "A" ? ballA.name : ballB.name;

        // Get the match row ID from the DB (most recent match)
        const recentMatches = this.db.getRecentMatches(1);
        const matchRowId = recentMatches[0]?.id ?? 0;

        // Advance winner in bracket
        this.engine.advanceWinner(tournament.id, nextMatch.id, winnerId, matchRowId);

        console.log(`  [TOURNAMENT ${roundName}] Winner: ${winnerName}`);

        // Broadcast bracket update
        const updatedBracket = this.engine.getBracketState(tournament.id);
        this.broadcaster.broadcast({
          type: "tournament_update",
          tournamentId: tournament.id,
          bracket: updatedBracket,
        } as any);

      } catch (e: any) {
        console.error(`  [TOURNAMENT] Match error: ${e.message} — cancelling tournament`);
        this.db.updateTournamentStatus(tournament.id, "cancelled");
        return this.db.getTournamentById(tournament.id)!;
      }
    }

    // Tournament complete — determine champion
    const finalMatch = this.db.getTournamentFinalMatch(tournament.id);
    const championId = finalMatch?.winnerId ?? null;
    const championName = championId ? (this.db.getBallById(championId)?.name ?? "Unknown") : "Unknown";

    this.db.updateTournamentStatus(tournament.id, "completed", {
      championId,
      completedAt: new Date().toISOString(),
    });

    const completed = this.db.getTournamentById(tournament.id)!;

    console.log("\n" + "═".repeat(50));
    console.log(`  🏆 TOURNAMENT #${tournament.id} COMPLETE`);
    console.log(`  Champion: ${championName}`);
    console.log(`  Matches played: ${matchesPlayed}`);
    console.log("═".repeat(50) + "\n");

    // Broadcast tournament end
    this.broadcaster.broadcast({
      type: "tournament_end",
      tournamentId: tournament.id,
      championId,
      championName,
    } as any);

    // Telegram result
    try {
      await this.telegram.sendTournamentResult(completed, championName);
    } catch {
      // Never crash
    }

    return completed;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Run a single tournament match with full commentary + replay pipeline.
   * Mirrors the flow in schedule.ts runNextMatch() for consistency.
   */
  private async runTournamentMatch(
    ballA: BallEntity,
    ballB: BallEntity,
    matchIndex: number,
  ): Promise<EnhancedMatchResult> {
    const seed = Math.floor(Math.random() * 1_000_000);
    const { arenaName, weapons, arenaConfig, simConfig } = this.tournamentConfig;

    // Broadcast upcoming match
    this.broadcaster.broadcast({
      type: "next_match",
      ballA,
      ballB,
      startsInMs: 3000,
      weaponA: this.resolveWeaponDef(ballA, "A"),
      weaponB: this.resolveWeaponDef(ballB, "B"),
      arenaW: arenaConfig.w,
      arenaH: arenaConfig.h,
    });

    // Pre-match announcement
    let announcement = "";
    try {
      const h2h = this.db.getHeadToHeadRecord(ballA.id, ballB.id);
      announcement = await this.commentator.generateAnnouncement(ballA, ballB, h2h, []);
      console.log(`  🎙️  ${announcement}`);
      await this.telegram.sendAnnouncement(ballA, ballB, announcement);
    } catch {
      // Never block
    }

    // Broadcast match start
    this.broadcaster.broadcast({
      type: "match_start",
      ballA,
      ballB,
      matchNumber: matchIndex + 1,
      announcement,
      weaponA: this.resolveWeaponDef(ballA, "A"),
      weaponB: this.resolveWeaponDef(ballB, "B"),
      arenaW: arenaConfig.w,
      arenaH: arenaConfig.h,
    });

    // Run the match
    const result = await this.matchRunner.runMatch({
      ballAId: ballA.id,
      ballBId: ballB.id,
      arenaName,
      seed,
      weapons,
      arenaConfig,
      simConfig,
      isTest: false,
    });

    // Reload fresh stats
    const freshA = this.db.getBallById(ballA.id) ?? ballA;
    const freshB = this.db.getBallById(ballB.id) ?? ballB;
    const summary = generateMatchSummary(result, freshA, freshB);

    // Send result to Telegram
    try {
      await this.telegram.sendMatchResult(matchIndex + 1, result, freshA, freshB, summary);
    } catch {
      // Never crash
    }

    // Replay + commentary concurrently
    let postMatch = "";
    const [, commentaryResult] = await Promise.allSettled([
      this.broadcaster.replayMatch(result, freshA.baseHp, freshB.baseHp),
      this.commentator.generatePostMatch(result, freshA, freshB, summary.highlights, []),
    ]);

    if (commentaryResult.status === "fulfilled") {
      postMatch = commentaryResult.value;
      console.log(`  🎙️  ${postMatch}`);
      try {
        await this.telegram.sendPostMatchCommentary(postMatch);
      } catch {
        // Never crash
      }
    }

    // Broadcast match end
    this.broadcaster.broadcast({
      type: "match_end",
      matchNumber: matchIndex + 1,
      winner: result.winner,
      ballA: freshA,
      ballB: freshB,
      ticks: result.ticks,
      commentary: postMatch,
    });

    return result;
  }

  private getRoundName(round: number, totalRounds: number): string {
    const remaining = totalRounds - round;
    if (remaining === 0) return "FINAL";
    if (remaining === 1) return "SEMIFINAL";
    if (remaining === 2) return "QUARTERFINAL";
    return `ROUND ${round}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
