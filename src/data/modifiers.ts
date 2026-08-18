import type { BuffableStat, SkillTier } from '../engine/types';

// Enemy MODIFIERS — rogue-like affixes an encounter can stack on top of an
// enemy's (level + rank + extra cards). This is CONTENT (names, blurbs, and
// the tuning values behind each affix), authored here rather than in the
// run-layer resolver that consumes it (`src/run/encounter.ts`). That module
// still owns the MECHANISM — how a `bonusPL`/`bonusProfile` pair gets
// auto-spent through the level-up PL economy, and how `forceTier` overrides
// rank assignment after the fact; this module owns only the DATA those two
// mechanisms read.
//
// Each preset is either:
//   - a bonus PL auto-spend (`bonusPL` + `bonusProfile`), priced through the
//     SAME `LEVEL_STAT_COST` economy as every other stat point in the game
//     (so a Swift enemy's speed is exactly as "expensive" as anyone else's), or
//   - a deck-wide tier override (`forceTier`) applied AFTER rank assignment.
// Add a new affix = add a row here; the resolver in encounter.ts needs no
// changes.

/**
 * The stat weights a `bonusPL` modifier spends against — a subset mirror of
 * `StatProfile` (src/run/leveling.ts) kept LOCAL to this content module so
 * `src/data` never has to import from `src/run`: same field set (`maxHp` +
 * every `BuffableStat`), just declared against the engine's own stat-name
 * type instead of the run layer's allocation type. Structurally identical,
 * so it folds straight into `Partial<StatProfile>` at the resolver call site.
 */
export type ModifierStatBonus = Partial<Record<'maxHp' | BuffableStat, number>>;

export interface EnemyModifierPreset {
  /** The document/book key — carried on the value too, matching the
   * GemDef/EnemyDef convention of a self-describing entry. */
  id: string;
  /** Display name, e.g. chip label. */
  name: string;
  /** One-line effect description for UI. */
  blurb: string;
  /** Extra PL auto-spent (allocateMonsterPL) against `bonusProfile` after level scaling. */
  bonusPL?: number;
  bonusProfile?: ModifierStatBonus;
  /** Force EVERY deck card to this tier after rank assignment (rank reads as the ceiling). */
  forceTier?: SkillTier;
}

export const MODIFIER_PRESETS: Record<string, EnemyModifierPreset> = {
  diamond: {
    id: 'diamond',
    name: 'DIAMOND-POWERED',
    blurb: 'Every card upgraded to Diamond tier',
    forceTier: 'diamond',
  },
  swift: {
    id: 'swift',
    name: 'SWIFT',
    blurb: '+8 PL of pure Speed (+4 SPD)',
    bonusPL: 8,
    bonusProfile: { speed: 1 },
  },
};

export const ENEMY_MODIFIER_IDS: readonly string[] = Object.keys(MODIFIER_PRESETS);
