// src/agent/arena-master.ts
// Claude-powered Arena Master agent that analyzes match balance and proposes stat changes.

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { ArenaDatabase } from "../data/database";
import type { BalanceReport, StatProposal, WeaponOverride } from "../data/types";

const WEAPONS_CATALOG = {
  short_sword: { type: "blade", reach: 60, tipRadius: 15, bladeStart: 25, bladeWidth: 8, shaftRadius: 5, omega: 1800, baseDamage: 12, ramp: 3, speedMult: 1000, weight: 800 },
  katana:      { type: "blade", reach: 85, tipRadius: 12, bladeStart: 30, bladeWidth: 10, shaftRadius: 6, omega: 1600, baseDamage: 11, ramp: 3, speedMult: 1050, weight: 850 },
  spear:       { type: "point", reach: 110, tipRadius: 8, shaftRadius: 5, omega: 1200, baseDamage: 18, ramp: 4, speedMult: 950, weight: 900 },
  mace:        { type: "blunt", reach: 70, tipRadius: 35, shaftRadius: 8, omega: 1400, baseDamage: 14, ramp: 2, speedMult: 900, weight: 1400 },
};

interface RawProposal {
  ballId: string;
  reason: string;
  proposedStats: {
    baseHp?: number;
    radius?: number;
    restitution?: number;
    weaponId?: string;
    weaponOverride?: Partial<WeaponOverride>;
  };
}

export class ArenaMasterAgent {
  private client: Anthropic;
  private model: string;

  constructor(model: string = "claude-opus-4-6") {
    this.client = new Anthropic();
    this.model = model;
  }

  async analyzeAndPropose(db: ArenaDatabase, report: BalanceReport): Promise<StatProposal[]> {
    const allBalls = db.getActiveBalls();

    // Collect existing weapon overrides for context
    const allOverrides: Record<string, WeaponOverride[]> = {};
    for (const ball of allBalls) {
      const overrides = db.getWeaponOverrides(ball.id);
      if (overrides.length > 0) allOverrides[ball.id] = overrides;
    }

    const systemPrompt = `You are the Arena Master AI for WORBZ, an autonomous ball combat arena.
Your job is to keep fights exciting and balanced by proposing targeted stat adjustments.

WEAPON STAT MEANINGS:
- baseDamage: damage per hit (higher = more damage)
- reach: weapon length in pixels (higher = longer range)
- omega: rotation speed (higher = faster weapon swing, more hits)
- speedMult: movement speed multiplier in 1000ths (1000 = normal, 1050 = 5% faster)
- weight: weapon weight in 1000ths (higher = more knockback)
- tipRadius: hitbox size of weapon tip in pixels

BALL STAT MEANINGS:
- baseHp: starting health points (900-1100 range)
- radius: ball size in pixels (38-44 range)
- restitution: bounce elasticity in 1000ths (900-1100 typical)

BALANCE PRINCIPLES:
- Win rate near 50% = balanced fighter
- dominanceScore > 60 for a weapon = that weapon is overpowered
- Prefer small adjustments (±5-10%) over large changes
- Consider personality when suggesting weapon switches
- Fighters with 0 matches lack data — don't propose changes for them`;

    const userPrompt = `Here is the current balance report for the WORBZ arena:

BALANCE REPORT:
${JSON.stringify(report, null, 2)}

WEAPON CATALOG (global stats):
${JSON.stringify(WEAPONS_CATALOG, null, 2)}

CURRENT PER-BALL WEAPON OVERRIDES:
${JSON.stringify(allOverrides, null, 2)}

ACTIVE FIGHTERS (id, name, weapon, hp, radius):
${allBalls.map(b => `  ${b.id}: ${b.name} | weapon: ${b.weaponId} | hp: ${b.baseHp} | radius: ${b.radius} | restitution: ${b.restitution ?? 1000}`).join("\n")}

Based on this data, propose 3-5 stat changes to improve balance and engagement.
Focus on fighters or weapons with clear imbalances (very high/low win rates or dominance scores).
Skip fighters with fewer than 3 matches — not enough data.

Respond with ONLY a JSON array — no markdown, no explanation outside the JSON:
[
  {
    "ballId": "<exact ball id from the list above>",
    "reason": "<1-2 sentence explanation of the balance problem>",
    "proposedStats": {
      "baseHp": <number or omit>,
      "radius": <number or omit>,
      "restitution": <number or omit>,
      "weaponId": "<weapon name or omit>",
      "weaponOverride": {
        "baseDamage": <number or omit>,
        "reach": <number or omit>,
        "omega": <number or omit>,
        "speedMult": <number or omit>,
        "weight": <number or omit>,
        "tipRadius": <number or omit>
      }
    }
  }
]`;

    console.log("  Calling Claude API...");

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    const responseText = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    const rawProposals = this.parseProposals(responseText);
    const ballMap = new Map(allBalls.map(b => [b.id, b]));

    const proposals: StatProposal[] = [];

    for (const raw of rawProposals) {
      const ball = ballMap.get(raw.ballId);
      if (!ball) {
        console.warn(`  Skipping proposal for unknown ballId: ${raw.ballId}`);
        continue;
      }

      // Validate proposed changes don't exceed ±20% of current values
      const proposed = raw.proposedStats;
      if (proposed.baseHp !== undefined) {
        const pct = Math.abs(proposed.baseHp - ball.baseHp) / ball.baseHp;
        if (pct > 0.2) {
          console.warn(`  Clamping baseHp change for ${ball.name} (${pct * 100 | 0}% > 20%)`);
          proposed.baseHp = Math.round(ball.baseHp * (proposed.baseHp > ball.baseHp ? 1.2 : 0.8));
        }
      }
      if (proposed.radius !== undefined) {
        const pct = Math.abs(proposed.radius - ball.radius) / ball.radius;
        if (pct > 0.2) {
          proposed.radius = Math.round(ball.radius * (proposed.radius > ball.radius ? 1.2 : 0.8));
        }
      }

      const currentStats: Record<string, unknown> = {
        baseHp: ball.baseHp,
        radius: ball.radius,
        restitution: ball.restitution ?? 1000,
        weaponId: ball.weaponId,
      };

      const existingOverride = db.getWeaponOverrides(ball.id).find(o => o.weaponId === ball.weaponId);
      if (existingOverride) currentStats.weaponOverride = existingOverride;

      proposals.push({
        id: randomUUID(),
        ballId: ball.id,
        ballName: ball.name,
        reason: raw.reason,
        currentStats,
        proposedStats: proposed as Record<string, unknown>,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }

    return proposals;
  }

  private parseProposals(text: string): RawProposal[] {
    // Extract JSON array from response (Claude may include surrounding text)
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn("  Could not find JSON array in Claude response");
      return [];
    }

    try {
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        p => typeof p.ballId === "string" && typeof p.reason === "string" && p.proposedStats
      );
    } catch (e) {
      console.warn("  Failed to parse Claude response as JSON:", e);
      return [];
    }
  }
}
