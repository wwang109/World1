import { describe, expect, it } from 'vitest';
import { applyTier } from '../../src/engine/cards';
import { capViolations, powerLevelBreakdown, powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef, SkillTier } from '../../src/engine/types';
import { tc, NO_ENDGAME } from '../helpers';

/**
 * TIER-BLOCK SCOPE — a tier that buys an ABILITY, not a bigger number.
 *
 * `TierUpgrade.scope` lets a card be single-target at Bronze and hit every
 * living foe from a higher tier up. `applyTier` spreads an authored block onto
 * the base def, so the override reaches EVERY reader of `skill.scope` — the
 * pricer (`powerLevelDeci` → `PRICE.aoeTargetsNum/Den`), the interpreter's
 * `resolveTargets`, and the `skillCast`/`play` event's `aoe`/`targets` marker —
 * through the resolved card and nothing else. These tests pin all three, plus
 * the exact-budget property the content plan depends on.
 */

/**
 * THE WORKED EXAMPLE. A size-1 physical card that goes AoE at Gold and lands
 * EXACTLY on every tier budget (100 / 150 / 200 / 250 deci):
 *
 *   Bronze   damage 20                  20 × 5                     = 100 ✓
 *   Silver   damage 30                  30 × 5                     = 150 ✓
 *   Gold     damage 25 + shield 7, AoE  floor(125 × 33/25) + 35
 *                                       = 165 + 35                 = 200 ✓
 *   Diamond  damage 25 + shield 17, AoE floor(125 × 33/25) + 85
 *                                       = 165 + 85                 = 250 ✓
 *
 * EXACTNESS IS AVAILABLE TO AN AUTHOR because the author picks the magnitudes:
 * the reach multiplier is exact whenever the raw offensive share is a multiple
 * of `PRICE.aoeTargetsDen` (25), and the SUPPORT half of a kit is never
 * multiplied, so it closes whatever remains. This is the property
 * `autoScaleTier` cannot reach — it may only move ONE sink, whose 6/7-deci
 * floored steps usually straddle the budget, so it deliberately lands UNDER
 * (see `cards.ts`). Authoring is the exact path; the auto-scaler is the
 * approximate one.
 */
const CLEAVE: SkillDef = {
  id: 'test_cleave',
  name: 'Cleave',
  archetypes: ['offense'],
  property: 'physical',
  weapon: 'axe',
  size: 1,
  rarity: 'common',
  tier: 'bronze',
  effects: [{ kind: 'damage', power: 20 }],
  text: 'Deal 20 damage.',
  tierUpgrades: {
    silver: { effects: [{ kind: 'damage', power: 30 }], text: 'Deal 30 damage.' },
    gold: {
      scope: 'all',
      effects: [{ kind: 'damage', power: 25 }, { kind: 'shield', power: 7 }],
      text: 'Deal 25 damage to ALL foes. Gain 7 shield.',
    },
    diamond: {
      scope: 'all',
      effects: [{ kind: 'damage', power: 25 }, { kind: 'shield', power: 17 }],
      text: 'Deal 25 damage to ALL foes. Gain 17 shield.',
    },
  },
};

/** The same kit authored as a card-level AoE — the pricing reference. */
const CARD_LEVEL_GOLD: SkillDef = {
  ...CLEAVE,
  id: 'test_cleave_flat',
  tier: 'gold',
  scope: 'all',
  effects: [{ kind: 'damage', power: 25 }, { kind: 'shield', power: 7 }],
  tierUpgrades: undefined,
  text: 'Deal 25 damage to ALL foes. Gain 7 shield.',
};

describe('TierUpgrade.scope — resolution', () => {
  it('a Gold tier block setting scope: "all" resolves to an AoE card at Gold only', () => {
    expect(applyTier(CLEAVE, 'bronze').scope).toBeUndefined();
    expect(applyTier(CLEAVE, 'silver').scope).toBeUndefined();
    expect(applyTier(CLEAVE, 'gold').scope).toBe('all');
    expect(applyTier(CLEAVE, 'diamond').scope).toBe('all');
  });

  it('a tier block that does NOT mention scope leaves the base scope untouched (byte-identical)', () => {
    // Silver overrides effects + text only: every other field, `scope` included,
    // carries over from the base def exactly as before this field existed.
    const silver = applyTier(CLEAVE, 'silver');
    expect(Object.prototype.hasOwnProperty.call(silver, 'scope')).toBe(false);
    // ...and every OTHER shipped card (none of the five deliberate AoE tier
    // gates authored 2026-08-18 — see tests/engine/tierUpgrades.test.ts'
    // "AoE TIER GATE" block) never grows a scope at any tier: a card whose
    // own `tierUpgrades` never sets `scope` must resolve to its base scope
    // at every tier, exactly as before this field existed.
    const tiers: SkillTier[] = ['silver', 'gold', 'diamond'];
    for (const skill of Object.values(skillBook)) {
      const everAuthorsScope = Object.values(skill.tierUpgrades ?? {}).some((up) => up?.scope !== undefined);
      if (everAuthorsScope) continue;
      for (const tier of tiers) {
        expect(applyTier(skill, tier).scope, `${skill.id}@${tier}`).toBe(skill.scope);
      }
    }
  });
});

describe('TierUpgrade.scope — pricing', () => {
  it('the AoE reach multiplier is charged at the tier the block applies to, and not below it', () => {
    const goldParts = powerLevelBreakdown(applyTier(CLEAVE, 'gold')).map((p) => p.label);
    expect(goldParts).toContain('aoe reach');
    const silverParts = powerLevelBreakdown(applyTier(CLEAVE, 'silver')).map((p) => p.label);
    expect(silverParts).not.toContain('aoe reach');
    // A tier-block scope prices IDENTICALLY to the same kit authored at card level.
    expect(powerLevelDeci(applyTier(CLEAVE, 'gold'))).toBe(powerLevelDeci(CARD_LEVEL_GOLD));
  });

  it('WORKED EXAMPLE: an authored AoE tier block lands EXACTLY on budget at every tier', () => {
    const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
    for (const tier of tiers) {
      const scaled = applyTier(CLEAVE, tier);
      expect(powerLevelDeci(scaled), `${tier}`).toBe(TIER_BUDGET_DECI[tier]);
      expect(capViolations(scaled), `${tier}`).toEqual([]);
    }
    // The Gold split, spelled out: 165 offensive (125 raw × 33/25, exact — no
    // floor loss) + 35 unmultiplied support = 200 = the Gold budget.
    expect(powerLevelBreakdown(applyTier(CLEAVE, 'gold'))).toEqual([
      { label: 'damage', deci: 125 },
      { label: 'shield', deci: 35 },
      { label: 'aoe reach', deci: 40 },
    ]);
  });

  it('a purely OFFENSIVE authored AoE kit can also land exactly (the multiplier is not an obstacle)', () => {
    // damage 35 + debuffStat 5% for 3 turns = 175 + 15 = 190 raw;
    // floor(190 × 33/25) = floor(250.8) = 250 = the Diamond budget.
    const allOffense: SkillDef = {
      ...CLEAVE,
      id: 'test_cleave_offense',
      tier: 'diamond',
      scope: 'all',
      tierUpgrades: undefined,
      effects: [
        { kind: 'damage', power: 35 },
        { kind: 'debuffStat', stat: 'attack', pct: 5, turns: 3 },
      ],
    };
    expect(powerLevelDeci(allOffense)).toBe(TIER_BUDGET_DECI.diamond);
  });
});

describe('TierUpgrade.scope — targeting through the sim', () => {
  const BOOK: SkillBook = { test_cleave: CLEAVE };

  function run(tier: SkillTier | undefined): ReturnType<typeof simulate> {
    const hero: CombatantSetup = tc(
      'hero',
      ['test_cleave'],
      { speed: 40, attack: 10, maxHp: 500 },
      { skillBook: BOOK, pieces: [{ skillId: 'test_cleave', slot: 0, ...(tier ? { tier } : {}) }] },
    );
    const foes: CombatantSetup[] = ['a', 'b', 'c'].map((n) =>
      tc(n, ['test_cleave'], { speed: 1, attack: 1, maxHp: 400 }, { skillBook: BOOK }));
    const config: CombatConfig = {
      playerTeam: [hero],
      enemyTeam: foes,
      skillBook: BOOK,
      ...NO_ENDGAME,
      cooldownsEnabled: false,
    };
    return simulate(config, 1);
  }

  /** Damage events emitted on the turn of the player's first cast. */
  function firstCastDamage(events: ReturnType<typeof simulate>['events']): Array<{ unit: number }> {
    const cast = events.find((e) => e.kind === 'play' && e.side === 'player') as { turn: number };
    return events.filter(
      (e) => e.kind === 'damage' && e.turn === cast.turn && e.side === 'enemy',
    ) as unknown as Array<{ unit: number }>;
  }

  it('at Bronze the card hits ONE foe; at Gold the SAME card hits every living foe', () => {
    const bronze = firstCastDamage(run(undefined).events);
    expect(bronze).toHaveLength(1);

    const gold = firstCastDamage(run('gold').events);
    expect(gold.map((d) => d.unit)).toEqual([0, 1, 2]);
  });

  it('the cast event carries the AoE marker at Gold and a single target at Bronze', () => {
    type Cast = { aoe?: boolean; targets?: number[]; targetUnit?: number };
    const goldCast = run('gold').events.find((e) => e.kind === 'play' && e.side === 'player') as unknown as Cast;
    expect(goldCast).toMatchObject({ aoe: true, targets: [0, 1, 2] });

    const bronzeCast = run(undefined).events.find((e) => e.kind === 'play' && e.side === 'player') as unknown as Cast;
    expect(bronzeCast.aoe).toBeUndefined();
    expect(typeof bronzeCast.targetUnit).toBe('number');
  });
});
