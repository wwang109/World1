import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import type { CombatConfig, CombatantSetup, SkillBook, SkillDef } from '../../src/engine/types';
import type { CombatEvent } from '../../src/engine/combat/events';
import type { CombatantState } from '../../src/engine/combat/state';

/**
 * A HEAL IS NEVER A DAMAGE SOURCE.
 *
 * REGRESSION: the `heal` arm applied `hp = min(maxHp, hp + amount)` with NO
 * lower floor, no death check, and an event gated on `amount > 0`. A request
 * that resolved NEGATIVE therefore drove HP below zero with `alive` still true
 * and emitted NOTHING — invisible in the event log the UI replays, and a
 * violation of the `alive <=> hp > 0` invariant that `stepEntryOf` (simulate.ts)
 * and `pickSupportTarget` (interpreter.ts) both assume.
 *
 * It needed no negative `power` to reach: the request is
 * `power + statBonus + healFlat`, `healFlat` is an aura modifier that may be
 * negative, and `applyAntiHeal` passes any request <= 0 straight through. The
 * measured case was a heal-5 card beside a `healFlat: -60` aura: hp = -100/100,
 * alive = true, four turns of combat at negative HP, no `died`, no `heal`.
 *
 * FIX: `restoreHp` — the single HP-restoration seam (the mirror of `dealDamage`
 * on the way down), used by BOTH the `heal` arm and `lifesteal`, which CLAMPS a
 * negative request to zero. Clamping rather than dealing the difference as
 * damage: a heal that hurts would be a brand-new mechanic (a damage source with
 * no property, no mitigation, no matchup, no shield/negate/thorns/expose
 * interaction and no price), whereas "reduced past nothing heals nothing" is the
 * conservative reading of the existing, priced anti-heal concept.
 */

/** `healFlat` aura of the given magnitude, projected onto the neighbouring card. */
function auraCard(id: string, healFlat: number): SkillDef {
  return {
    id, name: id, archetypes: ['support'], property: 'true', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', cooldownTurns: 99,
    // A genuine no-op body (taunt 0 returns before any event) so the ONLY thing
    // this card contributes is its aura.
    effects: [{ kind: 'taunt', amount: 0 }],
    aura: { affects: 'adjacent', mods: { healFlat } },
    text: '',
  };
}

const book: SkillBook = {
  curse: auraCard('curse', -60),
  // Exactly cancels `mend`'s power: the request lands on 0, the boundary case.
  nullify: auraCard('nullify', -5),
  bless: auraCard('bless', 10),
  // Physical so it scales off Armor (0 in these tests) — the request is
  // therefore exactly `power + healFlat`, hand-computable.
  mend: {
    id: 'mend', name: 'Mend', archetypes: ['support'], property: 'physical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'sword', cooldownTurns: 0,
    effects: [{ kind: 'heal', power: 5 }], text: '',
  },
  // Chips the hero down so `mend` always has room to heal (no overheal noise).
  peck: {
    id: 'peck', name: 'Peck', archetypes: ['offense'], property: 'physical', size: 1,
    speedWeight: 10, rarity: 'common', tier: 'bronze', weapon: 'beast', cooldownTurns: 0,
    effects: [{ kind: 'damage', power: 4 }], text: '',
  },
} satisfies Record<string, SkillDef>;

/**
 * `foe: 'passive'` gives the enemy an EMPTY board, so nothing but the hero's own
 * heal can ever move the hero's HP. That matters: `dealDamage` floors HP at 0,
 * so ANY incoming hit launders a negative HP bar back to 0 and hides the defect.
 * `foe: 'pecker'` is the opposite case — chip damage, so a positive heal has room.
 */
function run(auraId: string, foe: 'passive' | 'pecker' = 'passive'): {
  events: readonly CombatEvent[];
  hero: CombatantState;
  all: CombatantState[];
} {
  const config: CombatConfig = {
    playerTeam: [{
      name: 'hero',
      // maxHp 100, armor 0 -> `mend`'s stat term is 0 and the request is exact.
      stats: { maxHp: 100, hp: 100, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 20 },
      boardSize: 10,
      pieces: [{ skillId: auraId, slot: 0 }, { skillId: 'mend', slot: 1 }],
    }],
    enemyTeam: [{
      name: foe,
      stats: { maxHp: 5000, hp: 5000, attack: 0, magicPower: 0, armor: 0, magicResist: 0, speed: 10 },
      boardSize: 10,
      pieces: foe === 'pecker' ? [{ skillId: 'peck', slot: 0 }] : [],
    }],
    skillBook: book,
    suddenDeathRound: 999,
    fatigueTurn: 999_999,
    attritionTurn: 999_999,
    maxTurns: 12,
  };
  const { events, finalState } = simulate(config, 1);
  return {
    events,
    hero: finalState.playerTeam[0]!,
    all: [...finalState.playerTeam, ...finalState.enemyTeam],
  };
}

const heals = (events: readonly CombatEvent[]): Extract<CombatEvent, { kind: 'heal' }>[] =>
  events.filter((e): e is Extract<CombatEvent, { kind: 'heal' }> => e.kind === 'heal');

describe('a negative heal request restores nothing (it never drains HP)', () => {
  it('a heal-5 card beside a healFlat -60 aura leaves HP FULL — no drain, no negative bar, no silent death', () => {
    const { events, hero } = run('curse'); // request = 5 + 0 + (-60) = -55, every cast
    // Nothing else in this fight can touch the hero's HP (the foe has no board),
    // so any movement at all is the heal draining it.
    expect(hero.stats.hp, 'REGRESSION: a heal drove HP to -100/100').toBe(100);
    expect(hero.alive, 'the alive <=> hp > 0 invariant must hold').toBe(true);
    // Nothing was restored, so nothing is claimed in the log.
    expect(heals(events), 'a clamped-away heal attempted nothing and stays silent').toEqual([]);
    // The card genuinely cast, repeatedly — the scenario is real, not a no-show.
    const casts = events.filter((e) => e.kind === 'play' && e.skillId === 'mend');
    expect(casts.length).toBeGreaterThan(2);
  });

  it('HP never goes negative and `alive` never disagrees with it, for ANY unit', () => {
    for (const auraId of ['curse', 'nullify', 'bless']) {
      for (const foe of ['passive', 'pecker'] as const) {
        const { events, all } = run(auraId, foe);
        for (const u of all) {
          expect(u.stats.hp, `${auraId}/${foe}: ${u.name} hp must be >= 0`).toBeGreaterThanOrEqual(0);
          expect(u.alive, `${auraId}/${foe}: ${u.name} alive must equal hp > 0`).toBe(u.stats.hp > 0);
        }
        // Every hpAfter the log ever reports is non-negative too, so no
        // intermediate state was negative either.
        for (const e of events) {
          if (e.kind === 'damage' || e.kind === 'heal') expect(e.hpAfter).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('the boundary: a request of exactly 0 behaves like the clamped case (silent, no HP change)', () => {
    const { events, hero } = run('nullify'); // 5 + (-5) = 0
    expect(heals(events)).toEqual([]);
    expect(hero.stats.hp).toBe(100);
  });

  it('CONTROL: a POSITIVE aura heals normally — the clamp only touches requests <= 0', () => {
    const { events } = run('bless', 'pecker'); // 5 + 10 = 15
    const healed = heals(events);
    expect(healed.length).toBeGreaterThan(0);
    for (const h of healed) {
      expect(h.amount + h.overheal, 'the full 15-point request must still be credited').toBe(15);
      expect(h.calculation).toMatchObject({ power: 5, statBonus: 0, healFlat: 10 });
    }
  });
});
