// src/agent/planner.ts
// Arena Planner Agent — narrative decision-making brain for the arena scheduler.
//
// Runs every N matches (default 5). Reads full arena state (roster, streaks,
// rivalries, recent results), calls Claude Sonnet, and returns a PlannerDecision
// that the scheduler uses to choose the next matchup and inject narrative hooks
// into commentary. Falls back silently to default matchmaking on any error.

import Anthropic from "@anthropic-ai/sdk";
import type { ArenaDatabase } from "../data/database";
import type { BallEntity } from "../data/types";
import { findTopMatchups, calculateSkill } from "../simulation/matchmaker";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlannerDecision {
  /** Specific fighters to put in the next match. null = let matchmaker decide. */
  matchup: { ballAId: string; ballBId: string; rationale: string } | null;
  /** Optional special framing for this match (logged; future use for UI). */
  specialEvent: "grudge_match" | "debut" | "streak_breaker" | "rivalry" | null;
  /** Short narrative strings passed to CommentaryAgent (≤4 items). */
  narrativeHooks: string[];
  /** Ball IDs the planner thinks should retire — logged for human review only. */
  retirementCandidates: string[];
  /** Why the planner made these decisions — logged to console. */
  plannerRationale: string;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class ArenaPlannerAgent {
  private client: Anthropic;
  private model: string;

  constructor(model = "claude-sonnet-4-6") {
    this.client = new Anthropic();
    this.model = model;
  }

  /**
   * Analyse current arena state and return a narrative decision.
   * Never throws — returns safeDefault() on any error.
   */
  async plan(db: ArenaDatabase, matchCount: number): Promise<PlannerDecision> {
    try {
      const roster = db.getActiveBalls();
      if (roster.length < 2) return this.safeDefault("not enough fighters");

      const context = this.buildContext(db, roster, matchCount);

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: context }],
      });

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();

      return this.parseDecision(text, roster);
    } catch (e: any) {
      console.warn(`[PLANNER] API error: ${e.message}`);
      return this.safeDefault(e.message);
    }
  }

  // ─── Context builder ────────────────────────────────────────────────────────

  private buildContext(
    db: ArenaDatabase,
    roster: BallEntity[],
    matchCount: number,
  ): string {
    const lines: string[] = [];

    lines.push(`Match count: ${matchCount}`);
    lines.push("");

    // ── Roster with skill ratings ──────────────────────────────────────────
    lines.push("ACTIVE FIGHTERS (name | weapon | W-L | streak | skill):");
    for (const b of roster) {
      const skill = calculateSkill(b).toFixed(0);
      const streak = b.currentStreak > 0
        ? `+${b.currentStreak} WIN`
        : b.currentStreak < 0
          ? `${b.currentStreak} LOSS`
          : "none";
      lines.push(`  ${b.id} | ${b.name} | ${b.weaponId} | ${b.wins}W-${b.losses}L | streak:${streak} | skill:${skill}`);
    }
    lines.push("");

    // ── Interesting storylines ─────────────────────────────────────────────
    const onWinStreak  = roster.filter(b => b.currentStreak >= 3);
    const onLossStreak = roster.filter(b => b.currentStreak <= -3);
    const unbeaten     = roster.filter(b => b.wins > 0 && b.losses === 0 && b.wins >= 2);
    const winless      = roster.filter(b => b.losses >= 3 && b.wins === 0);

    const storylines: string[] = [];
    for (const b of onWinStreak)  storylines.push(`${b.name} is on a ${b.currentStreak}-match WIN streak`);
    for (const b of onLossStreak) storylines.push(`${b.name} is on a ${Math.abs(b.currentStreak)}-match LOSS streak`);
    for (const b of unbeaten)     storylines.push(`${b.name} is still undefeated (${b.wins}W-0L)`);
    for (const b of winless)      storylines.push(`${b.name} has not won a single match (0W-${b.losses}L)`);

    if (storylines.length > 0) {
      lines.push("ACTIVE STORYLINES:");
      for (const s of storylines) lines.push(`  - ${s}`);
      lines.push("");
    }

    // ── Top matchmaking candidates ─────────────────────────────────────────
    const topMatchups = findTopMatchups(roster, 5);
    lines.push("TOP MATCHMAKING CANDIDATES (by stat score):");
    for (const m of topMatchups) {
      lines.push(`  ${m.ballA.name} vs ${m.ballB.name} — score:${m.score.toFixed(1)}`);
    }
    lines.push("");

    // ── Head-to-head rivalries (pairs with 3+ prior meetings) ─────────────
    const rivalries: string[] = [];
    for (let i = 0; i < roster.length; i++) {
      for (let j = i + 1; j < roster.length; j++) {
        const h2h = db.getHeadToHeadRecord(roster[i]!.id, roster[j]!.id);
        if (h2h.totalMatches >= 3) {
          rivalries.push(
            `${roster[i]!.name} vs ${roster[j]!.name}: ${h2h.totalMatches} meetings — ` +
            `${roster[i]!.name} leads ${h2h.aWins}-${h2h.bWins}`
          );
        }
      }
    }
    if (rivalries.length > 0) {
      lines.push("ESTABLISHED RIVALRIES (3+ prior meetings):");
      for (const r of rivalries) lines.push(`  - ${r}`);
      lines.push("");
    }

    // ── Recent match results ───────────────────────────────────────────────
    const recent = db.getRecentMatches(8);
    if (recent.length > 0) {
      lines.push("LAST 8 RESULTS (winner ← loser, ticks):");
      for (const m of recent) {
        const winner = m.winner === "A" ? m.ball_a_name : m.ball_b_name;
        const loser  = m.winner === "A" ? m.ball_b_name : m.ball_a_name;
        lines.push(`  ${winner} ← ${loser} (${m.ticks} ticks)`);
      }
      lines.push("");
    }

    lines.push("Based on the above, return your PlannerDecision JSON object.");
    return lines.join("\n");
  }

  // ─── Response parser ────────────────────────────────────────────────────────

  private parseDecision(text: string, roster: BallEntity[]): PlannerDecision {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("[PLANNER] No JSON object found in response");
      return this.safeDefault("no JSON in response");
    }

    let raw: any;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      console.warn("[PLANNER] Failed to parse JSON response");
      return this.safeDefault("JSON parse error");
    }

    const rosterIds = new Set(roster.map(b => b.id));

    // Validate matchup ball IDs exist in roster
    let matchup: PlannerDecision["matchup"] = null;
    if (
      raw.matchup &&
      typeof raw.matchup.ballAId === "string" &&
      typeof raw.matchup.ballBId === "string" &&
      rosterIds.has(raw.matchup.ballAId) &&
      rosterIds.has(raw.matchup.ballBId) &&
      raw.matchup.ballAId !== raw.matchup.ballBId
    ) {
      matchup = {
        ballAId:   raw.matchup.ballAId,
        ballBId:   raw.matchup.ballBId,
        rationale: typeof raw.matchup.rationale === "string" ? raw.matchup.rationale : "",
      };
    }

    const validEvents = new Set(["grudge_match", "debut", "streak_breaker", "rivalry"]);
    const specialEvent: PlannerDecision["specialEvent"] =
      validEvents.has(raw.specialEvent) ? raw.specialEvent : null;

    const narrativeHooks: string[] = Array.isArray(raw.narrativeHooks)
      ? raw.narrativeHooks
          .filter((h: unknown): h is string => typeof h === "string")
          .slice(0, 4)
      : [];

    const retirementCandidates: string[] = Array.isArray(raw.retirementCandidates)
      ? raw.retirementCandidates
          .filter((id: unknown): id is string => typeof id === "string" && rosterIds.has(id))
      : [];

    const plannerRationale: string =
      typeof raw.plannerRationale === "string" ? raw.plannerRationale : "(no rationale)";

    return { matchup, specialEvent, narrativeHooks, retirementCandidates, plannerRationale };
  }

  // ─── Safe default ──────────────────────────────────────────────────────────

  private safeDefault(reason: string): PlannerDecision {
    return {
      matchup:              null,
      specialEvent:         null,
      narrativeHooks:       [],
      retirementCandidates: [],
      plannerRationale:     `[fallback: ${reason}]`,
    };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Arena Master AI for WORBZ — an autonomous ball combat arena.
Your role is to choose which fighters meet next and craft narrative hooks for the commentator.

You will receive current arena state: fighter records, active storylines, matchmaking scores,
rivalries, and recent results. Respond with a single JSON object matching this exact schema:

{
  "matchup": {
    "ballAId": "<exact id from fighter list>",
    "ballBId": "<exact id from fighter list>",
    "rationale": "<1 sentence: why this fight makes narrative sense>"
  } | null,
  "specialEvent": "grudge_match" | "debut" | "streak_breaker" | "rivalry" | null,
  "narrativeHooks": ["<short present-tense hook>", ...],
  "retirementCandidates": ["<ballId>", ...],
  "plannerRationale": "<1-2 sentences: your overall reasoning>"
}

Rules:
- Set matchup to null if the stat-based matchmaker would make a better call than you
- narrativeHooks: max 4 short strings (e.g. "Iron Bulwark seeks redemption after 3 straight losses")
  — these are passed directly to the commentator to weave into their announcement
- retirementCandidates: only flag fighters on 5+ loss streaks with 0 wins — human will review
- Prioritise story over pure balance: a great narrative match beats a perfectly fair one
- If a fighter is on a long WIN streak, consider either protecting that streak (give them an easy match)
  or challenging it (give them a worthy opponent) — pick whichever makes better drama
- Respond with ONLY the JSON object — no markdown, no explanation outside the JSON`;
