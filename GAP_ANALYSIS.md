# WORBZ Arena Master — Gap Analysis Report
**Date:** 2026-02-13
**Project:** arena-sim (WORBZ Arena Master)
**Spec Reference:** `WORBZ_ARENA_MASTER_SPEC.md`

---

## Executive Summary

The current codebase implements a **functional but minimal physics-based ball combat simulation** with a visualization layer. It represents approximately **15-20% of the full WORBZ Arena Master vision**. The existing work is solid foundational code for Phase 1 (Core Simulation Engine), but **zero agent, social, wagering, or blockchain components exist**.

**Key Finding:** This is a **simulation engine**, not yet an **autonomous AI agent**. The path to MVP requires building entirely new subsystems around the existing core.

---

## 1. What Already Exists

### ✅ Phase 1: Core Simulation Engine (PARTIAL — ~60% complete)

| Spec Component | Implementation Status | Files | Notes |
|---|---|---|---|
| **Ball Physics** | ✅ Implemented | `src/simCore.ts` | Core ball entity with position, velocity, HP |
| **Ball Properties** | ⚠️ Partial | `src/simCore.ts:20-70` | Has: `id`, `hp`, `radius`, `pos`, `vel`, `weaponId`, `restitution`<br>**Missing:** `name`, `color`, `size`, `speed`, `armor`, `aggression`, `wins`, `losses`, `streak`, `specialAbility` |
| **Weapon System** | ✅ Implemented | `src/simCore.ts:4-18` | Full weapon type system: blade, point, blunt with shape-based hitboxes |
| **Arena Properties** | ⚠️ Partial | `src/simCore.ts:30-35` | Has: `w`, `h`, `wallRestitution`<br>**Missing:** `name`, `hazards[]`, `modifiers[]` |
| **Special Abilities** | ❌ Not Implemented | — | No special abilities system exists |
| **Match Simulation Logic** | ✅ Implemented | `src/simCore.ts:646-745` | Full physics loop with gravity, collisions, weapon hits |
| **Deterministic Seeding** | ✅ Implemented | `src/simCore.ts:88-96` | Uses mulberry32 PRNG for reproducibility |
| **Events Log** | ✅ Implemented | `src/simCore.ts:40-45, 187-199` | Generates event stream: hit, dead, collide, wall, timeout |
| **Match Result** | ⚠️ Partial | `src/sim.ts:96-115` | Has: seed, ticks, winner, events, hashes<br>**Missing:** `highlights[]`, `stats` (accuracy, dodge rate, etc.) |
| **Ball Roster Management** | ❌ Not Implemented | — | No roster system, matchmaking, career tracking, or retirement |
| **Visualization** | ✅ Implemented | `viewer/src/main.ts` | Full canvas-based renderer with sprite support, HP bars, admin panel |

**Strengths:**
- Rock-solid deterministic physics engine
- Innovative weapon shape system (blade/point/blunt)
- Clean separation of simulation core from visualization
- Event-driven architecture ready for commentary generation
- Batch match runner for statistical testing

**Gaps:**
- No ball personality/identity layer
- No arena hazards or modifiers
- No special abilities or progression mechanics
- No career/roster management system
- Match stats are minimal (no accuracy, dodge rate, combo tracking)

---

### ❌ Phase 2: The Arena Master Agent (NOT STARTED — 0% complete)

| Spec Component | Status | Notes |
|---|---|---|
| Agent Character & Personality | ❌ Not Implemented | No AI agent exists |
| Autonomous Scheduling | ❌ Not Implemented | No scheduler, no match lifecycle automation |
| Matchmaking AI | ❌ Not Implemented | No logic for creating interesting matchups |
| Content Generation | ❌ Not Implemented | No LLM integration for commentary |
| Virtuals GAME Framework Integration | ❌ Not Implemented | No agent framework |
| Memory System | ❌ Not Implemented | No persistent state beyond match results |

**Gap:** The entire "Arena Master" concept — the AI character that runs the show — does not exist. This is the most critical missing piece for the WORBZ vision.

---

### ❌ Phase 3: Wagering Engine (NOT STARTED — 0% complete)

| Spec Component | Status | Notes |
|---|---|---|
| Odds Generation | ❌ Not Implemented | No odds calculation |
| Wagering System | ❌ Not Implemented | No betting logic (on-chain or off-chain) |
| Economy Balancing | ❌ Not Implemented | No economic monitoring |

**Gap:** Zero betting infrastructure. This is the monetization layer.

---

### ❌ Phase 4: Social & Community Layer (NOT STARTED — 0% complete)

| Spec Component | Status | Notes |
|---|---|---|
| X (Twitter) Integration | ❌ Not Implemented | No social posting |
| Telegram Bot | ❌ Not Implemented | No bot |
| Visual Content Generation | ⚠️ Partial | Viewer can generate static match cards, but no automated sharing |

**Gap:** No social presence, no community engagement tools.

---

### ❌ Phase 5: On-Chain & Virtuals Integration (NOT STARTED — 0% complete)

| Spec Component | Status | Notes |
|---|---|---|
| Token Utility ($WORBZ) | ❌ Not Implemented | No token integration |
| Agent Wallet | ❌ Not Implemented | No blockchain components |
| ACP Integration | ❌ Not Implemented | No agent commerce protocol |
| Smart Contracts | ❌ Not Implemented | No on-chain logic |

**Gap:** Entire blockchain/token layer missing.

---

## 2. What's Missing (Components with NO Code)

### Critical Missing Components

1. **AI Agent Core (Priority 1)**
   - No LLM integration (Claude API, character prompts)
   - No autonomous decision-making logic
   - No personality/character system
   - No memory/context management

2. **Roster & Career System (Priority 1)**
   - No persistent ball database
   - No win/loss tracking across matches
   - No streaks, rankings, reputation
   - No ball creation/retirement logic
   - No personality descriptions for fighters

3. **Matchmaking Engine (Priority 2)**
   - No logic for selecting interesting matchups
   - No rivalry tracking
   - No narrative arc building
   - No variety algorithms

4. **Commentary Generation (Priority 1)**
   - No LLM-based content creation from events
   - No match announcement templates
   - No post-match analysis
   - No hype generation

5. **Wagering System (Priority 2)**
   - No odds calculation
   - No bet placement/tracking
   - No payout logic
   - No leaderboard

6. **Social Integration (Priority 2)**
   - No X API client
   - No Telegram bot
   - No automated posting
   - No community interaction handlers

7. **Match Stats & Analytics (Priority 3)**
   - No hit accuracy tracking
   - No dodge rate calculation
   - No combo detection
   - No highlight detection logic (excitement scoring)

8. **Arena Hazards & Modifiers (Priority 3)**
   - No environmental hazards
   - No arena modifiers (low gravity, double damage)
   - No dynamic arena effects

9. **Special Abilities (Priority 3)**
   - No special ability system
   - No conditional triggers
   - No buff/debuff mechanics

10. **Autonomous Scheduler (Priority 1)**
    - No cron/scheduling system
    - No match lifecycle automation
    - No event timing logic

---

## 3. What Needs Refactoring

### 🟡 Minor Tweaks Required

**`matchSpec.json` → Ball Entity Schema**
- **Current:** Stores match-specific ball state (`pos`, `vel`, `weaponId`)
- **Needed:** Extend to include persistent ball identity (`name`, `color`, `wins`, `losses`, `personality`)
- **Effort:** 1-2 hours
- **Approach:** Add new fields to `BallSpec` interface, create `BallRoster` type for persistent data

**Event Log → Commentary Input Format**
- **Current:** Events are raw (`{ t, e, from, to, dmg }`)
- **Needed:** Add `excitement_score` and `description` fields per spec
- **Effort:** 2-3 hours
- **Approach:** Add excitement scoring function in `simCore.ts`, generate human-readable descriptions

### 🟠 Moderate Rework Required

**Simulation Output → MatchResult Format**
- **Current:** `sim.ts` outputs minimal JSON (seed, ticks, winner, events, hashes)
- **Needed:** Full `MatchResult` with `highlights[]`, `stats` (accuracy, dodge rate, specials activated, longest combo)
- **Effort:** 4-6 hours
- **Approach:**
  - Add `MatchStats` interface
  - Track hit/miss counts during simulation
  - Calculate accuracy, dodge rate, combo chains
  - Filter events by `excitement_score > 7` for highlights

**Arena System → Arena Manager**
- **Current:** Arena is a simple `{ w, h, wallRestitution }` config
- **Needed:** Arena objects with `name`, `hazards[]`, `modifiers[]` per spec
- **Effort:** 8-12 hours
- **Approach:**
  - Create `Arena` interface matching spec
  - Implement hazard collision detection (lava pits, spike walls)
  - Implement modifier effects (low gravity, double damage)
  - Create arena catalog with multiple arenas

**Weapon System → Weapon Catalog**
- **Current:** Weapons defined inline in `matchSpec.json`
- **Needed:** Persistent weapon catalog with versioning
- **Effort:** 2-4 hours
- **Approach:**
  - Move weapon definitions to `config/weapons.json`
  - Add weapon descriptions, lore
  - Version weapon sets (`weaponSetVersion` already exists in spec)

### 🔴 Full Rewrite Required

**None.** The core simulation engine is solid and doesn't need rewriting. New systems should be built around it.

---

## 4. Conflicts (Architecture Mismatches)

### ⚠️ Critical Conflicts

**1. Ball Identity vs. Match State**
- **Spec Assumes:** Persistent ball entities with careers tracked over time
- **Current Code:** Balls are ephemeral, created fresh for each match
- **Impact:** High — affects entire data model
- **Resolution:** Create two layers:
  - `BallEntity` (persistent: id, name, wins, losses, personality)
  - `BallState` (transient: current match state)
  - Load `BallEntity` → initialize `BallState` for each match

**2. Automation vs. Manual Execution**
- **Spec Assumes:** Autonomous agent running 24/7, scheduling matches without human input
- **Current Code:** Manual CLI execution (`npm run sim`) + viewer
- **Impact:** High — requires complete runtime redesign
- **Resolution:** Build Node.js daemon process with scheduler, replace CLI with server

### ⚠️ Minor Conflicts

**3. Visualization Focus vs. Headless Agent**
- **Current Code:** Heavily focused on browser-based visualization
- **Spec Needs:** Headless simulation for autonomous operation (visualization is secondary)
- **Impact:** Low — viewer can remain as dev tool
- **Resolution:** Keep viewer as separate dev/debug tool, agent runs headless

**4. Single Match vs. Continuous Operation**
- **Current Code:** Designed to run one match at a time
- **Spec Needs:** Continuous match schedule with intermissions
- **Impact:** Medium
- **Resolution:** Wrap simulation in scheduler loop, add inter-match delays

---

## 5. Recommended Build Order

Given what exists, here's the most efficient path to a **working MVP** (Minimal Viable Product):

### 🎯 Phase A: Foundation (Week 1-2)

**Goal:** Transform simulation into a persistent system with ball identities

1. **Create Ball Roster System** (Priority 1)
   - Design `BallEntity` schema (persistent data)
   - Create initial roster of 20-30 balls with names, stats, personalities
   - Build roster manager (load, save, update careers)
   - Implement win/loss tracking
   - **Deliverable:** `src/data/roster.ts`, `config/default-roster.json`

2. **Extend Match Output** (Priority 1)
   - Add `MatchStats` calculation (accuracy, dodge rate, specials)
   - Implement excitement scoring for events
   - Generate `highlights[]` by filtering high-excitement events
   - **Deliverable:** Enhanced `MatchResult` format

3. **Add Arena Catalog** (Priority 2)
   - Create 3-5 named arenas with descriptions
   - Implement basic hazard system (1-2 hazard types)
   - **Deliverable:** `config/arenas.json`, hazard collision logic

4. **Database Setup** (Priority 1)
   - Choose storage (SQLite for MVP)
   - Create schema for: balls, matches, events
   - Build data access layer
   - **Deliverable:** `src/data/database.ts`, migrations

### 🤖 Phase B: The Agent Brain (Week 2-3)

**Goal:** Build the Arena Master AI character

5. **LLM Integration** (Priority 1)
   - Set up Anthropic Claude API client
   - Create character card / system prompt for Arena Master
   - Test commentary generation from match events
   - **Deliverable:** `src/agent/character.ts`, `src/agent/commentary.ts`

6. **Content Generation Pipeline** (Priority 1)
   - Match announcement generator (input: 2 balls + arena → hype post)
   - Commentary thread generator (input: match events → 3-6 tweet thread)
   - Post-match analysis generator
   - **Deliverable:** `src/agent/content.ts`, prompt templates

7. **Matchmaking Logic** (Priority 2)
   - Implement matchmaking factors (skill gap, rivalry, streaks)
   - Build matchmaking algorithm (weighted scoring)
   - Test with roster to ensure variety
   - **Deliverable:** `src/simulation/matchmaker.ts`

### 📅 Phase C: Autonomous Operation (Week 3-4)

**Goal:** Make the agent run itself

8. **Scheduler System** (Priority 1)
   - Build match scheduler (6-8 matches/day)
   - Implement match lifecycle (announce → wait → sim → commentary → result)
   - Add timing logic (T-60 announcement, T-0 sim, T+5 result)
   - **Deliverable:** `src/agent/scheduler.ts`

9. **Agent Main Loop** (Priority 1)
   - Create daemon process that runs continuously
   - Integrate scheduler, matchmaker, simulation, content generation
   - Add logging and error handling
   - **Deliverable:** `src/index.ts` (new main entry point)

10. **Minimal Social Output** (Priority 2)
    - For MVP: Write content to files/logs instead of posting to X
    - Create "dry run" mode that simulates social posting
    - **Deliverable:** `src/social/mock-client.ts`

### 💰 Phase D: Wagering MVP (Week 4-5)

**Goal:** Add betting simulation (off-chain points system)

11. **Odds Engine** (Priority 2)
    - Statistical model based on ball stats
    - Simple market-making logic
    - **Deliverable:** `src/wagering/odds.ts`

12. **Points-Based Betting** (Priority 2)
    - In-memory bet tracking (no real money)
    - Leaderboard system
    - **Deliverable:** `src/wagering/bets.ts`, `src/wagering/leaderboard.ts`

### 🌐 Phase E: Social Integration (Week 5-6)

**Goal:** Connect to real social platforms

13. **X API Client** (Priority 1)
    - Set up X API credentials
    - Implement posting functions
    - Replace mock client with real one
    - **Deliverable:** `src/social/x-client.ts`

14. **Telegram Bot** (Priority 2)
    - Basic bot with `/nextmatch`, `/rankings` commands
    - **Deliverable:** `src/social/telegram-bot.ts`

### 🚀 Phase F: Polish & Launch (Week 6-8)

15. **Visual Content Generation**
    - Programmatic match card generation (reuse viewer code)
    - Export static images for social posts
    - **Deliverable:** `src/social/media.ts`

16. **Testing & Dry Run**
    - Run agent for 7 days in dry-run mode
    - Monitor for bugs, tune matchmaking/commentary
    - **Deliverable:** Production-ready agent

17. **Go Live**
    - Deploy to VPS
    - Launch $WORBZ token on Virtuals
    - Start autonomous operation

---

## 6. Effort Estimates

| Phase | Components | Estimated Time | Dependencies |
|---|---|---|---|
| **Phase A: Foundation** | Roster, Stats, Arena, DB | 40-60 hours | None (can start now) |
| **Phase B: Agent Brain** | LLM, Commentary, Matchmaking | 30-40 hours | Phase A complete |
| **Phase C: Autonomy** | Scheduler, Main Loop | 20-30 hours | Phase B complete |
| **Phase D: Wagering** | Odds, Points Betting | 15-20 hours | Phase C (optional) |
| **Phase E: Social** | X, Telegram | 20-30 hours | Phase C complete |
| **Phase F: Launch** | Polish, Test, Deploy | 20-30 hours | All prior phases |
| **TOTAL** | **Full MVP** | **145-210 hours** | ~4-6 weeks full-time |

---

## 7. Quick Wins (Low-Hanging Fruit)

These can be done **immediately** to add value without major refactoring:

1. **Add Ball Names & Personalities** (2 hours)
   - Extend `BallSpec` with `name` and `personality` fields
   - Create a roster JSON with creative names
   - Display names in viewer

2. **Implement Excitement Scoring** (3 hours)
   - Add `excitement_score` calculation to events
   - Use heuristics: big damage = high score, close HP = high score, special activations = high score

3. **Generate Match Summary Text** (4 hours)
   - Write function that converts `MatchResult` → readable summary
   - Template: "In a fierce battle, **Crimson Crusher** defeated **Neon Ricochet** in 847 ticks. The match saw 23 hits, with Crusher landing the killing blow at 12% HP remaining."

4. **Export Match Cards** (6 hours)
   - Use viewer's canvas to generate PNG match cards
   - Add node-canvas or similar for headless rendering
   - Output cards to `output/match-cards/`

5. **Add Weapon Descriptions** (1 hour)
   - Add `description` field to weapon definitions
   - Example: `"Katana: A swift, elegant blade favored by duelists. Medium reach, high precision."`

---

## 8. Dependencies & Blockers

### External Dependencies Needed

1. **Anthropic Claude API Key** (for commentary generation)
2. **X (Twitter) API Access** (Basic tier, $100/month minimum)
3. **Telegram Bot Token** (free)
4. **VPS or Cloud Hosting** (24/7 operation)
5. **Virtuals Protocol SDK** (for GAME framework integration)

### Technical Blockers

- **No blocker for starting Phase A-C** — Can build agent infrastructure without token/blockchain
- **Phase E requires X API approval** — Can take 1-2 weeks
- **Phase 5 (On-Chain) blocked until Virtuals integration details clarified**

---

## 9. Architecture Recommendations

### Proposed New Structure

```
worbz-arena-master/
├── src/
│   ├── simulation/          # ✅ EXISTING (mostly complete)
│   │   ├── engine.ts        # Core physics (simCore.ts renamed)
│   │   ├── ball.ts          # 🆕 Ball entity management
│   │   ├── weapon.ts        # 🆕 Weapon catalog
│   │   ├── arena.ts         # 🆕 Arena manager with hazards
│   │   ├── matchmaker.ts    # 🆕 Matchmaking AI
│   │   └── rng.ts           # ✅ Seeded RNG (exists)
│   ├── agent/               # 🆕 NEW SUBSYSTEM
│   │   ├── character.ts     # Arena Master personality
│   │   ├── scheduler.ts     # Autonomous scheduling
│   │   ├── commentary.ts    # LLM content generation
│   │   ├── memory.ts        # Persistent state
│   │   └── decisions.ts     # High-level planning
│   ├── wagering/            # 🆕 NEW SUBSYSTEM
│   │   ├── odds.ts
│   │   ├── bets.ts
│   │   ├── economy.ts
│   │   └── leaderboard.ts
│   ├── social/              # 🆕 NEW SUBSYSTEM
│   │   ├── x-client.ts
│   │   ├── telegram-bot.ts
│   │   ├── content.ts
│   │   └── media.ts         # Match card generation
│   ├── data/                # 🆕 NEW SUBSYSTEM
│   │   ├── database.ts      # SQLite wrapper
│   │   ├── roster.ts        # Ball roster CRUD
│   │   ├── history.ts       # Match history queries
│   │   └── migrations/
│   └── index.ts             # 🆕 Main agent loop (replaces sim.ts)
├── config/                  # 🆕 NEW
│   ├── default-roster.json
│   ├── arenas.json
│   ├── weapons.json
│   └── schedule.json
├── viewer/                  # ✅ EXISTING (keep as dev tool)
│   └── ...
├── tests/                   # 🆕 NEW (needed)
└── output/                  # 🆕 NEW (match cards, logs)
```

### Data Flow for MVP

```
┌─────────────────────────────────────────┐
│   Agent Main Loop (index.ts)            │
│   - Runs 24/7                           │
│   - Executes schedule                   │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   Scheduler                              │
│   - Picks next match time               │
│   - Triggers match lifecycle            │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   Matchmaker                             │
│   - Loads roster from DB                │
│   - Selects 2 interesting fighters      │
│   - Picks arena                         │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   Content Generator (T-60min)           │
│   - Generates match announcement        │
│   - Sends to Social Client (X/Telegram) │
└─────────────────────────────────────────┘
              │
              ▼ (wait until T-0)
┌─────────────────────────────────────────┐
│   Simulation Engine (T-0)               │
│   - Runs deterministic simulation       │
│   - Outputs MatchResult + events        │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   Content Generator (T+1min)            │
│   - Generates commentary thread         │
│   - Posts to social                     │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│   Database                               │
│   - Save match result                   │
│   - Update ball win/loss records        │
│   - Update rankings                     │
└─────────────────────────────────────────┘
```

---

## 10. Risk Assessment

### High Risk

1. **LLM Cost & Quality**
   - **Risk:** Commentary quality may vary, costs may exceed budget
   - **Mitigation:** Start with GPT-3.5/GPT-4-mini for testing, use Claude 3 Haiku for production (cheap), cache system prompts

2. **X API Changes**
   - **Risk:** Twitter API policies change frequently
   - **Mitigation:** Build abstraction layer, have backup posting method (manual queue)

3. **Engagement Uncertainty**
   - **Risk:** Community may not find it engaging
   - **Mitigation:** Extensive dry-run testing, iterate on Arena Master personality

### Medium Risk

4. **Scheduling Complexity**
   - **Risk:** Managing autonomous timing is tricky (timezones, delays)
   - **Mitigation:** Use robust scheduler library (node-cron), add manual override

5. **Database Performance**
   - **Risk:** SQLite may not scale to thousands of matches
   - **Mitigation:** Start with SQLite, migrate to PostgreSQL if needed (design for portability)

### Low Risk

6. **Simulation Bugs**
   - **Risk:** Physics edge cases cause unfair matches
   - **Mitigation:** ✅ Already mitigated — deterministic, well-tested simulation

---

## 11. Success Criteria for MVP

An MVP is ready when:

- ✅ Agent runs autonomously for 7+ days without crashing
- ✅ Generates 6-8 matches per day on schedule
- ✅ Commentary is coherent and entertaining (verified by human review)
- ✅ Ball careers persist (win/loss records accurate)
- ✅ Matchmaking creates variety (no repeated matchups within 24 hours)
- ✅ Social posts are formatted correctly and timely
- ✅ Betting system works (points-based, leaderboard updates)

---

## 12. Conclusion

### Current State: **15-20% Complete**

The existing codebase is a **high-quality simulation engine** suitable as the foundation for WORBZ. The core physics, determinism, and visualization are production-ready.

### Path to MVP: **4-6 weeks of focused development**

The critical path is:
1. **Build data layer** (roster, database, persistence)
2. **Integrate LLM** (Arena Master personality, commentary)
3. **Automate operation** (scheduler, agent main loop)
4. **Connect social** (X, Telegram)

### Strategic Recommendation

**Proceed with phased build**:
- Weeks 1-2: Foundation (Phase A) — establish ball identities, roster, stats
- Weeks 2-3: Agent Brain (Phase B) — LLM integration, commentary
- Weeks 3-4: Autonomy (Phase C) — scheduler, main loop
- Weeks 4-5: Wagering (Phase D) — points betting
- Weeks 5-6: Social (Phase E) — X/Telegram integration
- Weeks 6-8: Launch (Phase F) — polish, dry run, go live

**Do NOT block on**:
- Blockchain integration (can be added post-launch)
- Visual replays (nice-to-have, not MVP)
- Advanced arena hazards (can expand later)

**Focus on**:
- **Quality of Arena Master personality** (this is the differentiator)
- **Commentary entertainment value** (this drives engagement)
- **Autonomous reliability** (24/7 uptime is critical)

The spec is ambitious but achievable. The existing simulation engine saves ~2-3 weeks of work. The main effort is building the **agent orchestration layer** around it.

---

**End of Gap Analysis**
