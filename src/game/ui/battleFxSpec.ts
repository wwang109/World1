import type { Archetype, Element, Property, WeaponType } from '../../engine/types';
import { ELEMENT_COLOR, PROPERTY_COLOR, WEAPON_COLOR } from '../theme';

/**
 * Battle FX spec — ARCHETYPE × ELEMENT layered animation recipes for the
 * battle scenes' playback FX (floating numbers + cast flourishes). Motion
 * SHAPE comes from the card's archetype (what kind of thing is happening —
 * a hit, a brace, a mend…); color/glow comes from its element/weapon (falling
 * back to property when the card has neither). Same tested-spec idiom as
 * `cardTokenSpec.ts`/`runScreenTemplate.ts`: a scene never hand-picks a color
 * or duration — it asks this module for the recipe and renders exactly that.
 *
 * Pure module: no Phaser import (ease names are just strings Phaser's tween
 * config already accepts), unit-tested in `tests/game/battleFxSpec.test.ts`.
 */

/** The five motion "shapes" — one per archetype, kept SHORT and returning to
 * rest (game-feel rule: juice is transient, ease everything, overshoot for
 * pop / ease-out for settle). */
export type MotionShape = 'punch' | 'brace' | 'rise' | 'shimmer' | 'sink';

export interface MotionProfile {
  /** Which archetype this profile renders (kept on the value for debug/tests). */
  archetype: Archetype;
  shape: MotionShape;
  /** Phaser ease name strings (e.g. `'Back.easeOut'`) — plain data, no Phaser import needed. */
  easeIn: string;
  easeOut: string;
  /** Duration (ms) of the archetype-specific "juice" phase — kept short. */
  activeMs: number;
  /** Extra hold (ms) at the peak before returning to rest (defensive brace); 0 = no hold beat. */
  holdMs: number;
  /** Scale reached at the peak of the juice phase (1 = no scale change). */
  scalePeak: number;
  /** Vertical drift in px (at 1x scale) for anything that floats/sinks during
   * this archetype's motion — negative = up (healing/support rise), positive
   * = down (debuff sink), near-zero = stays put (offense/defensive). */
  driftY: number;
  /** Symmetric rotation jitter in degrees (offense's angle jitter); 0 = none. */
  angleJitterDeg: number;
  /** Alpha-oscillation pulse count during the active phase (support's shimmer,
   * debuff's flicker); 0 = a single smooth in/out, no oscillation. */
  pulses: number;
}

/**
 * Suggested motion identity per archetype (tunable — these are the numbers,
 * not the contract; the contract is "every archetype resolves to a complete
 * profile" — see the unit test):
 * - offense: sharp punch-in with overshoot (Back.easeOut), slight angle jitter.
 * - defensive: brace — rise-then-hold, rectangular shield pulse.
 * - healing: soft rise + gentle fade, slight grow.
 * - support: shimmer/pulse (alpha oscillation) drifting up.
 * - debuff: sink downward with a drip/flicker.
 */
export const MOTION_PROFILE: Record<Archetype, MotionProfile> = {
  offense: {
    archetype: 'offense', shape: 'punch',
    easeIn: 'Back.easeOut', easeOut: 'Quad.easeOut',
    activeMs: 140, holdMs: 0, scalePeak: 1.22, driftY: -4, angleJitterDeg: 6, pulses: 0,
  },
  defensive: {
    archetype: 'defensive', shape: 'brace',
    easeIn: 'Sine.easeOut', easeOut: 'Quad.easeOut',
    activeMs: 150, holdMs: 140, scalePeak: 1.08, driftY: -2, angleJitterDeg: 0, pulses: 1,
  },
  healing: {
    archetype: 'healing', shape: 'rise',
    easeIn: 'Sine.easeOut', easeOut: 'Quad.easeOut',
    activeMs: 260, holdMs: 0, scalePeak: 1.1, driftY: -18, angleJitterDeg: 0, pulses: 0,
  },
  support: {
    archetype: 'support', shape: 'shimmer',
    easeIn: 'Sine.easeInOut', easeOut: 'Sine.easeInOut',
    activeMs: 320, holdMs: 0, scalePeak: 1.02, driftY: -10, angleJitterDeg: 0, pulses: 3,
  },
  debuff: {
    archetype: 'debuff', shape: 'sink',
    easeIn: 'Sine.easeIn', easeOut: 'Quad.easeOut',
    activeMs: 220, holdMs: 0, scalePeak: 1.03, driftY: 10, angleJitterDeg: 2, pulses: 2,
  },
};

/** Every archetype, in a fixed order — for tests/iteration only. */
export const ALL_ARCHETYPES: readonly Archetype[] = ['offense', 'defensive', 'healing', 'support', 'debuff'];
/** Every element/weapon/property, in a fixed order — for tests/iteration only. */
export const ALL_ELEMENTS: readonly Element[] = ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'];
export const ALL_WEAPONS: readonly WeaponType[] = ['sword', 'axe', 'lance', 'bow', 'beast'];
export const ALL_PROPERTIES: readonly Property[] = ['physical', 'magical', 'true'];

export interface FxPalette {
  /** Element/weapon/property key this palette resolved from — debug/tests only. */
  key: string;
  /** CSS hex string — floating-number text fill. */
  color: string;
  /** 0xRRGGBB — rectangle fills / overlays. */
  colorNum: number;
  /** A lighter tint of `colorNum` for glow/flash overlays. */
  glowNum: number;
}

function toHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Integer-channel lerp toward white, `pct` 0–100. */
function lighten(n: number, pct: number): number {
  const ch = (v: number): number => Math.min(255, Math.round(v + ((255 - v) * pct) / 100));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return (r << 16) | (g << 8) | b;
}

/** TRUE's dedicated fallback — bright white with a faint prismatic (lavender)
 * glow, distinct from the property stripe's muted cream (`PROPERTY_COLOR.true`)
 * used elsewhere on the card token itself; the FX layer wants TRUE hits to
 * read as unmistakably "ignores everything", not just another card color. */
const TRUE_PALETTE: FxPalette = { key: 'true', color: '#ffffff', colorNum: 0xffffff, glowNum: 0xe3d7ff };

/**
 * Element beats weapon beats property (a card carries at most one of
 * element/weapon, per `SkillDef`, so this is really just "pick whichever is
 * set, else fall back to property"). Reuses the SAME color tables the card
 * token/theme already uses — no invented palette.
 */
export function paletteFor(property: Property, element?: Element, weapon?: WeaponType): FxPalette {
  if (element) {
    const c = ELEMENT_COLOR[element];
    if (c !== undefined) return { key: element, color: toHex(c), colorNum: c, glowNum: lighten(c, 55) };
  }
  if (weapon) {
    const c = WEAPON_COLOR[weapon];
    if (c !== undefined) return { key: weapon, color: toHex(c), colorNum: c, glowNum: lighten(c, 55) };
  }
  if (property === 'true') return TRUE_PALETTE;
  const c = PROPERTY_COLOR[property];
  return { key: property, color: toHex(c), colorNum: c, glowNum: lighten(c, 55) };
}

export interface FxRecipe {
  motion: MotionProfile;
  palette: FxPalette;
}

/** The full archetype × element/weapon/property recipe for a card. */
export function battleFxRecipe(archetype: Archetype, property: Property, element?: Element, weapon?: WeaponType): FxRecipe {
  return { motion: MOTION_PROFILE[archetype], palette: paletteFor(property, element, weapon) };
}

/**
 * Convenience wrapper for call sites holding a `TurnFx`-shaped identity
 * (optional fields — un-attributed damage, e.g. DoT ticks, has neither) —
 * returns `undefined` when there's no card identity to resolve, so callers
 * fall back to their existing plain color.
 */
export function recipeForIdentity(
  archetype: Archetype | undefined,
  property: Property | undefined,
  element?: Element,
  weapon?: WeaponType,
): FxRecipe | undefined {
  if (!archetype || !property) return undefined;
  return battleFxRecipe(archetype, property, element, weapon);
}

/** Damage-number importance tier — bigger hits get a bigger, bolder number;
 * only the TOP tier flashes (checked highest `min` first, so tiers must stay
 * sorted ascending by `min` — the unit test pins the monotonic invariant). */
export interface FxTier {
  /** Minimum amount (inclusive) this tier applies from. */
  min: number;
  /** Font-size multiplier over the caller's base size. */
  fontScale: number;
  bold: boolean;
  /** Brief flash (2-3 alpha blinks) — true on the top tier only. */
  flash: boolean;
}

/** Tuned for the game's typical early/mid-run hit sizes (~10-100 HP); a
 * cosmetic-only table (no balance impact) — safe for `balance-designer` to
 * retune later against real damage distributions. */
export const FX_TIERS: readonly FxTier[] = [
  { min: 0, fontScale: 1, bold: false, flash: false },
  { min: 20, fontScale: 1.2, bold: true, flash: false },
  { min: 45, fontScale: 1.45, bold: true, flash: true },
];

/** The applicable tier for `amount` — the highest tier whose `min` it clears. */
export function fxTierFor(amount: number): FxTier {
  let chosen = FX_TIERS[0]!;
  for (const tier of FX_TIERS) {
    if (amount >= tier.min) chosen = tier;
  }
  return chosen;
}
