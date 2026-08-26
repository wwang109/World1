import { describe, expect, it } from 'vitest';
import { applyTier } from '../../src/engine/cards';
import {
  capViolations,
  guaranteedPowerLevelDeci,
  instancePowerLevelDeci,
  powerLevelBreakdown,
  powerLevelDeci,
  PRICE,
  TIER_BUDGET_DECI,
} from '../../src/engine/balance';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { validateSkillDocument } from '../../src/data/validateSkillContent';
import { validateGemDocument } from '../../src/data/validateGemContent';
import { cardExistsAtTier, tierResolved, TIER_ORDER } from '../../src/engine/types';
import type { Action, CombatConfig, SkillDef, SkillTier } from '../../src/engine/types';

/**
 * TIER-LOCKED EFFECTS — `minTier` on an action: "this line does not exist below
 * this tier".
 *
 * WHAT IT REPLACES, and why the duplication was a defect rather than a style
 * choice. An effect that only exists at a higher tier used to need an authored
 * `tierUpgrades.<tier>.effects` block — a full restatement of the card's whole
 * kit, per tier, to add one line. Five Diamond capstones do exactly that. Both
 * failure modes that duplication invites have already happened here: when the
 * affinity refund moved 4/5 -> 1/2 every one of those hand-solved payloads had to
 * be re-derived by hand (and nothing would have caught a fractional one), and a
 * `tierUpgrades` text once disagreed with the effects printed beside it.
 *
 * THE SHAPE OF THE FEATURE. `minTier` is the SIBLING of `affinity`
 * (`AffinityGated`): a cross-cutting flag any action may carry, enforced in ONE
 * place. The difference is WHERE, and it follows from what each condition depends
 * on — affinity depends on the BOARD, so it is a cast-time check in `applyAction`;
 * a tier is known statically, so the lock is resolved at the RESOLVER SEAM
 * (`tierResolved`, engine/types.ts) and the action is simply STRIPPED below its
 * lock. Everything downstream is then correct with no new branch: the pricer, the
 * effect caps, the multi-hit divisor, the tier solver, the card face and the
 * combat loop all see a card that does not have that line.
 *
 * SO PRICING IS "ABSENT COSTS NOTHING". A locked action costs 0 deci at every
 * tier below its lock and FULL price at and above it. There is no lock discount
 * anywhere — a Gold-locked stun costs a Gold copy exactly what a directly
 * authored stun costs.
 *
 * WHAT THIS SUITE IS FOR. Nothing in the catalog carries a lock yet (content is
 * authored elsewhere), so every claim here is made against SYNTHETIC defs and
 * against the five shipped capstones re-expressed as one ladder. Each suite
 * carries its own explicit non-vacuity assertion, because a tier-lock suite that
 * silently measures nothing is exactly the failure mode this project has
 * repeatedly paid for.
 */

const RANKS: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

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

/** Effects compared ignoring the lock flag itself — the flag is authoring, not behaviour. */
function shapeOf(effects: readonly Action[]): string {
  return JSON.stringify(effects.map((a) => {
    const copy: Record<string, unknown> = { ...a };
    delete copy['minTier'];
    return copy;
  }));
}

// ---------------------------------------------------------------------------
// SUITE 1 — the migration is EXACT on the five cards that motivated the feature.
// ---------------------------------------------------------------------------

/**
 * Every shipped Diamond capstone, read off THE ONE DEFINITION.
 *
 * MIGRATED 2026-08-26 (Q1). These five used to restate their whole `effects` list
 * inside a `tierUpgrades.diamond` block so that one gated hit could appear at
 * Diamond; they now carry that hit ONCE, in `effects`, flagged
 * `{ affinity: true, minTier: 'diamond' }`. So the derivation below reads the
 * base kit and asks which cards gain a GATED HIT at a rank above their own —
 * which is what "capstone" has always meant. The before/after equivalence of the
 * migration itself (byte-identical resolved output at all four tiers, measured
 * against the PRE-migration definitions read out of git) lives in
 * `tests/engine/tierLockMigration.test.ts`.
 */
const CAPSTONES = Object.values(skillBook).flatMap((card) =>
  card.effects
    .filter((a) => a.affinity === true && a.minTier !== undefined)
    .map((a) => ({ card, tier: a.minTier as SkillTier })));

describe('THE FIVE DIAMOND CAPSTONES ARE ONE LADDER EACH', () => {
  it('the capstones exist as locks — this suite is not vacuous', () => {
    expect(CAPSTONES.length, 'no shipped card locks a gated action to a higher tier').toBe(5);
    for (const { card, tier } of CAPSTONES) {
      expect(tier, `${card.id}: capstones are a Diamond design statement`).toBe('diamond');
      // ONE definition, no restatement: the whole point of the migration.
      const upgrades = Object.values(card.tierUpgrades ?? {});
      expect(upgrades.some((up) => up.effects !== undefined), `${card.id} must not restate its effects`).toBe(false);
      // ...and the Bronze copy is genuinely ungated — the lock is what does it.
      expect(tierResolved(card).effects.some((a) => a.affinity === true), `${card.id} bronze must be ungated`).toBe(false);
    }
  });

  it('every rung is exactly on budget and within caps, re-solved from the one kit', () => {
    for (const { card } of CAPSTONES) {
      for (const rank of RANKS) {
        const one = applyTier(card, rank);
        expect(powerLevelDeci(one), `${card.id}@${rank} budget`).toBe(TIER_BUDGET_DECI[rank]);
        expect(capViolations(one), `${card.id}@${rank} caps`).toEqual([]);
      }
    }
  });

  it('and the LOCK is what does it — the same list without `minTier` is a different, off-budget card', () => {
    // The control. Drop the lock and the gated line exists at every tier, so
    // Bronze is instantly over budget: proof the assertions above are testing the
    // lock rather than passing for free.
    let overBudget = 0;
    for (const { card } of CAPSTONES) {
      const unlocked: SkillDef = {
        ...card,
        effects: card.effects.map((a) => {
          const copy: Record<string, unknown> = { ...a };
          delete copy['minTier'];
          return copy as unknown as Action;
        }),
      };
      if (powerLevelDeci(unlocked) > TIER_BUDGET_DECI[unlocked.tier]) overBudget += 1;
    }
    expect(overBudget, 'without the lock every capstone payload lands at Bronze and blows the budget').toBe(CAPSTONES.length);
  });
});

// ---------------------------------------------------------------------------
// SUITE 2 — pricing at every tier, on a synthetic unconditional lock.
// ---------------------------------------------------------------------------

/**
 * THE PROBE. A plain Sword hit that gains a 1-turn stun at Gold. `stun` is the
 * right locked line to probe with: it is FROZEN control (the solver never scales
 * it), it is priced at a flat 100 deci (`PRICE.stunPerTurn`) which is a large
 * share of a Gold budget of 200, and it sits exactly on the size-1 control cap —
 * so it forces the interesting cases: the base line must SHRINK to afford it, and
 * a cap that must bind at Gold and not at Bronze.
 */
const LOCK_PROBE: SkillDef = {
  id: 'lock_trade_probe', name: 'Lock Trade Probe', archetypes: ['offense'],
  property: 'physical', weapon: 'sword', size: 1, rarity: 'common', tier: 'bronze',
  effects: [{ kind: 'damage', power: 20 }, { kind: 'stun', turns: 1, minTier: 'gold' }],
  text: 'Deal 20 (+ATK) Sword damage · Gold+: {{Stun}} 1 turn.',
};

/** The same kit with the locked line deleted outright — "the card without it". */
const WITHOUT_LOCKED_LINE: SkillDef = { ...LOCK_PROBE, effects: [LOCK_PROBE.effects[0]!] };
/** The same kit with the locked line authored unconditionally — "the card with it, at full price". */
const LINE_AUTHORED_PLAIN: SkillDef = {
  ...LOCK_PROBE,
  effects: [LOCK_PROBE.effects[0]!, { kind: 'stun', turns: 1 }],
};

describe('PRICING: a locked line costs nothing below its lock and full price at and above', () => {
  const at = (tier: SkillTier): SkillDef => applyTier(LOCK_PROBE, tier);

  it('the ladder resolves the line in at exactly its lock tier — this suite is not vacuous', () => {
    const has = (tier: SkillTier): boolean => at(tier).effects.some((a) => a.kind === 'stun');
    expect(has('bronze'), 'bronze must not have the locked line').toBe(false);
    expect(has('silver'), 'silver must not have the locked line').toBe(false);
    expect(has('gold'), 'gold must have it').toBe(true);
    expect(has('diamond'), 'diamond must have it').toBe(true);
  });

  it('BELOW the lock the card prices as though the line were not written at all', () => {
    for (const tier of ['bronze', 'silver'] as SkillTier[]) {
      const locked = at(tier);
      const deleted = applyTier(WITHOUT_LOCKED_LINE, tier);
      expect(powerLevelDeci(locked), `${tier}: locked vs deleted`).toBe(powerLevelDeci(deleted));
      expect(shapeOf(locked.effects), `${tier}: same kit`).toBe(shapeOf(deleted.effects));
    }
  });

  it('AT and ABOVE the lock it prices exactly like the same line authored with no lock', () => {
    for (const tier of ['gold', 'diamond'] as SkillTier[]) {
      const locked = at(tier);
      const plain = applyTier(LINE_AUTHORED_PLAIN, tier);
      // The plain twin is over budget at BRONZE (that is the whole reason the line
      // is locked), so compare the KITS the solver lands on rather than assuming
      // the twin is a legal card: at Gold+ the two must be the same card.
      expect(shapeOf(locked.effects), `${tier}: same kit as an unlocked twin`).toBe(shapeOf(plain.effects));
      expect(powerLevelDeci(locked), `${tier}: same price`).toBe(powerLevelDeci(plain));
    }
  });

  it('every reachable tier lands EXACTLY on its budget and inside every cap', () => {
    for (const tier of RANKS) {
      expect(powerLevelDeci(at(tier)), `${tier} budget`).toBe(TIER_BUDGET_DECI[tier]);
      expect(capViolations(at(tier)), `${tier} caps`).toEqual([]);
    }
  });

  it('the ladder, printed: 20 · 30 · 20+stun · 30+stun — the base SHRINKS to afford the unlock', () => {
    // The user ruling this feature exists for (2026-08-26): "we should have the
    // cards tier up allowed to remove extra PL to fit in higher tier effect that
    // might cost more PL, so reducing some effect at higher tier to gain new
    // ones." Silver buys 10 more damage; Gold spends that 10 damage plus the tier
    // step on a stun. Both are exactly on budget.
    const dmg = (tier: SkillTier): number => magnitude(at(tier).effects.find((a) => a.kind === 'damage')!);
    expect([dmg('bronze'), dmg('silver'), dmg('gold'), dmg('diamond')]).toEqual([20, 30, 20, 30]);
    expect(dmg('gold'), 'the trade: Gold gives up Silver damage for the stun').toBeLessThan(dmg('silver'));
  });

  /**
   * THE PATH NOBODY RESOLVES FIRST. `powerLevelDeci` / `capViolations` /
   * `powerLevelBreakdown` / `instancePowerLevelDeci` are all handed the AUTHORED
   * def straight out of the book — that is how `balance.test.ts` audits the
   * catalog, how the wiki prints a PL, and how the shop values a piece. None of
   * them calls `applyTier` first, so if the lock were only resolved at the
   * resolver seam every one of those surfaces would charge a Bronze card for its
   * Diamond line. These assertions are what forced the resolution INTO the pricer
   * (a mutant that removes it passes every other test in this file).
   */
  it('the AUTHORED def prices at its OWN tier, with nobody resolving it first', () => {
    expect(powerLevelDeci(LOCK_PROBE), 'raw def on the bronze budget')
      .toBe(TIER_BUDGET_DECI.bronze);
    expect(powerLevelDeci(LOCK_PROBE), 'raw def == the same card without the locked line')
      .toBe(powerLevelDeci(WITHOUT_LOCKED_LINE));
    // The itemized breakdown must agree with it, part for part: no `stun` row at
    // bronze, and the parts still sum EXACTLY to the total (the invariant
    // `powerLevelBreakdown` is required to hold).
    const parts = powerLevelBreakdown(LOCK_PROBE);
    expect(parts.map((x) => x.label), 'no locked line in the bronze breakdown').not.toContain('stun');
    expect(parts.reduce((sum, x) => sum + x.deci, 0)).toBe(powerLevelDeci(LOCK_PROBE));
    expect(powerLevelBreakdown(applyTier(LOCK_PROBE, 'gold')).map((x) => x.label), 'and it IS there at gold')
      .toContain('stun');
    // Per-instance PL (the shop/board readout) resolves too.
    expect(instancePowerLevelDeci(LOCK_PROBE, { gem: null })).toBe(TIER_BUDGET_DECI.bronze);
    // And the guaranteed share, which is measured off the same kit.
    expect(guaranteedPowerLevelDeci(LOCK_PROBE)).toBe(TIER_BUDGET_DECI.bronze);
  });

  it('an AUTHORED def cannot break a cap with a line it does not have yet', () => {
    const overCapRaw: SkillDef = {
      ...LOCK_PROBE, id: 'lock_cap_raw_probe',
      effects: [{ kind: 'damage', power: 20 }, { kind: 'stun', turns: 2, minTier: 'gold' }],
    };
    expect(capViolations(overCapRaw), 'the raw bronze def is clean').toEqual([]);
    // ...but the same list authored WITHOUT the lock is not — the control that
    // proves the assertion above is about the lock and not about `stun 2` being
    // legal at size 1.
    const noLock: SkillDef = { ...overCapRaw, effects: [{ kind: 'damage', power: 20 }, { kind: 'stun', turns: 2 }] };
    expect(capViolations(noLock).join('|'), 'unlocked, it breaks the control cap at bronze').toContain('control');
  });

  it('a HOST-AWARE gem term reads the host as it exists at this tier, not as authored', () => {
    // The one place `instancePowerLevelDeci` needs the resolution of its own (a
    // mutant that removes it survives everything above): an ECHO prices as the
    // share of its HOST's own damage line it repeats (`echoHostShareDeci`), and
    // that line is exactly what a lock changes. A Bronze copy of this host has 20
    // points of damage, a Diamond copy has 60 — so the same socket is worth 5 PL
    // on one and 15 on the other, and pricing the authored list would charge the
    // Bronze card the Diamond echo.
    const host: SkillDef = {
      ...LOCK_PROBE, id: 'lock_echo_host',
      effects: [{ kind: 'damage', power: 20 }, { kind: 'damage', power: 40, minTier: 'diamond' }],
    };
    const echo = {
      kind: 'effect' as const, id: 'probe_echo', rarity: 'legendary' as const,
      actions: [{ kind: 'statStrike' as const, shareOf: 2, echoHostPower: true as const }],
    };
    /** The gem's own contribution on this host: instance PL minus the card's own. */
    const echoTerm = (card: SkillDef): number =>
      instancePowerLevelDeci(card, { gem: echo }) - powerLevelDeci(card) - PRICE.extraHitPremium;
    /** The damage points the echo repeats a share of. */
    const ownDamage = (card: SkillDef): number =>
      card.effects.filter((a) => a.kind === 'damage').reduce((n, a) => n + magnitude(a), 0);
    // NON-VACUITY: the authored list and the bronze kit must actually disagree
    // about the host's damage, or "reads the resolved kit" is untestable here.
    expect(ownDamage(host), 'authored (both lines)').toBe(60);
    expect(ownDamage(tierResolved(host)), 'bronze kit (one line)').toBe(20);
    expect(echoTerm(host), 'the bronze echo repeats a share of 20, not of 60')
      .toBe(Math.ceil(ownDamage(tierResolved(host)) / 2) * PRICE.flatPowerPerPoint);
    const diamond = applyTier(host, 'diamond');
    expect(echoTerm(diamond), 'and the diamond echo repeats a share of the diamond kit')
      .toBe(Math.ceil(ownDamage(diamond) / 2) * PRICE.flatPowerPerPoint);
    expect(echoTerm(diamond), 'a diamond host is a bigger echo').toBeGreaterThan(echoTerm(host));
  });

  it('a locked line is CAPPED at the tier it appears and not before', () => {
    // `stun 2` breaks the size-1 control cap (100 deci) outright. Locked to Gold it
    // must be legal at Bronze/Silver — where it does not exist — and a violation
    // from Gold up. A lock that hid a cap break would be a hole in the audit.
    const overCap: SkillDef = {
      ...LOCK_PROBE, id: 'lock_cap_probe',
      effects: [{ kind: 'damage', power: 20 }, { kind: 'stun', turns: 2, minTier: 'gold' }],
    };
    expect(capViolations(applyTier(overCap, 'bronze')), 'bronze: the line does not exist').toEqual([]);
    expect(capViolations(applyTier(overCap, 'silver')), 'silver: the line does not exist').toEqual([]);
    for (const tier of ['gold', 'diamond'] as SkillTier[]) {
      const violations = capViolations(applyTier(overCap, tier));
      expect(violations.join('|'), `${tier}: the cap must bind`).toContain('control');
    }
  });
});

// ---------------------------------------------------------------------------
// SUITE 3 — a trade must be a TRADE, never a downgrade.
// ---------------------------------------------------------------------------

describe('THE TRADE IS REAL: what a rank-up guarantees never falls for an UNCONDITIONAL unlock', () => {
  /**
   * WHY `powerLevelDeci` IS THE WRONG MEASURE HERE, and this is the crux of the
   * suite. Total PL always equals the tier budget — the audits enforce it — so
   * "total value did not fall" is VACUOUSLY true at every rank and cannot see the
   * failure the project cares about: budget moving out of the always-on kit and
   * into a payload only some boards can trigger (the shipped `wildfire_rite` bug).
   *
   * The honest measure is the GUARANTEED share
   * (`guaranteedPowerLevelDeci`): the kit priced with every CONDITIONAL line
   * switched off. A tier-locked line counts toward it, because at that rank it
   * fires for every owner; an affinity-gated line does not.
   */
  const guaranteed = (def: SkillDef, tier: SkillTier): number => guaranteedPowerLevelDeci(applyTier(def, tier));

  it('the probe trades a line DOWN and still climbs on every step', () => {
    const ladder = RANKS.map((t) => guaranteed(LOCK_PROBE, t));
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!, `${RANKS[i]}: guaranteed value must not fall`).toBeGreaterThan(ladder[i - 1]!);
    }
    // NON-VACUITY, the part that makes this a test of a TRADE rather than of
    // monotone growth: a line must actually have SHRUNK somewhere in that ladder.
    // Without this the assertion above passes for any card that only ever grows,
    // i.e. exactly the case the feature is not about.
    const dmg = (t: SkillTier): number => magnitude(applyTier(LOCK_PROBE, t).effects.find((a) => a.kind === 'damage')!);
    const shrank = RANKS.slice(1).some((t, i) => dmg(t) < dmg(RANKS[i]!));
    expect(shrank, 'no line shrank — this ladder is not a trade and proves nothing').toBe(true);
    // And where it shrank, the card GAINED something: an exchange, not a nerf.
    expect(applyTier(LOCK_PROBE, 'gold').effects.length)
      .toBeGreaterThan(applyTier(LOCK_PROBE, 'silver').effects.length);
  });

  it('the measure CAN fall — a CONDITIONAL unlock makes it fall, which is why it is the right measure', () => {
    // The negative control, and the honest admission about the shipped capstones:
    // their Diamond copy really does guarantee LESS than their Gold copy (the base
    // hit drops to pay for a gated one). That is an accepted, deliberate design —
    // top tier only, both numbers printed on the face (`affinity.test.ts`) — but it
    // is a CONDITIONAL rank-up and must be visible as one, never fallen into.
    const falls: string[] = [];
    for (const { card } of CAPSTONES) {
      const before = guaranteed(card, 'gold');
      const after = guaranteed(card, 'diamond');
      if (after < before) falls.push(`${card.id}: guaranteed ${before / 10} PL @gold -> ${after / 10} PL @diamond`);
    }
    expect(falls.length, `a conditional unlock must show up as a falling guarantee:\n${falls.join('\n')}`)
      .toBe(CAPSTONES.length);
  });

  it('...and across the SHIPPED book, only those five do it', () => {
    // The pin. Any new card whose guaranteed share drops with rank shows up here
    // and has to be justified deliberately, rather than shipping as a purchase
    // that made the player worse.
    const KNOWN = new Set(CAPSTONES.map(({ card }) => card.id));
    const offenders: string[] = [];
    for (const card of Object.values(skillBook)) {
      let previous = guaranteedPowerLevelDeci(card);
      for (const tier of RANKS.slice(1)) {
        if (!cardExistsAtTier(card, tier)) continue;
        const now = guaranteed(card, tier);
        if (now < previous && !KNOWN.has(card.id)) {
          offenders.push(`${card.id}@${tier}: guaranteed ${previous / 10} -> ${now / 10} PL`);
        }
        previous = now;
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
    expect(KNOWN.size, 'the allowlist must not be empty — that would make this vacuous').toBe(5);
  });
});

// ---------------------------------------------------------------------------
// SUITE 4 — composition with affinity, through `simulate`.
// ---------------------------------------------------------------------------

describe('COMPOSITION: locked AND gated means "only at Diamond, and only on the right board"', () => {
  /** `arcane_bolt`'s capstone as one ladder: a Lightning hit that learns a second one at Diamond. */
  const PROBE: SkillDef = {
    id: 'lock_affinity_probe', name: 'Lock Affinity Probe', archetypes: ['offense'],
    property: 'magical', element: 'lightning', size: 1, rarity: 'common', tier: 'bronze',
    speedWeight: 8,
    effects: [
      { kind: 'damage', power: 18 },
      { kind: 'damage', power: 48, affinity: true, minTier: 'diamond' },
    ],
    text: 'Deal 18 (+MATK) Lightning damage · Diamond+ {{Affinity}} Lightning — hit again for 48.',
  };
  const ON_TYPE = [PROBE.id, 'static_jolt', 'chain_spark'];   // 3 Lightning -> identity
  const OFF_TYPE = [PROBE.id, 'sword_slash', 'twin_slash'];   // 1 Lightning -> none

  const book = { ...skillBook, [PROBE.id]: PROBE };

  function hits(board: readonly string[], tier: SkillTier): { casts: number; amounts: number[] } {
    let slot = 0;
    const pieces = board.map((id) => {
      const piece = { skillId: id, slot, tier };
      slot += book[id]!.size;
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
      skillBook: book, maxTurns: 20, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
    } as never;
    let casts = 0;
    let current = '';
    // ONE CAST'S WORTH. The probe fires several times over the fight, so the
    // hit-count claim is per cast — pooling every cast's hits would make "two
    // hits" mean nothing.
    const amounts: number[] = [];
    for (const e of simulate(config, 5).events) {
      if (e.kind === 'play' && e.side === 'player') {
        current = e.skillId;
        if (e.skillId === PROBE.id) casts += 1;
      }
      if (casts === 1 && e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill' && current === PROBE.id) {
        amounts.push(e.amount);
      }
    }
    return { casts, amounts };
  }

  it('the probe casts on every board and tier under test — this suite is not vacuous', () => {
    for (const tier of ['gold', 'diamond'] as SkillTier[]) {
      for (const board of [ON_TYPE, OFF_TYPE]) {
        expect(hits(board, tier).casts, `${tier} ${board.join('+')}`).toBeGreaterThan(0);
      }
    }
  });

  it('at GOLD the gated hit does not exist — not even on the board that would open it', () => {
    // THE LOCK IS CHECKED FIRST, and this is the assertion that proves the two
    // flags compose rather than one shadowing the other: an on-type Lightning
    // board opens the affinity gate, and it still gets one hit, because there is
    // no second action on a Gold copy to gate.
    expect(hits(ON_TYPE, 'gold').amounts.length, 'gold on-type: one hit').toBe(1);
    expect(hits(OFF_TYPE, 'gold').amounts.length, 'gold off-type: one hit').toBe(1);
    expect(hits(ON_TYPE, 'gold').amounts).toEqual(hits(OFF_TYPE, 'gold').amounts);
  });

  it('at DIAMOND it exists, and THEN the board decides', () => {
    const on = hits(ON_TYPE, 'diamond');
    const off = hits(OFF_TYPE, 'diamond');
    expect(on.amounts.length, 'diamond on-type: two hits').toBe(2);
    expect(off.amounts.length, 'diamond off-type: one hit').toBe(1);
    // The gated hit is the big one, and it is a separate damage instance.
    expect(Math.max(...on.amounts)).toBeGreaterThan(Math.max(...off.amounts));
  });
});

// ---------------------------------------------------------------------------
// SUITE 5 — the CARD-level minimum tier.
// ---------------------------------------------------------------------------

describe('A CARD-LEVEL MINIMUM: a card with no Bronze form is a card authored above Bronze', () => {
  /**
   * There is deliberately NO second field for this (user ruling 2026-08-26: "some
   * skill cards may have min tier level due to their effects so we should have
   * cards that dont have bronze tier etc"). `SkillDef.tier` already means "the
   * tier this kit is priced against", and `applyTier` only ever ranks UP — so a
   * Gold-minimum card is simply `tier: 'gold'`, and a separate `minTier` on the
   * card could only agree with it or be wrong.
   */
  const GOLD_MIN: SkillDef = {
    id: 'gold_min_probe', name: 'Gold Minimum Probe', archetypes: ['offense'],
    property: 'physical', weapon: 'axe', size: 1, rarity: 'epic', tier: 'gold',
    // On the GOLD budget (200 deci) exactly: damage 20 (100) + stun 1 (100).
    effects: [{ kind: 'damage', power: 20 }, { kind: 'stun', turns: 1 }],
    text: 'Deal 20 (+ATK) Axe damage · {{Stun}} 1 turn.',
  };

  it('it is on budget where it exists, and the sweep actually covers both cases', () => {
    const reachable = RANKS.filter((t) => cardExistsAtTier(GOLD_MIN, t));
    const unreachable = RANKS.filter((t) => !cardExistsAtTier(GOLD_MIN, t));
    expect(reachable, 'reachable tiers').toEqual(['gold', 'diamond']);
    expect(unreachable, 'and there must BE unreachable ones, or this proves nothing').toEqual(['bronze', 'silver']);
    for (const tier of reachable) {
      expect(powerLevelDeci(applyTier(GOLD_MIN, tier)), `${tier} budget`).toBe(TIER_BUDGET_DECI[tier]);
      expect(capViolations(applyTier(GOLD_MIN, tier)), `${tier} caps`).toEqual([]);
    }
  });

  it('asked for a tier it has no copy at, it CLAMPS UP — it is never stamped with the cheaper tier', () => {
    // The danger the ruling names: a below-minimum request must not quietly
    // produce an under-priced card. `applyTier` returns the card at its REAL tier,
    // so every budget assertion still measures it against Gold. It does not throw:
    // the wiki's tier picker calls this directly, and a run-layer filtering
    // mistake must not be a dead scene. `cardExistsAtTier` is the filter.
    for (const tier of ['bronze', 'silver'] as SkillTier[]) {
      const asked = applyTier(GOLD_MIN, tier);
      expect(asked.tier, `${tier}: tier must not be re-stamped`).toBe('gold');
      expect(powerLevelDeci(asked), `${tier}: still priced at Gold`).toBe(TIER_BUDGET_DECI.gold);
      expect(powerLevelDeci(asked), `${tier}: and never at the cheaper budget`).not.toBe(TIER_BUDGET_DECI[tier]);
    }
  });

  it('every SHIPPED card still starts at Bronze, so nothing in the book moved', () => {
    const above = Object.values(skillBook).filter((c) => c.tier !== 'bronze').map((c) => `${c.id}@${c.tier}`);
    expect(above, 'the book is all-Bronze today; a non-Bronze card needs the run-layer filter first').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SUITE 6 — the authoring rules.
// ---------------------------------------------------------------------------

describe('a nonsense lock is REFUSED at authoring time', () => {
  const CARD_BASE = {
    name: 'Probe', archetypes: ['offense'], property: 'physical', weapon: 'sword',
    size: 1, rarity: 'common', tier: 'bronze', text: 'Deal 20 (+ATK) Sword damage.',
  };
  const problemsFor = (def: Record<string, unknown>): string => validateSkillDocument({
    schemaVersion: 1,
    cards: [{ id: 'probe', versions: [{ version: 1, def }] }],
  }).map((p) => p.message).join('\n');

  it('a VALID lock passes clean — otherwise every rejection below is meaningless', () => {
    expect(problemsFor({
      ...CARD_BASE,
      effects: [{ kind: 'damage', power: 20 }, { kind: 'stun', turns: 1, minTier: 'gold' }],
    })).toBe('');
  });

  it('a value that is not a tier', () => {
    // The dangerous shape: `tierResolved` compares by index, and an unknown string
    // indexes to -1, i.e. a lock that is silently ALWAYS OPEN.
    expect(problemsFor({
      ...CARD_BASE, effects: [{ kind: 'damage', power: 20, minTier: 'platinum' }],
    })).toContain('minTier must be one of');
    expect(problemsFor({
      ...CARD_BASE, effects: [{ kind: 'damage', power: 20, minTier: 2 }],
    })).toContain('minTier must be one of');
  });

  it('a lock at or below the card\'s own tier — it could never close', () => {
    expect(problemsFor({
      ...CARD_BASE, effects: [{ kind: 'damage', power: 20, minTier: 'bronze' }],
    })).toContain('is at or below the card\'s own tier');
  });

  it('a lock inside a tierUpgrades effects list — that block already applies at one tier', () => {
    expect(problemsFor({
      ...CARD_BASE,
      effects: [{ kind: 'damage', power: 20 }],
      tierUpgrades: {
        gold: { effects: [{ kind: 'damage', power: 40, minTier: 'diamond' }], text: 'Deal 40 (+ATK) Sword damage.' },
      },
    })).toContain('minTier cannot be used inside a tierUpgrades effects list');
  });

  it('a lock on a GEM action — a gem is never tier-scaled, so it would be ignored', () => {
    const problems = validateGemDocument({
      schemaVersion: 1,
      gems: [{
        id: 'probe_gem',
        versions: [{
          version: 1,
          def: {
            name: 'Probe Gem', kind: 'effect', rarity: 'common',
            actions: [{ kind: 'poison', stacks: 4, minTier: 'gold' }],
            text: 'Apply 4 poison.',
          },
        }],
      }],
    }).map((p) => p.message).join('\n');
    expect(problems).toContain('minTier cannot be used on a gem action');
  });

  it('a card whose EVERY line is locked above its own tier — it is priced for a kit it does not have', () => {
    // The card-level rule. This is not "a Gold-minimum card": it is a card sold at
    // Bronze, priced against the Bronze budget, that does nothing when cast. The
    // message names the fix (raise the card's own tier).
    expect(problemsFor({
      ...CARD_BASE,
      effects: [{ kind: 'damage', power: 40, minTier: 'gold' }, { kind: 'stun', turns: 1, minTier: 'diamond' }],
    })).toContain('every effect is locked above bronze');
  });

  it('a tierUpgrades block at or below the card\'s own tier is unreachable', () => {
    expect(problemsFor({
      ...CARD_BASE, tier: 'gold',
      effects: [{ kind: 'damage', power: 30 }, { kind: 'stun', turns: 1 }],
      tierUpgrades: { silver: { effects: [{ kind: 'damage', power: 20 }], text: 'Deal 20 (+ATK) Sword damage.' } },
    })).toContain('is at or below this card\'s own tier');
  });

  it('a lock that breaks a WHOLE-CARD rule at a lower tier is caught at that tier', () => {
    // A lock makes the effects list tier-dependent, so the list-level rules have to
    // be re-asked per rank. Here the spreader's only payload is locked to Gold, so
    // the Bronze and Silver copies are a `splash` with nothing to spread — a
    // keyword printed on a face that cannot do anything. The authored list alone
    // looks fine, which is exactly why the per-tier sweep exists.
    const reported = validateSkillDocument({
      schemaVersion: 1,
      cards: [{
        id: 'probe',
        versions: [{
          version: 1,
          def: {
            ...CARD_BASE,
            effects: [{ kind: 'burden', weight: 8, minTier: 'gold' }, { kind: 'splash' }],
            text: 'Burden 8, spread across the band.',
          },
        }],
      }],
    });
    const spread = reported.filter((p) => p.message.includes('needs something to spread'));
    expect(spread.length, 'the bronze and silver copies are both spreaders with nothing to spread').toBe(2);
    expect(spread.map((p) => p.where).join(' ')).toContain('at bronze');
    expect(spread.map((p) => p.where).join(' ')).toContain('at silver');
  });
});

// ---------------------------------------------------------------------------
// SUITE 7 — un-featured content is untouched.
// ---------------------------------------------------------------------------

describe('nothing changes for a card with no lock', () => {
  /** Every card that authors at least one `minTier`, and every card that authors none. */
  const LOCKED_IDS = Object.values(skillBook)
    .filter((c) => [...c.effects, ...Object.values(c.tierUpgrades ?? {}).flatMap((u) => u?.effects ?? [])]
      .some((a) => a.minTier !== undefined))
    .map((c) => c.id)
    .sort();

  it('the feature HAS content users — and every one of them is a card, not a tierUpgrades block', () => {
    // Was "no shipped card carries one yet" until the Q1 migration landed
    // (2026-08-26). The set is now the migration's own manifest: 24 cards whose
    // higher rungs used to be hand-solved `tierUpgrades.effects` restatements.
    // 24 migrated (`tests/engine/tierLockMigration.test.ts` owns the before/after)
    // plus `rimebarb_vigil`, the first card AUTHORED with a lock: four `thorns`
    // lines on one definition, three of them locked, merging into one pile so the
    // reflect grows 5 -> 8 -> 11 -> 14 with rank. That is the shape `TierLocked`
    // was built for and no `tierUpgrades` restatement could have priced honestly.
    expect(LOCKED_IDS.length, 'the lock manifest must not silently shrink').toBe(25);
    for (const id of LOCKED_IDS) {
      const card = skillBook[id]!;
      // `validateSkillContent` refuses a lock inside a `tierUpgrades` effects list
      // (that block applies at exactly one tier, so a lock in it is dead either
      // way) — pinned here as content, not only as a validator rule.
      for (const up of Object.values(card.tierUpgrades ?? {})) {
        expect((up.effects ?? []).some((a) => a.minTier !== undefined), `${id}: lock inside a tierUpgrades block`).toBe(false);
      }
      // Every locked line is a real lock: strictly above the card's own tier, so
      // it genuinely closes on the copy the card is priced as.
      for (const a of card.effects) {
        if (a.minTier === undefined) continue;
        expect(TIER_ORDER.indexOf(a.minTier), `${id}: lock at or below the card own tier`)
          .toBeGreaterThan(TIER_ORDER.indexOf(card.tier));
      }
    }
  });

  it('EVERY tier at or above a lock carries an authored `text` — the face can never describe a line it lacks', () => {
    // The one thing the migration cannot delegate to the solver. `retextScaledNumbers`
    // rewrites CHANGED numbers in the existing prose; it cannot invent the clause for
    // a line the Bronze face never mentioned. So a `tierUpgrades.<tier>.text` override
    // is mandatory from the lock tier upward, and `tests/engine/cardText.test.ts`
    // audits each one against the RESOLVED rank.
    const missing: string[] = [];
    for (const id of LOCKED_IDS) {
      const card = skillBook[id]!;
      const locks = card.effects.filter((a) => a.minTier !== undefined).map((a) => TIER_ORDER.indexOf(a.minTier!));
      const lowest = Math.min(...locks);
      for (let i = lowest; i < TIER_ORDER.length; i += 1) {
        const tier = TIER_ORDER[i]! as Exclude<SkillTier, 'bronze'>;
        if (card.tierUpgrades?.[tier]?.text === undefined) missing.push(`${id}@${tier}`);
      }
    }
    expect(missing, `a locked line unlocks into prose that never mentions it:\n${missing.join('\n')}`).toEqual([]);
  });

  it('`tierResolved` and `applyTier` hand back the SAME REFERENCE for every UNLOCKED card', () => {
    // Reference identity, not deep equality: it is what makes "un-featured input
    // resolves byte-identically" true by construction rather than by inspection,
    // and it is why the frozen 400-fight outcome baseline did not move.
    //
    // SCOPED TO UNLOCKED CARDS since the Q1 migration (2026-08-26). A card that
    // really does have a line to STRIP cannot come back by reference — that is the
    // feature working, not a regression — so the 24 locked cards are held to the
    // VALUE claim in the next test instead.
    let checked = 0;
    for (const card of Object.values(skillBook)) {
      if (LOCKED_IDS.includes(card.id)) continue;
      expect(tierResolved(card), card.id).toBe(card);
      for (const tier of RANKS) {
        if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(card.tier)) continue;
        expect(applyTier(card, tier), `${card.id}@${tier}`).toBe(card);
        checked += 1;
      }
    }
    expect(checked, 'the sweep must actually cover cards').toBeGreaterThan(100);
  });

  it('...and a LOCKED card resolves to exactly its unlocked lines, in authored order', () => {
    for (const id of LOCKED_IDS) {
      const card = skillBook[id]!;
      const resolved = tierResolved(card);
      expect(resolved, `${id}: a card with a live lock must allocate`).not.toBe(card);
      expect(resolved.effects, id).toEqual(card.effects.filter((a) => a.minTier === undefined));
      // Nothing but `effects` moves: `tierResolved` answers only "which actions exist".
      expect({ ...resolved, effects: [] }, `${id}: tierResolved rewrote something else`)
        .toEqual({ ...card, effects: [] });
    }
  });
});
