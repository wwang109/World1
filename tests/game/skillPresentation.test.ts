import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../../src/engine/types';
import { summarizeEffects } from '../../src/game/ui/skillPresentation';

function makeSkill(overrides: Partial<SkillDef>): SkillDef {
  return {
    id: 'test_skill',
    name: 'Test Skill',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [],
    text: '',
    ...overrides,
  };
}

describe('summarizeEffects — live stat scaling', () => {
  it('falls back to the bare base number with no stats supplied', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill)).toBe('DMG 20');
  });

  it('renders physical damage as the summed effective number (base + Attack)', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill, { attack: 17, magicPower: 4 })).toBe('DMG 37');
  });

  it('renders magical damage as the summed effective number (base + Magic Power)', () => {
    const skill = makeSkill({ property: 'magical', element: 'fire', effects: [{ kind: 'damage', power: 18 }] });
    expect(summarizeEffects(skill, { attack: 5, magicPower: 12 })).toBe('DMG 30');
  });

  it('renders TRUE damage summed off whichever stat is higher', () => {
    const skill = makeSkill({ property: 'true', effects: [{ kind: 'damage', power: 10 }] });
    expect(summarizeEffects(skill, { attack: 20, magicPower: 8 })).toBe('DMG 30');
    expect(summarizeEffects(skill, { attack: 8, magicPower: 20 })).toBe('DMG 30');
  });

  it('renders magical heal/shield as the summed effective number', () => {
    const heal = makeSkill({ property: 'magical', element: 'nature', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(heal, { attack: 4, magicPower: 12 })).toBe('HEAL 32');
    const shield = makeSkill({ property: 'magical', element: 'frost', effects: [{ kind: 'shield', power: 16 }] });
    expect(summarizeEffects(shield, { attack: 4, magicPower: 12 })).toBe('SHLD 28');
  });

  it('never scales TRUE heal/shield — stays flat even with stats supplied', () => {
    const heal = makeSkill({ property: 'true', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(heal, { attack: 99, magicPower: 99 })).toBe('HEAL 20');
    const shield = makeSkill({ property: 'true', effects: [{ kind: 'shield', power: 16 }] });
    expect(summarizeEffects(shield, { attack: 99, magicPower: 99 })).toBe('SHLD 16');
  });

  it('falls back to bare base when the stat contribution is zero', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill, { attack: 0, magicPower: 0 })).toBe('DMG 20');
  });

  it('keeps non-scaling extras (DoTs, riders) unchanged alongside the scaled line', () => {
    const skill = makeSkill({
      property: 'physical',
      weapon: 'axe',
      effects: [{ kind: 'damage', power: 12 }, { kind: 'poison', stacks: 5 }],
    });
    expect(summarizeEffects(skill, { attack: 6, magicPower: 0 })).toBe('DMG 18 · PSN 5');
  });

  it('leaves aura cards and passives untouched by the stats param', () => {
    const passive = makeSkill({ effects: [] });
    expect(summarizeEffects(passive, { attack: 10, magicPower: 10 })).toBe('PASSIVE');
  });
});
