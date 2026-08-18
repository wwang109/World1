import { describe, expect, it } from 'vitest';
import { applyTier } from '../../src/engine/cards';
import type { SkillDef } from '../../src/engine/types';
import { cardGlossaryEntries, cardHoverEntries } from '../../src/game/ui/cardHoverEntries';
import { isAoeSkill, summarizeEffects } from '../../src/game/ui/skillPresentation';

/**
 * `scope: 'all'` — whether a cast fans out to every living foe instead of one
 * chosen target — used to be invisible everywhere in `src/game`: no face
 * token, no glossary entry, nothing. Worse, `TierUpgrade.scope` lets a card be
 * single-target at Bronze and AoE from a higher tier up, so a player ranking a
 * card up got zero visual signal that the one thing that most changes how the
 * card plays had just changed. These tests pin the face marker (`AOE` in
 * `summarizeEffects`), its glossary/hover explanation, and — the case that
 * actually proves the fix reads the EFFECTIVE scope, not the base card's —
 * that the marker only appears once a tier upgrade turns the scope on.
 */

function makeSkill(overrides: Partial<SkillDef>): SkillDef {
  return {
    id: 'test_skill',
    name: 'Test Skill',
    archetypes: ['offense'],
    property: 'physical',
    weapon: 'sword',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [{ kind: 'damage', power: 20 }],
    text: 'Deal 20 damage.',
    ...overrides,
  };
}

describe('isAoeSkill', () => {
  it('is true for an offensive card with scope: "all"', () => {
    expect(isAoeSkill(makeSkill({ scope: 'all' }))).toBe(true);
  });

  it('is false for a single-target (default scope) card', () => {
    expect(isAoeSkill(makeSkill({}))).toBe(false);
    expect(isAoeSkill(makeSkill({ scope: 'one' }))).toBe(false);
  });

  it('is false when scope: "all" is set but the card carries no offensive action', () => {
    // scope only changes targeting for OFFENSIVE actions (engine/types.ts) —
    // a stray flag on a pure heal/support card must not claim AoE.
    const supportOnly = makeSkill({ scope: 'all', effects: [{ kind: 'heal', power: 20 }] });
    expect(isAoeSkill(supportOnly)).toBe(false);
  });
});

describe('summarizeEffects — AoE face marker', () => {
  it('leads with AOE for an offensive scope: "all" card', () => {
    const skill = makeSkill({ scope: 'all' });
    expect(summarizeEffects(skill)).toBe('AOE · DMG 20');
  });

  it('omits AOE for an otherwise-identical single-target card', () => {
    const skill = makeSkill({});
    expect(summarizeEffects(skill)).toBe('DMG 20');
  });

  it('does not mark a scope: "all" card with no offensive action as AOE', () => {
    const skill = makeSkill({ scope: 'all', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(skill)).not.toContain('AOE');
    expect(summarizeEffects(skill)).toBe('HEAL 20');
  });

  it('an aura card keeps its own ALL/NEAR reach word and never prints AOE too', () => {
    // Mutually exclusive branch (summarizeEffects returns early for auras) —
    // scope is meaningless there; this pins that the two reach vocabularies
    // never collide on one face.
    const skill = makeSkill({
      effects: [],
      scope: 'all',
      aura: { affects: 'allBoard', mods: { damageFlat: 5 } },
    });
    expect(summarizeEffects(skill)).toBe('ALL +5 DMG');
  });

  // THE CASE THIS FIX EXISTS FOR: `TierUpgrade.scope` (engine/types.ts) lets a
  // tier block turn AoE on above Bronze. The face must reflect the EFFECTIVE
  // (post-`applyTier`) scope at whichever tier is being displayed, not the
  // base card's — so the same card shows NO marker at Bronze and the marker
  // at Gold, from feeding `applyTier`'s own output straight into
  // `summarizeEffects`, exactly as `resolveDisplaySkill`/`CardToken` do.
  describe('a card that goes AoE only at a higher tier (TierUpgrade.scope)', () => {
    const CLEAVE: SkillDef = makeSkill({
      id: 'test_cleave',
      name: 'Cleave',
      effects: [{ kind: 'damage', power: 20 }],
      text: 'Deal 20 damage.',
      tierUpgrades: {
        silver: { effects: [{ kind: 'damage', power: 30 }], text: 'Deal 30 damage.' },
        gold: {
          scope: 'all',
          effects: [{ kind: 'damage', power: 25 }, { kind: 'shield', power: 7 }],
          text: 'Deal 25 damage to ALL foes. Gain 7 shield.',
        },
        diamond: {
          scope: 'all',
          effects: [{ kind: 'damage', power: 25 }, { kind: 'shield', power: 17 }],
          text: 'Deal 25 damage to ALL foes. Gain 17 shield.',
        },
      },
    });

    it('shows no AOE marker at Bronze', () => {
      expect(summarizeEffects(applyTier(CLEAVE, 'bronze'))).not.toContain('AOE');
    });

    it('still shows no AOE marker at Silver (the tier block below stays single-target)', () => {
      expect(summarizeEffects(applyTier(CLEAVE, 'silver'))).not.toContain('AOE');
    });

    it('shows the AOE marker once resolved at Gold, where the tier block turns scope on', () => {
      const goldFace = summarizeEffects(applyTier(CLEAVE, 'gold'));
      expect(goldFace).toContain('AOE');
      expect(goldFace).toBe('AOE · DMG 25 · SHLD 7');
    });

    it('keeps the AOE marker at Diamond (the authoring rule requires every higher tier to repeat scope)', () => {
      expect(summarizeEffects(applyTier(CLEAVE, 'diamond'))).toContain('AOE');
    });
  });
});

describe('AoE targeting — glossary/hover explanation', () => {
  it('cardGlossaryEntries adds an "AoE targeting" entry only for an AoE card', () => {
    const aoe = makeSkill({ scope: 'all' });
    const single = makeSkill({});
    expect(cardGlossaryEntries(aoe).some((e) => e.title === 'AoE targeting')).toBe(true);
    expect(cardGlossaryEntries(single).some((e) => e.title === 'AoE targeting')).toBe(false);
  });

  it('cardHoverEntries surfaces the same explanation, brief, only for an AoE card', () => {
    const aoe = makeSkill({ scope: 'all' });
    const single = makeSkill({});
    expect(cardHoverEntries(aoe).some((e) => e.title === 'AoE targeting')).toBe(true);
    expect(cardHoverEntries(single).some((e) => e.title === 'AoE targeting')).toBe(false);
  });

  it('the glossary/hover entry reflects the EFFECTIVE scope at a higher tier too', () => {
    const CLEAVE: SkillDef = makeSkill({
      tierUpgrades: {
        gold: { scope: 'all', effects: [{ kind: 'damage', power: 25 }], text: 'Deal 25 damage to ALL foes.' },
      },
    });
    expect(cardGlossaryEntries(applyTier(CLEAVE, 'bronze')).some((e) => e.title === 'AoE targeting')).toBe(false);
    expect(cardGlossaryEntries(applyTier(CLEAVE, 'gold')).some((e) => e.title === 'AoE targeting')).toBe(true);
  });
});
