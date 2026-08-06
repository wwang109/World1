import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import {
  ANTI_HEAL_MAX_PCT,
  ANTI_HEAL_PCT_PER_CATEGORY,
  antiHealCategories,
  applyCast,
  type Ctx,
} from '../../src/engine/combat/interpreter';
import { NO_MODS } from '../../src/engine/combat/auras';
import { initCombatState, type CombatantState, type StatusInstance } from '../../src/engine/combat/state';
import { Rng } from '../../src/engine/rng';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { SkillBook, SkillDef } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * ANTI-HEAL WORLD RULE (user-locked 2026-08-01).
 *
 * Three affliction categories on the heal RECEIVER — DoT family (poison/burn/
 * bleed counted ONCE), any stat debuff, any expose — each taxing REGULAR heals
 * and lifesteal by −20%, capped at −60%. TRUE heals are immune. Stun and
 * shields are not afflictions; shield GAINS are not healing.
 *
 * Rounding (locked): `reduced = floor(request * pct / 100)`, heal landed =
 * `request − reduced`. The reduction is floored (mirroring how expose floors
 * its amplification), so the surviving heal rounds UP and a positive heal can
 * never be zeroed by this rule.
 */

type HealEvent = Extract<CombatEvent, { kind: 'heal' }>;
type ShieldEvent = Extract<CombatEvent, { kind: 'shieldGain' }>;

const BOOK: SkillBook = {
  // Magical heal — scales off Magic Power, so every test caster uses magicPower 0
  // to make the request exactly the card's power.
  mend100: {
    id: 'mend100',
    name: 'Mend 100',
    archetypes: ['healing'],
    property: 'magical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'heal', power: 100 }],
    text: '',
  },
  // TRUE heal — flat and IRREDUCIBLE by identity.
  mendTrue100: {
    id: 'mendTrue100',
    name: 'True Mend 100',
    archetypes: ['healing'],
    property: 'true',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'heal', power: 100 }],
    text: '',
  },
  // Tiny magical heals for the rounding boundaries.
  mend1: { ...heal('mend1', 1) },
  mend2: { ...heal('mend2', 2) },
  mend4: { ...heal('mend4', 4) },
  mend5: { ...heal('mend5', 5) },
  // 100 damage (attack 0) + 50% lifesteal on the caster.
  drain: {
    id: 'drain',
    name: 'Drain',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [
      { kind: 'damage', power: 100 },
      { kind: 'lifesteal', pct: 50 },
    ],
    text: '',
  },
  // Shield GAIN — not healing, must be untouched by the rule.
  plate100: {
    id: 'plate100',
    name: 'Plate 100',
    archetypes: ['defensive'],
    property: 'true',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'shield', power: 100 }],
    text: '',
  },
  // 3 charges: enough to strip one 1-stack DoT + one debuff + one expose.
  purge3: {
    id: 'purge3',
    name: 'Purge 3',
    archetypes: ['healing'],
    property: 'true',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'cleanse', charges: 3 }],
    text: '',
  },
  // For the end-to-end fight: the foe poisons, the hero heals itself.
  poison_apply: {
    id: 'poison_apply',
    name: 'Poison',
    archetypes: ['debuff'],
    property: 'physical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'poison', stacks: 4 }],
    text: '',
  },
};

function heal(id: string, power: number): SkillDef {
  return {
    id,
    name: id,
    archetypes: ['healing'],
    property: 'magical',
    size: 1,
    speedWeight: 10,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'heal', power }],
    text: '',
  };
}

/** Statuses used as afflictions. `debuff` deliberately hits ARMOR so it can't change heal math. */
const DOT: StatusInstance = { kind: 'poison', property: 'physical', stacks: 1, turnsLeft: 1 };
const BURN: StatusInstance = { kind: 'burn', property: 'magical', stacks: 1, turnsLeft: 1 };
const BLEED: StatusInstance = { kind: 'bleed', property: 'physical', stacks: 1, turnsLeft: 1 };
const DEBUFF: StatusInstance = { kind: 'debuff', stat: 'armor', pct: 10, turnsLeft: 3 };
const EXPOSE: StatusInstance = { kind: 'expose', pct: 50, turnsLeft: 3 };
const STUN: StatusInstance = { kind: 'stun', turnsLeft: 2 };

/**
 * Cast one card from a fresh 1v1 state, directly through the interpreter (pure,
 * no RNG), with the given statuses pre-applied to the caster/receiver. The
 * caster is deeply hurt (hp 1 of 1000) so nothing overheals.
 */
function castWith(
  skillId: string,
  statuses: StatusInstance[],
  extra: { shields?: Partial<CombatantState['shields']> } = {},
): { events: CombatEvent[]; hero: CombatantState; ctx: Ctx } {
  const state = initCombatState({
    playerTeam: [tc('hero', [skillId], { maxHp: 1000, hp: 1, attack: 0, magicPower: 0 }, { skillBook: BOOK })],
    enemyTeam: [tc('foe', [], { maxHp: 5000, hp: 5000, armor: 0 }, { skillBook: BOOK })],
    skillBook: BOOK,
    ...NO_ENDGAME,
  });
  state.turn = 1;
  const hero = state.player;
  for (const s of statuses) hero.statuses.push({ ...s });
  if (extra.shields) hero.shields = { ...hero.shields, ...extra.shields };
  const ctx: Ctx = { state, rng: new Rng(1), events: [] };
  const piece = hero.pieces[0]!;
  applyCast(ctx, hero, piece.skill, piece.slot, NO_MODS, { before: 0, after: 1 });
  return { events: ctx.events, hero, ctx };
}

function healOf(events: CombatEvent[]): HealEvent {
  return events.find((e): e is HealEvent => e.kind === 'heal')!;
}

describe('anti-heal categories', () => {
  it('counts the DoT family ONCE (poison + burn + bleed = one category)', () => {
    const { hero } = castWith('mend100', [DOT, BURN, BLEED]);
    expect(antiHealCategories(hero)).toEqual(['dot']);
  });

  it('returns the three categories in a FIXED order (dot, debuff, expose)', () => {
    const { hero } = castWith('mend100', [EXPOSE, DEBUFF, DOT]);
    expect(antiHealCategories(hero)).toEqual(['dot', 'debuff', 'expose']);
  });

  it('ignores stun and shields (neither is an affliction for this rule)', () => {
    const { hero } = castWith('mend100', [STUN], { shields: { true: 200 } });
    expect(antiHealCategories(hero)).toEqual([]);
  });
});

describe('anti-heal reduction of regular heals', () => {
  it('is a no-op with zero afflictions (no annotation on the event)', () => {
    const ev = healOf(castWith('mend100', []).events);
    expect(ev.amount).toBe(100);
    expect(ev.antiHeal).toBeUndefined();
  });

  it('DoT alone taxes −20%', () => {
    const ev = healOf(castWith('mend100', [DOT]).events);
    expect(ev.amount).toBe(80);
    expect(ev.antiHeal).toEqual({ categories: ['dot'], pct: 20, reduced: 20 });
  });

  it('a stat debuff alone taxes −20%', () => {
    const ev = healOf(castWith('mend100', [DEBUFF]).events);
    expect(ev.amount).toBe(80);
    expect(ev.antiHeal).toEqual({ categories: ['debuff'], pct: 20, reduced: 20 });
  });

  it('expose alone taxes −20%', () => {
    const ev = healOf(castWith('mend100', [EXPOSE]).events);
    expect(ev.amount).toBe(80);
    expect(ev.antiHeal).toEqual({ categories: ['expose'], pct: 20, reduced: 20 });
  });

  it('three DoT kinds together still tax only −20% (one family)', () => {
    const ev = healOf(castWith('mend100', [DOT, BURN, BLEED]).events);
    expect(ev.amount).toBe(80);
    expect(ev.antiHeal?.pct).toBe(20);
  });

  it('two categories tax −40%', () => {
    const ev = healOf(castWith('mend100', [DOT, DEBUFF]).events);
    expect(ev.amount).toBe(60);
    expect(ev.antiHeal).toEqual({ categories: ['dot', 'debuff'], pct: 40, reduced: 40 });
  });

  it('all three categories tax −60% — the cap', () => {
    const ev = healOf(castWith('mend100', [DOT, DEBUFF, EXPOSE]).events);
    expect(ev.amount).toBe(40);
    expect(ev.antiHeal).toEqual({ categories: ['dot', 'debuff', 'expose'], pct: 60, reduced: 60 });
  });

  it('CANNOT exceed −60% however many afflictions pile up', () => {
    const many = [DOT, BURN, BLEED, DEBUFF, { ...DEBUFF, stat: 'magicResist' as const }, EXPOSE, { ...EXPOSE }, STUN];
    const ev = healOf(castWith('mend100', many).events);
    expect(ev.antiHeal?.pct).toBe(ANTI_HEAL_MAX_PCT);
    expect(ev.antiHeal?.pct).toBe(60);
    expect(ev.amount).toBe(40);
    expect(ANTI_HEAL_PCT_PER_CATEGORY).toBe(20);
  });

  it('a shielded, stunned receiver takes NO reduction', () => {
    const ev = healOf(castWith('mend100', [STUN], { shields: { physical: 50, true: 50 } }).events);
    expect(ev.amount).toBe(100);
    expect(ev.antiHeal).toBeUndefined();
  });

  it('the reported calculation reconciles with the tax: parts − reduced − overheal = amount', () => {
    // The event's `calculation` is the PRE-TAX request; anti-heal is a separate
    // subtraction, so a UI strip can print base/stat/aura, then the tax, and
    // land exactly on the number the sim applied.
    const ev = healOf(castWith('mend100', [DOT, DEBUFF]).events);
    expect(ev.calculation).toEqual({ power: 100, statBonus: 0, healFlat: 0, property: 'magical' });
    const c = ev.calculation!;
    expect(c.power + c.statBonus + c.healFlat - (ev.antiHeal?.reduced ?? 0) - ev.overheal).toBe(ev.amount);
  });
});

describe('TRUE heal immunity', () => {
  it('is untaxed under all three categories (modest but irreducible)', () => {
    const ev = healOf(castWith('mendTrue100', [DOT, DEBUFF, EXPOSE]).events);
    expect(ev.amount).toBe(100);
    expect(ev.flat).toBe(true);
    expect(ev.antiHeal).toBeUndefined();
  });
});

describe('anti-heal rounding (reduction floored, heal rounds UP)', () => {
  // reduced = floor(request * pct / 100); landed = request − reduced.
  it('−20%: requests 1-4 lose nothing, 5 loses 1', () => {
    expect(healOf(castWith('mend1', [DOT]).events).amount).toBe(1);
    expect(healOf(castWith('mend1', [DOT]).events).antiHeal).toBeUndefined();
    expect(healOf(castWith('mend4', [DOT]).events).amount).toBe(4);
    expect(healOf(castWith('mend4', [DOT]).events).antiHeal).toBeUndefined();
    const five = healOf(castWith('mend5', [DOT]).events);
    expect(five.amount).toBe(4);
    expect(five.antiHeal).toEqual({ categories: ['dot'], pct: 20, reduced: 1 });
  });

  it('−60%: request 1 loses nothing, request 2 loses 1', () => {
    const one = healOf(castWith('mend1', [DOT, DEBUFF, EXPOSE]).events);
    expect(one.amount).toBe(1);
    expect(one.antiHeal).toBeUndefined();
    const two = healOf(castWith('mend2', [DOT, DEBUFF, EXPOSE]).events);
    expect(two.amount).toBe(1);
    expect(two.antiHeal).toEqual({ categories: ['dot', 'debuff', 'expose'], pct: 60, reduced: 1 });
  });

  it('never zeroes a positive heal (1-20 HP requests at the −60% cap)', () => {
    for (const id of ['mend1', 'mend2', 'mend4', 'mend5'] as const) {
      const ev = healOf(castWith(id, [DOT, DEBUFF, EXPOSE]).events);
      expect(ev.amount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('lifesteal', () => {
  it('is taxed like a regular heal (50% of 100 damage → 40 at −20%)', () => {
    const clean = healOf(castWith('drain', []).events);
    expect(clean.amount).toBe(50);
    expect(clean.antiHeal).toBeUndefined();

    const taxed = healOf(castWith('drain', [DOT]).events);
    expect(taxed.amount).toBe(40);
    expect(taxed.antiHeal).toEqual({ categories: ['dot'], pct: 20, reduced: 10 });
  });

  it('is taxed at the −60% cap (50 → 20)', () => {
    const ev = healOf(castWith('drain', [DOT, DEBUFF, EXPOSE]).events);
    expect(ev.amount).toBe(20);
    expect(ev.antiHeal?.reduced).toBe(30);
  });
});

describe('shield gains are not healing', () => {
  it('grants the full pool under all three afflictions', () => {
    const { events } = castWith('plate100', [DOT, DEBUFF, EXPOSE]);
    const ev = events.find((e): e is ShieldEvent => e.kind === 'shieldGain')!;
    expect(ev.amount).toBe(100);
    expect(ev).not.toHaveProperty('antiHeal');
  });
});

describe('cleanse is the counter-counter', () => {
  it('restores full heal potency once the afflictions are gone', () => {
    // Same state, two casts: heal (taxed) → purge → heal (full). Categories are
    // read at heal time, so removing them needs no extra bookkeeping.
    const state = initCombatState({
      playerTeam: [
        tc('hero', ['mend100', 'purge3'], { maxHp: 1000, hp: 1, attack: 0, magicPower: 0 }, { skillBook: BOOK }),
      ],
      enemyTeam: [tc('foe', [], { maxHp: 5000, hp: 5000 }, { skillBook: BOOK })],
      skillBook: BOOK,
      ...NO_ENDGAME,
    });
    state.turn = 1;
    const hero = state.player;
    for (const s of [DOT, DEBUFF, EXPOSE]) hero.statuses.push({ ...s });
    const ctx: Ctx = { state, rng: new Rng(1), events: [] };
    const mend = hero.pieces.find((p) => p.skillId === 'mend100')!;
    const purge = hero.pieces.find((p) => p.skillId === 'purge3')!;

    applyCast(ctx, hero, mend.skill, mend.slot, NO_MODS, { before: 0, after: 1 });
    expect(healOf(ctx.events).antiHeal?.pct).toBe(60);

    hero.stats.hp = 1;
    ctx.events = [];
    applyCast(ctx, hero, purge.skill, purge.slot, NO_MODS, { before: 1, after: 2 });
    expect(ctx.events.some((e) => e.kind === 'cleansed')).toBe(true);
    expect(antiHealCategories(hero)).toEqual([]);

    ctx.events = [];
    applyCast(ctx, hero, mend.skill, mend.slot, NO_MODS, { before: 0, after: 1 });
    const after = healOf(ctx.events);
    expect(after.amount).toBe(100);
    expect(after.antiHeal).toBeUndefined();
  });
});

describe('end to end in a real fight', () => {
  it('taxes the hero\'s heals while the foe keeps it poisoned, and the log records it', () => {
    const c = cfg(
      tc('hero', ['mend100'], { maxHp: 1000, hp: 1, attack: 0, magicPower: 0, speed: 10 }, { skillBook: BOOK }),
      tc('foe', ['poison_apply'], { maxHp: 5000, hp: 5000, speed: 10 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 6 },
    );
    const heals = simulate(c, 7).events.filter((e): e is HealEvent => e.kind === 'heal' && e.side === 'player');
    expect(heals.length).toBeGreaterThan(1);
    const taxed = heals.filter((e) => e.antiHeal !== undefined);
    expect(taxed.length).toBeGreaterThan(0);
    for (const ev of taxed) {
      expect(ev.antiHeal).toEqual({ categories: ['dot'], pct: 20, reduced: 20 });
      // The pre-tax request is reconstructible from the event.
      expect(ev.amount + ev.overheal + ev.antiHeal!.reduced).toBe(100);
    }
  });

  it('same seed, same log (no new RNG draws)', () => {
    const c = cfg(
      tc('hero', ['mend100'], { maxHp: 1000, hp: 1, attack: 0, magicPower: 0, speed: 10 }, { skillBook: BOOK }),
      tc('foe', ['poison_apply'], { maxHp: 5000, hp: 5000, speed: 10 }, { skillBook: BOOK }),
      { ...NO_ENDGAME, skillBook: BOOK, maxTurns: 6 },
    );
    expect(JSON.stringify(simulate(c, 3).events)).toBe(JSON.stringify(simulate(c, 3).events));
  });
});
