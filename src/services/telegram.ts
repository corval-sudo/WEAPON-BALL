// src/services/telegram.ts
// Send-only Telegram integration for the WORBZ Arena.
// Fires 3 messages per match: pre-match announcement, result card, post-match commentary.
//
// Enable via admin CLI (requires ADMIN_SECRET):
//   npm run admin set telegram_bot_token  "your-bot-token"
//   npm run admin set telegram_channel_id "@your_channel"
//   npm run admin set telegram_enabled    "true"
//
// When telegram_enabled is "false" (default), all methods silently no-op.
// Telegram send errors are caught and logged — they never crash the scheduler.

import { Bot } from "grammy";
import type { BallEntity, EnhancedMatchResult } from "../data/types";
import type { MatchSummary } from "../analysis/summary";

export class TelegramService {
  private bot: Bot | null;
  private channelId: string;
  private enabled: boolean;

  constructor(token: string, channelId: string, enabled: boolean) {
    this.channelId = channelId;
    this.enabled = enabled && !!token && !!channelId;
    // No polling — send-only mode (grammy Bot without .start() = send-only)
    this.bot = this.enabled ? new Bot(token) : null;
  }

  // ─── Public send methods ─────────────────────────────────────────────────────

  /**
   * Message 1: AI announcement hype text + fighter matchup card.
   * Called after generateAnnouncement(), before runner.runMatch().
   */
  async sendAnnouncement(
    ballA: BallEntity,
    ballB: BallEntity,
    announcement: string
  ): Promise<void> {
    if (!this.enabled) return;

    const streakA = formatStreak(ballA.currentStreak);
    const streakB = formatStreak(ballB.currentStreak);

    const text = [
      `🎙️ ${announcement}`,
      ``,
      `⚔️ <b>${escapeHtml(ballA.name)}</b> (${ballA.weaponId}) ${ballA.wins}W/${ballA.losses}L${streakA ? " — " + streakA : ""}`,
      `vs`,
      `⚔️ <b>${escapeHtml(ballB.name)}</b> (${ballB.weaponId}) ${ballB.wins}W/${ballB.losses}L${streakB ? " — " + streakB : ""}`,
    ].join("\n");

    await this.send(text);
  }

  /**
   * Message 2: Match result card with stats and highlights.
   * Called after runner.runMatch() and generateMatchSummary().
   */
  async sendMatchResult(
    matchNumber: number,
    result: EnhancedMatchResult,
    ballA: BallEntity,
    ballB: BallEntity,
    summary: MatchSummary
  ): Promise<void> {
    if (!this.enabled) return;

    const winner = result.winner === "A" ? ballA : ballB;
    const loser  = result.winner === "A" ? ballB : ballA;
    const winnerStats = result.winner === "A" ? result.stats.ballA : result.stats.ballB;
    const loserStats  = result.winner === "A" ? result.stats.ballB : result.stats.ballA;
    const duration = (result.ticks / 30).toFixed(1);

    const lines: string[] = [
      `🏆 <b>Match #${matchNumber} Result</b>`,
      ``,
      `<b>${escapeHtml(winner.name)}</b> defeats ${escapeHtml(loser.name)} in ${duration}s`,
      ``,
      `📊 Stats:`,
      `  ${escapeHtml(winner.name)}: ${winnerStats.hitsLanded} hits, ${winnerStats.accuracy}% accuracy, ${winnerStats.damageDealt} dmg`,
      `  ${escapeHtml(loser.name)}: ${loserStats.hitsLanded} hits, ${loserStats.accuracy}% accuracy, ${loserStats.damageDealt} dmg`,
    ];

    const topHighlights = summary.highlights.slice(0, 3);
    if (topHighlights.length > 0) {
      lines.push(``, `💥 Highlights:`);
      for (const h of topHighlights) {
        lines.push(`  • ${h}`);
      }
    }

    lines.push(
      ``,
      `📈 Records: ${escapeHtml(ballA.name)} ${ballA.wins}W/${ballA.losses}L | ${escapeHtml(ballB.name)} ${ballB.wins}W/${ballB.losses}L`
    );

    await this.send(lines.join("\n"));
  }

  /**
   * Message 3: Arena Master post-match commentary.
   * Called after commentator.generatePostMatch().
   */
  async sendPostMatchCommentary(commentary: string): Promise<void> {
    if (!this.enabled) return;
    await this.send(`🎙️ ${commentary}`);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async send(text: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendMessage(this.channelId, text, { parse_mode: "HTML" });
    } catch (e: any) {
      // Never crash the scheduler due to Telegram issues
      console.warn(`  ⚠  Telegram send failed: ${e.message}`);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatStreak(streak: number): string {
  if (streak === 0) return "";
  if (streak > 0) return `${streak}-match WIN streak`;
  return `${Math.abs(streak)}-match LOSS streak`;
}

/** Minimal HTML escaping for fighter names embedded in Telegram HTML messages. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
