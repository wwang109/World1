import Phaser from 'phaser';
import { weightOf, type SkillDef } from '../../engine/types';
import { ELEMENT_COLOR, FONT, PROPERTY_COLOR, UI, WEAPON_COLOR } from '../theme';
import { cardType, IDENTITY_THRESHOLD } from '../../engine/combat/typeIdentity';
import { fantasyTemplateCardArtKey } from './cardArtPresentation';
import { summarizeEffects } from './skillPresentation';

export interface CardTokenOptions {
  width: number;
  height: number;
  /** Left column (your deck) or right column (opponent). Mirrors number + text. */
  side?: 'left' | 'right';
  /** Displayed slot number, e.g. "1" or "5-6". Empty tokens still show it. */
  slotLabel?: string;
  /** Deck the card belongs to — used for the affinity "n/3" identity progress. */
  deck?: readonly SkillDef[];
  /** Cursor / drag emphasis. */
  state?: 'none' | 'cursor' | 'drag';
}

const GRADIENT_KEY = 'cardtoken-gradient';

/**
 * THE shared mobile card token. One component for battle boards, deck build,
 * bag, and prep skill columns. Everything is derived from the real SkillDef +
 * theme maps + card-art catalog — no per-screen copies, no hand-typed values.
 *
 * Layout (left column; right column mirrors): [accent stripe · art with
 * left-anchored legibility gradient · name + "AFFINITY n/3" sub-line · slot
 * number pinned to the inward-top corner].
 */
export class CardToken extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, skill: SkillDef, opts: CardTokenOptions) {
    super(scene, x, y);
    const { width: w, height: h } = opts;
    const side = opts.side ?? 'left';
    // inward corner X in CENTER-relative coords: right edge (left col) / left edge (right col)
    const inwardX = side === 'left' ? w / 2 - 6 : -w / 2 + 6;

    // background panel
    const bg = scene.add.rectangle(0, 0, w, h, 0x121e30).setOrigin(0.5).setStrokeStyle(1, UI.battleOutline ?? 0x24344a, 0.9);
    this.add(bg);

    // card art, cover-fit and masked to the token rect. Children are LOCAL
    // (0,0 = token center); the geometry mask uses WORLD coords (this.x/y).
    const artKey = fantasyTemplateCardArtKey(skill);
    if (artKey && scene.textures.exists(artKey)) {
      const img = scene.add.image(0, 0, artKey);
      const scale = Math.max(w / img.width, h / img.height);
      img.setScale(scale);
      const maskShape = scene.make.graphics({}, false);
      maskShape.fillStyle(0xffffff);
      maskShape.fillRect(x - w / 2, y - h / 2, w, h);
      img.setMask(maskShape.createGeometryMask());
      this.add(img);
      // legibility gradient (dark on the text side, fading toward the art)
      const grad = scene.add.image(0, 0, this.ensureGradient(scene)).setDisplaySize(w, h);
      if (side === 'right') grad.setFlipX(true);
      this.add(grad);
    }

    // accent stripe — color straight from the theme maps (element > weapon > property)
    const type = cardType(skill);
    const accentColor = skill.element
      ? (ELEMENT_COLOR[skill.element] ?? PROPERTY_COLOR[skill.property])
      : skill.weapon
        ? (WEAPON_COLOR[skill.weapon] ?? PROPERTY_COLOR[skill.property])
        : PROPERTY_COLOR[skill.property];
    const accentX = side === 'left' ? -w / 2 + 2 : w / 2 - 2;
    this.add(scene.add.rectangle(accentX, 0, 4, h, accentColor).setOrigin(0.5));

    // text block: NAME · effects summary · affinity(n/3) — all from data.
    const textAlign = side === 'left' ? 'left' : 'right';
    const textX = side === 'left' ? -w / 2 + 10 : w / 2 - 10;
    const nameOrigin = side === 'left' ? 0 : 1;
    const line = (dy: number, text: string, size: string, color: string): void => {
      this.add(scene.add.text(textX, dy, text, {
        fontSize: size, color, fontFamily: size === '12px' ? FONT.display : FONT.body, fontStyle: 'bold', align: textAlign,
      }).setOrigin(nameOrigin, 0.5));
    };
    line(-14, skill.name, '12px', '#e8e0c8');
    line(1, summarizeEffects(skill), '10px', '#e8d8b0');       // DMG 16 · PSN 5 (real, from effects)
    line(15, this.affinityLine(skill, type, opts.deck), '9px', '#9aa4b6');

    // slot number — inward TOP corner
    if (opts.slotLabel) {
      this.add(scene.add.text(inwardX, -h / 2 + 5, opts.slotLabel, {
        fontSize: '10px', color: '#aab4c6', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(side === 'left' ? 1 : 0, 0));
    }

    // weight — inward BOTTOM corner badge
    const weightText = scene.add.text(inwardX, h / 2 - 5, `W${weightOf(skill)}`, {
      fontSize: '9px', color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(side === 'left' ? 1 : 0, 1);
    this.add(weightText);

    if (opts.state === 'cursor' || opts.state === 'drag') {
      bg.setStrokeStyle(3, 0xe8b446, 1);
    }
    this.setSize(w, h);
    scene.add.existing(this);
  }

  /** "SWORD 2/3" — affinity name + deck progress toward its identity (gold at 3/3). */
  private affinityLine(skill: SkillDef, type: ReturnType<typeof cardType>, deck?: readonly SkillDef[]): string {
    const label = skill.element
      ? skill.element.toUpperCase()
      : skill.weapon
        ? (skill.weapon === 'beast' ? 'BEAST' : skill.weapon.toUpperCase())
        : 'TRUE';
    if (!deck || !type) return label;
    const count = deck.filter((d) => {
      const t = cardType(d);
      return t !== undefined && t.kind === type.kind && t.type === type.type;
    }).length;
    return `${label} ${Math.min(count, IDENTITY_THRESHOLD)}/${IDENTITY_THRESHOLD}`;
  }

  /** A reusable 1px-tall horizontal gradient texture: opaque dark → transparent. */
  private ensureGradient(scene: Phaser.Scene): string {
    if (scene.textures.exists(GRADIENT_KEY)) return GRADIENT_KEY;
    const tex = scene.textures.createCanvas(GRADIENT_KEY, 64, 1);
    if (!tex) return GRADIENT_KEY;
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(11,20,32,0.93)');
    g.addColorStop(0.46, 'rgba(11,20,32,0.80)');
    g.addColorStop(1, 'rgba(11,20,32,0.20)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 1);
    tex.refresh();
    return GRADIENT_KEY;
  }
}
