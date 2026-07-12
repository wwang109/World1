import { describe, expect, it } from 'vitest';
import { elementMatchup, matchupPct, weaponMatchup } from '../../src/engine/elements';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { SkillBook } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

describe('element wheel', () => {
  it('Fire → Nature → Lightning → Frost → Fire', () => {
    expect(elementMatchup('fire', 'nature')).toBe('advantage');
    expect(elementMatchup('nature', 'lightning')).toBe('advantage');
    expect(elementMatchup('lightning', 'frost')).toBe('advantage');
    expect(elementMatchup('frost', 'fire')).toBe('advantage');
    // Reverse direction = disadvantage.
    expect(elementMatchup('nature', 'fire')).toBe('disadvantage');
    expect(elementMatchup('fire', 'frost')).toBe('disadvantage');
    // Non-adjacent = neutral.
    expect(elementMatchup('fire', 'lightning')).toBe('neutral');
  });

  it('Holy and Dark are mutually strong', () => {
    expect(elementMatchup('holy', 'dark')).toBe('advantage');
    expect(elementMatchup('dark', 'holy')).toBe('advantage');
    expect(elementMatchup('holy', 'fire')).toBe('neutral');
  });

  it('no affinity means neutral', () => {
    expect(elementMatchup('fire', undefined)).toBe('neutral');
    expect(elementMatchup(undefined, 'fire')).toBe('neutral');
  });
});

describe('weapon triangle', () => {
  it('Sword → Axe → Lance → Sword; bow and beast are outside the triangle', () => {
    expect(weaponMatchup('sword', 'axe')).toBe('advantage');
    expect(weaponMatchup('axe', 'lance')).toBe('advantage');
    expect(weaponMatchup('lance', 'sword')).toBe('advantage');
    expect(weaponMatchup('axe', 'sword')).toBe('disadvantage');
    // Bow and beast: neutral against the triangle.
    expect(weaponMatchup('bow', 'sword')).toBe('neutral');
    expect(weaponMatchup('sword', 'bow')).toBe('neutral');
    expect(weaponMatchup('beast', 'lance')).toBe('neutral');
    expect(weaponMatchup('axe', 'beast')).toBe('neutral');
    // But bow beats beast (the hunter's niche).
    expect(weaponMatchup('bow', 'beast')).toBe('advantage');
    expect(weaponMatchup('beast', 'bow')).toBe('disadvantage');
  });

  it('multipliers are +50% / −25%', () => {
    expect(matchupPct('advantage')).toBe(150);
    expect(matchupPct('disadvantage')).toBe(75);
    expect(matchupPct('neutral')).toBe(100);
  });
});

describe('matchups in combat', () => {
  it('frost magic hits a fire-affinity enemy for +50%', () => {
    // slow_hex (frost): 50% of MP 10 = 5, no resist -> 5, x1.5 = 7.
    const c = cfg(
      tc('hero', ['slow_hex'], { magicPower: 10, speed: 20 }),
      { ...tc('imp', [], { speed: 10, maxHp: 200 }), elementAffinity: 'fire' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 7, matchup: 'advantage' });
  });

  it('fire magic into a fire... into frost affinity is resisted −25%', () => {
    // fireball (fire) vs frost affinity: frost beats fire -> disadvantage.
    // 220% of MP 10 = 22 -> x0.75 = 16. Burn 5 bakes to 3 (floor 5*0.75).
    const c = cfg(
      tc('hero', ['fireball'], { magicPower: 10, speed: 20 }),
      { ...tc('yeti', [], { speed: 10, maxHp: 200 }), elementAffinity: 'frost' },
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage' && e.source === 'skill')).toMatchObject({
      amount: 16,
      matchup: 'disadvantage',
    });
    const burnTick = events.find((e) => e.kind === 'damage' && e.source === 'burn');
    expect(burnTick).toMatchObject({ amount: 3 }); // DoT baked the multiplier
  });

  it('sword beats an axe-affinity enemy for +50%', () => {
    // sword_slash: 200% of 10 = 20, 0 armor -> 20, x1.5 = 30.
    const c = cfg(
      tc('hero', ['sword_slash'], { attack: 10, speed: 20 }),
      { ...tc('axeman', [], { speed: 10, maxHp: 200 }), weaponAffinity: 'axe' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 30, matchup: 'advantage' });
  });

  it('beast attacks are neutral against the triangle', () => {
    // venom_fang (beast): 140% of 10 = 14, no multiplier vs sword affinity.
    const c = cfg(
      tc('hero', ['venom_fang'], { attack: 10, speed: 20 }),
      { ...tc('swordsman', [], { speed: 10, maxHp: 200 }), weaponAffinity: 'sword' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage');
    expect(hit).toMatchObject({ amount: 14 });
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });

  it('a bow hits a beast-affinity monster for +50%', () => {
    // hunter_shot: 200% of 10 = 20, x1.5 = 30 vs the beast wolf.
    const c = cfg(
      tc('hero', ['hunter_shot'], { attack: 10, speed: 20 }),
      { ...tc('wolf', [], { speed: 10, maxHp: 200 }), weaponAffinity: 'beast' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 30, matchup: 'advantage' });
  });

  it('true damage ignores affinities entirely', () => {
    const c = cfg(
      tc('hero', ['soul_rend'], { attack: 10, magicPower: 10, speed: 20 }),
      { ...tc('imp', [], { speed: 10, maxHp: 200 }), elementAffinity: 'fire', weaponAffinity: 'axe' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage');
    expect(hit).toMatchObject({ amount: 32 }); // 320% of 10, no matchup
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });
});

describe('data completeness', () => {
  it('every card carries at most one matchup tag; weapon tags are always physical', () => {
    for (const skill of Object.values(skillBook)) {
      expect(
        skill.element === undefined || skill.weapon === undefined,
        `${skill.id} carries both an element and a weapon tag — a card must be element-tagged, weapon-tagged, or neither`,
      ).toBe(true);
      if (skill.weapon !== undefined) {
        expect(skill.property, `${skill.id} is weapon-tagged but not physical`).toBe('physical');
      }
    }
  });
});

describe('tag-driven matchup (decoupled from property)', () => {
  it('a PHYSICAL card with an element tag uses the element wheel, not the weapon triangle', () => {
    const book: SkillBook = {
      fire_brand: {
        id: 'fire_brand',
        name: 'Fire Brand',
        archetypes: ['offense'],
        property: 'physical',
        element: 'fire',
        size: 1,
        speedWeight: 10,
        tier: 'common',
        effects: [{ kind: 'damage', power: 200 }],
        text: '',
      },
    };
    // vs fire-weak affinity (frost beats fire -> a fire attack has advantage vs frost? no:
    // ELEMENT_BEATS.fire = 'nature', so fire beats a nature-affinity defender): advantage.
    const advCfg = cfg(
      tc('hero', ['fire_brand'], { attack: 10, speed: 20 }, { skillBook: book }),
      { ...tc('sprite', [], { speed: 10, maxHp: 200 }), elementAffinity: 'nature' },
      { ...NO_ENDGAME, maxTurns: 1, skillBook: book },
    );
    const { events } = simulate(advCfg, 1);
    // 200% of attack 10 = 20, no armor -> 20, x1.5 = 30.
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 30, matchup: 'advantage' });

    // vs frost affinity (frost beats fire): disadvantage, even though the card is physical.
    const disCfg = cfg(
      tc('hero', ['fire_brand'], { attack: 10, speed: 20 }, { skillBook: book }),
      { ...tc('yeti', [], { speed: 10, maxHp: 200 }), elementAffinity: 'frost' },
      { ...NO_ENDGAME, maxTurns: 1, skillBook: book },
    );
    const { events: disEvents } = simulate(disCfg, 1);
    // 200% of attack 10 = 20, x0.75 = 15.
    expect(disEvents.find((e) => e.kind === 'damage')).toMatchObject({ amount: 15, matchup: 'disadvantage' });
  });
});
