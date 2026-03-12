# Worbz: Visual Direction Analysis
*Phase 2 — Mood board extraction*

---

## What the Board Is Saying

The mood board confirms Neon Determinism and adds precision to it. But it also contains one image that reframes everything: a Kirby-adjacent jester character holding a beach ball, sitting in the center of a board full of cold military interfaces and cyberpunk terminals.

That's not an accident. That's the brand in one image. A cute, round, slightly absurd thing that has been accidentally loaded into a weapons targeting system. The visual system has to hold both things simultaneously — the cold composure of the operations center AND the inherent absurdity of a ball with a weapon. The Kirby character is the product. The rest of the board is the Arena Master's domain.

---

## Confirmed Palette Territory

The board resolves the color question precisely. These are not vibes — these are specific CRT phosphor readings:

**Background:** Absolute cold black. Not #111, not dark navy. The black of a powered-off CRT screen. `#000000` or within 5 points.

**Primary active — Terminal Green:** Not neon web green. The specific amber-tinted phosphor green of a P1 CRT phosphor. The EVA globe and GPS coordinate screens are the reference. Sits around `#39FF14` → `#00FF41` territory but with warmth. The EVA amber-green reads closer to `#7FFF00` in context. To be resolved in Phase 5 against black.

**Secondary active — Cold Teal:** The Lain interface blue-green. Cooler than the primary green. Used for data overlays and secondary UI panels. Sits in the `#00FFCC` → `#00CED1` range.

**Alert / Combat — Military Orange-Red:** Not crimson, not pure red. The DAMAGED indicator orange-red. The radar sweep amber. Military HUD alert color. Sits around `#FF4500` → `#FF6600`. This is the damage/critical state color — when a ball is losing, this fires.

**Data Warm — EVA Amber:** The synchro graph orange. Warm amber used for odds, probability states, numeric readouts. `#FF8C00` territory.

**Accent — Dead Signal Purple:** The corrupted dark red/purple in the top-left tactical map. Used sparingly. The color of something malfunctioning.

**Text on dark:** Not pure white. Slightly de-saturated. The text in every reference is slightly warm or slightly cyan — never pure `#FFFFFF`. Terminal output, not print.

---

## Confirmed Typography Territory

Every screen on this board uses the same type logic:

**Data layer:** Pixelated monospace. Not clean modern mono (not JetBrains Mono, not Fira Code). The specifically *rendered* look of bitmap terminal fonts — Courier-era, slightly aliased, feels like it came off a dot-matrix printer or an 8x8 bitmap grid. Used for: odds, records, damage numbers, coordinate readouts, status indicators.

**Drama layer:** Bold, condensed, all-caps. The DAMAGED, ALERT, SYNCHRO PATTERN GREEN indicators. Not a serif, not rounded — compressed grotesque or industrial slab. Used for match announcements, result posts, Arena Master pronouncements.

**UI layer:** Small, tight, functional. The button labels and panel headers in the Lain and tactical interfaces. Borderline illegible at scale — intentionally. Rewards close attention.

The two-layer system from the visual philosophy is confirmed and now more specific: **bitmap/terminal mono** for data, **compressed display** for drama.

---

## Confirmed Interface Patterns

**Grid as substrate:** Every screen in this board has a visible grid underneath it. Not decorative — structural. The grid is the arena floor. Elements align to it precisely. When something breaks the grid, it's intentional and meaningful.

**Status indicators as design language:** GREEN / DAMAGED / ALERT are not UI elements — they are aesthetic statements. The status system *is* the visual language. Worbz lives in this: everything has a state, every state has a color, every color means something specific.

**Radar as form:** The circular sweep with countdown timer (PROTECT NO. 666 frame) is beautiful and directly applicable. A match timer as a radar sweep. The countdown to the next match as a slowly filling arc. This is the form language of anticipation.

**Physical CRT as reference anchor:** The ENV: EUROPA image shows an actual amber CRT monitor with the interface displayed on it. This is critical: the aesthetic should feel like it could exist on real hardware from 1993. Not a simulation of old tech — a design language that would have been at home on that hardware. No effects for effect's sake. Only what the hardware would have rendered.

**ASCII as texture:** The animated ASCII screens are ambient texture — the background hum of the system running. Not content. Atmosphere. Used for loading states, background fills, the sense that something is always processing.

**Data overlay on drama:** The EVA globe is the model. A wireframe sphere (the *worbz*, literally) overlaid with coordinate data, synchro readouts, status panels. The ball is the drama. The data is the context. They coexist in the same frame.

---

## The Kirby Signal — The Most Important Image

The jester/clown Kirby character holding a beach ball is doing several things at once:

1. **It names the product's absurdity.** A ball. With a jester hat. This is explicitly, intentionally silly. The visual system must not take itself so seriously that the actual product — round things fighting — becomes incongruous.

2. **It provides the brand's warmth.** Everything else on the board is cold. This character is soft, rounded, color-saturated. It is the GLaDOS in the system — the charm inside the composure.

3. **It is a direction for the mark.** The Worbz logo/mark should have this quality: something spherical, slightly characterful, that would look utterly out of place in a military operations center — and yet it's there, in the center of the board, and somehow it belongs. That's the bit.

4. **It is the Arena Master's true nature.** He presents as SHODAN. He is, functionally, a jester. He runs a game where balls hit each other. The distance between the serious presentation and the absurd reality is where the comedy lives.

---

## The Low-Poly Mask

The faceted geometric mask (grey/silver polyhedron with orange accent fragments) is the Arena Master's face direction. If he has an avatar, it looks like this: a geometric mask, cold-surfaced, with something warm leaking through the cracks. Not a human face. Not a robot face. A *made thing* that suggests intelligence without revealing it.

---

## What This Means for Phase 3 (Mark Development)

The mark needs to solve the central tension: **a sphere that is both a weapons data target and a Kirby character.**

The EVA wireframe globe (wireframe sphere with coordinate overlay) is the direct formal ancestor. But the Kirby character gives it a face. The mark should feel like:
- A ball seen through a targeting reticle
- A data readout that happens to be alive
- Something a NERV operations officer would have as a screensaver if they had a sense of humor

**Mark directions to explore in Phase 3:**
1. Wireframe sphere with crosshair/targeting overlay — pure tactical
2. Simple sphere with data tick marks and coordinate lines — the GPS globe
3. A sphere that has *eyes* or a very minimal face — the Kirby signal, minimal
4. The radar circle as the mark — the sweep, the blip, not the ball itself
5. A fragmented/faceted sphere (the low-poly mask applied to a circle) — geometric, cold, slightly broken

---

## What This Means for Phase 5 (Design System)

**Color system:** Derive from CRT phosphor palette. Terminal green as the primary active. Amber/orange as the probability/data layer. Military orange-red as the alert/damage state. Cold teal as secondary UI. No gradients — flat, phosphor-flat. Glow is a *layer effect* added on top of flat color, not a gradient.

**Surface treatment:** The physical CRT monitor photo is the anchor. Scanlines as an optional texture layer that adds depth without being decorative. The aesthetic should work WITHOUT the scanlines — they are enhancement, not load-bearing.

**Layout:** Grid-locked. The Lain and tactical interfaces both show panels floating in black space, clearly aligned to an invisible grid. Breathing room between panels is part of the system — not editorial white space, operational clearance.

---

## Phase 2 Summary

| Signal | Source | Applied To |
|--------|---------|-----------|
| Terminal phosphor green | EVA globe, GPS screen | Primary active color |
| Military orange-red | DAMAGED indicator | Alert/combat state |
| EVA amber | Synchro graph | Odds/probability readouts |
| Cold teal | Lain interfaces | Secondary UI panels |
| Absolute black | Every screen | Background base |
| Bitmap monospace | All terminal screens | Data typography |
| Compressed bold all-caps | DAMAGED/ALERT text | Drama typography |
| Visible grid structure | Tactical maps | Layout system |
| Radar sweep form | PROTECT NO. 666 | Timer/anticipation UI |
| ASCII texture | Animated screens | Ambient background |
| Wireframe sphere | EVA globe, GPS globe | Mark formal ancestor |
| Kirby jester ball | Center of board | Brand tonal anchor |
| Low-poly mask | Polygon face | Arena Master avatar direction |
| Physical CRT | ENV: EUROPA monitor | Aesthetic authenticity anchor |
