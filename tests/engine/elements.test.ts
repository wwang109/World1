import { describe, expect, it } from 'vitest';
import { elementMatchup, matchupPct, weaponMatchup } from '../../src/engine/elements';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
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
  it('Sword → Axe → Lance → Sword; bow is outside the triangle', () => {
    expect(weaponMatchup('sword', 'axe')).toBe('advantage');
    expect(weaponMatchup('axe', 'lance')).toBe('advantage');
    expect(weaponMatchup('lance', 'sword')).toBe('advantage');
    expect(weaponMatchup('axe', 'sword')).toBe('disadvantage');
    // Bow: neutral both ways against everything.
    expect(weaponMatchup('bow', 'sword')).toBe('neutral');
    expect(weaponMatchup('sword', 'bow')).toBe('neutral');
  });

  it('multipliers are +50% / −25%', () => {
    expect(matchupPct('advantage')).toBe(150);
    expect(matchupPct('disadvantage')).toBe(75);
    expect(matchupPct('neutral')).toBe(100);
  });
});

describe('matchups in combat', () => {
  it('frost magic hits a fire-affinity enemy for +50%', () => {
    // slow_hex (frost): 80% of MP 10 = 8, no resist -> 8, x1.5 = 12.
    const c = cfg(
      tc('hero', ['slow_hex'], { magicPower: 10, speed: 20 }),
      { ...tc('imp', [], { speed: 10, maxHp: 200 }), elementAffinity: 'fire' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage')).toMatchObject({ amount: 12, matchup: 'advantage' });
  });

  it('fire magic into a fire... into frost affinity is resisted −25%', () => {
    // fireball (fire) vs frost affinity: frost beats fire -> disadvantage.
    // 200% of MP 10 = 20 -> x0.75 = 15. Burn 5 bakes to 3 (floor 5*0.75).
    const c = cfg(
      tc('hero', ['fireball'], { magicPower: 10, speed: 20 }),
      { ...tc('yeti', [], { speed: 10, maxHp: 200 }), elementAffinity: 'frost' },
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events } = simulate(c, 1);
    expect(events.find((e) => e.kind === 'damage' && e.source === 'skill')).toMatchObject({
      amount: 15,
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

  it('bows are neutral against every weapon affinity', () => {
    // venom_fang (bow): 160% of 10 = 16, no multiplier vs sword affinity.
    const c = cfg(
      tc('hero', ['venom_fang'], { attack: 10, speed: 20 }),
      { ...tc('swordsman', [], { speed: 10, maxHp: 200 }), weaponAffinity: 'sword' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage');
    expect(hit).toMatchObject({ amount: 16 });
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });

  it('true damage ignores affinities entirely', () => {
    const c = cfg(
      tc('hero', ['soul_rend'], { attack: 10, magicPower: 10, speed: 20 }),
      { ...tc('imp', [], { speed: 10, maxHp: 200 }), elementAffinity: 'fire', weaponAffinity: 'axe' },
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events } = simulate(c, 1);
    const hit = events.find((e) => e.kind === 'damage');
    expect(hit).toMatchObject({ amount: 28 }); // 280% of 10, no matchup
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });
});

describe('data completeness', () => {
  it('every magical card has an element; physical damage cards have a weapon; true cards have neither', () => {
    for (const skill of Object.values(skillBook)) {
      if (skill.property === 'magical') {
        expect(skill.element, `${skill.id} needs an element`).toBeDefined();
        expect(skill.weapon).toBeUndefined();
      } else if (skill.property === 'physical') {
        const dealsDamage = skill.effects.some((e) => e.kind === 'damage');
        if (dealsDamage) expect(skill.weapon, `${skill.id} needs a weapon`).toBeDefined();
        expect(skill.element).toBeUndefined();
      } else {
        expect(skill.element).toBeUndefined();
        expect(skill.weapon).toBeUndefined();
      }
    }
  });
});
