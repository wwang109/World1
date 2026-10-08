/**
 * Art encoder — the derived-asset pipeline that turns `art-src/` masters into
 * the `public/game-art/` files the game actually streams.
 *
 * WHY THIS EXISTS. Card art was authored as 1024x1536 PNGs (~2.3 MB each) that
 * no screen ever draws larger than 260x427 design px. That is ~16x oversampled
 * and in the wrong container: 72 files = 165 MB over the wire and ~450 MB of
 * VRAM if they all resolve to textures. This script turns each PNG master into
 * a right-sized WebP derivative the game actually loads.
 *
 * WHERE THE FILES LIVE — masters are NOT served.
 *   art-src/cards/<name>.png        -> public/game-art/cards/<name>.webp
 *   art-src/placeholders/<name>.png -> public/game-art/placeholders/<name>.webp
 *
 * `art-src/` is deliberately OUTSIDE `public/`, because `vite build` copies
 * `public/` verbatim: while the masters sat beside their derivatives, every
 * deploy shipped 179 MB of PNG that no code path requests (`dist` was 192 MB).
 * Masters are never modified and never deleted — they stay tracked in git so
 * the derivatives can always be re-encoded.
 *
 * THE .webp OUTPUT IS COMMITTED. It is generated, but it is checked in, and
 * that is on purpose: encoding needs a Chromium binary, and neither `npm test`
 * nor the Cloudflare Pages build has one. `npm run build` therefore does NOT
 * run this script — you run it by hand when a master changes, and you commit
 * the .webp it writes alongside the master. `tests/game/cardArtBudget.test.ts`
 * is the guard: it fails if a catalogue entry stops resolving to a .webp that
 * exists on disk, and if a master ever reappears under `public/`.
 *
 * `MAX_HEIGHT = 1024` is 2.4x the tallest real draw (427 design px, the
 * desktop shop shelf's 260-wide card), so it still has retina headroom at a
 * 2x device-pixel ratio — the "2x the largest draw" rule, rounded up to a
 * round number. Run-art placeholders are already authored at their draw size,
 * so they are only re-containered, not resized.
 *
 * NO NEW DEPENDENCIES. The encode runs in the Chromium that Playwright
 * already installs for this repo's smoke scripts (canvas drawImage at
 * `imageSmoothingQuality: 'high'`, then `toDataURL('image/webp', q)`), so
 * anyone who can run `npm run shop:smoke` can run this. The binary is located
 * by the shared `scripts/chromiumPath.ts` resolver — the same code
 * `shop-smoke.ts` and `run-hud-audit.ts` call, not a copy of it.
 *
 * Usage:
 *   npm run art:encode              # only masters whose .webp is missing/stale
 *   npm run art:encode -- --force   # re-encode everything
 *   npm run art:encode -- --group cards
 *   npm run art:encode -- --group placeholders --name icon-route-lantern
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { chromium } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';

interface Group {
  name: string;
  /** PNG masters — non-served, never written to. */
  srcDir: string;
  /** WebP derivatives — served, and committed (see the header). */
  outDir: string;
  /** 0 = keep the master's dimensions. */
  maxHeight: number;
  quality: number;
  trimTransparent?: boolean;
  outputSize?: { width: number; height: number };
  contain?: boolean;
  inset?: number;
  atlas?: { file: string; columns: number; names: readonly string[] };
}

const GROUPS: Group[] = [
  { name: 'equipment', srcDir: 'art-src/equipment', outDir: 'public/game-art/equipment', maxHeight: 0, quality: 0.9, trimTransparent: true, outputSize: { width: 512, height: 512 }, contain: true, inset: 0.08 },
  { name: 'route-icons', srcDir: 'art-src/ui/route-icons', outDir: 'public/game-art/ui/route-icons', maxHeight: 0, quality: 0.94, trimTransparent: true, outputSize: { width: 256, height: 256 }, contain: true,
    atlas: { file: 'day-chapters-symbols.png', columns: 2, names: ['event','shop','battle','boss'] } },
  { name: 'route-equipment', srcDir: 'art-src/ui/route-icons', outDir: 'public/game-art/ui/route-icons', maxHeight: 0, quality: 0.94, trimTransparent: true, outputSize: { width: 256, height: 256 }, contain: true,
    atlas: { file: 'equipment.png', columns: 1, names: ['equipment'] } },
  { name: 'event-icons', srcDir: 'art-src/ui/event-icons', outDir: 'public/game-art/ui/event-icons', maxHeight: 0, quality: 0.94, trimTransparent: true, outputSize: { width: 256, height: 256 }, contain: true,
    atlas: { file: 'illustrated-event-icons.png', columns: 3, names: ['gold','card','gamble','gem','level','nothing'] } },
  { name: 'card-badges', srcDir: 'art-src/ui/card-badges', outDir: 'public/game-art/ui/card-badges', maxHeight: 0, quality: 0.94, trimTransparent: true, outputSize: { width: 256, height: 256 }, contain: true,
    atlas: { file: 'illustrated-badges.png', columns: 4, names: ['sword','axe','lance','bow','fangs','fire','frost','lightning','nature','holy','dark','offense','defensive','healing','support','debuff'] } },
  { name: 'shop-frame-jointed', srcDir: 'art-src/ui/shop-borders', outDir: 'public/game-art/ui/shop-borders', maxHeight: 512, quality: 0.96, trimTransparent: true,
    atlas: { file: 'jointed-shop-frame-v3.png', columns: 1, names: ['jointed-shop-frame-v3'] } },
  { name: 'templates', srcDir: 'art-src/templates', outDir: 'public/game-art/template', maxHeight: 0, quality: 0.9, trimTransparent: true, outputSize: { width: 840, height: 1380 } },
  { name: 'gems', srcDir: 'art-src/ui/gems', outDir: 'public/game-art/ui/gems', maxHeight: 256, quality: 0.84 },
  { name: 'cards', srcDir: 'art-src/cards', outDir: 'public/game-art/cards', maxHeight: 1024, quality: 0.68 },
  { name: 'placeholders', srcDir: 'art-src/placeholders', outDir: 'public/game-art/placeholders', maxHeight: 0, quality: 0.84 },
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const groupArg = args.includes('--group') ? args[args.indexOf('--group') + 1] : undefined;
const nameArg = args.includes('--name') ? args[args.indexOf('--name') + 1] : undefined;
const groups = groupArg && groupArg !== 'all' ? GROUPS.filter((g) => g.name === groupArg) : GROUPS;
if (groups.length === 0) throw new Error(`encode-card-art: unknown --group ${String(groupArg)}`);

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: resolveChromiumPath('encode-card-art') });
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  let masterBytes = 0;
  let derivedBytes = 0;
  let written = 0;
  let skipped = 0;

  for (const group of groups) {
    mkdirSync(group.outDir, { recursive: true });
    const files = group.atlas ? group.atlas.names.map((name,index) => ({ file: group.atlas!.file,name,index }))
      : readdirSync(group.srcDir).filter(f => f.toLowerCase().endsWith('.png')).sort().map(file => ({ file,name: basename(file,'.png'),index: undefined }));
    console.log(`\n== ${group.name} (${files.length} masters, ${group.srcDir} -> ${group.outDir}) ==`);
    for (const { file,name,index } of files.filter((entry) => !nameArg || entry.name === nameArg)) {
      const src = join(group.srcDir, file);
      const out = join(group.outDir, `${name}.webp`);
      const srcStat = statSync(src);
      masterBytes += srcStat.size;
      if (!force && existsSync(out) && statSync(out).mtimeMs >= srcStat.mtimeMs) {
        derivedBytes += statSync(out).size;
        skipped += 1;
        continue;
      }
      const dataUrl = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
      const encoded = await page.evaluate(async ({ url, maxHeight, quality, trimTransparent, outputSize, contain, inset, atlas }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        let left = 0, top = 0, sourceWidth = img.naturalWidth, sourceHeight = img.naturalHeight;
        if (atlas) {
          const column = atlas.index % atlas.columns;
          const row = Math.floor(atlas.index / atlas.columns);
          left = Math.round(column * img.naturalWidth / atlas.columns);
          top = Math.round(row * img.naturalHeight / atlas.rows);
          sourceWidth = Math.round((column + 1) * img.naturalWidth / atlas.columns) - left;
          sourceHeight = Math.round((row + 1) * img.naturalHeight / atlas.rows) - top;
        }
        if (trimTransparent) {
          const source = document.createElement('canvas');
          source.width = sourceWidth; source.height = sourceHeight;
          const sourceContext = source.getContext('2d');
          if (!sourceContext) throw new Error('no source 2d context');
          sourceContext.drawImage(img, left, top, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
          const pixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
          const cropLeft = left, cropTop = top;
          left = sourceWidth; top = sourceHeight;
          let right = -1, bottom = -1;
          for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) {
            if (pixels[(y * sourceWidth + x) * 4 + 3]! >= 8) {
              left = Math.min(left, x); top = Math.min(top, y);
              right = Math.max(right, x); bottom = Math.max(bottom, y);
            }
          }
          if (right < 0) throw new Error('empty template asset');
          sourceWidth = right - left + 1; sourceHeight = bottom - top + 1;
          left += cropLeft; top += cropTop;
        }
        const scale = maxHeight > 0 && sourceHeight > maxHeight ? maxHeight / sourceHeight : 1;
        const w = outputSize?.width ?? Math.max(1, Math.round(sourceWidth * scale));
        const h = outputSize?.height ?? Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const padding = inset ?? 0;
        const fit = Math.min(w * (1 - padding * 2) / sourceWidth,h * (1 - padding * 2) / sourceHeight);
        const drawWidth = contain ? Math.round(sourceWidth * fit) : w;
        const drawHeight = contain ? Math.round(sourceHeight * fit) : h;
        ctx.drawImage(img, left, top, sourceWidth, sourceHeight, Math.floor((w - drawWidth) / 2),Math.floor((h - drawHeight) / 2),drawWidth,drawHeight);
        const out = canvas.toDataURL('image/webp', quality);
        if (!out.startsWith('data:image/webp')) throw new Error('chromium did not encode webp');
        return { b64: out.slice(out.indexOf(',') + 1), w, h };
      }, { url: dataUrl, maxHeight: group.maxHeight, quality: group.quality, trimTransparent: group.trimTransparent, outputSize: group.outputSize, contain: group.contain, inset: group.inset,
        atlas: group.atlas && index !== undefined ? { index,columns: group.atlas.columns,rows: Math.ceil(group.atlas.names.length / group.atlas.columns) } : undefined });
      const buf = Buffer.from(encoded.b64, 'base64');
      writeFileSync(out, buf);
      derivedBytes += buf.length;
      written += 1;
      console.log(`  ${name.padEnd(34)} ${kb(srcStat.size).padStart(10)} -> ${encoded.w}x${encoded.h} ${kb(buf.length).padStart(9)}`);
    }
  }

  await browser.close();
  console.log(`\nwritten ${written}, skipped ${skipped} (already current)`);
  console.log(`masters  ${(masterBytes / 1e6).toFixed(1)} MB`);
  console.log(`derived  ${(derivedBytes / 1e6).toFixed(1)} MB`);
  console.log(`saving   ${(100 - (derivedBytes / masterBytes) * 100).toFixed(1)}%`);
}

void main();
