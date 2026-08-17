import { describe, expect, it } from 'vitest';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import {
  auraModsDeci,
  capViolations,
  cooldownDeviationDeci,
  MAX_COOLDOWN_TURNS,
  powerLevelBreakdown,
  powerLevelDeci,
  TIER_BUDGET_DECI,
} from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import type { SkillDef, SkillTier } from '../../src/engine/types';

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
      // Its own (pre-scale) price already reads the CLAMPED cooldown term —
      // (BASELINE_COOLDOWN - 6) * 100 = -300, not the unclamped (3-8)*100 = -500.
      expect(powerLevelDeci(base)).toBe(1 * 5 + cooldownDeviationDeci(8));
      expect(cooldownDeviationDeci(8)).toBe(-300);

      // Scaling to Silver: BEFORE this fix, autoScaleTier's own hand-rolled
      // cooldownCost used the UNCLAMPED -500, freeing 650 deci of sink budget
      // and deriving `damage: 130` (650/5) — a card that then ALSO blew the
      // size-1 damage cap (650 deci = 65 PL against a 30 PL ceiling). AFTER
      // this fix, autoScaleTier calls the exact same `cooldownDeviationDeci`
      // powerLevelDeci uses, so it frees only 450 deci and derives `damage: 90`.
      const scaled = autoScaleTier(base, 'silver');
      const dmg = scaled.effects.find((a) => a.kind === 'damage') as { power: number };
      expect(dmg.power).toBe(90); // NOT 130 — the pre-fix, drifted value
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
