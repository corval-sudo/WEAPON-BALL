// src/scripts/balance.ts
// CLI entry point for the Arena Master AI balance review system.
//
// Usage:
//   npm run balance              # Full analysis + AI proposals (interactive)
//   npm run balance -- --report  # Print balance report only, no AI calls
//   npm run balance -- --list    # List all pending proposals
//   npm run balance -- --apply   # Apply all approved proposals to DB

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as readline from "node:readline";
import { ArenaDatabase } from "../data/database";
import { buildBalanceReport, formatBalanceReport } from "../agent/balance-analyzer";
import { ArenaMasterAgent } from "../agent/arena-master";
import { runDryRun, formatDryRunResult } from "../agent/proposal-engine";
import type { StatProposal, WeaponOverride } from "../data/types";

const args = process.argv.slice(2);
const MODE = args.find(a => a.startsWith("--"))?.replace("--", "") ?? "full";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function printProposal(proposal: StatProposal, index: number, total: number): void {
  const proposed = proposal.proposedStats as any;
  const current = proposal.currentStats as any;

  console.log(`\n[${index + 1}/${total}] ${proposal.ballName}`);
  console.log(`  Reason: ${proposal.reason}`);
  console.log("  Changes:");

  if (proposed.baseHp !== undefined)
    console.log(`    baseHp:      ${current.baseHp} → ${proposed.baseHp}`);
  if (proposed.radius !== undefined)
    console.log(`    radius:      ${current.radius} → ${proposed.radius}`);
  if (proposed.restitution !== undefined)
    console.log(`    restitution: ${current.restitution} → ${proposed.restitution}`);
  if (proposed.weaponId !== undefined)
    console.log(`    weaponId:    ${current.weaponId} → ${proposed.weaponId}`);
  if (proposed.weaponOverride) {
    console.log("    weaponOverride:");
    for (const [k, v] of Object.entries(proposed.weaponOverride)) {
      console.log(`      ${k}: ${v}`);
    }
  }
}

async function applyProposal(db: ArenaDatabase, proposal: StatProposal): Promise<void> {
  const proposed = proposal.proposedStats as any;

  // Apply ball stat changes
  const ballUpdate: Record<string, any> = {};
  if (proposed.baseHp !== undefined) ballUpdate.baseHp = proposed.baseHp;
  if (proposed.radius !== undefined) ballUpdate.radius = proposed.radius;
  if (proposed.restitution !== undefined) ballUpdate.restitution = proposed.restitution;
  if (proposed.weaponId !== undefined) ballUpdate.weaponId = proposed.weaponId;

  if (Object.keys(ballUpdate).length > 0) {
    // Update ball in DB using raw SQL via the updateBallStats extension
    const ball = db.getBallById(proposal.ballId);
    if (ball) {
      if (proposed.baseHp !== undefined) ball.baseHp = proposed.baseHp;
      if (proposed.radius !== undefined) ball.radius = proposed.radius;
      if (proposed.restitution !== undefined) ball.restitution = proposed.restitution;
      if (proposed.weaponId !== undefined) ball.weaponId = proposed.weaponId;
      db.applyBallStatChanges(proposal.ballId, ballUpdate);
    }
  }

  // Apply weapon override
  if (proposed.weaponOverride) {
    const ball = db.getBallById(proposal.ballId);
    if (ball) {
      const override: WeaponOverride = {
        ballId: proposal.ballId,
        weaponId: proposed.weaponId ?? ball.weaponId,
        ...proposed.weaponOverride,
        appliedAt: new Date().toISOString(),
        proposalId: proposal.id,
      };
      db.saveWeaponOverride(override);
    }
  }

  db.updateProposalStatus(proposal.id, "approved");
  console.log(`  ✓ Applied changes for ${proposal.ballName}`);
}

async function modeReport(db: ArenaDatabase): Promise<void> {
  console.log("\nBuilding balance report...");
  const report = buildBalanceReport(db);
  console.log("\n" + formatBalanceReport(report));
}

async function modeList(db: ArenaDatabase): Promise<void> {
  const pending = db.getPendingProposals();
  if (pending.length === 0) {
    console.log("\nNo pending proposals.");
    return;
  }
  console.log(`\n${pending.length} pending proposal(s):\n`);
  pending.forEach((p, i) => printProposal(p, i, pending.length));
}

async function modeApply(db: ArenaDatabase): Promise<void> {
  const pending = db.getPendingProposals();
  if (pending.length === 0) {
    console.log("\nNo pending proposals to apply.");
    return;
  }
  console.log(`\nApplying ${pending.length} approved proposal(s)...`);
  for (const proposal of pending) {
    await applyProposal(db, proposal);
  }
  console.log("\nDone.");
}

async function modeFull(db: ArenaDatabase): Promise<void> {
  // Step 1: Build and display balance report
  console.log("\nBuilding balance report...");
  const report = buildBalanceReport(db);
  console.log("\n" + formatBalanceReport(report));

  const matchedFighters = report.fighters.filter(f => f.matchCount >= 3);
  if (matchedFighters.length === 0) {
    console.log("\n⚠  Not enough match data for AI analysis (need at least 3 matches per fighter).");
    console.log("   Run more matches with: npm run match <name1> <name2>");
    return;
  }

  // Step 2: Call Arena Master agent
  console.log("\n\nCalling Arena Master AI...");
  const agent = new ArenaMasterAgent();
  let proposals: StatProposal[];

  try {
    proposals = await agent.analyzeAndPropose(db, report);
  } catch (e: any) {
    console.error("\n✗ Failed to get proposals from Claude API:", e.message);
    if (e.message?.includes("ANTHROPIC_API_KEY")) {
      console.error("  Add ANTHROPIC_API_KEY=your_key to your .env file");
    }
    return;
  }

  if (proposals.length === 0) {
    console.log("\nNo proposals generated. Arena may already be well balanced!");
    return;
  }

  console.log(`\nReceived ${proposals.length} proposal(s). Running dry-run simulations...\n`);

  // Step 3: Run dry-runs and show results interactively
  const approved: StatProposal[] = [];
  let proposalIndex = 0;

  for (const proposal of proposals) {
    printProposal(proposal, proposalIndex, proposals.length);
    proposalIndex++;

    // Run dry-run
    process.stdout.write("  Running dry-run simulations... ");
    try {
      proposal.dryRunResults = await runDryRun(proposal, db);
      console.log("done.\n");
      console.log(formatDryRunResult(proposal.dryRunResults, proposal.ballName));
    } catch (e: any) {
      console.log(`failed: ${e.message}`);
    }

    // Save proposal to DB regardless of approval
    db.saveProposal(proposal);

    // Ask user
    const answer = await prompt("\n  Approve this change? [y/n/s(kip all)] > ");

    if (answer === "y" || answer === "yes") {
      await applyProposal(db, proposal);
      approved.push(proposal);
    } else if (answer === "s") {
      console.log("  Skipping remaining proposals.");
      break;
    } else {
      db.updateProposalStatus(proposal.id, "rejected");
      console.log("  Rejected.");
    }
  }

  console.log(`\n=== Summary: ${approved.length}/${proposals.length} proposals approved ===`);
  if (approved.length > 0) {
    console.log("Changes will take effect in the next match automatically.");
  }
}

async function main(): Promise<void> {
  const db = new ArenaDatabase();

  try {
    switch (MODE) {
      case "report":
        await modeReport(db);
        break;
      case "list":
        await modeList(db);
        break;
      case "apply":
        await modeApply(db);
        break;
      default:
        await modeFull(db);
        break;
    }
  } finally {
    db.close();
  }
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
