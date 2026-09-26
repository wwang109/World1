// audio-src/<stem>.* -> public/game-audio/<stem>.ogg (docs/audio-design.md). --force re-encodes all.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { SFX_MAX_MS, SFX_RECIPES, STINGER_KEYS, STINGER_MAX_MS, type SfxKey } from '../src/game/audio/sfxRecipes';
import { SFX_AUDIO_DIR, SFX_FILES, sfxFileStem } from '../src/game/audio/sfxAssets';

const SRC_DIR = 'audio-src';
const OUT_DIR = join('public', SFX_AUDIO_DIR);
const MASTER_EXTS = ['.flac', '.ogg', '.wav', '.aif', '.aiff', '.mp3'];
const SAMPLE_RATE = 44100;
const VORBIS_QUALITY = 4;
const LEAD_SILENCE_DB = -40;
const TAIL_SILENCE_DB = -55;
const REFERENCE_MEAN_DB = -10;
const PEAK_CEILING_DB = -1;
const FADE_OUT_MS = 30;
const TRUNCATION_FADE_MS = 120;

const force = process.argv.includes('--force');

function resolveFfmpeg(): { bin: string; source: string } {
  const onPath = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (onPath.status === 0) return { bin: 'ffmpeg', source: 'ffmpeg on PATH' };
  if (ffmpegStatic && existsSync(ffmpegStatic)) return { bin: ffmpegStatic, source: 'ffmpeg-static' };
  throw new Error('encode-audio: no ffmpeg on PATH and ffmpeg-static binary missing (npm install)');
}

const { bin: FFMPEG, source: FFMPEG_SOURCE } = resolveFfmpeg();

function ffmpeg(args: string[]): string {
  const res = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg failed (${args.join(' ')}):\n${res.stderr}`);
  return res.stderr;
}

const TRIM =
  `aformat=channel_layouts=mono,` +
  `silenceremove=start_periods=1:start_threshold=${LEAD_SILENCE_DB}dB:detection=peak,areverse,` +
  `silenceremove=start_periods=1:start_threshold=${TAIL_SILENCE_DB}dB:detection=peak,areverse`;

function trimmedSeconds(src: string): number {
  const log = ffmpeg(['-i', src, '-af', TRIM, '-f', 'null', '-']);
  const times = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times[times.length - 1];
  if (!last) throw new Error(`encode-audio: could not measure ${src}`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

function shapeFilter(key: SfxKey, trimmed: number): { filter: string; seconds: number; truncated: boolean } {
  const capSec = (STINGER_KEYS.includes(key) ? STINGER_MAX_MS : SFX_MAX_MS) / 1000;
  const truncated = trimmed > capSec;
  const seconds = Math.min(trimmed, capSec);
  const fade = Math.min(seconds / 2, (truncated ? TRUNCATION_FADE_MS : FADE_OUT_MS) / 1000);
  const filter = `${TRIM},atrim=end=${seconds.toFixed(3)},afade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade.toFixed(3)}`;
  return { filter, seconds, truncated };
}

function levels(src: string, filter: string): { mean: number; peak: number } {
  const log = ffmpeg(['-i', src, '-af', `${filter},volumedetect`, '-f', 'null', '-']);
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(log);
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(log);
  if (!mean || !peak) throw new Error(`encode-audio: volumedetect failed for ${src}`);
  return { mean: Number(mean[1]), peak: Number(peak[1]) };
}

function findMaster(stem: string): string | undefined {
  for (const ext of MASTER_EXTS) {
    const path = join(SRC_DIR, `${stem}${ext}`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`encode-audio: using ${FFMPEG_SOURCE}`);
  const keys = Object.keys(SFX_RECIPES) as SfxKey[];
  const fileBacked = new Set(Object.keys(SFX_FILES));
  const knownStems = new Set(keys.map(sfxFileStem));
  let written = 0;
  let skipped = 0;
  let missing = 0;

  for (const key of keys) {
    const stem = sfxFileStem(key);
    const master = findMaster(stem);
    if (!fileBacked.has(key)) {
      if (master) console.warn(`  ! ${key}: master ${master} exists but key is not in SFX_FILES`);
      continue;
    }
    if (!master) {
      console.warn(`  ! ${key}: in SFX_FILES but no ${SRC_DIR}/${stem}.* master (runtime falls back to recipe)`);
      missing += 1;
      continue;
    }
    const out = join(OUT_DIR, `${stem}.ogg`);
    if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(master).mtimeMs) {
      skipped += 1;
      continue;
    }
    const shape = shapeFilter(key, trimmedSeconds(master));
    const { mean, peak } = levels(master, shape.filter);
    const target = REFERENCE_MEAN_DB + SFX_RECIPES[key].gainDb;
    const gain = Math.min(target - mean, PEAK_CEILING_DB - peak);
    ffmpeg([
      '-y', '-i', master,
      '-af', `${shape.filter},volume=${gain.toFixed(2)}dB`,
      '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-c:a', 'libvorbis', '-q:a', String(VORBIS_QUALITY),
      '-map_metadata', '-1',
      '-fflags', '+bitexact', '-flags:a', '+bitexact',
      out,
    ]);
    written += 1;
    const kb = (statSync(out).size / 1024).toFixed(1);
    console.log(
      `  ${key.padEnd(16)} ${String(Math.round(shape.seconds * 1000)).padStart(5)}ms${shape.truncated ? ' (capped)' : '         '}` +
      ` gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)}dB  ${kb.padStart(6)} KB`,
    );
  }

  for (const file of readdirSync(SRC_DIR)) {
    const ext = extname(file).toLowerCase();
    if (MASTER_EXTS.includes(ext) && !knownStems.has(file.slice(0, -ext.length))) {
      console.warn(`  ! ${SRC_DIR}/${file} matches no SfxKey`);
    }
  }

  const total = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.ogg'))
    .reduce((sum, f) => sum + statSync(join(OUT_DIR, f)).size, 0);
  console.log(`\nwritten ${written}, skipped ${skipped} (already current), missing masters ${missing}`);
  console.log(`${OUT_DIR} total ${(total / 1024).toFixed(1)} KB`);
}

main();
