// RESOURCE-READING BONUS RIDERS — `shieldBurst` and `taxBonus`.
//
// The second half of the conditional-rider family (`tests/engine/conditionalRiders.test.ts`
// covers `exploit`/`stackBonus`, and every convention here is theirs). What is new
// is WHAT is read:
//   • `shieldBurst` reads — and SPENDS — the CASTER's own shield pools, in the
//     fixed order physical → magical → true, up to its required `cap`. It is the
//     one member of the family that resolves on the caster, so it runs once per
//     cast and arms the scalar `cast.bonusFlat` (the `comboBonus` seam).
//   • `taxBonus` reads the VICTIM's TEMPO BACKLOG — every board piece carrying a
//     `splash` weight tax, plus one if the unit itself carries a pending `slow` —
//     and arms per victim, like `exploit`.
//
// THE ORDERING RULING (user-locked 2026-08-21) applies to both, unchanged and
// deliberately without exceptions: a rider reads what is ALREADY THERE, so a card
// can never supply its own gate inside one cast. That is what the validator half
// of this file pins — including the slow case, which is the tempting exception
// (a slow expires at end of turn) and is still ordered like everything else.
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import {
  actionsPriceDeci,
  capViolations,
  EMPOWER_KINDS,
  HIT_KINDS,
  isOnBudget,
  OFFENSIVE_KINDS,
  powerLevelBreakdown,
  powerLevelDeci,
  PRICE,
  resourceSuppliedBy,
  riderReadsResource,
  selfSynergyPremiumDeci,
} from '../../src/engine/balance';
import { applyTier } from '../../src/engine/cards';
import { SHIELD_BURST_POOL_ORDER, spendShieldsForBurst, taxedCardCount } from '../../src/engine/combat/state';
import type { CombatantState } from '../../src/engine/combat/state';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import type { Action, CombatConfig, CombatantSetup, SkillBook, SkillDef, SkillTier } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

// ---------------------------------------------------------------- fixtures --

function card(id: string, effects: Action[], extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id, name: id, archetypes: ['offense'], property: 'physical', weapon: 'sword',
    size: 1, speedWeight: 10, rarity: 'common', tier: 'bronze', cooldownTurns: 0,
    effects, text: '', ...extra,
  };
}

/** Pure spender: no plating of its own, so it can only ever throw someone else's. */
const burster = card('burster', [
  { kind: 'shieldBurst', cap: 12 },
  { kind: 'damage', power: 10 },
]);

/** Two own hits: the bonus must be spent ONCE, on the first of them. */
const twinBurster = card('twinBurster', [
  { kind: 'shieldBurst', cap: 12 },
  { kind: 'damage', power: 10 },
  { kind: 'damage', power: 10 },
]);

/** Self-sufficient: grants the plating it spends, AFTER the hit (the locked order). */
const selfBurster = card('selfBurster', [
  { kind: 'shieldBurst', cap: 12 },
  { kind: 'damage', power: 10 },
  { kind: 'shield', power: 40 },
], { archetypes: ['offense', 'defensive'] });

/** Plating banks: armor/magicResist are 0 on the fixture hero, so power IS the gain. */
const plating = card('plating', [{ kind: 'shield', power: 40 }], { archetypes: ['defensive'] });
const thinPlating = card('thinPlating', [{ kind: 'shield', power: 5 }], { archetypes: ['defensive'] });
const magePlating = card('magePlating', [{ kind: 'shield', power: 5 }], { property: 'magical', element: 'frost', weapon: undefined, archetypes: ['defensive'] });
const truePlating = card('truePlating', [{ kind: 'shield', power: 20 }], { property: 'true', archetypes: ['defensive'] });

/** The reaper: reads the victim's backlog. Pure reader — it taxes nothing itself. */
const reaper = card('reaper', [
  { kind: 'taxBonus', per: 4, cap: 16 },
  { kind: 'damage', power: 10 },
]);
const aoeReaper = card('aoeReaper', [
  { kind: 'taxBonus', per: 4, cap: 16 },
  { kind: 'damage', power: 10 },
], { scope: 'all' });

/** Taxers. `splash` bands the victim's board; `slow` taxes the unit itself. */
const splasher = card('splasher', [{ kind: 'splash', weight: 6 }], { archetypes: ['debuff'] });
const slower = card('slower', [{ kind: 'slow', weight: 6 }], { archetypes: ['debuff'] });
/** Same slow, but it only ever fires ONCE in a short fight (for the expiry test). */
const onceSlower = card('onceSlower', [{ kind: 'slow', weight: 6 }], { archetypes: ['debuff'], cooldownTurns: 9 });
/** Harmless board filler, so a foe can HAVE pieces for a splash to land on. */
const filler = card('filler', [{ kind: 'heal', power: 1 }], { archetypes: ['healing'] });

const book: SkillBook = {
  ...skillBook,
  burster, twinBurster, selfBurster, plating, thinPlating, magePlating, truePlating,
  reaper, aoeReaper, splasher, slower, onceSlower, filler,
};

function hero(skillIds: string[], speed = 20): CombatantSetup {
  return {
    name: 'hero',
    // No stats that could confuse the arithmetic: attack 0 so a hit is exactly its
    // printed power (+ any rider bonus); armor/magicResist 0 so a shield gain is
    // exactly its printed power. Speed 20 at weight 10 = two casts per turn (a
    // test that needs three cards to fire in ONE turn asks for 30).
    stats: { maxHp: 100_000, hp: 100_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed },
    boardSize: 10,
    pieces: skillIds.map((skillId, i) => ({ skillId, slot: i })),
    targetPolicy: 'first',
  };
}

/** A foe that never acts (speed 1 against weight 10) and cannot die. */
function wall(name: string, skillIds: string[] = []): CombatantSetup {
  return {
    name,
    stats: { maxHp: 100_000, hp: 100_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1 },
    boardSize: 10,
    pieces: skillIds.map((skillId, i) => ({ skillId, slot: i })),
  };
}

/** Skill-hit damage per cast (DoT ticks excluded), in cast order. */
function skillCasts(events: readonly CombatEvent[]): { skillId: string; hits: { unit: number; amount: number }[] }[] {
  const casts: { skillId: string; hits: { unit: number; amount: number }[] }[] = [];
  for (const e of events) {
    if (e.kind === 'skillCast' && e.side === 'player') casts.push({ skillId: e.skillId, hits: [] });
    if (e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill' && casts.length > 0) {
      casts[casts.length - 1]!.hits.push({ unit: e.unit, amount: e.amount });
    }
  }
  return casts;
}

function run(skillIds: string[], opts: { enemy?: CombatantSetup[]; maxTurns?: number; speed?: number } = {}) {
  const config: CombatConfig = {
    playerTeam: [hero(skillIds, opts.speed)],
    enemyTeam: opts.enemy ?? [wall('w0')],
    skillBook: book,
    suddenDeathRound: 999,
    fatigueTurn: 999_999,
    attritionTurn: 999_999,
    maxTurns: opts.maxTurns ?? 6,
  };
  const result = simulate(config, 1);
  return { casts: skillCasts(result.events), events: result.events, finalState: result.finalState };
}

const bursts = (events: readonly CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { kind: 'shieldBroken' }> => e.kind === 'shieldBroken');

// -------------------------------------------------------------- shieldBurst --

describe('shieldBurst: shatter your own wall and throw it', () => {
  it('does nothing at all with no plating to spend — and emits no event', () => {
    const { casts, events } = run(['burster']);
    expect(casts.length).toBeGreaterThan(0);
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
    expect(bursts(events)).toEqual([]);
  });

  it('adds exactly what it drains, and the drain is EVENTED on the caster', () => {
    // `plating` (slot 0) banks 40 physical, then `burster` (slot 1) spends 12 of it
    // in the same turn: the hit is 10 + 12 and the wall is 28.
    const { casts, events } = run(['plating', 'burster'], { maxTurns: 1 });
    const first = casts.find((c) => c.skillId === 'burster')!;
    expect(first.hits.map((h) => h.amount)).toEqual([22]);
    const drain = bursts(events);
    expect(drain).toHaveLength(1);
    expect(drain[0]).toMatchObject({ kind: 'shieldBroken', side: 'player', unit: 0, amount: 12, totalAfter: 28, burst: true });
  });

  it('spends the WHOLE wall when the wall is smaller than the cap (never more than it has)', () => {
    const { casts, events } = run(['thinPlating', 'burster'], { maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'burster')!.hits.map((h) => h.amount)).toEqual([15]); // 10 + 5
    expect(bursts(events)[0]).toMatchObject({ amount: 5, totalAfter: 0, burst: true });
  });

  it('drains PHYSICAL → MAGICAL → TRUE, leaving the pool that blocks everything standing', () => {
    // Banks 5 physical + 5 magical + 20 true = 30, then bursts 12: physical and
    // magical are emptied and only 2 comes off the true pool.
    const { casts, events, finalState } = run(['thinPlating', 'magePlating', 'truePlating', 'burster'], { maxTurns: 2 });
    expect(casts.find((c) => c.skillId === 'burster')!.hits.map((h) => h.amount)).toEqual([22]);
    expect(bursts(events)[0]).toMatchObject({ amount: 12, totalAfter: 18, burst: true });
    expect(finalState.player.shields).toEqual({ physical: 0, magical: 0, true: 18 });
  });

  it('is spent ONCE per cast — a two-hit card gets it on the first hit only', () => {
    const { casts } = run(['plating', 'twinBurster'], { maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'twinBurster')!.hits.map((h) => h.amount)).toEqual([22, 10]);
  });
});

describe('THE ORDERING RULING for shieldBurst: the plating must already be there', () => {
  it('a shield+burst card throws NOTHING on its first cast and 12 on its second', () => {
    const { casts } = run(['selfBurster'], { maxTurns: 12 });
    const mine = casts.filter((c) => c.skillId === 'selfBurster');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    // Cast 1: the pools are empty when the rider resolves; its own 40 shield lands
    // after the hit. Cast 2: 12 of that 40 is spent into the hit.
    expect(mine[0]!.hits.map((h) => h.amount)).toEqual([10]);
    expect(mine[1]!.hits.map((h) => h.amount)).toEqual([22]);
  });
});

describe('spendShieldsForBurst (the drain arithmetic)', () => {
  const pools = (physical: number, magical: number, trueP: number): CombatantState =>
    ({ shields: { physical, magical, true: trueP } } as CombatantState);

  it('is a FIXED source order, not object-key order', () => {
    expect(SHIELD_BURST_POOL_ORDER).toEqual(['physical', 'magical', 'true']);
  });

  it('takes one point per point spent, whatever pool pays it (no 2:1 true-shield rule here)', () => {
    // `consumeShields` charges 2 true-shield points to BLOCK one point of typed
    // damage. A burst blocks nothing, so a true point is worth a point.
    const c = pools(0, 0, 10);
    expect(spendShieldsForBurst(c, 6)).toBe(6);
    expect(c.shields).toEqual({ physical: 0, magical: 0, true: 4 });
  });

  it('spends nothing for a 0 cap, and nothing on an empty wall', () => {
    const c = pools(9, 9, 9);
    expect(spendShieldsForBurst(c, 0)).toBe(0);
    expect(c.shields).toEqual({ physical: 9, magical: 9, true: 9 });
    expect(spendShieldsForBurst(pools(0, 0, 0), 50)).toBe(0);
  });
});

// ------------------------------------------------------------------ taxBonus --

describe('taxBonus: damage per weight-taxed card on the target', () => {
  it('does nothing against an untaxed foe', () => {
    const { casts } = run(['reaper'], { enemy: [wall('w0', ['filler', 'filler', 'filler'])] });
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
  });

  it('counts the SPLASH-taxed pieces: two taxed cards, +4 each', () => {
    // The foe's cursor sits on its slot-0 piece, so the band is that piece plus
    // its right neighbour — 2 taxed cards (`splashBand` does not wrap). The
    // splasher fires first (lower slot), the reaper collects in the same turn.
    const { casts } = run(['splasher', 'reaper'], { enemy: [wall('w0', ['filler', 'filler', 'filler'])], maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'reaper')!.hits.map((h) => h.amount)).toEqual([18]); // 10 + 2×4
  });

  it('counts a pending unit-scope SLOW as one more taxed card', () => {
    // Board-less foe: the slow is the only tax there is, so the count is exactly 1.
    const { casts } = run(['slower', 'reaper'], { maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'reaper')!.hits.map((h) => h.amount)).toEqual([14]); // 10 + 1×4
  });

  it('sums both scopes: two splashed pieces PLUS the slow = three taxed cards', () => {
    // Speed 30 so all three cards fire in the SAME turn — which is the whole
    // point: a slow that landed on turn 1 is gone by turn 2, so a reaper that
    // wants to count it has to be the last card of the same turn.
    const { casts } = run(['splasher', 'slower', 'reaper'], {
      enemy: [wall('w0', ['filler', 'filler', 'filler'])],
      maxTurns: 1,
      speed: 30,
    });
    expect(casts.find((c) => c.skillId === 'reaper')!.hits.map((h) => h.amount)).toEqual([22]); // 10 + 3×4
  });

  it('CLAMPS at the cap however deep the backlog goes', () => {
    // per 9 × 2 taxed = 18, capped at 12.
    const capped = card('capped', [
      { kind: 'taxBonus', per: 9, cap: 12 },
      { kind: 'damage', power: 10 },
    ]);
    const config: CombatConfig = {
      playerTeam: [hero(['splasher', 'capped'])],
      enemyTeam: [wall('w0', ['filler', 'filler', 'filler'])],
      skillBook: { ...book, capped },
      suddenDeathRound: 999, fatigueTurn: 999_999, attritionTurn: 999_999, maxTurns: 1,
    };
    const casts = skillCasts(simulate(config, 1).events);
    expect(casts.find((c) => c.skillId === 'capped')!.hits.map((h) => h.amount)).toEqual([22]);
  });

  it('is armed PER VICTIM under scope: all — only the taxed foe pays', () => {
    // `splasher` is single-target and picks foe 0 (targetPolicy 'first'), so on the
    // AoE reap foe 0 carries two taxed pieces and foe 1 carries none.
    const { casts } = run(['splasher', 'aoeReaper'], {
      enemy: [wall('w0', ['filler', 'filler', 'filler']), wall('w1', ['filler', 'filler', 'filler'])],
      maxTurns: 1,
    });
    expect(casts.find((c) => c.skillId === 'aoeReaper')!.hits).toEqual([
      { unit: 0, amount: 18 },
      { unit: 1, amount: 10 },
    ]);
  });

  it('a SLOW is gone next turn, so the reaper collects on it only within the turn it landed', () => {
    // Turn 1: onceSlower then reaper (+4). Turn 2: the slow was dropped at end of
    // turn 1 (user-locked 2026-08-18, `slowLifetime`), the slower is still cooling
    // so nothing re-taxes the board-less foe — and the same reaper adds nothing.
    // THIS is the timing the card face has to teach: tax first, then collect, in
    // the same turn.
    const { casts } = run(['onceSlower', 'reaper'], { maxTurns: 2 });
    const reaps = casts.filter((c) => c.skillId === 'reaper');
    expect(reaps.length).toBeGreaterThanOrEqual(2);
    expect(reaps[0]!.hits.map((h) => h.amount)).toEqual([14]);
    expect(reaps[1]!.hits.map((h) => h.amount)).toEqual([10]);
  });
});

describe('taxedCardCount (what counts as one taxed card)', () => {
  const unit = (penalties: (number | undefined)[], slow: number): CombatantState =>
    ({
      pieces: penalties.map((p, i) => (p === undefined ? { slot: i } : { slot: i, nextWeightPenalty: p })),
      nextWeightPenalty: slow,
    } as CombatantState);

  it('counts pieces with a POSITIVE tax, plus one for a pending slow', () => {
    expect(taxedCardCount(unit([undefined, undefined], 0))).toBe(0);
    expect(taxedCardCount(unit([6, undefined, 6], 0))).toBe(2);
    expect(taxedCardCount(unit([6, undefined, 6], 4))).toBe(3);
    expect(taxedCardCount(unit([], 4))).toBe(1);
  });

  it('a ZERO tax is not a tax (a splash of weight 0 taxes nothing)', () => {
    expect(taxedCardCount(unit([0, 0], 0))).toBe(0);
  });
});

// ------------------------------------------------------------------ pricing --

describe('pricing: the same conditional discount, and the same self-synergy premium', () => {
  const rate = PRICE.flatPowerPerPoint;

  it('both price their CAP at half the flat-damage rate — the exploit/comboBonus rate', () => {
    const burst: Action = { kind: 'shieldBurst', cap: 20 };
    const reap: Action = { kind: 'taxBonus', per: 4, cap: 20 };
    expect(actionsPriceDeci([burst], 'physical')).toBe((20 * rate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([reap], 'physical')).toBe((20 * rate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([burst], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'exploit', status: 'poison', amount: 20 }], 'physical'));
  });

  it('`per` is free on the reaper, because the cap bounds the payload', () => {
    const small: Action = { kind: 'taxBonus', per: 4, cap: 16 };
    const huge: Action = { kind: 'taxBonus', per: 999, cap: 16 };
    expect(actionsPriceDeci([huge], 'physical')).toBe(actionsPriceDeci([small], 'physical'));
    // At per → ∞ the rider degenerates into "+cap if they are taxed at all", i.e.
    // an `exploit` of the same size — and prices identically, the same coherence
    // `stackBonus` is pinned on.
    expect(actionsPriceDeci([huge], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'exploit', status: 'poison', amount: 16 }], 'physical'));
  });

  it('a TRUE card pays the TRUE premium on both — a flat bonus bypasses defense there', () => {
    const trueRate = PRICE.flatPowerPerPoint + PRICE.truePremiumPerPoint;
    expect(actionsPriceDeci([{ kind: 'shieldBurst', cap: 20 }], 'true')).toBe((20 * trueRate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([{ kind: 'taxBonus', per: 4, cap: 20 }], 'true')).toBe((20 * trueRate) / PRICE.conditionalBonusDen);
  });

  it('SELF-SYNERGY forfeits the discount: a kit that supplies the resource pays full rate', () => {
    const burst: Action = { kind: 'shieldBurst', cap: 20 };
    const burstKit: Action[] = [burst, { kind: 'damage', power: 10 }, { kind: 'shield', power: 40 }];
    expect(selfSynergyPremiumDeci(burst, [burst], 'physical')).toBe(0);
    expect(actionsPriceDeci([burst], 'physical', 'one', burstKit)).toBe(20 * rate);

    // BOTH taxes feed a reaper — `slow` (unit scope) and `splash` (card scope) —
    // because `taxedCardCount` counts both and the rider cannot tell them apart.
    const reap: Action = { kind: 'taxBonus', per: 4, cap: 20 };
    for (const tax of [{ kind: 'slow', weight: 6 }, { kind: 'splash', weight: 6 }] as Action[]) {
      const kit: Action[] = [reap, { kind: 'damage', power: 10 }, tax];
      expect(actionsPriceDeci([reap], 'physical', 'one', kit), tax.kind).toBe(20 * rate);
    }
  });

  it('the premium is RESOURCE-aware: a shield line does not feed a reaper, nor a slow a burst', () => {
    const reap: Action = { kind: 'taxBonus', per: 4, cap: 20 };
    expect(selfSynergyPremiumDeci(reap, [reap, { kind: 'shield', power: 40 }], 'physical')).toBe(0);
    const burst: Action = { kind: 'shieldBurst', cap: 20 };
    expect(selfSynergyPremiumDeci(burst, [burst, { kind: 'slow', weight: 6 }], 'physical')).toBe(0);
    // ...and a HEAL is not plating, so it feeds nothing either.
    expect(selfSynergyPremiumDeci(burst, [burst, { kind: 'heal', power: 40 }], 'physical')).toBe(0);
  });

  it('the resource lookups agree with the keywords they describe', () => {
    expect(riderReadsResource({ kind: 'shieldBurst', cap: 20 })).toEqual({ resource: 'shield', on: 'caster', magnitude: 20 });
    expect(riderReadsResource({ kind: 'taxBonus', per: 4, cap: 20 })).toEqual({ resource: 'tax', on: 'target', magnitude: 20 });
    expect(riderReadsResource({ kind: 'damage', power: 10 })).toBeNull();
    expect(resourceSuppliedBy({ kind: 'shield', power: 40 })).toEqual({ resource: 'shield', on: 'caster' });
    expect(resourceSuppliedBy({ kind: 'slow', weight: 6 })).toEqual({ resource: 'tax', on: 'target' });
    expect(resourceSuppliedBy({ kind: 'splash', weight: 6 })).toEqual({ resource: 'tax', on: 'target' });
    expect(resourceSuppliedBy({ kind: 'heal', power: 40 })).toBeNull();
    // The status half still answers through the same door (one definition).
    expect(resourceSuppliedBy({ kind: 'poison', stacks: 3 })).toEqual({ resource: 'poison', on: 'target' });
  });

  it('neither is a damage INSTANCE, and both count against the EMPOWER cap', () => {
    expect(HIT_KINDS.has('shieldBurst')).toBe(false);
    expect(HIT_KINDS.has('taxBonus')).toBe(false);
    expect(EMPOWER_KINDS.has('shieldBurst')).toBe(true);
    expect(EMPOWER_KINDS.has('taxBonus')).toBe(true);
    // 40 points of typed cap = 100 deci = the whole size-1 empower cap; one more
    // point of either must be a violation. (Both riders in one kit share it.)
    expect(capViolations(card('capped', [
      { kind: 'shieldBurst', cap: 24 },
      { kind: 'taxBonus', per: 4, cap: 20 },
      { kind: 'damage', power: 10 },
    ]))).toEqual(['empower 11 PL exceeds the size-1 bronze cap (10 PL)']);
  });

  it('the REAPER is offensive and pays AoE reach; the BURST is not and does not', () => {
    expect(OFFENSIVE_KINDS.has('taxBonus')).toBe(true);
    expect(OFFENSIVE_KINDS.has('shieldBurst')).toBe(false);
    const reap: Action[] = [{ kind: 'taxBonus', per: 4, cap: 20 }];
    expect(actionsPriceDeci(reap, 'physical', 'all'))
      .toBe(Math.floor((50 * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen));
    // The burst's price is scope-invariant — which is exactly why an authored
    // AoE + shieldBurst card is REFUSED rather than priced (see the validator
    // section below).
    const burst: Action[] = [{ kind: 'shieldBurst', cap: 20 }];
    expect(actionsPriceDeci(burst, 'physical', 'all')).toBe(actionsPriceDeci(burst, 'physical', 'one'));
  });

  it('powerLevelBreakdown parts still sum exactly with either rider in play', () => {
    for (const rider of [{ kind: 'shieldBurst', cap: 4 }, { kind: 'taxBonus', per: 2, cap: 4 }] as Action[]) {
      const skill = card('sum', [rider, { kind: 'damage', power: 8 }]);
      const parts = powerLevelBreakdown(skill);
      expect(parts.reduce((s, p) => s + p.deci, 0)).toBe(powerLevelDeci(skill));
      expect(parts.find((p) => p.label === rider.kind)!.deci).toBe(10); // 4 × 2.5
    }
  });
});

describe('the two showcase cards are exactly on budget at all four tiers', () => {
  const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
  for (const id of ['aegis_charge', 'deadweight_toll']) {
    it(`${id}: on budget with no cap violations at every tier`, () => {
      const base = skillBook[id]!;
      for (const tier of tiers) {
        const at = applyTier(base, tier);
        expect(isOnBudget(at), `${id}@${tier} is ${powerLevelDeci(at) / 10} PL`).toBe(true);
        expect(capViolations(at), `${id}@${tier}`).toEqual([]);
      }
    });
  }

  it('aegis_charge grants no plating of its own — it is the PURE spender at the discount', () => {
    const base = skillBook['aegis_charge']!;
    expect(base.effects.some((a) => a.kind === 'shield')).toBe(false);
    const rider = base.effects.find((a) => a.kind === 'shieldBurst')!;
    expect(selfSynergyPremiumDeci(rider, base.effects, base.property)).toBe(0);
  });

  it('deadweight_toll taxes nothing of its own — it reads a backlog the rest of the board built', () => {
    const base = skillBook['deadweight_toll']!;
    expect(base.effects.some((a) => a.kind === 'slow' || a.kind === 'splash')).toBe(false);
    const rider = base.effects.find((a) => a.kind === 'taxBonus')!;
    expect(selfSynergyPremiumDeci(rider, base.effects, base.property)).toBe(0);
  });

  it('the reaper’s `per` grows with tier while its priced CAP keeps the reach at ~4 taxed cards', () => {
    const base = skillBook['deadweight_toll']!;
    for (const tier of tiers) {
      const rider = applyTier(base, tier).effects.find((a) => a.kind === 'taxBonus')!;
      if (rider.kind !== 'taxBonus') throw new Error('expected a taxBonus rider');
      expect(Math.ceil(rider.cap / rider.per), tier).toBe(4);
    }
  });
});

// -------------------------------------------------------------- authoring ---

describe('validateSkillContent enforces the ordering rule for both new riders', () => {
  const doc = (effects: unknown[], extra: Record<string, unknown> = {}): unknown => ({
    schemaVersion: 1,
    cards: [{
      id: 'ordering_probe',
      versions: [{
        version: 1,
        def: {
          name: 'Probe', text: 'x 4 12 16', archetypes: ['offense'], property: 'physical', weapon: 'sword',
          size: 1, rarity: 'common', tier: 'bronze', effects, ...extra,
        },
      }],
    }],
  });
  const problemsOf = (effects: unknown[], extra: Record<string, unknown> = {}): string[] =>
    validateSkillDocument(doc(effects, extra)).map((p) => p.message);

  it('accepts rider → damage → the resource this card supplies', () => {
    expect(problemsOf([
      { kind: 'shieldBurst', cap: 12 },
      { kind: 'damage', power: 12 },
      { kind: 'shield', power: 40 },
    ])).toEqual([]);
    expect(problemsOf([
      { kind: 'taxBonus', per: 4, cap: 16 },
      { kind: 'damage', power: 12 },
      { kind: 'slow', weight: 6 },
      { kind: 'splash', weight: 6 },
    ])).toEqual([]);
  });

  it('rejects either rider placed BEHIND the damage it is supposed to feed', () => {
    expect(problemsOf([
      { kind: 'damage', power: 12 },
      { kind: 'shieldBurst', cap: 12 },
    ]).join(' ')).toContain('must be placed BEFORE a damage action');
    expect(problemsOf([
      { kind: 'damage', power: 12 },
      { kind: 'taxBonus', per: 4, cap: 16 },
    ]).join(' ')).toContain('must be placed BEFORE a damage action');
  });

  it('rejects the self-trigger: this card’s own shield ahead of the burst’s hit', () => {
    expect(problemsOf([
      { kind: 'shieldBurst', cap: 12 },
      { kind: 'shield', power: 40 },
      { kind: 'damage', power: 12 },
    ]).join(' ')).toContain('may never trigger its own condition within one cast');
  });

  it('rejects the self-trigger for BOTH taxes — slow gets no exception for expiring early', () => {
    for (const tax of [{ kind: 'slow', weight: 6 }, { kind: 'splash', weight: 6 }]) {
      expect(problemsOf([
        { kind: 'taxBonus', per: 4, cap: 16 },
        tax,
        { kind: 'damage', power: 12 },
      ]).join(' '), tax.kind).toContain('may never trigger its own condition within one cast');
    }
  });

  it('lets an UNRELATED resource sit before the damage (only the rider’s own is ordered)', () => {
    // A poison ahead of the hit is fine on a burst card, and a shield is fine on a
    // reaper card: neither supplies what the rider reads.
    expect(problemsOf([
      { kind: 'shieldBurst', cap: 12 },
      { kind: 'poison', stacks: 3 },
      { kind: 'damage', power: 12 },
    ])).toEqual([]);
    expect(problemsOf([
      { kind: 'taxBonus', per: 4, cap: 16 },
      { kind: 'shield', power: 40 },
      { kind: 'damage', power: 12 },
    ])).toEqual([]);
  });

  it('refuses AoE + shieldBurst (one wall, spent once, must not hit five foes)', () => {
    expect(problemsOf([
      { kind: 'shieldBurst', cap: 12 },
      { kind: 'damage', power: 12 },
    ], { scope: 'all' }).join(' ')).toContain('scope: all cannot be combined with a shieldBurst action');
    // ...while an AoE reaper is fine: it is armed per victim and pays reach.
    expect(problemsOf([
      { kind: 'taxBonus', per: 4, cap: 16 },
      { kind: 'damage', power: 12 },
    ], { scope: 'all' })).toEqual([]);
    // The splash rule it generalises still fires, with its own message.
    expect(problemsOf([
      { kind: 'damage', power: 12 },
      { kind: 'splash', weight: 6 },
    ], { scope: 'all' }).join(' ')).toContain('scope: all cannot be combined with a splash action');
  });

  it('rejects a missing cap, a zero `per`, and an unknown field', () => {
    const messages = problemsOf([
      { kind: 'shieldBurst' },
      { kind: 'taxBonus', per: 0, cap: 16 },
      { kind: 'damage', power: 12, capp: 3 },
    ]).join(' | ');
    expect(messages).toContain('missing required field cap');
    expect(messages).toContain('per must be an integer 1..999');
    expect(messages).toContain('unknown field capp');
  });
});

describe('no gem carries shieldBurst (it would need the splash gate’s treatment)', () => {
  it('the shipped gem catalog is free of it', async () => {
    const { gemBook } = await import('../../src/data/gems');
    for (const gem of Object.values(gemBook)) {
      if (gem.kind !== 'effect') continue;
      expect(
        gem.actions.some((a) => a.kind === 'shieldBurst'),
        `${gem.id}: a gem shieldBurst is host-blind — on an AoE host it would deliver one spent wall to every foe `
          + 'at a single-target price, the exact hole THE SPLASH GATE (spliceGemActions, engine/cards.ts) exists to '
          + 'close. Extend that gate before authoring one.',
      ).toBe(false);
    }
  });
});
