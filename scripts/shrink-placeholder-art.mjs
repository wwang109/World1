/**
 * Shrink the run-layer placeholder art to ~2x its real on-screen size.
 *
 *   node scripts/shrink-placeholder-art.mjs [--dry]
 *
 * The generated placeholders land at generation resolution (1254² icons,
 * ~1672x941 scenes), which is 25-50x larger than anything actually renders at:
 * a 1.5 MB 1254x1254 icon is drawn into a 24px coin slot. All of it is loaded
 * up front by BootScene, so the whole set is on the critical path.
 *
 * Targets are 2x the LARGEST rect each key is drawn into (the retina rule), read
 * off the call sites in src/game/scenes/*. Aspect ratio is preserved exactly by
 * resizing on WIDTH only — `addRunArt` center-crops to fill its slot, so any
 * change to the source aspect would silently change the crop.
 *
 * PURELY A SIZE PASS. It does not re-crop or re-compose, so it cannot fix the
 * mobile storefront banner, which is a layout problem (a 4.5:1 slot showing 16:9
 * art keeps only ~40% of the image height). See the notes in the summary.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const DIR = 'public/game-art/placeholders';
const DRY = process.argv.includes('--dry');

/** width -> target, chosen from the biggest slot each asset renders into. */
function targetWidth(file) {
  // Square choice/coin/heart/skull/storefront icons: biggest slot is the 44px
  // desktop outcome icon. 128 leaves room above 2x for any future larger use.
  if (file.startsWith('icon-')) return 128;
  // Storefront banners: desktop picker cell is ~223 wide, mobile 193. 2x = 512.
  if (file.startsWith('shop-front-')) return 512;
  // Event area art: desktop caps artW at 520. 2x = 1040, round down to 1024.
  if (file.startsWith('area-')) return 1024;
  // Full-screen map backdrop, drawn at 1440 wide and 0.2 alpha — 1x is plenty
  // for a dim backdrop, and 2x would be 2880 for something barely visible.
  if (file === 'run-map.png') return 1440;
  // Loaded by BootScene but never drawn by any scene (no `shopBanner` call
  // site outside runArt.ts). Kept small rather than deleted — that is a
  // separate call.
  if (file === 'shop-banner.png') return 512;
  return null;
}

let before = 0;
let after = 0;
const rows = [];

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()) {
  const path = join(DIR, file);
  const width = targetWidth(file);
  const sizeBefore = statSync(path).size;
  before += sizeBefore;
  if (!width) {
    after += sizeBefore;
    rows.push([file, 'SKIP (no rule)', sizeBefore, sizeBefore]);
    continue;
  }
  const meta = await sharp(path).metadata();
  if (meta.width <= width) {
    after += sizeBefore;
    rows.push([file, `SKIP (already ${meta.width}w)`, sizeBefore, sizeBefore]);
    continue;
  }
  const buf = await sharp(path)
    .resize({ width, withoutEnlargement: true }) // height follows -> aspect preserved
    .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
    .toBuffer();
  if (!DRY) await sharp(buf).toFile(path);
  after += buf.length;
  rows.push([file, `${meta.width}->${width}w`, sizeBefore, buf.length]);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
for (const [file, what, b, a] of rows) {
  console.log(`${file.padEnd(30)} ${what.padEnd(22)} ${kb(b).padStart(9)} -> ${kb(a).padStart(8)}`);
}
console.log(`\n${DRY ? '[DRY] ' : ''}TOTAL ${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB` +
  `  (${(100 - (after / before) * 100).toFixed(1)}% smaller)`);
