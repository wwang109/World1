import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { resolveEffectiveSkill } from '../../src/engine/cards';
import { actionsPriceDeci, gemPowerLevelDeci, isGemOnBudget, PRICE, RARITY_PL_DECI } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { BoardPiece, Gem, Rarity, SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

// GEM-APPENDED HITS (user-locked 2026-08-07). Two rules, one seam.
//
//  1. PROVENANCE — `resolveEffectiveSkill` stamps `fromGem` on every action an
//     effect gem appends (src/engine/cards.ts). The core loop reads that one
//     flag; it never learns what a gem is.
//  2. ISOLATION — a stamped hit is SELF-CONTAINED: outside the multi-hit stat
//     split's divisor (so the host card's own hit keeps its full stat, exactly
//     as if the socket were empty) and taking NO attacker-side add — no stat
//     share, no `mods.damageFlat`, no triggered `comboBonus`. The user's words:
//     "so it cant be buffed".
//
// `statStrike` is the payload built for that seam: an extra hit for ONE SHARE
// of a `shareOf`-way split of the caster's scaling stat, optionally capped.

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

/** One caster (optionally with extra board pieces) vs an inert wall. */
function castOnce(
  skillId: string,
  stats: { attack?: number; magicPower?: number },
  opts: {
    gem?: Gem;
    armor?: number;
    magicResist?: number;
    book?: SkillBook;
    /** Extra pieces placed AFTER the cast card (auras, combo partners). */
    extraPieces?: BoardPiece[];
    /** Enemy board (e.g. a negate card) — the wall stays otherwise inert. */
    wallSkills?: string[];
    wallSpeed?: number;
    maxTurns?: number;
  } = {},
): CombatEvent[] {
  const book = opts.book ?? skillBook;
  const hero = tc('hero', [], { ...stats, speed: 20, maxHp: 5000 }, {
    pieces: [
      { skillId, slot: 0, ...(opts.gem ? { gem: opts.gem } : {}) },
      ...(opts.extraPieces ?? []),
    ],
    skillBook: book,
  });
  const wall = tc('wall', opts.wallSkills ?? [], {
    maxHp: 5000,
    speed: opts.wallSpeed ?? 1,
    armor: opts.armor ?? 0,
    magicResist: opts.magicResist ?? 0,
  }, { skillBook: book });
  return simulate(
    { ...cfg(hero, wall, { ...NO_ENDGAME, maxTurns: opts.maxTurns ?? 8, skillBook: book }) },
    1,
  ).events;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const flatGem = (power: number): Gem =>
  ({ kind: 'effect', id: 'flat_echo', rarity: 'common', actions: [{ kind: 'damage', power }] });
const strikeGem = (shareOf: number, cap?: number): Gem =>
  ({ kind: 'effect', id: 'strike_echo', rarity: 'legendary', actions: [{ kind: 'statStrike', shareOf, ...(cap === undefined ? {} : { cap }) }] });

describe('gem-appended hits: the resolver seam stamps them', () => {
  it('marks ONLY the gem actions, and never mutates the shared content object', () => {
    const gem = strikeGem(2);
    const def = skillBook['twin_slash']!;
    const eff = resolveEffectiveSkill(def, { skillId: 'twin_slash', slot: 0, gem });
    expect(eff.effects).toHaveLength(3);
    expect(eff.effects[0]).not.toHaveProperty('fromGem');
    expect(eff.effects[1]).not.toHaveProperty('fromGem');
    expect(eff.effects[2]).toEqual({ kind: 'statStrike', shareOf: 2, fromGem: true });
    // The gem in src/data is shared across every piece that sockets it.
    expect(gem.kind === 'effect' && gem.actions[0]).not.toHaveProperty('fromGem');
    // Un-gemmed pieces still resolve to the SAME reference (byte-identical path).
    expect(resolveEffectiveSkill(def, { skillId: 'twin_slash', slot: 0 })).toBe(def);
  });
});

describe('gem-appended hits: the host card\'s own hit is UNAFFECTED', () => {
  // The bug this rule fixes: while the appended hit counted in the multi-hit
  // divisor it STOLE stat from the base hit and ate a second round of armor,
  // so a "+4 damage" gem made sword_slash deal 4 LESS at DEF 8 and 9 less at
  // DEF 16. Proven both directions here: with the gem and without it.
  const hosts = ['sword_slash', 'twin_slash', 'barrage', 'crushing_blow'] as const;

  it('leaves every base hit byte-identical, for a FLAT gem and a STAT-STRIKE gem alike', () => {
    for (const host of hosts) {
      for (const attack of [1, 10, 20, 50]) {
        for (const armor of [0, 8, 16]) {
          const bare = firstCastHits(castOnce(host, { attack }, { armor }));
          for (const gem of [flatGem(4), flatGem(16), strikeGem(2), strikeGem(4, 6)]) {
            const gemmed = firstCastHits(castOnce(host, { attack }, { armor, gem }));
            // The card's own hits come first and are unchanged...
            expect(gemmed.slice(0, bare.length)).toEqual(bare);
            // ...and the gem added exactly ONE more hit.
            expect(gemmed).toHaveLength(bare.length + 1);
          }
        }
      }
    }
  });

  it('never makes the cast total go DOWN — the regression that started this rule', () => {
    for (const armor of [0, 4, 8, 16, 24]) {
      const bare = sum(firstCastHits(castOnce('sword_slash', { attack: 20 }, { armor })));
      for (const gem of [flatGem(4), strikeGem(2)]) {
        expect(sum(firstCastHits(castOnce('sword_slash', { attack: 20 }, { armor, gem })))).toBeGreaterThan(bare);
      }
    }
  });
});

describe('gem-appended FLAT damage lands its printed number and nothing else', () => {
  it('adds no stat term at any Attack', () => {
    for (const attack of [0, 1, 10, 20, 50]) {
      const hits = firstCastHits(castOnce('sword_slash', { attack }, { gem: flatGem(4) }));
      expect(hits[hits.length - 1]).toBe(4);
    }
  });

  it('takes NO board-aura damageFlat (war_banner projects +10 onto its neighbor)', () => {
    // war_banner sits adjacent to the caster and grants +10 damage to offense
    // cards; it must reach the card's OWN hit and not the gem's.
    const banner: BoardPiece = { skillId: 'war_banner', slot: 1 };
    const plainBase = firstCastHits(castOnce('sword_slash', { attack: 20 }))[0]!;
    const auraHits = firstCastHits(castOnce('sword_slash', { attack: 20 }, { extraPieces: [banner], gem: flatGem(4) }));
    expect(auraHits[0]).toBe(plainBase + 10); // the card's own hit IS buffed
    expect(auraHits[1]).toBe(4); // the gem's hit is NOT
  });

  it('takes NO triggered comboBonus (follow_through carries +20 on an archetype match)', () => {
    // follow_through casts twice in a row here; the second cast's comboBonus
    // triggers off the first (both `offense`).
    const events = castOnce('follow_through', { attack: 20 }, { gem: flatGem(4), maxTurns: 12 });
    const casts: number[][] = [];
    let current: number[] | null = null;
    for (const e of events) {
      if (e.kind === 'skillCast' && e.side === 'player') casts.push((current = []));
      if (current && e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill') current.push(e.amount);
    }
    // Cast 1: no previous cast, no combo. Cast 2: +20 combo on the card's hit.
    expect(casts[0]).toEqual([30, 4]);
    expect(casts[1]).toEqual([50, 4]);
  });

  it('is FLAT on a TRUE card too — its whole payload bypasses defense (no stat add to mitigate)', () => {
    // annihilation_strike is TRUE: the flat base bypasses, the stat add does not.
    // A gem-appended flat hit is ALL flat base, so armor never touches it.
    for (const armor of [0, 8, 99]) {
      const hits = firstCastHits(castOnce('annihilation_strike', { attack: 20, magicPower: 0 }, { armor, gem: flatGem(4) }));
      expect(hits[hits.length - 1]).toBe(4);
    }
  });
});

describe('statStrike: one SHARE of the caster\'s scaling stat', () => {
  it('shareOf 2 is half the Attack, rounded the SAME way the multi-hit split rounds (front-loaded)', () => {
    for (const [attack, expected] of [[0, 1], [1, 1], [10, 5], [20, 10], [21, 11], [30, 15], [50, 25]] as const) {
      const hits = firstCastHits(castOnce('sword_slash', { attack }, { gem: strikeGem(2) }));
      // ATK 0 lands 1: the minimum-damage floor, never a skipped hit.
      expect(hits[hits.length - 1]).toBe(expected);
    }
  });

  it('shareOf 3 / 4 are the corresponding unit fractions', () => {
    expect(firstCastHits(castOnce('sword_slash', { attack: 30 }, { gem: strikeGem(3) })).at(-1)).toBe(10);
    expect(firstCastHits(castOnce('sword_slash', { attack: 30 }, { gem: strikeGem(4) })).at(-1)).toBe(8); // ceil(30/4)
  });

  it('shareOf clamps at 1 = the WHOLE stat: no strike can ever exceed one stat add', () => {
    for (const shareOf of [1, 0, -3]) {
      expect(firstCastHits(castOnce('sword_slash', { attack: 30 }, { gem: strikeGem(shareOf) })).at(-1)).toBe(30);
    }
  });

  it('`cap` is a hard ceiling applied after the share — it scales, then plateaus', () => {
    const capped = (attack: number) => firstCastHits(castOnce('sword_slash', { attack }, { gem: strikeGem(2, 12) })).at(-1);
    expect(capped(10)).toBe(5); // under the cap: the plain share
    expect(capped(24)).toBe(12); // exactly at the cap
    expect(capped(50)).toBe(12); // over: clamped, never more than the printed cap
  });

  it('reads the property\'s OFFENSE stat: magical strikes scale off Magic Power', () => {
    expect(firstCastHits(castOnce('shadow_bolt', { attack: 40, magicPower: 20 }, { gem: strikeGem(2) })).at(-1)).toBe(10);
    expect(firstCastHits(castOnce('sword_slash', { attack: 20, magicPower: 40 }, { gem: strikeGem(2) })).at(-1)).toBe(10);
  });

  it('is MITIGATED like any hit — it is all stat add, so a TRUE strike is fully defended against', () => {
    // sword_slash (physical): flat armor subtract, floored at 1.
    expect(firstCastHits(castOnce('sword_slash', { attack: 20 }, { gem: strikeGem(2), armor: 4 })).at(-1)).toBe(6);
    expect(firstCastHits(castOnce('sword_slash', { attack: 20 }, { gem: strikeGem(2), armor: 30 })).at(-1)).toBe(1);
    // annihilation_strike (TRUE): defense eats up to the stat add, and the
    // strike IS entirely stat add — the mirror of the flat gem above.
    expect(firstCastHits(castOnce('annihilation_strike', { attack: 20, magicPower: 0 }, { gem: strikeGem(2), armor: 99 })).at(-1)).toBe(1);
  });

  it('takes NO board aura and NO comboBonus either', () => {
    const banner: BoardPiece = { skillId: 'war_banner', slot: 1 };
    const hits = firstCastHits(castOnce('sword_slash', { attack: 20 }, { extraPieces: [banner], gem: strikeGem(2) }));
    expect(hits[0]).toBe(40 + 10); // 20 base + 20 ATK + 10 aura
    expect(hits[1]).toBe(10); // half of ATK 20, aura-free
  });

  it('DOES follow an Attack BUFF — the stat is its input, not a bonus stacked on it', () => {
    // A stat buff raises the caster's Attack, so half of it rises too. That is
    // the stat working as designed, not the "cant be buffed" rule leaking: the
    // rule excludes flat DAMAGE adds (aura / gem damageFlat / combo), not the
    // scaling stat the effect is defined in terms of.
    const book: SkillBook = {
      rally: {
        id: 'rally', name: 'Rally', archetypes: ['support'], property: 'physical', size: 1,
        speedWeight: 5, rarity: 'common', tier: 'bronze', weapon: 'sword',
        effects: [{ kind: 'buffStat', stat: 'attack', pct: 100, turns: 5 }], text: '',
      },
      strike: {
        id: 'strike', name: 'Strike', archetypes: ['offense'], property: 'physical', size: 1,
        speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword',
        effects: [{ kind: 'damage', power: 0 }], text: '',
      },
    };
    const events = castOnce('rally', { attack: 20 }, {
      book,
      extraPieces: [{ skillId: 'strike', slot: 1, gem: strikeGem(2) }],
      maxTurns: 6,
    });
    const hits = events.filter((e) => e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill');
    // After +100% Attack (20 -> 40): the card's own hit is 40, the strike is 20.
    expect((hits[0] as { amount: number }).amount).toBe(40);
    expect((hits[1] as { amount: number }).amount).toBe(20);
  });
});

describe('instance count is a resource: negate is spent PER HIT', () => {
  // `negate` cancels ONE direct hit of the matching property per charge. That is
  // what an extra INSTANCE buys, and it is what PRICE.extraHitPremium now pays
  // for (the old "each hit re-delivers the full stat" rationale died with the
  // multi-hit stat split).
  const NEGATE_BOOK: SkillBook = {
    ward: {
      id: 'ward', name: 'Ward', archetypes: ['defensive'], property: 'physical', size: 1,
      speedWeight: 5, rarity: 'common', tier: 'bronze', weapon: 'sword',
      effects: [{ kind: 'negate', property: 'physical', charges: 1 }], text: '',
    },
    ward2: {
      id: 'ward2', name: 'Ward II', archetypes: ['defensive'], property: 'physical', size: 1,
      speedWeight: 5, rarity: 'common', tier: 'bronze', weapon: 'sword',
      effects: [{ kind: 'negate', property: 'physical', charges: 2 }], text: '',
    },
    onehit: {
      id: 'onehit', name: 'One Hit', archetypes: ['offense'], property: 'physical', size: 1,
      speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword',
      effects: [{ kind: 'damage', power: 20 }], text: '',
    },
    twohit: {
      id: 'twohit', name: 'Two Hit', archetypes: ['offense'], property: 'physical', size: 1,
      speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword',
      effects: [{ kind: 'damage', power: 10 }, { kind: 'damage', power: 10 }], text: '',
    },
  };

  /** Negations and landed hits of the caster's FIRST cast against a warded wall. */
  function vsWard(skillId: string, ward: string, gem?: Gem): { negated: number; landed: number[] } {
    // The wall casts its ward first (speed 30 vs the hero's 20), then stands still.
    const events = castOnce(skillId, { attack: 10 }, {
      book: NEGATE_BOOK, gem, wallSkills: [ward], wallSpeed: 30, maxTurns: 4,
    });
    let casts = 0;
    let negated = 0;
    const landed: number[] = [];
    for (const e of events) {
      if (e.kind === 'skillCast' && e.side === 'player') {
        casts += 1;
        if (casts > 1) break;
      }
      if (casts !== 1) continue;
      if (e.kind === 'negated' && e.side === 'enemy') negated += 1;
      if (e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill') landed.push(e.amount);
    }
    return { negated, landed };
  }

  it('a 1-hit cast is BLANKED by one charge; a 2-hit cast burns the charge and lands the second', () => {
    expect(vsWard('onehit', 'ward')).toEqual({ negated: 1, landed: [] });
    expect(vsWard('twohit', 'ward')).toEqual({ negated: 1, landed: [15] }); // 10 base + 5 (half of ATK 10)
  });

  it('a 2-hit cast burns BOTH charges of a 2-charge ward, where a 1-hit cast burns one', () => {
    expect(vsWard('onehit', 'ward2')).toEqual({ negated: 1, landed: [] });
    expect(vsWard('twohit', 'ward2')).toEqual({ negated: 2, landed: [] });
  });

  it('a GEM-appended hit is a real instance: it spends a charge like any other', () => {
    // One charge, one card hit, one gem hit -> the card's hit is negated and the
    // gem's lands. The socket bought an instance, not just damage.
    expect(vsWard('onehit', 'ward', flatGem(4))).toEqual({ negated: 1, landed: [4] });
    expect(vsWard('onehit', 'ward', strikeGem(2))).toEqual({ negated: 1, landed: [5] });
    // Two charges eat both instances.
    expect(vsWard('onehit', 'ward2', flatGem(4))).toEqual({ negated: 2, landed: [] });
  });
});

describe('statStrike pricing: capped is exact, UNCAPPED is deliberately unbuyable', () => {
  it('a capped strike prices exactly like a flat damage action of that cap', () => {
    for (const cap of [2, 4, 8, 12]) {
      expect(actionsPriceDeci([{ kind: 'statStrike', shareOf: 2, cap }], 'physical'))
        .toBe(cap * PRICE.flatPowerPerPoint);
      // ...and the cap, not the share, is what is charged: a bigger fraction of
      // the same ceiling costs the same, because the ceiling is what it can do.
      expect(actionsPriceDeci([{ kind: 'statStrike', shareOf: 4, cap }], 'physical'))
        .toBe(cap * PRICE.flatPowerPerPoint);
    }
  });

  it('an UNCAPPED strike prices at 0 and therefore misses EVERY rarity band', () => {
    const uncapped = strikeGem(2);
    expect(gemPowerLevelDeci(uncapped)).toBe(0);
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
      expect(isGemOnBudget({ ...uncapped, rarity })).toBe(false);
    }
  });

  it('a capped strike CAN land on a rarity band exactly (Epic = 6 PL = cap 12)', () => {
    const gem: Gem = { kind: 'effect', id: 'half_strike', rarity: 'epic', actions: [{ kind: 'statStrike', shareOf: 2, cap: 12 }] };
    expect(gemPowerLevelDeci(gem)).toBe(RARITY_PL_DECI.epic);
    expect(isGemOnBudget(gem)).toBe(true);
  });

  it('a second damage INSTANCE on one card pays the multi-hit premium, statStrike included', () => {
    const two = actionsPriceDeci(
      [{ kind: 'damage', power: 10 }, { kind: 'statStrike', shareOf: 2, cap: 4 }],
      'physical',
    );
    expect(two).toBe(10 * PRICE.flatPowerPerPoint + 4 * PRICE.flatPowerPerPoint + PRICE.extraHitPremium);
  });
});
