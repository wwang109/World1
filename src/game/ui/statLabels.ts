import type { BuffableStat } from '../../engine/types';

/**
 * THE single source of truth for every player-facing stat label in
 * `src/game`. Before this module existed the same stat was spelled three
 * different ways across the UI (MAG in `statGlossary.ts`, MATK on the battle
 * log, "Magic Power" in glossary/action prose) — every consumer below must
 * import from here instead of hand-typing a token.
 *
 * Does NOT cover `src/data` card text (a separate content-team sweep) or the
 * unrelated `Property` labels (PHYS/MAG/TRUE — `theme.ts#PROPERTY_LABEL`,
 * which name the physical/magical/true DAMAGE TYPE, not the Magic Power
 * STAT, and are intentionally left alone).
 */

/** Every player-facing stat key — the engine's five `BuffableStat` scaling
 * stats plus max HP (not itself buffable, but shown on every statline). */
export type StatKey = 'maxHp' | BuffableStat;

/** Canonical display order for a full statline (HP first, then the five
 * buffable stats in the order every existing statline already used). */
export const STAT_KEYS: readonly StatKey[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'];

/**
 * THE canonical short token per stat, per the locked stat model: HP, ATK,
 * MATK, DEF (armor), MDEF (magicResist), SPD. Physical scales off ATK,
 * magical off MATK — every statline/log line/card face/glossary title in
 * `src/game` must read one of these six tokens, never a synonym.
 */
export const STAT_TOKEN: Record<StatKey, string> = {
  maxHp: 'HP',
  attack: 'ATK',
  magicPower: 'MATK',
  armor: 'DEF',
  magicResist: 'MDEF',
  speed: 'SPD',
};

/** Long-form name for glossary bodies and full-word action descriptions
 * (e.g. "20 + Magic Power damage") — the prose companion to `STAT_TOKEN`. */
export const STAT_LONG_NAME: Record<StatKey, string> = {
  maxHp: 'Hit Points',
  attack: 'Attack',
  magicPower: 'Magic Power',
  armor: 'Armor',
  magicResist: 'Magic Resist',
  speed: 'Speed',
};
