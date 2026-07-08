import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../../src/engine/rng';

describe('Rng', () => {
  it('produces identical sequences for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      expect(a.int(1_000_000)).toBe(b.int(1_000_000));
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 20 }, () => a.int(1_000_000));
    const seqB = Array.from({ length: 20 }, () => b.int(1_000_000));
    expect(seqA).not.toEqual(seqB);
  });

  it('int stays within bounds', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('pct(0) is never true and pct(100) is always true', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      expect(rng.pct(0)).toBe(false);
      expect(rng.pct(100)).toBe(true);
    }
  });
});

describe('hashSeed', () => {
  it('is stable for the same inputs', () => {
    expect(hashSeed('run', 42, 'map')).toBe(hashSeed('run', 42, 'map'));
  });

  it('differs across part boundaries', () => {
    expect(hashSeed('ab', 'c')).not.toBe(hashSeed('a', 'bc'));
    expect(hashSeed('map', 1)).not.toBe(hashSeed('map', 2));
  });
});
