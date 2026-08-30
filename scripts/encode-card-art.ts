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
 * anyone who can run `npm run shop:smoke` can run this. Resolution follows
 * the same `PW_CHROMIUM` / `PLAYWRIGHT_BROWSERS_PATH` strategy as
 * `scripts/shop-smoke.ts`.
 *
 * Usage:
 *   npm run art:encode              # only masters whose .webp is missing/stale
 *   npm run art:encode -- --force   # re-encode everything
 *   npm run art:encode -- --group cards
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { chromium } from 'playwright';

interface Group {
  name: string;
  /** PNG masters — non-served, never written to. */
  srcDir: string;
  /** WebP derivatives — served, and committed (see the header). */
  outDir: string;
  /** 0 = keep the master's dimensions. */
  maxHeight: number;
  quality: number;
}

const GROUPS: Group[] = [
  { name: 'cards', srcDir: 'art-src/cards', outDir: 'public/game-art/cards', maxHeight: 1024, quality: 0.82 },
  { name: 'placeholders', srcDir: 'art-src/placeholders', outDir: 'public/game-art/placeholders', maxHeight: 0, quality: 0.84 },
];

/** Same resolution strategy as `scripts/shop-smoke.ts` — see that file. */
function resolveChromiumPath(): string {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'chrome.exe' : 'chrome';
  const platformDirs = isWin ? ['chrome-win64', 'chrome-win'] : ['chrome-linux'];
  function scan(browsersPath: string): string | null {
    const symlink = join(browsersPath, 'chromium');
    if (existsSync(symlink)) return symlink;
    let entries: string[];
    try { entries = readdirSync(browsersPath); } catch { return null; }
    const revisioned = entries
      .filter((e) => /^chromium-\d+$/.test(e))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of revisioned) {
      for (const sub of platformDirs) {
        const candidate = join(browsersPath, dir, sub, exeName);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) { const found = scan(browsersPath); if (found) return found; }
  const home = process.env.HOME ?? '';
  const found = home ? scan(join(home, isWin ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright')) : null;
  if (found) return found;
  throw new Error(
    'encode-card-art: could not resolve a Chromium executable. Set PW_CHROMIUM to an explicit ' +
    'binary path, or PLAYWRIGHT_BROWSERS_PATH to a Playwright browsers cache dir.',
  );
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const groupArg = args.includes('--group') ? args[args.indexOf('--group') + 1] : undefined;
const groups = groupArg && groupArg !== 'all' ? GROUPS.filter((g) => g.name === groupArg) : GROUPS;
if (groups.length === 0) throw new Error(`encode-card-art: unknown --group ${String(groupArg)}`);

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: resolveChromiumPath() });
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  let masterBytes = 0;
  let derivedBytes = 0;
  let written = 0;
  let skipped = 0;

  for (const group of groups) {
    mkdirSync(group.outDir, { recursive: true });
    const files = readdirSync(group.srcDir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
    console.log(`\n== ${group.name} (${files.length} masters, ${group.srcDir} -> ${group.outDir}) ==`);
    for (const file of files) {
      const src = join(group.srcDir, file);
      const out = join(group.outDir, `${basename(file, '.png')}.webp`);
      const srcStat = statSync(src);
      masterBytes += srcStat.size;
      if (!force && existsSync(out) && statSync(out).mtimeMs >= srcStat.mtimeMs) {
        derivedBytes += statSync(out).size;
        skipped += 1;
        continue;
      }
      const dataUrl = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
      const encoded = await page.evaluate(async ({ url, maxHeight, quality }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const scale = maxHeight > 0 && img.naturalHeight > maxHeight ? maxHeight / img.naturalHeight : 1;
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/webp', quality);
        if (!out.startsWith('data:image/webp')) throw new Error('chromium did not encode webp');
        return { b64: out.slice(out.indexOf(',') + 1), w, h };
      }, { url: dataUrl, maxHeight: group.maxHeight, quality: group.quality });
      const buf = Buffer.from(encoded.b64, 'base64');
      writeFileSync(out, buf);
      derivedBytes += buf.length;
      written += 1;
      console.log(`  ${file.padEnd(34)} ${kb(srcStat.size).padStart(10)} -> ${encoded.w}x${encoded.h} ${kb(buf.length).padStart(9)}`);
    }
  }

  await browser.close();
  console.log(`\nwritten ${written}, skipped ${skipped} (already current)`);
  console.log(`masters  ${(masterBytes / 1e6).toFixed(1)} MB`);
  console.log(`derived  ${(derivedBytes / 1e6).toFixed(1)} MB`);
  console.log(`saving   ${(100 - (derivedBytes / masterBytes) * 100).toFixed(1)}%`);
}

void main();
