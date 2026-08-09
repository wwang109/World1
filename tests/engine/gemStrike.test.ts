import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { resolveEffectiveSkill } from '../../src/engine/cards';
import { ownDamagePower, statShare } from '../../src/engine/combat/interpreter';
import {
  actionsPriceDeci,
  echoHostShareDeci,
  gemPowerLevelDeci,
  instancePowerLevelDeci,
  isGemOnBudget,
  powerLevelDeci,
  PRICE,
  RARITY_PL_DECI,
} from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import type { CombatEvent } from '../../src/engine/combat/events';
import { weightOf, type BoardPiece, type CombatantStats, type Gem, type Rarity, type SkillBook } from '../../src/engine/types';
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
/** THE ECHO: one share of the host's WHOLE attack (its own flat base + the caster's stat). */
const echoGem = (shareOf = 2, opts: { cap?: number; weightIncreasePct?: number } = {}): Gem => ({
  kind: 'effect',
  id: 'echo',
  rarity: 'legendary',
  actions: [{ kind: 'statStrike', shareOf, echoHostPower: true, ...(opts.cap === undefined ? {} : { cap: opts.cap }) }],
  ...(opts.weightIncreasePct === undefined ? {} : { weightIncreasePct: opts.weightIncreasePct }),
});
/** The rule, stated once: `ceil((hostBase + stat) / shareOf)` in exact integers. */
const echoOf = (hostBase: number, stat: number, shareOf = 2): number => Math.ceil((hostBase + stat) / shareOf);

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

// GEM-APPENDED HEAL / SHIELD (gem ruleset v1 §0.B / §7.6 / §9.4, engine fix
// 2026-08-09). The same "a gem's printed payload is its WHOLE payload" rule the
// `damage` case has always obeyed, now applied to the two support payloads that
// silently did not: before this fix a gem heal/shield still picked up the
// CASTER's defensive stat (`scaleDefStat`) and the board's `mods.healFlat`, so a
// Common "+4 HP" gem healed 34 on a DEF-30 hero — 4x a Legendary Core's +8 —
// and a gem's PL became a function of the host it was socketed into, which is
// exactly what GEM_CANONICAL_PROPERTY's host-independence rule forbids.
//
// What did NOT change: the anti-heal world rule. A gem heal is still a REGULAR
// heal, so the receiver's afflictions tax it exactly as they tax any other.
describe('gem-appended heal/shield land their printed number and nothing else', () => {
  const SUPPORT_BOOK: SkillBook = {
    mend: {
      id: 'mend', name: 'Mend', archetypes: ['healing'], property: 'physical', size: 1,
      speedWeight: 10, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'heal', power: 4 }], text: '',
    },
    plate: {
      id: 'plate', name: 'Plate', archetypes: ['defensive'], property: 'physical', size: 1,
      speedWeight: 10, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'shield', power: 4 }], text: '',
    },
    mystmend: {
      id: 'mystmend', name: 'Myst Mend', archetypes: ['healing'], property: 'magical', size: 1,
      speedWeight: 10, rarity: 'common', tier: 'bronze', element: 'holy',
      effects: [{ kind: 'heal', power: 4 }], text: '',
    },
    truemend: {
      id: 'truemend', name: 'True Mend', archetypes: ['healing'], property: 'true', size: 1,
      speedWeight: 10, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'heal', power: 4 }], text: '',
    },
    // Pure passive aura (same shape as the book's own war_banner), projecting a
    // FLAT heal bonus onto its neighbour — `mods.healFlat`, the second term a
    // gem heal used to inherit.
    chapel: {
      id: 'chapel', name: 'Chapel', archetypes: ['support'], property: 'physical', size: 1,
      speedWeight: 5, rarity: 'common', tier: 'bronze',
      effects: [], aura: { affects: 'adjacent', mods: { healFlat: 6 } }, text: '',
    },
    // The wall's affliction, to switch the anti-heal world rule on.
    venom: {
      id: 'venom', name: 'Venom', archetypes: ['debuff'], property: 'physical', size: 1,
      speedWeight: 5, rarity: 'common', tier: 'bronze',
      effects: [{ kind: 'poison', stacks: 3 }], text: '',
    },
  };

  const healGem = (power: number): Gem =>
    ({ kind: 'effect', id: 'heal_gem', rarity: 'common', actions: [{ kind: 'heal', power }] });
  const shieldGem = (power: number): Gem =>
    ({ kind: 'effect', id: 'shield_gem', rarity: 'common', actions: [{ kind: 'shield', power }] });

  /** One hero (stats fully controllable, unlike `castOnce`) vs an optionally-armed wall. */
  function support(
    skillId: string,
    heroStats: Partial<CombatantStats>,
    opts: { gem?: Gem; extraPieces?: BoardPiece[]; wallSkills?: string[]; wallSpeed?: number; maxTurns?: number } = {},
  ): CombatEvent[] {
    const hero = tc('hero', [], { speed: 20, maxHp: 5000, ...heroStats }, {
      pieces: [
        { skillId, slot: 0, ...(opts.gem ? { gem: opts.gem } : {}) },
        ...(opts.extraPieces ?? []),
      ],
      skillBook: SUPPORT_BOOK,
    });
    const wall = tc('wall', opts.wallSkills ?? [], { maxHp: 5000, speed: opts.wallSpeed ?? 1 }, { skillBook: SUPPORT_BOOK });
    return simulate(
      { ...cfg(hero, wall, { ...NO_ENDGAME, maxTurns: opts.maxTurns ?? 3, skillBook: SUPPORT_BOOK }) },
      1,
    ).events;
  }

  type HealEvent = Extract<CombatEvent, { kind: 'heal' }>;
  type ShieldEvent = Extract<CombatEvent, { kind: 'shieldGain' }>;
  /** Every heal the hero ATTEMPTED on its first cast (amount + overheal — the hero is at full HP). */
  const healsOfFirstCast = (events: CombatEvent[]): HealEvent[] => {
    const out: HealEvent[] = [];
    let casts = 0;
    for (const e of events) {
      if (e.kind === 'skillCast' && e.side === 'player') {
        casts += 1;
        if (casts > 1) break;
      }
      if (casts === 1 && e.kind === 'heal' && e.side === 'player') out.push(e);
    }
    return out;
  };
  const attempted = (e: HealEvent): number => e.amount + e.overheal;
  const shieldsOfFirstCast = (events: CombatEvent[]): ShieldEvent[] => {
    const out: ShieldEvent[] = [];
    let casts = 0;
    for (const e of events) {
      if (e.kind === 'skillCast' && e.side === 'player') {
        casts += 1;
        if (casts > 1) break;
      }
      if (casts === 1 && e.kind === 'shieldGain' && e.side === 'player') out.push(e);
    }
    return out;
  };

  it('a gem HEAL lands its printed power at any defensive stat — the host card\'s own heal still scales', () => {
    // ONE cast, TWO heals: the card's own (4 + Armor) and the gem's (10, flat).
    // The old inheritance bug is the second number moving with `armor`.
    for (const armor of [0, 8, 30]) {
      const heals = healsOfFirstCast(support('mend', { armor }, { gem: healGem(10) }));
      expect(heals).toHaveLength(2);
      expect(attempted(heals[0]!)).toBe(4 + armor); // the CARD still inherits — unchanged
      expect(attempted(heals[1]!)).toBe(10); // the GEM does not — this is the fix
      expect(heals[1]!.calculation).toEqual({ power: 10, statBonus: 0, healFlat: 0, property: 'physical' });
    }
    // The headline case from the ruleset: a "+4 HP" gem on a DEF-30 hero heals 4, not 34.
    expect(attempted(healsOfFirstCast(support('mend', { armor: 30 }, { gem: healGem(4) }))[1]!)).toBe(4);
  });

  it('reads no stat on a MAGICAL host either (Magic Resist is the defensive stat there)', () => {
    for (const magicResist of [0, 30]) {
      const heals = healsOfFirstCast(support('mystmend', { magicResist }, { gem: healGem(10) }));
      expect(attempted(heals[0]!)).toBe(4 + magicResist);
      expect(attempted(heals[1]!)).toBe(10);
    }
  });

  it('takes NO board-aura healFlat (chapel projects +6 onto its neighbour)', () => {
    const chapel: BoardPiece = { skillId: 'chapel', slot: 1 };
    const heals = healsOfFirstCast(support('mend', { armor: 30 }, { gem: healGem(10), extraPieces: [chapel] }));
    expect(attempted(heals[0]!)).toBe(4 + 30 + 6); // card: base + Armor + aura healFlat
    expect(attempted(heals[1]!)).toBe(10); // gem: printed power, nothing else
  });

  it('is STILL taxed by the anti-heal world rule — a gem heal is a regular heal', () => {
    // The wall poisons the hero first (speed 30 vs 20), so one affliction
    // category is active when the heal lands: −20%, floored reduction.
    const poisoned = healsOfFirstCast(support('mend', { armor: 30 }, {
      gem: healGem(10), wallSkills: ['venom'], wallSpeed: 30,
    }));
    expect(attempted(poisoned[1]!)).toBe(8); // 10 − floor(10 × 20 / 100)
    expect(poisoned[1]!.antiHeal).toEqual({ categories: ['dot'], pct: 20, reduced: 2 });
    // And the card's own heal is taxed on the same request as before: 34 − 6.
    expect(attempted(poisoned[0]!)).toBe(28);
  });

  it('on a TRUE host a gem heal stays flat AND irreducible, exactly like the card\'s own', () => {
    const heals = healsOfFirstCast(support('truemend', { armor: 30 }, {
      gem: healGem(10), wallSkills: ['venom'], wallSpeed: 30,
    }));
    expect(heals.map(attempted)).toEqual([4, 10]);
    for (const h of heals) {
      expect(h.flat).toBe(true);
      expect(h.antiHeal).toBeUndefined();
    }
  });

  it('a gem SHIELD lands its printed power flat — the host card\'s own shield still scales', () => {
    for (const armor of [0, 8, 30]) {
      const shields = shieldsOfFirstCast(support('plate', { armor }, { gem: shieldGem(10) }));
      expect(shields).toHaveLength(2);
      expect(shields[0]!.amount).toBe(4 + armor); // the CARD still inherits
      expect(shields[1]!.amount).toBe(10); // the GEM does not
      expect(shields[1]!.calculation).toEqual({ power: 10, statBonus: 0 });
    }
  });

  it('gem heal/shield are HOST-INDEPENDENT: the same gem delivers the same number on every host', () => {
    // The property this fix exists to restore, stated directly — one gem, four
    // hosts spanning both typed properties and both defensive stats, one number.
    const hosts = ['mend', 'mystmend', 'truemend'] as const;
    const delivered = hosts.map((h) => attempted(healsOfFirstCast(support(h, { armor: 30, magicResist: 30 }, { gem: healGem(10) })).at(-1)!));
    expect(delivered).toEqual([10, 10, 10]);
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

// THE ECHO FORM (`echoHostPower`, user intent 2026-08-08: "echo is suppose to
// perform a secondary atk at 50% less"). The payload is one share of the WHOLE
// attack — the host card's own flat base PLUS the caster's stat — so the gem
// repeats whatever it is socketed into instead of adding a fixed number.
describe('statStrike echo: one share of the host\'s WHOLE attack', () => {
  // Every host's own printed base, read the way the engine reads it.
  const HOSTS = [
    { id: 'sword_slash', base: 20 }, // 1 hit, base 20
    { id: 'twin_slash', base: 12 }, // 2 hits of 6 — echoes as ONE share of 12
    { id: 'barrage', base: 48 }, // 2 hits of 24
    { id: 'crushing_blow', base: 96 }, // the heaviest card in the book
    { id: 'static_jolt', base: 16 }, // magical: scales off Magic Power
  ] as const;

  it('the book\'s own numbers are the ones this suite asserts against', () => {
    for (const { id, base } of HOSTS) expect(ownDamagePower(skillBook[id]!.effects)).toBe(base);
  });

  it('lands ceil((hostBase + stat) / shareOf) on every host — 20 on Sword Slash, 58 on Crushing Blow', () => {
    for (const { id, base } of HOSTS) {
      for (const stat of [0, 1, 10, 20, 50]) {
        const hits = firstCastHits(castOnce(id, { attack: stat, magicPower: stat }, { gem: echoGem() }));
        expect(hits.at(-1)).toBe(Math.max(1, echoOf(base, stat)));
      }
    }
    // The two anchors from the design conversation, spelled out.
    expect(firstCastHits(castOnce('sword_slash', { attack: 20 }, { gem: echoGem() }))).toEqual([40, 20]);
    expect(firstCastHits(castOnce('crushing_blow', { attack: 20 }, { gem: echoGem() }))).toEqual([116, 58]);
  });

  it('scales with the HOST, which is the whole point: same hero, 5 hosts, 5 different echoes', () => {
    const echoes = HOSTS.map(({ id }) => firstCastHits(castOnce(id, { attack: 20, magicPower: 20 }, { gem: echoGem() })).at(-1));
    expect(echoes).toEqual([20, 16, 34, 58, 18]);
  });

  it('leaves the host card\'s own hits byte-identical — it is outside the multi-hit divisor', () => {
    for (const { id } of HOSTS) {
      for (const attack of [1, 10, 20, 50]) {
        for (const armor of [0, 8, 16]) {
          const stats = { attack, magicPower: attack };
          const bare = firstCastHits(castOnce(id, stats, { armor, magicResist: armor }));
          const gemmed = firstCastHits(castOnce(id, stats, { armor, magicResist: armor, gem: echoGem() }));
          expect(gemmed.slice(0, bare.length)).toEqual(bare);
          expect(gemmed).toHaveLength(bare.length + 1);
        }
      }
    }
  });

  it('is HIT-COUNT-INVARIANT: Twin Slash\'s 6 + 6 echoes as one share of 12, not twice', () => {
    // 2 hits of 6, ATK 20 -> the card hits 16 twice; the echo is ceil((12+20)/2) = 16 ONCE.
    expect(firstCastHits(castOnce('twin_slash', { attack: 20 }, { gem: echoGem() }))).toEqual([16, 16, 16]);
    // rapid_volley is also 2 damage actions (10 + 10) — same rule, no double count.
    expect(firstCastHits(castOnce('rapid_volley', { attack: 20 }, { gem: echoGem() }))).toEqual([20, 20, 20]);
  });

  // ROUNDING (locked): ONE share of the SUM, then split back into a base term
  // and a stat term — NOT a share of each term. Sharing each separately rounds
  // BOTH up under the front-loaded rule and hands the echo a free point whenever
  // base and stat are both odd. This is the test that would catch that.
  it('rounds ONCE, on the sum: an odd base and an odd stat never buy a free point', () => {
    // purging_strike base 9. At ATK 21 the attack is 30 and half of it is 15.
    // Per-term rounding would give ceil(9/2) + ceil(21/2) = 5 + 11 = 16.
    expect(firstCastHits(castOnce('purging_strike', { attack: 21 }, { gem: echoGem() })).at(-1)).toBe(15);
    // soul_rend base 27 at ATK 21: attack 48, echo 24. Per-term would give 25.
    expect(firstCastHits(castOnce('soul_rend', { attack: 21 }, { gem: echoGem() })).at(-1)).toBe(24);
    // And the remainder is FRONT-LOADED like every other share in the engine:
    // an odd SUM rounds the echo UP, never down (sword_slash 20 at ATK 21 = 41 -> 21).
    expect(firstCastHits(castOnce('sword_slash', { attack: 21 }, { gem: echoGem() })).at(-1)).toBe(21);
  });

  it('never floors to zero: the minimum-damage rule still lands the hit at 1', () => {
    // A base-0 host at ATK 0 has nothing to echo at all — it still lands for 1,
    // exactly as a plain statStrike does, and never a skipped/absent hit.
    const book: SkillBook = {
      nothing: {
        id: 'nothing', name: 'Nothing', archetypes: ['offense'], property: 'physical', size: 1,
        speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword',
        effects: [{ kind: 'damage', power: 0 }], text: '',
      },
    };
    expect(firstCastHits(castOnce('nothing', { attack: 0 }, { book, gem: echoGem() }))).toEqual([1, 1]);
    // shareOf 4 of a 1-point attack is 1 (front-loaded), never 0.
    expect(firstCastHits(castOnce('nothing', { attack: 1 }, { book, gem: echoGem(4) })).at(-1)).toBe(1);
  });

  it('degrades gracefully on a host with no damage action: a plain stat strike', () => {
    // iron_bulwark only shields, so there is no attack to echo — the payload
    // falls back to the share of the stat alone (and equals the un-echoed gem).
    for (const attack of [10, 21]) {
      const echoed = firstCastHits(castOnce('iron_bulwark', { attack }, { gem: echoGem() }));
      const plain = firstCastHits(castOnce('iron_bulwark', { attack }, { gem: strikeGem(2) }));
      expect(echoed).toEqual(plain);
      expect(echoed).toEqual([Math.ceil(attack / 2)]);
    }
  });

  it('echoes what the card PRINTS: never the gem\'s own hit, never a board aura, never a combo', () => {
    // (a) A gem that appends BOTH a flat hit and an echo must not echo its own
    //     flat hit: sword_slash's echo stays ceil((20+20)/2) = 20, not 28.
    const both: Gem = {
      kind: 'effect', id: 'both', rarity: 'legendary',
      actions: [{ kind: 'damage', power: 16 }, { kind: 'statStrike', shareOf: 2, echoHostPower: true }],
    };
    expect(firstCastHits(castOnce('sword_slash', { attack: 20 }, { gem: both }))).toEqual([40, 16, 20]);

    // (b) war_banner projects +10 damage onto its neighbour. The card's own hit
    //     takes it; the echo does not (it reads the printed base 20, not 30).
    const banner: BoardPiece = { skillId: 'war_banner', slot: 1 };
    expect(firstCastHits(castOnce('sword_slash', { attack: 20 }, { extraPieces: [banner], gem: echoGem() })))
      .toEqual([50, 20]);

    // (c) follow_through's comboBonus (+20) triggers on its second cast. The
    //     card's hit moves 30 -> 50; the echo is ceil((10+20)/2) = 15 both times.
    const events = castOnce('follow_through', { attack: 20 }, { gem: echoGem(), maxTurns: 12 });
    const casts: number[][] = [];
    let current: number[] | null = null;
    for (const e of events) {
      if (e.kind === 'skillCast' && e.side === 'player') casts.push((current = []));
      if (current && e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill') current.push(e.amount);
    }
    expect(casts[0]).toEqual([30, 15]);
    expect(casts[1]).toEqual([50, 15]);
  });

  it('mirrors the host\'s TRUE rule: the echoed BASE bypasses defense, the echoed STAT does not', () => {
    // annihilation_strike is TRUE, base 48. At ATK 20 the attack is 68 and the
    // echo is 34 = 24 base (bypasses) + 10 stat (defended). Armor eats at most
    // the stat half — exactly the split the card's own hit gets.
    for (const [armor, expected] of [[0, 34], [4, 30], [10, 24], [99, 24]] as const) {
      expect(firstCastHits(castOnce('annihilation_strike', { attack: 20, magicPower: 0 }, { armor, gem: echoGem() })).at(-1))
        .toBe(expected);
    }
  });

  it('is mitigated as its OWN instance on a typed card — armor is paid twice per cast', () => {
    // The counterplay, stated as numbers (sword_slash, ATK 20: attack 40, echo 20).
    const at = (armor: number) => firstCastHits(castOnce('sword_slash', { attack: 20 }, { armor, gem: echoGem() }));
    expect(at(0)).toEqual([40, 20]);
    expect(at(8)).toEqual([32, 12]);
    expect(at(16)).toEqual([24, 4]);
    expect(at(24)).toEqual([16, 1]); // floored at 1: armor has fully eaten the echo
  });

  it('`cap` bounds the WHOLE payload, echoed base first', () => {
    // sword_slash base 20 -> the echoed base alone is 10 before any stat.
    const capped = (cap: number, attack: number) =>
      firstCastHits(castOnce('sword_slash', { attack }, { gem: echoGem(2, { cap }) })).at(-1);
    expect(capped(16, 0)).toBe(10); // base half only, under the cap
    expect(capped(16, 10)).toBe(15); // base 10 + stat 5
    expect(capped(16, 20)).toBe(16); // would be 20 — the stat term is trimmed
    expect(capped(16, 50)).toBe(16); // plateaus, never more than the printed cap
    expect(capped(4, 50)).toBe(4); // a cap below the echoed base clamps that too
  });

  it('a CAPPED echo is still priced by the flat-cap rule — the flag is invisible to actionsPriceDeci', () => {
    // A cap bounds the whole payload absolutely, so the proportional rate never
    // applies: the action prices exactly like a flat damage action of that cap.
    expect(actionsPriceDeci([{ kind: 'statStrike', shareOf: 2, cap: 12, echoHostPower: true }], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'statStrike', shareOf: 2, cap: 12 }], 'physical'));
    // As a GEM it now also pays the first hit's premium (§5): cap 10 × 5 + 30 = 80.
    expect(gemPowerLevelDeci(echoGem(2, { cap: 10 }))).toBe(RARITY_PL_DECI.legendary);
    expect(isGemOnBudget(echoGem(2, { cap: 10 }))).toBe(true);
    // A capped echo is host-INVARIANT by construction, so a host changes nothing.
    for (const id of ['sword_slash', 'crushing_blow', 'iron_bulwark'] as const) {
      expect(gemPowerLevelDeci(echoGem(2, { cap: 10 }), skillBook[id]!)).toBe(RARITY_PL_DECI.legendary);
    }
  });
});

// THE ECHO'S PRICE (gem ruleset v1 §5 + §6, 2026-08-09). The echo is the one
// gem allowed to append a hit, and its payload is proportional to a host the
// rarity band cannot see. So the price is SPLIT, deliberately, along the line
// of what each surface can know:
//
//  • BAND-CHECKABLE (host-blind): `PRICE.echoRepeatDeci / shareOf` — a
//    stand-in — plus `PRICE.extraHitPremium` for the instance. This is what
//    `isGemOnBudget` and the shop's gold price read, because neither has a host.
//    It CLASSIFIES ("is this Legendary-shaped?"); it does not account.
//  • INSTANCE-TIME (host known): `echoHostShareDeci` — the fraction of the
//    host's own damage line the echo repeats, at the host's own rate. This is
//    what `instancePowerLevelDeci` reads, so per-piece PL accounting is honest
//    on EVERY host instead of uniformly wrong.
describe('the Echo\'s price: a host-blind band, a host-proportional instance', () => {
  it('BAND: shareOf 2 lands on Legendary EXACTLY — 50 (repeat) + 30 (premium) = 80', () => {
    expect(Math.floor(PRICE.echoRepeatDeci / 2)).toBe(50);
    expect(gemPowerLevelDeci(echoGem(2))).toBe(50 + PRICE.extraHitPremium);
    expect(gemPowerLevelDeci(echoGem(2))).toBe(RARITY_PL_DECI.legendary);
    expect(isGemOnBudget(echoGem(2))).toBe(true);
    // ...and ONLY Legendary: no other rarity accepts the same payload.
    for (const rarity of ['common', 'rare', 'epic'] as Rarity[]) {
      expect(isGemOnBudget({ ...echoGem(2), rarity })).toBe(false);
    }
  });

  it('BAND: exactly ONE echo strength is priceable — every other shareOf misses every band', () => {
    const band = (shareOf: number): number => gemPowerLevelDeci(echoGem(shareOf));
    expect([band(1), band(2), band(3), band(4)]).toEqual([130, 80, 63, 55]);
    for (const shareOf of [1, 3, 4, 5, 8]) {
      for (const rarity of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
        expect(isGemOnBudget({ ...echoGem(shareOf), rarity }), `shareOf ${shareOf} / ${rarity}`).toBe(false);
      }
    }
  });

  it('INSTANCE: the echo term is the share of the host\'s OWN damage line, at the host\'s own rate', () => {
    // The band's flat 50 is a stand-in; on a real host the number is measured.
    const cases: Array<[string, number]> = [
      ['sword_slash', 50], // base 20 physical -> 10 echoed points x 5
      ['twin_slash', 30], // 6 + 6 = base 12 -> 6 x 5 (hit-count-invariant)
      ['barrage', 120], // base 48 -> 24 x 5
      ['crushing_blow', 240], // base 96 -> 48 x 5
      ['annihilation_strike', 240], // base 48 TRUE -> 24 x (5 + 5 true premium)
      ['iron_bulwark', 0], // no damage action: nothing to echo
    ];
    for (const [id, expected] of cases) {
      const def = skillBook[id]!;
      expect(echoHostShareDeci(def, 2), id).toBe(expected);
      expect(instancePowerLevelDeci(def, { gem: echoGem(2) }), id)
        .toBe(powerLevelDeci(def) + PRICE.extraHitPremium + expected);
    }
  });

  it('INSTANCE: the priced points are EXACTLY the flat base the engine delivers', () => {
    // At ATK 0 an echo's whole payload IS its echoed base, so the delivered
    // damage is the number the price charged for, point for point. This is the
    // assertion that keeps `echoHostShareDeci` honest against the interpreter.
    for (const id of ['sword_slash', 'twin_slash', 'barrage', 'crushing_blow'] as const) {
      const def = skillBook[id]!;
      const delivered = firstCastHits(castOnce(id, { attack: 0 }, { gem: echoGem(2) })).at(-1)!;
      expect(echoHostShareDeci(def, 2), id).toBe(delivered * PRICE.flatPowerPerPoint);
    }
  });

  it('INSTANCE: its share rule is the engine\'s own statShare, not a second rounding rule', () => {
    for (const id of Object.keys(skillBook)) {
      const def = skillBook[id]!;
      for (const shareOf of [1, 2, 3, 4]) {
        const points = statShare(ownDamagePower(def.effects), { index: 0, count: shareOf });
        const rate = PRICE.flatPowerPerPoint + (def.property === 'true' ? PRICE.truePremiumPerPoint : 0);
        expect(echoHostShareDeci(def, shareOf), `${id} / ${shareOf}`).toBe(points * rate);
      }
    }
  });

  it('a host changes NOTHING for any gem without an uncapped echo', () => {
    const others: Gem[] = [
      flatGem(4),
      strikeGem(2),
      strikeGem(2, 8),
      { kind: 'effect', id: 'p', rarity: 'common', actions: [{ kind: 'poison', stacks: 2 }] },
      { kind: 'stat', id: 's', rarity: 'common', scope: 'hero', mods: { hero: { attack: 2 } } },
    ];
    for (const gem of others) {
      for (const id of ['sword_slash', 'crushing_blow', 'annihilation_strike'] as const) {
        expect(gemPowerLevelDeci(gem, skillBook[id]!)).toBe(gemPowerLevelDeci(gem));
      }
    }
  });
});

// TEMPO COST (`weightIncreasePct`, user intent 2026-08-08: "maybe make it
// increase wt of skill too"). PROPORTIONAL, not flat, so that a gem whose
// benefit scales with its host has a cost that scales the same way — see the
// measured flat-vs-proportional sweep in `Gem.weightIncreasePct`.
describe('effect gem weightIncreasePct: the host card comes out later', () => {
  it('folds into the effective skill as base + floor(base × pct / 100)', () => {
    const cases: Array<[string, number, number]> = [
      ['static_jolt', 25, 7], // 6 + floor(1.5)
      ['twin_slash', 25, 10], // 8 + 2
      ['sword_slash', 25, 12], // 10 + 2
      ['sword_slash', 50, 15], // 10 + 5
      ['sword_slash', 100, 20], // 10 + 10
      ['barrage', 25, 32], // 26 + 6
      ['crushing_blow', 25, 37], // 30 + 7
      ['crushing_blow', 50, 45], // 30 + 15
    ];
    for (const [id, pct, expected] of cases) {
      const eff = resolveEffectiveSkill(skillBook[id]!, { skillId: id, slot: 0, gem: echoGem(2, { weightIncreasePct: pct }) });
      expect(weightOf(eff)).toBe(expected);
    }
  });

  it('never adds 0 for a positive pct — a printed weight increase always increases the weight', () => {
    // WEIGHT_MIN is 5, and floor(5 × 19 / 100) is 0; the clamp makes it 1.
    const light = { ...skillBook['sword_slash']!, id: 'light', speedWeight: 5 };
    for (const pct of [1, 10, 19, 20]) {
      const eff = resolveEffectiveSkill(light, { skillId: 'light', slot: 0, gem: echoGem(2, { weightIncreasePct: pct }) });
      expect(weightOf(eff)).toBe(6);
    }
  });

  it('leaves an un-featured piece on the identical byte path (same reference)', () => {
    const def = skillBook['sword_slash']!;
    const piece = (gem?: Gem): BoardPiece => ({ skillId: 'sword_slash', slot: 0, ...(gem ? { gem } : {}) });
    expect(resolveEffectiveSkill(def, piece())).toBe(def);
    // pct 0 / absent is not "a feature with no effect" — it is the same object.
    expect(resolveEffectiveSkill(def, piece({ kind: 'effect', id: 'z', rarity: 'common', actions: [], weightIncreasePct: 0 }))).toBe(def);
    expect(resolveEffectiveSkill(def, piece({ kind: 'effect', id: 'z', rarity: 'common', actions: [] }))).toBe(def);
  });

  it('changes nothing else about the card: same effects, same cooldown, same damage per cast', () => {
    const def = skillBook['sword_slash']!;
    const heavy = resolveEffectiveSkill(def, { skillId: 'sword_slash', slot: 0, gem: echoGem(2, { weightIncreasePct: 50 }) });
    const light = resolveEffectiveSkill(def, { skillId: 'sword_slash', slot: 0, gem: echoGem() });
    expect(heavy.effects).toEqual(light.effects);
    expect(heavy.cooldownTurns).toBe(light.cooldownTurns);
    expect(firstCastHits(castOnce('sword_slash', { attack: 20 }, { gem: echoGem(2, { weightIncreasePct: 50 }) })))
      .toEqual([40, 20]);
  });

  it('composes with cooldownReduction rather than replacing it', () => {
    const gem: Gem = { kind: 'effect', id: 'both', rarity: 'legendary', actions: [], cooldownReduction: 2, weightIncreasePct: 50 };
    const eff = resolveEffectiveSkill(skillBook['sword_slash']!, { skillId: 'sword_slash', slot: 0, gem });
    expect(weightOf(eff)).toBe(15);
    expect(eff.cooldownTurns).toBe(1); // BASELINE_COOLDOWN 3 − 2
  });

  it('actually costs tempo in a fight: the same card fires fewer times', () => {
    // Speed 10 vs weight 10 is one cast a turn; at weight 15 the caster must
    // bank a turn's readiness first, so roughly two casts in three turns.
    const casts = (pct?: number): number => {
      const hero = tc('hero', [], { attack: 20, speed: 10, maxHp: 5000 }, {
        pieces: [{ skillId: 'sword_slash', slot: 0, gem: echoGem(2, pct === undefined ? {} : { weightIncreasePct: pct }) }],
      });
      const wall = tc('wall', [], { maxHp: 100000, speed: 1 });
      const events = simulate({ ...cfg(hero, wall, { ...NO_ENDGAME, maxTurns: 30 }) }, 1).events;
      return events.filter((e) => e.kind === 'skillCast' && e.side === 'player').length;
    };
    expect(casts()).toBe(30);
    expect(casts(50)).toBe(20);
    expect(casts(100)).toBe(15);
    expect(casts(50)).toBeLessThan(casts());
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
    // An ECHO hit is no different — a big proportional payload is still ONE
    // instance and is stopped by one charge like anything else. `onehit` is base
    // 20 at ATK 10, so the echo is ceil((20 + 10) / 2) = 15.
    expect(vsWard('onehit', 'ward', echoGem())).toEqual({ negated: 1, landed: [15] });
    // Two charges eat both instances.
    expect(vsWard('onehit', 'ward2', flatGem(4))).toEqual({ negated: 2, landed: [] });
    expect(vsWard('onehit', 'ward2', echoGem())).toEqual({ negated: 2, landed: [] });
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
    // The ACTION is still worth 0 — unbounded value, no honest rate. As a gem it
    // pays only the instance premium (§5), which lands on no band either.
    expect(actionsPriceDeci(uncapped.kind === 'effect' ? uncapped.actions : [], 'physical')).toBe(0);
    expect(gemPowerLevelDeci(uncapped)).toBe(PRICE.extraHitPremium);
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
      expect(isGemOnBudget({ ...uncapped, rarity })).toBe(false);
    }
    // A non-echo strike is NOT proportional to the host, so a host cannot rescue it.
    expect(gemPowerLevelDeci(uncapped, skillBook['crushing_blow']!)).toBe(PRICE.extraHitPremium);
  });

  it('a capped strike CAN land on a rarity band exactly (Epic = 6 PL = premium 3 + cap 6)', () => {
    const gem: Gem = { kind: 'effect', id: 'half_strike', rarity: 'epic', actions: [{ kind: 'statStrike', shareOf: 2, cap: 6 }] };
    expect(gemPowerLevelDeci(gem)).toBe(6 * PRICE.flatPowerPerPoint + PRICE.extraHitPremium);
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

// THE GEM PREMIUM (gem ruleset v1 §5, engine+balance fix 2026-08-09). A card's
// FIRST hit pays no `extraHitPremium` — it is that card's one instance. A GEM's
// first hit is never a first instance: socketed, it is one MORE separately
// mitigated, separately negated hit on top of whatever the host already threw.
// `actionsPriceDeci` charges the premium only from the second entry of the list
// it is handed, and a gem's list is its own, so before this fix no gem in the
// catalog ever paid it and every damage-bearing gem was under-priced by 30 deci.
describe('gem hit premium: every hit a gem appends pays extraHitPremium, unconditionally', () => {
  it('one hit action = one premium on top of the action\'s own price', () => {
    for (const power of [1, 4, 8, 16]) {
      expect(gemPowerLevelDeci(flatGem(power)))
        .toBe(power * PRICE.flatPowerPerPoint + PRICE.extraHitPremium);
    }
  });

  it('TWO hit actions = TWO premiums (one per hit action), never one', () => {
    const twoHits: Gem = {
      kind: 'effect', id: 'two', rarity: 'legendary',
      actions: [{ kind: 'damage', power: 4 }, { kind: 'damage', power: 4 }],
    };
    expect(gemPowerLevelDeci(twoHits)).toBe(8 * PRICE.flatPowerPerPoint + 2 * PRICE.extraHitPremium);
    // The internal (hits − 1) charge and the gem's first-hit charge must not
    // overlap: the total is exactly hits × premium.
    expect(gemPowerLevelDeci(twoHits) - actionsPriceDeci(twoHits.actions, 'physical')).toBe(PRICE.extraHitPremium);
  });

  it('a NON-hit rider pays no premium — the price of every existing rider gem is unmoved', () => {
    const riders: Gem[] = [
      { kind: 'effect', id: 'poison', rarity: 'common', actions: [{ kind: 'poison', stacks: 2 }] },
      { kind: 'effect', id: 'slow', rarity: 'common', actions: [{ kind: 'slow', weight: 8 }] },
      { kind: 'effect', id: 'heal', rarity: 'common', actions: [{ kind: 'heal', power: 4 }] },
      { kind: 'effect', id: 'shield', rarity: 'common', actions: [{ kind: 'shield', power: 4 }] },
      { kind: 'effect', id: 'guard', rarity: 'common', actions: [{ kind: 'guard', property: 'magical', pct: 20, turns: 1 }] },
    ];
    for (const gem of riders) {
      expect(gemPowerLevelDeci(gem), gem.id).toBe(actionsPriceDeci(gem.kind === 'effect' ? gem.actions : [], 'physical'));
      expect(gemPowerLevelDeci(gem), gem.id).toBe(RARITY_PL_DECI.common);
      expect(isGemOnBudget(gem), gem.id).toBe(true);
    }
  });

  it('a flat-damage gem can NEVER be Common again — the premium alone exceeds the band', () => {
    // §2/§3: 30 deci > the 20-deci Common band at any magnitude, including 0.
    for (let power = 0; power <= 30; power += 1) {
      expect(isGemOnBudget({ ...flatGem(power), rarity: 'common' }), `power ${power}`).toBe(false);
    }
    // The bands a flat hit CAN reach, per the ruleset's expressibility table.
    expect(gemPowerLevelDeci(flatGem(2))).toBe(RARITY_PL_DECI.rare);
    expect(gemPowerLevelDeci(flatGem(6))).toBe(RARITY_PL_DECI.epic);
    expect(gemPowerLevelDeci(flatGem(10))).toBe(RARITY_PL_DECI.legendary);
  });
});

// CLEANSE IS STILL UNPRICEABLE AS A GEM (gem ruleset v1 §9.1, fork 3 default:
// do NOT reprice `cleansePerCharge`). Locked here so the §5/§6 work above is
// provably not what moves it: the premium never touches a non-hit action and
// the echo rate never touches a non-statStrike one.
describe('cleanse pricing is untouched by the gem premium and the echo rate', () => {
  it('cleansePerCharge is still 25, and 1..4 charges still land between the bands', () => {
    expect(PRICE.cleansePerCharge).toBe(25);
    expect([1, 2, 3, 4].map((c) => actionsPriceDeci([{ kind: 'cleanse', charges: c }], 'physical')))
      .toEqual([25, 50, 75, 100]);
    for (const charges of [1, 2, 3, 4]) {
      const gem: Gem = { kind: 'effect', id: 'purge', rarity: 'common', actions: [{ kind: 'cleanse', charges }] };
      expect(gemPowerLevelDeci(gem)).toBe(charges * PRICE.cleansePerCharge);
      for (const rarity of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
        expect(isGemOnBudget({ ...gem, rarity }), `${charges} charges / ${rarity}`).toBe(false);
      }
    }
  });

  it('purify still costs exactly Bronze — the card side of the same rate is unmoved', () => {
    const purify = skillBook['purify'];
    if (purify) expect(powerLevelDeci(purify)).toBe(100);
  });
});
