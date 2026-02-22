// src/main.ts
// Single Railway entry point — starts the API server and match scheduler
// together in one Node process so there's no risk of double-binding port 8080.

// Server registers routes and calls server.listen() at module load time.
import "./api/server";

// Schedule calls main() at module load time (async, self-contained loop).
import "./scripts/schedule";
