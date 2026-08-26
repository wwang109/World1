import { describe, expect, it } from 'vitest';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import {
  auraModsDeci,
  PRICE,
  capViolations,
  cooldownDeviationDeci,
  MAX_COOLDOWN_TURNS,
  powerLevelBreakdown,
  powerLevelDeci,
  TIER_BUDGET_DECI,
} from '../../src/engine/balance';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef, SkillTier } from '../../src/engine/types';
import { tc, NO_ENDGAME } from '../helpers';

/**
 * Cards the budget-honest auto-scaler CANNOT lift to a higher tier's budget:
 * pure control / empower / aura kits with no damage/heal/shield sink (and no
 * DoT line) to absorb the extra PL. Each now has an authored `tierUpgrades`
 * path (see src/data/skills.ts), so this set is EMPTY — every card in the
 * book audits to its tier budget exactly, either via the auto-scaler or an
 * authored override.
 */
const CAP_HITTERS_PENDING = new Set<string>([]);

const ABOVE: Record<SkillTier, SkillTier[]> = {
  bronze: ['silver', 'gold', 'diamond'],
  silver: ['gold', 'diamond'],
  gold: ['diamond'],
  diamond: [],
};

describe('tier-up audit: budget-honest auto-scaler', () => {
  it('every auto-scaled card lands EXACTLY on the target tier budget and stays cap-compliant', () => {
    const offenders: string[] = [];
    for (const skill of Object.values(skillBook)) {
      if (CAP_HITTERS_PENDING.has(skill.id)) continue;
      for (const tier of ABOVE[skill.tier]) {
        const scaled = applyTier(skill, tier);
        const deci = powerLevelDeci(scaled);
        if (deci !== TIER_BUDGET_DECI[tier]) {
          offenders.push(`${skill.id}@${tier}: PL ${deci / 10} (budget ${TIER_BUDGET_DECI[tier] / 10})`);
        }
        for (const v of capViolations(scaled)) offenders.push(`${skill.id}@${tier}: ${v}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('CAP-HIT cards rank up with tier bumped but base kit unchanged (under budget)', () => {
    for (const id of CAP_HITTERS_PENDING) {
      const skill = skillBook[id]!;
      for (const tier of ABOVE[skill.tier]) {
        const scaled = applyTier(skill, tier);
        expect(scaled.tier).toBe(tier);
        expect(scaled.effects).toEqual(skill.effects);
        // still compliant with the (flat) effect caps at the new tier
        expect(capViolations(scaled)).toEqual([]);
      }
    }
  });

  it('the AUTO-scaler never changes a card weight, size, or property', () => {
    // NOTE: this checks `autoScaleTier` directly, not `applyTier` — an
    // AUTHORED `tierUpgrades` entry is explicitly allowed to dial
    // `speedWeight` per tier (e.g. second_wind/renewing_wave/purify sink part
    // of their TRUE-heal re-price into weight); only the fallback auto-scaler
    // is required to leave weight/size/property untouched.
    for (const skill of Object.values(skillBook)) {
      for (const tier of ABOVE[skill.tier]) {
        const scaled = autoScaleTier(skill, tier);
        expect(scaled.size).toBe(skill.size);
        expect(scaled.speedWeight).toBe(skill.speedWeight);
        expect(scaled.property).toBe(skill.property);
      }
    }
  });

  it('a target at or below the base tier is a no-op (same reference)', () => {
    const sword = skillBook.sword_slash!;
    expect(applyTier(sword, 'bronze')).toBe(sword);
  });

  it('an authored tierUpgrades entry overrides the auto-scaler verbatim', () => {
    const base = skillBook.sword_slash!;
    const authored = {
      ...base,
      tierUpgrades: {
        silver: { effects: [{ kind: 'damage' as const, power: 99 }], text: 'authored' },
      },
    };
    const scaled = applyTier(authored, 'silver');
    expect(scaled.tier).toBe('silver');
    expect(scaled.effects).toEqual([{ kind: 'damage', power: 99 }]);
    expect(scaled.text).toBe('authored');
  });

  it('DoT sink cards grow their stacks toward the cap (venom_fang / fireball / rupturing_strike)', () => {
    const stacksAt = (id: string, tier: SkillTier, kind: string): number => {
      const scaled = autoScaleTier(skillBook[id]!, tier);
      const dot = scaled.effects.find((a) => a.kind === kind) as { stacks: number };
      return dot.stacks;
    };
    // venom_fang (poison, size 1): grows to fill remaining budget, capped at 20.
    expect(stacksAt('venom_fang', 'silver', 'poison')).toBe(16);
    expect(stacksAt('venom_fang', 'gold', 'poison')).toBe(20);
    expect(stacksAt('venom_fang', 'diamond', 'poison')).toBe(20);
    // fireball (burn, size 2): cap 300 deci = 30 stacks binds from Silver up.
    expect(stacksAt('fireball', 'silver', 'burn')).toBe(30);
    expect(stacksAt('fireball', 'gold', 'burn')).toBe(30);
    expect(stacksAt('fireball', 'diamond', 'burn')).toBe(30);
    // rupturing_strike (bleed, size 1): 15 → 20 → 20 (cap binds at Gold).
    expect(stacksAt('rupturing_strike', 'silver', 'bleed')).toBe(15);
    expect(stacksAt('rupturing_strike', 'gold', 'bleed')).toBe(20);
    expect(stacksAt('rupturing_strike', 'diamond', 'bleed')).toBe(20);
  });

  it('prism_barrier ranks to exactly its tier budget (was 51 PL at Diamond under the naive scaler)', () => {
    expect(powerLevelDeci(applyTier(skillBook.prism_barrier!, 'diamond'))).toBe(TIER_BUDGET_DECI.diamond);
  });

  it('cleanse SCALES with tier (user-locked 2026-08-17) — a bigger PL budget buys more charges, unlike every other empower/control keyword', () => {
    // `purify` ships with an AUTHORED tierUpgrades block (a TRUE heal bolted on,
    // predating this ruling), so it is probed via `autoScaleTier` directly here —
    // bypassing that override — to show what the generic scaler now derives on
    // its own. (`applyTier(purify, ...)` still returns the authored heal-bolt-on
    // form; the mechanism itself is proven here and by a from-scratch probe card
    // in the balance-designer's verification notes.)
    const chargesAt = (tier: SkillTier): number => {
      const scaled = autoScaleTier(skillBook.purify!, tier);
      const cleanse = scaled.effects.find((a) => a.kind === 'cleanse') as { charges: number };
      return cleanse.charges;
    };
    expect(chargesAt('silver')).toBe(6);
    expect(chargesAt('gold')).toBe(8);
    expect(chargesAt('diamond')).toBe(10);
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      const scaled = autoScaleTier(skillBook.purify!, tier);
      expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
      expect(capViolations(scaled)).toEqual([]);
    }
  });

  it('hand-tuned DoT curves (venom_fang / fireball / rupturing_strike) are locked via authored tierUpgrades', () => {
    const at = (id: string, tier: SkillTier, kind: string): number => {
      const scaled = applyTier(skillBook[id]!, tier);
      const dot = scaled.effects.find((a) => a.kind === kind) as { stacks: number };
      return dot.stacks;
    };
    const damageAt = (id: string, tier: SkillTier): number => {
      const scaled = applyTier(skillBook[id]!, tier);
      const dmg = scaled.effects.find((a) => a.kind === 'damage') as { power: number };
      return dmg.power;
    };

    // venom_fang (poison, size 1, weight 12): moderate stack growth, rest into damage.
    expect(at('venom_fang', 'silver', 'poison')).toBe(7);
    expect(at('venom_fang', 'gold', 'poison')).toBe(8);
    expect(at('venom_fang', 'diamond', 'poison')).toBe(9);
    expect(damageAt('venom_fang', 'silver')).toBe(18);
    expect(damageAt('venom_fang', 'gold')).toBe(26);
    expect(damageAt('venom_fang', 'diamond')).toBe(34);

    // fireball (burn, size 2): moderate burn growth, rest into damage.
    expect(at('fireball', 'silver', 'burn')).toBe(7);
    expect(at('fireball', 'gold', 'burn')).toBe(8);
    expect(at('fireball', 'diamond', 'burn')).toBe(10);
    expect(damageAt('fireball', 'silver')).toBe(50);
    expect(damageAt('fireball', 'gold')).toBe(66);
    expect(damageAt('fireball', 'diamond')).toBe(78);

    // rupturing_strike (bleed, size 1): moderate bleed growth, rest into damage.
    expect(at('rupturing_strike', 'silver', 'bleed')).toBe(7);
    expect(at('rupturing_strike', 'gold', 'bleed')).toBe(8);
    expect(at('rupturing_strike', 'diamond', 'bleed')).toBe(9);
    expect(damageAt('rupturing_strike', 'silver')).toBe(16);
    expect(damageAt('rupturing_strike', 'gold')).toBe(24);
    expect(damageAt('rupturing_strike', 'diamond')).toBe(32);

    // Every authored tier lands exactly on budget and stays cap-compliant.
    for (const id of ['venom_fang', 'fireball', 'rupturing_strike']) {
      const skill = skillBook[id]!;
      for (const tier of ABOVE[skill.tier]) {
        const scaled = applyTier(skill, tier);
        expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled)).toEqual([]);
      }
    }
  });

  /**
   * GOLD/DIAMOND IDENTITY (2026-08-18): tier is not just a bigger number —
   * a rank-up can hand a card a whole ability the lower tier has no access
   * to at all (the `armor_break` precedent, extended here to a deliberate
   * subset spanning both classic cards and all three 2026-08-18 synergy
   * themes). Each assertion below locks BOTH halves of the claim: the new
   * kind is ABSENT below its gate tier and PRESENT (paid for, budget-exact,
   * cap-compliant) at and above it.
   */
  describe('GOLD/DIAMOND IDENTITY: a rank-up can grant an ability the lower tier cannot afford at all', () => {
    const kindsOf = (skill: SkillDef): Set<string> => new Set(skill.effects.map((a) => a.kind));
    /**
     * The BRONZE copy — deliberately `applyTier(base, 'bronze')` and never the raw
     * `base` def (2026-08-26, the Q1 `minTier` migration). Three of the cards below
     * now express their gate as a `minTier` on the ONE definition instead of a
     * `tierUpgrades` restatement, so the raw `effects` list LISTS the higher-tier
     * line while the Bronze copy does not have it (`tierResolved` strips it).
     * Reading the raw list would assert the absence of something that is only ever
     * absent after resolution — the exact distinction this suite is about.
     */
    const bronzeOf = (skill: SkillDef): SkillDef => applyTier(skill, 'bronze');

    it('crippling_strike: `stun` exists ONLY at Gold+ (Bronze/Silver have no lockdown tool at all)', () => {
      const base = skillBook.crippling_strike!;
      expect(kindsOf(bronzeOf(base)).has('stun')).toBe(false);
      expect(kindsOf(applyTier(base, 'silver')).has('stun')).toBe(false);
      for (const tier of ['gold', 'diamond'] as const) {
        const scaled = applyTier(base, tier);
        expect(kindsOf(scaled).has('stun')).toBe(true);
        expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled)).toEqual([]);
      }
    });

    it('static_jolt: `disrupt` exists ONLY at Gold+ (the pure Bronze/Silver zap has no stagger tool)', () => {
      const base = skillBook.static_jolt!;
      expect(kindsOf(bronzeOf(base)).has('disrupt')).toBe(false);
      expect(kindsOf(applyTier(base, 'silver')).has('disrupt')).toBe(false);
      for (const tier of ['gold', 'diamond'] as const) {
        const scaled = applyTier(base, tier);
        expect(kindsOf(scaled).has('disrupt')).toBe(true);
        expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled)).toEqual([]);
      }
    });

    it('bramblewrath: `stun` exists ONLY at Gold+ (Thorn Garden theme)', () => {
      const base = skillBook.bramblewrath!;
      expect(kindsOf(bronzeOf(base)).has('stun')).toBe(false);
      expect(kindsOf(applyTier(base, 'silver')).has('stun')).toBe(false);
      for (const tier of ['gold', 'diamond'] as const) {
        const scaled = applyTier(base, tier);
        expect(kindsOf(scaled).has('stun')).toBe(true);
        expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled)).toEqual([]);
      }
    });

    it('hemorrhage: `expose` exists ONLY at Gold+ (Opened Wound theme)', () => {
      const base = skillBook.hemorrhage!;
      expect(kindsOf(bronzeOf(base)).has('expose')).toBe(false);
      expect(kindsOf(applyTier(base, 'silver')).has('expose')).toBe(false);
      for (const tier of ['gold', 'diamond'] as const) {
        const scaled = applyTier(base, tier);
        expect(kindsOf(scaled).has('expose')).toBe(true);
        expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled)).toEqual([]);
      }
    });

    it('verdant_rebuke: `lifesteal` exists ONLY at Gold+ (The Unbroken theme)', () => {
      const base = skillBook.verdant_rebuke!;
      expect(kindsOf(bronzeOf(base)).has('lifesteal')).toBe(false);
      expect(kindsOf(applyTier(base, 'silver')).has('lifesteal')).toBe(false);
      for (const tier of ['gold', 'diamond'] as const) {
        const scaled = applyTier(base, tier);
        expect(kindsOf(scaled).has('lifesteal')).toBe(true);
        expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled)).toEqual([]);
      }
    });
  });

  /**
   * AoE reach through the PUBLIC tier-up entry point (`applyTier`, not just
   * `autoScaleTier` directly — the FOURTH MIRROR block above already proves
   * the scaler; this proves the dispatcher built on it charges the same
   * way). A card that is `scope: 'all'` from its base tier stays `scope:
   * 'all'` through every rank-up (scope is a base-card field, not a
   * `tierUpgrades` override — see the OPEN note below), and each rank-up's
   * price is STILL charged through the AoE reach multiplier, never at the
   * single-target rate.
   *
   * OPEN (content-designer, 2026-08-18): `TierUpgrade` (src/engine/types.ts)
   * has no `scope` field, so a card cannot be single-target at Bronze/Silver
   * and switch to `scope: 'all'` at Gold/Diamond via an authored tier
   * block — `scope` can only be set once, for the WHOLE card, at every tier.
   * Shipping "AoE as a tier gate" needs that field added (additive,
   * resolver-seam only — `applyTier`'s existing `{ ...def, tier, ...override
   * }` spread already forwards it correctly with zero other code changes);
   * requested from combat-engine-programmer rather than authored here, since
   * `src/engine/types.ts` is outside this pass's file scope.
   */
  it('a `scope: \'all\'` card keeps paying the AoE reach multiplier through every rank-up applyTier performs', () => {
    const aoeBase: SkillDef = {
      id: 'test_aoe_tier_gate', name: 'Test AoE Tier Gate', archetypes: ['offense'],
      property: 'physical', weapon: 'sword', size: 1, rarity: 'common', tier: 'bronze',
      scope: 'all',
      effects: [{ kind: 'damage', power: 15 }],
      text: 'Deal 15 (+ATK) Sword damage to every foe.',
    };
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      const scaled = applyTier(aoeBase, tier);
      expect(scaled.scope).toBe('all');
      const reach = powerLevelBreakdown(scaled).find((p) => p.label === 'aoe reach');
      expect(reach?.deci, `${tier}: the AoE upgrade must be PAID FOR, not free`).toBeGreaterThan(0);
      expect(powerLevelDeci(scaled)).toBeLessThanOrEqual(TIER_BUDGET_DECI[tier]);
      expect(capViolations(scaled)).toEqual([]);
    }
  });

  /**
   * THE THIRD MIRROR (fail-open close, 2026-08-17). `autoScaleTier` used to
   * hand-roll BOTH the cooldown-deviation term AND the aura-mods term a
   * second time, each unclamped/signed independently of `powerLevelDeci`'s
   * own (now-fixed) copies — so clamping `balance.ts` alone would have left
   * this file still spending the unbounded/signed value. NO shipped card
   * (0/74) overrides `cooldownTurns`, so this scenario never exercised the
   * scaler before — these are the fixtures that finally do.
   */
  describe('THE THIRD MIRROR: autoScaleTier reads the SAME shared, clamped functions as powerLevelDeci', () => {
    it('cooldownTurns: 8 (past MAX_COOLDOWN_TURNS) — the base card fails the cooldown-bound audit AND the scaled card derives the SAME sink value the balance.ts breakdown would', () => {
      const base: SkillDef = {
        id: 'test_cooldown_third_mirror', name: 'Test Cooldown Third Mirror',
        archetypes: ['offense'], property: 'physical', weapon: 'sword',
        size: 1, rarity: 'common', tier: 'bronze', cooldownTurns: 8,
        effects: [{ kind: 'damage', power: 1 }],
        text: 'Deal 1 physical damage.',
      };
      // The base (Bronze) card is invalid content on its own: cooldownTurns
      // 8 exceeds MAX_COOLDOWN_TURNS (6) — named at authoring time.
      expect(capViolations(base)).toEqual([`cooldownTurns 8 exceeds the max of ${MAX_COOLDOWN_TURNS}`]);
      // Its own (pre-scale) price already reads the CLAMPED cooldown term.
      // The clamp itself is unchanged by the 2026-08-19 diminishing-refund
      // pass (issue #22) — only the RATE within it moved, from the flat
      // (BASELINE_COOLDOWN - 6) * 100 = -300 to the diminishing walk's total
      // -(50+30+20) = -100 (still nowhere near the unclamped (3-8)*100 = -500).
      expect(powerLevelDeci(base)).toBe(1 * 5 + cooldownDeviationDeci(8));
      expect(cooldownDeviationDeci(8)).toBe(-100);

      // Scaling to Silver: BEFORE the 2026-08-17 clamp fix, autoScaleTier's own
      // hand-rolled cooldownCost used the UNCLAMPED -500, freeing 650 deci of
      // sink budget and deriving `damage: 130` (650/5) — a card that then ALSO
      // blew the size-1 damage cap (650 deci = 65 PL against a 30 PL ceiling).
      // AFTER that fix (flat clamped rate), it derived `damage: 90` (450/5).
      // AFTER the 2026-08-19 diminishing-refund pass, the clamped total itself
      // shrank to -100, so autoScaleTier frees only 250 deci and derives
      // `damage: 50` (250/5) — comfortably under the size-1 damage cap now too.
      const scaled = autoScaleTier(base, 'silver');
      const dmg = scaled.effects.find((a) => a.kind === 'damage') as { power: number };
      expect(dmg.power).toBe(50); // NOT 90 (old flat-rate clamp) nor 130 (pre-clamp, drifted)
      expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI.silver);
      // The 'cooldown' part of the scaled card's OWN balance.ts breakdown
      // agrees EXACTLY with the clamped value autoScaleTier used internally
      // — the two callers can no longer drift apart.
      const cooldownPart = powerLevelBreakdown(scaled).find((p) => p.label === 'cooldown');
      expect(cooldownPart?.deci).toBe(cooldownDeviationDeci(8));
      // Still invalid content (cooldownTurns is FROZEN across tiers, by
      // design) — the scaled card still names the same violation.
      expect(capViolations(scaled)).toContain(`cooldownTurns 8 exceeds the max of ${MAX_COOLDOWN_TURNS}`);
    });

    it('a self-hosted negative aura mod: autoScaleTier\'s frozen auraCost matches the SAME auraModsDeci powerLevelDeci reads', () => {
      const base: SkillDef = {
        id: 'test_aura_third_mirror', name: 'Test Aura Third Mirror',
        archetypes: ['offense'], property: 'physical', weapon: 'sword',
        size: 1, rarity: 'common', tier: 'bronze',
        effects: [{ kind: 'damage', power: 1 }],
        aura: { affects: 'adjacent', reach: 0, mods: { damageFlat: -4 } },
        text: 'Deal 1 physical damage. Passive: adjacent cards -4 damage.',
      };
      const scaled = autoScaleTier(base, 'silver');
      const auraPart = powerLevelBreakdown(scaled).find((p) => p.label === 'aura');
      // reach 1 (adjacent, not allBoard) * auraModsDeci(|{-4}|) — priced by
      // magnitude, so this is POSITIVE cost, not a refund.
      expect(auraPart?.deci).toBe(auraModsDeci(base.aura!.mods));
      expect(auraPart?.deci).toBeGreaterThan(0);
      expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI.silver);
      expect(capViolations(scaled)).toEqual([]);
    });
  });
});

describe('the FOURTH mirror, closed: the tier scaler prices through powerLevelDeci, `scope` and all', () => {
  /**
   * `autoScaleTier` used to re-derive its own frozen bucket, and its
   * `actionsPriceDeci` calls passed NO `scope` while `powerLevelDeci` prices the
   * offensive share of a `scope: 'all'` card at the AoE reach multiplier
   * (`PRICE.aoeTargetsNum/Den` = 1.32). The solver therefore solved
   * single-target and shipped a card priced 32% OVER budget at every tier
   * (a size-1 `damage 30` probe: silver 198/150, gold 264/200, diamond
   * 330/250 — the last also blowing the size-1 damage cap). The multi-hit
   * premium was hand-rolled at the raw rate for the same reason.
   *
   * Latent only because no shipped card sets `scope` yet — which is exactly
   * what the AoE pricing work exists to enable.
   */
  const ABOVE_BRONZE: SkillTier[] = ['silver', 'gold', 'diamond'];

  const probe = (over: Partial<SkillDef>): SkillDef => ({
    id: 'probe', name: 'Probe', archetypes: ['offense'], property: 'physical', weapon: 'sword',
    size: 1, rarity: 'common', tier: 'bronze',
    effects: [{ kind: 'damage', power: 30 }],
    text: 'Deal 30 damage.',
    ...over,
  });

  const AOE_PROBES: Array<[string, SkillDef]> = [
    ['plain damage', probe({ scope: 'all' })],
    ['damage + expose rider', probe({
      scope: 'all',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'expose', pct: 30, turns: 2 }],
    })],
    ['two hits (multi-hit premium)', probe({
      scope: 'all',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'damage', power: 10 }],
    })],
    ['damage + poison line', probe({
      scope: 'all',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'poison', stacks: 2 }],
    })],
  ];

  it('an auto-scaled AoE card is NEVER over its tier budget, and never breaks a cap', () => {
    for (const [label, base] of AOE_PROBES) {
      for (const tier of ABOVE_BRONZE) {
        const scaled = autoScaleTier(base, tier);
        const deci = powerLevelDeci(scaled);
        expect(deci, `${label}@${tier}: ${deci / 10} PL over the ${TIER_BUDGET_DECI[tier] / 10} PL budget`)
          .toBeLessThanOrEqual(TIER_BUDGET_DECI[tier]);
        expect(capViolations(scaled), `${label}@${tier}`).toEqual([]);
      }
    }
  });

  it('it lands EXACTLY on budget wherever the floored reach multiplier admits it', () => {
    // 1.32 x an integer offensive total lands on a budget only sometimes: a
    // size-1 physical damage sink steps 6 or 7 deci per point, so the size-1
    // `damage` probe hits Diamond exactly (38 power -> floor(190 x 1.32) = 250)
    // and falls one step short at Silver (145/150) and Gold (198/200).
    const scaled = autoScaleTier(probe({ scope: 'all' }), 'diamond');
    expect(powerLevelDeci(scaled)).toBe(TIER_BUDGET_DECI.diamond);
    expect(scaled.effects[0]).toMatchObject({ kind: 'damage', power: 38 });
  });

  it('where exactness is unreachable, the shortfall is under ONE more point of the sink (maximal spend, never over)', () => {
    for (const [label, base] of AOE_PROBES) {
      for (const tier of ABOVE_BRONZE) {
        const scaled = autoScaleTier(base, tier);
        const sinkIndex = scaled.effects.findIndex((a) => a.kind === 'damage');
        const oneMore = {
          ...scaled,
          effects: scaled.effects.map((a, i) => (i === sinkIndex ? { ...a, power: (a as { power: number }).power + 1 } : a)),
        };
        expect(powerLevelDeci(oneMore), `${label}@${tier}: one more point still fits — the solve stopped early`)
          .toBeGreaterThan(TIER_BUDGET_DECI[tier]);
      }
    }
  });

  it('the single-target twin of every probe still lands EXACTLY on budget (linear pricing, unchanged rule)', () => {
    for (const [label, base] of AOE_PROBES) {
      const single: SkillDef = { ...base, scope: undefined };
      for (const tier of ABOVE_BRONZE) {
        const scaled = autoScaleTier(single, tier);
        expect(powerLevelDeci(scaled), `${label}@${tier}`).toBe(TIER_BUDGET_DECI[tier]);
      }
    }
  });

  it('the multi-hit premium is charged through the SAME function powerLevelDeci uses (no hand-rolled copy)', () => {
    // Two hits under AoE reach: the premium pays the multiplier too (it is an
    // offensive cost). The hand-rolled term charged it raw, leaving the solver
    // with budget powerLevelDeci then took back at 1.32.
    const twoHits = probe({ scope: 'all', effects: [{ kind: 'damage', power: 10 }, { kind: 'damage', power: 10 }] });
    const scaled = autoScaleTier(twoHits, 'gold');
    const premium = powerLevelBreakdown(scaled).find((p) => p.label === 'multi-hit');
    expect(premium?.deci).toBe(PRICE.extraHitPremium);
    const reach = powerLevelBreakdown(scaled).find((p) => p.label === 'aoe reach');
    expect(reach?.deci, 'the reach delta must be paid, not left on the table').toBeGreaterThan(0);
    expect(powerLevelDeci(scaled)).toBeLessThanOrEqual(TIER_BUDGET_DECI.gold);
  });
});

/**
 * AOE TIER GATE (2026-08-18, content-designer): a deliberate subset of the
 * book — one per weapon/element flavor, not a book-wide inflation step —
 * where Gold/Diamond buy the ABILITY to hit every foe rather than a bigger
 * number, using `TierUpgrade.scope` (`src/engine/cards.ts`/`types.ts`,
 * commit `51f777e`). Each card is single-target below its gate tier and
 * AoE at and above it; each authored block lands EXACTLY on its tier budget
 * (never under, the way the auto-scaler settles for AoE) and stays
 * cap-compliant. See `src/data/skills.ts` for the worked PL math per card.
 */
describe('AOE TIER GATE: a rank-up can widen a card\'s scope, not just its numbers', () => {
  const AOE_GATED_CARDS = ['sword_slash', 'crushing_blow', 'shadow_bolt', 'concussive_shot', 'chain_spark'];

  it.each(AOE_GATED_CARDS)('%s: single-target below Gold, `scope: "all"` AND exact-on-budget from Gold up', (id) => {
    const base = skillBook[id]!;
    expect(base.scope, `${id}: base card must ship single-target`).toBeUndefined();
    expect(applyTier(base, 'silver').scope, `${id}@silver`).toBeUndefined();
    for (const tier of ['gold', 'diamond'] as const) {
      const scaled = applyTier(base, tier);
      expect(scaled.scope, `${id}@${tier}`).toBe('all');
      expect(powerLevelDeci(scaled), `${id}@${tier}`).toBe(TIER_BUDGET_DECI[tier]);
      expect(capViolations(scaled), `${id}@${tier}`).toEqual([]);
      // The AoE reach multiplier must actually be PAID for, not free — a
      // scope flip with no priced delta would mean the upgrade was a gift.
      const reach = powerLevelBreakdown(scaled).find((p) => p.label === 'aoe reach');
      expect(reach?.deci, `${id}@${tier}: the AoE upgrade must be paid for`).toBeGreaterThan(0);
    }
  });

  it('the sim actually fans a gated card out to every living foe at Gold, and to only one below it', () => {
    const BOOK: SkillBook = { chain_spark: skillBook.chain_spark! };
    const foes: CombatantSetup[] = ['a', 'b', 'c'].map((n) =>
      tc(n, ['chain_spark'], { speed: 1, attack: 1, magicPower: 1, maxHp: 400 }, { skillBook: BOOK }));

    const run = (tier?: SkillTier): ReturnType<typeof simulate> => {
      const hero = tc(
        'hero', ['chain_spark'], { speed: 40, attack: 1, magicPower: 20, maxHp: 500 },
        { skillBook: BOOK, pieces: [{ skillId: 'chain_spark', slot: 0, ...(tier ? { tier } : {}) }] },
      );
      const config: CombatConfig = { playerTeam: [hero], enemyTeam: foes, skillBook: BOOK, ...NO_ENDGAME, cooldownsEnabled: false };
      return simulate(config, 1);
    };

    const goldCast = run('gold').events.find((e) => e.kind === 'play' && e.side === 'player') as unknown as { aoe?: boolean; targets?: number[] };
    expect(goldCast.aoe).toBe(true);
    expect(goldCast.targets).toEqual([0, 1, 2]);

    const bronzeCast = run(undefined).events.find((e) => e.kind === 'play' && e.side === 'player') as unknown as { aoe?: boolean; targetUnit?: number };
    expect(bronzeCast.aoe).toBeUndefined();
    expect(typeof bronzeCast.targetUnit).toBe('number');
  });

  it('removing `scope` from an authored AoE tier block is exactly the regression the validator exists to catch: the card silently downgrades to single-target and its price is no longer paid for reach', () => {
    const base = skillBook.shadow_bolt!;
    const goldBlock = base.tierUpgrades!.gold!;
    expect(goldBlock.scope, 'precondition: the shipped block sets scope').toBe('all');

    // Strip ONLY `scope` from the authored block — the exact mistake the
    // schema (validateSkillContent's "must be carried by every higher tier"
    // rule) makes unrepresentable at content-load time. Bypassing the
    // validator here (constructing the def directly, not through JSON) is
    // what lets this test prove `applyTier`/`powerLevelDeci` themselves —
    // not just the schema — depend on `scope` being present.
    const stripped: SkillDef = {
      ...base,
      tierUpgrades: { ...base.tierUpgrades, gold: { ...goldBlock, scope: undefined } },
    };
    const scaled = applyTier(stripped, 'gold');
    expect(scaled.scope, 'without `scope` the card silently reverts to single-target').toBeUndefined();
    const reach = powerLevelBreakdown(scaled).find((p) => p.label === 'aoe reach');
    expect(reach, 'without `scope` no reach multiplier is charged at all').toBeUndefined();
    // Same effects, cheaper without the reach multiplier — proves the
    // multiplier (not just the targeting) is gated on this one field.
    expect(powerLevelDeci(scaled)).toBeLessThan(TIER_BUDGET_DECI.gold);
  });
});
