// web/src/phaser/weapon-sprites.ts
// SVG weapon sprite configuration derived from SVG geometry analysis.
//
// Each config describes where the weapon's handle end sits inside the SVG image
// (as a 0–1 fraction) and the natural direction the tip points when the sprite
// has zero rotation applied.  At runtime we:
//   1. Place the sprite origin at the handle end   → sprite pivot = ball center
//   2. Compute phaserRot = gameAngleRad - baseAngle  → tip aligns with physics angle
//   3. Scale so handle-to-tip pixel distance = reachPx  → visual matches physics reach

export interface WeaponSpriteConfig {
  key: string;
  /** SVG viewBox width (px) */
  imageW: number;
  /** SVG viewBox height (px) */
  imageH: number;
  /** Handle-end X as 0–1 fraction of imageW */
  originX: number;
  /** Handle-end Y as 0–1 fraction of imageH */
  originY: number;
  /**
   * Natural direction of the tip from the handle end, in radians (screen coords,
   * y-axis pointing down).  Derived as atan2(tipY - handleY, tipX - handleX).
   */
  baseAngle: number;
  /**
   * Euclidean pixel distance from handle end to tip inside the SVG coordinate
   * space (at the SVG's native viewBox size).  Used to compute the display scale
   * factor:  scale = reachPx / svgTipDistPx
   */
  svgTipDistPx: number;
}

// ── Mace (512×512) ───────────────────────────────────────────────────────────
// Handle end ≈ (18, 461)   tip (mace head centre) ≈ (403, 85)
// tip direction: atan2(85−461, 403−18) = atan2(−376, 385) ≈ −0.773 rad

// ── Spear (100×100) ──────────────────────────────────────────────────────────
// Handle end ≈ (28.8, 72.4)  tip (arrowhead point) ≈ (68, 28)
// tip direction: atan2(28−72.4, 68−28.8) = atan2(−44.4, 39.2) ≈ −0.848 rad

// ── Sword (441×441) ──────────────────────────────────────────────────────────
// Handle end (pommel) ≈ (433, 393)  tip (blade point) ≈ (0, 0)
// tip direction: atan2(0−393, 0−433) = atan2(−393, −433) ≈ −2.407 rad

export const WEAPON_SPRITE_CONFIGS: Record<string, WeaponSpriteConfig> = {
  weapon_mace: {
    key: 'weapon_mace',
    imageW: 512,
    imageH: 512,
    originX: 0.035,  // handle end at x ≈ 18
    originY: 0.900,  // handle end at y ≈ 461
    baseAngle: Math.atan2(-376, 385),  // ≈ −0.773 rad
    svgTipDistPx: 538,
  },
  weapon_spear: {
    key: 'weapon_spear',
    imageW: 100,
    imageH: 100,
    originX: 0.288,  // handle end at x ≈ 28.8
    originY: 0.724,  // handle end at y ≈ 72.4
    baseAngle: Math.atan2(-44.4, 39.2),  // ≈ −0.848 rad
    svgTipDistPx: 59,
  },
  weapon_sword: {
    key: 'weapon_sword',
    imageW: 441,
    imageH: 441,
    originX: 0.981,  // pommel at x ≈ 433
    originY: 0.890,  // pommel at y ≈ 393
    baseAngle: Math.atan2(-393, -433),  // ≈ −2.407 rad
    svgTipDistPx: 584,
  },
};

/**
 * Maps weapon simulation type → Phaser texture key.
 * blunt → mace SVG, point → spear SVG, blade → sword SVG (shared by katana + short_sword).
 */
export const WEAPON_TYPE_TO_KEY: Record<string, string> = {
  blunt: 'weapon_mace',
  point: 'weapon_spear',
  blade: 'weapon_sword',
};
