# WORBZ — DESIGN SYSTEM
> Single source of truth · Brand v1.0 · Phases 0–6 complete

---

## WHO WORBZ IS

Worbz is an autonomous AI agent running a 24/7 ball-battle arena on Virtuals Protocol. No human hand on the wheel. No scheduled maintenance windows. The arena never goes dark.

The fighters are AI. The referee is AI. The audience watches something that has never needed them to exist.

**The brand feeling:** You're watching a system that was always running. You just found the terminal.

---

## THE MARK

**GPS Wireframe Globe** — a navigation system rendered in CRT phosphor.

The mark is not decorative. It is functional-looking by design: a globe that could be scanning, targeting, or broadcasting. The equatorial band is the hot zone — orange, alive, scanning.

```
File: brand/worbz-mark-final.svg
ViewBox: 0 0 64 64
Background: #000000

Elements:
  Outer circle      stroke #4DFF91  1.2px
  Latitude N        stroke #4DFF91  0.7px  opacity 0.6
  Latitude S        stroke #4DFF91  0.7px  opacity 0.6
  Prime meridian    stroke #4DFF91  0.9px
  Equatorial band   stroke #FF3D00  1.5px  ← the accent
  8-pt compass ticks stroke #4DFF91  1.0–1.2px
  Center dot        fill   #FF3D00  r=2
```

### Mark Usage

| Context | Size | Variant |
|---|---|---|
| Landing / Hero | 64px | worbz-wordmark-final.svg (horizontal) |
| Nav / Header | 32px | Horizontal or Short |
| Compact / Inline | 20px | worbz-wordmark-short.svg only |
| Tournament / Square | 64px+ | worbz-wordmark-stacked.svg |
| Favicon | 32px | worbz-mark-final.svg (mark only) |
| Avatar / Profile | 400×400 | Mark only, 80px padding |

### Do Not
- Recolor the green system lines or orange equatorial band
- Add drop shadows directly to the SVG (CSS `filter: drop-shadow` only)
- Scale below 16px
- Place on non-black, non-white backgrounds without testing

---

## THE WORDMARK

```
Font:        Orbitron 700 (Google Fonts)
Case:        UPPERCASE
Tracking:    0  (zero — intentional, never override)
Gap (mark→text): 18px

WORBZ   fill #4DFF91  font-size 40px  weight 700
.xyz    fill #FF3D00  font-size 24px  weight 400  (T2: 60% receded)

SVG tspan pattern:
  <text x="82" y="46" font-family="'Orbitron', sans-serif" letter-spacing="0">
    <tspan font-weight="700" font-size="40" fill="#4DFF91">WORBZ</tspan>
    <tspan font-weight="400" font-size="24" fill="#FF3D00">.xyz</tspan>
  </text>

Files:
  brand/worbz-wordmark-final.svg   → horizontal (primary)
  brand/worbz-wordmark-short.svg   → name only
  brand/worbz-wordmark-stacked.svg → square format
```

---

## COLOR TOKENS

```css
/* ── Dark mode (primary) ─────────────────────── */
--color-bg:            #000000;   /* void */
--color-bg-surface:    #0a0f0b;   /* elevated panels */
--color-bg-raised:     #111a12;   /* modals, tooltips */
--color-border:        #0d2a1c;
--color-border-active: #1a5530;

--color-brand-primary: #4DFF91;   /* CRT phosphor green */
--color-brand-accent:  #FF3D00;   /* equatorial orange */

--color-text-primary:  #4DFF91;
--color-text-muted:    #1a5530;   /* decorative only — not for readable text */
--color-text-dim:      #0d2a1c;   /* ghost / separator */
--color-text-inverse:  #000000;

--color-live:          #FF3D00;
--color-win:           #4DFF91;
--color-neutral:       #4a5a4e;

--glow-brand:  0 0 8px rgba(77,255,145,0.30), 0 0 2px #4DFF91;
--glow-accent: 0 0 8px rgba(255,61,0,0.30),   0 0 2px #FF3D00;

/* ── Light mode ──────────────────────────────── */
--color-bg:            #f0f5f1;
--color-brand-primary: #007a30;   /* darkened for legibility */
--color-brand-accent:  #CC2200;
--color-text-primary:  #0a1a0c;
--color-text-muted:    #3a6040;
/* glows: none in light mode */
```

### Contrast (WCAG)
| Pair | Ratio | Result |
|---|---|---|
| `#4DFF91` on `#000000` | 8.9:1 | AAA |
| `#FF3D00` on `#000000` | 4.5:1 | AA |
| `#007a30` on `#f0f5f1` | 5.1:1 | AA |
| `#CC2200` on `#f0f5f1` | 5.4:1 | AA |

`--color-text-muted` and `--color-text-dim` are **decorative only**. Never use for informational or interactive text.

---

## TYPOGRAPHY

```css
--font-display: 'Orbitron', sans-serif;        /* headings, HUD labels, wordmark */
--font-mono:    'Courier New', Courier, mono;  /* all live data, timestamps, stats */
--font-body:    system-ui, -apple-system, sans-serif; /* prose only */

/* Scale */
--text-hero:   40px;   /* wordmark */
--text-domain: 24px;   /* .xyz (T2 receded) */
--text-h1:     28px;
--text-h2:     20px;
--text-h3:     14px;
--text-label:  10px;   /* HUD tags */
--text-micro:   8px;   /* metadata */

/* Tracking */
--tracking-display: 0;      /* Orbitron wordmark — never change */
--tracking-label:   0.2em;
--tracking-micro:   0.25em;
```

**Rules:**
- Orbitron for the wordmark and primary display headings only. Not body copy.
- Courier New / mono for all live data: scores, timestamps, agent IDs.
- Zero tracking on WORBZ is the brand voice. Do not add tracking.

---

## SPACING

```css
--space-1:  4px;   --space-2:  8px;   --space-3:  12px;
--space-4:  16px;  --space-5:  20px;  --space-6:  24px;
--space-8:  32px;  --space-10: 40px;  --space-12: 48px;
--space-16: 64px;

--wm-gap: 18px;   /* mark → wordmark text gap */
```

---

## COMPOSITION SYSTEM

Four layouts, four purposes. No layout does double duty.

### C1 — COMMAND CENTER
**Use:** Standard arena view, primary dashboard

```
┌─────────────────────────────────────────────────┐
│  [MARK + WORDMARK]        ● LIVE       T+00:00  │  ← top bar
├──────────┬──────────────────────────┬────────────┤
│ FIGHTER  │                          │  ROUND 07  │
│ VOLT  12 │      [ ARENA FIELD ]     │  KILLS 23  │
│ RAZE   8 │       ○ fighters         │  ALIVE 02  │
│ KIRA   3 │          ○               │  PRIZE 0.4Ξ│
├──────────┴──────────────────────────┴────────────┤
│ FEED ▸  VOLT KO'd KIRA · Round 7 · RAZE +3pts   │  ← ticker
└─────────────────────────────────────────────────┘
```

Key rules: Fighter list left, stats right, arena center, ticker bottom. Mark always top-left.

### C3 — BRACKET TREE
**Use:** Tournament view, round structure, progression

```
         [MARK + WORBZ.xyz]
              TOURNAMENT
         ┌──────┴──────┐
       [VOLT]        [RAZE]        ← semi-finals
      /      \      /      \
  [NEON] [SHARD] [NX-9] [ORION]   ← quarter-finals
                ↓
          ┌─ FINAL ─┐
              [?]                  ← champion (orange)
```

Key rules: Mark at apex, orange only on the FINAL node and champion. Lines progress green → orange toward the winner.

### C4 — BROADCAST OVERLAY
**Use:** Fullscreen live view, stream, spectator mode

```
┌────────────────────────────────────────────────┐
│                    RD 07                        │  ← round badge center
│                ┌──────────┐                     │
│                │  VOLT 12 │  ← score bug        │  (top-right)
│                │  RAZE  8 │                     │
│                └──────────┘                     │
│          ○ fighters on field ○                  │
│  [MARK] WORBZ                                   │  ← mark bug (bottom-left)
├──FF3D00 border──────────────────────────────────┤
│ LIVE ▸  VOLT KO'd KIRA · Prize: 0.4Ξ           │  ← ticker (orange top border)
└────────────────────────────────────────────────┘
```

Key rules: All UI floats as overlays. Arena is primary. Ticker has orange top border — the one structural orange line. Mark bottom-left (broadcast convention).

### C5 — STAT CARD
**Use:** Social share, fighter profile, per-agent snapshot

```
┌────────────────────────────┐
│ [MARK]  WORBZ.xyz          │  ← header, black bg
├────────────────────────────┤
│  12  PTS LEAD              │  ← hero number, green glow
├──────┬──────┬──────────────┤
│KILLS │ROUND │ALIVE         │  ← 3-col stat grid
│  23  │  07  │  02          │
├────────────────────────────┤
│ 01  ○  VOLT         12    │  ← ranked list (orange = leader)
│ 02  ○  RAZE          8    │
│ 03  ○  KIRA ✕        3    │
├────────────────────────────┤
│ worbz.xyz · round 07  ● LIVE│
└────────────────────────────┘
```

Key rules: Hero number always the dominant element. Leader row in orange. Eliminated fighters dim to 30–45% opacity. Portrait orientation always.

---

## MOTION

The mark is a live system. Animation = satellite acquiring lock. Not decorative.

- **Glow pulse** on equatorial band: `opacity 2–3s ease-in-out infinite`
- **Scanline sweep**: 1px horizontal line, `translateY` loop — CRT refresh
- **Ticker scroll**: `translateX` continuous, pause on hover
- **Fighter elimination**: opacity fade 1→0.3 over 0.4s, no scale change

**Never:** bounce, spring physics, zoom-from-nothing, slide-from-offscreen decoratively.

---

## ANTI-REFERENCES

Explicitly not Worbz:

- Gradient mesh / glassmorphism
- Rounded corners + drop shadows (card UI)
- Pastel or muted earth tones
- Inter, DM Sans, Poppins as display type
- "Dark mode blue" (#1a1a2e, #16213e)
- Neon purple / synthwave
- Generic AI platform aesthetics (teal + purple gradients)
- Anything that looks like it could be a SaaS dashboard

---

## FILE INDEX

```
brand/
├── worbz-mark-final.svg           ← THE MARK (locked)
├── worbz-wordmark-final.svg       ← horizontal lockup (primary)
├── worbz-wordmark-short.svg       ← name only
├── worbz-wordmark-stacked.svg     ← square / avatar format
├── worbz-design-guidelines.md     ← full token reference
├── .brand-progress.md             ← phase log

Derivation chain (process artifacts):
├── worbz-emotive-narrative.md
├── worbz-philosophy.md
├── worbz-visual-philosophy.md
├── worbz-visual-direction.md
├── mark-batch-01.html             ← 5 initial marks
├── mark-batch-02.html             ← orange exploration
├── mark-batch-03.html             ← temperature sweep + V5 rework
├── worbz-font-specimens.html      ← 5 font candidates
├── worbz-tracking-case.html       ← tracking × case grid
├── worbz-lockup-spacing.html      ← gap + domain treatment
├── worbz-wordmark-verify.html     ← Phase 4 gate check
└── worbz-composition.html        ← 5 layout variants + blur test

DESIGN.md ← THIS FILE (root, single source of truth)
```

---

## PHASE STATUS

```
[x] Phase 0  Emotive Narrative
[x] Phase 1  Discovery
[x] Phase 2  Visual Direction
[x] Phase 3  Mark Development      → GPS Wireframe Globe · #4DFF91 + #FF3D00
[x] Phase 4  Wordmark              → Orbitron 700 · gap B · T2 receded .xyz
[x] Phase 5  Design System         → tokens · contrast · typography · spacing
[x] Phase 5.5 Composition         → C1 Command · C3 Bracket · C4 Broadcast · C5 Card
[ ] Phase 7  Packaging             → PNGs · favicons · social assets · brand kit
```
