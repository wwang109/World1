import { describe, expect, it } from 'vitest';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import { guaranteedPowerLevelDeci, powerLevelDeci, capViolations, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { tierResolved } from '../../src/engine/types';
import type { Action, CombatConfig, SkillBook, SkillDef, SkillTier } from '../../src/engine/types';

/**
 * AFFINITY x TIER — the seam nothing was watching.
 *
 * `tests/engine/affinity.test.ts` drives gated actions hard at BRONZE and audits
 * the diamond capstones' PRICE, but no test had ever asked what `applyTier` does
 * to a card that ships a gated payload at bronze, and nothing at all ran one
 * above bronze through `simulate`. Both halves of that gap hid a live bug.
 *
 * THE RULE THE FAMILY RUNS ON (`autoScaleTier`, "GATED SINKS ARE FROZEN"): the
 * gated payload is what the card promises its board and does NOT move with rank;
 * the UNGATED line absorbs the whole tier delta. Every affinity card in the
 * catalog reads that way — base grows, payload constant.
 *
 * THE BUG (found 2026-08-26, fixed in `src/engine/cards.ts`). The freeze was
 * applied to the SINK bucket (`damage`/`heal`/`shield`/`cleanse`) and not to the
 * DoT bucket, which grows GREEDILY toward its family cap before the sink is
 * solved at all. `wildfire_rite` — the one gated DoT in the book — therefore
 * ranked Bronze(damage 32, gated burn 10) -> Silver(damage 16, gated burn 30):
 * its ALWAYS-ON half halved, and the budget went into a payload that does not
 * exist unless the board carries `IDENTITY_THRESHOLD` cards of Fire. Buying the
 * Silver copy was a strict downgrade for any board that could not open the gate,
 * and it did not recover until Diamond. The shop sells tiers for gold
 * (`GOLD_PRICE_BY_TIER`) and the run MERGES duplicates up a tier, so this was a
 * purchase that made the player worse.
 *
 * Every test below is written to fail if that freeze is removed again.
 */

/** Any action carrying the affinity modifier. */
function isGated(a: Action): boolean {
  return a.affinity === true;
}

/** The one numeric magnitude an action carries, whatever its family calls it. */
function magnitude(a: Action): number {
  const fields = ['power', 'stacks', 'turns', 'amount', 'charges'] as const;
  const record = a as unknown as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'number') return value;
  }
  return 0;
}

const RANKS: readonly SkillTier[] = ['silver', 'gold', 'diamond'];

/** Cards that ship a gated payload at BRONZE (not the diamond capstones, whose
 * gated hit does not exist at bronze to be frozen against).
 *
 * MEASURED THROUGH `tierResolved` (2026-08-26, the Q1 `minTier` migration), not off
 * the raw `effects` list. The five capstones now write their gated hit ONCE, in
 * `effects`, carrying `{ affinity: true, minTier: 'diamond' }` — so the raw list
 * names it at every rank while the BRONZE COPY does not have it. A raw filter would
 * pull all five in here and assert the freeze against a payload that does not exist
 * yet, which is precisely the case this set was defined to exclude. Their own rule
 * (a conditional Diamond trade, guarded by a named allowlist) lives in
 * `tests/engine/tierLock.test.ts` and `tests/engine/balance.test.ts`. */
const GATED_AT_BRONZE: SkillDef[] = Object.values(skillBook)
  .filter((c) => tierResolved(c).effects.some(isGated));

describe('a gated payload is FROZEN at every rank, and the ungated line grows', () => {
  it('the catalog actually ships cards to audit — this suite is not vacuous', () => {
    expect(GATED_AT_BRONZE.length, 'no affinity card ships a gated payload at bronze').toBeGreaterThan(0);
    // And they span more than one family, or "frozen" would only ever be proven
    // for `damage` and the DoT/control/heal cases would be untested by name.
    const families = new Set(GATED_AT_BRONZE.flatMap((c) => c.effects.filter(isGated).map((a) => a.kind)));
    expect([...families].sort().length, `gated families in the book: ${[...families].join(', ')}`).toBeGreaterThan(1);
  });

  it('every shipped gated action holds its BRONZE magnitude at silver, gold and diamond', () => {
    const drifted: string[] = [];
    for (const card of GATED_AT_BRONZE) {
      for (const tier of RANKS) {
        const ranked = applyTier(card, tier);
        card.effects.forEach((base, i) => {
          if (!isGated(base)) return;
          const at = ranked.effects[i];
          if (!at || at.kind !== base.kind) {
            drifted.push(`${card.id}@${tier}: gated ${base.kind} vanished or changed kind`);
            return;
          }
          if (!isGated(at)) drifted.push(`${card.id}@${tier}: gated ${base.kind} lost its affinity flag`);
          if (magnitude(at) !== magnitude(base)) {
            drifted.push(`${card.id}@${tier}: gated ${base.kind} ${magnitude(base)} -> ${magnitude(at)}`);
          }
        });
      }
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
  });

  it('and the UNGATED line never shrinks with rank — buying the upgrade is an upgrade', () => {
    // THE BUG, stated as the property it broke. `wildfire_rite` went 32 -> 16 on
    // the bronze -> silver step; every other card in the family grew. Note this
    // is asserted ONLY for cards that carry a gated payload at bronze: an
    // authored `tierUpgrades` block elsewhere in the book may legitimately trade
    // base damage for a NEW effect the lower tier could not afford (crushing_blow,
    // sword_slash, crippling_strike…), and this rule is not about those.
    //
    // RE-SCOPED 2026-08-26, and the scope is the whole point of the rule. A card
    // carrying a TIER LOCK (`minTier`, engine/types.ts) is allowed to shrink a line
    // to afford the effect that unlocks at that rank — the payload is
    // UNCONDITIONAL there, so every owner of the rank gets it and the exchange is
    // real (user ruling: "reducing some effect at higher tier to gain new ones").
    // This rule is about the opposite case: budget moving into a payload that only
    // SOME BOARDS can trigger, which is what made the Silver `wildfire_rite` a
    // purchase that left the player worse. So locked cards are excluded here and
    // held to the guaranteed-value rule instead — `tests/engine/tierLock.test.ts`,
    // "THE TRADE IS REAL", which measures `guaranteedPowerLevelDeci` rather than a
    // single line's magnitude precisely because a trade moves lines both ways.
    const regressions: string[] = [];
    let grew = 0;
    for (const card of GATED_AT_BRONZE.filter((c) => !c.effects.some((a) => a.minTier !== undefined))) {
      const ladder = [card, ...RANKS.map((t) => applyTier(card, t))];
      card.effects.forEach((base, i) => {
        if (isGated(base)) return;
        for (let step = 1; step < ladder.length; step += 1) {
          const prev = ladder[step - 1]!.effects[i];
          const cur = ladder[step]!.effects[i];
          if (!prev || !cur || prev.kind !== cur.kind) continue;
          if (magnitude(cur) < magnitude(prev)) {
            regressions.push(`${card.id}: ungated ${cur.kind} ${magnitude(prev)} -> ${magnitude(cur)} at ${ladder[step]!.tier}`);
          }
          if (magnitude(cur) > magnitude(prev)) grew += 1;
        }
      });
    }
    expect(regressions, regressions.join('\n')).toEqual([]);
    // Non-vacuity: "never shrinks" is trivially true of a ladder that never
    // moves, which is exactly what a broken solver returns (base kit, tier
    // bumped). The ladders must actually climb.
    expect(grew, 'no ungated line grew at any rank — the solver is returning base kits').toBeGreaterThan(GATED_AT_BRONZE.length);
  });

  it('and what a gated card GUARANTEES on any board never falls with rank either', () => {
    // The rule the magnitude test above cannot state once a card is allowed to
    // trade lines: measure the kit with every CONDITIONAL line switched off
    // (`guaranteedPowerLevelDeci`) and require THAT to climb. It is the same
    // property — "buying the upgrade is an upgrade for a board that cannot open
    // the gate" — expressed as one number instead of per line, so it survives a
    // rank-up that grows one line and shrinks another. Asserted over EVERY card
    // that ships a gated payload at bronze, locked or not.
    const regressions: string[] = [];
    for (const card of GATED_AT_BRONZE) {
      let previous = guaranteedPowerLevelDeci(card);
      for (const tier of RANKS) {
        const now = guaranteedPowerLevelDeci(applyTier(card, tier));
        if (now < previous) regressions.push(`${card.id}@${tier}: guaranteed ${previous / 10} -> ${now / 10} PL`);
        previous = now;
      }
    }
    expect(regressions, regressions.join('\n')).toEqual([]);
    // NON-VACUITY: the measure must actually be smaller than the whole card's PL
    // somewhere, or it is just `powerLevelDeci` under another name and this test
    // is the vacuous "the budget rises with the tier" assertion.
    const discriminates = GATED_AT_BRONZE.some((c) => guaranteedPowerLevelDeci(c) < powerLevelDeci(c));
    expect(discriminates, 'guaranteed PL never differs from total PL — the measure is not measuring').toBe(true);
  });

  it('every rank of every affinity card still lands EXACTLY on its tier budget and within caps', () => {
    for (const card of GATED_AT_BRONZE) {
      for (const tier of RANKS) {
        const ranked = applyTier(card, tier);
        expect(powerLevelDeci(ranked), `${card.id}@${tier} budget`).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(ranked), `${card.id}@${tier} caps`).toEqual([]);
      }
    }
  });
});

describe('THE MECHANISM: the affinity flag is what freezes a line, in every bucket', () => {
  /**
   * A synthetic gated-DoT card with NO authored `tierUpgrades`, so the solver
   * itself has to be right. `wildfire_rite` now carries authored blocks that
   * produce the correct numbers whatever the solver does, which would let the
   * defect back in unseen — this probe is the guard that cannot be papered over
   * by content.
   */
  const GATED_DOT: SkillDef = {
    id: 'gated_dot_probe', name: 'Gated DoT Probe', archetypes: ['offense'],
    property: 'magical', element: 'fire', size: 2, rarity: 'common', tier: 'bronze',
    effects: [{ kind: 'damage', power: 32 }, { kind: 'burn', stacks: 10, affinity: true }],
    text: 'Deal 32 (+MATK) Fire damage · {{Affinity}} Fire — {{Burn}} 10.',
  };
  /** The SAME card with the gate removed — the control. */
  const PLAIN_DOT: SkillDef = {
    ...GATED_DOT, id: 'plain_dot_probe',
    effects: [{ kind: 'damage', power: 32 }, { kind: 'burn', stacks: 10 }],
  };

  const burnOf = (s: SkillDef): number => magnitude(s.effects.find((a) => a.kind === 'burn')!);
  const dmgOf = (s: SkillDef): number => magnitude(s.effects.find((a) => a.kind === 'damage')!);

  it('a GATED DoT holds its stacks while the ungated damage absorbs the whole tier delta', () => {
    let previous = dmgOf(GATED_DOT);
    for (const tier of RANKS) {
      const ranked = autoScaleTier(GATED_DOT, tier);
      expect(burnOf(ranked), `${tier}: gated burn must not move`).toBe(burnOf(GATED_DOT));
      expect(dmgOf(ranked), `${tier}: the ungated hit must grow`).toBeGreaterThan(previous);
      expect(powerLevelDeci(ranked), `${tier}: exactly on budget`).toBe(TIER_BUDGET_DECI[tier]);
      previous = dmgOf(ranked);
    }
  });

  it('the UNGATED twin does the opposite — its DoT grows and its damage gives way', () => {
    // The control that makes the test above mean something: with the flag off,
    // the solver's greedy DoT walk is the correct, intended behaviour (it is how
    // every hand-tuned DoT curve in the book is derived). So the difference
    // between these two cards is the flag and nothing else.
    const silver = autoScaleTier(PLAIN_DOT, 'silver');
    expect(burnOf(silver), 'ungated: the DoT grows toward its cap').toBeGreaterThan(burnOf(PLAIN_DOT));
    expect(dmgOf(silver), 'ungated: and the sink pays for it').toBeLessThan(dmgOf(PLAIN_DOT));
    // Same budget either way — both are honest cards, they just spend differently.
    expect(powerLevelDeci(silver)).toBe(TIER_BUDGET_DECI.silver);
  });
});

describe('the gate SURVIVES the rank-up — a Diamond copy still asks the board for three', () => {
  /**
   * Nothing in the suite had ever run an affinity card above Bronze through
   * `simulate`. Tier resolution happens in `resolveEffectiveSkill` BEFORE the
   * gate is checked, so a tier path that dropped (or invented) `affinity: true`
   * would turn a conditional card into an unconditional one — the exact failure
   * `affinity.test.ts` describes as invisible in ordinary play, one tier up
   * where nothing was looking.
   */
  const CARD = 'wildfire_rite';
  const ON_TYPE = [CARD, 'kindling_rite', 'cinder_skin'];   // 3 Fire; neither partner burns
  const OFF_TYPE = [CARD, 'sword_slash', 'twin_slash'];     // 1 Fire, 2 Sword -> no identity

  function run(board: readonly string[], tier: SkillTier): { burns: number; casts: number } {
    let slot = 0;
    const pieces = board.map((id) => {
      const piece = { skillId: id, slot, tier };
      slot += skillBook[id]!.size;
      return piece;
    });
    const config: CombatConfig = {
      playerTeam: [{
        name: 'Hero',
        stats: { maxHp: 900, hp: 900, attack: 10, magicPower: 10, armor: 0, magicResist: 0, speed: 30 },
        pieces, boardSize: 10,
      } as never],
      enemyTeam: [{
        name: 'Foe',
        stats: { maxHp: 40000, hp: 40000, attack: 1, magicPower: 1, armor: 0, magicResist: 0, speed: 6 },
        pieces: [{ skillId: 'sword_slash', slot: 0 }], boardSize: 4,
      } as never],
      skillBook, maxTurns: 20, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
    } as never;
    let burns = 0;
    let casts = 0;
    for (const e of simulate(config, 5).events) {
      if (e.kind === 'play' && e.side === 'player' && e.skillId === CARD) casts += 1;
      if (e.kind === 'statusApplied' && e.side === 'enemy'
        && (e as never as { status: string }).status === 'burn') burns += 1;
    }
    return { burns, casts };
  }

  for (const tier of ['bronze', 'diamond'] as const) {
    it(`${tier}: the gated burn lands on-type and does not exist off-type`, () => {
      const on = run(ON_TYPE, tier);
      const off = run(OFF_TYPE, tier);
      // NON-VACUITY: the card must actually cast on BOTH boards, or "no burn"
      // would just mean "never played" and the whole comparison is empty.
      expect(on.casts, `${CARD} never cast on the on-type board`).toBeGreaterThan(0);
      expect(off.casts, `${CARD} never cast on the off-type board`).toBeGreaterThan(0);
      expect(on.burns, `${tier} on-type: the gated burn must land`).toBeGreaterThan(0);
      expect(off.burns, `${tier} off-type: the gated burn must not exist`).toBe(0);
    });
  }

  it('and the Diamond copy hits HARDER than the Bronze one on the board that cannot open the gate', () => {
    // The player-facing promise of a rank-up, measured where the payload is
    // switched off: the always-on half must be strictly better for the gold.
    // This is the assertion the pre-fix engine failed outright at Silver.
    const hits = (tier: SkillTier): number[] => {
      let slot = 0;
      const pieces = OFF_TYPE.map((id) => {
        const piece = { skillId: id, slot, tier: id === CARD ? tier : ('bronze' as SkillTier) };
        slot += skillBook[id]!.size;
        return piece;
      });
      const config: CombatConfig = {
        playerTeam: [{
          name: 'Hero',
          stats: { maxHp: 900, hp: 900, attack: 10, magicPower: 10, armor: 0, magicResist: 0, speed: 30 },
          pieces, boardSize: 10,
        } as never],
        enemyTeam: [{
          name: 'Foe',
          stats: { maxHp: 40000, hp: 40000, attack: 1, magicPower: 1, armor: 0, magicResist: 0, speed: 6 },
          pieces: [{ skillId: 'sword_slash', slot: 0 }], boardSize: 4,
        } as never],
        skillBook, maxTurns: 20, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
      } as never;
      const out: number[] = [];
      let current = '';
      for (const e of simulate(config, 5).events) {
        if (e.kind === 'play' && e.side === 'player') current = e.skillId;
        if (e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill' && current === CARD) out.push(e.amount);
      }
      return out;
    };
    const ladder = (['bronze', 'silver', 'gold', 'diamond'] as SkillTier[]).map(hits);
    for (const step of ladder) expect(step.length, 'every rank must land hits to compare').toBeGreaterThan(0);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]![0]!, `rank ${i}: the off-type hit must not go backwards`).toBeGreaterThan(ladder[i - 1]![0]!);
    }
  });
});
