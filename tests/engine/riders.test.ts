import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { powerLevelDeci } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import { resolveEffectiveSkill } from '../../src/engine/cards';
import { cfg, tc, NO_ENDGAME } from '../helpers';

type Events = ReturnType<typeof simulate>['events'];

describe('special ability riders', () => {
  it('slow makes the enemy next action heavier, once', () => {
    // Hamstring (+16 weight to enemy's next action). Enemy bite is w10.
    const c = cfg(
      tc('hero', ['hamstring'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['sword_slash'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);
    const enemyPlays = events.filter(
      (event): event is Extract<Events[number], { kind: 'play' }> => event.kind === 'play' && event.side === 'enemy',
    );
    const slowed = enemyPlays.find((event) => event.weight === 26);
    expect(slowed).toBeDefined();
    expect(finalState.enemy.nextWeightPenalty).toBe(0);
  });

  it('disrupt drains the enemy banked readiness', () => {
    // Enemy runs a heavy meteor-ish card, banking readiness; hero disrupts it away.
    const c = cfg(
      tc('hero', ['concussive_shot'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('foe', ['crushing_blow'], { attack: 1, speed: 10, maxHp: 500 }),
      { ...NO_ENDGAME, maxTurns: 6 },
    );
    const { events } = simulate(c, 1);
    const disrupt = events.find((e) => e.kind === 'disrupted');
    expect(disrupt).toBeDefined();
    expect((disrupt as { amount: number }).amount).toBeGreaterThan(0);
  });

  it('lifesteal heals for a percentage of the damage dealt', () => {
    // Leeching Fang: 16 flat + 10 Attack = 26 dealt, 45% lifesteal -> floor(26*0.45)=11.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 20, maxHp: 100, hp: 50 }),
      tc('wall', [], { maxHp: 500, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'heal')).toMatchObject({ side: 'player', amount: 11, hpAfter: 61 });
  });

  it('a lifesteal heal carries NO calculation block — it has no card base to split', () => {
    // Deliberate asymmetry with the `heal` action (documented on the event in
    // src/engine/combat/events.ts): a lifesteal request is a percentage of
    // damage dealt, with no card base, no stat term and no aura term, so
    // reporting `power = stolen` would claim a card base that does not exist.
    // Same contract as damage.calculation, which DoT/fatigue damage omits.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 20, maxHp: 100, hp: 50 }),
      tc('wall', [], { maxHp: 500, speed: 10 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const heal = simulate(c, 1).events.find(
      (e): e is Extract<Events[number], { kind: 'heal' }> => e.kind === 'heal',
    )!;
    expect(heal.amount).toBe(11);
    expect('calculation' in heal).toBe(false);
  });

  it('lifesteal only counts damage that reached HP', () => {
    // Enemy shields first; the blocked portion must not heal the attacker.
    const c = cfg(
      tc('hero', ['leeching_fang'], { attack: 10, speed: 10, maxHp: 100, hp: 50 }),
      tc('turtle', ['iron_bulwark'], { attack: 20, speed: 30, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Bulwark shields 52 physical; the 16-damage fang is fully blocked -> no heal.
    expect(events.find((e) => e.kind === 'heal' && e.side === 'player')).toBeUndefined();
  });

  it('shieldBreak strips shields before the hit lands', () => {
    // The turtle's 10 now sits in ARMOR, not Attack: shields are defensive output
    // (2026-08-04), so Armor is what sizes Bulwark's pool. Armor also MITIGATES, so
    // the hero carries Attack 20 rather than 10 to land the same 52 on arrival.
    const c = cfg(
      tc('hero', ['shield_splitter'], { attack: 20, speed: 10, maxHp: 500 }),
      tc('turtle', ['iron_bulwark'], { attack: 0, armor: 10, speed: 30, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    // Bulwark: 48 flat + 10 Armor = 58 physical shield. Splitter shatters 24 of it
    // (shieldBreak magnitude unchanged), leaving 34 shield; then hits 42 flat + 20
    // Attack = 62, −10 Armor = 52: 34 of it is blocked by the shield, 18 lands.
    const broken = events.find((e) => e.kind === 'shieldBroken');
    expect(broken).toMatchObject({ amount: 24, totalAfter: 34 });
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 52, blocked: 34 });
  });

  it('comboBonus triggers only when the previous cast shared an archetype', () => {
    // Board: [sword_slash][follow_through] — both Offense.
    // Turn 1 slash (no combo: nothing cast before), turn 2 follow_through with the flat +20 combo.
    const c = cfg(
      tc('hero', ['sword_slash', 'follow_through'], { attack: 10, speed: 20, maxHp: 500 }),
      tc('wall', [], { maxHp: 500, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const { events } = simulate(c, 1);
    const hits = events.filter((e) => e.kind === 'damage').map((e) => (e as { amount: number }).amount);
    expect(hits[0]).toBe(30); // sword_slash: 20 flat + 10 Attack
    expect(hits[1]).toBe(40); // follow_through: 10 flat + 10 Attack + 20 combo = 40
  });

  it('rider magnitudes are priced per unit (decimal-precise deci-PL)', () => {
    const base = skillBook['hamstring']!;
    const lighter = { ...base, effects: [base.effects[0]!, { kind: 'slow' as const, weight: 8 }] };
    // 16 -> 40 deci; 8 -> 20 deci: exactly proportional.
    expect(powerLevelDeci(base) - powerLevelDeci(lighter)).toBe(20);
  });
});

/**
 * THE CAST-SINK ORDERING RULE — `lifesteal` must trail EVERY hit of its cast.
 *
 * `lifesteal` is the only action that reads a value the cast accumulates
 * (`cast.damageDealt`). `GEM_ACTION_PHASE` (src/engine/cards.ts) already states
 * the rule on its own row — "Reads `cast.damageDealt` — must trail every hit of
 * the cast" — but it was enforced for GEM actions only, so a kit that authored a
 * hit AFTER its own lifesteal line leeched off a partial total.
 *
 * THE DEFECT (2026-08-26). `leeching_fang` at Diamond authors
 * `[damage 30, lifesteal 45, damage 32 (affinity)]`, and its own notes commit to
 * the composition ("the affinity hit is part of that cast"). It was not — on a
 * Beast board the log read `hit 31 / heals 13 / hit 32`, i.e. 45% of 31 rather
 * than of 63, while the face printed the unqualified "heal 45% of damage dealt".
 * `orderCastSinks` in the resolver now folds the leech behind the last hit before
 * the loop ever runs.
 *
 * DAMAGE DEALT IS READ OUT OF THE EVENT LOG (`calculation.hpDamage`, the same
 * number `scripts/logFormat.ts` prints), never recomputed from the card — a test
 * that re-derives the expected damage cannot catch a cast whose leech saw the
 * wrong subtotal.
 */
describe('lifesteal trails every hit of the cast', () => {
  /** 3 Beast -> the board takes the Beast identity, so the gated hit resolves. */
  const ON_TYPE = ['leeching_fang', 'savage_bite', 'venom_fang'];
  /** 1 Beast, 2 Sword -> no identity, so the gate stays shut. */
  const OFF_TYPE = ['leeching_fang', 'sword_slash', 'twin_slash'];
  const FANG = 'leeching_fang';
  const LIFESTEAL_PCT = 45;

  /** The FANG's own hits and heal, in log order, for its first cast. */
  function firstFangCast(board: readonly string[], tier: 'bronze' | 'diamond'): { hpDamage: number[]; heals: number[] } {
    let slot = 0;
    const pieces = board.map((skillId) => {
      const piece = { skillId, slot, tier };
      slot += skillBook[skillId]!.size;
      return piece;
    });
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 30, maxHp: 400, hp: 100 }, { pieces, boardSize: 10 }),
      tc('wall', [], { maxHp: 40000, attack: 1, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const hpDamage: number[] = [];
    const heals: number[] = [];
    let seen = false;
    for (const e of simulate(c, 5).events) {
      // One cast only: stop at the next card the hero plays.
      if (e.kind === 'play' && e.side === 'player') {
        if (seen) break;
        if (e.skillId === FANG) seen = true;
        continue;
      }
      if (!seen) continue;
      const src = (e as { sourceCard?: { skillId: string } }).sourceCard;
      if (src?.skillId !== FANG) continue;
      if (e.kind === 'damage' && e.calculation) hpDamage.push(e.calculation.hpDamage);
      if (e.kind === 'heal') heals.push(e.amount);
    }
    return { hpDamage, heals };
  }

  for (const tier of ['bronze', 'diamond'] as const) {
    it(`${tier}: the leech is 45% of the WHOLE cast's damage dealt, on-type`, () => {
      const { hpDamage, heals } = firstFangCast(ON_TYPE, tier);
      // NON-VACUITY: a cast that never happened would pass every assertion below.
      expect(hpDamage.length, 'the fang must have hit at least once').toBeGreaterThan(0);
      expect(heals.length, 'the fang must have leeched exactly once').toBe(1);
      const dealt = hpDamage.reduce((a, b) => a + b, 0);
      expect(heals[0]).toBe(Math.floor((dealt * LIFESTEAL_PCT) / 100));
    });
  }

  it('diamond on-type: the gated hit is REAL and the leech counts it', () => {
    // The pair that gives the assertion above its teeth: two hits on-type, one
    // off-type. NOTE the base hit is SMALLER on-type (35 vs 40) — the multi-hit
    // stat split halves the Attack share across the two hits — which is exactly
    // why the leech must read the cast SUBTOTAL and not its own first hit: before
    // `orderCastSinks` the gate BOUGHT LESS HEALING than shutting the gate did.
    const on = firstFangCast(ON_TYPE, 'diamond');
    const off = firstFangCast(OFF_TYPE, 'diamond');
    expect(on.hpDamage.length, 'on-type: base hit + gated hit').toBe(2);
    expect(off.hpDamage.length, 'off-type: the gate is shut').toBe(1);
    expect(on.hpDamage[0], 'on-type base hit takes only its share of the stat').toBeLessThan(off.hpDamage[0]!);
    // THE REGRESSION, stated as the two numbers it confused: 45% of the first hit
    // (the old answer) vs 45% of the whole cast (the card's face and its notes).
    const dealt = on.hpDamage.reduce((a, b) => a + b, 0);
    expect(on.heals[0], 'the leech reads the whole cast').toBe(Math.floor((dealt * LIFESTEAL_PCT) / 100));
    expect(on.heals[0]).not.toBe(Math.floor((on.hpDamage[0]! * LIFESTEAL_PCT) / 100));
    expect(on.heals[0], 'opening the gate must BUY healing, not lose it').toBeGreaterThan(off.heals[0]!);
    expect(off.heals[0]).toBe(Math.floor((off.hpDamage[0]! * LIFESTEAL_PCT) / 100));
  });

  it('the leech is the LAST thing the cast does — after every hit, in the log', () => {
    // Ordering stated as ordering, not inferred from an amount: a future change
    // that got the number right by some other route would still have to keep the
    // heal behind the hits.
    let slot = 0;
    const pieces = ON_TYPE.map((skillId) => {
      const piece = { skillId, slot, tier: 'diamond' as const };
      slot += skillBook[skillId]!.size;
      return piece;
    });
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 30, maxHp: 400, hp: 100 }, { pieces, boardSize: 10 }),
      tc('wall', [], { maxHp: 40000, attack: 1, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const shape: string[] = [];
    let seen = false;
    for (const e of simulate(c, 5).events) {
      if (e.kind === 'play' && e.side === 'player') {
        if (seen) break;
        if (e.skillId === FANG) seen = true;
        continue;
      }
      if (!seen) continue;
      if ((e as { sourceCard?: { skillId: string } }).sourceCard?.skillId !== FANG) continue;
      if (e.kind === 'damage' || e.kind === 'heal') shape.push(e.kind);
    }
    expect(shape).toEqual(['damage', 'damage', 'heal']);
  });

  it('a kit whose leech already trails its hits is untouched (same reference back)', () => {
    // The other two lifesteal cards in the book, and the fang at Bronze: the
    // normalizer must be a no-op on them, reference included, or every un-featured
    // resolve stops being byte-identical (the determinism + outcome baselines).
    for (const id of ['leeching_fang', 'siphon_life', 'verdant_rebuke']) {
      const def = skillBook[id]!;
      expect(resolveEffectiveSkill(def, { skillId: id, slot: 0 }), id).toBe(def);
    }
  });

  it('leeching_fang is the ONLY kit that needed reordering — and it moved', () => {
    // The sweep that makes this a general fix rather than a one-card patch: no
    // shipped kit, at any tier, may resolve with a `lifesteal` ahead of a hit.
    for (const id of Object.keys(skillBook)) {
      for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as const) {
        const effects = resolveEffectiveSkill(skillBook[id]!, { skillId: id, slot: 0, tier }).effects;
        let lastHit = -1;
        effects.forEach((a, i) => { if (a.kind === 'damage') lastHit = i; });
        effects.forEach((a, i) => {
          expect(a.kind === 'lifesteal' && i < lastHit, `${id}@${tier}: leech at ${i} ahead of the hit at ${lastHit}`).toBe(false);
        });
      }
    }
    // ...and the fang's Diamond kit is the one that actually gets reordered, so
    // the sweep above is not vacuously true of an unchanged book.
    const authored = skillBook['leeching_fang']!.tierUpgrades!.diamond!.effects!.map((a) => a.kind);
    expect(authored).toEqual(['damage', 'lifesteal', 'damage']);
    const resolved = resolveEffectiveSkill(skillBook['leeching_fang']!, { skillId: 'leeching_fang', slot: 0, tier: 'diamond' }).effects.map((a) => a.kind);
    expect(resolved).toEqual(['damage', 'damage', 'lifesteal']);
  });
});
