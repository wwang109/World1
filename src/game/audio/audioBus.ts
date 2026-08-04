/**
 * Audio bus mixer — master → { music, sfx } gain chain over one shared
 * AudioContext. Talks to raw WebAudio (no Phaser dependency) so `sfxSynth`
 * and any future streamed-music player hang off the same nodes. Volumes are
 * stored in dB (converted to linear only at the GainNode edge) and persisted
 * to localStorage under `world1.audio` so settings survive reloads.
 *
 * Browsers refuse to start an AudioContext before a user gesture (autoplay
 * policy) — `installUnlock()` (called once from BootScene) arms a one-shot
 * pointerdown/keydown listener that resumes the context on the first
 * interaction. Every play path is a safe no-op until then.
 */

export interface AudioSettings {
  masterDb: number;
  musicDb: number;
  sfxDb: number;
  muted: boolean;
}

const STORAGE_KEY = 'world1.audio';
const DEFAULTS: AudioSettings = { masterDb: 0, musicDb: -6, sfxDb: 0, muted: false };

const dbToLinear = (db: number): number => Math.pow(10, db / 20);

let ctx: AudioContext | undefined;
let masterGain: GainNode | undefined;
let musicGain: GainNode | undefined;
let sfxGain: GainNode | undefined;
let settings: AudioSettings = { ...DEFAULTS };
let loaded = false;

function loadSettings(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) settings = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch { /* private mode / disabled storage — keep defaults */ }
}

function saveSettings(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

function applyGains(): void {
  if (!masterGain || !musicGain || !sfxGain) return;
  masterGain.gain.value = settings.muted ? 0 : dbToLinear(settings.masterDb);
  musicGain.gain.value = dbToLinear(settings.musicDb);
  sfxGain.gain.value = dbToLinear(settings.sfxDb);
}

/** The context + bus nodes, created lazily; undefined where WebAudio is
 * unavailable (SSR, very old browsers, vitest without a DOM). */
export function audioGraph(): { ctx: AudioContext; sfx: GainNode; music: GainNode } | undefined {
  loadSettings();
  if (!ctx) {
    const Ctor = typeof window !== 'undefined'
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
    if (!Ctor) return undefined;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.connect(masterGain);
    sfxGain = ctx.createGain();
    sfxGain.connect(masterGain);
    applyGains();
  }
  return ctx && sfxGain && musicGain ? { ctx, sfx: sfxGain, music: musicGain } : undefined;
}

/** True once the context is allowed to produce sound. */
export function audioUnlocked(): boolean {
  return ctx?.state === 'running';
}

/** Arm the one-shot unlock on the first user gesture. Idempotent. */
export function installUnlock(): void {
  if (typeof window === 'undefined') return;
  const unlock = (): void => {
    const graph = audioGraph();
    if (graph && graph.ctx.state === 'suspended') void graph.ctx.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function getAudioSettings(): AudioSettings {
  loadSettings();
  return { ...settings };
}

export function setAudioSettings(next: Partial<AudioSettings>): void {
  loadSettings();
  settings = { ...settings, ...next };
  applyGains();
  saveSettings();
}

export function toggleMute(): boolean {
  setAudioSettings({ muted: !settings.muted });
  return settings.muted;
}
