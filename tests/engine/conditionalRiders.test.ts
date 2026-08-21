// CONDITIONAL BONUS-DAMAGE RIDERS — `exploit` and `stackBonus`.
//
// Both arm `cast.bonusByTarget` (combat/interpreter.ts) and are spent by the
// cast's first own `damage` action, exactly like `comboBonus`. What they check is
// different: `exploit` asks whether the VICTIM already carries a named
// affliction; `stackBonus` scales with the STACK COUNT of a pile on either the
// caster (the thorn-wall spender) or the victim (the DoT executioner), clamped
// at a REQUIRED cap.
//
// THE ORDERING RULING (user-locked 2026-08-21, verbatim: "it should always
// activate this effect first before activating any poison debuff") is the rule
// most of this file exists to pin: a rider reads PRE-EXISTING status only, so a
// card can never trigger its own condition within one cast — the payoff is
// cross-cast. `validateSkillContent` makes any other authoring order a build
// failure; the tests below prove the engine behaves that way too.
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
  selfSynergyPremiumDeci,
} from '../../src/engine/balance';
import { applyTier } from '../../src/engine/cards';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import type {
  Action,
  CombatConfig,
  CombatantSetup,
  ExploitableStatus,
  SkillBook,
  SkillDef,
  SkillTier,
} from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';

// ---------------------------------------------------------------- fixtures --

function card(id: string, effects: Action[], extra: Partial<SkillDef> = {}): SkillDef {
  return {
    id, name: id, archetypes: ['offense'], property: 'physical', weapon: 'sword',
    size: 1, speedWeight: 10, rarity: 'common', tier: 'bronze', cooldownTurns: 0,
    effects, text: '', ...extra,
  };
}

/** Pure exploiter: no poison of its own, so it can only ever fire off someone else's. */
const exploiter = card('exploiter', [
  { kind: 'exploit', status: 'poison', amount: 20 },
  { kind: 'damage', power: 10 },
]);

/** Self-sufficient: exploits poison, applies poison AFTER the hit (the locked order). */
const selfExploiter = card('selfExploiter', [
  { kind: 'exploit', status: 'poison', amount: 20 },
  { kind: 'damage', power: 10 },
  { kind: 'poison', stacks: 3 },
], { archetypes: ['offense', 'debuff'] });

/** Two own hits: the bonus must be spent ONCE, on the first of them. */
const twinExploiter = card('twinExploiter', [
  { kind: 'exploit', status: 'poison', amount: 20 },
  { kind: 'damage', power: 10 },
  { kind: 'damage', power: 10 },
]);

/** AoE: the condition is per victim, so only the afflicted foes take the bonus. */
const aoeExploiter = card('aoeExploiter', [
  { kind: 'exploit', status: 'poison', amount: 20 },
  { kind: 'damage', power: 10 },
], { scope: 'all' });

/** Applies poison to whoever it hits, and nothing else worth measuring. */
const poisoner = card('poisoner', [{ kind: 'poison', stacks: 4 }], { archetypes: ['debuff'] });

/** The thorn-wall spender: reads its OWN pile, then grants more (after the hit). */
const thornSpender = card('thornSpender', [
  { kind: 'stackBonus', status: 'thorns', of: 'caster', per: 3, cap: 12 },
  { kind: 'damage', power: 10 },
  { kind: 'thorns', stacks: 5 },
], { archetypes: ['offense', 'defensive'] });

/** The executioner: reads the VICTIM's poison pile. */
const executioner = card('executioner', [
  { kind: 'stackBonus', status: 'poison', of: 'target', per: 3, cap: 12 },
  { kind: 'damage', power: 10 },
]);

const book: SkillBook = {
  ...skillBook, exploiter, selfExploiter, twinExploiter, aoeExploiter, poisoner, thornSpender, executioner,
};

function hero(skillIds: string[]): CombatantSetup {
  return {
    name: 'hero',
    // No stats that could confuse the arithmetic: attack 0 so a hit is exactly
    // its printed power (+ any rider bonus), armor 0 on the far side.
    stats: { maxHp: 100_000, hp: 100_000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 20 },
    boardSize: 10,
    pieces: skillIds.map((skillId, i) => ({ skillId, slot: i })),
    targetPolicy: 'first',
  };
}

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

function fight(skillIds: string[], opts: { foes?: number; maxTurns?: number; enemy?: CombatantSetup[] } = {}) {
  const config: CombatConfig = {
    playerTeam: [hero(skillIds)],
    enemyTeam: opts.enemy ?? Array.from({ length: opts.foes ?? 1 }, (_, i) => wall(`w${i}`)),
    skillBook: book,
    suddenDeathRound: 999,
    fatigueTurn: 999_999,
    attritionTurn: 999_999,
    maxTurns: opts.maxTurns ?? 6,
  };
  return skillCasts(simulate(config, 1).events);
}

// ------------------------------------------------------------------ exploit --

describe('exploit: +flat damage when the target already carries the named status', () => {
  it('does nothing against a clean target', () => {
    const casts = fight(['exploiter']);
    expect(casts.length).toBeGreaterThan(0);
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
  });

  it('adds its whole flat bonus once the status is on the target', () => {
    // `poisoner` fires first (lower slot, same weight), so by the exploiter's
    // own cast the victim already carries a poison pile.
    const casts = fight(['poisoner', 'exploiter']);
    const exploits = casts.filter((c) => c.skillId === 'exploiter');
    expect(exploits.length).toBeGreaterThan(0);
    for (const cast of exploits) expect(cast.hits.map((h) => h.amount)).toEqual([30]); // 10 + 20
  });

  it('is spent ONCE per cast — a two-hit card gets it on the first hit only', () => {
    const casts = fight(['poisoner', 'twinExploiter']);
    const hits = casts.find((c) => c.skillId === 'twinExploiter')!.hits.map((h) => h.amount);
    expect(hits).toEqual([30, 10]); // NOT [30, 30]
  });

  it('is armed PER VICTIM under scope: all — only the poisoned foe pays', () => {
    // `poisoner` is single-target and picks foe 0 (targetPolicy 'first'), so on
    // the AoE cast foe 0 is poisoned and foe 1 is clean.
    const casts = fight(['poisoner', 'aoeExploiter'], { foes: 2 });
    const aoe = casts.find((c) => c.skillId === 'aoeExploiter')!;
    expect(aoe.hits).toEqual([{ unit: 0, amount: 30 }, { unit: 1, amount: 10 }]);
  });
});

describe('THE ORDERING RULING: a rider reads PRE-EXISTING status, so a card never triggers itself', () => {
  it('a poison+exploit card misses on its FIRST cast and collects on its SECOND', () => {
    const casts = fight(['selfExploiter'], { maxTurns: 12 }).filter((c) => c.skillId === 'selfExploiter');
    expect(casts.length).toBeGreaterThanOrEqual(2);
    // Cast 1: the target is clean when the rider resolves; the card's own poison
    // lands after the hit. Cast 2 onwards: the pile is there and the bonus lands.
    expect(casts[0]!.hits.map((h) => h.amount)).toEqual([10]);
    expect(casts[1]!.hits.map((h) => h.amount)).toEqual([30]);
  });

  it('the thorn spender reads the pile it granted LAST cast, and never consumes it', () => {
    const casts = fight(['thornSpender'], { maxTurns: 12 }).filter((c) => c.skillId === 'thornSpender');
    expect(casts.length).toBeGreaterThanOrEqual(3);
    // Cast 1: no pile yet → 10. Cast 2: 5 stacks × 3 = 15, clamped to the cap
    // 12 → 22. Cast 3: the pile MERGED to 10 stacks (nothing hit the wall, so
    // nothing was consumed) → still capped at 12 → 22.
    expect(casts[0]!.hits.map((h) => h.amount)).toEqual([10]);
    expect(casts[1]!.hits.map((h) => h.amount)).toEqual([22]);
    expect(casts[2]!.hits.map((h) => h.amount)).toEqual([22]);
  });
});

describe('stackBonus: per × stacks, clamped at the required cap', () => {
  it('scales with the CASTER’s own pile below the cap', () => {
    // A spender whose cap is out of reach of one pile: 5 stacks × 3 = 15 < 99.
    const uncapped = card('uncapped', [
      { kind: 'stackBonus', status: 'thorns', of: 'caster', per: 3, cap: 99 },
      { kind: 'damage', power: 10 },
      { kind: 'thorns', stacks: 5 },
    ], { archetypes: ['offense', 'defensive'] });
    const config: CombatConfig = {
      playerTeam: [hero(['uncapped'])],
      enemyTeam: [wall('w0')],
      skillBook: { ...book, uncapped },
      suddenDeathRound: 999, fatigueTurn: 999_999, attritionTurn: 999_999, maxTurns: 12,
    };
    const casts = skillCasts(simulate(config, 1).events);
    expect(casts[0]!.hits.map((h) => h.amount)).toEqual([10]);      // no pile yet
    expect(casts[1]!.hits.map((h) => h.amount)).toEqual([25]);      // 5 stacks × 3
    expect(casts[2]!.hits.map((h) => h.amount)).toEqual([40]);      // 10 stacks × 3
  });

  it('scales with the TARGET’s pile when of: target', () => {
    // poisoner applies 4 poison, which decays by one per end-of-turn tick, so
    // the executioner reads whatever is standing when it casts.
    const casts = fight(['poisoner', 'executioner'], { maxTurns: 4 });
    const first = casts.find((c) => c.skillId === 'executioner')!;
    // 4 stacks × 3 = 12, exactly the cap → 10 + 12.
    expect(first.hits.map((h) => h.amount)).toEqual([22]);
  });

  it('does nothing when the named pile is absent', () => {
    const casts = fight(['executioner']);
    for (const cast of casts) expect(cast.hits.map((h) => h.amount)).toEqual([10]);
  });
});

// ------------------------------------------------------------------ pricing --

describe('pricing: the conditional-trigger discount, and the self-synergy premium', () => {
  const rate = PRICE.flatPowerPerPoint;

  it('a PURE exploiter pays half the flat-damage rate (comboBonus’s locked 2.5/pt)', () => {
    const rider: Action = { kind: 'exploit', status: 'poison', amount: 20 };
    expect(actionsPriceDeci([rider], 'physical')).toBe((20 * rate) / PRICE.conditionalBonusDen);
    // Byte-identical to what comboBonus charges for the same flat magnitude.
    expect(actionsPriceDeci([rider], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'comboBonus', amount: 20 }], 'physical'));
  });

  it('a TRUE card pays the TRUE premium on it — a flat bonus bypasses defense there', () => {
    const rider: Action = { kind: 'exploit', status: 'poison', amount: 20 };
    const trueRate = PRICE.flatPowerPerPoint + PRICE.truePremiumPerPoint;
    expect(actionsPriceDeci([rider], 'true')).toBe((20 * trueRate) / PRICE.conditionalBonusDen);
  });

  it('SELF-SYNERGY forfeits the discount: the same rider costs the full rate when the kit applies the status', () => {
    const rider: Action = { kind: 'exploit', status: 'poison', amount: 20 };
    const kit: Action[] = [rider, { kind: 'damage', power: 10 }, { kind: 'poison', stacks: 3 }];
    expect(selfSynergyPremiumDeci(rider, [rider], 'physical')).toBe(0);
    expect(selfSynergyPremiumDeci(rider, kit, 'physical')).toBe(20 * rate - (20 * rate) / 2);
    expect(actionsPriceDeci([rider], 'physical', 'one', kit)).toBe(20 * rate);
  });

  it('the premium is SIDE-AWARE: a caster-side rider is not fed by a poison put on the enemy', () => {
    const rider: Action = { kind: 'stackBonus', status: 'poison', of: 'caster', per: 3, cap: 12 };
    const kit: Action[] = [rider, { kind: 'damage', power: 10 }, { kind: 'poison', stacks: 3 }];
    expect(selfSynergyPremiumDeci(rider, kit, 'physical')).toBe(0);
    // ...while a caster-side THORNS rider beside a thorns line is fed.
    const thornRider: Action = { kind: 'stackBonus', status: 'thorns', of: 'caster', per: 3, cap: 12 };
    const thornKit: Action[] = [thornRider, { kind: 'damage', power: 10 }, { kind: 'thorns', stacks: 5 }];
    expect(selfSynergyPremiumDeci(thornRider, thornKit, 'physical')).toBe(12 * rate - (12 * rate) / 2);
  });

  it('stackBonus prices its CAP and nothing else — `per` is free because the cap bounds the payload', () => {
    const small: Action = { kind: 'stackBonus', status: 'poison', of: 'target', per: 3, cap: 12 };
    const huge: Action = { kind: 'stackBonus', status: 'poison', of: 'target', per: 999, cap: 12 };
    expect(actionsPriceDeci([small], 'physical')).toBe((12 * rate) / PRICE.conditionalBonusDen);
    expect(actionsPriceDeci([huge], 'physical')).toBe(actionsPriceDeci([small], 'physical'));
    // At per → ∞ the rider degenerates into "+cap if the status is present at
    // all", i.e. an `exploit` of the same size — and prices identically. That
    // coherence is why `per` needs no rate of its own.
    expect(actionsPriceDeci([huge], 'physical'))
      .toBe(actionsPriceDeci([{ kind: 'exploit', status: 'poison', amount: 12 }], 'physical'));
  });

  it('neither is a damage INSTANCE: no extra-hit premium, and no escape from a cap family', () => {
    const kit: Action[] = [
      { kind: 'exploit', status: 'poison', amount: 20 },
      { kind: 'stackBonus', status: 'poison', of: 'target', per: 3, cap: 12 },
      { kind: 'damage', power: 10 },
    ];
    expect(HIT_KINDS.has('exploit')).toBe(false);
    expect(HIT_KINDS.has('stackBonus')).toBe(false);
    expect(actionsPriceDeci(kit, 'physical')).toBe(50 + 30 + 50); // no `extraHitPremium` term
    // EMPOWER, not 'damage' — `capViolations` checks the damage family through
    // HIT_KINDS, so a non-hit kind labelled 'damage' would count against NO cap.
    expect(EMPOWER_KINDS.has('exploit')).toBe(true);
    expect(EMPOWER_KINDS.has('stackBonus')).toBe(true);
    expect(capViolations(card('capped', [
      // 40 points of typed exploit = 100 deci = the whole size-1 empower cap;
      // one more point must be a violation.
      { kind: 'exploit', status: 'poison', amount: 44 },
      { kind: 'damage', power: 10 },
    ]))).toEqual(['empower 11 PL exceeds the size-1 bronze cap (10 PL)']);
  });

  it('both are OFFENSIVE, so an AoE card pays the reach multiplier on them', () => {
    expect(OFFENSIVE_KINDS.has('exploit')).toBe(true);
    expect(OFFENSIVE_KINDS.has('stackBonus')).toBe(true);
    const rider: Action[] = [{ kind: 'exploit', status: 'poison', amount: 20 }];
    expect(actionsPriceDeci(rider, 'physical', 'all'))
      .toBe(Math.floor((50 * PRICE.aoeTargetsNum) / PRICE.aoeTargetsDen));
  });

  it('powerLevelBreakdown parts still sum exactly with a self-synergy premium in play', () => {
    const skill = card('sum', [
      { kind: 'exploit', status: 'poison', amount: 4 },
      { kind: 'damage', power: 8 },
      { kind: 'poison', stacks: 4 },
    ]);
    const parts = powerLevelBreakdown(skill);
    expect(parts.reduce((s, p) => s + p.deci, 0)).toBe(powerLevelDeci(skill));
    expect(parts.find((p) => p.label === 'exploit')!.deci).toBe(4 * rate); // full rate, not 10
  });
});

describe('the three showcase cards are exactly on budget at all four tiers', () => {
  const tiers: SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
  for (const id of ['blight_feast', 'second_bite', 'thorn_reckoning']) {
    it(`${id}: on budget with no cap violations at every tier`, () => {
      const base = skillBook[id]!;
      for (const tier of tiers) {
        const at = applyTier(base, tier);
        expect(isOnBudget(at), `${id}@${tier} is ${powerLevelDeci(at) / 10} PL`).toBe(true);
        expect(capViolations(at), `${id}@${tier}`).toEqual([]);
      }
    });
  }

  it('blight_feast at Bronze deals literally DOUBLE damage into a poisoned target', () => {
    // The user's ask ("if target is poison deal 2x this damage") delivered as a
    // flat bonus sized to the card's own damage line, not as a multiplier.
    const base = skillBook['blight_feast']!;
    const damage = base.effects.find((a) => a.kind === 'damage');
    const rider = base.effects.find((a) => a.kind === 'exploit');
    expect(damage && damage.kind === 'damage' ? damage.power : -1)
      .toBe(rider && rider.kind === 'exploit' ? rider.amount : -2);
  });
});

// -------------------------------------------------------------- authoring ---

describe('validateSkillContent enforces the rider ordering rule', () => {
  const doc = (effects: unknown[]): unknown => ({
    schemaVersion: 1,
    cards: [{
      id: 'ordering_probe',
      versions: [{
        version: 1,
        def: {
          name: 'Probe', text: 'x 3 12', archetypes: ['offense'], property: 'physical', weapon: 'sword',
          size: 1, rarity: 'common', tier: 'bronze', effects,
        },
      }],
    }],
  });
  const problemsOf = (effects: unknown[]): string[] => validateSkillDocument(doc(effects)).map((p) => p.message);

  it('accepts rider → damage → status', () => {
    expect(problemsOf([
      { kind: 'exploit', status: 'poison', amount: 12 },
      { kind: 'damage', power: 12 },
      { kind: 'poison', stacks: 3 },
    ])).toEqual([]);
  });

  it('rejects a rider placed BEHIND the damage it is supposed to feed', () => {
    expect(problemsOf([
      { kind: 'damage', power: 12 },
      { kind: 'exploit', status: 'poison', amount: 12 },
    ]).join(' ')).toContain('must be placed BEFORE a damage action');
  });

  it('rejects a rider on a card with no damage line at all', () => {
    expect(problemsOf([
      { kind: 'exploit', status: 'poison', amount: 12 },
      { kind: 'poison', stacks: 3 },
    ]).join(' ')).toContain('must be placed BEFORE a damage action');
  });

  it('rejects the self-trigger: the card’s own poison before the hit', () => {
    expect(problemsOf([
      { kind: 'exploit', status: 'poison', amount: 12 },
      { kind: 'poison', stacks: 3 },
      { kind: 'damage', power: 12 },
    ]).join(' ')).toContain('may never trigger its own condition within one cast');
  });

  it('lets an UNRELATED status sit before the damage (only the rider’s own status is ordered)', () => {
    expect(problemsOf([
      { kind: 'stackBonus', status: 'thorns', of: 'caster', per: 3, cap: 12 },
      { kind: 'burn', stacks: 3 },
      { kind: 'damage', power: 12 },
      { kind: 'thorns', stacks: 3 },
    ])).toEqual([]);
  });

  it('rejects a bad status, a missing cap, and an unknown field', () => {
    const messages = problemsOf([
      { kind: 'exploit', status: 'thorns', amount: 12 },
      { kind: 'stackBonus', status: 'poison', of: 'target', per: 3 },
      { kind: 'damage', power: 12, powr: 3 },
    ]).join(' | ');
    expect(messages).toContain('status must be poison|burn|bleed|stun|debuff|expose');
    expect(messages).toContain('missing required field cap');
    expect(messages).toContain('unknown field powr');
  });

  it('the exploitable-status list is exactly the set the engine can actually apply', () => {
    // Pins the runtime list in `validateSkillContent.ts` against
    // `ExploitableStatus` (engine/types.ts) — and, through it, against
    // `isCleansable` in combat/interpreter.ts. A compile error here (or an
    // accepted status not in this list) means the two have drifted.
    const all: ExploitableStatus[] = ['poison', 'burn', 'bleed', 'stun', 'debuff', 'expose'];
    for (const status of all) {
      expect(problemsOf([
        { kind: 'exploit', status, amount: 12 },
        { kind: 'damage', power: 12 },
      ]), status).toEqual([]);
    }
  });
});
