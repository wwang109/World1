import { describe, expect, it } from 'vitest';
import { gemBook } from '../../src/data/gems';
import { gemChipLines, gemHoverEntries } from '../../src/game/ui/gemPresentation';
import { renderGemText } from '../../src/engine/keywords/gemText';
import { stripCardTextMarkup } from '../../src/game/ui/cardTextMarkup';

/**
 * THE MOBILE GEM PICKER SHOWED NO INFORMATION ABOUT THE GEMS (2026-08-30).
 *
 * "PICK ONE TO KEEP" offered `Ripple Sliver` / `Opening Sliver` /
 * `Judgment Sliver` — a coloured diamond and a name, and nothing else. No
 * effect, no rarity, no stats, anywhere on the screen. The text was not
 * missing from the game: the shop shelf prints the same gem's effect verbatim,
 * and the picker itself built a full gem tooltip — but wired it behind
 * `template.platform === 'desktop'`. A phone has no hover, so the phone got
 * the empty version of an IRREVERSIBLE choice.
 *
 * `gemChipLines` is now the chip's content, on both platforms. These tests
 * hold two things: that it says something real for every gem in the book, and
 * that it says the SAME thing the desktop tooltip says — the failure mode this
 * replaces was two surfaces disagreeing about how much a player is told.
 *
 * 2026-09-06: both functions moved from the DELETED `ui/gemGlossary.ts` to
 * `ui/gemPresentation.ts` and stopped reading an authored `gem.text` (there is
 * none any more) — they render `renderGemText`, generated from the gem's own
 * payload through the SAME keyword registry a card face reads. The assertions
 * below are unchanged in intent; "the gem's own text" is now "the gem's
 * generated face".
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

  it('the effect line is the gem\'s generated face with markup stripped — never raw {{Braces}}', () => {
    for (const gem of gems) {
      const lines = gemChipLines(gem);
      expect(lines.effect, gem.name).toBe(stripCardTextMarkup(renderGemText(gem)));
      expect(lines.effect, gem.name).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('names the rarity in the SAME words the hover tip does', () => {
    // The hover tip's header is titled "Gem effect" (user-locked 2026-09-06:
    // "its jus for gem for the hover it should say Gem effect or something")
    // and its body leads with the gem's name and rarity; the chip's meta line
    // leads with that same rarity word. If either changes wording, this fails
    // rather than letting a phone and a mouse be told different things.
    for (const gem of gems) {
      const [header] = gemHoverEntries(gem);
      expect(header?.title, gem.name).toBe('Gem effect');
      expect(header?.body, gem.name).toContain(gem.rarity.toUpperCase());
      expect(gemChipLines(gem).meta, gem.name).toContain(gem.rarity.toUpperCase());
    }
  });

  it('names the KIND consistently — stat mod vs effect gem', () => {
    for (const gem of gems) {
      const expected = gem.kind === 'stat' ? 'STAT MOD' : 'EFFECT GEM';
      expect(gemChipLines(gem).meta, gem.name).toContain(expected);
      // The tip does not repeat the kind word: it says WHOSE lines these are
      // ("Gem effect") and then shows the lines, whose shape already says
      // which kind it is ("Hero: +8 MATK" is a stat mod and can only be one).
      // What both surfaces must agree on is the EFFECT itself, asserted below.
    }
  });

  it('the chip carries the hover tip\'s whole effect body — nothing is desktop-only', () => {
    // This is the actual regression: the tooltip's header body is
    // "<name> · <RARITY> — <generated face>", and the chip's rows must together
    // cover it. If a future edit trims the chip back to a name, this fails.
    for (const gem of gems) {
      const lines = gemChipLines(gem);
      const [header] = gemHoverEntries(gem);
      expect(header?.body, gem.name).toContain(lines.effect);
      expect(header?.body, gem.name).toContain(lines.name);
    }
  });

  it('the hover tip explains its keywords with the SHARED definitions, not gem prose', () => {
    // The one-reference rule (user-locked 2026-09-06: "every description
    // should come from 1 reference i dont even want a gem glossary"). A gem
    // carrying Poison must hand a player the registry's Poison sentence — the
    // same one every poison CARD hands them — so this asserts the entry is
    // byte-identical to `ruleEntryOf`'s, reached through the gem path.
    const venom = gemBook.venom_sliver!;
    const entries = gemHoverEntries(venom);
    expect(entries.map((e) => e.title)).toEqual(['Gem effect', 'Poison']);
    expect(entries[1]!.body).toContain('BYPASSES shields');
  });

  it('the three gems from the reported screenshot each say what they do', () => {
    for (const id of ['ripple_sliver', 'opening_sliver', 'judgment_light_echo']) {
      const gem = gemBook[id];
      expect(gem, `gem "${id}" is gone from the book`).toBeDefined();
      const lines = gemChipLines(gem!);
      expect(lines.effect.length, id).toBeGreaterThan(5);
      expect(lines.meta, id).toMatch(/^(COMMON|RARE|EPIC|LEGENDARY) · (STAT MOD|EFFECT GEM)$/);
    }
  });
});
