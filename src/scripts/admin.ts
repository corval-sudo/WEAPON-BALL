// src/scripts/admin.ts
// Permissioned Arena Master configuration CLI.
//
// Usage:
//   npm run admin show                      # Always permitted — view all config
//   npm run admin set <key> <value>         # Requires ADMIN_SECRET in .env
//   npm run admin personality               # Requires ADMIN_SECRET — multi-line editor
//
// To enable write access, add ADMIN_SECRET=yourpassword to your .env file.
// Read (show) is always permitted without a secret.

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import * as readline from "node:readline";
import { ArenaDatabase } from "../data/database";
import { ConfigStore, CONFIG_KEYS } from "../data/config-store";
import type { ConfigRow, ConfigKey } from "../data/config-store";

// ─── Auth ─────────────────────────────────────────────────────────────────────

const ADMIN_SECRET = process.env["ADMIN_SECRET"];

function assertWriteAuth(): void {
  if (!ADMIN_SECRET) {
    console.error("╳  Write access denied.");
    console.error("   Add ADMIN_SECRET=yourpassword to your .env file, then retry.");
    console.error("   Example: echo 'ADMIN_SECRET=mypassword' >> .env");
    process.exit(1);
  }
}

// ─── Display ──────────────────────────────────────────────────────────────────

function truncate(s: string, len: number): string {
  const single = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return single.length > len ? single.slice(0, len - 1) + "…" : single;
}

function printConfigTable(rows: ConfigRow[]): void {
  const COL_KEY  = 38;
  const COL_VAL  = 55;
  const COL_DESC = 42;
  const COL_WHEN = 12;
  const TOTAL    = COL_KEY + COL_VAL + COL_DESC + COL_WHEN;

  const sep = "─".repeat(TOTAL);

  console.log("\n" + sep);
  console.log(
    "Key".padEnd(COL_KEY) +
    "Value".padEnd(COL_VAL) +
    "Description".padEnd(COL_DESC) +
    "Updated"
  );
  console.log(sep);

  for (const row of rows) {
    const updatedShort = row.updated_at.slice(0, 10); // YYYY-MM-DD
    console.log(
      row.key.padEnd(COL_KEY) +
      truncate(row.value, COL_VAL - 1).padEnd(COL_VAL) +
      truncate(row.description, COL_DESC - 1).padEnd(COL_DESC) +
      updatedShort
    );
  }

  console.log(sep + "\n");
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

function cmdShow(store: ConfigStore): void {
  const rows = store.getAll();
  if (rows.length === 0) {
    console.log("No config rows found. Database migration may not have run yet.");
    console.log("  Tip: Any npm run command that uses ArenaDatabase will trigger migrations.");
    return;
  }
  printConfigTable(rows);
  console.log(`  ${rows.length} config key(s). Use 'npm run admin set <key> <value>' to update.`);
  if (!ADMIN_SECRET) {
    console.log("  ⚠  ADMIN_SECRET not set — write commands are locked.");
  }
}

function cmdSet(store: ConfigStore, key: string, value: string): void {
  assertWriteAuth();

  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    console.error(`╳  Unknown config key: "${key}"`);
    console.error(`   Valid keys: ${CONFIG_KEYS.join(", ")}`);
    process.exit(1);
  }

  store.set(key as ConfigKey, value);
  console.log(`✓  ${key} updated.`);
  console.log(`   New value: ${truncate(value, 80)}`);
  console.log("   Takes effect on next scheduler restart.");
}

async function cmdPersonality(store: ConfigStore): Promise<void> {
  assertWriteAuth();

  const current = store.get("personality") ?? "";
  console.log("Current personality (first 300 chars):");
  console.log("─".repeat(60));
  console.log(truncate(current, 300));
  console.log("─".repeat(60));
  console.log("\nPaste the new personality prompt below.");
  console.log("When done, type END on its own line and press Enter.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];

  await new Promise<void>(resolve => {
    rl.on("line", line => {
      if (line.trim() === "END") {
        rl.close();
        resolve();
      } else {
        lines.push(line);
      }
    });
  });

  const newPersonality = lines.join("\n").trim();
  if (!newPersonality) {
    console.log("No input received. Personality unchanged.");
    return;
  }

  store.set("personality", newPersonality);
  console.log(`✓  Personality updated (${newPersonality.length} chars).`);
  console.log("   Takes effect on next scheduler restart.");
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcmd = args[0] ?? "show";

  console.log("╔══════════════════════════════════════╗");
  console.log("║   WORBZ  Arena Master Admin CLI      ║");
  console.log("╚══════════════════════════════════════╝\n");

  if (!ADMIN_SECRET) {
    console.warn("  NOTE: ADMIN_SECRET is not set — write commands are locked.");
    console.warn("        Add ADMIN_SECRET=yourpassword to .env to enable writes.\n");
  }

  const db = new ArenaDatabase();
  const store = new ConfigStore(db.getRawDb());

  try {
    switch (subcmd) {
      case "show":
        cmdShow(store);
        break;

      case "set": {
        const key   = args[1] ?? "";
        const value = args.slice(2).join(" ");
        if (!key || !value) {
          console.error("Usage: npm run admin set <key> <value>");
          console.error(`Valid keys: ${CONFIG_KEYS.join(", ")}`);
          process.exit(1);
        }
        cmdSet(store, key, value);
        break;
      }

      case "personality":
        await cmdPersonality(store);
        break;

      case "help":
      default:
        console.log("Available subcommands:");
        console.log("  show                   — Print all config values (no auth required)");
        console.log("  set <key> <value>      — Update a single config value");
        console.log("  personality            — Open multi-line editor for the Arena Master persona");
        console.log("\nValid keys:");
        for (const k of CONFIG_KEYS) {
          console.log(`  ${k}`);
        }
        if (subcmd !== "help") {
          console.error(`\n╳  Unknown subcommand: "${subcmd}"`);
          process.exit(1);
        }
    }
  } finally {
    db.close();
  }
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
