// THE THIRD RIDER PASS — `wardRelease`, `desperation`, `overhealShield`,
// `cleanseConvert`.
//
// `tests/engine/conditionalRiders.test.ts` (exploit/stackBonus) and
// `tests/engine/resourceRiders.test.ts` (shieldBurst/taxBonus) established every
// convention this file follows; what is new here is the SHAPE of two of the four:
//   • `wardRelease` is `shieldBurst` one currency over — caster-scoped, spends what
//     it reads, arms the scalar `cast.bonusFlat`, refuses authored AoE.
//   • `desperation` is `exploit` with the gate on the CASTER's own HP bar — armed
//     per victim, and the one member whose discount can never be forfeited.
//   • `overhealShield` and `cleanseConvert` are the family's first HEAL-SIDE
//     members. They feed a `heal`, not a `damage`, through their own seams
//     (`CastCtx.overhealShieldCap` / `CastCtx.healBonusFlat`) rather than being
//     bolted onto the damage machinery — and `cleanseConvert` is the first rider
//     whose ordering rule runs the OTHER WAY (cleanse -> rider -> heal).
//
// THE ORDERING RULING (user-locked 2026-08-21) is unchanged for the first three.
// `cleanseConvert` does not contradict it: it still reads something that is already
// there when it runs, that something just happens to be its own cast's earlier
// cleanse result. The validator half of this file pins both arrows of that chain.
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { applyCast, type Ctx } from '../../src/engine/combat/interpreter';
import { NO_MODS } from '../../src/engine/combat/auras';
import { initCombatState, releaseWardCharges, wardChargeCount, type CombatantState, type StatusInstance } from '../../src/engine/combat/state';
import { Rng } from '../../src/engine/rng';
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
  riderFeedsKind,
  riderReadsResource,
  selfSynergyPremiumDeci,
} from '../../src/engine/balance';
import { applyTier } from '../../src/engine/cards';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { MAX_WARD_CHARGES, type Action, type CombatConfig, type CombatantSetup, type SkillBook, type SkillDef, type SkillTier } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';
import { tc, NO_ENDGAME } from '../helpers';

type HealEvent = Extract<CombatEvent, { kind: 'heal' }>;
type ShieldGainEvent = Extract<CombatEvent, { kind: 'shieldGain' }>;
type WardReleasedEvent = Extract<CombatEvent, { kind: 'wardReleased' }>;

// ---------------------------------------------------------------- fixtures --

function card(id: string, effects: Action[], extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id, name: id, archetypes: ['offense'], property: 'physical', weapon: 'sword',
    size: 1, speedWeight: 10, rarity: 'common', tier: 'bronze', cooldownTurns: 0,
    effects, text: '', ...extra,
  };
}

/** Pure spender: banks no ward of its own, so it can only ever cash somebody else's. */
const cashout = card('cashout', [
  { kind: 'wardRelease', per: 6, cap: 12 },
  { kind: 'damage', power: 10 },
]);
/** Two own hits: the bonus must be spent ONCE, on the first of them. */
const twinCashout = card('twinCashout', [
  { kind: 'wardRelease', per: 6, cap: 12 },
  { kind: 'damage', power: 10 },
  { kind: 'damage', power: 10 },
]);
/** Self-sufficient: grants the ward it spends, AFTER the hit (the locked order). */
const selfCashout = card('selfCashout', [
  { kind: 'wardRelease', per: 6, cap: 12 },
  { kind: 'damage', power: 10 },
  { kind: 'ward', charges: 2 },
], { archetypes: ['offense', 'defensive'] });
/** Ward banks. A recast opens a NEW pile, so two casts = two piles. */
const warder = card('warder', [{ kind: 'ward', charges: 2 }], { archetypes: ['defensive'] });
const thinWarder = card('thinWarder', [{ kind: 'ward', charges: 1 }], { archetypes: ['defensive'] });

/** The cornered beast: +20 while the caster is at or below half maxHp. */
const beast = card('beast', [
  { kind: 'desperation', amount: 20 },
  { kind: 'damage', power: 10 },
]);
const aoeBeast = card('aoeBeast', [
  { kind: 'desperation', amount: 20 },
  { kind: 'damage', power: 10 },
], { scope: 'all' });

const book: SkillBook = { ...skillBook, cashout, twinCashout, selfCashout, warder, thinWarder, beast, aoeBeast };

function hero(skillIds: string[], stats: { hp?: number; maxHp?: number; speed?: number } = {}): CombatantSetup {
  return {
    name: 'hero',
    // attack 0 so a hit is exactly its printed power (+ any rider bonus).
    stats: {
      maxHp: stats.maxHp ?? 100_000, hp: stats.hp ?? stats.maxHp ?? 100_000,
      attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: stats.speed ?? 20,
    },
    boardSize: 10,
    pieces: skillIds.map((skillId, i) => ({ skillId, slot: i })),
    targetPolicy: 'first',
  };
}

/** A foe that never acts (speed 1 against weight 10) and cannot die. */
function wall(name: string): CombatantSetup {
  return {
    name,
    stats: { maxHp: 100_000, hp: 100_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 1 },
    boardSize: 10,
    pieces: [],
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

function run(skillIds: string[], opts: { enemy?: CombatantSetup[]; maxTurns?: number; hp?: number; maxHp?: number; speed?: number } = {}) {
  const config: CombatConfig = {
    playerTeam: [hero(skillIds, opts)],
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

const releases = (events: readonly CombatEvent[]) =>
  events.filter((e): e is WardReleasedEvent => e.kind === 'wardReleased');

// ------------------------------------------------------------- wardRelease --

describe('wardRelease: cash in your own charges', () => {
  it('does nothing at all with no charges to spend — and emits no event', () => {
    const { casts, events } = run(['cashout']);
    expect(casts.length).toBeGreaterThan(0);
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
    expect(releases(events)).toEqual([]);
  });

  it('adds per x charges released, and the spend is EVENTED on the caster', () => {
    // `warder` (slot 0) banks 2 charges, then `cashout` (slot 1) needs
    // ceil(12/6) = 2 of them: the hit is 10 + 12 and the pile is empty.
    const { casts, events } = run(['warder', 'cashout'], { maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'cashout')!.hits.map((h) => h.amount)).toEqual([22]);
    const spent = releases(events);
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ kind: 'wardReleased', side: 'player', unit: 0, charges: 2, chargesLeft: 0 });
    // ...and the emptied pile announces its own end, exactly as consumeWard does.
    const expired = events.filter((e) => e.kind === 'statusExpired' && e.status === 'ward');
    expect(expired).toHaveLength(1);
  });

  it('spends the WHOLE pile when the pile is smaller than the cap needs', () => {
    const { casts, events } = run(['thinWarder', 'cashout'], { maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'cashout')!.hits.map((h) => h.amount)).toEqual([16]); // 10 + 1x6
    expect(releases(events)[0]).toMatchObject({ charges: 1, chargesLeft: 0 });
  });

  it('spends ONLY what the cap pays for — never the whole pile for nothing', () => {
    // Three charges banked (MAX_WARD_CHARGES), but ceil(12/6) = 2 is all the cap
    // can pay: the third charge stays, and the ward still protects.
    const { casts, events } = run(['warder', 'thinWarder', 'cashout'], { maxTurns: 1, speed: 30 });
    expect(casts.find((c) => c.skillId === 'cashout')!.hits.map((h) => h.amount)).toEqual([22]);
    expect(releases(events)[0]).toMatchObject({ charges: 2, chargesLeft: 1 });
  });

  it('is spent ONCE per cast — a two-hit card gets it on the first hit only', () => {
    const { casts } = run(['warder', 'twinCashout'], { maxTurns: 1 });
    expect(casts.find((c) => c.skillId === 'twinCashout')!.hits.map((h) => h.amount)).toEqual([22, 10]);
  });
});

describe('THE ORDERING RULING for wardRelease: the charges must already be there', () => {
  it('a ward+release card cashes NOTHING on its first cast and 12 on its second', () => {
    const { casts } = run(['selfCashout'], { maxTurns: 12 });
    const mine = casts.filter((c) => c.skillId === 'selfCashout');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0]!.hits.map((h) => h.amount)).toEqual([10]);
    expect(mine[1]!.hits.map((h) => h.amount)).toEqual([22]);
  });
});

describe('releaseWardCharges (the drain arithmetic)', () => {
  const holder = (...piles: number[]): CombatantState =>
    ({ statuses: piles.map((charges): StatusInstance => ({ kind: 'ward', charges, turnsLeft: 0 })) } as CombatantState);

  it('spends the LOWEST-INDEX pile first, the order consumeWard uses', () => {
    const c = holder(1, 2);
    expect(releaseWardCharges(c, 2)).toEqual({ released: 2, pilesEmptied: 1 });
    // The first pile emptied and was removed; the second lost one of its two.
    expect(c.statuses).toEqual([{ kind: 'ward', charges: 1, turnsLeft: 0 }]);
  });

  it('reports every pile it empties, so the caller can expire each one', () => {
    const c = holder(1, 1, 1);
    expect(releaseWardCharges(c, 3)).toEqual({ released: 3, pilesEmptied: 3 });
    expect(c.statuses).toEqual([]);
  });

  it('spends nothing for a 0 budget, and nothing on an empty holder', () => {
    const c = holder(3);
    expect(releaseWardCharges(c, 0)).toEqual({ released: 0, pilesEmptied: 0 });
    expect(wardChargeCount(c)).toBe(3);
    expect(releaseWardCharges(holder(), 5)).toEqual({ released: 0, pilesEmptied: 0 });
  });

  it('takes no more than the holder has, however big the budget', () => {
    const c = holder(2);
    expect(releaseWardCharges(c, 99)).toEqual({ released: 2, pilesEmptied: 1 });
    expect(wardChargeCount(c)).toBe(0);
  });
});

// ------------------------------------------------------------- desperation --

describe('desperation: bonus damage while YOU are at or below half HP', () => {
  it('does nothing at full HP', () => {
    const { casts } = run(['beast'], { maxHp: 100 });
    expect(casts.length).toBeGreaterThan(0);
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
  });

  it('pays out at EXACTLY half — the boundary is inclusive (hp * 2 <= maxHp)', () => {
    const { casts } = run(['beast'], { maxHp: 100, hp: 50 });
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([30]); // 10 + 20
  });

  it('does NOT pay out one point above half', () => {
    const { casts } = run(['beast'], { maxHp: 100, hp: 51 });
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
  });

  it('an ODD maxHp is handled by the integer form, with no floor to argue about', () => {
    // 50/101: 100 <= 101, so it IS at or below half. 51/101: 102 > 101, so not.
    expect(run(['beast'], { maxHp: 101, hp: 50 }).casts[0]!.hits.map((h) => h.amount)).toEqual([30]);
    expect(run(['beast'], { maxHp: 101, hp: 51 }).casts[0]!.hits.map((h) => h.amount)).toEqual([10]);
  });

  it('FLIPS ON mid-fight the moment the caster crosses half, with no setup', () => {
    // The hero opens at 60/100 and the foe chips it below 50 — the same card's
    // damage changes because the CASTER changed, which is the whole keyword.
    const biter: CombatantSetup = {
      name: 'biter',
      stats: { maxHp: 100_000, hp: 100_000, attack: 12, magicPower: 0, armor: 0, magicResist: 0, speed: 10 },
      boardSize: 10,
      pieces: [{ skillId: 'sword_slash', slot: 0 }],
    };
    const { casts } = run(['beast'], { maxHp: 100, hp: 60, enemy: [biter], maxTurns: 8, speed: 10 });
    const amounts = casts.map((c) => c.hits[0]!.amount);
    // Starts un-triggered, ends triggered, and never goes back (nothing heals).
    expect(amounts[0]).toBe(10);
    expect(amounts[amounts.length - 1]).toBe(30);
    expect(amounts.indexOf(30)).toBe(amounts.lastIndexOf(10) + 1);
  });

  it('is armed PER VICTIM under scope: all — every foe pays, and the card pays reach', () => {
    // The condition is caster-side, so under AoE it holds for all of them at once.
    // That is exactly why the kind is OFFENSIVE: the bonus is delivered once per
    // foe, so an AoE desperation card must pay the reach multiplier for it.
    const { casts } = run(['aoeBeast'], { maxHp: 100, hp: 50, enemy: [wall('w0'), wall('w1')], maxTurns: 1 });
    expect(casts[0]!.hits).toEqual([{ unit: 0, amount: 30 }, { unit: 1, amount: 30 }]);
  });
});

// ---------------------------------------------------- heal-side: the harness --

/**
 * Cast one card from a fresh 1v1 state, directly through the interpreter (pure,
 * no RNG), with exact control over the caster's HP, shields and statuses — the
 * `tests/engine/antiHeal.test.ts` harness, because the two heal-side riders are
 * about numbers at the maxHp/anti-heal boundaries and a scheduled fight cannot
 * pin those.
 */
function castHeal(
  healBook: SkillBook,
  skillId: string,
  setup: { maxHp: number; hp: number; statuses?: StatusInstance[]; shields?: Partial<CombatantState['shields']> },
): { events: CombatEvent[]; hero: CombatantState } {
  const state = initCombatState({
    playerTeam: [tc('hero', [skillId], { maxHp: setup.maxHp, hp: setup.hp, attack: 0, magicPower: 0, armor: 0, magicResist: 0 }, { skillBook: healBook })],
    enemyTeam: [tc('foe', [], { maxHp: 5000, hp: 5000 }, { skillBook: healBook })],
    skillBook: healBook,
    ...NO_ENDGAME,
  });
  state.turn = 1;
  const heroState = state.player;
  for (const s of setup.statuses ?? []) heroState.statuses.push({ ...s });
  if (setup.shields) heroState.shields = { ...heroState.shields, ...setup.shields };
  const ctx: Ctx = { state, rng: new Rng(1), events: [] };
  const piece = heroState.pieces[0]!;
  applyCast(ctx, heroState, piece.skill, piece.slot, NO_MODS, { before: 0, after: 1 });
  return { events: ctx.events, hero: heroState };
}

const healOf = (events: CombatEvent[]) => events.find((e): e is HealEvent => e.kind === 'heal')!;
const gainsOf = (events: CombatEvent[]) => events.filter((e): e is ShieldGainEvent => e.kind === 'shieldGain');

function healCard(id: string, effects: Action[], extra: Partial<SkillDef> = {}): SkillDef {
  return card(id, effects, { archetypes: ['healing'], property: 'magical', weapon: undefined, ...extra });
}

const HEAL_BOOK: SkillBook = {
  // Pure overheal banker: heal 20, up to 12 of the waste becomes plating.
  overflow: healCard('overflow', [{ kind: 'overhealShield', cap: 12 }, { kind: 'heal', power: 20 }]),
  // TRUE variant — the pool that blocks everything, and a heal immune to anti-heal.
  overflowTrue: healCard('overflowTrue', [{ kind: 'overhealShield', cap: 12 }, { kind: 'heal', power: 20 }], { property: 'true' }),
  // Two heal lines: the allowance must be spent by the FIRST one only.
  twinOverflow: healCard('twinOverflow', [
    { kind: 'overhealShield', cap: 12 },
    { kind: 'heal', power: 20 },
    { kind: 'heal', power: 20 },
  ]),
  // The cleanse converter: 3 charges, +5 heal per stack stripped, cap 12, base heal 4.
  penance: healCard('penance', [
    { kind: 'cleanse', charges: 3 },
    { kind: 'cleanseConvert', per: 5, cap: 12 },
    { kind: 'heal', power: 4 },
  ], { archetypes: ['healing', 'support'] }),
  // Same, TRUE: a flat heal that the bonus still joins.
  penanceTrue: healCard('penanceTrue', [
    { kind: 'cleanse', charges: 3 },
    { kind: 'cleanseConvert', per: 5, cap: 12 },
    { kind: 'heal', power: 4 },
  ], { archetypes: ['healing', 'support'], property: 'true' }),
};

const POISON_3: StatusInstance = { kind: 'poison', property: 'physical', stacks: 3, turnsLeft: 3 };
const POISON_1: StatusInstance = { kind: 'poison', property: 'physical', stacks: 1, turnsLeft: 3 };

// ---------------------------------------------------------- overhealShield --

describe('overhealShield: wasted healing becomes plating', () => {
  it('converts NOTHING when the heal all fits — and emits no shieldGain', () => {
    const { events, hero } = castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 50 });
    expect(healOf(events)).toMatchObject({ amount: 20, overheal: 0 });
    expect(gainsOf(events)).toEqual([]);
    expect(hero.shields).toEqual({ physical: 0, magical: 0, true: 0 });
  });

  it('converts exactly the OVERFLOW when the overflow is under the cap', () => {
    // 95/100 healed 20: 5 lands, 15 overflows... capped at 12, so 12 banks.
    const { events, hero } = castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 95 });
    expect(healOf(events)).toMatchObject({ amount: 5, overheal: 15 });
    expect(gainsOf(events)[0]).toMatchObject({ kind: 'shieldGain', property: 'magical', amount: 12, wasted: 0, overheal: true });
    expect(hero.shields).toEqual({ physical: 0, magical: 12, true: 0 });
  });

  it('banks only the overflow when the overflow is SMALLER than the cap', () => {
    // 92/100 healed 20: 8 lands, 12 overflows — exactly the cap. 91/100: 11 banks.
    expect(gainsOf(castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 92 }).events)[0]).toMatchObject({ amount: 12 });
    const nine = castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 91 });
    expect(healOf(nine.events)).toMatchObject({ amount: 9, overheal: 11 });
    expect(gainsOf(nine.events)[0]).toMatchObject({ amount: 11, wasted: 0 });
  });

  it('banks into the CARD\'S OWN property pool — TRUE only on a TRUE card', () => {
    const { hero } = castHeal(HEAL_BOOK, 'overflowTrue', { maxHp: 100, hp: 100 });
    expect(hero.shields).toEqual({ physical: 0, magical: 0, true: 12 });
  });

  it('THE ANTI-HEAL TAX APPLIES FIRST — the taxed heal is the real heal, so there is less to overflow', () => {
    // One affliction category = −20%. Request 20 -> reduced 4 -> heal 16 into a
    // FULL bar, so 16 overflows and 12 (the cap) banks... which is the same as the
    // untaxed case, so the discriminating test is a SMALLER heal:
    const taxed = castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 100, statuses: [POISON_3] });
    expect(taxed.events.find((e) => e.kind === 'heal')).toMatchObject({ amount: 0, overheal: 16, antiHeal: { pct: 20, reduced: 4 } });
    expect(gainsOf(taxed.events)[0]).toMatchObject({ amount: 12 });

    // ...with a cap ABOVE the taxed heal, the tax is visible in the plating: an
    // untaxed 20 banks 20, a −20% taxed 20 banks only 16. The 4 the tax took is
    // NOT laundered into shield.
    const bigCap: SkillBook = {
      ...HEAL_BOOK,
      overflow: healCard('overflow', [{ kind: 'overhealShield', cap: 50 }, { kind: 'heal', power: 20 }]),
    };
    expect(gainsOf(castHeal(bigCap, 'overflow', { maxHp: 100, hp: 100 }).events)[0]).toMatchObject({ amount: 20 });
    expect(gainsOf(castHeal(bigCap, 'overflow', { maxHp: 100, hp: 100, statuses: [POISON_3] }).events)[0]).toMatchObject({ amount: 16 });
  });

  it('a TRUE heal is IRREDUCIBLE, so its overflow is untaxed even under afflictions', () => {
    const { events } = castHeal(HEAL_BOOK, 'overflowTrue', { maxHp: 100, hp: 100, statuses: [POISON_3] });
    expect(healOf(events)).toMatchObject({ amount: 0, overheal: 20, flat: true });
    expect('antiHeal' in healOf(events)).toBe(false);
    expect(gainsOf(events)[0]).toMatchObject({ amount: 12 });
  });

  it('STILL OBEYS THE maxHp SHIELD CEILING, and reports the refused part as wasted', () => {
    // Already holding 95 of a 100 ceiling: only 5 of the 12 conversion fits.
    const { events, hero } = castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 100, shields: { physical: 95 } });
    expect(gainsOf(events)[0]).toMatchObject({ amount: 5, wasted: 7, totalAfter: 100, overheal: true });
    expect(hero.shields).toEqual({ physical: 95, magical: 5, true: 0 });
  });

  it('carries NO calculation block — a conversion has no card base to split', () => {
    // The same asymmetry `lifesteal`'s heal event documents: reporting
    // `power = converted` would claim a card base that does not exist.
    const gain = gainsOf(castHeal(HEAL_BOOK, 'overflow', { maxHp: 100, hp: 100 }).events)[0]!;
    expect('calculation' in gain).toBe(false);
  });

  it('is spent ONCE per cast — a two-heal card converts on the first heal only', () => {
    const { events, hero } = castHeal(HEAL_BOOK, 'twinOverflow', { maxHp: 100, hp: 100 });
    expect(gainsOf(events)).toHaveLength(1);
    expect(gainsOf(events)[0]).toMatchObject({ amount: 12 });
    expect(hero.shields.magical).toBe(12);
  });
});

// ---------------------------------------------------------- cleanseConvert --

describe('cleanseConvert: heal per affliction stack the cleanse actually removed', () => {
  it('converts NOTHING when there was nothing to strip', () => {
    const { events } = castHeal(HEAL_BOOK, 'penance', { maxHp: 100, hp: 10 });
    expect(events.find((e) => e.kind === 'cleansed')).toBeUndefined();
    expect(healOf(events)).toMatchObject({ amount: 4 });
    expect(healOf(events).calculation).toBeDefined();
    expect('bonus' in healOf(events).calculation!).toBe(false);
  });

  it('pays per STACK removed, not per pile — and reports the bonus on the event', () => {
    // 3 poison stacks, 3 cleanse charges: all 3 stripped -> 3 x 5 = 15, capped 12.
    // The cleanse also removes the DoT anti-heal category, so the 4 + 12 request
    // arrives UNTAXED.
    const { events } = castHeal(HEAL_BOOK, 'penance', { maxHp: 100, hp: 10, statuses: [POISON_3] });
    expect(events.find((e) => e.kind === 'cleansed')).toMatchObject({ removed: 3 });
    const heal = healOf(events);
    expect(heal).toMatchObject({ amount: 16 });
    expect(heal.calculation).toMatchObject({ power: 4, bonus: 12 });
    expect('antiHeal' in heal).toBe(false);
  });

  it('scales DOWN with what was actually there — one stack pays for one stack', () => {
    const { events } = castHeal(HEAL_BOOK, 'penance', { maxHp: 100, hp: 10, statuses: [POISON_1] });
    expect(events.find((e) => e.kind === 'cleansed')).toMatchObject({ removed: 1 });
    expect(healOf(events)).toMatchObject({ amount: 9 }); // 4 + 1x5
    expect(healOf(events).calculation).toMatchObject({ bonus: 5 });
  });

  it('CLAMPS at the cap however deep the pile goes', () => {
    const deep: SkillBook = {
      ...HEAL_BOOK,
      penance: healCard('penance', [
        { kind: 'cleanse', charges: 9 },
        { kind: 'cleanseConvert', per: 5, cap: 12 },
        { kind: 'heal', power: 4 },
      ], { archetypes: ['healing', 'support'] }),
    };
    const { events } = castHeal(deep, 'penance', { maxHp: 100, hp: 10, statuses: [{ ...POISON_3, stacks: 9 }] });
    expect(events.find((e) => e.kind === 'cleansed')).toMatchObject({ removed: 9 });
    expect(healOf(events).calculation).toMatchObject({ bonus: 12 }); // not 45
  });

  it('the bonus is part of the REQUEST, so anti-heal taxes it like the base', () => {
    // Two categories (a DoT the cleanse can strip + an EXPOSE it strips too) —
    // pick a pile the 3 charges cannot fully clear so a category survives the
    // cleanse and the tax is still live when the heal lands.
    const stubborn: StatusInstance = { kind: 'poison', property: 'physical', stacks: 6, turnsLeft: 9 };
    const { events } = castHeal(HEAL_BOOK, 'penance', { maxHp: 100, hp: 10, statuses: [stubborn] });
    expect(events.find((e) => e.kind === 'cleansed')).toMatchObject({ removed: 3 });
    // Request 4 + 15-capped-to-12 = 16, taxed −20% -> reduced 3, heal 13.
    const heal = healOf(events);
    expect(heal.calculation).toMatchObject({ power: 4, bonus: 12 });
    expect(heal).toMatchObject({ amount: 13, antiHeal: { pct: 20, reduced: 3 } });
  });

  it('joins a TRUE heal too — flat by identity is about the stat term, not about riders', () => {
    const { events } = castHeal(HEAL_BOOK, 'penanceTrue', { maxHp: 100, hp: 10, statuses: [POISON_3] });
    const heal = healOf(events);
    expect(heal).toMatchObject({ amount: 16, flat: true });
    expect(heal.calculation).toMatchObject({ power: 4, bonus: 12, statBonus: 0, healFlat: 0 });
  });

  it('the two heal-side riders COMPOSE: the converted heal is what overflows into plating', () => {
    const combo: SkillBook = {
      ...HEAL_BOOK,
      combo: healCard('combo', [
        { kind: 'cleanse', charges: 3 },
        { kind: 'cleanseConvert', per: 5, cap: 12 },
        { kind: 'overhealShield', cap: 20 },
        { kind: 'heal', power: 4 },
      ], { archetypes: ['healing', 'support'] }),
    };
    // Full bar, 3 stacks stripped: request 4 + 12 = 16, all of it overflows, and
    // all 16 banks (cap 20 is above it). WITHOUT the convert rider only 4 would.
    const { events, hero } = castHeal(combo, 'combo', { maxHp: 100, hp: 100, statuses: [POISON_3] });
    expect(healOf(events)).toMatchObject({ amount: 0, overheal: 16 });
    expect(gainsOf(events)[0]).toMatchObject({ amount: 16, overheal: true });
    expect(hero.shields.magical).toBe(16);
  });
});

// ------------------------------------------------------------------ pricing --

describe('pricing: the same conditional discount, on the rate of what each DELIVERS', () => {
  const rate = PRICE.flatPowerPerPoint;

  it('the two DAMAGE-side riders price at half the flat-damage rate — the exploit rate', () => {
    const release: Action = { kind: 'wardRelease', per: 6, cap: 20 };
    const desp: Action = { kind: 'desperation', amount: 20 };
    expect(actionsPriceDeci([release], 'physical')).toBe((20 * rate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([desp], 'physical')).toBe((20 * rate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([desp], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'exploit', status: 'poison', amount: 20 }], 'physical'));
    expect(actionsPriceDeci([release], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'shieldBurst', cap: 20 }], 'physical'));
  });

  it('a TRUE card pays the TRUE premium on both — a flat bonus bypasses defense there', () => {
    const trueRate = PRICE.flatPowerPerPoint + PRICE.truePremiumPerPoint;
    expect(actionsPriceDeci([{ kind: 'wardRelease', per: 6, cap: 20 }], 'true')).toBe((20 * trueRate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([{ kind: 'desperation', amount: 20 }], 'true')).toBe((20 * trueRate) / PRICE.conditionalBonusDen);
  });

  it('the two HEAL-side riders divide their OWN payload rate, not the damage rate', () => {
    // Typed: heal and shield both rate at `flatPowerPerPoint`, so the discounted
    // price matches the damage side on a physical/magical card...
    const overheal: Action = { kind: 'overhealShield', cap: 20 };
    const convert: Action = { kind: 'cleanseConvert', per: 5, cap: 20 };
    expect(actionsPriceDeci([overheal], 'magical')).toBe((20 * PRICE.flatPowerPerPoint) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([convert], 'magical')).toBe((20 * PRICE.flatPowerPerPoint) / PRICE.conditionalBonusDen);

    // ...and DIVERGES on TRUE, which is the whole point. A TRUE overheal wall
    // costs what a TRUE `shield` costs; a TRUE converted heal costs what a TRUE
    // `heal` costs. Neither pays the DAMAGE premium.
    expect(actionsPriceDeci([overheal], 'true')).toBe((20 * PRICE.flatTrueShieldPerPoint) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([convert], 'true')).toBe((20 * PRICE.flatTrueHealPerPoint) / PRICE.conditionalBonusDen);
    const trueDamageRate = PRICE.flatPowerPerPoint + PRICE.truePremiumPerPoint;
    expect(actionsPriceDeci([overheal], 'true')).toBeLessThan((20 * trueDamageRate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([convert], 'true')).toBeLessThan(actionsPriceDeci([overheal], 'true'));
  });

  it('`per` is free on both capped riders, because the cap bounds the payload', () => {
    for (const [small, huge] of [
      [{ kind: 'wardRelease', per: 6, cap: 16 }, { kind: 'wardRelease', per: 999, cap: 16 }],
      [{ kind: 'cleanseConvert', per: 5, cap: 16 }, { kind: 'cleanseConvert', per: 999, cap: 16 }],
    ] as Action[][]) {
      expect(actionsPriceDeci([huge!], 'physical')).toBe(actionsPriceDeci([small!], 'physical'));
    }
  });

  it('SELF-SYNERGY forfeits the discount for wardRelease — a ward line feeds it', () => {
    const release: Action = { kind: 'wardRelease', per: 6, cap: 20 };
    expect(selfSynergyPremiumDeci(release, [release], 'physical')).toBe(0);
    const kit: Action[] = [release, { kind: 'damage', power: 10 }, { kind: 'ward', charges: 2 }];
    expect(actionsPriceDeci([release], 'physical', 'one', kit)).toBe(20 * rate);
    // ...and a SHIELD line does not feed it: different currency.
    expect(selfSynergyPremiumDeci(release, [release, { kind: 'shield', power: 40 }], 'physical')).toBe(0);
  });

  it('DESPERATION can NEVER forfeit the discount — nothing supplies "you are hurt"', () => {
    const desp: Action = { kind: 'desperation', amount: 20 };
    // Every keyword that supplies anything at all, in one kit: none of them is
    // the caster's own missing HP, so the premium stays 0 and the card cannot be
    // built into a full-rate variant by accident.
    const everything: Action[] = [
      desp, { kind: 'damage', power: 10 }, { kind: 'poison', stacks: 3 }, { kind: 'burn', stacks: 3 },
      { kind: 'bleed', stacks: 3 }, { kind: 'stun', turns: 1 }, { kind: 'thorns', stacks: 5 },
      { kind: 'shield', power: 40 }, { kind: 'ward', charges: 2 }, { kind: 'slow', weight: 6 },
      // The card-targeting pair and their payload-less spreader (2026-08-21
      // redesign): `burden` is the other keyword that supplies `'tax'`, `curse`
      // and `splash` supply nothing at all — and none of the three is "the
      // caster's own missing HP" either.
      { kind: 'burden', weight: 6 }, { kind: 'curse', amount: 4, turns: 2 }, { kind: 'splash' },
      { kind: 'expose', pct: 20, turns: 2 },
      { kind: 'debuffStat', stat: 'armor', pct: 10, turns: 2 },
    ];
    expect(selfSynergyPremiumDeci(desp, everything, 'physical')).toBe(0);
    expect(actionsPriceDeci([desp], 'physical', 'one', everything)).toBe((20 * rate) / PRICE.conditionalBonusDen);
  });

  it('the HEAL-side pair cannot forfeit it either — no keyword supplies overheal or a cleanse result', () => {
    for (const rider of [{ kind: 'overhealShield', cap: 20 }, { kind: 'cleanseConvert', per: 5, cap: 20 }] as Action[]) {
      const kit: Action[] = [rider, { kind: 'cleanse', charges: 3 }, { kind: 'heal', power: 20 }, { kind: 'shield', power: 40 }];
      expect(selfSynergyPremiumDeci(rider, kit, 'magical'), rider.kind).toBe(0);
    }
  });

  it('overhealShield SUPPLIES shield, so it forfeits a shieldBurst\'s discount', () => {
    // Conservative in the safe direction: in the solo case the converted plating
    // really does land where the burst will spend it.
    const burst: Action = { kind: 'shieldBurst', cap: 20 };
    const kit: Action[] = [burst, { kind: 'damage', power: 10 }, { kind: 'overhealShield', cap: 12 }, { kind: 'heal', power: 10 }];
    expect(selfSynergyPremiumDeci(burst, kit, 'physical')).toBe(20 * rate - (20 * rate) / 2);
  });

  it('the resource lookups agree with the keywords they describe', () => {
    expect(riderReadsResource({ kind: 'wardRelease', per: 6, cap: 20 })).toEqual({ resource: 'ward', on: 'caster', magnitude: 20 });
    expect(riderReadsResource({ kind: 'desperation', amount: 20 })).toEqual({ resource: 'lowHp', on: 'caster', magnitude: 20 });
    expect(riderReadsResource({ kind: 'overhealShield', cap: 20 })).toEqual({ resource: 'overheal', on: 'caster', magnitude: 20 });
    expect(riderReadsResource({ kind: 'cleanseConvert', per: 5, cap: 20 })).toEqual({ resource: 'cleansed', on: 'caster', magnitude: 20 });
    expect(resourceSuppliedBy({ kind: 'ward', charges: 2 })).toEqual({ resource: 'ward', on: 'caster' });
    expect(resourceSuppliedBy({ kind: 'overhealShield', cap: 12 })).toEqual({ resource: 'shield', on: 'caster' });
    // The three unsuppliable gates, stated as the property they are.
    expect(resourceSuppliedBy({ kind: 'cleanse', charges: 3 })).toBeNull();
    expect(resourceSuppliedBy({ kind: 'heal', power: 20 })).toBeNull();
    expect(resourceSuppliedBy({ kind: 'damage', power: 20 })).toBeNull();
  });

  it('riderFeedsKind names what SPENDS each rider — six damage, two heal', () => {
    const damageSide: Action[] = [
      { kind: 'exploit', status: 'poison', amount: 12 },
      { kind: 'stackBonus', status: 'poison', of: 'target', per: 3, cap: 12 },
      { kind: 'shieldBurst', cap: 12 },
      { kind: 'taxBonus', per: 4, cap: 12 },
      { kind: 'wardRelease', per: 6, cap: 12 },
      { kind: 'desperation', amount: 12 },
    ];
    for (const a of damageSide) expect(riderFeedsKind(a), a.kind).toBe('damage');
    for (const a of [{ kind: 'overhealShield', cap: 12 }, { kind: 'cleanseConvert', per: 5, cap: 12 }] as Action[]) {
      expect(riderFeedsKind(a), a.kind).toBe('heal');
    }
    expect(riderFeedsKind({ kind: 'damage', power: 10 })).toBeNull();
    expect(riderFeedsKind({ kind: 'heal', power: 10 })).toBeNull();
  });

  it('none is a damage INSTANCE, and all four count against the EMPOWER cap', () => {
    for (const kind of ['wardRelease', 'desperation', 'overhealShield', 'cleanseConvert'] as Action['kind'][]) {
      expect(HIT_KINDS.has(kind), kind).toBe(false);
      expect(EMPOWER_KINDS.has(kind), kind).toBe(true);
    }
    // 40 points of typed cap = 100 deci = the whole size-1 empower cap; one more
    // point of either must be a violation (they share it).
    expect(capViolations(card('capped', [
      { kind: 'wardRelease', per: 6, cap: 24 },
      { kind: 'desperation', amount: 20 },
      { kind: 'damage', power: 10 },
    ]))).toEqual(['empower 11 PL exceeds the size-1 bronze cap (10 PL)']);
  });

  it('only DESPERATION is offensive; the other three pay no AoE reach', () => {
    expect(OFFENSIVE_KINDS.has('desperation')).toBe(true);
    for (const kind of ['wardRelease', 'overhealShield', 'cleanseConvert'] as Action['kind'][]) {
      expect(OFFENSIVE_KINDS.has(kind), kind).toBe(false);
    }
    const desp: Action[] = [{ kind: 'desperation', amount: 20 }];
    expect(actionsPriceDeci(desp, 'physical', 'all'))
      .toBe(Math.floor((50 * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen));
    // The caster-side three are scope-invariant — which is why an authored AoE +
    // wardRelease card is REFUSED rather than priced (see the validator section).
    for (const rider of [{ kind: 'wardRelease', per: 6, cap: 20 }, { kind: 'overhealShield', cap: 20 }] as Action[]) {
      expect(actionsPriceDeci([rider], 'physical', 'all'), rider.kind).toBe(actionsPriceDeci([rider], 'physical', 'one'));
    }
  });

  it('powerLevelBreakdown parts still sum exactly with any of the four in play', () => {
    const cases: [Action, Action][] = [
      [{ kind: 'wardRelease', per: 2, cap: 4 }, { kind: 'damage', power: 8 }],
      [{ kind: 'desperation', amount: 4 }, { kind: 'damage', power: 8 }],
      [{ kind: 'overhealShield', cap: 4 }, { kind: 'heal', power: 8 }],
      [{ kind: 'cleanseConvert', per: 2, cap: 4 }, { kind: 'heal', power: 8 }],
    ];
    for (const [rider, sink] of cases) {
      const skill = card('sum', [rider, sink]);
      const parts = powerLevelBreakdown(skill);
      expect(parts.reduce((s, p) => s + p.deci, 0), rider.kind).toBe(powerLevelDeci(skill));
      expect(parts.find((p) => p.label === rider.kind)!.deci, rider.kind).toBe(10); // 4 x 2.5
    }
  });
});

describe('the four showcase cards are exactly on budget at all four tiers', () => {
  const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
  const ids = ['sanctuary_overflow', 'penitent_mending', 'vow_broken', 'cornered_beast'];

  for (const id of ids) {
    it(`${id}: on budget with no cap violations at every tier`, () => {
      const base = skillBook[id]!;
      for (const tier of tiers) {
        const at = applyTier(base, tier);
        expect(isOnBudget(at), `${id}@${tier} is ${powerLevelDeci(at) / 10} PL`).toBe(true);
        expect(capViolations(at), `${id}@${tier}`).toEqual([]);
      }
    });
  }

  it('every one of them HAND-AUTHORS its ladder, because the rider is not a scalable sink', () => {
    // The trap this guards: `autoScaleTier` grows only damage/heal/shield/cleanse,
    // so an un-laddered rider card would ship a Diamond whose signature line is
    // still its Bronze value while damage did all the walking.
    for (const id of ids) {
      const base = skillBook[id]!;
      expect(Object.keys(base.tierUpgrades ?? {}).sort(), id).toEqual(['diamond', 'gold', 'silver']);
    }
  });

  it('the rider magnitude GROWS at every tier step on all four', () => {
    const magnitude = (skill: SkillDef): number => {
      for (const a of skill.effects) {
        if (a.kind === 'wardRelease' || a.kind === 'overhealShield' || a.kind === 'cleanseConvert') return a.cap;
        if (a.kind === 'desperation') return a.amount;
      }
      throw new Error('no rider on ' + skill.id);
    };
    for (const id of ids) {
      const ladder = tiers.map((t) => magnitude(applyTier(skillBook[id]!, t)));
      for (let i = 1; i < ladder.length; i += 1) {
        expect(ladder[i]!, `${id} ${tiers[i]!} (${ladder.join(' -> ')})`).toBeGreaterThan(ladder[i - 1]!);
      }
    }
  });

  it('vow_broken keeps its reach at the FULL legal ward pile at every tier', () => {
    // ceil(cap / per) === MAX_WARD_CHARGES: the release can always cash in
    // everything a holder is allowed to carry, rather than drifting out of reach
    // as the numbers grow (the `deadweight_toll` discipline).
    for (const tier of tiers) {
      const rider = applyTier(skillBook['vow_broken']!, tier).effects.find((a) => a.kind === 'wardRelease')!;
      if (rider.kind !== 'wardRelease') throw new Error('expected a wardRelease rider');
      expect(Math.ceil(rider.cap / rider.per), tier).toBe(MAX_WARD_CHARGES);
    }
  });

  it('the two pure SPENDERS grant nothing of their own — they price at the discount', () => {
    for (const id of ['vow_broken', 'cornered_beast']) {
      const base = skillBook[id]!;
      expect(base.effects.some((a) => a.kind === 'ward'), id).toBe(false);
      const rider = base.effects.find((a) => a.kind === 'wardRelease' || a.kind === 'desperation')!;
      expect(selfSynergyPremiumDeci(rider, base.effects, base.property), id).toBe(0);
    }
  });

  it('penitent_mending keeps its reach at 3 cleansed stacks at every tier', () => {
    for (const tier of tiers) {
      const rider = applyTier(skillBook['penitent_mending']!, tier).effects.find((a) => a.kind === 'cleanseConvert')!;
      if (rider.kind !== 'cleanseConvert') throw new Error('expected a cleanseConvert rider');
      expect(Math.ceil(rider.cap / rider.per), tier).toBe(3);
    }
  });
});

// -------------------------------------------------------------- authoring ---

describe('validateSkillContent enforces the ordering rules for all four riders', () => {
  const doc = (effects: unknown[], extra: Record<string, unknown> = {}): unknown => ({
    schemaVersion: 1,
    cards: [{
      id: 'ordering_probe',
      versions: [{
        version: 1,
        def: {
          name: 'Probe', text: 'x 3 4 5 6 10 12 16 20 40', archetypes: ['offense'], property: 'physical', weapon: 'sword',
          size: 1, rarity: 'common', tier: 'bronze', effects, ...extra,
        },
      }],
    }],
  });
  const problemsOf = (effects: unknown[], extra: Record<string, unknown> = {}): string[] =>
    validateSkillDocument(doc(effects, extra)).map((p) => p.message);

  it('accepts rider -> damage -> the resource this card supplies', () => {
    expect(problemsOf([
      { kind: 'wardRelease', per: 6, cap: 12 },
      { kind: 'damage', power: 12 },
      { kind: 'ward', charges: 2 },
    ])).toEqual([]);
    expect(problemsOf([
      { kind: 'desperation', amount: 20 },
      { kind: 'damage', power: 12 },
    ])).toEqual([]);
  });

  it('accepts the HEAL-side shapes: rider -> heal, and cleanse -> rider -> heal', () => {
    expect(problemsOf([
      { kind: 'overhealShield', cap: 12 },
      { kind: 'heal', power: 20 },
    ])).toEqual([]);
    expect(problemsOf([
      { kind: 'cleanse', charges: 3 },
      { kind: 'cleanseConvert', per: 5, cap: 12 },
      { kind: 'heal', power: 4 },
    ])).toEqual([]);
  });

  it('rejects a DAMAGE-side rider placed behind the damage it is supposed to feed', () => {
    for (const rider of [{ kind: 'wardRelease', per: 6, cap: 12 }, { kind: 'desperation', amount: 20 }]) {
      expect(problemsOf([{ kind: 'damage', power: 12 }, rider]).join(' '), rider.kind)
        .toContain('must be placed BEFORE a damage action');
    }
  });

  it('rejects a HEAL-side rider fed by a DAMAGE line — it must precede a HEAL', () => {
    // The message names the right kind: a heal rider on a pure damage card is
    // exactly the priced no-op rule 1 exists to catch, and saying "damage" there
    // would send the author to fix the wrong line.
    expect(problemsOf([
      { kind: 'overhealShield', cap: 12 },
      { kind: 'damage', power: 12 },
    ]).join(' ')).toContain('must be placed BEFORE a heal action');
    expect(problemsOf([
      { kind: 'cleanse', charges: 3 },
      { kind: 'cleanseConvert', per: 5, cap: 12 },
      { kind: 'damage', power: 12 },
    ]).join(' ')).toContain('must be placed BEFORE a heal action');
  });

  it('rejects a heal-side rider placed BEHIND the heal it feeds', () => {
    expect(problemsOf([
      { kind: 'heal', power: 20 },
      { kind: 'overhealShield', cap: 12 },
    ]).join(' ')).toContain('must be placed BEFORE a heal action');
  });

  it('rejects cleanseConvert with NO CLEANSE ahead of it (rule 0)', () => {
    expect(problemsOf([
      { kind: 'cleanseConvert', per: 5, cap: 12 },
      { kind: 'heal', power: 4 },
    ]).join(' ')).toContain('must be placed AFTER a cleanse action');
    // ...including the tempting near-miss: the cleanse is on the card, but BEHIND
    // the rider, so the rider still reads 0.
    expect(problemsOf([
      { kind: 'cleanseConvert', per: 5, cap: 12 },
      { kind: 'cleanse', charges: 3 },
      { kind: 'heal', power: 4 },
    ]).join(' ')).toContain('must be placed AFTER a cleanse action');
  });

  it('rejects the self-trigger: this card\'s own ward ahead of the release\'s hit', () => {
    expect(problemsOf([
      { kind: 'wardRelease', per: 6, cap: 12 },
      { kind: 'ward', charges: 2 },
      { kind: 'damage', power: 12 },
    ]).join(' ')).toContain('may never trigger its own condition within one cast');
  });

  it('lets an UNRELATED resource sit before the fed action', () => {
    // A poison ahead of the hit is fine on a release card (it supplies no ward),
    // and a shield is fine on a desperation card (nothing supplies low HP).
    expect(problemsOf([
      { kind: 'wardRelease', per: 6, cap: 12 },
      { kind: 'poison', stacks: 3 },
      { kind: 'damage', power: 12 },
    ])).toEqual([]);
    expect(problemsOf([
      { kind: 'desperation', amount: 20 },
      { kind: 'shield', power: 40 },
      { kind: 'damage', power: 12 },
    ])).toEqual([]);
  });

  it('rejects an overhealShield sitting ahead of a shieldBurst\'s hit — it supplies plating', () => {
    expect(problemsOf([
      { kind: 'shieldBurst', cap: 12 },
      { kind: 'overhealShield', cap: 12 },
      { kind: 'damage', power: 12 },
      { kind: 'heal', power: 20 },
    ]).join(' ')).toContain('may never trigger its own condition within one cast');
  });

  it('refuses AoE + wardRelease (one pile, spent once, must not hit five foes)', () => {
    expect(problemsOf([
      { kind: 'wardRelease', per: 6, cap: 12 },
      { kind: 'damage', power: 12 },
    ], { scope: 'all' }).join(' ')).toContain('scope: all cannot be combined with a wardRelease action');
    // ...while an AoE desperation card is fine: armed per victim, and it pays reach.
    expect(problemsOf([
      { kind: 'desperation', amount: 20 },
      { kind: 'damage', power: 12 },
    ], { scope: 'all' })).toEqual([]);
  });

  it('rejects a missing cap, a zero `per`, and an unknown field', () => {
    const messages = problemsOf([
      { kind: 'overhealShield' },
      { kind: 'wardRelease', per: 0, cap: 16 },
      { kind: 'cleanseConvert', per: 5 },
      { kind: 'desperation', amount: 12, amt: 3 },
    ]).join(' | ');
    expect(messages).toContain('missing required field cap');
    expect(messages).toContain('per must be an integer 1..999');
    expect(messages).toContain('unknown field amt');
  });
});

describe('no gem carries wardRelease or cleanseConvert', () => {
  it('the shipped gem catalog is free of both', async () => {
    const { gemBook } = await import('../../src/data/gems');
    for (const gem of Object.values(gemBook)) {
      if (gem.kind !== 'effect') continue;
      expect(
        gem.actions.some((a) => a.kind === 'wardRelease'),
        `${gem.id}: a gem wardRelease is host-blind — on an AoE host it would deliver one spent pile of charges to `
          + 'every foe at a single-target price, the exact hole THE SPLASH GATE (spliceGemActions, engine/cards.ts) '
          + 'exists to close. Extend that gate before authoring one.',
      ).toBe(false);
      expect(
        gem.actions.some((a) => a.kind === 'cleanseConvert'),
        `${gem.id}: a gem cleanseConvert cannot WORK — it must resolve BETWEEN the host's own cleanse and the host's `
          + 'own heal, and the two-phase splicer (GEM_ACTION_PHASE) can only prepend or append. Prepended it reads 0 '
          + 'stacks; appended it arms a bonus the heal has already gone past. Teach the splicer a third position first.',
      ).toBe(false);
    }
  });
});
