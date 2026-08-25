import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { formatDmg } from '../../src/game/battleTimeline';
import { fmtDamage } from '../../scripts/logFormat';
import { matchupPct } from '../../src/engine/elements';
import type { DamageCalculation } from '../../src/engine/combat/events';
import type { CombatConfig } from '../../src/engine/types';
import type { Matchup } from '../../src/engine/elements';

/**
 * THE DAMAGE LEDGER IS CLOSED — and the numbers in it are the ones the spec
 * promises. Parts sum to total, in the engine AND in every renderer of it.
 *
 * THE GAP THIS FILLS. `auditCombatLog` (docs/combat-model-spec.md §6) is the
 * project's standing log audit, and it checks readiness, cost, eligibility,
 * cursor walk, cooldown and determinism — but NOT the damage arithmetic. So the
 * one thing a player actually reads off a hit, the number and the sum that
 * explains it, had no guard. `tests/engine/multiHit.test.ts` does assert the
 * telescoping identity, but only over `twin_slash` against a plain foe, where
 * `exposeBonus` is absent and the matchup is neutral — so it was structurally
 * unable to see the term that was missing. This file sweeps a matrix chosen to
 * make every optional term actually appear, and asserts non-vacuity explicitly
 * (see the coverage test) so it cannot rot into the same blind spot.
 *
 * WHAT IT CAUGHT (2026-08-21). Over 2208 audited hits the ENGINE was right
 * every time: `amount === shieldBlocked + hpDamage` always, the minimum-1 floor
 * always honoured, and the full identity closed on all 1860 hits with no
 * `expose` in play. On the other 348 the ledger closed only once `exposeBonus`
 * was added — and the CLI renderer had no term for it, printing e.g.
 * `26 ... = 33 HP`. A renderer omission, not an arithmetic error.
 *
 * TWO RENDERERS, ONE INVARIANT. `formatDmg` (src/game/battleTimeline.ts) is the
 * in-game math strip; `fmtDamage` (scripts/logFormat.ts) is the `npm run fight`
 * log. They use deliberately different grammars — the strip spells out the
 * scaling stat as its own term and uses a typographic minus, the CLI opens with
 * the combined `baseDamage` and stays ASCII — so this file parses each grammar
 * back and sums it, rather than comparing the two strings. Anything that adds a
 * stage to the damage pipeline has to appear in BOTH or fail here.
 *
 * BEYOND CLOSURE. A ledger can close and still be wrong, so the last suite
 * re-derives the two stages that carry a design decision straight from the spec
 * rather than from the engine's own bookkeeping: the FLAT stat add (`(+ATK)` is
 * the caster's stat, added — never a percentage) and the weapon/element triangle
 * (+50% / −25%, applied AFTER defense).
 */

/** Lay slots out by card SIZE — a size-N card occupies N slots. */
function board(ids: readonly string[]): Array<{ skillId: string; slot: number }> {
  let next = 0;
  return ids.map((id) => {
    const skill = skillBook[id];
    if (!skill) throw new Error(`damageLedger: unknown card "${id}"`);
    const slot = next;
    next += skill.size;
    return { skillId: id, slot };
  });
}

type Stats = Record<string, number>;

/** One audited hit: the derivation plus the mitigation context around it. */
interface Hit {
  calc: DamageCalculation;
  amount: number;
  matchup: Matchup;
}

function run(
  hero: readonly string[], foe: readonly string[],
  heroStats: Stats, foeStats: Stats, seed: number, suddenDeathTurn = 0,
): Hit[] {
  const config: CombatConfig = {
    playerTeam: [{
      name: 'Hero',
      stats: { maxHp: 900, hp: 900, attack: 10, magicPower: 10, armor: 3, magicResist: 3, speed: 30, ...heroStats },
      pieces: board(hero), boardSize: 12,
    } as never],
    // A big, feeble foe so the fight lasts long enough for every rotation to
    // come round and the log is not truncated by an early kill.
    enemyTeam: [{
      name: 'Foe',
      stats: { maxHp: 4000, hp: 4000, attack: 8, magicPower: 8, armor: 4, magicResist: 4, speed: 12, ...foeStats },
      pieces: board(foe), boardSize: 12,
    } as never],
    skillBook, maxTurns: 30,
    endgame: { attritionEnabled: false, suddenDeathTurn },
  } as never;
  const out: Hit[] = [];
  for (const e of simulate(config, seed).events) {
    if (e.kind !== 'damage' || !e.calculation) continue;
    out.push({ calc: e.calculation, amount: e.amount, matchup: e.matchup ?? 'neutral' });
  }
  return out;
}

/**
 * The matrix. Each row exists to force a specific optional term to be non-zero:
 * an expose applier ahead of a hit for EXPOSE, a foe `guard` card for GUARD, a
 * foe shield for BLOCK, a 1-attack hero into 30 armor for MIN (the floor), and
 * a foe board with a TYPE IDENTITY for AFFINITY.
 */
const HERO_SETS = [
  ['sword_slash'], ['fireball'], ['crushing_blow'], ['annihilation_strike'],
  ['piercing_arrow', 'sword_slash'],   // expose, then a physical hit into it
  ['ruinous_hex', 'fireball'],         // expose, then a magical hit into it
  ['sundering_roar', 'crushing_blow'],
  // Sword BEATS axe and lance LOSES to it, so against the axe-identity foe
  // below these two cover both signs of the triangle from one board shape.
  ['lance_thrust'],
  // A standing +50% attack buff at hit time, which is the only thing that makes
  // `statBonusDamage` non-zero (it is the buffed-vs-base stat delta, so an
  // unbuffed caster reports 0 for it). The rotation alternates buffed and
  // unbuffed hits, so both sides of that term get audited.
  ['battle_howl', 'sword_slash'],
  // A rider that PAYS: `finishing_cleave` is a `chainBonus` card gated on the
  // previous cast being a sword, so slot order feeds it and its bonus lands in
  // `effectBonusDamage` — the channel every aura, gem and rider funnels through,
  // and zero on a bare card.
  ['sword_slash', 'finishing_cleave'],
];
const FOE_SETS = [
  ['sword_slash'],
  ['bastion_stance', 'sword_slash'],            // plating, for BLOCK
  ['frost_ward', 'sword_slash'],                // magical guard, 50%
  ['unbreakable_stance', 'sword_slash'],        // physical guard, 25%
  // THREE axe cards, which is `IDENTITY_THRESHOLD` — the board takes on the axe
  // identity and gains axe as a DEFENSIVE affinity, the only thing that unlocks
  // the weapon triangle (typeIdentity.ts). A 1- or 2-card foe board has no
  // identity, so no affinity, so `matchupBonusDamage` is structurally always 0 —
  // which is why the whole matrix scored zero on AFFINITY until this row existed.
  ['hemorrhage', 'rupturing_strike', 'mortal_wound'],
];
const STATS: Array<readonly [Stats, Stats]> = [
  [{}, {}],
  [{ attack: 40, magicPower: 40 }, { armor: 0, magicResist: 0 }],
  [{ attack: 1, magicPower: 1 }, { armor: 30, magicResist: 30 }],  // forces the min-1 floor
  [{ attack: 25 }, { armor: 12, magicResist: 2 }],
  // A FASTER FOE, so GUARD reaches a hit in THIS matrix. `guard` is a 2-turn
  // self-buff, and these foe boards are 1–3 cards with a ~4-turn cast cycle, so
  // a slower foe's guard has expired before the hero's next cast and the whole
  // matrix returned `guardReduction: 0` until this row existed. That is a
  // property of the fixture, NOT of the game: measured over 40 seeds against
  // real enemy boards, `barbed_rampart` (stone_beetle) blunts 56% of incoming
  // physical hits and `unbreakable_stance` (warded_sentinel) 50%, absorbing
  // 13–17% of would-be damage. Real boards are wider and cast far more often.
  // Kept because the non-vacuity test needs the term to occur SOMEWHERE.
  [{ attack: 25, magicPower: 25, speed: 12 }, { speed: 40 }],
];

/** Every hit the matrix produces, computed once and shared by the suite. */
const HITS: Hit[] = (() => {
  const out: Hit[] = [];
  for (const hero of HERO_SETS) {
    for (const foe of FOE_SETS) {
      for (const [hs, fs] of STATS) {
        for (const seed of [3, 19]) out.push(...run(hero, foe, hs, fs, seed));
      }
    }
  }
  // One sudden-death fight so the RAMP term is exercised too.
  out.push(...run(['sword_slash'], ['sword_slash'], {}, {}, 7, 5));
  return out;
})();

/** The identity, spelled out term by term exactly as the pipeline applies it. */
function ledgerSum(c: DamageCalculation): number {
  return c.baseDamage + c.statBonusDamage + c.effectBonusDamage - c.defense
    + c.minimumDamageBonus + c.matchupBonusDamage + c.suddenDeathBonusDamage
    - c.guardReduction + (c.exposeBonus ?? 0) - c.shieldBlocked;
}

/** Sum the CLI grammar back: `12 +STAT5 -DEF3 = 14 HP (…)`. */
function sumCli(line: string): { parts: number; total: number } {
  const [lhs, rhs] = line.split(' = ');
  const total = Number(/^(-?\d+) HP/.exec(rhs ?? '')?.[1]);
  const tokens = (lhs ?? '').split(' ');
  let parts = Number(tokens[0]);
  for (const token of tokens.slice(1)) {
    const m = /^([+-])[A-Z.]+(\d+)$/.exec(token);
    if (!m) throw new Error(`damageLedger: unparsable CLI term "${token}" in "${line}"`);
    parts += (m[1] === '+' ? 1 : -1) * Number(m[2]);
  }
  return { parts, total };
}

/** Sum the in-game grammar back: `D: base 12 + (5 ATK) − (3 DEF) = 14`. */
function sumStrip(line: string): { parts: number; total: number } {
  const [lhs, rhs] = line.replace(/^D: /, '').split(' = ');
  const total = Number(rhs);
  let parts = Number(/^base (-?\d+)/.exec(lhs ?? '')?.[1]);
  // U+2212 MINUS SIGN, not a hyphen — the strip is typeset, so match what it emits.
  for (const m of (lhs ?? '').matchAll(/([+−]) \((\d+) [^)]+\)/g)) {
    parts += (m[1] === '+' ? 1 : -1) * Number(m[2]);
  }
  return { parts, total };
}

describe('the damage ledger closes', () => {
  it('the matrix produces a meaningful population of hits', () => {
    expect(HITS.length).toBeGreaterThan(500);
  });

  it('EVERY optional term actually occurs — this suite is not vacuous', () => {
    // The guard against becoming the test that could not see the bug. If a
    // content or engine change stops a term from ever appearing, this fails and
    // the row of the matrix that used to force it has to be repaired — rather
    // than the suite quietly going green while auditing nothing. It has already
    // caught two of its own blind spots (GUARD and AFFINITY, both above).
    const seen = (pick: (h: Hit) => number): number => HITS.filter((h) => pick(h) !== 0).length;
    expect(seen((h) => h.calc.exposeBonus ?? 0), 'EXPOSE (the term the CLI renderer was missing)').toBeGreaterThan(0);
    expect(seen((h) => h.calc.guardReduction), 'GUARD').toBeGreaterThan(0);
    expect(seen((h) => h.calc.shieldBlocked), 'BLOCK').toBeGreaterThan(0);
    expect(seen((h) => h.calc.minimumDamageBonus), 'MIN').toBeGreaterThan(0);
    expect(seen((h) => h.calc.suddenDeathBonusDamage), 'RAMP').toBeGreaterThan(0);
    expect(seen((h) => h.calc.statBonusDamage), 'STAT (a buffed scaling stat)').toBeGreaterThan(0);
    expect(seen((h) => h.calc.effectBonusDamage), 'BONUS (aura/gem/rider)').toBeGreaterThan(0);
    // AFFINITY is SIGNED, so both directions of the triangle must be exercised —
    // a suite that only ever saw advantage could not catch a disadvantage that
    // was applied with the wrong sign.
    expect(HITS.filter((h) => h.calc.matchupBonusDamage > 0).length, 'AFFINITY advantage').toBeGreaterThan(0);
    expect(HITS.filter((h) => h.calc.matchupBonusDamage < 0).length, 'AFFINITY disadvantage').toBeGreaterThan(0);
  });

  it('parts sum to hpDamage on every hit', () => {
    const open = HITS.filter((h) => ledgerSum(h.calc) !== h.calc.hpDamage);
    expect(open.map((h) => `${ledgerSum(h.calc)} != ${h.calc.hpDamage} ${JSON.stringify(h.calc)}`)).toEqual([]);
  });

  it('amount splits exactly into what the shield ate and what HP took', () => {
    // `amount` is the headline number; `shieldBlocked` + `hpDamage` is where it
    // went. A gap here means a hit destroyed or invented HP.
    const bad = HITS
      .filter((h) => h.amount !== h.calc.shieldBlocked + h.calc.hpDamage)
      .map((h) => `amount ${h.amount} != block ${h.calc.shieldBlocked} + hp ${h.calc.hpDamage}`);
    expect(bad.slice(0, 4), `${bad.length} hits do not split`).toEqual([]);
  });

  it('a hit that landed is never worth nothing (the minimum-1 floor)', () => {
    const bad = HITS.filter((h) => h.amount < 1).map((h) => JSON.stringify(h.calc));
    expect(bad.slice(0, 4), `${bad.length} hits landed for < 1`).toEqual([]);
  });

  it('the CLI log line adds up', () => {
    const open: string[] = [];
    for (const { calc } of HITS) {
      const line = fmtDamage(calc);
      const { parts, total } = sumCli(line);
      if (parts !== total) open.push(`${line}  [terms ${parts}, printed ${total}]`);
    }
    // Trimmed: 206 identical-shaped failures is noise, the first few are the finding.
    expect(open.slice(0, 4), `${open.length} CLI lines do not add up`).toEqual([]);
  });

  it('the in-game math strip adds up', () => {
    const open: string[] = [];
    for (const { calc } of HITS) {
      const line = formatDmg(calc);
      const { parts, total } = sumStrip(line);
      if (parts !== total) open.push(`${line}  [terms ${parts}, printed ${total}]`);
    }
    expect(open.slice(0, 4), `${open.length} strip lines do not add up`).toEqual([]);
  });
});

describe('the numbers in the ledger are the ones the spec promises', () => {
  it('the stat term is the caster stat added FLAT, not a percentage', () => {
    // The card face promises `N (+ATK)`. The spec's FLAT model (locked
    // 2026-07-20, docs/combat-model-spec.md §5) says that is literally
    // `power + stat`, so `baseDamage` must be the plain sum and the STAT term
    // must be exactly the buffed-vs-base stat delta — never a fraction of the
    // card's power, which is what a percentage model would produce.
    const bad: string[] = [];
    for (const { calc: c } of HITS) {
      if (c.baseDamage !== c.power + c.baseStat) {
        bad.push(`baseDamage ${c.baseDamage} != power ${c.power} + stat ${c.baseStat}`);
      }
      if (c.statBonusDamage !== c.effectiveStat - c.baseStat) {
        bad.push(`statBonus ${c.statBonusDamage} != effective ${c.effectiveStat} - base ${c.baseStat}`);
      }
    }
    expect(bad.slice(0, 4), `${bad.length} hits contradict the flat stat model`).toEqual([]);
  });

  it('the triangle multiplier is +50% / −25%, applied AFTER defense', () => {
    // Re-derived from `matchupPct` and the event's own `matchup` label rather
    // than from `matchupBonusDamage` — so a multiplier applied to the wrong
    // stage (before defense) or with the wrong factor fails here even though the
    // ledger would still close around it.
    expect([matchupPct('advantage'), matchupPct('disadvantage'), matchupPct('neutral')]).toEqual([150, 75, 100]);
    const bad: string[] = [];
    for (const { calc: c, matchup } of HITS) {
      // Rebuild the pipeline up to the point the multiplier is applied.
      const modified = c.baseDamage + c.statBonusDamage + c.effectBonusDamage;
      const afterDefense = Math.max(1, modified - c.defense);
      const expected = Math.floor((afterDefense * matchupPct(matchup)) / 100) - afterDefense;
      if (c.matchupBonusDamage !== expected) {
        bad.push(`${matchup}: afterDefense ${afterDefense} -> expected ${expected}, got ${c.matchupBonusDamage}`);
      }
      // And the sign follows the label, so an inverted table cannot hide.
      if (matchup === 'advantage' && c.matchupBonusDamage < 0) bad.push('advantage REDUCED the hit');
      if (matchup === 'disadvantage' && c.matchupBonusDamage > 0) bad.push('disadvantage INCREASED the hit');
      if (matchup === 'neutral' && c.matchupBonusDamage !== 0) bad.push('neutral moved the hit');
    }
    expect(bad.slice(0, 4), `${bad.length} hits contradict the triangle`).toEqual([]);
  });

  it('defense is subtracted BEFORE the multiplier and never exceeds the hit', () => {
    // Mitigation order matters to the player: the same armor is worth more
    // against an advantaged hit if it is subtracted first. `defense` is reported
    // as what was ACTUALLY removed, so it can never exceed the pre-mitigation
    // total — a larger value would mean the engine reported a subtraction it
    // could not perform.
    const bad = HITS
      .filter(({ calc: c }) => c.defense > c.baseDamage + c.statBonusDamage + c.effectBonusDamage || c.defense < 0)
      .map(({ calc: c }) => `defense ${c.defense} vs pre-mitigation ${c.baseDamage + c.statBonusDamage + c.effectBonusDamage}`);
    expect(bad.slice(0, 4), `${bad.length} hits report an impossible defense`).toEqual([]);
  });
});

describe('the EXPOSE term specifically (the regression pin)', () => {
  // A hand-built calculation in the exact shape the sweep found: without the
  // EXPOSE term the parts sum to 26 while the total says 33. Both renderers
  // must print a term for it.
  const exposed: DamageCalculation = {
    scalingStat: 'attack', baseStat: 12, effectiveStat: 12, power: 18,
    baseDamage: 30, statBonusDamage: 0, effectBonusDamage: 0, defense: 4,
    minimumDamageBonus: 0, matchupBonusDamage: 0, suddenDeathBonusDamage: 0,
    guardReduction: 0, exposeBonus: 7, shieldBlocked: 0, hpDamage: 33,
  };

  it('the CLI line names EXPOSE and closes', () => {
    const line = fmtDamage(exposed);
    expect(line).toContain('+EXPOSE7');
    expect(sumCli(line)).toEqual({ parts: 33, total: 33 });
  });

  it('the in-game strip names EXPOSE and closes', () => {
    const line = formatDmg(exposed);
    expect(line).toContain('(7 EXPOSE)');
    expect(sumStrip(line)).toEqual({ parts: 33, total: 33 });
  });

  it('an absent exposeBonus prints no term at all', () => {
    // `exposeBonus` is optional on the event, so the un-exposed hit — the common
    // case — must stay clean rather than printing `+EXPOSE0`.
    const { exposeBonus: _drop, ...plain } = exposed;
    const clean: DamageCalculation = { ...plain, hpDamage: 26 };
    expect(fmtDamage(clean)).not.toContain('EXPOSE');
    expect(formatDmg(clean)).not.toContain('EXPOSE');
    expect(sumCli(fmtDamage(clean))).toEqual({ parts: 26, total: 26 });
    expect(sumStrip(formatDmg(clean))).toEqual({ parts: 26, total: 26 });
  });
});
