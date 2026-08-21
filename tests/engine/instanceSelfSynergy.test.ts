import { describe, expect, it } from 'vitest';
import {
  GEM_CANONICAL_PROPERTY,
  PRICE,
  RARITY_PL_DECI,
  actionsPriceDeci,
  gemPowerLevelDeci,
  instancePowerLevelDeci,
  isGemOnBudget,
  isOnBudget,
  powerLevelDeci,
  selfSynergyPremiumDeci,
} from '../../src/engine/balance';
import { resolveEffectiveSkill, splashSuppressionOn } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import type { Action, Gem, Property, SkillDef } from '../../src/engine/types';

/**
 * THE UNION-KIT SELF-SYNERGY DELTA (audit fix, 2026-08-21).
 *
 * The self-synergy forfeit (`selfSynergyPremiumDeci`) charges a conditional
 * rider the FULL always-on rate when its own kit supplies the resource it reads.
 * It used to be asked only ever against ONE SIDE's kit: `powerLevelDeci` asked it
 * of the card's authored effects, `gemPowerLevelDeci` of the gem's own actions,
 * and `instancePowerLevelDeci` merely SUMMED the two. Nothing asked it of the kit
 * `resolveEffectiveSkill` actually plays — the UNION — so a pure-reader card plus
 * a gem that supplies exactly what it reads played a guaranteed self-synergy kit
 * at the conditional discount on both sides.
 *
 * A socketed gem action is indistinguishable in play from an authored line, so it
 * is priced like one: `instancePowerLevelDeci` (the one gem surface that knows the
 * host) now adds the DELTA of self-synergy premiums between the union kit and
 * each side's own. Base card PL and gem band PL are UNMOVED — they price the
 * DEFINITION, and the pairing is an instance, not a definition.
 */

const card = (id: string, effects: Action[], over: Partial<SkillDef> = {}): SkillDef => ({
  id,
  name: id,
  archetypes: ['offense'],
  property: 'physical',
  size: 1,
  speedWeight: 10,
  rarity: 'common',
  tier: 'bronze',
  effects,
  text: '',
  ...over,
});

const effectGem = (id: string, actions: Action[]): Gem => ({
  kind: 'effect', id, rarity: 'common', actions,
});

/**
 * The PRE-FIX instance PL — base card + gem, with only THE SPLASH GATE applied
 * (which `instancePowerLevelDeci` has priced since 2026-08-19). Written out here,
 * against the gate's own exported predicate, so every test below can state its
 * expectation as "the plain sum, PLUS this much" and a passing test can never be
 * confused with the old behavior.
 */
function plainSumDeci(def: SkillDef, gem: Gem): number {
  if (gem.kind !== 'effect' || !gem.actions.some((a) => a.kind === 'splash')) {
    return powerLevelDeci(def) + gemPowerLevelDeci(gem, def);
  }
  const suppressed = splashSuppressionOn(def, gem.actions) !== null;
  let seen = false;
  const actions = gem.actions.filter((a) => {
    if (a.kind !== 'splash') return true;
    if (suppressed || seen) return false;
    seen = true;
    return true;
  });
  return powerLevelDeci(def) + gemPowerLevelDeci({ ...gem, actions }, def);
}

/** The gem actions the effective card would carry — the splash gate, applied. */
function gatedGemActions(def: SkillDef, gem: Gem): Action[] {
  if (gem.kind !== 'effect') return [];
  const suppressed = splashSuppressionOn(def, gem.actions) !== null;
  let seen = false;
  return gem.actions.filter((a) => {
    if (a.kind !== 'splash') return true;
    if (suppressed || seen) return false;
    seen = true;
    return true;
  });
}

/** Total self-synergy premium every action in a kit owes, judged BY that kit. */
function kitPremiumDeci(kit: readonly Action[], property: Property): number {
  let deci = 0;
  for (const action of kit) deci += selfSynergyPremiumDeci(action, kit, property);
  return deci;
}

// ------------------------------------------------------- the audited defects --

describe('the two pairings the audit reproduced now pay the forfeit at the instance level', () => {
  it('deadweight_toll (taxBonus reader) + tremor_sliver (burden supplier) owes 40 deci', () => {
    const def = skillBook.deadweight_toll!;
    const gem = gemBook.tremor_sliver!;
    // The rider reads `tax` on the target; the gem's `burden` is exactly what
    // `resourceSuppliedBy` calls a `tax` on the target. Neither side supplied it
    // alone, so neither side charged anything.
    expect(kitPremiumDeci(def.effects, def.property)).toBe(0);
    expect(kitPremiumDeci(gem.kind === 'effect' ? gem.actions : [], GEM_CANONICAL_PROPERTY)).toBe(0);
    // Full rate on the rider's priced magnitude (cap 16) minus the discount it
    // was charged: 16 × 5 − floor(80/2) = 40.
    const owed = 16 * PRICE.flatPowerPerPoint - Math.floor((16 * PRICE.flatPowerPerPoint) / PRICE.conditionalBonusDen);
    expect(owed).toBe(40);
    expect(plainSumDeci(def, gem)).toBe(120);
    expect(instancePowerLevelDeci(def, { gem })).toBe(120 + owed);
  });

  it('blight_feast (exploit poison) + venom_sliver (poison supplier) owes 30 deci', () => {
    const def = skillBook.blight_feast!;
    const gem = gemBook.venom_sliver!;
    expect(kitPremiumDeci(def.effects, def.property)).toBe(0);
    // MAGICAL card, so the forfeit is charged at the magical flat rate — each
    // side keeps its own property rate, exactly as its base price does.
    const owed = 12 * PRICE.flatPowerPerPoint - Math.floor((12 * PRICE.flatPowerPerPoint) / PRICE.conditionalBonusDen);
    expect(owed).toBe(30);
    expect(plainSumDeci(def, gem)).toBe(120);
    expect(instancePowerLevelDeci(def, { gem })).toBe(120 + owed);
  });

  it('THE DEFINITION PRICES DO NOT MOVE: both cards stay exact on budget, both gems exact on band', () => {
    for (const id of ['deadweight_toll', 'blight_feast']) {
      const def = skillBook[id]!;
      expect(powerLevelDeci(def), id).toBe(100);
      expect(isOnBudget(def), id).toBe(true);
      // The card's own PL is gem-blind, i.e. identical to its no-gem instance PL.
      expect(instancePowerLevelDeci(def, { gem: null }), id).toBe(powerLevelDeci(def));
    }
    for (const id of ['tremor_sliver', 'venom_sliver']) {
      const gem = gemBook[id]!;
      expect(gemPowerLevelDeci(gem), id).toBe(RARITY_PL_DECI[gem.rarity]);
      expect(isGemOnBudget(gem), id).toBe(true);
    }
  });
});

// -------------------------------------------------- the non-triggering cases --

describe('a pairing that supplies no gate prices as the PLAIN SUM', () => {
  it('the resource must MATCH: a burden gem does nothing for a poison exploiter', () => {
    const def = skillBook.blight_feast!; // reads `poison` on the target
    const gem = gemBook.tremor_sliver!; // supplies `tax` on the target
    expect(instancePowerLevelDeci(def, { gem })).toBe(plainSumDeci(def, gem));
  });

  it('the SIDE must match: a target-side poison gem does nothing for a caster-side reader', () => {
    const host = card('caster_reader', [
      { kind: 'stackBonus', status: 'poison', of: 'caster', per: 3, cap: 12 },
      { kind: 'damage', power: 10 },
    ]);
    const gem = effectGem('poison_gem', [{ kind: 'poison', stacks: 3 }]);
    expect(instancePowerLevelDeci(host, { gem })).toBe(plainSumDeci(host, gem));
  });

  it('a card with NO rider at all, and a STAT gem, are both plain sums', () => {
    const plain = skillBook.sword_slash!;
    const effect = gemBook.venom_sliver!;
    expect(instancePowerLevelDeci(plain, { gem: effect })).toBe(plainSumDeci(plain, effect));
    const statGem = Object.values(gemBook).find((g) => g.kind === 'stat')!;
    const reader = skillBook.deadweight_toll!;
    expect(instancePowerLevelDeci(reader, { gem: statGem }))
      .toBe(powerLevelDeci(reader) + gemPowerLevelDeci(statGem, reader));
  });

  it('a kit that ALREADY forfeited on its own side is not charged twice', () => {
    // Host supplies its own tax, so `powerLevelDeci` already charged the full
    // rate; adding a second supplier changes nothing.
    const host = card('self_taxer', [
      { kind: 'taxBonus', per: 4, cap: 16 },
      { kind: 'damage', power: 12 },
      { kind: 'burden', weight: 4 },
    ]);
    expect(kitPremiumDeci(host.effects, host.property)).toBe(40);
    const gem = effectGem('more_tax', [{ kind: 'burden', weight: 4 }]);
    expect(instancePowerLevelDeci(host, { gem })).toBe(plainSumDeci(host, gem));
  });
});

// ------------------------------------------------------- the splash-gate corner --

describe('THE SPLASH-GATE CORNER: the spreader is dropped, but its burden still supplies the tax', () => {
  const taxReader: Action = { kind: 'taxBonus', per: 4, cap: 16 };
  const spreaderGem = effectGem('tremor_like', [{ kind: 'burden', weight: 4 }, { kind: 'splash' }]);
  // What the forfeit costs a cap-16 taxBonus on a physical card, before any
  // AoE/coverage multiplier.
  const forfeit = 16 * PRICE.flatPowerPerPoint - Math.floor((16 * PRICE.flatPowerPerPoint) / PRICE.conditionalBonusDen);

  it('arm (b) hostAlreadySplashes: gem prices at its BARE burden, and the forfeit is still charged in full', () => {
    // The host splashes its own CURSE, so it has a payload of its own and reads
    // the tax — but supplies no tax, so it never forfeited on its own side.
    const host = card('cursing_toll', [
      taxReader,
      { kind: 'curse', amount: 4, turns: 2 },
      { kind: 'splash' },
      { kind: 'damage', power: 12 },
    ]);
    expect(splashSuppressionOn(host, spreaderGem.kind === 'effect' ? spreaderGem.actions : []))
      .toBe('hostAlreadySplashes');
    expect(kitPremiumDeci(host.effects, host.property)).toBe(0);
    // The gate drops ONLY the spreader: the gem's priced payload shrinks to the
    // anchor-only burden (10, not the doubled band price of 20)...
    expect(plainSumDeci(host, spreaderGem)).toBe(powerLevelDeci(host) + 10);
    // ...and the burden it still lands is what supplies the tax, so the host's
    // rider forfeits its discount anyway. Single-target host, and `taxBonus` is
    // offensive-but-not-card-targeting, so no multiplier touches the forfeit.
    expect(instancePowerLevelDeci(host, { gem: spreaderGem }))
      .toBe(powerLevelDeci(host) + 10 + forfeit);
  });

  it('arm (a) multiTarget: same rule, and the forfeit rides the host’s AoE multiplier like its base price', () => {
    const host = card('aoe_toll', [taxReader, { kind: 'damage', power: 12 }], { scope: 'all' });
    expect(splashSuppressionOn(host, spreaderGem.kind === 'effect' ? spreaderGem.actions : []))
      .toBe('multiTarget');
    // The forfeit is part of the host's OFFENSIVE share, so it pays the same
    // `aoeTargets` multiplier the rider's discounted price paid — stated as the
    // difference of two AoE totals, never as a separately-floored number.
    const aoe = (deci: number): number => Math.floor((deci * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen);
    const withForfeit = aoe(actionsPriceDeci(host.effects, host.property) + forfeit);
    const withoutForfeit = aoe(actionsPriceDeci(host.effects, host.property));
    expect(withForfeit).toBeGreaterThan(withoutForfeit);
    expect(instancePowerLevelDeci(host, { gem: spreaderGem }))
      .toBe(plainSumDeci(host, spreaderGem) + (withForfeit - withoutForfeit));
  });

  it('arm (c) nothingToSpread drops a BARE spreader, which supplied nothing anyway', () => {
    const host = card('plain_toll', [taxReader, { kind: 'damage', power: 12 }]);
    const bare = effectGem('bare_splash', [{ kind: 'splash' }]);
    expect(splashSuppressionOn(host, bare.kind === 'effect' ? bare.actions : [])).toBe('nothingToSpread');
    // `splash` is on no `resourceSuppliedBy` branch, so no forfeit is owed and
    // the instance is the plain sum.
    expect(instancePowerLevelDeci(host, { gem: bare })).toBe(plainSumDeci(host, bare));
  });

  it('an UNSUPPRESSED spreader gem pays its band price AND triggers the forfeit', () => {
    const host = card('plain_toll', [taxReader, { kind: 'damage', power: 12 }]);
    expect(splashSuppressionOn(host, spreaderGem.kind === 'effect' ? spreaderGem.actions : [])).toBeNull();
    expect(plainSumDeci(host, spreaderGem)).toBe(powerLevelDeci(host) + 20); // burden 10 × 2 band
    expect(instancePowerLevelDeci(host, { gem: spreaderGem }))
      .toBe(powerLevelDeci(host) + 20 + forfeit);
  });
});

// ---------------------------------------------------------- the drift guards --

describe('the union kit the pricer builds matches the kit the RESOLVER plays', () => {
  /**
   * `instancePowerLevelDeci` cannot import `resolveEffectiveSkill` (cards.ts is
   * downstream of balance.ts), so it builds its union as `[...host, ...gem]` and
   * relies on `selfSynergyPremiumDeci` asking a pure MEMBERSHIP question — the
   * real splice interleaves `GEM_ACTION_PHASE`'s pre/post blocks around the
   * host's effects, and the premium cannot tell the difference. This sweep pins
   * that claim across the whole shipped catalog, the same way
   * `tests/engine/splash.test.ts` pins `hostSuppressesSplash` against
   * `splashSuppressionOn`.
   */
  it('every shipped card × gem pairing: the premium total is identical either way', () => {
    const drift: string[] = [];
    for (const cardId of Object.keys(skillBook)) {
      const def = skillBook[cardId]!;
      for (const gemId of Object.keys(gemBook)) {
        const gem = gemBook[gemId]!;
        const played = resolveEffectiveSkill(def, { skillId: cardId, slot: 0, gem }).effects;
        const priced = [...def.effects, ...gatedGemActions(def, gem)];
        const a = kitPremiumDeci(played, def.property);
        const b = kitPremiumDeci(priced, def.property);
        if (a !== b) drift.push(`${cardId} + ${gemId}: played ${a} vs priced ${b}`);
      }
    }
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('the instance PL exceeds the plain sum EXACTLY when the played kit supplies a gate neither side did', () => {
    const wrong: string[] = [];
    for (const cardId of Object.keys(skillBook)) {
      const def = skillBook[cardId]!;
      for (const gemId of Object.keys(gemBook)) {
        const gem = gemBook[gemId]!;
        const gated = gatedGemActions(def, gem);
        const union = [...def.effects, ...gated];
        // What the UNION owes, against what the two sides charged on their own.
        const owedByUnion = kitPremiumDeci(union, def.property);
        const chargedBySides = kitPremiumDeci(def.effects, def.property)
          + kitPremiumDeci(gated, def.property);
        const triggered = owedByUnion > chargedBySides;
        const excess = instancePowerLevelDeci(def, { gem }) - plainSumDeci(def, gem);
        if (excess < 0 || (excess > 0) !== triggered) {
          wrong.push(`${cardId} + ${gemId}: excess ${excess}, triggered ${triggered}`);
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('a socket that triggers the forfeit is never REFUSED — it just costs more than its parts', () => {
    const def = skillBook.deadweight_toll!;
    const gem = gemBook.tremor_sliver!;
    const played = resolveEffectiveSkill(def, { skillId: def.id, slot: 0, gem });
    // The gem's actions really are on the effective card (the pairing is legal
    // content, now honestly priced), and the instance costs strictly more than
    // the sum of the two definitions.
    expect(played.effects.some((a) => a.kind === 'burden' && a.fromGem)).toBe(true);
    expect(instancePowerLevelDeci(def, { gem }))
      .toBeGreaterThan(powerLevelDeci(def) + gemPowerLevelDeci(gem, def));
  });
});
