import { describe, expect, it } from 'vitest';
import { battleApiBaseUrl } from '../../src/game/battleApi';

describe('battleApiBaseUrl', () => {
  it('uses the page hostname in development so another device can reach the battle service', () => {
    expect(battleApiBaseUrl(undefined, true, '192.168.1.42')).toBe('http://192.168.1.42:8787');
  });

  it('falls back to localhost when no browser hostname is available', () => {
    expect(battleApiBaseUrl(undefined, true, undefined)).toBe('http://localhost:8787');
    expect(battleApiBaseUrl(undefined, true, '')).toBe('http://localhost:8787');
  });

  it('keeps production same-origin and honors an explicit service override', () => {
    expect(battleApiBaseUrl(undefined, false, 'example.test')).toBe('');
    expect(battleApiBaseUrl('https://battle.example.test', true, '192.168.1.42'))
      .toBe('https://battle.example.test');
  });
});
