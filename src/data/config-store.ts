// src/data/config-store.ts
// Typed wrapper around the arena_master_config table.
// Provides get/set with fallback defaults, plus convenience getters for all known keys.
// All writes should be done only after auth is verified (see src/scripts/admin.ts).
//
// Accepts a raw Database.Database handle (from ArenaDatabase.getRawDb()) rather than
// ArenaDatabase itself, to avoid circular module dependencies.

import type Database from "better-sqlite3";

// ─── Known Config Keys ────────────────────────────────────────────────────────

export const CONFIG_KEYS = [
  "personality",
  "model_commentary",
  "model_balance",
  "commentary_tokens_announcement",
  "commentary_tokens_postmatch",
  "match_interval_ms",
  "balance_check_every",
  "arena_name",
  "telegram_bot_token",
  "telegram_channel_id",
  "telegram_enabled",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
  description: string;
}

// ─── ConfigStore ──────────────────────────────────────────────────────────────

export class ConfigStore {
  constructor(private db: Database.Database) {}

  /** Get a raw string value by key. Returns undefined if the row doesn't exist. */
  get(key: ConfigKey): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM arena_master_config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  /**
   * Set (upsert) a value and stamp updated_at.
   * Preserves the existing description on update.
   */
  set(key: ConfigKey, value: string): void {
    this.db
      .prepare(
        `INSERT INTO arena_master_config (key, value, updated_at, description)
         VALUES (?, ?, datetime('now'), COALESCE(
           (SELECT description FROM arena_master_config WHERE key = ?), ''
         ))
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           updated_at = excluded.updated_at`
      )
      .run(key, value, key);
  }

  /** Return all rows ordered by key, for display in the admin CLI. */
  getAll(): ConfigRow[] {
    return this.db
      .prepare(
        "SELECT key, value, updated_at, description FROM arena_master_config ORDER BY key"
      )
      .all() as ConfigRow[];
  }

  // ─── Typed Convenience Getters ─────────────────────────────────────────────
  // Each falls back to a compile-time default if the DB row is missing.
  // This guarantees valid values even on a fresh DB before migration 003 runs.

  getPersonality(fallback: string): string {
    return this.get("personality") ?? fallback;
  }

  getModelCommentary(): string {
    return this.get("model_commentary") ?? "claude-haiku-4-5";
  }

  getModelBalance(): string {
    return this.get("model_balance") ?? "claude-opus-4-6";
  }

  getCommentaryTokensAnnouncement(): number {
    return parseInt(this.get("commentary_tokens_announcement") ?? "256", 10);
  }

  getCommentaryTokensPostmatch(): number {
    return parseInt(this.get("commentary_tokens_postmatch") ?? "384", 10);
  }

  getMatchIntervalMs(): number {
    return parseInt(this.get("match_interval_ms") ?? "30000", 10);
  }

  getBalanceCheckEvery(): number {
    return parseInt(this.get("balance_check_every") ?? "10", 10);
  }

  getArenaName(): string {
    return this.get("arena_name") ?? "The Pit";
  }

  getTelegramBotToken(): string {
    return this.get("telegram_bot_token") ?? "";
  }

  getTelegramChannelId(): string {
    return this.get("telegram_channel_id") ?? "";
  }

  isTelegramEnabled(): boolean {
    return (this.get("telegram_enabled") ?? "false") === "true";
  }
}
