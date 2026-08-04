import { audioGraph, audioUnlocked, getAudioSettings } from './audioBus';
import { SFX_RECIPES, type SfxKey, type SfxRecipe } from './sfxRecipes';

/**
 * Procedural SFX playback — renders an `SfxRecipe` through the sfx bus:
 * one oscillator with a pitch glide and an attack/decay gain envelope, plus
 * an optional white-noise onset burst for impact texture. Everything is
 * fire-and-forget and self-stopping; nodes disconnect when done. Safe no-op
 * before the autoplay unlock, when muted, or where WebAudio is unavailable —
 * so call sites never need to guard.
 *
 * Placeholder by design: when real assets land, `playSfx` keeps its
 * signature and plays the loaded file for keys that have one, falling back
 * to the recipe for keys that don't (see docs/audio-design.md).
 */
export function playSfx(key: SfxKey): void {
  if (getAudioSettings().muted || !audioUnlocked()) return;
  const graph = audioGraph();
  if (!graph) return;
  renderRecipe(graph.ctx, graph.sfx, SFX_RECIPES[key]);
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
