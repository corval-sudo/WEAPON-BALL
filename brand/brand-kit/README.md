# WORBZ Brand Kit

Brand v1.0 · Full design system documentation → `../../DESIGN.md`

---

## Quick Start

Copy the right file for your context:

| Need | File |
|---|---|
| Website header / nav | `svg/worbz-wordmark-primary.svg` |
| Dark background (any color) | `svg/worbz-mark-white.svg` |
| Light background | `svg/worbz-mark-on-light.svg` |
| Single-color / print | `svg/worbz-mark-mono.svg` |
| Browser favicon | `favicons/favicon-32.svg` |
| iOS home screen | `favicons/apple-touch-icon.svg` |
| Link preview / OG | `social/worbz-og-image.svg` (→ export as PNG) |
| Social profile avatar | `social/worbz-avatar.svg` (→ export as PNG) |

For PNG exports open `../worbz-export.html` in a browser and download.

---

## File Index

```
brand-kit/
│
├── svg/
│   ├── worbz-mark-primary.svg        → #4DFF91 + #FF3D00, black bg (primary)
│   ├── worbz-mark-white.svg          → all white, transparent bg
│   ├── worbz-mark-mono.svg           → #4DFF91 only, transparent bg
│   ├── worbz-mark-on-light.svg       → #005520 + #CC2200, transparent bg
│   ├── worbz-wordmark-primary.svg    → horizontal, green+orange, black bg
│   ├── worbz-wordmark-white.svg      → all white, transparent bg
│   └── worbz-wordmark-on-light.svg   → dark colors, transparent bg
│
├── favicons/
│   ├── favicon-16.svg                → minimal (outer circle + equator only)
│   ├── favicon-32.svg                → standard browser tab
│   ├── favicon-48.svg                → full detail
│   └── apple-touch-icon.svg          → 180×180 iOS home screen
│
└── social/
    ├── worbz-og-image.svg            → 1200×630 Open Graph / Twitter Card
    └── worbz-avatar.svg              → 400×400 profile picture
```

Source SVGs (locked originals):
```
../worbz-mark-final.svg
../worbz-wordmark-final.svg
../worbz-wordmark-short.svg
../worbz-wordmark-stacked.svg
```

---

## Colors

```
Primary green:  #4DFF91  (CRT phosphor — light bg: #007a30)
Accent orange:  #FF3D00  (equatorial band — light bg: #CC2200)
Background:     #000000  (void)
```

## Font

**Orbitron** (Google Fonts) — weight 700 for display, 400 for domain suffix.
Load via: `https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap`

---

## Favicon HTML

```html
<link rel="icon" type="image/svg+xml" href="/favicon-32.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.svg">
```

## OG Meta Tags

```html
<meta property="og:image" content="https://worbz.xyz/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://worbz.xyz/og-image.png">
```

> Note: OG/Twitter images must be PNG or JPG. Export `worbz-og-image.svg` to PNG
> using `worbz-export.html` before deploying.
