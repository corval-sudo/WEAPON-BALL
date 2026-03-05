// src/services/OracleContentPipeline.ts
// Autonomous content pipeline scaffold for the Orbacle.
//
// Future capability: the Orbacle selects highlight matches, generates
// captions, and posts recordings to social platforms without human
// intervention. Right now all posting methods are stubs — they log
// intent but take no real action.
//
// Activation:
//   Set ORBACLE_POSTING=true in your environment to enable (future).
//   Currently no method posts anything regardless of this flag.
//
// Integration point:
//   Called from src/scripts/schedule.ts after each match_end broadcast.
//   Only the selectMatchForRecording() gate needs to return true for a
//   recording to be queued — the rest of the pipeline fires automatically.

import Anthropic from "@anthropic-ai/sdk";
import type { Tournament } from "../data/types";

export interface MatchSummaryForOracle {
  matchId: number;
  matchNumber: number;
  nameA: string;
  nameB: string;
  winner: "A" | "B";
  ticks: number;
  commentary: string;
}

export class OracleContentPipeline {
  private readonly active: boolean;

  constructor() {
    this.active = process.env["ORBACLE_POSTING"] === "true";
    if (this.active) {
      console.log("[OracleContentPipeline] Posting mode ACTIVE — not yet implemented.");
    }
  }

  /**
   * Decides whether this match should be selected for recording and posting.
   * Criteria will eventually include: exciting finish, long streak broken,
   * high damage, rare weapon matchup, etc.
   *
   * Currently always returns false — no matches are auto-selected.
   */
  selectMatchForRecording(_match: MatchSummaryForOracle): boolean {
    return false;
  }

  /**
   * Generates a short social caption for the match.
   * Will eventually call an LLM with match context and commentary.
   *
   * @returns A placeholder caption string (not yet used).
   */
  async generateMatchCaption(match: MatchSummaryForOracle): Promise<string> {
    const winnerName = match.winner === "A" ? match.nameA : match.nameB;
    const loserName  = match.winner === "A" ? match.nameB : match.nameA;
    const duration   = (match.ticks / 30).toFixed(1);
    // Placeholder — will be replaced with LLM call
    return `⚔️ ${winnerName} defeats ${loserName} in ${duration}s! #WORBZ`;
  }

  /**
   * Posts a video recording to Twitter/X with the given caption.
   * Stub only — logs intent, makes no network requests.
   */
  async postToTwitter(
    _mp4Url: string,
    caption: string,
    match: MatchSummaryForOracle,
  ): Promise<void> {
    console.log(
      `[OracleContentPipeline] postToTwitter() not yet active.` +
      ` Would post match #${match.matchNumber} with caption: "${caption}"`,
    );
  }

  /**
   * Schedules a post for a future time (e.g. peak engagement window).
   * Stub only — currently calls postToTwitter() immediately if active.
   */
  async schedulePost(
    mp4Url: string,
    caption: string,
    match: MatchSummaryForOracle,
    _scheduledAt?: Date,
  ): Promise<void> {
    console.log(
      `[OracleContentPipeline] schedulePost() not yet active.` +
      ` Would schedule match #${match.matchNumber}.`,
    );
    // When implemented, this will queue the post for _scheduledAt
    // and fall back to postToTwitter() immediately if no scheduler is set.
    void mp4Url;
    void caption;
    void match;
  }

  /**
   * Generate a punchy caption for a tournament final using Claude.
   * Falls back to a template caption if the LLM call fails.
   */
  async generateTournamentCaption(
    tournament: Tournament,
    finalMatch: { nameA: string; nameB: string; winner: string; ticks: number },
    personality: string,
  ): Promise<string> {
    const winnerName = finalMatch.winner === "A" ? finalMatch.nameA : finalMatch.nameB;
    const loserName  = finalMatch.winner === "A" ? finalMatch.nameB : finalMatch.nameA;
    const duration   = (finalMatch.ticks / 30).toFixed(1);

    try {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 100,
        system: personality,
        messages: [{
          role: "user",
          content: `TOURNAMENT FINAL JUST ENDED:\n\n${finalMatch.nameA} vs ${finalMatch.nameB}\nWinner: ${winnerName} in ${duration} seconds\n\nThis was the championship match of a ${tournament.fighterCount}-fighter single elimination tournament.\n\nWrite a short, punchy social media caption for this championship video.\nRules:\n- Maximum 240 characters (leave room for hashtags)\n- Dramatic and exciting tone\n- Include the winner's name\n- End with #WORBZ\n- No emojis in the first line`,
        }],
      });

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();

      if (text) return text;
    } catch (e: any) {
      console.warn(`[OracleContentPipeline] LLM caption failed: ${e.message}`);
    }

    // Fallback template
    return `${winnerName} defeats ${loserName} in ${duration}s to claim the tournament crown! #WORBZ`;
  }

  /**
   * Full pipeline: select → caption → post.
   * Called after every match_end. No-ops if the match is not selected.
   */
  async run(match: MatchSummaryForOracle): Promise<void> {
    if (!this.selectMatchForRecording(match)) return;

    try {
      const caption = await this.generateMatchCaption(match);
      console.log(
        `[OracleContentPipeline] Match #${match.matchNumber} selected.` +
        ` Caption: "${caption}" — posting pipeline not yet active.`,
      );
      // Future: obtain mp4Url from recording store, then call schedulePost()
    } catch (e: any) {
      console.warn(`[OracleContentPipeline] run() error: ${e.message}`);
    }
  }
}
