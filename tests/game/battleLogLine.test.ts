import { describe, expect, it } from 'vitest';
import { fitBattleLogSegments } from '../../src/game/ui/battleLogLine';

describe('battleLogLine', () => {
  it('truncates the semantic stream as one row and keeps the ellipsis on the final visible role', () => {
    const fitted = fitBattleLogSegments([
      { text: 'Hero', role: 'player' },
      { text: ' fights ', role: 'neutral' },
      { text: 'An Extremely Long Enemy', role: 'enemy' },
    ], 14, (text) => text.length);

    expect(fitted).toEqual([
      { text: 'Hero', role: 'player' },
      { text: ' fights ', role: 'neutral' },
      { text: 'A…', role: 'enemy' },
    ]);
    expect(fitted.map((segment) => segment.text).join('')).toBe('Hero fights A…');
  });

  it('does not add an ellipsis or alter roles when the row fits', () => {
    const segments = [
      { text: 'Hero ', role: 'player' as const },
      { text: '+8 HP', role: 'heal' as const },
    ];
    expect(fitBattleLogSegments(segments, 20, (text) => text.length)).toEqual(segments);
  });
});
