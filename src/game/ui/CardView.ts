import { Container, Graphics } from 'pixi.js';
import { weightOf, type SkillDef } from '../../engine/types';
import { ARCHETYPE_ICON, ELEMENT_ICON, PROPERTY_COLOR, PROPERTY_LABEL, UI, WEAPON_ICON } from '../theme';
import { makeText } from '../pixi/ui';

export const SLOT_W = 84;
export const CARD_H = 96;

/** A skill card drawn as a container; width = size * SLOT_W. */
export class CardView extends Container {
  readonly skill: SkillDef;
  private bg = new Graphics();
  private readonly w: number;
  private readonly h: number;
  private fillColor: number = UI.panelLight;
  private strokeColor: number;
  private strokeWidth = 2;

  constructor(skill: SkillDef, opts: { mini?: boolean } = {}) {
    super();
    this.skill = skill;
    this.w = skill.size * SLOT_W - 6;
    this.h = opts.mini ? CARD_H * 0.72 : CARD_H;
    this.strokeColor = PROPERTY_COLOR[skill.property];
    this.addChild(this.bg);
    this.redraw();

    const fontScale = opts.mini ? 0.8 : 1;
    const name = makeText(skill.name, {
      size: Math.round(12 * fontScale),
      align: 'center',
      wrapWidth: this.w - 8,
    });
    name.anchor.set(0.5, 0);
    name.position.set(0, -this.h / 2 + 10 * fontScale);
    this.addChild(name);

    const icons = skill.archetypes.map((a) => ARCHETYPE_ICON[a]).join('');
    const archText = makeText(icons, { size: Math.round(13 * fontScale) });
    archText.anchor.set(0, 0.5);
    archText.position.set(-this.w / 2 + 5, this.h / 2 - 16 * fontScale);
    this.addChild(archText);

    const kindIcon = skill.element ? ELEMENT_ICON[skill.element] : skill.weapon ? WEAPON_ICON[skill.weapon] : '';
    const propColor = PROPERTY_COLOR[skill.property];
    const kindText = makeText(`${kindIcon}${PROPERTY_LABEL[skill.property]} w${weightOf(skill)}`, {
      size: Math.round(10 * fontScale),
      color: `#${propColor.toString(16).padStart(6, '0')}`,
    });
    kindText.anchor.set(1, 0.5);
    kindText.position.set(this.w / 2 - 5, this.h / 2 - 16 * fontScale);
    this.addChild(kindText);
  }

  setHighlight(on: boolean, color = 0xffffff): void {
    this.strokeWidth = on ? 3 : 2;
    this.strokeColor = on ? color : PROPERTY_COLOR[this.skill.property];
    this.redraw();
  }

  setBgFill(color: number): void {
    this.fillColor = color;
    this.redraw();
  }

  private redraw(): void {
    this.bg
      .clear()
      .rect(-this.w / 2, -this.h / 2, this.w, this.h)
      .fill(this.fillColor)
      .stroke({ width: this.strokeWidth, color: this.strokeColor });
  }
}
