import Phaser from 'phaser';
import { weightOf, type SkillDef } from '../../engine/types';
import { ELEMENT_COLOR, FONT, PROPERTY_COLOR, UI, WEAPON_COLOR } from '../theme';
import { cardType, IDENTITY_THRESHOLD } from '../../engine/combat/typeIdentity';
import { fantasyTemplateCardArtKey } from './cardArtPresentation';
import { summarizeEffects, type ScalingStats } from './skillPresentation';
import { cardTokenSpec, type CardTokenSpec } from './cardTokenSpec';

/** A small badge rendered into the token's reserved accessory rail
 *  (gem socket, tier plate, …). Purely visual — the caller owns meaning. */
export interface TokenAccessory {
  /** 1–2 chars, e.g. '◆' for a gem socket. */
  label: string;
  /** Box fill; defaults to the muted panel tone. */
  color?: number;
  /** Label color; defaults to bronze accent. */
  textColor?: string;
}

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
  /** The current combatant's live Attack/Magic Power — renders `base+stat` on damage/heal/shield lines. */
  stats?: ScalingStats;
  /** Badges for the accessory rail (rendered bottom-up on the inward edge). */
  accessories?: TokenAccessory[];
}

const GRADIENT_KEY = 'cardtoken-gradient';

/**
 * THE shared card token strip. One component for battle boards, deck build,
 * bag, and prep skill columns. Everything is derived from the real SkillDef +
 * theme maps + card-art catalog — no per-screen copies, no hand-typed values.
 *
 * ALL region geometry comes from `cardTokenSpec.ts` (accent stripe, text
 * lines, corner badges, accessory rail). To move/resize an area or add a new
 * attachment point, change the spec — not this renderer and never a scene.
 */
export class CardToken extends Phaser.GameObjects.Container {
  /** Construction args, kept so `spawnGhost()` can clone this token. */
  readonly sourceSkill: SkillDef;
  readonly sourceOpts: CardTokenOptions;

  /** Art clip mask — drawn in WORLD coords, so it must be redrawn when the token moves. */
  private artMask?: Phaser.GameObjects.Graphics;
  private maskW = 0;
  private maskH = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, skill: SkillDef, opts: CardTokenOptions) {
    super(scene, x, y);
    this.sourceSkill = skill;
    this.sourceOpts = opts;
    const { width: w, height: h } = opts;
    const side = opts.side ?? 'left';
    const spec = cardTokenSpec(w, h, side, opts.accessories?.length ?? 0);

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
      this.artMask = maskShape;
      this.maskW = w;
      this.maskH = h;
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
    this.add(scene.add.rectangle(spec.accent.x, 0, spec.accent.width, h, accentColor).setOrigin(0.5));

    // text block: NAME · effects summary · affinity(n/3) — all from data,
    // positioned/clamped by the spec's line entries.
    const line = (entry: { dy: number; fontSize: number; maxWidth: number }, text: string, color: string, serif = false): void => {
      const t = scene.add.text(spec.textX, entry.dy, text, {
        fontSize: `${entry.fontSize}px`, color, fontFamily: serif ? FONT.display : FONT.body, fontStyle: 'bold', align: spec.textAlign,
      }).setOrigin(spec.textOriginX, 0.5);
      let s = text;
      while (s.length > 1 && t.width > entry.maxWidth) { s = s.slice(0, -1); t.setText(`${s}…`); }
      this.add(t);
    };
    if (!spec.compact) {
      line(spec.name, skill.name, '#e8e0c8', true);
      line(spec.effects, summarizeEffects(skill, opts.stats), '#e8d8b0'); // DMG 16 · PSN 5 (real, from effects)
      line(spec.affinity, this.affinityLine(skill, type, opts.deck), '#9aa4b6');
    } else {
      // COMPACT (slim strips like TEMP HOLDING): one centered line, clamped to
      // the token width so long names never overflow the strip.
      line(spec.compactLine, `${skill.name} · ${summarizeEffects(skill, opts.stats)}`, '#e8e0c8');
    }

    // small dark scrim so a corner label stays readable over bright art.
    const scrimLabel = (t: Phaser.GameObjects.Text): void => {
      const scrim = scene.add.rectangle(t.x, t.y, t.width + 8, t.height + 3, 0x0b1420, 0.55)
        .setOrigin(spec.cornerOriginX, t.originY);
      this.add(scrim);
      this.add(t);
    };

    // slot number — inward TOP corner. When there's no slot yet (an OFFER —
    // draft/shop/event card, not yet placed on a board), the same corner
    // instead advertises a multi-slot card's span so a player can never pick
    // a size-N card without knowing it eats N board slots.
    if (opts.slotLabel && spec.showSlotLabel) {
      scrimLabel(scene.add.text(spec.slotLabel.x, spec.slotLabel.y, opts.slotLabel, {
        fontSize: '10px', color: '#e6ecf5', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(spec.cornerOriginX, 0));
    } else if (!opts.slotLabel && skill.size > 1 && spec.showSlotLabel) {
      scrimLabel(scene.add.text(spec.slotLabel.x, spec.slotLabel.y, `×${skill.size} SLOTS`, {
        fontSize: '9px', color: '#e8b446', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(spec.cornerOriginX, 0));
    }

    // weight — inward BOTTOM corner badge
    scrimLabel(scene.add.text(spec.weight.x, spec.weight.y, `W${weightOf(skill)}`, {
      fontSize: '9px', color: '#c9a15a', fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(spec.cornerOriginX, 1));

    // accessory rail — gem sockets / tier plates / future attachments.
    this.renderAccessories(scene, spec, opts.accessories ?? []);

    if (opts.state === 'cursor' || opts.state === 'drag') {
      bg.setStrokeStyle(3, 0xe8b446, 1);
    }
    // Playback cursor badge: gold "▶ NEXT" chip, bottom-outward corner,
    // mirrored per side so it points into the gutter.
    if (opts.state === 'cursor') {
      const badgeText = side === 'left' ? '▶ NEXT' : 'NEXT ◀';
      const t = scene.add.text(spec.cursorBadge.x, spec.cursorBadge.y, badgeText, {
        fontSize: '9px', color: '#1a1208', fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(side === 'left' ? 1 : 0, 1);
      const chip = scene.add.rectangle(spec.cursorBadge.x, spec.cursorBadge.y, t.width + 10, t.height + 4, 0xe8b446)
        .setOrigin(side === 'left' ? 1 : 0, 1);
      this.add(chip);
      this.add(t);
    }
    this.setSize(w, h);
    scene.add.existing(this);
  }

  private renderAccessories(scene: Phaser.Scene, spec: CardTokenSpec, accessories: TokenAccessory[]): void {
    accessories.slice(0, spec.accessoryMax).forEach((acc, index) => {
      const box = spec.accessorySlot(index);
      const r = scene.add.rectangle(box.x, box.y, box.width, box.height, acc.color ?? UI.panelMuted, 0.92)
        .setOrigin(0.5).setStrokeStyle(1, UI.border, 0.9);
      const t = scene.add.text(box.x, box.y, acc.label, {
        fontSize: '10px', color: acc.textColor ?? UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(0.5);
      this.add(r);
      this.add(t);
    });
  }

  /**
   * A dimmed clone of this token left in the source slot while the real one
   * is dragged — plus a dashed outline so the origin reads as "will vacate".
   * Caller destroys it on drop (scene restarts usually handle it anyway).
   */
  spawnGhost(): Phaser.GameObjects.Container {
    const scene = this.scene;
    const ghost = new CardToken(scene, this.x, this.y, this.sourceSkill, { ...this.sourceOpts, state: 'none' });
    ghost.setAlpha(0.35);
    const { width: w, height: h } = this.sourceOpts;
    const outline = scene.add.graphics();
    outline.lineStyle(2, 0xe8b446, 0.75);
    const dash = 8; const gapLen = 6;
    const seg = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len; const uy = (y2 - y1) / len;
      for (let s0 = 0; s0 < len; s0 += dash + gapLen) {
        const e = Math.min(s0 + dash, len);
        outline.moveTo(x1 + ux * s0, y1 + uy * s0);
        outline.lineTo(x1 + ux * e, y1 + uy * e);
      }
    };
    seg(-w / 2, -h / 2, w / 2, -h / 2); seg(w / 2, -h / 2, w / 2, h / 2);
    seg(w / 2, h / 2, -w / 2, h / 2); seg(-w / 2, h / 2, -w / 2, -h / 2);
    outline.strokePath();
    ghost.add(outline);
    ghost.setDepth(500); // above the board, below the dragged token (1000)
    return ghost;
  }

  /**
   * Keep the world-space art mask aligned with the token as it moves (drag).
   * A geometry mask is not a child, so it does NOT follow the container on its
   * own — we redraw its rect at the new center here.
   */
  override setPosition(x?: number, y?: number, z?: number, w?: number): this {
    super.setPosition(x, y, z, w);
    if (this.artMask) {
      this.artMask.clear();
      this.artMask.fillStyle(0xffffff);
      this.artMask.fillRect(this.x - this.maskW / 2, this.y - this.maskH / 2, this.maskW, this.maskH);
    }
    return this;
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
