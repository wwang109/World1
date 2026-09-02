import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
 *   3. THE PLACEHOLDER COVERS EVERY SKILL. Every skill in the book — with or
 *      without catalogue art — must produce a placeholder style, because that
 *      is the ONLY thing standing between an art-pending card (see
 *      ART_PENDING below) and an empty rectangle. Coverage of shipped art is
 *      ratcheted per-id there, not assumed to be 100%: it was exactly 100%
 *      only in the gap between the 166-set completion and the next content
 *      pass, which is a moment, not an invariant.
 *
 * A FOURTH THING, added 2026-08-30 with the `art-src/` move: NO PNG MASTER MAY
 * SIT UNDER `public/`. `vite build` copies `public/` verbatim, so a master
 * dropped back in there is 2.3 MB added to every deploy for a file no code
 * path requests — that is exactly the 179 MB `dist` regression this guards.
 * The masters live in `art-src/`, still tracked, still re-encodable, and this
 * test checks BOTH halves: gone from `public/`, present in `art-src/`.
 */

const CARDS_DIR = join('public', CARD_ART_BASE_PATH.replace(/^\//, ''));
/** Non-served master tree. `scripts/encode-card-art.ts` reads it; nothing serves it. */
const MASTERS_DIR = join('art-src', 'cards');
/** Served tree. Only these file types may appear anywhere under it. */
const PUBLIC_DIR = 'public';
/**
 * The ONLY `.png` files allowed under `public/` — small template chrome that
 * `BootScene` loads by name and that has no WebP derivative. Everything else
 * that is a PNG under `public/` is a master in the wrong place.
 */
const ALLOWED_PUBLIC_PNG = [
  'card-template-parts-transparent.png',
  ...['sword', 'lance', 'axe', 'bow', 'fangs', 'fire', 'frost', 'lightning', 'nature',
      'holy', 'dark', 'offense', 'defensive', 'healing', 'support', 'debuff']
    .map((n) => `badge-${n}.png`),
];
/** Biggest served PNG allowed — the badge/template chrome is all well under this. */
const MAX_PUBLIC_PNG_BYTES = 256 * 1024;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
/** A right-sized card at max 1024 tall / WebP q72 lands around 75 KB. */
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

  it('every catalogue entry is a webp derivative that exists on disk, spelled EXACTLY', () => {
    // Directory listing, not `existsSync`. NTFS and APFS match file names
    // case-INsensitively, so a catalogue entry spelled `Fireball.webp` against
    // a `fireball.webp` on disk passes on every machine this is developed on —
    // and then 404s for every player, because the Cloudflare Pages tree the
    // game actually fetches from is case-SENSITIVE. Exact-case set membership
    // is the only form of this check that fails where the bug is.
    const onDisk = new Set(readdirSync(CARDS_DIR));
    const missing: string[] = [];
    const wrongType: string[] = [];
    for (const [skillId, entry] of Object.entries(CARD_ART_CATALOG)) {
      if (!entry.fileName.endsWith('.webp')) wrongType.push(`${skillId} -> ${entry.fileName}`);
      if (!onDisk.has(entry.fileName)) missing.push(`${skillId} -> ${entry.fileName}`);
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

  /**
   * ART-PENDING RATCHET (2026-09-02). Coverage reached 100% when the 166-card
   * set completed (fc5cbc4) and this assertion became `toEqual([])`. New
   * content then re-taught the original lesson: a card ships as JSON in one
   * pass and gets its master painted in another, so "zero artless cards" is
   * only ever true BETWEEN content passes. The placeholder path below is the
   * shipping contract for the gap — it is not a failure mode.
   *
   * So the gate is an enumerated ratchet, not an empty set: every artless id
   * must be LISTED here, which means coverage of the shipped 166 can never
   * silently regress (an old id appearing in `withoutArt` still fails) and a
   * new card cannot be added without either art or a deliberate line in this
   * list. Ship art for a listed card -> DELETE its line. The list reaching
   * empty again is the goal, not the invariant.
   */
  const ART_PENDING = [
    'blightstep_dirge',
    'emberchant_rite',
    'frostbind_litany',
    'ironmarch_tithe',
    'quiverwardens_call',
    'standard_of_the_ninth',
    'storm_tithe',
    'writ_of_sanction',
  ];

  it('every skill has catalogue art or a deliberate art-pending entry, plus a placeholder fallback', () => {
    const skills = Object.values(skillBook);
    expect(skills.length).toBeGreaterThan(0);
    const withoutArt = skills.filter((skill) => CARD_ART_CATALOG[skill.id] === undefined);
    expect(withoutArt.map((s) => s.id).sort()).toEqual([...ART_PENDING].sort());
    // A listed id that GAINED art is stale debt bookkeeping — fail that too.
    const stale = ART_PENDING.filter((id) => CARD_ART_CATALOG[id] !== undefined);
    expect(stale).toEqual([]);
    for (const skill of skills) {
      const style = cardArtPlaceholderStyle(skill);
      expect(Number.isInteger(style.tint)).toBe(true);
      expect(style.tint).toBeGreaterThanOrEqual(0);
      expect(style.tint).toBeLessThanOrEqual(0xffffff);
      expect(style.emblemTextureKey).toMatch(/^card-badge:template:/);
    }
  });

  it('the png masters are still on disk in art-src — the derivatives are generated, not a replacement', () => {
    const masters = readdirSync(MASTERS_DIR).filter((f) => f.endsWith('.png'));
    expect(masters.length).toBeGreaterThan(0);
    for (const entry of Object.values(CARD_ART_CATALOG)) {
      expect(masters).toContain(entry.fileName.replace(/\.webp$/, '.png'));
    }
    const derived = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.webp'));
    expect(derived.length).toBeGreaterThanOrEqual(Object.keys(CARD_ART_CATALOG).length);
  });

  it('no png master is under public/ — the served tree is derivatives only', () => {
    const strays = walk(PUBLIC_DIR)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .filter((f) => !ALLOWED_PUBLIC_PNG.includes(f.split(/[\\/]/).pop() ?? ''));
    expect(strays).toEqual([]);
  });

  it('nothing served is master-sized — every file under public/ fits the budget', () => {
    const oversized = walk(PUBLIC_DIR)
      .map((f) => [f, statSync(f).size] as const)
      .filter(([f, bytes]) => bytes > (f.toLowerCase().endsWith('.png') ? MAX_PUBLIC_PNG_BYTES : MAX_FILE_BYTES))
      .map(([f, bytes]) => `${f} ${(bytes / 1024).toFixed(0)} KB`);
    // run-map.webp is the one legitimate exception: a full-screen 1440-wide
    // backdrop, already a derivative, already the smallest it can be.
    expect(oversized.filter((f) => !f.includes('run-map.webp'))).toEqual([]);
  });
});
