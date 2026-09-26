import { audioGraph, audioUnlocked, getAudioSettings, onAudioUnlock } from './audioBus';
import { SFX_FILES } from './sfxAssets';
import { SFX_RECIPES, type SfxKey, type SfxRecipe } from './sfxRecipes';

const buffers: Partial<Record<SfxKey, AudioBuffer>> = {};
let prefetchStarted = false;

function prefetchSfxFiles(): void {
  if (prefetchStarted || typeof fetch === 'undefined') return;
  const graph = audioGraph();
  if (!graph) return;
  prefetchStarted = true;
  for (const [key, path] of Object.entries(SFX_FILES) as Array<[SfxKey, string]>) {
    void fetch(path)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => graph.ctx.decodeAudioData(data))
      .then((buffer) => { buffers[key] = buffer; })
      .catch(() => { /* recipe fallback */ });
  }
}

onAudioUnlock(prefetchSfxFiles);

/** Plays the decoded file for `key` when it has one, else its procedural
 * recipe (docs/audio-design.md). Safe no-op before unlock, muted, or without
 * WebAudio, so call sites never guard. */
export function playSfx(key: SfxKey): void {
  if (getAudioSettings().muted || !audioUnlocked()) return;
  const graph = audioGraph();
  if (!graph) return;
  prefetchSfxFiles();
  const recipe = SFX_RECIPES[key];
  const buffer = buffers[key];
  try {
    if (buffer) {
      playBuffer(graph.ctx, graph.sfx, buffer, recipe.pitchJitterPct);
      return;
    }
  } catch { /* recipe fallback */ }
  renderRecipe(graph.ctx, graph.sfx, recipe);
}

function playBuffer(ctx: AudioContext, bus: GainNode, buffer: AudioBuffer, jitterPct: number): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * (jitterPct / 100);
  src.connect(bus);
  src.onended = () => { src.disconnect(); };
  src.start();
}

function renderRecipe(ctx: AudioContext, bus: GainNode, r: SfxRecipe): void {
  const now = ctx.currentTime;
  const dur = r.durationMs / 1000;
  const attack = r.attackMs / 1000;
  const decayStart = Math.max(attack, dur - r.decayMs / 1000);
  const peak = Math.pow(10, r.gainDb / 20);
  // ± jitter so rapid repeats (multi-hit turns) don't grate.
  const jitter = 1 + (Math.random() * 2 - 1) * (r.pitchJitterPct / 100);

  const osc = ctx.createOscillator();
  osc.type = r.wave;
  osc.frequency.setValueAtTime(Math.max(1, r.freqStart * jitter), now);
  // Exponential glides sound natural for pitch; target must stay > 0.
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, r.freqEnd * jitter), now + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + attack);
  env.gain.setValueAtTime(peak, now + decayStart);
  // exponentialRamp can't reach 0 — land near silence, then hard-zero.
  env.gain.exponentialRampToValueAtTime(peak * 0.001, now + dur);
  env.gain.setValueAtTime(0, now + dur);

  osc.connect(env);
  env.connect(bus);
  osc.start(now);
  osc.stop(now + dur);
  osc.onended = () => { osc.disconnect(); env.disconnect(); };

  if (r.noiseMs && r.noiseMs > 0) {
    const noiseDur = Math.min(r.noiseMs, r.durationMs) / 1000;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * noiseDur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(peak * 0.7, now);
    noiseEnv.gain.exponentialRampToValueAtTime(peak * 0.001, now + noiseDur);
    noise.connect(noiseEnv);
    noiseEnv.connect(bus);
    noise.start(now);
    noise.stop(now + noiseDur);
    noise.onended = () => { noise.disconnect(); noiseEnv.disconnect(); };
  }
}
