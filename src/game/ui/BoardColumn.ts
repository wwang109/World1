import Phaser from 'phaser';
import type { SkillDef } from '../../engine/types';
import { CardToken } from './CardToken';
import type { ScalingStats, SkillFaceMode } from './skillPresentation';

/** A card placed at a starting slot; a size-N card occupies N slots. */
export interface ColumnPiece {
  skill: SkillDef;
  slot: number;
  state?: 'none' | 'cursor' | 'drag';
}

export interface BoardColumnOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  side?: 'left' | 'right';
  slotCount?: number;
  pieces: readonly ColumnPiece[];
  /** Deck context for each token's affinity "n/3" identity progress. */
  deck?: readonly SkillDef[];
  gap?: number;
  /** This side's owning combatant's live Attack/Magic Power — renders `base+stat` on card faces. */
  stats?: ScalingStats;
  /** Card-face number treatment override — see `CardTokenOptions.faceMode`.
   * Normally omitted: `CardToken` already defaults per ACTIVE platform. */
  faceMode?: SkillFaceMode;
}

/**
 * Lays a set of placed pieces into a fixed-height column of slots, rendering
 * one shared CardToken per card (size-N cards span N slot rows) and an empty
 * token for every unfilled slot. Battle boards, deck build, bag, and prep
 * skill columns are all just BoardColumn with different pieces + mode.
 */
export class BoardColumn {
  /** Every rendered slot (cards + empties), for the scene to track/destroy. */
  readonly tokens: Phaser.GameObjects.Container[] = [];

  constructor(scene: Phaser.Scene, opts: BoardColumnOptions) {
    const slotCount = opts.slotCount ?? 10;
    const side = opts.side ?? 'left';
    const gap = opts.gap ?? 5;
    const rowH = (opts.height - gap * (slotCount - 1)) / slotCount;

    const bySlot = new Map<number, ColumnPiece>();
    for (const piece of opts.pieces) bySlot.set(piece.slot, piece);

    const rowTop = (row: number): number => opts.y + row * (rowH + gap);

    let row = 0;
    while (row < slotCount) {
      const piece = bySlot.get(row);
      const span = piece ? Math.max(1, piece.skill.size) : 1;
      const top = rowTop(row);
      const h = rowH * span + gap * (span - 1);
      const cy = top + h / 2;
      const cx = opts.x + opts.width / 2;
      const label = span > 1 ? `${row + 1}-${row + span}` : `${row + 1}`;
      if (piece) {
        this.tokens.push(new CardToken(scene, cx, cy, piece.skill, {
          width: opts.width, height: h, side, slotLabel: label, deck: opts.deck, state: piece.state, stats: opts.stats, faceMode: opts.faceMode,
        }));
        row += span;
      } else {
        this.tokens.push(new EmptySlot(scene, cx, cy, opts.width, rowH, side, `${row + 1}`));
        row += 1;
      }
    }
  }
}

/** A flat, art-less empty slot showing only its number (matches CardToken). */
class EmptySlot extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, side: 'left' | 'right', label: string) {
    super(scene, x, y);
    const bg = scene.add.rectangle(0, 0, w, h, 0x121e30, 0.45).setOrigin(0.5).setStrokeStyle(1, 0x24344a, 0.9);
    const numX = side === 'left' ? w / 2 - 6 : -w / 2 + 6;
    const num = scene.add.text(numX, -h / 2 + 5, label, {
      fontSize: '10px', color: '#5a6880', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(side === 'left' ? 1 : 0, 0);
    this.add([bg, num]);
    scene.add.existing(this);
  }
}
