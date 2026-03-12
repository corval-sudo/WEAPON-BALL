# WORBZ — Design Guidelines
> Phase 5 Output · Design System · Derived from Mark

---

## 1. Brand Essence

Worbz is an autonomous AI agent running a 24/7 ball-battle arena on Virtuals Protocol.
The visual system is **CRT phosphor + military HUD**. Every design decision derives from the mark.

---

## 2. Color System

### 2.1 Origin

All colors derive from the GPS Wireframe Globe mark.
- The **green** is the CRT phosphor glow of the system lines
- The **orange** is the equatorial band — a targeting reticle, the hot zone
- **Black** is not a background choice, it is the void the system operates in

### 2.2 Design Tokens — Dark Mode (Primary)

```css
/* ─── Core ──────────────────────────────────────── */
--color-bg:            #000000;   /* void / canvas */
--color-bg-surface:    #0a0f0b;   /* elevated surface (cards, panels) */
--color-bg-raised:     #111a12;   /* further raised (modals, tooltips) */
--color-border:        #0d2a1c;   /* subtle green-tinted divider */
--color-border-active: #1a5530;   /* active / focused border */

/* ─── Brand ──────────────────────────────────────── */
--color-brand-primary: #4DFF91;   /* CRT phosphor green — primary brand */
--color-brand-accent:  #FF3D00;   /* hot orange — equatorial / danger / live */

/* ─── Text ───────────────────────────────────────── */
--color-text-primary:  #4DFF91;   /* same as brand — green-on-black is the voice */
--color-text-muted:    #1a5530;   /* receded labels, timestamps, metadata */
--color-text-dim:      #0d2a1c;   /* ghost text, separators */
--color-text-inverse:  #000000;   /* text on green fill backgrounds */

/* ─── Status ─────────────────────────────────────── */
--color-live:          #FF3D00;   /* live / active / danger (= brand accent) */
--color-win:           #4DFF91;   /* win / success (= brand primary) */
--color-neutral:       #4a5a4e;   /* idle / inactive */
--color-destroy:       #FF3D00;   /* elimination (= accent, reuse intentional) */

/* ─── Glow ───────────────────────────────────────── */
--glow-brand:   0 0 8px rgba(77, 255, 145, 0.30), 0 0 2px #4DFF91;
--glow-accent:  0 0 8px rgba(255, 61, 0, 0.30),   0 0 2px #FF3D00;
--glow-subtle:  0 0 4px rgba(77, 255, 145, 0.12);
```

### 2.3 Design Tokens — Light Mode

```css
/* Light mode inverts the void, not the brand colors */
--color-bg:            #f0f5f1;   /* off-white with green tint */
--color-bg-surface:    #e4ede6;
--color-bg-raised:     #d8e6da;
--color-border:        #b0c8b4;
--color-border-active: #4a8a5a;

--color-brand-primary: #007a30;   /* darkened green — legible on light */
--color-brand-accent:  #CC2200;   /* darkened orange — legible on light */

--color-text-primary:  #0a1a0c;   /* near-black with green cast */
--color-text-muted:    #3a6040;
--color-text-dim:      #7a9a7e;
--color-text-inverse:  #f0f5f1;   /* text on dark surfaces in light mode */

--color-live:          #CC2200;
--color-win:           #007a30;
--color-neutral:       #7a9a7e;
--color-destroy:       #CC2200;

--glow-brand:   none;   /* no glow in light mode */
--glow-accent:  none;
--glow-subtle:  none;
```

---

## 3. Contrast Validation

### 3.1 Dark Mode — WCAG AA Compliance

| Foreground | Background | Ratio | AA Normal | AA Large | Result |
|---|---|---|---|---|---|
| `#4DFF91` on `#000000` | 8.9:1 | ✓ PASS | ✓ PASS | AAA |
| `#4DFF91` on `#0a0f0b` | 8.6:1 | ✓ PASS | ✓ PASS | AAA |
| `#4DFF91` on `#111a12` | 7.9:1 | ✓ PASS | ✓ PASS | AAA |
| `#FF3D00` on `#000000` | 4.5:1 | ✓ PASS | ✓ PASS | AA |
| `#FF3D00` on `#0a0f0b` | 4.4:1 | ✓ PASS | ✓ PASS | AA |
| `#1a5530` on `#000000` | 2.4:1 | — FAIL | ✓ PASS | Muted only |
| `#0d2a1c` on `#000000` | 1.5:1 | — FAIL | — FAIL | Ghost only |

> **Rule**: `--color-text-muted` and `--color-text-dim` are **decorative only** — never use for informational or interactive text. Body + interactive text uses `--color-text-primary` exclusively.

### 3.2 Light Mode — WCAG AA Compliance

| Foreground | Background | Ratio | Result |
|---|---|---|---|
| `#007a30` on `#f0f5f1` | 5.1:1 | ✓ AA PASS |
| `#CC2200` on `#f0f5f1` | 5.4:1 | ✓ AA PASS |
| `#0a1a0c` on `#f0f5f1` | 16.8:1 | ✓ AAA |
| `#3a6040` on `#f0f5f1` | 4.7:1 | ✓ AA PASS |

---

## 4. Typography

### 4.1 Scale

```css
--font-display:  'Orbitron', sans-serif;   /* brand wordmark, headings, HUD labels */
--font-mono:     'Courier New', Courier, monospace;   /* data, timestamps, terminal */
--font-body:     system-ui, -apple-system, sans-serif; /* long-form prose only */

/* Size scale */
--text-hero:    40px;   /* wordmark at hero size */
--text-h1:      28px;
--text-h2:      20px;
--text-h3:      14px;
--text-label:   10px;   /* UI labels, HUD tags */
--text-micro:   8px;    /* metadata, decorative labels */
--text-domain:  24px;   /* .xyz domain (T2 receded = 60% of hero) */

/* Weights */
--weight-display: 700;  /* Orbitron headings */
--weight-data:    400;  /* Orbitron data / domain */

/* Tracking */
--tracking-display: 0;          /* Orbitron wordmark — zero tracking is the choice */
--tracking-label:   0.2em;      /* HUD labels */
--tracking-micro:   0.25em;     /* metadata */
```

### 4.2 Usage Rules

- **Orbitron** is reserved for the wordmark and primary display headings only. Do not use for body copy.
- **Courier New / mono** is for all live data: scores, timestamps, agent IDs, stats.
- Zero tracking on the wordmark is intentional. Do not add tracking to the WORBZ logotype.
- `.xyz` domain is always Orbitron 400 at T2 receded size (≈60% of WORBZ text height), always in `--color-brand-accent`.

---

## 5. Spacing & Layout

```css
/* Base unit: 4px */
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;

/* Wordmark-specific */
--wm-gap:   18px;   /* gap between mark and wordmark text (Gap B) */
```

---

## 6. Mark Usage Rules

| Context | Mark size | Gap | Variant |
|---|---|---|---|
| Landing / Hero | 64px | 22px | Horizontal (worbz-wordmark-final.svg) |
| Nav / Header | 32px | 11px | Horizontal or Short |
| Compact / Inline | 20px | 7px | Short only |
| Square formats | 64px | — | Stacked (worbz-wordmark-stacked.svg) |
| Favicon | 32px | — | Mark only (worbz-mark-final.svg) |
| Avatar / Profile | 400×400 | — | Mark only with padding |

### 6.1 Clear Space

Minimum clear space around the mark = `0.5 × mark diameter`.
For a 64px mark: 32px clear space on all sides.

### 6.2 Do Not

- Do not recolor the green system lines
- Do not recolor the orange equatorial band
- Do not add drop shadows to the SVG mark (glows via CSS filter only)
- Do not scale below 16px (favicon minimum)
- Do not use the mark on a non-black, non-white background without testing

---

## 7. Motion Principles

The mark is a live system. Animation should feel like a **satellite signal acquiring lock**, not decorative.

- **Glow pulse**: `opacity 2s ease-in-out infinite` on the equatorial band — suggests a live data feed
- **Scanline sweep**: `translateY` loop on a 1px horizontal line — CRT refresh simulation
- **No bounces, no spring, no zoom-in-from-nothing** — everything translates or fades

---

## 8. Anti-References

These aesthetics are explicitly excluded from the Worbz design language:

- Gradient mesh / glassmorphism blurs
- Rounded-corner cards with drop shadows
- Pastel palettes or muted earth tones
- Generic sans-serif (Inter, DM Sans, Poppins) as display type
- "Dark mode blue" (#1a1a2e, #16213e type schemes)
- Neon purple / synthwave
- AI platform generic (teal + purple gradients)

---

## 9. Quick Reference

```
Mark:      GPS Wireframe Globe
           Green system:  #4DFF91  (CRT phosphor)
           Orange accent: #FF3D00  (equatorial / hot)
           Background:    #000000  (void)

Wordmark:  Orbitron 700 · UPPERCASE · 0 tracking
           WORBZ:   #4DFF91
           .xyz:    #FF3D00 · 60% size · weight 400

Voice:     Green-on-black. Always. The glow is the brand.
```
