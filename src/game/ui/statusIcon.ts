import Phaser from 'phaser';
import type { StatusChip } from '../battleTimeline';
import { FONT, UI } from '../theme';
import { STATUS_CHIP_COLOR } from './battleStatusPalette';
import { addHoverTipZone } from './hoverTip';

const BUFF_EDGE = 0x6fcf7f;
const DEBUFF_EDGE = 0xe0665a;
const TILE_FILL = 0x0c1420;

export interface StatusIconChip {
  container: Phaser.GameObjects.Container;
  width: number;
  height: number;
  label: string;
  place(x: number, y: number, opts?: { followTarget?: boolean }): Phaser.GameObjects.Rectangle | undefined;
  destroy(): void;
}

export function statusIconTileSize(fontSize: number): number {
  return Math.max(16, Math.round(fontSize * 1.55));
}

const hexToNumber = (hex: string): number => Phaser.Display.Color.HexStringToColor(hex).color;

function drawGlyph(g: Phaser.GameObjects.Graphics, kind: string, cx: number, cy: number, s: number, color: number): void {
  const r = s / 2;
  g.fillStyle(color, 1);
  g.lineStyle(Math.max(1.5, s / 8), color, 1);
  switch (kind) {
    case 'poison':
    case 'bleed': {
      g.fillCircle(cx, cy + r * 0.25, r * 0.6);
      g.fillTriangle(cx - r * 0.55, cy + r * 0.1, cx + r * 0.55, cy + r * 0.1, cx, cy - r * 0.9);
      if (kind === 'bleed') {
        g.lineStyle(Math.max(1, s / 10), TILE_FILL, 1);
        g.lineBetween(cx - r * 0.35, cy + r * 0.5, cx + r * 0.25, cy - r * 0.1);
      }
      break;
    }
    case 'burn': {
      g.fillTriangle(cx - r * 0.6, cy + r * 0.7, cx + r * 0.6, cy + r * 0.7, cx, cy - r * 0.9);
      g.fillTriangle(cx - r * 0.75, cy + r * 0.7, cx - r * 0.1, cy + r * 0.7, cx - r * 0.55, cy - r * 0.2);
      g.fillTriangle(cx + r * 0.1, cy + r * 0.7, cx + r * 0.75, cy + r * 0.7, cx + r * 0.55, cy - r * 0.3);
      break;
    }
    case 'stun': {
      g.fillTriangle(cx, cy - r * 0.9, cx - r * 0.22, cy, cx + r * 0.22, cy);
      g.fillTriangle(cx, cy + r * 0.9, cx - r * 0.22, cy, cx + r * 0.22, cy);
      g.fillTriangle(cx - r * 0.9, cy, cx, cy - r * 0.22, cx, cy + r * 0.22);
      g.fillTriangle(cx + r * 0.9, cy, cx, cy - r * 0.22, cx, cy + r * 0.22);
      break;
    }
    case 'expose': {
      g.strokeCircle(cx, cy, r * 0.6);
      g.lineBetween(cx - r * 0.9, cy, cx - r * 0.3, cy);
      g.lineBetween(cx + r * 0.3, cy, cx + r * 0.9, cy);
      g.lineBetween(cx, cy - r * 0.9, cx, cy - r * 0.3);
      g.lineBetween(cx, cy + r * 0.3, cx, cy + r * 0.9);
      break;
    }
    case 'guard': {
      g.fillPoints([
        { x: cx - r * 0.7, y: cy - r * 0.7 }, { x: cx + r * 0.7, y: cy - r * 0.7 },
        { x: cx + r * 0.6, y: cy + r * 0.2 }, { x: cx, y: cy + r * 0.85 }, { x: cx - r * 0.6, y: cy + r * 0.2 },
      ], true);
      break;
    }
    case 'negate': {
      g.strokeCircle(cx, cy, r * 0.7);
      g.lineBetween(cx - r * 0.5, cy + r * 0.5, cx + r * 0.5, cy - r * 0.5);
      break;
    }
    case 'ward': {
      const pts = [];
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push({ x: cx + Math.cos(a) * r * 0.8, y: cy + Math.sin(a) * r * 0.8 });
      }
      g.strokePoints(pts, true);
      g.fillCircle(cx, cy, r * 0.22);
      break;
    }
    case 'thorns': {
      const pts = [];
      for (let i = 0; i < 16; i += 1) {
        const a = (Math.PI / 8) * i;
        const len = i % 2 === 0 ? r * 0.9 : r * 0.45;
        pts.push({ x: cx + Math.cos(a) * len, y: cy + Math.sin(a) * len });
      }
      g.fillPoints(pts, true);
      break;
    }
    case 'regen': {
      const t = r * 0.28;
      g.fillRect(cx - t, cy - r * 0.8, t * 2, r * 1.6);
      g.fillRect(cx - r * 0.8, cy - t, r * 1.6, t * 2);
      break;
    }
    case 'fuse': {
      g.fillCircle(cx - r * 0.1, cy + r * 0.2, r * 0.6);
      g.lineBetween(cx + r * 0.25, cy - r * 0.25, cx + r * 0.6, cy - r * 0.65);
      g.fillCircle(cx + r * 0.7, cy - r * 0.75, r * 0.18);
      break;
    }
    case 'buff':
    case 'debuff': {
      const up = kind === 'buff';
      const tip = up ? cy - r * 0.85 : cy + r * 0.85;
      const base = up ? cy - r * 0.05 : cy + r * 0.05;
      g.fillTriangle(cx - r * 0.7, base, cx + r * 0.7, base, cx, tip);
      const t = r * 0.25;
      g.fillRect(cx - t, up ? base : cy - r * 0.8, t * 2, r * 0.75);
      break;
    }
    default:
      g.fillCircle(cx, cy, r * 0.5);
  }
}

/** One status chip as an icon tile + value; hover previews its info, click/tap pins it. */
export function createStatusIconChip(scene: Phaser.Scene, chip: StatusChip, fontSize: number): StatusIconChip {
  const tile = statusIconTileSize(fontSize);
  const color = hexToNumber(STATUS_CHIP_COLOR[chip.kind] ?? UI.textDim);
  const edge = chip.polarity === 'buff' ? BUFF_EDGE : DEBUFF_EDGE;
  const bg = scene.add.graphics();
  bg.fillStyle(TILE_FILL, 0.95);
  bg.fillRoundedRect(0, 0, tile, tile, 3);
  bg.lineStyle(1.5, edge, 1);
  bg.strokeRoundedRect(0.75, 0.75, tile - 1.5, tile - 1.5, 3);
  const glyph = scene.add.graphics();
  drawGlyph(glyph, chip.kind, tile / 2, tile / 2, tile * 0.72, color);
  const parts: Phaser.GameObjects.GameObject[] = [bg, glyph];
  let width = tile;
  if (chip.value) {
    const value = scene.add.text(tile + 3, tile / 2, chip.value, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontSize + 1}px`, color: STATUS_CHIP_COLOR[chip.kind] ?? UI.textDim,
    }).setOrigin(0, 0.5);
    parts.push(value);
    width += 3 + value.width;
  }
  const container = scene.add.container(0, 0, parts).setSize(width, tile);
  const entries = chip.title ? [{ title: chip.title, body: chip.info ?? '' }] : [];
  let zone: Phaser.GameObjects.Rectangle | undefined;
  return {
    container, width, height: tile, label: chip.text,
    place(x, y, opts = {}) {
      container.setPosition(x, y);
      zone = addHoverTipZone(scene, { x, y, w: width, h: tile }, entries, 0, { pinOnClick: true, followTarget: opts.followTarget });
      return zone;
    },
    destroy() { zone?.destroy(); container.destroy(); },
  };
}
