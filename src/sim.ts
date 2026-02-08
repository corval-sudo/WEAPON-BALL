import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createSim, stepSim, canonicalEventsString, canonicalInputs, MatchSpec } from "./simCore";

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function validateFilePath(filePath: string): string {
  // Resolve to absolute path and ensure it's within the project directory
  const resolved = path.resolve(filePath);
  const projectRoot = path.resolve(process.cwd());
  
  // Check if path is within project root (basic security check)
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Invalid file path: ${filePath} (outside project directory)`);
  }
  
  return resolved;
}

function loadMatchSpec(specPath: string): MatchSpec {
  try {
    const validatedPath = validateFilePath(specPath);
    
    // Check if file exists
    if (!fs.existsSync(validatedPath)) {
      throw new Error(`Match spec file not found: ${specPath}`);
    }
    
    // Read and parse JSON
    const fileContent = fs.readFileSync(validatedPath, "utf8");
    let spec: unknown;
    
    try {
      spec = JSON.parse(fileContent);
    } catch (parseError) {
      throw new Error(`Invalid JSON in match spec file: ${parseError instanceof Error ? parseError.message : "Unknown error"}`);
    }
    
    // Basic validation - check for required fields
    if (typeof spec !== "object" || spec === null) {
      throw new Error("Match spec must be an object");
    }
    
    const matchSpec = spec as MatchSpec;
    
    // Validate required fields
    if (typeof matchSpec.seed !== "number") {
      throw new Error("Match spec must have a numeric 'seed' field");
    }
    if (!matchSpec.sim || typeof matchSpec.sim.scale !== "number" || typeof matchSpec.sim.maxTicks !== "number") {
      throw new Error("Match spec must have a 'sim' object with 'scale' and 'maxTicks'");
    }
    if (!matchSpec.arena || typeof matchSpec.arena.w !== "number" || typeof matchSpec.arena.h !== "number") {
      throw new Error("Match spec must have an 'arena' object with 'w' and 'h'");
    }
    if (!matchSpec.weapons || typeof matchSpec.weapons !== "object") {
      throw new Error("Match spec must have a 'weapons' object");
    }
    if (!matchSpec.ballA || !matchSpec.ballB) {
      throw new Error("Match spec must have 'ballA' and 'ballB'");
    }
    
    return matchSpec;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error loading match spec: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

// Main execution
try {
  const specPath = process.argv[2] ?? "matchSpec.json";
  const spec = loadMatchSpec(specPath);
  
  const sim = createSim(spec);
  
  // Safety counter to prevent infinite loops
  const MAX_ITERATIONS = spec.sim.maxTicks * 2;
  let iterations = 0;
  
  while (!sim.done && iterations < MAX_ITERATIONS) {
    stepSim(sim);
    iterations++;
  }
  
  if (iterations >= MAX_ITERATIONS && !sim.done) {
    console.error("Warning: Simulation reached maximum iterations without completing");
  }
  
  const inputsHash = sha256Hex(JSON.stringify(canonicalInputs(spec)));
  const eventsHash = sha256Hex(canonicalEventsString(sim.events));
  const resultHash = sha256Hex(JSON.stringify({ inputsHash, eventsHash, winner: sim.winner }));
  
  // Output to stdout (can be redirected)
  console.log(
    JSON.stringify(
      {
        seed: spec.seed,
        ticks: sim.tick,
        winner: sim.winner,
        inputsHash,
        eventsHash,
        resultHash,
        events: sim.events
      },
      null,
      2
    )
  );
} catch (error) {
  console.error("Fatal error:", error instanceof Error ? error.message : "Unknown error");
  process.exit(1);
}