# WORBZ Arena - Usage Guide

Complete guide to using the WORBZ Arena simulation system with persistent ball careers, match statistics, and matchmaking.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize Roster
```bash
npm run init-roster
```

This creates a database with 25 unique fighters, each with distinct personalities, weapons, and stats.

### 3. Run Your First Match
```bash
npm run match 'Crimson Crusher' 'Azure Assassin'
```

### 4. View Rankings
```bash
npm run roster rankings
```

---

## Available Commands

### Match Commands

#### `npm run match <ball1> <ball2> [seed]`

Run a match between two balls from the roster.

**Arguments:**
- `ball1` - Name of first fighter (partial match supported)
- `ball2` - Name of second fighter (partial match supported)
- `seed` - Optional: specific seed for deterministic results

**Examples:**
```bash
# Run a match (random seed)
npm run match 'Crimson Crusher' 'Iron Bulwark'

# Partial name matching works
npm run match 'Crimson' 'Iron'

# Use specific seed for reproducible results
npm run match 'Crimson' 'Iron' 12345
```

**Output:**
- Match setup with fighter stats and personalities
- Live simulation
- Match result with winner
- Detailed statistics (accuracy, combos, damage)
- Highlight moments (big hits, eliminations)
- Updated career records

---

#### `npm run suggest [mode] [count]`

Use AI matchmaking to find interesting matchups.

**Modes:**
- `best` - Find single best matchup (default)
- `top <n>` - Find top N matchups (max 10)
- `random` - Random matchup

**Matchmaking Factors:**
- **Skill Balance** - Even matches vs. upsets
- **Streak Interest** - Fighters on win/loss streaks
- **Weapon Diversity** - Different weapon types
- **Underdog Potential** - David vs. Goliath scenarios
- **Freshness** - New fighters, unproven records

**Examples:**
```bash
# Find best matchup
npm run suggest

# Find top 5 matchups
npm run suggest top 5

# Random matchup
npm run suggest random
```

**Output:**
- Suggested matchup with reasoning
- Quality score breakdown
- Command to run the match

---

#### `npm run test-match`

Run a random match for testing/demo purposes.

**What it does:**
- Picks 2 random balls from active roster
- Runs complete match workflow
- Displays summary and updates database
- Shows current rankings

---

### Roster Commands

#### `npm run roster list`

List all fighters in the roster.

**Output:**
```
Void Sphere        1-0  Streak: +1   short_sword
Violet Vortex      1-0  Streak: +1   katana
Crimson Crusher    0-1  Streak: -1   mace
...
```

**Aliases:**
- `npm run roster ls`

---

#### `npm run roster rankings [limit]`

Show top-ranked fighters.

**Arguments:**
- `limit` - Number of fighters to show (default: 20)

**Examples:**
```bash
# Top 20
npm run roster rankings

# Top 10
npm run roster rankings 10
```

**Output:**
```
Rank  Fighter                  Record    Streak  Weapon          Dmg Dealt
--------------------------------------------------------------------------------
1.    Iron Bulwark            1-0        +1      mace            1014
2.    Violet Vortex           1-0        +1      katana          1012
3.    Void Sphere             1-0        +1      short_sword     957
```

**Aliases:**
- `npm run roster rank`

---

#### `npm run roster info <ball_name>`

Show detailed information for a specific fighter.

**Arguments:**
- `ball_name` - Name of fighter (partial match supported)

**Example:**
```bash
npm run roster info 'Crimson Crusher'
```

**Output:**
- Full name and personality
- Current record and win rate
- Streak information
- Base attributes (HP, radius, weapon, color)
- Career totals (damage dealt/taken)
- Recent match history (last 5 matches)
- Creation date and status

**Aliases:**
- `npm run roster show`

---

#### `npm run roster stats`

Show overall roster statistics.

**Output:**
- Total fighters (active vs. retired)
- Total matches run
- Total damage dealt across all matches
- Average wins per fighter
- Weapon distribution (how many fighters use each weapon)

---

### Original Simulation

#### `npm run sim [matchSpec.json]`

Run the original simulation engine (backward compatible).

**What it does:**
- Loads matchSpec.json configuration
- Runs deterministic simulation
- Outputs match result as JSON

**Note:** This runs the original one-off simulation. It does NOT update the roster database.

---

## Roster System

### Ball Entities

Each fighter in the roster has:

**Identity:**
- Unique ID (UUID)
- Name (e.g., "Crimson Crusher")
- Personality description
- Color (hex code)

**Attributes:**
- Base HP (900-1100 range)
- Radius (38-44 range)
- Weapon type (mace, katana, spear, short_sword)
- Restitution (bounce coefficient)

**Career Stats:**
- Wins / Losses
- Current streak (positive = wins, negative = losses)
- Longest win streak
- Total damage dealt / taken
- Created date
- Retired status

### Current Roster (25 Fighters)

**Mace Wielders (7):**
- Crimson Crusher, Iron Bulwark, Thunder Roller
- Jade Juggernaut, Copper Colossus, Titanium Tornado, Magma Marauder

**Katana Specialists (6):**
- Azure Assassin, Neon Ricochet, Scarlet Tempest
- Obsidian Edge, Violet Vortex, Midnight Reaper

**Spear Users (6):**
- Emerald Executioner, Phantom Phase, Frost Lancet
- Sapphire Spear, Coral Combatant, Ivory Impaler

**Short Sword Fighters (6):**
- Void Sphere, Golden Gladiator, Ruby Ravager
- Silver Striker, Amber Avenger, Platinum Phantom

---

## Match System

### How Matches Work

1. **Load Fighters** - Retrieve BallEntity records from database
2. **Create Match Config** - Build MatchSpec from fighter attributes
3. **Run Simulation** - Deterministic physics engine (unchanged from original)
4. **Calculate Stats** - Accuracy, combos, excitement scoring, damage
5. **Generate Summary** - Human-readable text with highlights
6. **Update Careers** - Save match result, update wins/losses/streaks

### Match Statistics

**Tracked per fighter:**
- Hits Landed / Missed
- Accuracy (% of successful attacks)
- Damage Dealt / Taken
- Wall Bounces
- Longest Combo
- Max Excitement Event (0-10 scale)

**Combo System:**
Consecutive hits without interruption. Combo resets when:
- Opponent lands a hit
- Fighter misses or hits wall

**Excitement Scoring:**
Events scored 0-10 based on:
- Damage dealt (25+ damage = high excitement)
- HP tension (closer to elimination = more exciting)
- Match-ending moments (always max excitement)

### Highlights

Top 5 most exciting moments from each match:
- Big damage hits (25+ damage)
- Eliminations
- Close finishes

---

## Matchmaking Algorithm

### How It Works

Scores all possible matchups (N² comparisons) based on:

**1. Skill Balance (30% weight)**
- Prefers evenly matched opponents
- Based on win rate, streak, and damage efficiency
- Can be configured to favor upsets

**2. Streak Interest (25% weight)**
- Boosts matchups with fighters on 3+ win/loss streaks
- Maximum score if both fighters have streaks

**3. Weapon Diversity (20% weight)**
- Prefers different weapon types
- Creates visual variety and tactical interest

**4. Underdog Potential (15% weight)**
- Boosts mismatches (David vs. Goliath)
- Creates upset opportunities

**5. Freshness (10% weight)**
- Boosts matchups with undefeated fighters
- Prioritizes fresh blood over veterans

### Matchmaking Modes

**Best:** Single highest-scoring matchup
- Use when you want the most interesting fight right now

**Top N:** List of N best matchups
- Use for planning a card of matches
- Creates variety while maintaining quality

**Random:** Completely random pairing
- Use for unpredictability
- Still scores the matchup for reference

---

## Deterministic Simulation

All matches are **deterministic** - same seed produces identical results.

### Why This Matters

**Verifiability:**
- Anyone can re-run a match with the same seed
- Proves no manipulation occurred
- Essential for competitive/wagering scenarios

**Reproducibility:**
- Debug specific scenarios
- Create highlight reels
- Share exciting match seeds with others

### Using Seeds

```bash
# Run with specific seed
npm run match 'Crimson' 'Iron' 42

# Re-run same match (identical result)
npm run match 'Crimson' 'Iron' 42
```

**Note:** Fighter careers DO change after each match. Only the simulation outcome is deterministic.

---

## Database

### Location
`data/arena.db` (SQLite)

**Note:** Database is gitignored. Each user maintains their own local arena.

### Tables

**balls** - Fighter roster (25 records)
- All fighter attributes and career stats
- Indexed on wins for fast rankings

**matches** - Complete match history
- All match results with denormalized stats
- Indexed on ball IDs and timestamp

**events** - Detailed event logs (optional)
- Stores individual match events
- Useful for replay generation

### Querying Directly

```bash
sqlite3 data/arena.db "SELECT name, wins, losses FROM balls ORDER BY wins DESC LIMIT 10;"
```

---

## Tips & Tricks

### Creating Epic Matchups

1. **Find Rivals:**
```bash
npm run roster rankings
# Pick fighters near each other in rank
npm run match 'Fighter1' 'Fighter2'
```

2. **Underdog Stories:**
```bash
npm run roster info 'Winless Fighter'
npm run roster info 'Undefeated Champion'
npm run match 'Winless Fighter' 'Undefeated Champion'
```

3. **Streak Busters:**
```bash
npm run roster list
# Look for fighters with +5 or higher streaks
npm run suggest best
# Matchmaker will prioritize streak matchups
```

### Building Narratives

Track specific fighters over time:
```bash
# Before
npm run roster info 'Crimson Crusher'

# Run several matches
npm run match 'Crimson' 'Fighter1'
npm run match 'Crimson' 'Fighter2'
npm run match 'Crimson' 'Fighter3'

# After - see career progression
npm run roster info 'Crimson Crusher'
```

### Testing Balance

Run many matches to test weapon balance:
```bash
npm run test-match  # Run 10 times
npm run roster stats  # Check weapon distribution in wins
```

---

## Next Steps

This foundation enables:

**Phase B - AI Arena Master:**
- LLM-powered commentary generation
- Autonomous 24/7 scheduling
- Social media integration (X, Telegram)
- Automated matchmaking and content creation

**Phase C - Wagering System:**
- Odds calculation
- Points-based betting
- Leaderboards
- Prize pools

**Phase D - NFTs & On-Chain:**
- Ball NFTs with unique attributes
- On-chain match verification
- Tournament systems
- Community governance

---

## Troubleshooting

### "Ball not found" Error
- Check spelling (partial matches work)
- Run `npm run roster list` to see available names
- Names are case-insensitive

### Database Issues
- Delete `data/arena.db` and run `npm run init-roster` again
- Database is local - safe to recreate

### TypeScript Errors
- Run `npm install` to ensure dependencies are installed
- Check that better-sqlite3 compiled correctly

---

## File Structure

```
src/
├── data/
│   ├── types.ts              # Type definitions
│   ├── database.ts           # SQLite wrapper
│   ├── roster.ts             # Roster management
│   └── migrations/
│       └── 001_initial.sql   # Database schema
├── analysis/
│   ├── stats.ts              # Match statistics
│   ├── excitement.ts         # Excitement scoring
│   └── summary.ts            # Text summary generation
├── simulation/
│   └── matchmaker.ts         # Matchmaking algorithm
├── match/
│   └── runner.ts             # Match orchestration
└── scripts/
    ├── init-roster.ts        # Initialize database
    ├── run-match.ts          # Run match CLI
    ├── roster.ts             # Roster query CLI
    ├── suggest-matchup.ts    # Matchmaking CLI
    └── test-match.ts         # Random test match

config/
└── starter-balls.json        # 25 ball templates

data/
└── arena.db                  # SQLite database (gitignored)
```

---

## Support

For issues, feature requests, or questions:
1. Check this guide first
2. Review `IMPLEMENTATION_SUMMARY.md` for technical details
3. Review `GAP_ANALYSIS.md` for roadmap

---

**Built with TypeScript, SQLite, and deterministic physics.**
**Ready for autonomous AI agent integration.**
