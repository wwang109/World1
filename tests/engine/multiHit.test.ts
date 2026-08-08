import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { statShare, type HitSplit } from '../../src/engine/combat/interpreter';
import { skillBook } from '../../src/data/skills';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { Gem, SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

// MULTI-HIT STAT SPLIT (user-locked 2026-08-07): the caster's scaling stat is a
// PER-CAST resource. A cast with N damage actions splits its stat across them,
// so its total stat contribution equals a single-hit cast's — multi-hit no
// longer scales superlinearly with hero stats.
//
// What this rule does NOT change (deliberate, user-locked the same day):
// `mods.damageFlat` (card-scope stat gems / board auras) and a triggered
// `comboBonus` still apply IN FULL to EVERY hit — see the last describe block,
// which pins that decision so it cannot drift silently.
//
// What it does NOT reach at all: GEM-APPENDED hits. They are outside the
// divisor and take no attacker-side bonus — see tests/engine/gemStrike.test.ts.

/** All damage amounts of the FIRST player cast, in application order. */
function firstCastHits(events: CombatEvent[]): number[] {
  const out: number[] = [];
  let casts = 0;
  for (const e of events) {
    if (e.kind === 'skillCast' && e.side === 'player') {
      casts += 1;
      if (casts > 1) break;
    }
    if (casts === 1 && e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill') out.push(e.amount);
  }
  return out;
}

/** The `calculation` blocks of the FIRST player cast's hits. */
function firstCastCalcs(events: CombatEvent[]) {
  const out: NonNullable<Extract<CombatEvent, { kind: 'damage' }>['calculation']>[] = [];
  let casts = 0;
  for (const e of events) {
    if (e.kind === 'skillCast' && e.side === 'player') {
      casts += 1;
      if (casts > 1) break;
    }
    if (casts === 1 && e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill' && e.calculation) {
      out.push(e.calculation);
    }
  }
  return out;
}

/** One caster with one card (+ optional gem) vs an inert, undefended wall. */
function castOnce(
  skillId: string,
  stats: { attack?: number; magicPower?: number },
  opts: { gem?: Gem; armor?: number; magicResist?: number; book?: SkillBook; foes?: number } = {},
): CombatEvent[] {
  const book = opts.book ?? skillBook;
  const hero = tc('hero', [], { ...stats, speed: 20, maxHp: 5000 }, {
    pieces: [{ skillId, slot: 0, ...(opts.gem ? { gem: opts.gem } : {}) }],
    skillBook: book,
  });
  const wall = tc('wall', [], { maxHp: 5000, speed: 1, armor: opts.armor ?? 0, magicResist: opts.magicResist ?? 0 }, { skillBook: book });
  const enemyTeam = Array.from({ length: opts.foes ?? 1 }, () => wall);
  // Enough turns for a heavy size-2/3 card to bank the readiness to fire at all
  // (`barrage` is weight 26, `soul_rend` 26); the wall holds no cards and never
  // acts, and the readers above stop at the SECOND player cast either way.
  return simulate(
    { playerTeam: [hero], enemyTeam, skillBook: book, ...NO_ENDGAME, maxTurns: 8, cooldownsEnabled: false },
    1,
  ).events;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const split = (index: number, count: number): HitSplit => ({ index, count });

describe('statShare: the integer split rule', () => {
  it('is the IDENTITY at one hit — every single-hit card is byte-identical to the pre-split engine', () => {
    for (const stat of [0, 1, 7, 20, 33, 100]) {
      expect(statShare(stat, split(0, 1))).toBe(stat);
    }
  });

  it('distributes the WHOLE stat and never one point more, for every stat x hit-count', () => {
    for (let count = 1; count <= 6; count += 1) {
      for (let stat = 0; stat <= 60; stat += 1) {
        const shares = Array.from({ length: count }, (_, i) => statShare(stat, split(i, count)));
        // Exact: no point invented (a free extra hit) and none lost (a silent nerf).
        expect(sum(shares)).toBe(stat);
        // Every share is within one point of an even split — no hit is starved.
        const lo = Math.floor(stat / count);
        for (const s of shares) expect(s === lo || s === lo + 1).toBe(true);
      }
    }
  });

  it('FRONT-LOADS the remainder: earlier hits carry the odd points', () => {
    expect([0, 1].map((i) => statShare(21, split(i, 2)))).toEqual([11, 10]);
    expect([0, 1, 2].map((i) => statShare(20, split(i, 3)))).toEqual([7, 7, 6]);
    expect([0, 1, 2].map((i) => statShare(1, split(i, 3)))).toEqual([1, 0, 0]);
  });

  it('stays exact for a ZERO or NEGATIVE pool (never invents a point from rounding)', () => {
    expect([0, 1].map((i) => statShare(0, split(i, 2)))).toEqual([0, 0]);
    // effStat floors at 0 so the engine never feeds a negative here, but the
    // split must not silently manufacture damage if a caller ever does.
    expect(sum([0, 1].map((i) => statShare(-3, split(i, 2))))).toBe(-3);
  });
});

describe('multi-hit: a cast delivers its stat ONCE, split across its hits', () => {
  it('Twin Slash (2 x base 6) totals base + ATK, not base + 2 x ATK', () => {
    for (const attack of [10, 20, 30, 50]) {
      const hits = firstCastHits(castOnce('twin_slash', { attack }));
      expect(hits).toHaveLength(2);
      // 6 + 6 flat base, plus the caster's Attack ONCE across the whole cast.
      expect(sum(hits)).toBe(12 + attack);
    }
  });

  it('the stat term is HIT-COUNT-INVARIANT across all three multi-hit cards', () => {
    const attack = 40;
    // Each card's total is exactly its summed flat base + Attack once.
    expect(sum(firstCastHits(castOnce('twin_slash', { attack })))).toBe(6 + 6 + attack);
    expect(sum(firstCastHits(castOnce('rapid_volley', { attack })))).toBe(10 + 10 + attack);
    expect(sum(firstCastHits(castOnce('barrage', { attack })))).toBe(24 + 24 + attack);
    // ...and a single-hit control is unaffected by the rule.
    expect(sum(firstCastHits(castOnce('sword_slash', { attack })))).toBe(20 + attack);
  });

  it('splits an ODD stat front-loaded, and the two hits still sum to the whole stat', () => {
    const hits = firstCastHits(castOnce('twin_slash', { attack: 21 }));
    // 6 + 11 and 6 + 10.
    expect(hits).toEqual([17, 16]);
    expect(sum(hits)).toBe(12 + 21);
  });

  it('a stat too small to split leaves a 0-share hit that STILL LANDS (minimum-1 clamp)', () => {
    const hits = firstCastHits(castOnce('twin_slash', { attack: 1 }));
    expect(hits).toEqual([7, 6]); // shares 1 and 0, on top of the 6 + 6 flat base
    expect(sum(hits)).toBe(12 + 1);
    // With no flat base at all the 0-share hit is rescued by the damage floor.
    const bare: SkillBook = {
      twin_zero: {
        id: 'twin_zero',
        name: 'Twin Zero',
        archetypes: ['offense'],
        property: 'physical',
        size: 1,
        rarity: 'common',
        tier: 'bronze',
        weapon: 'sword',
        effects: [{ kind: 'damage', power: 0 }, { kind: 'damage', power: 0 }],
        text: '',
      },
    };
    expect(firstCastHits(castOnce('twin_zero', { attack: 1 }, { book: bare }))).toEqual([1, 1]);
  });
});

describe('multi-hit: interactions the split must not break', () => {
  it('a gem-appended damage action stays OUT of the split, so a "+16" gem adds exactly 16 and takes nothing', () => {
    // The user-reported case: soul_rend_echo is an EFFECT gem that appends a
    // damage action. Before the split it collected a WHOLE extra stat add (at
    // ATK 50 a "+16" gem delivered +66). It briefly JOINED the split instead,
    // which was worse — it took a share away from the base hit and paid armor
    // twice, so the gem could be net-NEGATIVE. It is now OUTSIDE the divisor
    // entirely (user-locked 2026-08-07): the host card is untouched and the gem
    // delivers exactly its printed number. Full rules in gemStrike.test.ts.
    const gem = { kind: 'effect', id: 'soul_rend_echo', rarity: 'legendary', actions: [{ kind: 'damage', power: 16 }] } as const satisfies Gem;
    for (const attack of [10, 20, 50]) {
      const bare = sum(firstCastHits(castOnce('twin_slash', { attack })));
      const gemmed = sum(firstCastHits(castOnce('twin_slash', { attack }, { gem })));
      expect(gemmed - bare).toBe(16);
      // The two-hit host still splits ITS stat between ITS OWN two hits only —
      // the gem is a third hit but the divisor stays 2.
      expect(firstCastHits(castOnce('twin_slash', { attack }, { gem }))).toEqual([
        ...firstCastHits(castOnce('twin_slash', { attack })), 16,
      ]);
      // ...and on a single-hit host the base hit keeps the WHOLE stat.
      const bare1 = sum(firstCastHits(castOnce('sword_slash', { attack })));
      const gemmed1 = sum(firstCastHits(castOnce('sword_slash', { attack }, { gem })));
      expect(gemmed1 - bare1).toBe(16);
    }
  });

  it('TRUE damage: defense is capped at THIS HIT\'s share, so a cast never loses more than its whole stat', () => {
    // soul_rend is TRUE and single-hit, so it keeps its whole stat (20) and
    // armor eats up to exactly that, leaving its flat base 27. The gem's hit is
    // pure flat 16 — all base, no stat add — so armor never touches it.
    const gem = { kind: 'effect', id: 'soul_rend_echo', rarity: 'legendary', actions: [{ kind: 'damage', power: 16 }] } as const satisfies Gem;
    const hits = firstCastHits(castOnce('soul_rend', { attack: 20, magicPower: 0 }, { gem, armor: 99 }));
    expect(hits).toEqual([27, 16]);
  });

  it('AoE fan-out does NOT advance the split: every foe takes the same per-hit shares', () => {
    const book: SkillBook = {
      twin_sweep: {
        id: 'twin_sweep',
        name: 'Twin Sweep',
        archetypes: ['offense'],
        property: 'physical',
        size: 1,
        rarity: 'common',
        tier: 'bronze',
        weapon: 'sword',
        scope: 'all',
        effects: [{ kind: 'damage', power: 5 }, { kind: 'damage', power: 5 }],
        text: '',
      },
    };
    // ATK 21 splits 11/10. Three foes: hit 1 lands 16 on each, then hit 2 lands 15
    // on each — the ordinal advances per ACTION, never per target.
    expect(firstCastHits(castOnce('twin_sweep', { attack: 21 }, { book, foes: 3 }))).toEqual([16, 16, 16, 15, 15, 15]);
  });

  it('the reported calculation parts still telescope to the damage dealt on a split hit', () => {
    for (const calc of firstCastCalcs(castOnce('twin_slash', { attack: 21 }, { armor: 3 }))) {
      expect(calc.baseDamage).toBe(calc.power + calc.baseStat);
      expect(calc.statBonusDamage).toBe(0); // no buffs: effective share === base share
      const derived =
        calc.baseDamage +
        calc.statBonusDamage +
        calc.effectBonusDamage -
        calc.defense +
        calc.minimumDamageBonus +
        calc.matchupBonusDamage +
        calc.suddenDeathBonusDamage -
        calc.guardReduction +
        (calc.exposeBonus ?? 0) -
        calc.shieldBlocked;
      expect(derived).toBe(calc.hpDamage);
    }
  });
});

describe('multi-hit: what the split deliberately does NOT touch (user-locked 2026-08-07)', () => {
  it('a card-scope FLAT-damage gem still applies IN FULL to every hit ("i am fine with the extra +16")', () => {
    // war_banner_echo is a card-scope STAT gem (mods.damageFlat), a different
    // path from an effect gem's appended action: it is NOT split, so on a 2-hit
    // card a +4 gem still delivers +8. Pinned so the decision cannot drift.
    const gem = { kind: 'stat', id: 'war_banner_echo', rarity: 'rare', scope: 'card', mods: { card: { damageFlat: 4 } } } as const satisfies Gem;
    const bare = sum(firstCastHits(castOnce('twin_slash', { attack: 20 })));
    const gemmed = sum(firstCastHits(castOnce('twin_slash', { attack: 20 }, { gem })));
    expect(gemmed - bare).toBe(8); // 4 per hit x 2 hits, NOT 4
    // On a single-hit host the same gem is worth its printed +4.
    const bare1 = sum(firstCastHits(castOnce('sword_slash', { attack: 20 })));
    const gemmed1 = sum(firstCastHits(castOnce('sword_slash', { attack: 20 }, { gem })));
    expect(gemmed1 - bare1).toBe(4);
  });
});
