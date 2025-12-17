import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { createSim, stepSim, canonicalEventsString, canonicalInputs, MatchSpec } from "./simCore";

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const specPath = process.argv[2] ?? "matchSpec.json";
const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as MatchSpec;

const sim = createSim(spec);
while (!sim.done) stepSim(sim);

const inputsHash = sha256Hex(JSON.stringify(canonicalInputs(spec)));
const eventsHash = sha256Hex(canonicalEventsString(sim.events));
const resultHash = sha256Hex(JSON.stringify({ inputsHash, eventsHash, winner: sim.winner }));

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