import { describe, expect, it } from 'vitest';
import { gemBook } from '../../src/data/gems';
import { gemChipLines, gemHoverEntry } from '../../src/game/ui/gemGlossary';
import { stripCardTextMarkup } from '../../src/game/ui/cardTextMarkup';

/**
 * THE MOBILE GEM PICKER SHOWED NO INFORMATION ABOUT THE GEMS (2026-08-30).
 *
 * "PICK ONE TO KEEP" offered `Ripple Sliver` / `Opening Sliver` /
 * `Judgment Sliver` — a coloured diamond and a name, and nothing else. No
 * effect, no rarity, no stats, anywhere on the screen. The text was not
 * missing from the game: the shop shelf prints the same gem's effect verbatim,
 * and the picker itself built a full `gemHoverEntry` tooltip — but wired it
 * behind `template.platform === 'desktop'`. A phone has no hover, so the phone
 * got the empty version of an IRREVERSIBLE choice.
 *
 * `gemChipLines` is now the chip's content, on both platforms. These tests
 * hold two things: that it says something real for every gem in the book, and
 * that it says the SAME thing the desktop tooltip says — the failure mode this
 * replaces was two surfaces disagreeing about how much a player is told.
 */
describe('gemChipLines: what a gem chip tells the player', () => {
  const gems = Object.values(gemBook);

  it('the book is non-empty (this suite must not be vacuous)', () => {
    expect(gems.length).toBeGreaterThan(10);
  });

  it('every gem has a name, a rarity+kind line, and an EFFECT line — none blank', () => {
    for (const gem of gems) {
      const lines = gemChipLines(gem);
      expect(lines.name, gem.name).toBe(gem.name);
      expect(lines.meta.length, `${gem.name} meta`).toBeGreaterThan(0);
      expect(lines.effect.trim().length, `${gem.name} effect`).toBeGreaterThan(0);
    }
  });

  it('the effect line is the gem\'s own text with markup stripped — never raw {{Braces}}', () => {
    for (const gem of gems) {
      const lines = gemChipLines(gem);
      expect(lines.effect, gem.name).toBe(stripCardTextMarkup(gem.text));
      expect(lines.effect, gem.name).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('names the rarity in the SAME words the hover tip does', () => {
    // The hover tip's title is "<name> — RARITY"; the chip's meta line leads
    // with that same rarity word. If either changes wording, this fails rather
    // than letting a phone and a mouse be told different things.
    for (const gem of gems) {
      const tip = gemHoverEntry(gem);
      expect(tip.title, gem.name).toContain(gem.rarity.toUpperCase());
      expect(gemChipLines(gem).meta, gem.name).toContain(gem.rarity.toUpperCase());
    }
  });

  it('names the KIND the same way the hover tip does — stat mod vs effect rider', () => {
    for (const gem of gems) {
      const expected = gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT RIDER';
      expect(gemChipLines(gem).meta, gem.name).toContain(expected);
      // The tip spells it in sentence case ("Stat mod." / "Effect rider.");
      // the chip is a small-caps meta row. Same fact, same source field.
      expect(gemHoverEntry(gem).body.toUpperCase(), gem.name).toContain(expected);
    }
  });

  it('the chip carries the hover tip\'s whole effect body — nothing is desktop-only', () => {
    // This is the actual regression: the tooltip body is
    // "<Kind>. <stripped text>", and the chip's two rows must together cover
    // it. If a future edit trims the chip back to a name, this fails.
    for (const gem of gems) {
      const lines = gemChipLines(gem);
      expect(gemHoverEntry(gem).body, gem.name).toContain(lines.effect);
    }
  });

  it('the three gems from the reported screenshot each say what they do', () => {
    for (const id of ['ripple_sliver', 'opening_sliver', 'judgment_light_echo']) {
      const gem = gemBook[id];
      expect(gem, `gem "${id}" is gone from the book`).toBeDefined();
      const lines = gemChipLines(gem!);
      expect(lines.effect.length, id).toBeGreaterThan(10);
      expect(lines.meta, id).toMatch(/^(COMMON|RARE|EPIC|LEGENDARY) · (STAT MOD|EFFECT RIDER)$/);
    }
  });
});
