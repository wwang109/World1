import type { Archetype, Element, WeaponType } from '../../engine/types';
import type { StatusName } from '../../engine/combat/events';

// THE event-key vocabulary every scene wires sound through — see docs/audio-design.md.
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
  | `hit:${Element}` | `hit:${WeaponType}`
  | 'heal' | 'shieldGain' | 'shieldBreak' | 'dotTick'
  | `status:${StatusName}`
  | 'died' | 'phase' | 'negated' | 'warded'
  | 'dragPick' | 'dragDrop' | 'sell'
  | 'goldGain' | 'purchase' | 'levelUp'
  | 'victory' | 'defeat' | 'runWin' | 'runLose';

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

  'hit:fire': { wave: 'sawtooth', freqStart: 480, freqEnd: 180, durationMs: 140, attackMs: 2, decayMs: 130, gainDb: -8, noiseMs: 40, pitchJitterPct: 8 },
  'hit:frost': { wave: 'sine', freqStart: 1100, freqEnd: 650, durationMs: 150, attackMs: 3, decayMs: 140, gainDb: -9, pitchJitterPct: 5 },
  'hit:lightning': { wave: 'square', freqStart: 1400, freqEnd: 300, durationMs: 90, attackMs: 1, decayMs: 85, gainDb: -8, noiseMs: 15, pitchJitterPct: 6 },
  'hit:nature': { wave: 'triangle', freqStart: 380, freqEnd: 520, durationMs: 150, attackMs: 10, decayMs: 130, gainDb: -10, pitchJitterPct: 6 },
  'hit:holy': { wave: 'sine', freqStart: 600, freqEnd: 900, durationMs: 160, attackMs: 15, decayMs: 140, gainDb: -9, pitchJitterPct: 4 },
  'hit:dark': { wave: 'sawtooth', freqStart: 220, freqEnd: 90, durationMs: 170, attackMs: 5, decayMs: 160, gainDb: -8, noiseMs: 30, pitchJitterPct: 7 },

  'hit:sword': { wave: 'square', freqStart: 900, freqEnd: 400, durationMs: 110, attackMs: 1, decayMs: 105, gainDb: -8, noiseMs: 20, pitchJitterPct: 6 },
  'hit:axe': { wave: 'sawtooth', freqStart: 260, freqEnd: 120, durationMs: 150, attackMs: 2, decayMs: 140, gainDb: -7, noiseMs: 55, pitchJitterPct: 7 },
  'hit:lance': { wave: 'triangle', freqStart: 1200, freqEnd: 900, durationMs: 100, attackMs: 1, decayMs: 95, gainDb: -9, pitchJitterPct: 5 },
  'hit:bow': { wave: 'sine', freqStart: 700, freqEnd: 1050, durationMs: 90, attackMs: 1, decayMs: 85, gainDb: -9, pitchJitterPct: 6 },
  'hit:beast': { wave: 'square', freqStart: 150, freqEnd: 80, durationMs: 160, attackMs: 3, decayMs: 150, gainDb: -7, noiseMs: 45, pitchJitterPct: 9 },

  'status:poison': { wave: 'sawtooth', freqStart: 220, freqEnd: 160, durationMs: 130, attackMs: 8, decayMs: 115, gainDb: -13, pitchJitterPct: 8 },
  'status:burn': { wave: 'sawtooth', freqStart: 400, freqEnd: 260, durationMs: 130, attackMs: 3, decayMs: 120, gainDb: -12, noiseMs: 30, pitchJitterPct: 8 },
  'status:bleed': { wave: 'square', freqStart: 340, freqEnd: 200, durationMs: 90, attackMs: 2, decayMs: 85, gainDb: -13, pitchJitterPct: 8 },
  'status:stun': { wave: 'square', freqStart: 1300, freqEnd: 1300, durationMs: 70, attackMs: 1, decayMs: 65, gainDb: -9, pitchJitterPct: 3 },
  'status:buff': { wave: 'sine', freqStart: 500, freqEnd: 760, durationMs: 170, attackMs: 20, decayMs: 145, gainDb: -11, pitchJitterPct: 4 },
  'status:debuff': { wave: 'sawtooth', freqStart: 460, freqEnd: 260, durationMs: 170, attackMs: 10, decayMs: 155, gainDb: -12, pitchJitterPct: 6 },
  'status:guard': { wave: 'triangle', freqStart: 260, freqEnd: 340, durationMs: 150, attackMs: 25, decayMs: 120, gainDb: -11, pitchJitterPct: 4 },
  'status:negate': { wave: 'square', freqStart: 200, freqEnd: 200, durationMs: 90, attackMs: 2, decayMs: 85, gainDb: -10, pitchJitterPct: 3 },
  'status:expose': { wave: 'sawtooth', freqStart: 520, freqEnd: 300, durationMs: 150, attackMs: 5, decayMs: 140, gainDb: -12, noiseMs: 20, pitchJitterPct: 7 },
  'status:thorns': { wave: 'triangle', freqStart: 850, freqEnd: 650, durationMs: 100, attackMs: 1, decayMs: 95, gainDb: -10, pitchJitterPct: 5 },
  'status:ward': { wave: 'sine', freqStart: 620, freqEnd: 940, durationMs: 190, attackMs: 25, decayMs: 160, gainDb: -11, pitchJitterPct: 4 },

  died: { wave: 'sawtooth', freqStart: 300, freqEnd: 60, durationMs: 340, attackMs: 5, decayMs: 320, gainDb: -8, noiseMs: 40, pitchJitterPct: 3 },
  phase: { wave: 'triangle', freqStart: 220, freqEnd: 440, durationMs: 380, attackMs: 60, decayMs: 300, gainDb: -9, pitchJitterPct: 0 },
  negated: { wave: 'square', freqStart: 500, freqEnd: 500, durationMs: 60, attackMs: 1, decayMs: 55, gainDb: -8, noiseMs: 15, pitchJitterPct: 3 },
  warded: { wave: 'sine', freqStart: 700, freqEnd: 1050, durationMs: 170, attackMs: 20, decayMs: 145, gainDb: -10, pitchJitterPct: 4 },

  dragPick: { wave: 'triangle', freqStart: 500, freqEnd: 560, durationMs: 60, attackMs: 3, decayMs: 55, gainDb: -12, pitchJitterPct: 5 },
  dragDrop: { wave: 'sine', freqStart: 340, freqEnd: 260, durationMs: 100, attackMs: 5, decayMs: 90, gainDb: -11, pitchJitterPct: 5 },
  sell: { wave: 'triangle', freqStart: 850, freqEnd: 1150, durationMs: 140, attackMs: 5, decayMs: 130, gainDb: -12, pitchJitterPct: 6 },

  // --- Run / economy ----------------------------------------------------
  goldGain: { wave: 'triangle', freqStart: 900, freqEnd: 1250, durationMs: 120, attackMs: 5, decayMs: 110, gainDb: -12, pitchJitterPct: 6 },
  purchase: { wave: 'triangle', freqStart: 750, freqEnd: 1000, durationMs: 170, attackMs: 5, decayMs: 150, gainDb: -11, pitchJitterPct: 5 },
  levelUp: { wave: 'sine', freqStart: 420, freqEnd: 840, durationMs: 380, attackMs: 20, decayMs: 320, gainDb: -9, pitchJitterPct: 3 },

  // --- Fight-end stingers ------------------------------------------------
  victory: { wave: 'sine', freqStart: 392, freqEnd: 784, durationMs: 900, attackMs: 30, decayMs: 700, gainDb: -8, pitchJitterPct: 0 },
  defeat: { wave: 'sawtooth', freqStart: 220, freqEnd: 110, durationMs: 1100, attackMs: 60, decayMs: 900, gainDb: -10, pitchJitterPct: 0 },

  runWin: { wave: 'sine', freqStart: 440, freqEnd: 880, durationMs: 360, attackMs: 20, decayMs: 320, gainDb: -8, pitchJitterPct: 0 },
  runLose: { wave: 'sawtooth', freqStart: 260, freqEnd: 130, durationMs: 360, attackMs: 20, decayMs: 320, gainDb: -9, pitchJitterPct: 0 },
};

/** Duration ceiling for everything except STINGER_KEYS. */
export const SFX_MAX_MS = 400;
export const STINGER_MAX_MS = 1500;
export const STINGER_KEYS: readonly SfxKey[] = ['victory', 'defeat', 'runWin', 'runLose', 'levelUp'];
