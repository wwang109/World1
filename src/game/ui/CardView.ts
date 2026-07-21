import Phaser from 'phaser';
import { cardType } from '../../engine/combat/typeIdentity';
import type { SkillDef } from '../../engine/types';
import { FONT, PROPERTY_COLOR, PROPERTY_LABEL, TIER_COLOR, UI } from '../theme';
import { summarizeEffects } from './skillPresentation';

export const SLOT_W = 62;
export const CARD_H = 92;

/** Mix `tint` into `base` by `t` (0..1) — used to wash the card in its property color. */
function blendColor(base: number, tint: number, t: number): number {
  const b = Phaser.Display.Color.IntegerToColor(base);
  const c = Phaser.Display.Color.IntegerToColor(tint);
  const r = Math.round(b.red + (c.red - b.red) * t);
  const g = Math.round(b.green + (c.green - b.green) * t);
  const bl = Math.round(b.blue + (c.blue - b.blue) * t);
  return (r << 16) | (g << 8) | bl;
}

// Phaser's word wrap never breaks inside a hyphenated word, so "Follow-Through"
// overflows a narrow card; give it an explicit break opportunity after hyphens.
function wrappableName(name: string, narrow: boolean): string {
  return narrow ? name.replace(/-/g, '-\n') : name;
}

/**
 * Card face: name + what the card does. Everything else is color-coded —
 * the border is the TIER color, the fill is washed with the PROPERTY color.
 * PL, weight, size and archetypes live in the inspect panel.
 */
export class CardView extends Phaser.GameObjects.Container {
  readonly skill: SkillDef;
  private bg: Phaser.GameObjects.Rectangle;
  private baseStrokeWidth: number;
  private baseStrokeColor: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    skill: SkillDef,
    opts: { mini?: boolean; fillColor?: number } = {},
  ) {
    super(scene, x, y);
    this.skill = skill;

    const w = skill.size * SLOT_W - 8;
    const h = opts.mini ? 68 : CARD_H;
    const fillColor = blendColor(opts.fillColor ?? UI.panel, PROPERTY_COLOR[skill.property], 0.24);
    const effectsLine = summarizeEffects(skill);
    const narrow = w < 78;

    // The card's type family (weapon/element) — what board identity counts.
    const type = cardType(skill);
    const typeLabel = type ? String(type.type).toUpperCase() : PROPERTY_LABEL[skill.property];

    this.baseStrokeWidth = opts.mini ? 1.5 : 2;
    this.baseStrokeColor = TIER_COLOR[skill.tier];
    const shadow = scene.add.rectangle(2, 3, w, h, UI.shadow, 0.16);
    this.bg = scene.add.rectangle(0, 0, w, h, fillColor).setStrokeStyle(this.baseStrokeWidth, this.baseStrokeColor);

    const bandH = opts.mini ? 16 : 18;
    const bandY = h / 2 - bandH / 2 - 4;
    const typeBand = scene.add.rectangle(0, bandY, w - 10, bandH, 0x000000, 0.32).setOrigin(0.5);

    const name = scene.add
      .text(0, -h / 2 + (opts.mini ? 8 : 10), wrappableName(skill.name, narrow), {
        fontSize: opts.mini || narrow ? '9px' : '11px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: w - 10, useAdvancedWrap: true },
        maxLines: 2,
        fixedWidth: w - 10,
      })
      .setOrigin(0.5, 0);
    name.setLineSpacing(-2);

    // What the card does, between the name and the type band.
    const effectsY = opts.mini ? 6 : 10;
    const effects = scene.add
      .text(0, effectsY, effectsLine, {
        fontSize: opts.mini || narrow ? '8px' : '9px',
        color: UI.text,
        fontFamily: FONT.body,
        align: 'center',
        wordWrap: { width: w - 8, useAdvancedWrap: true },
        maxLines: 2,
      })
      .setOrigin(0.5);
    effects.setLineSpacing(-2);

    // Truncated to one line — a long type name never spills past the band.
    const typeText = scene.add
      .text(0, bandY, typeLabel, {
        fontSize: narrow ? '7px' : '8px',
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: w - 12, useAdvancedWrap: true },
        maxLines: 1,
      })
      .setOrigin(0.5);

    this.add([shadow, this.bg, typeBand, name, effects, typeText]);
    this.setSize(w, h);
    scene.add.existing(this);
  }

  setHighlight(on: boolean, color = 0xffffff): void {
    this.bg.setStrokeStyle(on ? this.baseStrokeWidth + 1.5 : this.baseStrokeWidth, on ? color : this.baseStrokeColor);
  }

  setBgFill(color: number): void {
    this.bg.setFillStyle(color);
  }
}
