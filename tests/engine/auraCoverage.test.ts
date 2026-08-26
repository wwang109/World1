import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { auraCovers, type Footprint } from '../../src/engine/combat/auras';
import { PRICE, auraModsDeci, powerLevelBreakdown } from '../../src/engine/balance';
import { applyTier } from '../../src/engine/cards';
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';
import { TIER_ORDER } from '../../src/engine/types';
import type { AuraDef, SkillDef } from '../../src/engine/types';

/**
 * AN AURA MAY NOT BUY MORE COVERAGE THAN ITS RATE IS CALIBRATED FOR.
 *
 * THE HOLE THIS CLOSES (found while authoring the Q2 positional pass,
 * 2026-08-26). `powerLevelDeci` prices an aura as
 * `auraModsDeci(mods) * (affects === 'allBoard' ? 2 : 1)` — it NEVER READS
 * `AuraDef.reach`. And `PRICE.auraDamageFlat`'s own doc comment states where its
 * number comes from: "flat auras cost 2x a card's own one-shot flat damage:
 * empirically the break-even where the best adjacent placement (2 CASTING
 * NEIGHBORS) is PL-fair". So the rate is calibrated at a coverage of TWO pieces.
 *
 * That leaves `reach` as a FREE POWER DIAL for one shape: `adjacent` at
 * `reach: 2` reaches up to two pieces on EACH side — four — at the price of two.
 * A one-sided `left`/`right` at `reach: 2` reaches at most two in total, so it is
 * priced exactly at its calibration; `left`/`right` at `reach: 1` reaches one and
 * is deliberately OVER-priced (the safe direction).
 *
 * SO THIS IS A CONTENT RULE, NOT A CODE CHANGE. Widening the vocabulary — an
 * `adjacent` aura that really does project two slots each way — needs a reach
 * term in `PRICE`, which is balance-designer's call (`docs/run-structure-patterns.md`
 * Q2 splits exactly this off as "ADOPT LATER"). Until then the rule is: no shipped
 * aura may cover more than 2 pieces at the non-`allBoard` rate. `allBoard` is the
 * one shape that already pays its own multiplier and is exempt.
 *
 * COVERAGE IS MEASURED, NOT ASSUMED — walked over the real 10-slot hero board
 * with the real `auraCovers`, so the bound is whatever the resolver actually
 * reaches rather than whatever this file believes about `reach`.
 */

/** The most size-1 pieces this aura can reach on a real hero board. */
function maxCoverage(aura: AuraDef, sourceSize: number): number {
  const reach = aura.reach ?? 1;
  let best = 0;
  for (let sourceSlot = 0; sourceSlot + sourceSize <= HERO_BOARD_SLOTS; sourceSlot += 1) {
    const source: Footprint = { slot: sourceSlot, size: sourceSize };
    let covered = 0;
    for (let slot = 0; slot < HERO_BOARD_SLOTS; slot += 1) {
      // Every OTHER slot on the board, as a size-1 piece — the densest packing,
      // and therefore the ceiling on how many pieces this aura can ever touch.
      if (slot >= sourceSlot && slot < sourceSlot + sourceSize) continue;
      if (auraCovers(source, { slot, size: 1 }, aura.affects, reach)) covered += 1;
    }
    if (covered > best) best = covered;
  }
  return best;
}

/** The coverage `PRICE.auraDamageFlat` and its siblings are derived at. */
const CALIBRATED_COVERAGE = 2;

const WITH_AURAS: { card: SkillDef; tier: string; aura: AuraDef }[] = [];
for (const card of Object.values(skillBook)) {
  for (const tier of TIER_ORDER) {
    const aura = applyTier(card, tier).aura;
    if (aura) WITH_AURAS.push({ card, tier, aura });
  }
}

describe('aura coverage never exceeds what the aura rate is calibrated for', () => {
  it('there are auras to audit, and the rate really is blind to `reach`', () => {
    expect(WITH_AURAS.length, 'no card carries an aura').toBeGreaterThan(0);
    // THE NON-VACUITY THAT MATTERS: prove the pricer ignores `reach`, so the rule
    // below is guarding a real hole rather than restating something code enforces.
    const probe: SkillDef = {
      id: 'reach_price_probe', name: 'Reach Price Probe', archetypes: ['support'],
      property: 'physical', weapon: 'sword', size: 1, rarity: 'common', tier: 'bronze',
      effects: [], aura: { affects: 'adjacent', reach: 1, mods: { damageFlat: 5 } },
      text: 'Passive: adjacent cards deal +5 damage.',
    };
    const wide: SkillDef = { ...probe, aura: { ...probe.aura!, reach: 4 } };
    const auraPart = (s: SkillDef): number => powerLevelBreakdown(s).find((p) => p.label === 'aura')!.deci;
    expect(auraPart(probe), 'the aura rate is |mod| x rate x reachMultiplier').toBe(auraModsDeci(probe.aura!.mods) * 1);
    expect(auraPart(wide), 'reach 4 costs the same as reach 1 — the hole this rule guards').toBe(auraPart(probe));
    // ...and reach 4 really does cover more, or there would be nothing to guard.
    expect(maxCoverage(wide.aura!, 1)).toBeGreaterThan(maxCoverage(probe.aura!, 1));
    expect(maxCoverage(probe.aura!, 1)).toBe(CALIBRATED_COVERAGE);
  });

  it('every shipped aura, at every tier, covers at most 2 pieces — or is `allBoard` and pays the 2x reach multiplier', () => {
    const over: string[] = [];
    for (const { card, tier, aura } of WITH_AURAS) {
      if (aura.affects === 'allBoard') continue; // pays PRICE's own reach multiplier
      const covered = maxCoverage(aura, card.size);
      if (covered > CALIBRATED_COVERAGE) {
        over.push(`${card.id}@${tier}: ${aura.affects} reach ${aura.reach ?? 1} covers up to ${covered} pieces`);
      }
    }
    expect(
      over,
      'an aura wider than its rate: `powerLevelDeci` does not read `reach`, so this coverage is FREE PL.\n'
      + 'Fix the CARD (one-sided reach, or `allBoard` which pays 2x), never the rate — a reach term in\n'
      + `PRICE is balance-designer's call. Offenders:\n${over.join('\n')}`,
    ).toEqual([]);
  });

  it('and the shapes actually in use exercise direction and gap — not just touching neighbours', () => {
    // The Q2 pass's own claim, asserted rather than described: before it, all six
    // aura cards were `adjacent` or `allBoard` at the default reach of 1, so no
    // shipped card had ever used a DIRECTION or looked ACROSS A GAP.
    const base = Object.values(skillBook).filter((c) => c.aura).map((c) => c.aura!);
    const oneSided = base.filter((a) => a.affects === 'left' || a.affects === 'right');
    const acrossAGap = base.filter((a) => (a.reach ?? 1) > 1);
    expect(oneSided.length, '`left`/`right` has no content — the board has no front and back').toBeGreaterThan(0);
    expect(acrossAGap.length, '`reach` > 1 has no content — one slot away is the same as touching').toBeGreaterThan(0);
    // A gap-reaching aura must genuinely skip a slot, at the real rate.
    for (const aura of acrossAGap) {
      const src: Footprint = { slot: 4, size: 1 };
      const oneAway = auraCovers(src, { slot: 6, size: 1 }, aura.affects, aura.reach ?? 1)
        || auraCovers(src, { slot: 2, size: 1 }, aura.affects, aura.reach ?? 1);
      expect(oneAway, `reach ${aura.reach} reaches nothing across a one-slot gap`).toBe(true);
    }
    // Positional payoffs are not a `support`-only feature any more.
    const roles = new Set(Object.values(skillBook).filter((c) => c.aura).flatMap((c) => c.archetypes));
    expect(roles.size, `every aura card is still one role: ${[...roles].join(', ')}`).toBeGreaterThan(1);
    expect(PRICE.auraDamageFlat, 'the calibration this file quotes').toBe(10);
  });
});
