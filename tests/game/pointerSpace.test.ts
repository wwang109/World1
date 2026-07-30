import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pointer coordinates must be read in WORLD space, never buffer space.
 *
 * `renderScale.ts` sizes the canvas buffer to physical pixels and zooms every
 * camera to compensate, so the buffer is `RENDER_SCALE`x larger than the design
 * space every layout token speaks in. Phaser's `pointer.x/y` are transformed
 * into that BUFFER space — only `pointer.worldX/worldY` are camera-corrected.
 * Comparing `pointer.x` against a design-space rect therefore misses by the
 * scale factor (verified: a click at design 400,300 reports pointer.x 800 at
 * DPR 2), which silently broke deck drag-and-drop, wiki card taps and the
 * battle scrubber until this guard existed.
 *
 * Interactive GameObjects are unaffected — Phaser hit-tests those through the
 * camera itself. This only bites MANUAL hit-testing in pointer handlers, which
 * is exactly what this test scans for.
 */
const GAME_DIR = join(process.cwd(), 'src', 'game');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** `p.x` / `pointer.x` / `ptr.y` … but not `.worldX` / `.worldY`. */
const RAW_POINTER = /\b(p|ptr|pointer)\.(x|y)\b/g;

describe('src/game: pointer coordinates are read in world space', () => {
  it('never reads raw pointer.x/y (buffer space) in a pointer handler', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(GAME_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!RAW_POINTER.test(line)) return;
        RAW_POINTER.lastIndex = 0;
        // Only flag lines in files that actually handle pointers — a local
        // variable named `p` elsewhere is not a pointer.
        offenders.push(`${file.replace(process.cwd(), '')}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `Use pointer.worldX/worldY — raw pointer.x/y is in buffer space and breaks under render scale:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
