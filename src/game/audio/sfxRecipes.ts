import type { Archetype } from '../../engine/types';

/**
 * Placeholder SFX recipes — THE event-key vocabulary the whole game wires
 * sound through. Pure module (no Phaser, no WebAudio; unit-tested in
 * `tests/game/sfxRecipes.test.ts`) — same spec-driven idiom as
 * `battleFxSpec.ts`: scenes call `playSfx('<key>')` and never describe sound
 * themselves. Every recipe is fully procedural (synthesized by
 * `sfxSynth.ts`), so the game is audible today with zero binary assets;
 * swapping in real audio later means loading a file under the SAME key and
 * leaving every call site untouched (see `docs/audio-design.md`).
 *
 * Recipe rules (enforced by the test):
 *   - short and transient: ≤ 400ms, except the two fight-end stingers ≤ 1500ms
 *   - envelope fits inside the duration (attack + decay ≤ duration)
 *   - peak gain is never above the bus (gainDb ≤ 0)
 *   - repeats don't grate: every recipe carries a ±% pitch jitter
 *   - the five cast variants stay audibly distinct (pairwise different
 *     wave or >15% start-frequency spread)
 */
export interface SfxRecipe {
  /** Oscillator wave shape. */
  wave: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Pitch glide start/end in Hz (equal values = flat tone). */
  freqStart: number;
  freqEnd: number;
  /** Total length, ms. */
  durationMs: number;
  /** Envelope: linear ramp up over attack, exponential-ish fall over decay. */
  attackMs: number;
  decayMs: number;
  /** Peak gain in dB relative to the sfx bus (≤ 0). */
  gainDb: number;
  /** Optional white-noise burst at onset (impact texture), ms. */
  noiseMs?: number;
  /** ± percent random detune applied per play so repeats don't grate. */
  pitchJitterPct: number;
}

export type SfxKey =
  | 'uiClick' | 'uiBack'
  | `cast:${Archetype}`
  | 'hitPhysical' | 'hitMagical' | 'hitTrue'
  | 'heal' | 'shieldGain' | 'shieldBreak' | 'dotTick'
  | 'goldGain' | 'purchase' | 'levelUp'
  | 'victory' | 'defeat';

export const SFX_RECIPES: Record<SfxKey, SfxRecipe> = {
  // --- UI ------------------------------------------------------------
  uiClick: { wave: 'triangle', freqStart: 660, freqEnd: 880, durationMs: 70, attackMs: 5, decayMs: 60, gainDb: -10, pitchJitterPct: 4 },
  uiBack: { wave: 'triangle', freqStart: 520, freqEnd: 390, durationMs: 90, attackMs: 5, decayMs: 80, gainDb: -12, pitchJitterPct: 4 },

  // --- Card casts: one voice per archetype (mirrors battleFxSpec motion) --
  'cast:offense': { wave: 'sawtooth', freqStart: 220, freqEnd: 440, durationMs: 140, attackMs: 5, decayMs: 120, gainDb: -8, noiseMs: 30, pitchJitterPct: 6 },
  'cast:defensive': { wave: 'square', freqStart: 180, freqEnd: 150, durationMs: 220, attackMs: 40, decayMs: 160, gainDb: -10, pitchJitterPct: 4 },
  'cast:healing': { wave: 'sine', freqStart: 440, freqEnd: 660, durationMs: 280, attackMs: 80, decayMs: 180, gainDb: -10, pitchJitterPct: 5 },
  'cast:support': { wave: 'triangle', freqStart: 590, freqEnd: 640, durationMs: 240, attackMs: 30, decayMs: 200, gainDb: -12, pitchJitterPct: 8 },
  'cast:debuff': { wave: 'sawtooth', freqStart: 300, freqEnd: 140, durationMs: 260, attackMs: 20, decayMs: 220, gainDb: -12, pitchJitterPct: 7 },

  // --- Combat results --------------------------------------------------
  hitPhysical: { wave: 'square', freqStart: 160, freqEnd: 90, durationMs: 110, attackMs: 2, decayMs: 100, gainDb: -6, noiseMs: 45, pitchJitterPct: 8 },
  hitMagical: { wave: 'sawtooth', freqStart: 700, freqEnd: 240, durationMs: 140, attackMs: 2, decayMs: 130, gainDb: -8, noiseMs: 20, pitchJitterPct: 8 },
  hitTrue: { wave: 'sine', freqStart: 980, freqEnd: 980, durationMs: 120, attackMs: 2, decayMs: 110, gainDb: -8, pitchJitterPct: 3 },
  heal: { wave: 'sine', freqStart: 520, freqEnd: 780, durationMs: 200, attackMs: 40, decayMs: 150, gainDb: -11, pitchJitterPct: 5 },
  shieldGain: { wave: 'triangle', freqStart: 300, freqEnd: 420, durationMs: 160, attackMs: 30, decayMs: 120, gainDb: -11, pitchJitterPct: 5 },
  shieldBreak: { wave: 'square', freqStart: 420, freqEnd: 110, durationMs: 180, attackMs: 2, decayMs: 170, gainDb: -8, noiseMs: 70, pitchJitterPct: 8 },
  dotTick: { wave: 'sawtooth', freqStart: 240, freqEnd: 200, durationMs: 80, attackMs: 5, decayMs: 70, gainDb: -16, pitchJitterPct: 10 },

  // --- Run / economy ----------------------------------------------------
  goldGain: { wave: 'triangle', freqStart: 900, freqEnd: 1250, durationMs: 120, attackMs: 5, decayMs: 110, gainDb: -12, pitchJitterPct: 6 },
  purchase: { wave: 'triangle', freqStart: 750, freqEnd: 1000, durationMs: 170, attackMs: 5, decayMs: 150, gainDb: -11, pitchJitterPct: 5 },
  levelUp: { wave: 'sine', freqStart: 420, freqEnd: 840, durationMs: 380, attackMs: 20, decayMs: 320, gainDb: -9, pitchJitterPct: 3 },

  // --- Fight-end stingers (the two allowed long ones) --------------------
  victory: { wave: 'sine', freqStart: 392, freqEnd: 784, durationMs: 900, attackMs: 30, decayMs: 700, gainDb: -8, pitchJitterPct: 0 },
  defeat: { wave: 'sawtooth', freqStart: 220, freqEnd: 110, durationMs: 1100, attackMs: 60, decayMs: 900, gainDb: -10, pitchJitterPct: 0 },
};

/** Duration ceiling for everything except the fight-end stingers. */
export const SFX_MAX_MS = 400;
export const STINGER_MAX_MS = 1500;
export const STINGER_KEYS: readonly SfxKey[] = ['victory', 'defeat'];
