// src/data/database.ts
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BallEntity, EnhancedMatchResult, WeaponOverride, StatProposal, Tournament, TournamentEntry, TournamentMatch } from "./types";

const DB_PATH = path.join(__dirname, "../../data/arena.db");

export class ArenaDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL"); // Write-ahead logging for better concurrency
    this.migrate();
  }

  private migrate(): void {
    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    if (!tableNames.includes("balls")) {
      const migration = fs.readFileSync(
        path.join(__dirname, "migrations/001_initial.sql"),
        "utf-8"
      );
      this.db.exec(migration);
    }

    if (!tableNames.includes("proposals")) {
      const migration = fs.readFileSync(
        path.join(__dirname, "migrations/002_balance.sql"),
        "utf-8"
      );
      this.db.exec(migration);
    }

    if (!tableNames.includes("arena_master_config")) {
      const migration = fs.readFileSync(
        path.join(__dirname, "migrations/003_config.sql"),
        "utf-8"
      );
      this.db.exec(migration);
    }

    // Idempotent column additions for schema evolution
    try {
      this.db.exec("ALTER TABLE balls ADD COLUMN attraction_mult INTEGER DEFAULT 1000");
    } catch {
      // Column already exists — ignore
    }

    // Add is_test flag to matches table for selective isolation
    try {
      this.db.exec("ALTER TABLE matches ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Column already exists — ignore
    }

    // Tournament tables
    if (!tableNames.includes("tournaments")) {
      const migration = fs.readFileSync(
        path.join(__dirname, "migrations/004_tournaments.sql"),
        "utf-8"
      );
      this.db.exec(migration);
    }

    // Add tournament_match_id to matches table for linking
    try {
      this.db.exec("ALTER TABLE matches ADD COLUMN tournament_match_id INTEGER REFERENCES tournament_matches(id)");
    } catch {
      // Column already exists — ignore
    }
  }

  /** Expose the raw database handle for use by ConfigStore. */
  getRawDb(): Database.Database {
    return this.db;
  }

  // Ball CRUD operations
  insertBall(ball: BallEntity): void {
    const stmt = this.db.prepare(`
      INSERT INTO balls (
        id, name, personality, color, base_hp, radius, weapon_id, restitution, attraction_mult,
        wins, losses, total_damage_dealt, total_damage_taken,
        longest_win_streak, current_streak, retired, created_at, retired_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      ball.id, ball.name, ball.personality, ball.color,
      ball.baseHp, ball.radius, ball.weaponId, ball.restitution ?? null,
      ball.attractionMult ?? 1000,
      ball.wins, ball.losses, ball.totalDamageDealt, ball.totalDamageTaken,
      ball.longestWinStreak, ball.currentStreak,
      ball.retired ? 1 : 0,
      ball.createdAt,
      ball.retiredAt ?? null
    );
  }

  getBallById(id: string): BallEntity | undefined {
    const row = this.db.prepare("SELECT * FROM balls WHERE id = ?").get(id);
    if (!row) return undefined;
    return this.rowToBallEntity(row as any);
  }

  getAllBalls(): BallEntity[] {
    const rows = this.db.prepare("SELECT * FROM balls ORDER BY wins DESC").all();
    return rows.map(r => this.rowToBallEntity(r as any));
  }

  getActiveBalls(): BallEntity[] {
    const rows = this.db.prepare(
      "SELECT * FROM balls WHERE retired = 0 ORDER BY wins DESC"
    ).all();
    return rows.map(r => this.rowToBallEntity(r as any));
  }

  updateBallStats(id: string, update: Partial<BallEntity>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (update.wins !== undefined) {
      fields.push("wins = ?");
      values.push(update.wins);
    }
    if (update.losses !== undefined) {
      fields.push("losses = ?");
      values.push(update.losses);
    }
    if (update.totalDamageDealt !== undefined) {
      fields.push("total_damage_dealt = ?");
      values.push(update.totalDamageDealt);
    }
    if (update.totalDamageTaken !== undefined) {
      fields.push("total_damage_taken = ?");
      values.push(update.totalDamageTaken);
    }
    if (update.currentStreak !== undefined) {
      fields.push("current_streak = ?");
      values.push(update.currentStreak);
    }
    if (update.longestWinStreak !== undefined) {
      fields.push("longest_win_streak = ?");
      values.push(update.longestWinStreak);
    }
    if (update.retired !== undefined) {
      fields.push("retired = ?");
      values.push(update.retired ? 1 : 0);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE balls SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  // Match operations
  insertMatch(match: EnhancedMatchResult, isTest: boolean = false): number {
    const stmt = this.db.prepare(`
      INSERT INTO matches (
        seed, ball_a_id, ball_b_id, arena_name, winner, ticks,
        inputs_hash, events_hash, result_hash, timestamp,
        ball_a_damage_dealt, ball_a_damage_taken, ball_a_accuracy,
        ball_b_damage_dealt, ball_b_damage_taken, ball_b_accuracy,
        is_test
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      match.seed, match.ballAId, match.ballBId, match.arenaName,
      match.winner, match.ticks,
      match.inputsHash, match.eventsHash, match.resultHash,
      match.timestamp,
      match.stats.ballA.damageDealt, match.stats.ballA.damageTaken, match.stats.ballA.accuracy,
      match.stats.ballB.damageDealt, match.stats.ballB.damageTaken, match.stats.ballB.accuracy,
      isTest ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  getMatchHistory(ballId: string, limit: number = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM matches
      WHERE (ball_a_id = ? OR ball_b_id = ?) AND is_test = 0
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(ballId, ballId, limit);
  }

  getRankings(limit: number = 20): BallEntity[] {
    const rows = this.db.prepare(`
      SELECT * FROM balls
      WHERE retired = 0
      ORDER BY wins DESC, total_damage_dealt DESC
      LIMIT ?
    `).all(limit);
    return rows.map(r => this.rowToBallEntity(r as any));
  }

  applyBallStatChanges(id: string, changes: Record<string, any>): void {
    const colMap: Record<string, string> = {
      baseHp: "base_hp",
      radius: "radius",
      restitution: "restitution",
      weaponId: "weapon_id",
    };
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, val] of Object.entries(changes)) {
      const col = colMap[key];
      if (col) { fields.push(`${col} = ?`); values.push(val); }
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE balls SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  // Balance analysis queries
  getRecentMatches(limit: number = 50, includeTest: boolean = false): any[] {
    const testFilter = includeTest ? "" : "WHERE m.is_test = 0";
    return this.db.prepare(`
      SELECT m.*, ba.name AS ball_a_name, bb.name AS ball_b_name,
             ba.weapon_id AS ball_a_weapon, bb.weapon_id AS ball_b_weapon
      FROM matches m
      JOIN balls ba ON m.ball_a_id = ba.id
      JOIN balls bb ON m.ball_b_id = bb.id
      ${testFilter}
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(limit);
  }

  getBallPerformanceStats(ballId: string): any {
    return this.db.prepare(`
      SELECT
        COUNT(*) AS match_count,
        SUM(CASE
          WHEN (ball_a_id = ? AND winner = 'A') OR (ball_b_id = ? AND winner = 'B') THEN 1
          ELSE 0
        END) AS wins,
        AVG(CASE WHEN ball_a_id = ? THEN ball_a_damage_dealt ELSE ball_b_damage_dealt END) AS avg_damage_dealt,
        AVG(CASE WHEN ball_a_id = ? THEN ball_a_damage_taken ELSE ball_b_damage_taken END) AS avg_damage_taken,
        AVG(CASE WHEN ball_a_id = ? THEN ball_a_accuracy ELSE ball_b_accuracy END) AS avg_accuracy,
        AVG(ticks) AS avg_ticks
      FROM matches
      WHERE ball_a_id = ? OR ball_b_id = ?
    `).get(ballId, ballId, ballId, ballId, ballId, ballId, ballId);
  }

  getWeaponAggregates(): any[] {
    return this.db.prepare(`
      SELECT
        b.weapon_id,
        COUNT(DISTINCT b.id) AS user_count,
        AVG(CASE
          WHEN m.ball_a_id = b.id AND m.winner = 'A' THEN 1.0
          WHEN m.ball_b_id = b.id AND m.winner = 'B' THEN 1.0
          ELSE 0.0
        END) AS avg_win_rate,
        AVG(CASE WHEN m.ball_a_id = b.id THEN m.ball_a_damage_dealt ELSE m.ball_b_damage_dealt END) AS avg_damage_dealt
      FROM balls b
      JOIN matches m ON (m.ball_a_id = b.id OR m.ball_b_id = b.id)
      WHERE b.retired = 0
      GROUP BY b.weapon_id
    `).all();
  }

  // Weapon override operations
  getWeaponOverrides(ballId: string): WeaponOverride[] {
    const rows = this.db.prepare(
      "SELECT * FROM weapon_overrides WHERE ball_id = ? ORDER BY applied_at DESC"
    ).all(ballId) as any[];
    return rows.map(r => ({
      ballId: r.ball_id,
      weaponId: r.weapon_id,
      ...(r.base_damage !== null && { baseDamage: r.base_damage }),
      ...(r.reach !== null && { reach: r.reach }),
      ...(r.omega !== null && { omega: r.omega }),
      ...(r.speed_mult !== null && { speedMult: r.speed_mult }),
      ...(r.weight !== null && { weight: r.weight }),
      ...(r.tip_radius !== null && { tipRadius: r.tip_radius }),
      appliedAt: r.applied_at,
      proposalId: r.proposal_id,
    }));
  }

  saveWeaponOverride(override: WeaponOverride): void {
    // Remove any existing override for same ball+weapon
    this.db.prepare(
      "DELETE FROM weapon_overrides WHERE ball_id = ? AND weapon_id = ?"
    ).run(override.ballId, override.weaponId);

    this.db.prepare(`
      INSERT INTO weapon_overrides (
        ball_id, weapon_id, base_damage, reach, omega, speed_mult, weight, tip_radius, applied_at, proposal_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      override.ballId, override.weaponId,
      override.baseDamage ?? null,
      override.reach ?? null,
      override.omega ?? null,
      override.speedMult ?? null,
      override.weight ?? null,
      override.tipRadius ?? null,
      override.appliedAt,
      override.proposalId
    );
  }

  // Proposal operations
  saveProposal(proposal: StatProposal): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO proposals (id, ball_id, ball_name, reason, current_stats, proposed_stats, dry_run_results, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.id,
      proposal.ballId,
      proposal.ballName,
      proposal.reason,
      JSON.stringify(proposal.currentStats),
      JSON.stringify(proposal.proposedStats),
      proposal.dryRunResults ? JSON.stringify(proposal.dryRunResults) : null,
      proposal.status,
      proposal.createdAt
    );
  }

  updateProposalStatus(id: string, status: "pending" | "approved" | "rejected"): void {
    this.db.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(status, id);
  }

  getPendingProposals(): StatProposal[] {
    const rows = this.db.prepare(
      "SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at DESC"
    ).all() as any[];
    return rows.map(r => ({
      id: r.id,
      ballId: r.ball_id,
      ballName: r.ball_name,
      reason: r.reason,
      currentStats: JSON.parse(r.current_stats),
      proposedStats: JSON.parse(r.proposed_stats),
      dryRunResults: r.dry_run_results ? JSON.parse(r.dry_run_results) : undefined,
      status: r.status as "pending" | "approved" | "rejected",
      createdAt: r.created_at,
    }));
  }

  getAllProposals(): StatProposal[] {
    const rows = this.db.prepare(
      "SELECT * FROM proposals ORDER BY created_at DESC"
    ).all() as any[];
    return rows.map(r => ({
      id: r.id,
      ballId: r.ball_id,
      ballName: r.ball_name,
      reason: r.reason,
      currentStats: JSON.parse(r.current_stats),
      proposedStats: JSON.parse(r.proposed_stats),
      dryRunResults: r.dry_run_results ? JSON.parse(r.dry_run_results) : undefined,
      status: r.status as "pending" | "approved" | "rejected",
      createdAt: r.created_at,
    }));
  }

  private rowToBallEntity(row: any): BallEntity {
    return {
      id: row.id,
      name: row.name,
      personality: row.personality,
      color: row.color,
      baseHp: row.base_hp,
      radius: row.radius,
      weaponId: row.weapon_id,
      restitution: row.restitution,
      attractionMult: row.attraction_mult ?? 1000,
      wins: row.wins,
      losses: row.losses,
      totalDamageDealt: row.total_damage_dealt,
      totalDamageTaken: row.total_damage_taken,
      longestWinStreak: row.longest_win_streak,
      currentStreak: row.current_streak,
      retired: row.retired === 1,
      createdAt: row.created_at,
      retiredAt: row.retired_at,
    };
  }

  /** Get a single match by its row ID with joined fighter names. */
  getMatchById(id: number): any | undefined {
    return this.db.prepare(`
      SELECT m.*, ba.name AS ball_a_name, bb.name AS ball_b_name,
             ba.weapon_id AS ball_a_weapon, bb.weapon_id AS ball_b_weapon
      FROM matches m
      JOIN balls ba ON m.ball_a_id = ba.id
      JOIN balls bb ON m.ball_b_id = bb.id
      WHERE m.id = ?
    `).get(id) ?? undefined;
  }

  getHeadToHeadRecord(
    ballAId: string,
    ballBId: string
  ): { totalMatches: number; aWins: number; bWins: number } {
    const rows = this.db
      .prepare(
        `SELECT ball_a_id, ball_b_id, winner FROM matches
         WHERE (ball_a_id = ? AND ball_b_id = ?) OR (ball_a_id = ? AND ball_b_id = ?)`
      )
      .all(ballAId, ballBId, ballBId, ballAId) as any[];

    const aWins = rows.filter(
      r =>
        (r.ball_a_id === ballAId && r.winner === "A") ||
        (r.ball_b_id === ballAId && r.winner === "B")
    ).length;

    return { totalMatches: rows.length, aWins, bWins: rows.length - aWins };
  }

  // ─── Tournament operations ──────────────────────────────────────────────────

  createTournament(bracketSize: number, fighterCount: number, totalRounds: number): number {
    const result = this.db.prepare(`
      INSERT INTO tournaments (status, bracket_size, fighter_count, total_rounds, created_at, started_at)
      VALUES ('in_progress', ?, ?, ?, datetime('now'), datetime('now'))
    `).run(bracketSize, fighterCount, totalRounds);
    return result.lastInsertRowid as number;
  }

  getTournamentById(id: number): Tournament | undefined {
    const row = this.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return this.rowToTournament(row);
  }

  getActiveTournament(): Tournament | undefined {
    const row = this.db.prepare(
      "SELECT * FROM tournaments WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1"
    ).get() as any;
    if (!row) return undefined;
    return this.rowToTournament(row);
  }

  getLatestCompletedTournament(): Tournament | undefined {
    const row = this.db.prepare(
      "SELECT * FROM tournaments WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"
    ).get() as any;
    if (!row) return undefined;
    return this.rowToTournament(row);
  }

  updateTournamentStatus(id: number, status: string, extra?: Partial<Tournament>): void {
    const sets = ["status = ?"];
    const vals: any[] = [status];
    if (extra?.championId !== undefined) { sets.push("champion_id = ?"); vals.push(extra.championId); }
    if (extra?.completedAt !== undefined) { sets.push("completed_at = ?"); vals.push(extra.completedAt); }
    if (extra?.currentRound !== undefined) { sets.push("current_round = ?"); vals.push(extra.currentRound); }
    vals.push(id);
    this.db.prepare(`UPDATE tournaments SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  // Tournament entries
  addTournamentEntry(tournamentId: number, ballId: string, seed: number): void {
    this.db.prepare(
      "INSERT INTO tournament_entries (tournament_id, ball_id, seed) VALUES (?, ?, ?)"
    ).run(tournamentId, ballId, seed);
  }

  getTournamentEntries(tournamentId: number): TournamentEntry[] {
    const rows = this.db.prepare(
      "SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY seed ASC"
    ).all(tournamentId) as any[];
    return rows.map(r => ({
      id: r.id,
      tournamentId: r.tournament_id,
      ballId: r.ball_id,
      seed: r.seed,
      eliminatedInRound: r.eliminated_in_round,
    }));
  }

  eliminateEntry(tournamentId: number, ballId: string, round: number): void {
    this.db.prepare(
      "UPDATE tournament_entries SET eliminated_in_round = ? WHERE tournament_id = ? AND ball_id = ?"
    ).run(round, tournamentId, ballId);
  }

  // Tournament match slots
  addTournamentMatch(tm: Omit<TournamentMatch, "id">): number {
    const result = this.db.prepare(`
      INSERT INTO tournament_matches (tournament_id, round, bracket_position, match_id, ball_a_id, ball_b_id, winner_id, is_bye)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tm.tournamentId, tm.round, tm.bracketPosition,
      tm.matchId, tm.ballAId, tm.ballBId, tm.winnerId, tm.isBye ? 1 : 0
    );
    return result.lastInsertRowid as number;
  }

  getTournamentMatches(tournamentId: number, round?: number): TournamentMatch[] {
    const sql = round !== undefined
      ? "SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ? ORDER BY bracket_position"
      : "SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, bracket_position";
    const rows = (round !== undefined
      ? this.db.prepare(sql).all(tournamentId, round)
      : this.db.prepare(sql).all(tournamentId)) as any[];
    return rows.map(r => this.rowToTournamentMatch(r));
  }

  updateTournamentMatch(id: number, update: Partial<TournamentMatch>): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (update.matchId !== undefined) { sets.push("match_id = ?"); vals.push(update.matchId); }
    if (update.ballAId !== undefined) { sets.push("ball_a_id = ?"); vals.push(update.ballAId); }
    if (update.ballBId !== undefined) { sets.push("ball_b_id = ?"); vals.push(update.ballBId); }
    if (update.winnerId !== undefined) { sets.push("winner_id = ?"); vals.push(update.winnerId); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE tournament_matches SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getNextUnplayedMatch(tournamentId: number): TournamentMatch | undefined {
    const row = this.db.prepare(`
      SELECT * FROM tournament_matches
      WHERE tournament_id = ? AND winner_id IS NULL AND is_bye = 0
        AND ball_a_id IS NOT NULL AND ball_b_id IS NOT NULL
      ORDER BY round ASC, bracket_position ASC
      LIMIT 1
    `).get(tournamentId) as any;
    if (!row) return undefined;
    return this.rowToTournamentMatch(row);
  }

  getTournamentFinalMatch(tournamentId: number): TournamentMatch | undefined {
    const tournament = this.getTournamentById(tournamentId);
    if (!tournament) return undefined;
    const row = this.db.prepare(`
      SELECT * FROM tournament_matches
      WHERE tournament_id = ? AND round = ?
      ORDER BY bracket_position ASC LIMIT 1
    `).get(tournamentId, tournament.totalRounds) as any;
    if (!row) return undefined;
    return this.rowToTournamentMatch(row);
  }

  /** Link a match row to its tournament match slot. */
  setMatchTournamentLink(matchRowId: number, tournamentMatchId: number): void {
    this.db.prepare(
      "UPDATE matches SET tournament_match_id = ? WHERE id = ?"
    ).run(tournamentMatchId, matchRowId);
  }

  getRecentTournaments(limit: number = 10): Tournament[] {
    const rows = this.db.prepare(
      "SELECT * FROM tournaments ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as any[];
    return rows.map(r => this.rowToTournament(r));
  }

  private rowToTournament(row: any): Tournament {
    return {
      id: row.id,
      status: row.status,
      bracketSize: row.bracket_size,
      fighterCount: row.fighter_count,
      currentRound: row.current_round,
      totalRounds: row.total_rounds,
      championId: row.champion_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  private rowToTournamentMatch(row: any): TournamentMatch {
    return {
      id: row.id,
      tournamentId: row.tournament_id,
      round: row.round,
      bracketPosition: row.bracket_position,
      matchId: row.match_id,
      ballAId: row.ball_a_id,
      ballBId: row.ball_b_id,
      winnerId: row.winner_id,
      isBye: row.is_bye === 1,
    };
  }

  close(): void {
    this.db.close();
  }
}
