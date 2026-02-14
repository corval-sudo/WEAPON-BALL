// src/data/database.ts
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BallEntity, EnhancedMatchResult } from "./types";

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
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();

    if (tables.length === 0) {
      const migration = fs.readFileSync(
        path.join(__dirname, "migrations/001_initial.sql"),
        "utf-8"
      );
      this.db.exec(migration);
    }
  }

  // Ball CRUD operations
  insertBall(ball: BallEntity): void {
    const stmt = this.db.prepare(`
      INSERT INTO balls (
        id, name, personality, color, base_hp, radius, weapon_id, restitution,
        wins, losses, total_damage_dealt, total_damage_taken,
        longest_win_streak, current_streak, retired, created_at, retired_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      ball.id, ball.name, ball.personality, ball.color,
      ball.baseHp, ball.radius, ball.weaponId, ball.restitution ?? null,
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
  insertMatch(match: EnhancedMatchResult): number {
    const stmt = this.db.prepare(`
      INSERT INTO matches (
        seed, ball_a_id, ball_b_id, arena_name, winner, ticks,
        inputs_hash, events_hash, result_hash, timestamp,
        ball_a_damage_dealt, ball_a_damage_taken, ball_a_accuracy,
        ball_b_damage_dealt, ball_b_damage_taken, ball_b_accuracy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      match.seed, match.ballAId, match.ballBId, match.arenaName,
      match.winner, match.ticks,
      match.inputsHash, match.eventsHash, match.resultHash,
      match.timestamp,
      match.stats.ballA.damageDealt, match.stats.ballA.damageTaken, match.stats.ballA.accuracy,
      match.stats.ballB.damageDealt, match.stats.ballB.damageTaken, match.stats.ballB.accuracy
    );

    return result.lastInsertRowid as number;
  }

  getMatchHistory(ballId: string, limit: number = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM matches
      WHERE ball_a_id = ? OR ball_b_id = ?
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

  close(): void {
    this.db.close();
  }
}
