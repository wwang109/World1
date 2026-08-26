import { describe, expect, it } from 'vitest';
import {
  gemPowerLevelDeci,
  instancePowerLevelDeci,
  isGemOnBudget,
  isOnBudget,
  powerLevelDeci,
  RARITY_PL_DECI,
} from '../../src/engine/balance';
import { splashSuppressionOn } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { tierResolved } from '../../src/engine/types';

/**
 * INSTANCE PL IS THE PLAIN SUM (user-locked 2026-08-21, verbatim: "every gem pl
 * is standalone" / "it doesnt make sense to increase cost because of splash and
 * host").
 *
 * A socketed pairing's instance PL is `base card PL + gem PL` — full stop. The
 * union-kit self-synergy delta that briefly charged a cross-kit forfeit here
 * (card supplies what the gem's rider reads, or vice versa) was DELETED by that
 * ruling; the self-synergy forfeit remains a rule about AUTHORED kits only
 * (`selfSynergyPremiumDeci`, judged inside `powerLevelDeci` and
 * `gemPowerLevelDeci` against each side's own effect list).
 *
 * The ONE host-aware adjustment left is THE SPLASH GATE's suppression, which
 * only ever SUBTRACTS: a gem `splash` the resolver would drop
 * (`splashSuppressionOn` — multi-target host, host already splashes, nothing to
 * spread) contributes zero instance PL on that host.
 */
describe('instance PL is the plain sum of the two standalone prices', () => {
  it('a rider card + a resource-supplying gem is base + gem EXACTLY (the pairing that used to owe a premium)', () => {
    // blight_feast reads `poison` on the target (exploit); venom_sliver
    // supplies exactly that. Under the deleted union-kit delta this pairing
    // owed a 30-deci forfeit; under the plain-sum ruling it owes nothing.
    const def = skillBook.blight_feast!;
    const gem = gemBook.venom_sliver!;
    expect(instancePowerLevelDeci(def, { gem })).toBe(powerLevelDeci(def) + gemPowerLevelDeci(gem, def));
    // Same for the tax pairing: deadweight_toll (taxBonus reader) + a gem that
    // supplies a burden. ripple_sliver is splash-only (supplies nothing), so
    // the nearest shipped analog is checked in the catalog sweep below; the
    // definitions stay exact either way.
    expect(powerLevelDeci(def)).toBe(100);
    expect(isOnBudget(def)).toBe(true);
    expect(gemPowerLevelDeci(gem)).toBe(RARITY_PL_DECI[gem.rarity]);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('FULL-CATALOG SWEEP: instance PL <= base + gem for every pairing, equal except gate suppression', () => {
    const wrong: string[] = [];
    for (const cardId of Object.keys(skillBook)) {
      const def = skillBook[cardId]!;
      for (const gemId of Object.keys(gemBook)) {
        const gem = gemBook[gemId]!;
        const instance = instancePowerLevelDeci(def, { gem });
        // THE PLAIN SUM IS TAKEN AGAINST THE TIER-RESOLVED HOST, exactly as
        // `instancePowerLevelDeci` does it (2026-08-26, the Q1 `minTier`
        // migration). The host-aware gem terms — `echoHostShareDeci`'s share of
        // the host's damage line, THE SPLASH GATE's "has the host anything to
        // spread" — read the card AS IT EXISTS at this tier, and a locked line is
        // not part of it. `powerLevelDeci` already resolves internally, so it is
        // only the gem term that has to be handed the resolved def; passing the
        // raw one made an echo price against a Diamond-locked hit the Bronze host
        // does not have.
        const host = tierResolved(def);
        const plainSum = powerLevelDeci(def) + gemPowerLevelDeci(gem, host);
        // NEVER above the plain sum — no pairing premium exists any more.
        if (instance > plainSum) {
          wrong.push(`${cardId} + ${gemId}: instance ${instance} > plain sum ${plainSum}`);
          continue;
        }
        // Below it ONLY when the gate would drop the gem's spreader on this
        // host (the suppression subtracts the splash's contribution).
        const suppressed = gem.kind === 'effect'
          && gem.actions.some((a) => a.kind === 'splash')
          && splashSuppressionOn(host, gem.actions) !== null;
        if ((instance < plainSum) !== suppressed) {
          wrong.push(`${cardId} + ${gemId}: instance ${instance} vs ${plainSum}, suppressed=${String(suppressed)}`);
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('a no-gem piece and a stat-gem piece are plain sums too', () => {
    const def = skillBook.sword_slash!;
    expect(instancePowerLevelDeci(def, { gem: null })).toBe(powerLevelDeci(def));
    const statGem = Object.values(gemBook).find((g) => g.kind === 'stat')!;
    expect(instancePowerLevelDeci(def, { gem: statGem }))
      .toBe(powerLevelDeci(def) + gemPowerLevelDeci(statGem, def));
  });
});
