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
});
