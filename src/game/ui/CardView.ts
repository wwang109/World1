import Phaser from 'phaser';
import { weightOf, type SkillDef } from '../../engine/types';
import { ARCHETYPE_ICON, ELEMENT_ICON, PROPERTY_COLOR, PROPERTY_LABEL, UI, WEAPON_ICON } from '../theme';

export const SLOT_W = 84;
export const CARD_H = 96;

/** A skill card drawn as a container; width = size * SLOT_W. */
export class CardView extends Phaser.GameObjects.Container {
  readonly skill: SkillDef;
  private bg: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, skill: SkillDef, opts: { mini?: boolean } = {}) {
    super(scene, x, y);
    this.skill = skill;
    const w = skill.size * SLOT_W - 6;
    const h = opts.mini ? CARD_H * 0.72 : CARD_H;
    const propColor = PROPERTY_COLOR[skill.property];

    this.bg = scene.add.rectangle(0, 0, w, h, UI.panelLight).setStrokeStyle(2, propColor);
    this.add(this.bg);

    const icons = skill.archetypes.map((a) => ARCHETYPE_ICON[a]).join('');
    const fontScale = opts.mini ? 0.8 : 1;
    this.add(
      scene.add
        .text(0, -h / 2 + 10 * fontScale, skill.name, {
          fontSize: `${Math.round(12 * fontScale)}px`,
          color: UI.text,
          fontFamily: 'monospace',
          align: 'center',
          wordWrap: { width: w - 8 },
        })
        .setOrigin(0.5, 0),
    );
    this.add(
      scene.add
        .text(-w / 2 + 5, h / 2 - 16 * fontScale, icons, {
          fontSize: `${Math.round(13 * fontScale)}px`,
          fontFamily: 'monospace',
        })
        .setOrigin(0, 0.5),
    );
    const kindIcon = skill.element ? ELEMENT_ICON[skill.element] : skill.weapon ? WEAPON_ICON[skill.weapon] : '';
    this.add(
      scene.add
        .text(w / 2 - 5, h / 2 - 16 * fontScale, `${kindIcon}${PROPERTY_LABEL[skill.property]} w${weightOf(skill)}`, {
          fontSize: `${Math.round(10 * fontScale)}px`,
          color: `#${propColor.toString(16).padStart(6, '0')}`,
          fontFamily: 'monospace',
        })
        .setOrigin(1, 0.5),
    );
    this.setSize(w, h);
    scene.add.existing(this);
  }

  setHighlight(on: boolean, color = 0xffffff): void {
    this.bg.setStrokeStyle(on ? 3 : 2, on ? color : PROPERTY_COLOR[this.skill.property]);
  }

  setBgFill(color: number): void {
    this.bg.setFillStyle(color);
  }
}
