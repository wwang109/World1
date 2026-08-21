// WHERE a gem's actions splice into its host card (GEM_ACTION_PHASE in
// src/engine/cards.ts). The rule is a property of the action KIND: the two
// kinds that must be in place before the host's damage resolves
// (`comboBonus`, `shieldBreak`) go AHEAD of the card; everything else — above
// all `lifesteal`, which reads `cast.damageDealt` — trails it.
//
// These tests are the regression lock for the 2026-08-17 defect: gem actions
// were appended unconditionally, which made `follow_through_echo` a total
// no-op and let `shield_splitter_echo`'s shred land after its own host's hit
// was already absorbed.
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { resolveEffectiveSkill, splashSuppressionOn } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import type { Action, Gem, SkillDef } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

const comboGem = gemBook['follow_through_echo'] as Gem;
const shredGem = gemBook['shield_splitter_echo'] as Gem;
const leechGem = gemBook['leeching_fang_echo'] as Gem;
const poisonGem: Gem = { kind: 'effect', id: 'g_venom', rarity: 'common', actions: [{ kind: 'poison', stacks: 3 }] };

const kindsOf = (effects: readonly Action[]) => effects.map((a) => a.kind);
const effectsOf = (skillId: string, gem: Gem): readonly Action[] =>
  resolveEffectiveSkill(skillBook[skillId] as SkillDef, { skillId, slot: 0, gem }).effects;

describe('gem splice order: `pre` kinds land ahead of the host card', () => {
  it('a comboBonus gem resolves BEFORE the host damage action (it arms cast.bonusFlat, which only damage reads)', () => {
    expect(kindsOf(effectsOf('sword_slash', comboGem))).toEqual(['comboBonus', 'damage']);
    expect(effectsOf('sword_slash', comboGem)[0]).toMatchObject({ kind: 'comboBonus', amount: 16, fromGem: true });
  });

  it('a shieldBreak gem resolves BEFORE the host damage action (it opens plating for the hit that follows)', () => {
    expect(kindsOf(effectsOf('sword_slash', shredGem))).toEqual(['shieldBreak', 'damage']);
    expect(effectsOf('sword_slash', shredGem)[0]).toMatchObject({ kind: 'shieldBreak', amount: 16, fromGem: true });
  });

  it('a lifesteal gem still resolves AFTER the host damage (it reads cast.damageDealt)', () => {
    expect(kindsOf(effectsOf('sword_slash', leechGem))).toEqual(['damage', 'lifesteal']);
  });

  it('every other rider still appends after the base effects (poison, unchanged behavior)', () => {
    expect(kindsOf(effectsOf('sword_slash', poisonGem))).toEqual(['damage', 'poison']);
  });
});

describe("gem splice order: a card's OWN authored effect order is never rewritten", () => {
  it('an authored shieldBreak stays exactly where the author put it; a post gem still trails the whole card', () => {
    // shield_splitter authors [shieldBreak 24, damage 42] — the resolver must
    // not hoist, drop or reorder either one.
    const base = skillBook['shield_splitter']!.effects;
    const resolved = effectsOf('shield_splitter', poisonGem);
    expect(resolved.slice(0, base.length)).toEqual(base);
    expect(kindsOf(resolved)).toEqual(['shieldBreak', 'damage', 'poison']);
  });

  it('a pre gem splices ahead of the WHOLE authored block, leaving it contiguous and in order', () => {
    // follow_through authors [comboBonus 20, damage 10]; the gem's shred goes
    // in front of both, and the authored pair stays adjacent and untouched.
    const base = skillBook['follow_through']!.effects;
    const resolved = effectsOf('follow_through', shredGem);
    expect(kindsOf(resolved)).toEqual(['shieldBreak', 'comboBonus', 'damage']);
    expect(resolved.slice(1)).toEqual(base);
    expect(resolved[1]).not.toHaveProperty('fromGem');
  });

  it("the shared gem content object in src/data is never mutated by the splice", () => {
    effectsOf('sword_slash', comboGem);
    expect((comboGem as { actions: Action[] }).actions[0]).not.toHaveProperty('fromGem');
  });

  it('EVERY effect gem in the catalog keeps its host authored effects contiguous and unmodified', () => {
    const hosts = ['sword_slash', 'shield_splitter', 'follow_through', 'verdant_touch'];
    for (const [id, gem] of Object.entries(gemBook)) {
      if (gem.kind !== 'effect' || gem.actions.length === 0) continue;
      for (const hostId of hosts) {
        const host = skillBook[hostId]!;
        const base = host.effects;
        const resolved = effectsOf(hostId, gem as Gem);
        const start = resolved.findIndex((a) => !a.fromGem);
        expect(resolved.slice(start, start + base.length), `${id} on ${hostId}`).toEqual(base);
        // No gem action may sit INSIDE the authored block.
        expect(
          resolved.slice(start, start + base.length).some((a) => a.fromGem),
          `${id} on ${hostId}`,
        ).toBe(false);
        // THE SPLASH GATE is the one legal drop: a gem `splash` never splices
        // onto a host that suppresses it (all four hosts here carry no
        // card-targeting payload, so a BARE spreader — ripple_sliver's shape —
        // is dropped as `nothingToSpread`). Every other action must splice.
        const spliced = splashSuppressionOn(host, gem.actions) !== null
          ? gem.actions.filter((a) => a.kind !== 'splash').length
          : gem.actions.length;
        expect(resolved.length, `${id} on ${hostId}`).toBe(base.length + spliced);
      }
    }
  });
});

describe('gem splice order: end-to-end, the effect can actually be read', () => {
  it('a comboBonus gem ADDS its bonus to the host card damage on a comboed cast', () => {
    // sword_slash is Offense, so its second cast combos off its own first.
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }, {
        pieces: [{ skillId: 'sword_slash', slot: 0, gem: comboGem }],
      }),
      tc('wall', [], { maxHp: 4000, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const hits = simulate(c, 1).events.filter((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // First cast: no previous cast to combo off.
    expect(hits[0]).toMatchObject({ amount: 30 });
    expect((hits[0] as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage).toBe(0);
    // Second cast: the combo triggers and the +16 reaches the damage arm.
    expect(hits[1]).toMatchObject({ amount: 46 });
    expect((hits[1] as { calculation?: { effectBonusDamage: number } }).calculation?.effectBonusDamage).toBe(16);
  });

  it('an un-gemmed host never gains the bonus (control for the test above)', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }, { pieces: [{ skillId: 'sword_slash', slot: 0 }] }),
      tc('wall', [], { maxHp: 4000, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const hits = simulate(c, 1).events.filter((e) => e.kind === 'damage' && e.side === 'enemy');
    for (const hit of hits) expect(hit).toMatchObject({ amount: 30 });
  });

  it("a shieldBreak gem opens the shield BEFORE the host's own hit lands", () => {
    // The wall raises a 20-point physical shield (bastion_stance, armor 0);
    // the hero's gemmed sword_slash is a 21-point physical hit. Unfixed, the
    // hit was fully absorbed (shieldBlocked 21 / hpDamage 0) and the shred
    // landed on the leftovers afterwards.
    const c = cfg(
      tc('hero', [], { attack: 1, speed: 8, maxHp: 500 }, {
        pieces: [{ skillId: 'sword_slash', slot: 0, gem: shredGem }],
      }),
      tc('wall', [], { maxHp: 4000, speed: 40, armor: 0 }, { pieces: [{ skillId: 'bastion_stance', slot: 0 }] }),
      { ...NO_ENDGAME, maxTurns: 2 },
    );
    const events = simulate(c, 1).events;
    const shredAt = events.findIndex((e) => e.kind === 'shieldBroken');
    const hitAt = events.findIndex((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(shredAt).toBeGreaterThanOrEqual(0);
    expect(hitAt).toBeGreaterThanOrEqual(0);
    expect(shredAt).toBeLessThan(hitAt);
    // ...and the shred is what the hit then eats through: 40 shield - 16 = 24
    // standing, so the 21 hit is still absorbed but 16 fewer plating points
    // remain than the unfixed order left.
    const shred = events[shredAt] as { amount: number; totalAfter: number };
    expect(shred.amount).toBe(16);
    const hit = events[hitAt] as { calculation?: { shieldBlocked: number; hpDamage: number } };
    expect(hit.calculation!.shieldBlocked + hit.calculation!.hpDamage).toBe(21);
  });

  it("a shieldBreak gem lets the host's hit reach HP when the shred empties the pool", () => {
    // A single 16-point shield (aegis-less setup): the shred removes all of
    // it, so the whole 21-point hit lands on HP. Unfixed, the shield ate 16 of
    // the 21 first and only 5 reached HP.
    const shred16: Gem = { kind: 'effect', id: 'g_shred', rarity: 'common', actions: [{ kind: 'shieldBreak', amount: 16 }] };
    const run = (gem: Gem) => {
      const c = cfg(
        tc('hero', [], { attack: 1, speed: 8, maxHp: 500 }, {
          pieces: [{ skillId: 'sword_slash', slot: 0, gem }],
        }),
        tc('wall', [], { maxHp: 4000, speed: 40, armor: 0 }, { pieces: [{ skillId: 'bastion_stance', slot: 0 }] }),
        { ...NO_ENDGAME, maxTurns: 2 },
      );
      const hit = simulate(c, 1).events.find((e) => e.kind === 'damage' && e.side === 'enemy') as
        { calculation: { shieldBlocked: number; hpDamage: number } };
      return hit.calculation;
    };
    // With the shred ahead of the hit, 16 of the 40 standing plating is gone
    // before the hit is measured.
    expect(run(shred16).shieldBlocked).toBe(21);
    // A bigger shred empties the pool outright and the hit reaches HP.
    const shred64: Gem = { kind: 'effect', id: 'g_shred_big', rarity: 'common', actions: [{ kind: 'shieldBreak', amount: 64 }] };
    expect(run(shred64)).toMatchObject({ shieldBlocked: 0, hpDamage: 21 });
  });

  it('a lifesteal gem still heals off the damage the host just dealt (post phase, unchanged)', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20, maxHp: 500, hp: 100 }, {
        pieces: [{ skillId: 'sword_slash', slot: 0, gem: leechGem }],
      }),
      tc('wall', [], { maxHp: 4000, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const events = simulate(c, 1).events;
    const heal = events.find((e) => e.kind === 'heal' && e.side === 'player') as { amount: number } | undefined;
    // 30 damage x 30% = 9 HP stolen — only reachable because the rider trails the hit.
    expect(heal).toMatchObject({ amount: 9 });
  });
});
