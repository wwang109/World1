import { describe, expect, it } from 'vitest';
import { SFX_MAX_MS, SFX_RECIPES, STINGER_KEYS, STINGER_MAX_MS, type SfxKey } from '../../src/game/audio/sfxRecipes';

const keys = Object.keys(SFX_RECIPES) as SfxKey[];
const CAST_KEYS = keys.filter((k) => k.startsWith('cast:'));

describe('sfxRecipes: the audio event-key vocabulary', () => {
  it('covers every archetype with a cast variant', () => {
    expect(CAST_KEYS.sort()).toEqual(['cast:debuff', 'cast:defensive', 'cast:healing', 'cast:offense', 'cast:support']);
  });

  it('every recipe is complete and within bounds', () => {
    for (const key of keys) {
      const r = SFX_RECIPES[key];
      const maxMs = STINGER_KEYS.includes(key) ? STINGER_MAX_MS : SFX_MAX_MS;
      expect(r.durationMs, key).toBeGreaterThan(0);
      expect(r.durationMs, key).toBeLessThanOrEqual(maxMs);
      expect(r.attackMs + r.decayMs, `${key} envelope fits`).toBeLessThanOrEqual(r.durationMs);
      expect(r.gainDb, `${key} never above bus`).toBeLessThanOrEqual(0);
      expect(r.freqStart, key).toBeGreaterThan(0);
      expect(r.freqEnd, key).toBeGreaterThan(0);
      expect(r.pitchJitterPct, key).toBeGreaterThanOrEqual(0);
      expect(r.pitchJitterPct, key).toBeLessThanOrEqual(15);
      if (r.noiseMs !== undefined) {
        expect(r.noiseMs, key).toBeGreaterThan(0);
        expect(r.noiseMs, key).toBeLessThanOrEqual(r.durationMs);
      }
    }
  });

  it('the five cast variants are audibly distinct (wave or >15% start-pitch spread)', () => {
    for (let i = 0; i < CAST_KEYS.length; i++) {
      for (let j = i + 1; j < CAST_KEYS.length; j++) {
        const a = SFX_RECIPES[CAST_KEYS[i]!];
        const b = SFX_RECIPES[CAST_KEYS[j]!];
        const pitchSpread = Math.abs(a.freqStart - b.freqStart) / Math.min(a.freqStart, b.freqStart);
        expect(
          a.wave !== b.wave || pitchSpread > 0.15,
          `${CAST_KEYS[i]} vs ${CAST_KEYS[j]}`,
        ).toBe(true);
      }
    }
  });

  it('fight-end stingers carry no jitter (they are one-shot signatures)', () => {
    for (const key of STINGER_KEYS) expect(SFX_RECIPES[key].pitchJitterPct).toBe(0);
  });
});
