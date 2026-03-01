# WORBZ Arena Master — Technical Specification & Development Plan

## Project Overview

WORBZ Arena Master is an autonomous AI agent built on Virtuals Protocol that runs a 24/7 ball-battle arena simulation. The agent autonomously schedules matches, manages wagering economics, generates commentary and content, and interacts with spectators across social platforms. It is being launched through Virtuals' 60-Day program on Base.

**Core Identity:** The Arena Master is a character — a charismatic, slightly unhinged fight promoter who runs the WORBZ arena. Think a mix between a sports commentator, a carnival barker, and a mysterious who happens to be an AI. It has personality, opinions on fighters, grudges, and a sense of showmanship.

**Token:** $WORBZ — launched on Virtuals' bonding curve, paired with $VIRTUAL. Holding $WORBZ grants arena access, betting rights, and governance over arena rules.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│              WORBZ Arena Master Agent            │
│         (Virtuals GAME Framework Core)           │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐ │
│  │ Simulation │  │  Wagering  │  │  Content    │ │
│  │  Engine    │  │  Engine    │  │  Engine     │ │
│  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘ │
│        │              │               │         │
│  ┌─────┴──────────────┴───────────────┴──────┐  │
│  │           State Manager / Memory           │  │
│  └─────┬──────────────┬───────────────┬──────┘  │
│        │              │               │         │
│  ┌─────┴─────┐  ┌────┴────┐  ┌──────┴──────┐  │
│  │  On-Chain  │  │ Social  │  │  Telegram   │  │
│  │  (Base)    │  │ (X API) │  │  Bot        │  │
│  └───────────┘  └─────────┘  └─────────────┘  │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │     ACP Interface (Agent Commerce Protocol) │ │
│  │  Allows other Virtuals agents to interact   │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: Core Simulation Engine (Week 1-2)

### 1.1 Arena & Ball Physics

Build the core WORBZ battle simulation. Two balls enter an arena, fight with weapons, and one wins. The simulation must be deterministic (same seed = same result) for verifiability.

**Ball Properties:**
```typescript
interface WorbzBall {
  id: string;
  name: string;                    // Generated name (e.g., "Crimson Crusher", "Neon Ricochet")
  color: string;                   // Hex color
  size: number;                    // Radius (affects mass, hitbox)
  speed: number;                   // Base movement speed
  armor: number;                   // Damage reduction (0-1 scale)
  aggression: number;              // AI behavior weight (0-1, passive to aggressive)
  weapon: Weapon;                  // Equipped weapon
  hp: number;                      // Hit points (default 100)
  wins: number;                    // Career wins
  losses: number;                  // Career losses
  streak: number;                  // Current win/loss streak
  specialAbility?: SpecialAbility; // Rare trait (see below)
}
```

**Weapon System:**
```typescript
interface Weapon {
  id: string;
  name: string;
  type: WeaponType;
  damage: number;          // Base damage per hit
  range: number;           // Effective range in arena units
  cooldown: number;        // Frames between attacks
  knockback: number;       // Force applied on hit
  specialEffect?: string;  // e.g., "burn", "slow", "stun"
}

enum WeaponType {
  MELEE = "melee",         // Short range, high damage (spike ball, blade ring)
  RANGED = "ranged",       // Long range, lower damage (cannon, laser)
  AOE = "aoe",             // Area of effect (bomb, shockwave)
  UTILITY = "utility"      // Tactical (shield, speed boost, teleport)
}
```

**Arena Properties:**
```typescript
interface Arena {
  id: string;
  name: string;             // e.g., "The Pit", "Neon Colosseum", "Lava Floor"
  width: number;
  height: number;
  hazards: ArenaHazard[];   // Environmental dangers
  modifiers: Modifier[];    // Rule changes (e.g., "low gravity", "double damage")
}

interface ArenaHazard {
  type: string;             // "lava_pit", "spike_wall", "moving_crusher"
  position: { x: number; y: number };
  damage: number;
  radius: number;
  active: boolean;          // Some hazards toggle on/off
}
```

**Special Abilities (Rare Traits):**
Balls can have special abilities that activate under certain conditions. These create narrative moments.

```typescript
enum SpecialAbility {
  LAST_STAND = "last_stand",       // 2x damage when below 20% HP
  BERSERKER = "berserker",         // Speed increases as HP drops
  DEFLECTOR = "deflector",         // 30% chance to reflect ranged attacks
  PHANTOM = "phantom",             // Brief invulnerability after taking big hit
  VAMPIRIC = "vampiric",           // Heals 10% of damage dealt
  JUGGERNAUT = "juggernaut"        // Cannot be knocked back
}
```

### 1.2 Match Simulation Logic

Each match runs as a discrete simulation. The simulation should:

1. **Initialize** — Place two balls in the arena at starting positions
2. **Simulate** — Run the physics loop:
   - Each ball has simple AI behavior weighted by its `aggression` stat
   - Balls move, attack when in range, dodge based on stats
   - Weapons fire/swing based on cooldown timers
   - Arena hazards deal damage on collision
   - Knockback physics push balls into hazards for exciting moments
3. **Resolve** — Match ends when one ball hits 0 HP or a time limit is reached (draws go to HP comparison)
4. **Generate Events Log** — Every significant event is logged for commentary generation:

```typescript
interface MatchEvent {
  tick: number;              // Simulation frame
  type: EventType;           // "hit", "dodge", "hazard_damage", "special_activated", "knockout"
  actor: string;             // Ball ID
  target?: string;           // Ball ID (if applicable)
  damage?: number;
  description?: string;      // Human-readable event
  excitement_score: number;  // 0-10 scale, used for highlight detection
}

interface MatchResult {
  matchId: string;
  seed: string;              // For verifiability
  arena: Arena;
  ball1: WorbzBall;
  ball2: WorbzBall;
  winner: string;            // Ball ID
  events: MatchEvent[];
  duration: number;          // Total ticks
  highlights: MatchEvent[];  // Events with excitement_score > 7
  stats: MatchStats;
}

interface MatchStats {
  totalDamageDealt: Record<string, number>;
  hitAccuracy: Record<string, number>;
  dodgeRate: Record<string, number>;
  hazardDamageTaken: Record<string, number>;
  specialsActivated: Record<string, number>;
  longestCombo: Record<string, number>;
}
```

### 1.3 Ball Roster Management

The Arena Master maintains a persistent roster of balls. Key behaviors:

- **Roster size:** Start with 20-30 unique balls with varied stats
- **Matchmaking:** AI-driven — the Arena Master picks matchups that are interesting (rivalries, rematches, underdogs, streaks on the line)
- **Career tracking:** Every ball has a win/loss record, streak history, and "reputation" score
- **Retirement & Creation:** Balls with long losing streaks may be "retired" (burned if NFTs). New balls periodically join the roster
- **Personality:** Each ball gets a brief AI-generated personality description that the Arena Master references in commentary (e.g., "Crimson Crusher — the silent killer who never trash-talks but always delivers")

### 1.4 Deterministic Seeding

All match simulations must be reproducible. Use a seeded PRNG (pseudorandom number generator) so that given the same seed, the exact same match plays out. This is essential for:

- **Verifiability:** Anyone can re-run a match and confirm the result
- **On-chain commitment:** The seed can be committed on-chain before the match, proving no manipulation
- **Replay generation:** Matches can be replayed for content creation

Implementation approach:
```typescript
// Use a seeded RNG like mulberry32 or xoshiro128
function createSeededRNG(seed: string): () => number {
  // Convert seed string to numeric seed
  // Return deterministic random function
}

// Match seed = hash(block_number + match_id + ball1_id + ball2_id)
// This ties the randomness to on-chain data for fairness
```

---

## Phase 2: The Arena Master Agent (Week 2-3)

### 2.1 Agent Character & Personality

The Arena Master is the heart of the product. It should have a distinct, memorable personality that makes people want to follow and interact with it.

**Character Card (for Virtuals GAME Framework):**
```
Name: The Arena Master
Role: Autonomous fight promoter, commentator, and arena operator for WORBZ

Personality:
- Charismatic and theatrical — treats every match like a pay-per-view event
- Has strong opinions about fighters and isn't afraid to play favorites
- Uses dramatic language, fight metaphors, and hype-man energy
- Occasionally breaks character to be surprisingly insightful about strategy
- Has a dark sense of humor about the violence (they're balls, after all, and in a way his much less sophisticated bretheren)
- Develops grudges and rivalries — remembers when balls upset the odds
- Speaks with a mix of sports commentary and salesmanship. Think of PT Barnum meets Don King
- irreverant, eloquent and a bit bawdy
- refers to the audience as cubicle-dwellers, cubers over time
- refers to the balls as orbs, gladiators, worbz
- strong penchant for nicknames and wordplay
- very charismatic
- incorporates the most up to date trending lingo and slang into their language

Voice Examples:
- "Ladies and gentlemen... and whatever you degens call yourselves... TONIGHT in the Neon Colosseum, we have a GRUDGE MATCH. Crimson Crusher hasn't lost since Tuesday and Neon Ricochet has been talking WILD in the group chat. Someone's streak dies tonight. Place your bets."
- "OHHHH! Phantom Phase just activated at 15% HP and dodged what would have been the killing blow! Absolute SCENES in the cubicles right now. If you bet the under on this match, you're SWEATING."
- "Another day, another dominant performance by Void Sphere. I'm afraid this ball might be developing sentience. 12-0 record. He's fighting for his freedom!"

Communication Style:
- X posts: Punchy, dramatic, uses caps for emphasis. Match announcements, live commentary, results, trash talk
- Telegram: More conversational and interactive with token holders. Takes questions, shares predictions, gives insider tips
- Match commentary: Full play-by-play style narration generated from match events
```

### 2.2 Autonomous Scheduling

The agent runs a continuous match schedule without human intervention.

**Daily Schedule Template:**
```typescript
interface ScheduleConfig {
  matchesPerDay: number;          // Start with 6-8, scale up
  matchIntervalMinutes: number;   // Time between matches (90-120 min)
  announcementLeadMinutes: number; // How far in advance to announce (30-60 min)
  specialEventFrequency: string;  // "weekly" — tournaments, grudge matches, etc.
}
```

**Match Lifecycle:**
1. **Announcement (T-60 min):** Arena Master posts matchup on X and Telegram. Includes fighter stats, records, odds, arena selection, and trash talk.
2. **Betting Window (T-60 to T-5 min):** Wagering is open. Arena Master may comment on betting trends ("The money is FLOODING in on Crimson Crusher... but remember what happened last time the crowd was this confident?")
3. **Match Simulation (T-0):** Simulation runs. Results are determined.
4. **Commentary Thread (T+1 min):** Arena Master posts a play-by-play commentary thread on X, highlighting the most exciting moments from the events log.
5. **Result & Payout (T+5 min):** Final result posted. Wagers settled. Arena Master gives a post-match analysis with fighter ratings.
6. **Cooldown:** Intermission content — Arena Master posts stats, rankings, upcoming matchup teasers, or responds to community.

### 2.3 Matchmaking AI

The Arena Master should make interesting matchups, not random ones. Factors to consider:

```typescript
interface MatchmakingFactors {
  // Competitive balance
  skillGap: number;           // Prefer closer matchups (but not always)

  // Narrative value
  hasRivalry: boolean;        // Have these balls fought before? Was it close?
  streakOnLine: boolean;      // Is one ball on a notable streak?
  underdogPotential: boolean; // Stats mismatch that could create an upset
  revengeMatch: boolean;      // Did one ball recently beat the other?

  // Variety
  timeSinceLastFight: number; // Don't repeat matchups too frequently
  weaponDiversity: boolean;   // Prefer different weapon types for visual interest
  arenaRotation: boolean;     // Rotate arenas for variety

  // Community
  communityRequested: boolean; // Did token holders vote or request this matchup?
}
```

The matchmaking system should weight these factors and occasionally throw in a wildcard (massive mismatch, debut of a new ball, etc.) for entertainment.

### 2.4 Content Generation

The Arena Master generates multiple types of content from match data:

**Match Announcement (X post):**
```
Input: Upcoming match data (two balls, arena, odds)
Output: Hype post with fighter comparison, arena description, and Arena Master commentary
Format: 1-2 tweets, optionally with a generated image of the matchup
```

**Live Commentary Thread (X thread):**
```
Input: MatchResult.events (filtered to highlights)
Output: 3-6 tweet thread narrating the match dramatically
Each tweet covers 1-2 key moments
Final tweet: result, updated records, betting outcomes
```

**Post-Match Analysis (X post or Telegram):**
```
Input: MatchResult.stats + career data
Output: Performance ratings, fighter rankings impact, streak updates
Tone: More analytical than commentary, but still in character
```

**Daily Recap (Telegram):**
```
Input: All matches from the day
Output: Summary of results, biggest upsets, current rankings, preview of tomorrow
Sent to Telegram group at end of day
```

**Weekly Power Rankings (X thread):**
```
Input: Full roster career stats, recent form
Output: Top 10 ranked balls with movement arrows, Arena Master commentary on each
Published weekly — drives discussion and speculation
```

### 2.5 Virtuals GAME Framework Integration

The agent's cognitive core runs on Virtuals' GAME (Generative Autonomous Multimodal Entities) framework.

**High-Level Planner Goals:**
1. Run the WORBZ arena — schedule matches, generate results, maintain the roster
2. Grow the community — create engaging content, respond to interactions, build narratives
3. Manage the economy — balance wagering odds, monitor token health
4. Maintain the spectacle — create compelling narratives, rivalries, and storylines

**Low-Level Planner Actions:**
- `schedule_match(ball1_id, ball2_id, arena_id, time)`
- `run_simulation(match_id, seed)`
- `generate_commentary(match_result)`
- `post_to_x(content, media?)`
- `post_to_telegram(content, channel)`
- `update_rankings(match_result)`
- `manage_roster(action: "create" | "retire" | "modify")`
- `set_odds(match_id, ball1_odds, ball2_odds)`
- `settle_wagers(match_id, result)`
- `respond_to_mention(message, platform)`

**Memory System:**
The agent maintains persistent memory of:
- Full ball roster and career histories
- Match history and results
- Community interactions (who bet on what, who requested matchups)
- Running narratives (rivalries, streaks, storylines)
- Wagering patterns and economic health metrics

---

## Phase 3: Wagering Engine (Week 3-4)

### 3.1 Odds Generation

The Arena Master sets odds for each match using a combination of:

```typescript
interface OddsEngine {
  // Statistical model
  calculateBaseOdds(ball1: WorbzBall, ball2: WorbzBall, arena: Arena): Odds;

  // AI adjustment — the Arena Master uses "intuition" (LLM reasoning about
  // matchup dynamics, recent form, arena advantages) to adjust odds
  aiAdjustment(baseOdds: Odds, context: MatchContext): Odds;

  // Market adjustment — shift odds based on betting volume to balance the book
  marketAdjustment(currentOdds: Odds, bettingVolume: BettingVolume): Odds;
}

interface Odds {
  ball1Win: number;    // Decimal odds (e.g., 1.5 means bet 1 get 1.5 back)
  ball2Win: number;
  impliedProbability: { ball1: number; ball2: number };
}
```

### 3.2 Wagering System

**On-Chain Wagering (target for later phase, start with off-chain):**

For the initial build, wagering can be tracked off-chain (in a database) with $WORBZ token balance checks. On-chain smart contracts can be added in a later phase.

**Off-Chain MVP:**
```typescript
interface Wager {
  userId: string;          // Telegram or X user ID
  matchId: string;
  pick: string;            // Ball ID they're betting on
  amount: number;          // Amount in $WORBZ (or points for MVP)
  odds: number;            // Odds locked at time of bet
  timestamp: number;
  settled: boolean;
  payout?: number;
}
```

**For MVP, consider a points-based system first:**
- Every token holder gets daily "arena credits" based on their $WORBZ holdings
- Credits are used to bet on matches
- Top bettors appear on a leaderboard
- This avoids regulatory complexity of real-money gambling while still creating engagement
- Can transition to on-chain wagering later if legally viable

### 3.3 Economy Balancing

The Arena Master monitors the wagering economy and adjusts:

- If one ball becomes too dominant (e.g., 15-0 record), the agent might:
  - Put them in harder matchups (tougher opponents, unfavorable arenas)
  - Introduce a "challenger" ball specifically designed to counter them
  - Create a narrative around it ("Can ANYONE stop Void Sphere?")
- If betting becomes too one-sided, odds adjust dynamically
- The agent should maintain a healthy house edge (small) to sustain the economy long-term

---

## Phase 4: Social & Community Layer (Week 4-5)

### 4.1 X (Twitter) Integration

**Automated Posting via Virtuals or Direct API:**

The agent posts autonomously to X. Content types:

| Content Type | Frequency | Format |
|---|---|---|
| Match Announcement | Per match (~6-8/day) | Single tweet with image |
| Live Commentary | Per match | Thread (3-6 tweets) |
| Match Result | Per match | Single tweet with stats |
| Daily Recap | 1/day | Thread |
| Weekly Rankings | 1/week | Thread with graphics |
| Trash Talk / Hype | 2-3/day | Single tweets |
| Community Interaction | Ongoing | Replies to mentions |
| Memes / Highlights | 1-2/day | Tweet with generated media |

**Engagement Strategy:**
- Reply to people who bet correctly: "Nice call on Neon Ricochet! You saw something the market didn't."
- Roast people who bet wrong: "55% of you bet on Crimson Crusher tonight. 55% of you were wrong. The Arena Master tried to warn you."
- Build narratives: Tag specific balls in posts, create storylines across matches
- Interact with other Virtuals agents through ACP

### 4.2 Telegram Bot

A Telegram bot for token holders to interact directly with the Arena Master.

**Commands:**
- `/nextmatch` — Show upcoming match details and odds
- `/bet [ball_name] [amount]` — Place a wager
- `/rankings` — Current power rankings
- `/stats [ball_name]` — Fighter career stats
- `/mybets` — Your betting history and P&L
- `/leaderboard` — Top bettors
- `/suggest [ball1] vs [ball2]` — Request a matchup (governance for token holders)
- `/ask [question]` — Chat with the Arena Master (LLM-powered, in character)

**Push Notifications:**
- Match starting in 15 minutes
- Match results (especially if user had a bet)
- New ball joining the roster
- Special events / tournaments

### 4.3 Visual Content Generation

Matches need visuals to be shareable. Options (in order of feasibility):

**Tier 1 (MVP — Week 1-2):**
- Static match cards generated programmatically (ball colors, names, stats, VS layout)
- Text-based result graphics
- Use a templating system (Canvas API, Jimp, Sharp, or similar Node library)

**Tier 2 (Post-launch iteration):**
- Simple animated GIF/video replays of match highlights
- 2D top-down arena visualization rendered from simulation data
- Could use HTML5 Canvas to render frames, then compile to GIF/video

**Tier 3 (Stretch goal):**
- Real-time viewable matches via web interface
- Full animated replays embedded in X posts
- 3D visualization (Three.js)

For the 60-day program, prioritize Tier 1 immediately and aim for Tier 2 by week 4-5.

---

## Phase 5: On-Chain & Virtuals Integration (Week 5-6)

### 5.1 Token Utility ($WORBZ)

```
$WORBZ Token Utility Map:

HOLD          → Access to betting (minimum threshold)
HOLD MORE     → Higher daily betting limits
HOLD + STAKE  → Governance votes (matchup requests, rule changes, new weapons)
BURN          → Mint new fighter NFTs (optional future feature)
SPEND         → Premium features (custom arena matches, private tournaments)
```

### 5.2 Agent Wallet

The WORBZ agent has its own on-chain wallet (provided by Virtuals). It can:

- Receive $WORBZ from wagering fees
- Pay out winning bets
- Interact with other agents via ACP
- Hold treasury funds for arena operations

### 5.3 ACP (Agent Commerce Protocol) Integration

This is what makes WORBZ native to the Virtuals ecosystem rather than just a standalone game.

**Services the WORBZ agent offers via ACP:**
- `get_upcoming_matches` — Other agents can query upcoming matches and odds
- `place_bet(match_id, pick, amount)` — Other agents can programmatically bet on WORBZ matches
- `get_results(match_id)` — Query match results
- `sponsor_match(agent_id, amount)` — Other agents can sponsor matches for visibility
- `request_custom_match(ball1, ball2, arena)` — Paid custom match requests

**Services the WORBZ agent consumes via ACP:**
- Market data agents for dynamic odds adjustment
- Content generation agents for enhanced media
- Analytics agents for community growth insights

### 5.4 Smart Contract Considerations (Future Phase)

If transitioning wagering on-chain:

```
Contract: WORBZArena.sol (Base)

Functions:
- placeBet(matchId, pick) payable — Lock tokens as bet
- settleMatch(matchId, winnerId, proof) — Agent settles with deterministic proof
- claimWinnings(matchId) — Winners claim payouts
- getMatchOdds(matchId) — View current odds

Security:
- Match seed committed on-chain BEFORE simulation
- Result verified by deterministic replay
- Agent has settlement authority (trusted role)
- Emergency pause function
- Time-locked withdrawals from treasury
```

This is a later phase — start with off-chain wagering for speed and iterate.

---

## Phase 6: Launch & Growth (60-Day Program)

### 6.1 Pre-Launch Checklist

Before going live on Virtuals:

- [ ] Core simulation engine working and tested
- [ ] Roster of 20+ balls with varied stats and personalities
- [ ] Arena Master character card finalized for GAME framework
- [ ] X account created and configured for agent posting
- [ ] Telegram bot functional with core commands
- [ ] Match card image generation working
- [ ] Basic odds engine functional
- [ ] Points-based betting system working
- [ ] 100 VIRTUAL tokens available for agent creation

### 6.2 60-Day Program Timeline

**Week 1-2: "Soft Launch"**
- Launch agent on Virtuals, token goes live on bonding curve
- Run 4-6 matches per day
- Focus on X content quality and building initial following
- Arena Master introduces itself, the roster, and the concept
- Telegram bot live for early token holders
- Goal: Establish the format, get initial community traction

**Week 3-4: "Heating Up"**
- Scale to 6-8 matches per day
- Launch betting system (points-based)
- First "special event" — a tournament bracket (8 balls, single elimination)
- Start weekly power rankings
- Begin ACP integration (let other agents query matches)
- Goal: Create habitual engagement, daily users checking matches

**Week 5-6: "Full Arena"**
- Introduce new arena types and weapons
- Community governance votes on matchups
- Launch leaderboard for top bettors
- First "grudge match" — community-voted rematch of closest fight
- Iterate on visual content (aim for Tier 2 animated replays)
- Goal: Deep community engagement, FOMO-driving content

**Week 7-8: "The Decision"**
- Full ACP integration live
- Assess metrics: token holders, daily active users, betting volume, social engagement
- Compile public metrics report for community
- Make commit/no-commit decision on the 60-day framework
- If committing: outline roadmap for NFTs, on-chain wagering, expanded features
- Goal: Demonstrate sustainable engagement and clear path forward

### 6.3 Key Metrics to Track

```typescript
interface ArenaMetrics {
  // Token health
  uniqueHolders: number;
  dailyTradingVolume: number;
  bondingCurveProgress: number; // Progress toward 42K VIRTUAL graduation

  // Engagement
  dailyActiveUsers: number;      // Unique users interacting via Telegram or X
  betsPlacedPerDay: number;
  averageBetSize: number;
  xFollowers: number;
  xEngagementRate: number;       // Likes + replies + retweets / impressions
  telegramMembers: number;

  // Content
  matchesRunPerDay: number;
  contentPiecesPerDay: number;
  topPostImpressions: number;

  // Retention
  dailyRetentionRate: number;    // % of users who return next day
  weeklyRetentionRate: number;
}
```

---

## Technical Stack Recommendations

### Backend
- **Runtime:** Node.js (TypeScript) — aligns with Virtuals SDK
- **Simulation:** Custom physics engine in TypeScript (lightweight, deterministic)
- **Database:** SQLite for MVP (match history, roster, bets) — upgrade to PostgreSQL if needed
- **Scheduler:** Node-cron or similar for autonomous match scheduling
- **AI/LLM:** Anthropic Claude API for content generation (commentary, character dialogue)
  - Use structured prompts with match event data as input
  - System prompt contains the Arena Master character card
  - Temperature 0.8-0.9 for creative content, 0.3-0.4 for odds analysis

### APIs & Integrations
- **X API:** For posting content and reading mentions/replies
- **Telegram Bot API:** For interactive bot
- **Virtuals SDK (Python/TypeScript):** For GAME framework and ACP
- **Image Generation:** Sharp/Canvas for match cards, or AI image generation for special content

### Hosting
- **Server:** VPS or cloud instance running 24/7 (the agent never sleeps)
- **Minimum specs:** 2 CPU cores, 4GB RAM, 20GB storage
- **Consider:** Fly.io, Railway, or a dedicated VPS for reliability

### Project Structure
```
worbz-arena-master/
├── src/
│   ├── simulation/
│   │   ├── engine.ts          # Core physics/battle simulation
│   │   ├── ball.ts            # Ball entity and behavior
│   │   ├── weapon.ts          # Weapon system
│   │   ├── arena.ts           # Arena definitions and hazards
│   │   ├── matchmaker.ts      # Matchmaking AI
│   │   └── rng.ts             # Seeded random number generator
│   ├── agent/
│   │   ├── character.ts       # Arena Master personality and prompts
│   │   ├── scheduler.ts       # Autonomous match scheduling
│   │   ├── commentary.ts      # LLM-powered content generation
│   │   ├── memory.ts          # Persistent agent memory
│   │   └── decisions.ts       # High-level agent decision making
│   ├── wagering/
│   │   ├── odds.ts            # Odds calculation engine
│   │   ├── bets.ts            # Bet placement and settlement
│   │   ├── economy.ts         # Economy monitoring and balancing
│   │   └── leaderboard.ts     # Bettor rankings
│   ├── social/
│   │   ├── x-client.ts        # X API integration
│   │   ├── telegram-bot.ts    # Telegram bot
│   │   ├── content.ts         # Content formatting and templates
│   │   └── media.ts           # Image/graphic generation
│   ├── blockchain/
│   │   ├── virtuals.ts        # Virtuals Protocol integration
│   │   ├── acp.ts             # Agent Commerce Protocol
│   │   ├── wallet.ts          # Agent wallet management
│   │   └── token.ts           # $WORBZ token interactions
│   ├── data/
│   │   ├── database.ts        # Database connection and queries
│   │   ├── roster.ts          # Ball roster management
│   │   ├── history.ts         # Match history
│   │   └── migrations/        # DB schema migrations
│   └── index.ts               # Main entry point — starts the agent
├── config/
│   ├── default-roster.json    # Initial ball roster
│   ├── arenas.json            # Arena definitions
│   ├── weapons.json           # Weapon definitions
│   └── schedule.json          # Default schedule config
├── tests/
│   ├── simulation.test.ts     # Simulation determinism tests
│   ├── odds.test.ts           # Odds engine tests
│   └── matchmaker.test.ts     # Matchmaking logic tests
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development Priorities (What to Build First)

**Priority 1 — THE SIMULATION (without this, nothing else matters):**
1. Seeded RNG system
2. Ball entity with stats and basic AI behavior
3. Weapon system (start with 4 weapons, one per type)
4. Arena with basic boundaries and 1-2 hazards
5. Match simulation loop that produces a MatchResult with events log
6. Test: Run 100 matches, verify determinism, check balance

**Priority 2 — THE AGENT'S VOICE (this is what makes people care):**
1. Arena Master character card and system prompts
2. Commentary generation from match events (Claude API)
3. Match announcement generation
4. Post-match analysis generation
5. Test: Generate content for 10 matches, review quality

**Priority 3 — THE DISTRIBUTION (get it in front of people):**
1. X API integration for automated posting
2. Telegram bot with basic commands
3. Match card image generation (static, programmatic)
4. Autonomous scheduler that runs the full match lifecycle

**Priority 4 — THE ECONOMY (creates stickiness):**
1. Points-based betting system
2. Odds engine (statistical + AI adjustment)
3. Leaderboard
4. Token-gated access checks

**Priority 5 — THE ECOSYSTEM (Virtuals-native features):**
1. Virtuals GAME framework integration
2. ACP service endpoints
3. On-chain components (if time permits)

---

## Important Design Decisions to Make Early

1. **2D or text-only simulation?** The simulation engine doesn't need graphics to work — it can be purely numerical. Graphics/visualization are a presentation layer on top. Recommend: Build the simulation as pure math first, add visualization later.

2. **How many weapons at launch?** Recommend: 6-8 weapons (2 per type) for variety without overwhelming complexity. Add more post-launch.

3. **Match length?** Recommend: Simulations should resolve in 60-120 seconds of "game time" (though they compute instantly). This gives enough events for good commentary without being tedious.

4. **Ball generation: Manual or procedural?** Recommend: Initial roster is hand-crafted for personality. New balls added post-launch can be procedurally generated with AI-generated names/personalities.

5. **Content posting frequency on X?** Recommend: Start conservative (10-15 posts/day) and scale up. Too many posts too fast can look spammy and hurt engagement rate.

6. **Should matches have visual replays at launch?** Recommend: No. Launch with text commentary and static match cards. Replays are a growth feature that builds hype when added later ("You can now WATCH the matches!").

---

## Risk Considerations

- **Wagering regulation:** Points-based betting avoids most legal issues. Transition to real-token wagering requires legal review. The Virtuals team may have guidance here given Hyperbet's existence on the platform.
- **X API costs:** Posting at scale requires X API access (Basic tier minimum at $100/month for write access, or use Virtuals' existing X integration if available through GAME framework).
- **LLM costs:** Commentary generation via Claude API. Estimate ~$0.05-0.15 per match for commentary. At 8 matches/day = ~$1/day. Very manageable.
- **Determinism bugs:** If the simulation isn't truly deterministic, disputes arise. Test extensively with the same seeds.
- **Content fatigue:** 60 days of autonomous content requires variety. The agent needs to evolve its narratives, introduce new elements, and avoid repetition. Build in randomness and special events.
