// src/agent/commentary.ts
// Arena Master Commentary Agent — generates in-character match announcements and
// post-match analysis using the Arena Master persona via the Claude Haiku model.
// Designed to fire every 30 seconds alongside the scheduler, so latency and cost matter.
//
// All config (personality, model, token limits) is injected at construction time
// from ConfigStore so the owner can tune it live via `npm run admin`.

import Anthropic from "@anthropic-ai/sdk";
import type { BallEntity, EnhancedMatchResult } from "../data/types";

export interface HeadToHeadRecord {
  totalMatches: number;
  aWins: number;
  bWins: number;
}

export interface CommentaryConfig {
  personality: string;
  model: string;
  tokensAnnouncement: number;
  tokensPostmatch: number;
}

export class CommentaryAgent {
  private client: Anthropic;
  private config: CommentaryConfig;

  constructor(config: CommentaryConfig) {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.config = config;
  }

  /**
   * Generate a pre-match announcement hype post.
   * Called before the match runs — uses fighter profiles and rivalry history.
   */
  async generateAnnouncement(
    ballA: BallEntity,
    ballB: BallEntity,
    h2h: HeadToHeadRecord
  ): Promise<string> {
    const streakA = formatStreak(ballA.currentStreak);
    const streakB = formatStreak(ballB.currentStreak);

    const rivalryLine =
      h2h.totalMatches === 0
        ? "First time these two have met."
        : `Head-to-head: ${h2h.totalMatches} prior meetings — ${ballA.name} leads ${h2h.aWins}-${h2h.bWins}.`;

    const prompt = `UPCOMING FIGHT IN THE PIT:

${ballA.name} (${ballA.weaponId}) — ${ballA.wins}W/${ballA.losses}L — ${streakA}
Personality: ${ballA.personality}

vs

${ballB.name} (${ballB.weaponId}) — ${ballB.wins}W/${ballB.losses}L — ${streakB}
Personality: ${ballB.personality}

${rivalryLine}

Write a fight announcement in your character. 2-4 sentences. Hype the matchup dramatically. Reference streaks, rivalry history, or weapon matchup if interesting. End with something that makes people want to watch.`;

    return this.callClaude(prompt, this.config.tokensAnnouncement);
  }

  /**
   * Generate post-match commentary.
   * Called after the match completes with fresh career stats loaded from DB.
   */
  async generatePostMatch(
    result: EnhancedMatchResult,
    ballA: BallEntity,
    ballB: BallEntity,
    highlights: string[]
  ): Promise<string> {
    const winner = result.winner === "A" ? ballA : ballB;
    const loser = result.winner === "A" ? ballB : ballA;
    const winnerStats = result.winner === "A" ? result.stats.ballA : result.stats.ballB;
    const loserStats = result.winner === "A" ? result.stats.ballB : result.stats.ballA;
    const duration = (result.ticks / 30).toFixed(1);
    const winnerStreak = formatStreak(winner.currentStreak);

    const highlightText =
      highlights.length > 0
        ? highlights.slice(0, 3).join("\n")
        : "A clean, technical fight with no single blowout moment.";

    const prompt = `MATCH JUST FINISHED:

${winner.name} defeated ${loser.name} in ${duration} seconds.

${winner.name}: ${winnerStats.hitsLanded} hits landed, ${winnerStats.accuracy}% accuracy, ${winnerStats.damageDealt} total damage
${loser.name}: ${loserStats.hitsLanded} hits landed, ${loserStats.accuracy}% accuracy, ${loserStats.damageDealt} total damage

Key moments:
${highlightText}

Updated records:
${ballA.name}: ${ballA.wins}W/${ballA.losses}L (${formatStreak(ballA.currentStreak)})
${ballB.name}: ${ballB.wins}W/${ballB.losses}L (${formatStreak(ballB.currentStreak)})

Write post-match commentary in character. React to the performance, call out the biggest moment, and say something about what this win/loss means for each fighter's story going forward. 3-5 sentences. The winner is on ${winnerStreak}.`;

    return this.callClaude(prompt, this.config.tokensPostmatch);
  }

  private async callClaude(userPrompt: string, maxTokens: number): Promise<string> {
    const message = await this.client.messages.create({
      model: this.config.model,
      max_tokens: maxTokens,
      system: this.config.personality,
      messages: [{ role: "user", content: userPrompt }],
    });

    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatStreak(streak: number): string {
  if (streak === 0) return "no current streak";
  if (streak > 0) return `${streak}-match WIN streak`;
  return `${Math.abs(streak)}-match LOSS streak`;
}
