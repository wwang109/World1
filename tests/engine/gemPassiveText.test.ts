import { describe, expect, it } from 'vitest';
import { gemBook } from '../../src/data/gems';
import { renderGemText } from '../../src/engine/keywords/gemText';
import { gemChipLines, gemHoverEntries } from '../../src/game/ui/gemPresentation';

describe('always-on gem modifier labels', () => {
  it('labels the actual Swift Charm passive through the canonical text and both UI consumers', () => {
    const gem = gemBook.swift_charm!;
    expect(renderGemText(gem)).toBe('Passive: +4 SPD.');
    expect(gemChipLines(gem).effect).toBe('Passive: +4 SPD.');
    expect(gemHoverEntries(gem)[0]!.body).toBe('Swift Charm · COMMON — Passive: +4 SPD.');
  });
  it('keeps signed and multi-stat permanent hero values in canonical order', () => {
    expect(renderGemText({ id: 'signed-hero-mods', kind: 'stat', rarity: 'common', scope: 'hero',
      mods: { hero: { speed: -2, attack: 4, magicPower: 8 } },
    })).toBe('Passive: +4 ATK · +8 MATK · -2 SPD.');
  });
  it('keeps card-only damage, healing and negative Weight scope explicit', () => {
    expect(renderGemText(gemBook.war_banner_echo!)).toBe('Passive (this card): +4 damage.');
    expect(renderGemText(gemBook.restorative_core!)).toBe('Passive (this card): +8 healing.');
    expect(renderGemText(gemBook.lightweight_core!)).toBe('Passive (this card): -2 weight.');
  });
  it('does not label triggered or duration-based effects passive', () => {
    expect(renderGemText(gemBook.sanctuary_sliver!)).toBe('{{Ward}} 1 · +5% DEF (2t).');
    expect(renderGemText(gemBook.resonant_echo!)).toBe('Echo 1/2 · +25% weight.');
    for (const gem of Object.values(gemBook)) {
      expect(renderGemText(gem).startsWith('Passive'), gem.id).toBe(gem.kind === 'stat');
    }
  });
});
