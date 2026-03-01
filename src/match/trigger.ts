// src/match/trigger.ts
// Shared EventEmitter for manual match triggering.
// Both schedule.ts (listener) and server.ts (emitter) import this singleton
// to decouple them without circular dependencies.

import { EventEmitter } from "node:events";
export const matchTrigger = new EventEmitter();
