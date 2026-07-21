import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../../src/engine/types';
import { skillBook } from '../../src/data/skills';
import {
  buildFantasyCardTemplateModel,
  buildSlotGlyphText,
  buildWeightPlateText,
} from '../../src/game/ui/fantasyCardTemplateModel';

describe('fantasy card template model', () => {
  it('builds a gold model with fixed slot display geometry', () => {
    const arcaneBolt = skillBook.arcane_bolt!;
    const model = buildFantasyCardTemplateModel(arcaneBolt, { tier: 'gold' });
    expect(model.size).toEqual({ width: 420, height: 690 });
    expect(model.tier).toBe('gold');
    expect(model.slotLabel).toBe('Slot');
    expect(model.slotBoxCount).toBe(arcaneBolt.size);
    expect(model.regions.artFrame).toEqual({ x: 0, y: 0, w: 420, h: 690 });
  });

  it('selects longer text rules without exposing layout overrides', () => {
    const fireball = skillBook.fireball!;
    const longTextSkill: SkillDef = {
      ...fireball,
      name: 'Extremely Long Mythic Fireball Name',
      text: 'Deal 20 (+Magic). Apply burn. Gain readiness. Draw a line of force through the entire lane.',
    };
    const model = buildFantasyCardTemplateModel(longTextSkill, { tier: 'diamond' });
    expect(model.titleRule).toBe('title-long');
    expect(model.bodyRule).toBe('body-4-line');
    expect(model.artAnchor).toBe('center');
  });

  it('uses weight-digit styles instead of weight offsets', () => {
    const fireball = skillBook.fireball!;
    const weightedFireball: SkillDef = { ...fireball, speedWeight: 125 };
    const model = buildFantasyCardTemplateModel(weightedFireball, { tier: 'bronze' });
    expect(model.wtRule).toBe('wt-3-digit');
    expect(model.weight).toBe(125);
  });

  it('exposes renderer data without per-card offsets', () => {
    const venomFang = skillBook.venom_fang!;
    const model = buildFantasyCardTemplateModel(venomFang, { tier: 'silver' });
    expect(model).not.toHaveProperty('imageOffsetX');
    expect(model).not.toHaveProperty('imageOffsetY');
    expect(model).not.toHaveProperty('titleOffsetX');
    expect(model.skin.tier).toBe('silver');
    expect(model.type.iconKey).toBeTruthy();
    expect(model.archetypes.length).toBeGreaterThan(0);
  });

  it('keeps slot box count and archetype stack independent from type badge', () => {
    const cripplingStrike = skillBook.crippling_strike!;
    const model = buildFantasyCardTemplateModel(cripplingStrike, { tier: 'bronze' });
    expect(model.slotLabel).toBe('Slot');
    expect(model.slotBoxCount).toBe(cripplingStrike.size);
    expect(model.type.label).toBe(cripplingStrike.weapon?.toUpperCase());
    expect(model.archetypes.map((entry) => entry.archetype)).toEqual(['offense', 'debuff']);
  });

  it('formats slot display as box glyph text', () => {
    expect(buildSlotGlyphText(1)).toBe('□');
    expect(buildSlotGlyphText(2)).toBe('□ □');
    expect(buildSlotGlyphText(3)).toBe('□ □ □');
  });

  it('formats weight plate text as the bare number (WT caption is renderer chrome)', () => {
    expect(buildWeightPlateText(8)).toBe('8');
    expect(buildWeightPlateText(26)).toBe('26');
  });
});
