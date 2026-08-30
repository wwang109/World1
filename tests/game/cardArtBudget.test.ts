import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { skillBook } from '../../src/data/skills';
import {
  CARD_ART_BASE_PATH,
  CARD_ART_CATALOG,
  cardArtUrl,
} from '../../src/game/ui/cardArtCatalog';
import { cardArtPlaceholderStyle } from '../../src/game/ui/cardArtPresentation';

/**
 * THE BOOT ART BUDGET — the guard on the single largest performance defect
 * this project has had.
 *
 * `BootScene.preload` used to queue every card-art PNG before the first
 * screen could paint: 72 files, 1024x1536 each, 165 MB over the wire and
 * roughly 450 MB of VRAM, for art no screen ever draws larger than 260x427
 * design px. The first screen (START RUN / SANDBOX) shows no cards at all.
 *
 * Three things hold that fix in place here, all read from the REAL source and
 * the REAL files on disk rather than a retyped copy:
 *
 *   1. BOOT NEVER NAMES CARD ART. The moment `BootScene.ts` mentions the
 *      cards directory or the catalogue again, the eager load is back.
 *   2. THE FILES ARE THE DERIVATIVES. Every catalogue entry resolves to a
 *      `.webp` that exists, and no single one may exceed `MAX_FILE_BYTES` —
 *      dropping a 2.3 MB master back into the catalogue fails here.
 *   3. THE PLACEHOLDER COVERS EVERY SKILL. All 166 skills — including the 94
 *      with no art at all — must produce a placeholder style, because that is
 *      now the ONLY thing standing between a card and an empty rectangle.
 */

const CARDS_DIR = join('public', CARD_ART_BASE_PATH.replace(/^\//, ''));
/** A right-sized card at max 1024 tall / WebP q82 lands around 95 KB. */
const MAX_FILE_BYTES = 400 * 1024;
/** Whole catalogue, if something ever did load it all at once. */
const MAX_CATALOG_BYTES = 12 * 1024 * 1024;

describe('card art budget', () => {
  it('BootScene never names card art — the eager preload stays gone', () => {
    const boot = readFileSync(join('src', 'game', 'scenes', 'BootScene.ts'), 'utf8');
    // Strip comments: the file explains the removal in prose, and that prose
    // legitimately names both.
    const code = boot
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toContain('game-art/cards');
    expect(code).not.toContain('CARD_ART_CATALOG');
  });

  it('every catalogue entry is a webp derivative that exists on disk', () => {
    const missing: string[] = [];
    const wrongType: string[] = [];
    for (const [skillId, entry] of Object.entries(CARD_ART_CATALOG)) {
      if (!entry.fileName.endsWith('.webp')) wrongType.push(`${skillId} -> ${entry.fileName}`);
      if (!existsSync(join(CARDS_DIR, entry.fileName))) missing.push(`${skillId} -> ${entry.fileName}`);
    }
    expect(wrongType).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('no catalogue file exceeds the per-card budget, and the set fits the whole budget', () => {
    const oversized: string[] = [];
    let total = 0;
    for (const entry of Object.values(CARD_ART_CATALOG)) {
      const bytes = statSync(join(CARDS_DIR, entry.fileName)).size;
      total += bytes;
      if (bytes > MAX_FILE_BYTES) oversized.push(`${entry.fileName} ${(bytes / 1024).toFixed(0)} KB`);
    }
    expect(oversized).toEqual([]);
    expect(total).toBeLessThan(MAX_CATALOG_BYTES);
  });

  it('catalogue keys are real skills, and texture keys and file names are unique', () => {
    const unknown = Object.keys(CARD_ART_CATALOG).filter((id) => !(id in skillBook));
    expect(unknown).toEqual([]);
    const entries = Object.values(CARD_ART_CATALOG);
    expect(new Set(entries.map((e) => e.textureKey)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.fileName)).size).toBe(entries.length);
  });

  it('cardArtUrl is the one path builder and points into the served directory', () => {
    for (const entry of Object.values(CARD_ART_CATALOG)) {
      expect(cardArtUrl(entry)).toBe(`${CARD_ART_BASE_PATH}/${entry.fileName}`);
    }
  });

  it('every skill gets a placeholder — art-less cards included', () => {
    const skills = Object.values(skillBook);
    expect(skills.length).toBeGreaterThan(0);
    const withoutArt = skills.filter((skill) => CARD_ART_CATALOG[skill.id] === undefined);
    // The whole reason the placeholder had to get good: most of the pool has
    // no art yet. If that ever reaches zero this assertion can go.
    expect(withoutArt.length).toBeGreaterThan(0);
    for (const skill of skills) {
      const style = cardArtPlaceholderStyle(skill);
      expect(Number.isInteger(style.tint)).toBe(true);
      expect(style.tint).toBeGreaterThanOrEqual(0);
      expect(style.tint).toBeLessThanOrEqual(0xffffff);
      expect(style.emblemTextureKey).toMatch(/^card-badge:template:/);
    }
  });

  it('the png masters are still on disk — the derivatives are generated, not a replacement', () => {
    const files = readdirSync(CARDS_DIR);
    const masters = files.filter((f) => f.endsWith('.png'));
    const derived = files.filter((f) => f.endsWith('.webp'));
    expect(masters.length).toBeGreaterThan(0);
    for (const entry of Object.values(CARD_ART_CATALOG)) {
      expect(masters).toContain(entry.fileName.replace(/\.webp$/, '.png'));
    }
    expect(derived.length).toBeGreaterThanOrEqual(Object.keys(CARD_ART_CATALOG).length);
  });
});
