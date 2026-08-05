// gen-placeholder-art.ts — deterministic flat-color placeholder PNGs for the
// run-layer UI (event areas, choice icons, currency, lives, boss, storefront).
//
// Usage:  npx tsx scripts/gen-placeholder-art.ts
//
// Writes commit-ready PNGs into public/game-art/placeholders/. Each file's
// path is the FINAL asset path — swapping in real art is a file replace (the
// prompt for each real asset lives in docs/art-prompt-pack.md). Node built-ins
// only (zlib deflate + hand-rolled CRC32 over raw RGBA scanlines); no npm
// deps, no Date/random — byte-identical output on every run.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crcInput = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([head, data, tail]);
}

/** Encode an RGBA pixel buffer (row-major, 4 bytes/px) as an 8-bit PNG. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Raw scanlines, filter byte 0 (None) per row.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((v, i) => {
      raw[rowStart + 1 + i] = v;
    });
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ rendering

type Rgb = readonly [number, number, number];

function lighten(c: Rgb, by: number): Rgb {
  return [Math.min(255, c[0] + by), Math.min(255, c[1] + by), Math.min(255, c[2] + by)];
}

/** Rounded-feel flat block: solid fill + 1px lighter border; the corner
 * pixels outside the rounding radius are fully transparent. */
function renderBlock(width: number, height: number, fill: Rgb, radius: number): Uint8Array {
  const border = lighten(fill, 48);
  const px = new Uint8Array(width * height * 4);
  const r = radius;
  const inside = (x: number, y: number): boolean => {
    // Distance check only matters in the four corner squares.
    const cx = x < r ? r - 0.5 : x >= width - r ? width - r - 0.5 : -1;
    const cy = y < r ? r - 0.5 : y >= height - r ? height - r - 0.5 : -1;
    if (cx < 0 || cy < 0) return true;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!inside(x, y)) continue; // transparent corner
      const onEdge =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const c = onEdge ? border : fill;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

// -------------------------------------------------------------------- catalog

interface Asset {
  /** Path under public/game-art/placeholders/. */
  file: string;
  width: number;
  height: number;
  fill: Rgb;
}

// Event area illustrations — 360×140 (mobile panel width-ish), colors keyed
// to each area's identity in src/game/ui/eventThemeBlurb.ts.
const AREAS: Asset[] = [
  { file: 'area-hollow-yard.png', width: 360, height: 140, fill: [138, 122, 92] }, // dusty sparring ground
  { file: 'area-silt-hollows.png', width: 360, height: 140, fill: [92, 79, 58] }, // mud-swallowed barrows
  { file: 'area-muster-road.png', width: 360, height: 140, fill: [79, 107, 82] }, // waystation camps
  { file: 'area-cinderworks.png', width: 360, height: 140, fill: [138, 74, 46] }, // forges and embers
  { file: 'area-tolling-road.png', width: 360, height: 140, fill: [138, 109, 46] }, // coin and caravans
  { file: 'area-crossroads-unquiet.png', width: 360, height: 140, fill: [90, 74, 122] }, // twilight shrine
];

// Event choice-type icons — 48×48, keyed to src/data/events.ts outcome kinds.
const CHOICE_ICONS: Asset[] = [
  { file: 'icon-choice-gold.png', width: 48, height: 48, fill: [201, 162, 39] }, // grantGold / loseGold
  { file: 'icon-choice-card.png', width: 48, height: 48, fill: [74, 111, 165] }, // grantCard / bonusDraft
  { file: 'icon-choice-gem.png', width: 48, height: 48, fill: [46, 138, 110] }, // grantGem
  { file: 'icon-choice-level.png', width: 48, height: 48, fill: [106, 176, 76] }, // grantLevel
  { file: 'icon-choice-gamble.png', width: 48, height: 48, fill: [125, 91, 166] }, // gamble
  { file: 'icon-choice-nothing.png', width: 48, height: 48, fill: [107, 114, 128] }, // nothing
];

const MISC_ICONS: Asset[] = [
  { file: 'icon-coin.png', width: 32, height: 32, fill: [212, 175, 55] }, // gold currency coin
  { file: 'icon-life-heart.png', width: 48, height: 48, fill: [192, 57, 43] }, // lives
  { file: 'icon-boss-skull.png', width: 48, height: 48, fill: [122, 31, 43] }, // boss node
  { file: 'icon-storefront.png', width: 48, height: 48, fill: [140, 107, 79] }, // generic shop
];

const ALL: Asset[] = [...AREAS, ...CHOICE_ICONS, ...MISC_ICONS];

// ------------------------------------------------------------------------ run

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'game-art', 'placeholders');
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const a of ALL) {
  const radius = a.width >= 100 ? 10 : a.width >= 48 ? 8 : 6;
  const png = encodePng(a.width, a.height, renderBlock(a.width, a.height, a.fill, radius));
  writeFileSync(join(outDir, a.file), png);
  total += png.length;
  console.log(`${a.file}  ${a.width}x${a.height}  ${png.length} B`);
}
console.log(`\n${ALL.length} placeholders -> public/game-art/placeholders/ (${total} B total)`);
