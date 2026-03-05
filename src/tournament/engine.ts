// src/tournament/engine.ts
// Core single-elimination bracket logic.
// Handles bracket creation, seeding, bye processing, and winner advancement.
// No scheduling or match execution — that's handled by TournamentScheduler.

import type { ArenaDatabase } from "../data/database";
import type { BallEntity, Tournament, TournamentMatch } from "../data/types";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface BracketSlot {
  round: number;
  position: number;
  ballAId: string | null;
  ballBId: string | null;
  ballAName: string | null;
  ballBName: string | null;
  winnerId: string | null;
  winnerName: string | null;
  isBye: boolean;
  matchId: number | null;
}

export interface BracketState {
  tournamentId: number;
  status: Tournament["status"];
  bracketSize: number;
  fighterCount: number;
  totalRounds: number;
  currentRound: number;
  championId: string | null;
  championName: string | null;
  seeds: { seed: number; ballId: string; name: string }[];
  rounds: BracketSlot[][];
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class TournamentEngine {
  constructor(private db: ArenaDatabase) {}

  /**
   * Create a new tournament from the current active roster.
   * Seeds fighters by win rate (desc), creates all bracket slots.
   * Returns the tournament ID.
   */
  createTournament(): Tournament {
    const fighters = this.db.getActiveBalls();
    if (fighters.length < 2) throw new Error("Need at least 2 active fighters");

    const plan = this.computeBracket(fighters);
    const tournamentId = this.db.createTournament(
      plan.bracketSize,
      fighters.length,
      plan.totalRounds,
    );

    // Save seeded entries
    for (let i = 0; i < plan.seeds.length; i++) {
      this.db.addTournamentEntry(tournamentId, plan.seeds[i]!.id, i + 1);
    }

    // Generate all round 1 bracket slots
    const pairings = this.seedBracketPositions(plan.bracketSize);
    for (let pos = 0; pos < pairings.length; pos++) {
      const pair = pairings[pos]!;
      const seedA = pair[0]!;
      const seedB = pair[1]!;
      const ballA = seedA <= plan.seeds.length ? plan.seeds[seedA - 1] : null;
      const ballB = seedB <= plan.seeds.length ? plan.seeds[seedB - 1] : null;

      const isBye = !ballA || !ballB;
      const winnerId = isBye ? (ballA?.id ?? ballB?.id ?? null) : null;

      this.db.addTournamentMatch({
        tournamentId,
        round: 1,
        bracketPosition: pos,
        matchId: null,
        ballAId: ballA?.id ?? null,
        ballBId: ballB?.id ?? null,
        winnerId,
        isBye,
      });
    }

    // Generate empty slots for rounds 2..totalRounds
    for (let round = 2; round <= plan.totalRounds; round++) {
      const slotsInRound = plan.bracketSize / Math.pow(2, round);
      for (let pos = 0; pos < slotsInRound; pos++) {
        this.db.addTournamentMatch({
          tournamentId,
          round,
          bracketPosition: pos,
          matchId: null,
          ballAId: null,
          ballBId: null,
          winnerId: null,
          isBye: false,
        });
      }
    }

    // Process byes — advance winners through empty slots
    this.processByes(tournamentId);

    this.db.updateTournamentStatus(tournamentId, "in_progress", { currentRound: 1 });
    return this.db.getTournamentById(tournamentId)!;
  }

  /**
   * Process all bye winners: propagate them into the next round slots.
   */
  processByes(tournamentId: number): void {
    const tournament = this.db.getTournamentById(tournamentId)!;

    for (let round = 1; round < tournament.totalRounds; round++) {
      const matches = this.db.getTournamentMatches(tournamentId, round);
      for (const m of matches) {
        if (m.winnerId) {
          this.propagateWinner(tournamentId, m, m.winnerId);
        }
      }
    }
  }

  /**
   * After a match completes, record the winner and propagate to next round.
   * Also marks the loser as eliminated.
   */
  advanceWinner(tournamentId: number, matchSlotId: number, winnerId: string, matchRowId: number): void {
    // Update the tournament match slot
    this.db.updateTournamentMatch(matchSlotId, { winnerId, matchId: matchRowId });

    // Find the match to get round info
    const allMatches = this.db.getTournamentMatches(tournamentId);
    const slot = allMatches.find(m => m.id === matchSlotId);
    if (!slot) return;

    // Mark loser as eliminated
    const loserId = slot.ballAId === winnerId ? slot.ballBId : slot.ballAId;
    if (loserId) {
      this.db.eliminateEntry(tournamentId, loserId, slot.round);
    }

    // Propagate winner to next round
    this.propagateWinner(tournamentId, slot, winnerId);

    // Link match row to tournament
    this.db.setMatchTournamentLink(matchRowId, matchSlotId);
  }

  /**
   * Get the next match that's ready to play (both fighters set, no winner yet, not a bye).
   */
  getNextUnplayedMatch(tournamentId: number): TournamentMatch | undefined {
    return this.db.getNextUnplayedMatch(tournamentId);
  }

  /**
   * Check if the tournament is complete.
   */
  isTournamentComplete(tournamentId: number): boolean {
    return !this.db.getNextUnplayedMatch(tournamentId);
  }

  /**
   * Get full bracket state for display/broadcast.
   */
  getBracketState(tournamentId: number): BracketState {
    const tournament = this.db.getTournamentById(tournamentId)!;
    const entries = this.db.getTournamentEntries(tournamentId);
    const allMatches = this.db.getTournamentMatches(tournamentId);

    // Build name lookup
    const nameMap = new Map<string, string>();
    for (const entry of entries) {
      const ball = this.db.getBallById(entry.ballId);
      if (ball) nameMap.set(ball.id, ball.name);
    }

    const seeds = entries.map(e => ({
      seed: e.seed,
      ballId: e.ballId,
      name: nameMap.get(e.ballId) ?? e.ballId,
    }));

    const rounds: BracketSlot[][] = [];
    for (let round = 1; round <= tournament.totalRounds; round++) {
      const roundMatches = allMatches.filter(m => m.round === round);
      rounds.push(roundMatches.map(m => ({
        round: m.round,
        position: m.bracketPosition,
        ballAId: m.ballAId,
        ballBId: m.ballBId,
        ballAName: m.ballAId ? (nameMap.get(m.ballAId) ?? null) : null,
        ballBName: m.ballBId ? (nameMap.get(m.ballBId) ?? null) : null,
        winnerId: m.winnerId,
        winnerName: m.winnerId ? (nameMap.get(m.winnerId) ?? null) : null,
        isBye: m.isBye,
        matchId: m.matchId,
      })));
    }

    const championName = tournament.championId
      ? (nameMap.get(tournament.championId) ?? null)
      : null;

    return {
      tournamentId,
      status: tournament.status,
      bracketSize: tournament.bracketSize,
      fighterCount: tournament.fighterCount,
      totalRounds: tournament.totalRounds,
      currentRound: tournament.currentRound,
      championId: tournament.championId,
      championName,
      seeds,
      rounds,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private computeBracket(fighters: BallEntity[]) {
    let bracketSize = 2;
    while (bracketSize < fighters.length) bracketSize *= 2;

    // Seed by win rate descending, ties broken by total wins
    const seeds = [...fighters].sort((a, b) => {
      const totalA = a.wins + a.losses;
      const totalB = b.wins + b.losses;
      const wrA = totalA > 0 ? a.wins / totalA : 0.5;
      const wrB = totalB > 0 ? b.wins / totalB : 0.5;
      if (wrB !== wrA) return wrB - wrA;
      return b.wins - a.wins;
    });

    const totalRounds = Math.log2(bracketSize);
    return { bracketSize, seeds, totalRounds };
  }

  /**
   * Standard tournament seeding: 1v16, 8v9, 5v12, 4v13, etc.
   * Returns array of [seedA, seedB] pairs for each bracket position.
   */
  private seedBracketPositions(bracketSize: number): number[][] {
    if (bracketSize === 2) return [[1, 2]];
    const half = this.seedBracketPositions(bracketSize / 2);
    const result: number[][] = [];
    for (const pair of half) {
      const a = pair[0]!;
      result.push([a, bracketSize + 1 - a]);
    }
    return result;
  }

  /**
   * Propagate a winner from their current match slot into the next round.
   */
  private propagateWinner(tournamentId: number, slot: TournamentMatch, winnerId: string): void {
    const tournament = this.db.getTournamentById(tournamentId)!;
    if (slot.round >= tournament.totalRounds) {
      // This was the final — set champion
      this.db.updateTournamentStatus(tournamentId, "in_progress", { championId: winnerId });
      return;
    }

    const nextRound = slot.round + 1;
    const nextPosition = Math.floor(slot.bracketPosition / 2);
    const isUpperHalf = slot.bracketPosition % 2 === 0;

    const nextMatches = this.db.getTournamentMatches(tournamentId, nextRound);
    const nextSlot = nextMatches.find(m => m.bracketPosition === nextPosition);
    if (!nextSlot) return;

    if (isUpperHalf) {
      this.db.updateTournamentMatch(nextSlot.id, { ballAId: winnerId });
    } else {
      this.db.updateTournamentMatch(nextSlot.id, { ballBId: winnerId });
    }
  }
}
