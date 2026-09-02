import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import {
  keywordTextColor,
  markedKeywords,
  parseCardTextMarkup,
  stripCardTextMarkup,
} from '../../src/game/ui/cardTextMarkup';

describe('card text keyword markup', () => {
  it('parses {{keyword}} tokens into styled segments', () => {
    const segments = parseCardTextMarkup('Deal 12 damage · {{Poison}} 5 (3 turns).');
    expect(segments).toEqual([
      { text: 'Deal 12 damage · ' },
      { text: 'Poison', keyword: 'poison' },
      { text: ' 5 (3 turns).' },
    ]);
  });

  it('strips markup for plain renderers', () => {
    expect(stripCardTextMarkup('{{Negate}} the next 2 magical attacks.')).toBe('Negate the next 2 magical attacks.');
    expect(stripCardTextMarkup('no markup at all')).toBe('no markup at all');
  });

  it('lists marked keywords lowercased and deduplicated', () => {
    expect(markedKeywords('{{Burn}} then {{burn}} then {{Poison}}')).toEqual(['burn', 'poison']);
  });

  it('has a semantic color for every keyword used in the card data', () => {
    for (const skill of Object.values(skillBook)) {
      for (const keyword of markedKeywords(skill.text)) {
        expect(keywordTextColor(keyword), `missing color for {{${keyword}}} in ${skill.id}`).toBeTruthy();
      }
    }
  });

  // poison/thorns/expose used to be a DIFFERENT COLOR FAMILY than the battle
  // scenes' own ailment palette (purple-vs-green, olive-vs-teal, pink-vs-
  // purple) — a card highlighting "poison" in purple applies a status that
  // tints the HP bar green. These three hex values are pinned to the battle
  // scenes' `AILMENT_COLOR`/`AILMENT_TINT` (MobileBattleScene.ts /
  // DesktopBattleScene.ts, off-limits to this file — copied here as literals,
  // not imported, because those scenes import Phaser and this module must
  // not) so the two palettes can never drift apart silently again.
  // Values re-pinned 2026-09-02: the keyword palette's AA lift (every entry
  // >= 4.5:1 on both battle card fills — see cardTextMarkup.ts) moved all
  // three IN LOCKSTEP with both scenes' maps, exactly the drift-in-unison
  // this pin exists to force. Anyone changing one side must change all four
  // places or this test names the traitor.
  it('matches the battle scenes\' ailment palette for poison/thorns/expose', () => {
    expect(keywordTextColor('poison')).toBe('#92c05f');
    expect(keywordTextColor('thorns')).toBe('#68c3a0');
    expect(keywordTextColor('expose')).toBe('#c4a6e5');
  });
});
