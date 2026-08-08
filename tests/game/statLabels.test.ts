import { describe, expect, it } from 'vitest';
import { gemStatSuffix, STAT_KEYS, STAT_LONG_NAME, STAT_TOKEN } from '../../src/game/ui/statLabels';
import { STAT_LABELS, statHoverEntry } from '../../src/game/ui/statGlossary';

describe('statLabels — the single canonical source of stat tokens', () => {
  it('matches the locked stat model: HP, ATK, MATK, DEF, MDEF, SPD', () => {
    expect(STAT_TOKEN).toEqual({
      maxHp: 'HP',
      attack: 'ATK',
      magicPower: 'MATK',
      armor: 'DEF',
      magicResist: 'MDEF',
      speed: 'SPD',
    });
  });

  it('every canonical key has both a token and a long-form name', () => {
    for (const key of STAT_KEYS) {
      expect(STAT_TOKEN[key]).toBeTruthy();
      expect(STAT_LONG_NAME[key]).toBeTruthy();
    }
  });

  it('never reintroduces a retired synonym (MAG/RES/ARM) for magicPower/magicResist/armor', () => {
    const tokens = Object.values(STAT_TOKEN);
    expect(tokens).not.toContain('MAG');
    expect(tokens).not.toContain('RES');
    expect(tokens).not.toContain('ARM');
  });

  describe('statGlossary — keyed by the canonical tokens, not a synonym', () => {
    it('STAT_LABELS is exactly STAT_KEYS mapped through STAT_TOKEN, in order', () => {
      expect(STAT_LABELS).toEqual(STAT_KEYS.map((k) => STAT_TOKEN[k]));
    });

    it('every canonical token resolves to its own glossary entry (not the generic fallback)', () => {
      for (const token of Object.values(STAT_TOKEN)) {
        const entry = statHoverEntry(token);
        expect(entry.body).not.toBe('A combat stat.');
        expect(entry.title).toContain(token);
      }
    });

    it('is case-insensitive and falls back gracefully for an unknown label', () => {
      expect(statHoverEntry('atk').title).toBe(statHoverEntry('ATK').title);
      expect(statHoverEntry('WEIRD')).toEqual({ title: 'WEIRD', body: 'A combat stat.' });
    });
  });
});

describe('gemStatSuffix — the hero-scope stat gem "(+N)" attribution (task 39 item 2)', () => {
  it('renders " (+N)" for a stat a gem bumps', () => {
    expect(gemStatSuffix('attack', { attack: 4 })).toBe(' (+4)');
  });

  it('is empty for a stat with no gem contribution (undefined or zero)', () => {
    expect(gemStatSuffix('attack', {})).toBe('');
    expect(gemStatSuffix('attack', { attack: 0 })).toBe('');
    expect(gemStatSuffix('speed', { attack: 4 })).toBe('');
  });

  it('maxHp never gets a suffix — no gem can target it (BuffableStat excludes maxHp)', () => {
    expect(gemStatSuffix('maxHp', { attack: 4 })).toBe('');
  });
});
