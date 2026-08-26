// Band forecast — the READ. A band the player cannot read before entering it is
// not a path, it is a label; the whole biome feature is the sentence "I can see
// what the next five waves supply and which boss ends them" (see
// docs/biome-paths-proposal.md §2.4, and §0: "if the player cannot read the
// branch ahead of committing, the feature does not exist").
//
// This module is the ONE place that sentence is composed, so every surface that
// shows it — the band banner, the boss-countdown panel, the route board, and
// later the fork panel — reads the same model and cannot disagree. The boss line
// comes from the REAL `rollEncounter` on the future boss node (the same call the
// map's own fight previews make), never from a re-derivation: a forecast that
// computed the boss a second way would eventually name a different one.
//
// PURE + LOOKAHEAD-SAFE: `forecastBand` extends a COPY of the map with
// `ensureWavesThrough` and composes a throwaway `currentNodeId` (the idiom
// `runStore.ts#previewEncounter` already uses). It never mutates the run and
// never advances it, so previewing band 4 from band 0 is free and repeatable.
//
// PREDICTABLE IN KIND, SURPRISING IN DETAIL: the band's character — its lean,
// its mob family, its boss, its stalls, its event themes — is fully readable
// here. WHICH specific event, WHICH shelf roll, and which of three risk tiers
// stay hidden until the column. Do not extend this to reveal individual future
// nodes; that removes the reason to walk the map.

import type { EnemyTitle } from './encounter';
import type { EventTheme } from '../data/events';
import { enemies } from '../data/enemies';
import { shopCatalog } from '../data/shopTypes';
import {
  bandIndexOf, biomeForBand, bossWaveOfBand, counterTypeFor, firstWaveOfBand, leanLabel,
  type BiomeLean,
} from './biome';
import { ensureWavesThrough } from './runMap';
import { rollEncounter, type RunState } from './runState';

export interface BandForecastEntry {
  id: string;
  name: string;
}

export interface BandForecast {
  /** 0-indexed band. */
  band: number;
  /** Inclusive wave range this band covers. */
  fromWave: number;
  throughWave: number;
  biomeId: string;
  name: string;
  tagline: string;
  lean: BiomeLean;
  /** "FIRE" / "AXE" — the chip. */
  leanLabel: string;
  /** The biome's preferred mobs, in catalog order, named. */
  mobs: readonly BandForecastEntry[];
  /** The boss that actually rolls at `throughWave`, or null if it cannot be
   * resolved (a run with no map, e.g.). Level/title are the resolved fight spec. */
  boss: { enemyId: string; name: string; level: number; title: EnemyTitle } | null;
  /** The stalls this band prefers, named. */
  shops: readonly BandForecastEntry[];
  eventThemes: readonly EventTheme[];
  /** The type that hits this band's mobs for +50%, if any. */
  counterType?: string;
}

/** The forecast for the band `wave` falls in. */
export function forecastWave(state: RunState, wave: number): BandForecast {
  return forecastBand(state, bandIndexOf(wave));
}

/** The forecast for the band AFTER the one `state` is currently in — "what am I
 * walking into", the read the fork panel will eventually be built on. */
export function forecastNextBand(state: RunState, currentWave: number): BandForecast {
  return forecastBand(state, bandIndexOf(currentWave) + 1);
}

/**
 * Everything a player may know about band `band` of this run before entering it.
 * Reads `state` but never returns a modified one.
 */
export function forecastBand(state: RunState, band: number): BandForecast {
  const b = Math.max(0, Math.floor(band));
  const seed = state.map.seed;
  const biome = biomeForBand(seed, b);
  const bossWave = bossWaveOfBand(b);

  let boss: BandForecast['boss'] = null;
  const map = ensureWavesThrough(state.map, bossWave);
  for (const column of map.depths) {
    for (const node of column) {
      if (node.kind !== 'boss' || node.wave !== bossWave) continue;
      const pack = rollEncounter({ ...state, map, currentNodeId: node.id });
      const unit = pack.units[0];
      if (unit) {
        boss = {
          enemyId: unit.enemyId,
          name: enemies[unit.enemyId]?.name ?? unit.enemyId,
          level: unit.level,
          title: unit.title,
        };
      }
      break;
    }
    if (boss) break;
  }

  return {
    band: b,
    fromWave: firstWaveOfBand(b),
    throughWave: bossWave,
    biomeId: biome.id,
    name: biome.name,
    tagline: biome.tagline,
    lean: biome.lean,
    leanLabel: leanLabel(biome.lean),
    mobs: biome.mobs.map((id) => ({ id, name: enemies[id]?.name ?? id })),
    boss,
    shops: biome.shops.map((id) => ({ id, name: shopCatalog[id]?.name ?? id })),
    eventThemes: biome.eventThemes,
    counterType: counterTypeFor(biome.lean),
  };
}

/**
 * The forecast as text — MOBILE-FIRST (CLAUDE.md, USER-LOCKED 2026-08-25): one
 * fact per line, nothing past ~28 characters, never two facts packed onto a row.
 * This is the production renderer, not a demo one: the Phaser band banner and
 * the boss-countdown panel are to render THIS model (a second renderer would
 * drift, exactly as the hand-written combat-log demo did).
 */
export function renderBandForecast(f: BandForecast): string {
  const lines: string[] = [];
  lines.push(`${f.name.toUpperCase()}`);
  lines.push(`[${f.leanLabel}] w${f.fromWave}-${f.throughWave}`);
  lines.push(f.tagline);
  lines.push('');
  lines.push('BOSS');
  if (f.boss) {
    lines.push(`  ${f.boss.name}`);
    lines.push(`  LV ${f.boss.level} · ${f.boss.title.toUpperCase()}`);
  } else {
    lines.push('  (unresolved)');
  }
  lines.push('MOBS');
  for (const m of f.mobs) lines.push(`  ${m.name}`);
  lines.push('SHOPS');
  for (const s of f.shops) lines.push(`  ${s.name}`);
  lines.push('EVENTS');
  for (const t of f.eventThemes) lines.push(`  ${t}`);
  if (f.counterType) {
    lines.push('');
    lines.push(`${f.counterType} hits these`);
    lines.push('mobs for +50%.');
  }
  return lines.join('\n');
}
