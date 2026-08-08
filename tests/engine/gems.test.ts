import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { initCombatState, type CombatantState } from '../../src/engine/combat/state';
import { aurasOn } from '../../src/engine/combat/auras';
import { resolveDisplayHeroStats, resolveDisplaySkill, resolveEffectiveSkill } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';
import type { BoardPiece, Gem } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

function pieceAt(c: CombatantState, slot: number) {
  const p = c.pieces.find((x) => x.slot === slot);
  if (!p) throw new Error(`no piece at slot ${slot}`);
  return p;
}

const poisonGem: Gem = {
  kind: 'effect',
  id: 'gem_venom',
  rarity: 'common',
  actions: [{ kind: 'poison', stacks: 5 }],
};

describe('gems: effect gems (append-only riders)', () => {
  it('an effect gem appends its actions after the base effects and fires', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }, {
        pieces: [{ skillId: 'sword_slash', slot: 0, gem: poisonGem }],
      }),
      tc('wall', [], { maxHp: 1000, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    // Base damage still fires first, gem poison applies after.
    expect(events.find((e) => e.kind === 'damage')).toBeDefined();
    const poison = events.find((e) => e.kind === 'statusApplied' && e.status === 'poison');
    expect(poison).toMatchObject({ side: 'enemy', status: 'poison' });
  });

  it('an un-gemmed damage card produces NO poison (baseline)', () => {
    const c = cfg(
      tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }, {
        pieces: [{ skillId: 'sword_slash', slot: 0 }],
      }),
      tc('wall', [], { maxHp: 1000, speed: 1 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.some((e) => e.kind === 'statusApplied' && e.status === 'poison')).toBe(false);
  });

  it('resolveEffectiveSkill appends in fixed order (base first, gem after) and STAMPS the gem actions', () => {
    const def = skillBook['sword_slash']!;
    const eff = resolveEffectiveSkill(def, { skillId: 'sword_slash', slot: 0, gem: poisonGem });
    // The resolver seam marks provenance so the core loop never has to infer it.
    expect(eff.effects).toEqual([...def.effects, ...poisonGem.actions.map((a) => ({ ...a, fromGem: true }))]);
    expect(eff.effects[eff.effects.length - 1]).toMatchObject({ kind: 'poison', fromGem: true });
    // The card's OWN actions are never stamped...
    expect(eff.effects[0]).not.toHaveProperty('fromGem');
    // ...and the shared content object in src/data is never mutated.
    expect(poisonGem.actions[0]).not.toHaveProperty('fromGem');
  });
});

describe('gems: card-scope stat gems ride the aura bundle', () => {
  it('+damageFlat raises that card output; both stack into aurasOn', () => {
    const dmgGem: Gem = { kind: 'stat', id: 'g_dmg', rarity: 'rare', scope: 'card', mods: { card: { damageFlat: 30 } } };
    const boarded = (pieces: BoardPiece[]) =>
      initCombatState(cfg(tc('hero', [], {}, { boardSize: 10, pieces }), tc('foe', []))).player;

    const gemmed = boarded([{ skillId: 'sword_slash', slot: 0, gem: dmgGem }]);
    const plain = boarded([{ skillId: 'sword_slash', slot: 0 }]);
    expect(aurasOn(gemmed, pieceAt(gemmed, 0), skillBook).damageFlat).toBe(30);
    expect(aurasOn(plain, pieceAt(plain, 0), skillBook).damageFlat).toBe(0);

    // End to end: +30 flat damage adds on top of the hit (20 flat + 10 atk + 30 = 60).
    const dmgOf = (gem?: Gem) => {
      const c = cfg(
        tc('hero', [], { attack: 10, speed: 20, maxHp: 500 }, {
          pieces: [{ skillId: 'sword_slash', slot: 0, gem: gem ?? null }],
        }),
        tc('wall', [], { maxHp: 1000, speed: 1 }),
        { ...NO_ENDGAME, maxTurns: 1 },
      );
      const dmg = simulate(c, 1).events.find((e) => e.kind === 'damage') as { amount: number };
      return dmg.amount;
    };
    expect(dmgOf()).toBe(30);
    expect(dmgOf(dmgGem)).toBe(60);
  });

  it('-weightDelta lightens the socketed card in the initiative comparison', () => {
    const lightGem: Gem = { kind: 'stat', id: 'g_light', rarity: 'rare', scope: 'card', mods: { card: { weightDelta: -6 } } };
    const c = initCombatState(
      cfg(tc('hero', [], {}, { boardSize: 10, pieces: [{ skillId: 'sword_slash', slot: 0, gem: lightGem }] }), tc('foe', [])),
    ).player;
    expect(aurasOn(c, pieceAt(c, 0), skillBook).weightDelta).toBe(-6);
  });
});

describe('gems: hero-scope stat gems fold into base stats', () => {
  it('+attack / +speed raise the combatant effective stats at setup', () => {
    const heroGem: Gem = { kind: 'stat', id: 'g_might', rarity: 'epic', scope: 'hero', mods: { hero: { attack: 7, speed: 3 } } };
    const state = initCombatState(
      cfg(
        tc('hero', [], { attack: 10, speed: 10 }, { boardSize: 10, pieces: [{ skillId: 'sword_slash', slot: 0, gem: heroGem }] }),
        tc('foe', []),
      ),
    );
    expect(state.player.stats.attack).toBe(17);
    expect(state.player.stats.speed).toBe(13);
    // No gem on enemy -> untouched.
    expect(state.enemy.stats.attack).toBe(10);
  });

  it('two hero gems on the board sum their contributions', () => {
    const g1: Gem = { kind: 'stat', id: 'g1', rarity: 'common', scope: 'hero', mods: { hero: { attack: 4 } } };
    const g2: Gem = { kind: 'stat', id: 'g2', rarity: 'common', scope: 'hero', mods: { hero: { attack: 6 } } };
    const state = initCombatState(
      cfg(
        tc('hero', [], { attack: 10 }, {
          boardSize: 10,
          pieces: [
            { skillId: 'sword_slash', slot: 0, gem: g1 },
            { skillId: 'sword_slash', slot: 1, gem: g2 },
          ],
        }),
        tc('foe', []),
      ),
    );
    expect(state.player.stats.attack).toBe(20);
  });
});

describe('resolveDisplayHeroStats: hero stat-readout gem fold (display-only, task 39 item 2)', () => {
  it('matches the EXACT stats initCombatState applies at cast time for a gemmed board', () => {
    const heroGem: Gem = { kind: 'stat', id: 'g_might', rarity: 'epic', scope: 'hero', mods: { hero: { attack: 7, speed: 3 } } };
    const pieces: BoardPiece[] = [{ skillId: 'sword_slash', slot: 0, gem: heroGem }];
    const baseStats = { attack: 10, speed: 10 } as const;

    const shown = resolveDisplayHeroStats({ maxHp: 100, hp: 100, attack: 10, magicPower: 5, armor: 2, magicResist: 2, speed: 10 }, pieces);
    expect(shown.attack).toBe(17);
    expect(shown.speed).toBe(13);

    const state = initCombatState(cfg(tc('hero', [], baseStats, { boardSize: 10, pieces }), tc('foe', [])));
    expect(shown.attack).toBe(state.player.stats.attack);
    expect(shown.speed).toBe(state.player.stats.speed);
  });

  it('two hero gems on the board sum their contributions, same as the engine fold', () => {
    const g1: Gem = { kind: 'stat', id: 'g1', rarity: 'common', scope: 'hero', mods: { hero: { attack: 4 } } };
    const g2: Gem = { kind: 'stat', id: 'g2', rarity: 'common', scope: 'hero', mods: { hero: { attack: 6 } } };
    const pieces: BoardPiece[] = [
      { skillId: 'sword_slash', slot: 0, gem: g1 },
      { skillId: 'sword_slash', slot: 1, gem: g2 },
    ];
    const shown = resolveDisplayHeroStats({ maxHp: 100, hp: 100, attack: 10, magicPower: 0, armor: 0, magicResist: 0, speed: 0 }, pieces);
    expect(shown.attack).toBe(20);
  });

  it('a card-scope gem never bumps a hero stat (only hero-scope gems do)', () => {
    const cardGem: Gem = { kind: 'stat', id: 'g_dmg', rarity: 'rare', scope: 'card', mods: { card: { damageFlat: 30 } } };
    const pieces: BoardPiece[] = [{ skillId: 'sword_slash', slot: 0, gem: cardGem }];
    const stats = { maxHp: 100, hp: 100, attack: 10, magicPower: 5, armor: 2, magicResist: 2, speed: 10 };
    expect(resolveDisplayHeroStats(stats, pieces)).toEqual(stats);
  });

  it('no gems on the board is a no-op (same values, byte-identical)', () => {
    const pieces: BoardPiece[] = [{ skillId: 'sword_slash', slot: 0 }];
    const stats = { maxHp: 100, hp: 100, attack: 10, magicPower: 5, armor: 2, magicResist: 2, speed: 10 };
    expect(resolveDisplayHeroStats(stats, pieces)).toEqual(stats);
  });
});

describe('resolveDisplaySkill: card-FACE gem fold (display-only)', () => {
  it("a card-scope healFlat gem bumps a heal action's power AND retexts the flavor number (task 35: HEAL 20 + 8 gem -> HEAL 28)", () => {
    const def = skillBook['verdant_touch']!; // "Restore 20 (+MDEF) HP."
    const healGem: Gem = { kind: 'stat', id: 'g_heal', rarity: 'legendary', scope: 'card', mods: { card: { healFlat: 8 } } };
    const shown = resolveDisplaySkill(def, { skillId: 'verdant_touch', slot: 0, gem: healGem });
    expect(shown.effects).toEqual([{ kind: 'heal', power: 28 }]);
    expect(shown.text).toBe('Restore 28 (+MDEF) HP.');
    // The un-gemmed base def is never mutated.
    expect(def.effects).toEqual([{ kind: 'heal', power: 20 }]);
  });

  it("a card-scope damageFlat gem bumps a damage action's power AND retexts the flavor number", () => {
    const def = skillBook['sword_slash']!; // "Deal 20 (+ATK) Sword damage."
    const dmgGem: Gem = { kind: 'stat', id: 'g_dmg', rarity: 'rare', scope: 'card', mods: { card: { damageFlat: 6 } } };
    const shown = resolveDisplaySkill(def, { skillId: 'sword_slash', slot: 0, gem: dmgGem });
    expect(shown.effects).toEqual([{ kind: 'damage', power: 26 }]);
    expect(shown.text).toBe('Deal 26 (+ATK) Sword damage.');
  });

  it("a card-scope healFlat gem never touches a shield action — mirrors the engine's own split (interpreter.ts's shield case never reads mods)", () => {
    const def = skillBook['mana_ward']!; // "Gain 20 (+MDEF) magical shield."
    const healGem: Gem = { kind: 'stat', id: 'g_heal', rarity: 'legendary', scope: 'card', mods: { card: { healFlat: 8 } } };
    const shown = resolveDisplaySkill(def, { skillId: 'mana_ward', slot: 0, gem: healGem });
    expect(shown.effects).toEqual(def.effects);
    expect(shown.text).toBe(def.text);
  });

  it('an effect gem\'s appended actions still show up, provenance mark and all (delegates to resolveEffectiveSkill unchanged)', () => {
    const def = skillBook['sword_slash']!;
    const shown = resolveDisplaySkill(def, { skillId: 'sword_slash', slot: 0, gem: poisonGem });
    expect(shown.effects).toEqual([...def.effects, ...poisonGem.actions.map((a) => ({ ...a, fromGem: true }))]);
  });

  it('a hero-scope stat gem never folds into the card face (it boosts the combatant, not this card)', () => {
    const def = skillBook['sword_slash']!;
    const heroGem: Gem = { kind: 'stat', id: 'g_might', rarity: 'epic', scope: 'hero', mods: { hero: { attack: 7 } } };
    expect(resolveDisplaySkill(def, { skillId: 'sword_slash', slot: 0, gem: heroGem })).toBe(def);
  });

  it('un-gemmed pieces resolve to the same SkillDef reference as resolveEffectiveSkill (no display-only divergence)', () => {
    const def = skillBook['sword_slash']!;
    expect(resolveDisplaySkill(def, { skillId: 'sword_slash', slot: 0 })).toBe(def);
    expect(resolveDisplaySkill(def, { skillId: 'sword_slash', slot: 0, gem: null })).toBe(def);
  });
});

describe('gems: determinism / backward compat', () => {
  it('gem: null is byte-identical to omitting the gem field', () => {
    const build = (pieces: BoardPiece[]) =>
      cfg(
        tc('hero', [], { attack: 12, speed: 15, maxHp: 300 }, { pieces }),
        tc('foe', ['sword_slash'], { attack: 8, speed: 12, maxHp: 300 }),
      );
    const withNull = simulate(build([{ skillId: 'sword_slash', slot: 0, gem: null }]), 42);
    const withoutField = simulate(build([{ skillId: 'sword_slash', slot: 0 }]), 42);
    expect(withNull.events).toEqual(withoutField.events);
    expect(withNull.result).toEqual(withoutField.result);
  });

  it('un-gemmed pieces resolve to the same SkillDef reference', () => {
    const def = skillBook['sword_slash']!;
    expect(resolveEffectiveSkill(def, { skillId: 'sword_slash', slot: 0 })).toBe(def);
    expect(resolveEffectiveSkill(def, { skillId: 'sword_slash', slot: 0, gem: null })).toBe(def);
  });
});
