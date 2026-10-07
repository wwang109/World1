import Phaser from 'phaser';
import { type SkillDef, type SkillTier } from '../../engine/types';
import { FONT, UI } from '../theme';
import { templateBadgeTextureKey } from './cardArtPresentation';
import { buildCardArtPlaceholder } from './cardArtPlaceholder';
import { whenCardArtReady } from './cardArtLoader';
import { cardTextWords, keywordTextColor } from './cardTextMarkup';
import {
  archetypeEntry,
  propertyEntry,
  skillKeywordEntries,
  slotEntry,
  targetingEntry,
  tierEntry,
  typeBadgeEntries,
  weightEntry,
  type GlossaryEntry,
} from './cardGlossary';
import {
  buildFantasyCardTemplateModel,
  buildSlotGlyphText,
  buildWeightPlateText,
  type FantasyArtAnchor,
} from './fantasyCardTemplateModel';
import { fantasyTitleLayout, type RegionBox, type FantasyCardTemplateSpec, type FantasyCardTemplateVariant } from './fantasyCardTemplateSpec';
import { makeClassicCardBody, makePrintedCardBody } from './fantasyCardPrintedBody';
import { applyCardFinish } from './fantasyCardFinish';
import { driftCardArt } from './cardArtDrift';
import { whenFantasyCardChromeReady } from './fantasyCardChromeLoader';
import { isAoeSkill } from './skillPresentation';
import type { TierProgress } from '../../run/shop';

export interface FantasyCardTemplateV2Options {
  width?: number;
  height?: number;
  tier?: SkillTier;
  artAnchor?: FantasyArtAnchor;
  /** Hover/tap explanations on badges, weight, slots, and rules text. Default on. */
  glossary?: boolean;
  /** This instance's merge progress toward the next tier; renders as pips
   * above the tier diamond. Omitted (or Diamond tier) shows no pips. */
  progress?: TierProgress;
  template?: FantasyCardTemplateVariant;
  artwork?: boolean;
  finish?: boolean;
}

/**
 * Spec-driven card renderer. Every element is placed by a named region rect
 * from FANTASY_CARD_TEMPLATE_SPEC scaled by ONE uniform factor — no per-tier,
 * per-card, or per-element pixel offsets (see docs/card-template-spec.md §1).
 */
/**
 * PHASER OBJECT NAMES for the card`s two TEXT surfaces, exported so an
 * out-of-process audit can find them exactly rather than by guessing at child
 * order or font family.
 *
 * `scripts/card-face-truncation-audit.ts` (GATE 2) has to read the words each
 * one really holds, and both of its first heuristics were wrong: "the first
 * child Container whose children are all Text" is the WEIGHT PLATE (2 Texts),
 * not the body (up to 11); and "the Text whose fontFamily contains Cinzel"
 * matched nothing, because `FONT.display` is a Georgia stack. Those two
 * mistakes reported every card at every width as fully overflowing and every
 * title as intact — a gate answering confidently and wrongly, which is worse
 * than no gate. A name cannot be wrong.
 */
export const FANTASY_CARD_BODY_NAME = 'fantasy-card-body';
export const FANTASY_CARD_TITLE_NAME = 'fantasy-card-title';
const FINISH_EFFECTS_MIN_WIDTH = 200;
const ART_DRIFT_ZOOM = 1.06;
const TITLE_MIN_FONT_PX = 8;


export class FantasyCardTemplateV2 extends Phaser.GameObjects.Container {
  private readonly cardScale: number;
  private readonly spec: FantasyCardTemplateSpec;
  private glossaryTip?: Phaser.GameObjects.Container;
  private skinTrimColor = 0xffffff;
  /** Art clip mask — WORLD-space, so it must be redrawn whenever the card moves. */
  private artMask?: Phaser.GameObjects.Graphics;
  /** The art mask's rect in CARD-local coords (offsets from this.x/this.y). */
  private artMaskLocal?: { x: number; y: number; w: number; h: number; r: number };

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    skill: SkillDef,
    options: FantasyCardTemplateV2Options = {},
  ) {
    super(scene, x, y);

    const model = buildFantasyCardTemplateModel(skill, options);
    const spec = model.spec;
    this.spec = spec;
    this.cardScale = Math.min(
      model.size.width / spec.baseSize.width,
      model.size.height / spec.baseSize.height,
    );
    const width = Math.round(spec.baseSize.width * this.cardScale);
    const height = Math.round(spec.baseSize.height * this.cardScale);
    const halfW = width / 2;
    const halfH = height / 2;

    // The silhouette stays tier-colored. Weapon identity belongs to the
    // weapon badge frame, not the entire card border.
    const silhouetteTrim = model.skin.trimColor;
    this.add(this.makeFrame(scene, width, height, silhouetteTrim));
    this.add(this.makeArt(scene, model, halfW, halfH, options.artwork !== false));
    if (spec.printed) {
      this.add(this.makePrintedChrome(scene, model, halfW, halfH));
    } else {
      this.add(this.makeCornerArt(scene, halfW, halfH, silhouetteTrim, model.skin.accentColor));
      this.add(this.makeTextPlate(scene, model, halfW, halfH));
    }
    this.add(this.makeBadges(scene, model, halfW, halfH).setName('fantasy-card-badges'));
    this.add(this.makeWtPlate(scene, model, halfW, halfH));
    this.add(this.makeTierDiamond(scene, model, halfW, halfH));
    const pips = this.makeTierProgressPips(scene, model, halfW, halfH);
    if (pips) this.add(pips);
    this.add(this.makeSlotDisplay(scene, model, halfW, halfH));
    this.add(this.makeTitle(scene, model, halfW, halfH));
    if (!spec.printed) this.add(this.makeDivider(scene, model, halfW, halfH));
    this.add(this.makeBody(scene, model, halfW, halfH));

    this.skinTrimColor = silhouetteTrim;
    if (options.glossary !== false) {
      this.addGlossaryZones(scene, model, halfW, halfH);
    }

    this.setSize(width, height);
    this.setData({ templateVariant: model.template, templateRegions: model.regions, templateModel: model });
    scene.add.existing(this);
    if (options.finish !== false) applyCardFinish(this, { effects: width >= FINISH_EFFECTS_MIN_WIDTH });
  }

  /**
   * Keep the world-space art mask aligned with the card as it moves (grid
   * scroll, drag). A geometry mask is not a child, so it does NOT follow the
   * container on its own — redraw its rounded rect at the new position here.
   */
  override setPosition(x?: number, y?: number, z?: number, w?: number): this {
    super.setPosition(x, y, z, w);
    if (this.artMask && this.artMaskLocal) {
      const m = this.artMaskLocal;
      this.artMask.clear();
      this.artMask.fillStyle(0xffffff, 1);
      this.artMask.fillRoundedRect(this.x + m.x, this.y + m.y, m.w, m.h, m.r);
    }
    return this;
  }

  private addGlossaryZones(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): void {
    const spec = this.spec;
    const stack = spec.archetypeStack;
    const rail = spec.regions.rightRail;
    // AoE targeting reads from the printed body text (a scope: 'all' tier's
    // authored/retexted prose says so — validated at content build time), so
    // its explanation lives on the SAME tap zone as the mechanical keywords
    // below rather than a new region.
    const keywords = [
      ...(isAoeSkill(model.skill) ? [targetingEntry()] : []),
      ...skillKeywordEntries(model.skill),
    ];

    const zones: Array<{ box: RegionBox; entries: GlossaryEntry[] }> = [
      { box: spec.regions.typeBadge, entries: typeBadgeEntries(model.skill) },
      { box: spec.regions.wtPlate, entries: [weightEntry(model.skill)] },
      { box: spec.regions.tierDiamond, entries: [tierEntry(model.tier)] },
      { box: spec.regions.slotLabel, entries: [slotEntry(model.skill)] },
      {
        box: spec.regions.bodyBox,
        entries: keywords.length > 0 ? keywords : [propertyEntry(model.skill.property)],
      },
      ...model.archetypes.slice(0, stack.max).map((badge, index) => ({
        box: {
          x: rail.x + (rail.w - stack.w) / 2,
          y: rail.y + stack.firstCenterY + index * stack.pitch - stack.h / 2,
          w: stack.w,
          h: stack.h,
        },
        entries: [archetypeEntry(badge.archetype)],
      })),
    ];

    for (const { box, entries } of zones) {
      const scaled = this.region(box);
      const zone = scene.add
        .zone(-halfW + scaled.x + scaled.w / 2, -halfH + scaled.y + scaled.h / 2, scaled.w, scaled.h)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.showGlossary(scene, entries, halfW, halfH));
      zone.on('pointerdown', () => this.showGlossary(scene, entries, halfW, halfH));
      zone.on('pointerout', () => this.hideGlossary());
      this.add(zone);
    }
  }

  private showGlossary(scene: Phaser.Scene, entries: GlossaryEntry[], halfW: number, halfH: number): void {
    this.hideGlossary();
    const spec = this.spec;
    const box = this.region(spec.regions.glossaryTip);
    const pad = Math.max(8, this.px(spec.glossaryText.pad));
    const left = -halfW + box.x;
    const top = -halfH + box.y;
    const wrapWidth = box.w - pad * 2;

    const texts: Phaser.GameObjects.Text[] = [];
    let cursorY = 0;
    for (const entry of entries) {
      const hasBody = entry.body.trim().length > 0;
      const title = scene.add.text(left + pad, 0, entry.title.toUpperCase(), {
        fontFamily: FONT.body,
        fontStyle: 'bold',
        fontSize: `${Math.max(9, this.px(spec.glossaryText.titleFontSize))}px`,
        color: '#ffd98a',
        wordWrap: { width: wrapWidth, useAdvancedWrap: true },
      }).setOrigin(0, 0).setData('offset', cursorY);
      cursorY += title.height + this.px(hasBody ? 2 : 10);
      texts.push(title);
      if (hasBody) {
        const bodyText = scene.add.text(left + pad, 0, entry.body, {
          fontFamily: FONT.body,
          fontSize: `${Math.max(8, this.px(spec.glossaryText.bodyFontSize))}px`,
          color: '#f1efe8',
          wordWrap: { width: wrapWidth, useAdvancedWrap: true },
          lineSpacing: this.px(2),
        }).setOrigin(0, 0).setData('offset', cursorY);
        cursorY += bodyText.height + this.px(10);
        texts.push(bodyText);
      }
      if (cursorY > box.h - pad * 2) break;
    }

    const contentH = Math.min(box.h, cursorY - this.px(10) + pad * 2);
    // The tip region sits BELOW the card silhouette — top-anchor and grow
    // downward so explanations never cover any part of the card.
    const bgTop = top;
    for (const text of texts) {
      text.setY(bgTop + pad + (text.getData('offset') as number));
    }

    const bg = scene.add.graphics();
    bg.fillStyle(0x081019, 0.95);
    bg.fillRoundedRect(left, bgTop, box.w, contentH, this.px(12));
    bg.lineStyle(2, this.skinTrimColor, 0.9);
    bg.strokeRoundedRect(left + 1, bgTop + 1, box.w - 2, contentH - 2, this.px(12));

    const tip = scene.add.container(0, 0, [bg, ...texts]);
    this.add(tip);
    this.glossaryTip = tip;
  }

  private hideGlossary(): void {
    this.glossaryTip?.destroy();
    this.glossaryTip = undefined;
  }

  private region(box: RegionBox): RegionBox {
    return {
      x: Math.round(box.x * this.cardScale),
      y: Math.round(box.y * this.cardScale),
      w: Math.round(box.w * this.cardScale),
      h: Math.round(box.h * this.cardScale),
    };
  }

  private px(value: number): number {
    return Math.round(value * this.cardScale);
  }

  private makeFrame(
    scene: Phaser.Scene,
    width: number,
    height: number,
    trimColor: number,
  ): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    const halfW = width / 2;
    const halfH = height / 2;
    const radius = this.px(this.spec.cornerRadius);
    if (this.spec.printed) {
      const style = this.spec.printed;
      g.fillStyle(style.background, 1);
      g.fillRoundedRect(-halfW, -halfH, width, height, radius);
      return g;
    }
    // Full-art direction: no heavy border — dark base under the art plus one
    // thin tier-colored trim line hugging the silhouette.
    g.fillStyle(0x120f17, 1);
    g.fillRoundedRect(-halfW, -halfH, width, height, radius);
    g.lineStyle(2, trimColor, 0.9);
    g.strokeRoundedRect(-halfW + 3, -halfH + 3, width - 6, height - 6, Math.max(8, radius - 3));
    return g;
  }

  private makeArt(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
    artwork: boolean,
  ): Phaser.GameObjects.Container {
    const group = scene.add.container(0, 0);
    const spec = this.spec;
    const artRegion = this.region(model.regions.artFrame);
    const radius = this.px(spec.printed?.artRadius ?? spec.cornerRadius);
    const x = -halfW + artRegion.x;
    const y = -halfH + artRegion.y;

    // The clip is built UNCONDITIONALLY now, because the art region always has
    // something in it: the placeholder first, then the real art on top of it
    // whenever `cardArtLoader` delivers. Geometry masks live in WORLD space,
    // not container space, so it is drawn at the container's world position
    // and kept invisible; the card-local rect is tracked so setPosition() can
    // redraw it when the card moves (e.g. the wiki gallery scrolling).
    const maskShape = scene.add.graphics();
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRoundedRect(this.x + x, this.y + y, artRegion.w, artRegion.h, radius);
    maskShape.setVisible(false);
    this.artMask = maskShape;
    this.artMaskLocal = { x, y, w: artRegion.w, h: artRegion.h, r: radius };
    this.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());
    const mask = maskShape.createGeometryMask();

    // Placeholder — the card's own identity color + ghosted type badge. This
    // replaces the flat 0x1e2733 slab that the 94 art-less skills used to get,
    // and it is what a streaming card shows for the few frames before its
    // texture lands. One look serves both cases on purpose.
    const placeholder = buildCardArtPlaceholder(scene, model.skill, x, y, artRegion.w, artRegion.h);
    placeholder.setMask(mask);
    group.add(placeholder);

    if (artwork) whenCardArtReady(scene, model.skill.id, (artKey) => {
      // The card may have been destroyed while its art was in flight.
      if (!this.scene || !group.scene) return;
      const image = scene.add.image(0, 0, artKey);
      const source = image.texture.getSourceImage() as { width: number; height: number };
      const fit = Math.max(artRegion.w / source.width, artRegion.h / source.height) * ART_DRIFT_ZOOM;
      image.setDisplaySize(source.width * fit, source.height * fit);

      const anchorY = model.artAnchor === 'upper-center'
        ? y + image.displayHeight / 2
        : model.artAnchor === 'lower-center'
          ? y + artRegion.h - image.displayHeight / 2
          : y + artRegion.h / 2;
      image.setPosition(x + artRegion.w / 2, anchorY);
      image.setMask(mask);
      // Appended, so it covers the placeholder and nothing else: `group` is
      // one child of the card, already at the right depth under the plate.
      group.add(image);
      const travel = Math.min(anchorY - (y + artRegion.h - image.displayHeight / 2), y + image.displayHeight / 2 - anchorY);
      driftCardArt(image, anchorY, travel, model.skill.id);
    });

    return group;
  }

  // Thin tier-colored filigree in each corner so badges and empty art corners
  // don't float on nothing: double L-lines with a small diamond at the elbow,
  // drawn over the art, mirrored to all four corners from one set of spec
  // constants (no per-corner values).
  private makeCornerArt(
    scene: Phaser.Scene,
    halfW: number,
    halfH: number,
    trimColor: number,
    accentColor: number,
  ): Phaser.GameObjects.Graphics {
    const spec = this.spec.cornerArt;
    const inset = this.px(spec.inset);
    const length = this.px(spec.length);
    const innerGap = this.px(spec.innerGap);
    const diamond = this.px(spec.diamond);
    const overshoot = this.px(spec.overshoot);
    const g = scene.add.graphics();

    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cornerX = sx * (halfW - inset);
        const cornerY = sy * (halfH - inset);
        const elbowX = cornerX - sx * diamond * 2;
        const elbowY = cornerY - sy * diamond * 2;

        // soft dark underlay for contrast over bright art, then the trim line.
        // Each stroke overshoots the elbow so the two lines CROSS in a small
        // T/plus joint at the corner instead of just meeting.
        for (const [width, color, alpha] of [[3, 0x05090f, 0.4], [1.5, trimColor, 0.85]] as const) {
          g.lineStyle(width, color, alpha);
          g.beginPath();
          g.moveTo(elbowX - sx * length, elbowY);
          g.lineTo(elbowX + sx * overshoot, elbowY);
          g.strokePath();
          g.beginPath();
          g.moveTo(elbowX, elbowY + sy * overshoot);
          g.lineTo(elbowX, elbowY - sy * length);
          g.strokePath();
          // shorter inner echo line
          g.beginPath();
          g.moveTo(elbowX - sx * length * 0.55, elbowY - sy * innerGap);
          g.lineTo(elbowX - sx * innerGap, elbowY - sy * innerGap);
          g.lineTo(elbowX - sx * innerGap, elbowY - sy * length * 0.55);
          g.strokePath();
        }

        // diamond stud centered on the crossing
        g.fillStyle(accentColor, 0.95);
        g.fillPoints([
          new Phaser.Geom.Point(elbowX, elbowY - diamond),
          new Phaser.Geom.Point(elbowX + diamond, elbowY),
          new Phaser.Geom.Point(elbowX, elbowY + diamond),
          new Phaser.Geom.Point(elbowX - diamond, elbowY),
        ], true);
      }
    }
    return g;
  }

  private makePrintedChrome(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Container {
    const style = this.spec.printed!;
    const group = scene.add.container(0, 0).setName('fantasy-card-chrome').setData('rasterReady', false);
    const paperBox = this.region(model.regions.tierFrame);
    const paper = scene.add.rectangle(-halfW + paperBox.x, -halfH + paperBox.y, paperBox.w, paperBox.h, style.panel)
      .setOrigin(0, 0).setName('fantasy-card-rules-paper');
    group.add(paper);
    const fallback = scene.add.graphics();
    for (const [box, color] of [
      [model.regions.header!, style.bandColor],
      [model.regions.rulesBand!, style.bandColor],
      [model.regions.tierFrame, style.panel],
      [model.regions.footer!, style.background],
    ] as const) {
      const region = this.region(box);
      fallback.fillStyle(color, 1);
      fallback.fillRect(-halfW + region.x, -halfH + region.y, region.w, region.h);
    }
    group.add(fallback);
    const unsubscribe = whenFantasyCardChromeReady(scene, key => {
      if (!group.scene) return;
      const region = this.region(model.regions.artFrame);
      const raster = scene.add.image(-halfW + region.x, -halfH + region.y, key)
        .setOrigin(0, 0).setDisplaySize(region.w, region.h).setName('fantasy-card-chrome-raster');
      group.addAt(raster, 2);
      fallback.setVisible(false);
      group.setData('rasterReady', true);
      this.emit('chrome-ready');
    });
    group.once(Phaser.GameObjects.Events.DESTROY, unsubscribe);
    const trim = scene.add.graphics().setName('fantasy-card-tier-trim');
    for (const box of [model.regions.headerTrim!, model.regions.rulesTrim!, model.regions.bodyTrim!]) {
      const region = this.region(box);
      trim.lineStyle(Math.max(1, region.h), model.skin.trimColor, 1);
      const left = -halfW + region.x;
      const top = -halfH + region.y + region.h / 2;
      trim.lineBetween(left, top, left + region.w, top);
    }
    group.add(trim);
    const band = this.region(model.regions.rulesCaption!);
    const caption = scene.add.text(-halfW + band.x + band.w / 2, -halfH + band.y + band.h / 2, style.caption, {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: this.px(style.captionFontSize), color: style.titleInk,
    }).setOrigin(0.5).setName('fantasy-card-rules-caption');
    caption.setScale(Math.min(1, band.w / caption.width, band.h / caption.height));
    group.add(caption);
    return group;
  }

  private makeTextPlate(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Graphics {
    // Full-art scrim: a soft dark gradient rising from the card's lower third
    // so title/rules text reads over any art — no boxed plate, no border.
    const region = this.region(model.regions.tierFrame);
    const g = scene.add.graphics();
    const x = -halfW + region.x;
    const y = -halfH + region.y;
    const radius = this.px(this.spec.cornerRadius);
    const fadeH = Math.round(region.h * 0.3);
    g.fillGradientStyle(0x05090f, 0x05090f, 0x05090f, 0x05090f, 0, 0, 0.85, 0.85);
    g.fillRect(x, y, region.w, fadeH);
    g.fillStyle(0x05090f, 0.85);
    g.fillRoundedRect(x, y + fadeH, region.w, region.h - fadeH, { tl: 0, tr: 0, bl: radius, br: radius });
    return g;
  }

  private makeBadges(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Container {
    const group = scene.add.container(0, 0);
    const spec = this.spec;
    const typeRegion = this.region(model.regions.typeBadge);
    const right = this.region(model.regions.rightRail);
    const stack = spec.archetypeStack;

    const typeBadgeScale = 1;
    group.add(this.makeBadge(
      scene,
      -halfW + typeRegion.x + typeRegion.w / 2,
      -halfH + typeRegion.y + typeRegion.h / 2,
      typeRegion.w * typeBadgeScale,
      typeRegion.h * typeBadgeScale,
      model.type.color ?? UI.chip,
      model.type.iconKey,
      model.type.label,
    ).setName('fantasy-card-type-badge').setData('iconKey', model.type.iconKey));
    if (model.skill.weapon) {
      const cx = -halfW + typeRegion.x + typeRegion.w / 2;
      const cy = -halfH + typeRegion.y + typeRegion.h / 2;
      const radius = Math.min(typeRegion.w, typeRegion.h) * 0.48;
      const points = Array.from({ length: 6 }, (_, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 6;
        return new Phaser.Geom.Point(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      });
      const hexFrame = scene.add.graphics();
      hexFrame.lineStyle(Math.max(2, this.px(3)), model.type.color, 0.95);
      hexFrame.strokePoints(points, true, true);
      group.add(hexFrame);
    }

    model.archetypes.slice(0, stack.max).forEach((badge, index) => {
      group.add(
        this.makeBadge(
          scene,
          -halfW + right.x + right.w / 2,
          -halfH + right.y + this.px(stack.firstCenterY + index * stack.pitch),
          this.px(stack.w),
          this.px(stack.h),
          badge.color,
          badge.iconKey,
          badge.archetype.toUpperCase(),
        ).setName(`fantasy-card-archetype-badge-${index}`).setData({ archetype: badge.archetype, iconKey: badge.iconKey, index }),
      );
    });

    return group;
  }

  // Badge art carries its own plate/shape — the template draws NO chrome
  // behind it. Only the no-texture text fallback gets a minimal dark disc so
  // the label stays readable over art.
  private makeBadge(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
    iconKey?: string,
    fallbackLabel = '',
  ): Phaser.GameObjects.Container {
    const container = scene.add.container(0, 0);
    const textureKey = iconKey ? templateBadgeTextureKey(iconKey as never) : undefined;
    if (textureKey && scene.textures.exists(textureKey)) {
      container.add(scene.add.image(x, y, textureKey).setDisplaySize(width, height).setName('fantasy-card-badge-image'));
    } else {
      const g = scene.add.graphics();
      g.fillStyle(0x10151d, 0.9);
      g.fillCircle(x, y, Math.min(width, height) / 2);
      g.lineStyle(1.5, color, 0.9);
      g.strokeCircle(x, y, Math.min(width, height) / 2 - 1);
      container.add(g);
      container.add(scene.add.text(x, y, fallbackLabel.slice(0, 4), {
        fontFamily: FONT.body,
        fontStyle: 'bold',
        fontSize: `${Math.max(8, Math.round(Math.min(width, height) * 0.22))}px`,
        color: '#ffffff',
      }).setOrigin(0.5));
    }

    return container;
  }

  // Footer weight marker, bottom-left — mirrors the slot marker's typography
  // on the opposite side of the same row.
  private makeWtPlate(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Container {
    const container = scene.add.container(0, 0);
    const region = this.region(model.regions.wtPlate);
    const display = this.spec.slotDisplay;
    const left = -halfW + region.x;
    const centerY = -halfH + region.y + region.h / 2;
    const gap = Math.max(4, this.px(display.gap));

    const label = scene.add.text(left, centerY, 'WT', {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${Math.max(8, this.px(display.labelFontSize))}px`,
      color: '#f4ead0',
    }).setOrigin(0, 0.5);
    container.add(label);

    const wtRule = this.spec.textRules[model.wtRule];
    container.add(scene.add.text(left + label.width + gap, centerY, buildWeightPlateText(model.weight), {
      fontFamily: FONT.display,
      fontStyle: 'bold',
      fontSize: `${Math.max(10, this.px(wtRule.fontSize))}px`,
      color: '#ffffff',
      stroke: '#111722',
      strokeThickness: Math.max(1, this.px(2)),
    }).setOrigin(0, 0.5));

    return container;
  }

  // Tier marker: a diamond centered in the footer row whose fill IS the tier
  // color — bronze / silver / gold / diamond read at a glance.
  private makeTierDiamond(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Graphics {
    const region = this.region(model.regions.tierDiamond);
    const cx = -halfW + region.x + region.w / 2;
    const cy = -halfH + region.y + region.h / 2;
    const rx = region.w / 2;
    const ry = region.h / 2;
    const outer = [
      new Phaser.Geom.Point(cx, cy - ry),
      new Phaser.Geom.Point(cx + rx, cy),
      new Phaser.Geom.Point(cx, cy + ry),
      new Phaser.Geom.Point(cx - rx, cy),
    ];
    const inner = [
      new Phaser.Geom.Point(cx, cy - ry * 0.45),
      new Phaser.Geom.Point(cx + rx * 0.45, cy),
      new Phaser.Geom.Point(cx, cy + ry * 0.45),
      new Phaser.Geom.Point(cx - rx * 0.45, cy),
    ];
    const g = scene.add.graphics();
    g.fillStyle(model.skin.frameColor, 1);
    g.fillPoints(outer, true);
    g.lineStyle(Math.max(1, this.px(2)), 0x111722, 0.9);
    g.strokePoints(outer, true, true);
    g.lineStyle(1, model.skin.accentColor, 0.9);
    g.strokePoints(inner, true, true);
    return g;
  }

  /** Pips above the tier diamond, showing merge progress toward the next
   * tier. `null` when `model.progressPips` is `null` (no `progress` passed,
   * or the tier is Diamond). */
  private makeTierProgressPips(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Text | null {
    if (!model.progressPips) return null;
    const region = this.region(this.spec.printed?.progressBox ?? model.regions.tierDiamond);
    const cx = -halfW + region.x + region.w / 2;
    const cy = -halfH + region.y + (this.spec.printed ? region.h / 2 : -region.h * 0.55);
    return scene.add.text(cx, cy, model.progressPips, {
      fontFamily: FONT.body,
      fontSize: `${Math.max(7, this.px(9))}px`,
      color: '#f4ead0',
    }).setOrigin(0.5);
  }

  private makeSlotDisplay(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Container {
    const region = this.region(model.regions.slotLabel);
    const display = this.spec.slotDisplay;
    const container = scene.add.container(0, 0);
    const centerY = -halfH + region.y + region.h / 2;
    const gap = Math.max(4, this.px(display.gap));

    const label = scene.add.text(0, centerY, model.slotLabel, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${Math.max(8, this.px(display.labelFontSize))}px`,
      color: '#f4ead0',
    }).setOrigin(0, 0.5);

    const glyphText = scene.add.text(0, centerY, buildSlotGlyphText(model.slotBoxCount), {
      fontFamily: 'Courier New, Consolas, monospace',
      fontStyle: 'bold',
      fontSize: `${Math.max(9, this.px(display.glyphFontSize))}px`,
      color: '#f4ead0',
      stroke: '#111722',
      strokeThickness: Math.max(1, this.px(1)),
    }).setOrigin(0, 0.5);

    // Right-align the label + glyph group to the region's right edge so the
    // footprint marker sits tucked against the tier frame's upper corner.
    const totalW = label.width + gap + glyphText.width;
    const startX = -halfW + region.x + region.w - totalW;
    label.setX(startX);
    glyphText.setX(startX + label.width + gap);

    container.add(label);
    container.add(glyphText);
    return container;
  }

  private makeTitle(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Text {
    const region = this.region(model.regions.titleBox);
    if (this.spec.printed) {
      const rule = this.spec.textRules[model.titleRule];
      const title = scene.add.text(-halfW + region.x + region.w / 2, -halfH + region.y + region.h / 2, model.title, {
        fontFamily: FONT.display, fontStyle: 'bold', fontSize: Math.max(8, this.px(rule.fontSize)),
        color: this.spec.printed.titleInk, align: 'center',
      }).setOrigin(0.5).setName(FANTASY_CARD_TITLE_NAME);
      title.setScale(Math.min(1, region.w / Math.max(1, title.width), region.h / Math.max(1, title.height)));
      return title;
    }
    // Type AND line budget both come from `fantasyTitleLayout`, which derives
    // the budget from the DIVIDER the title has to clear — see that function's
    // doc comment for the overflow it closes. This used to read
    // `Math.max(13, px(rule.fontSize))` + `maxLines: rule.maxLines`, a font
    // floor with no matching floor on the geometry.
    const layout = fantasyTitleLayout(model.titleRule, this.cardScale, this.spec);
    const title = scene.add.text(
      -halfW + region.x + region.w / 2,
      -halfH + region.y,
      model.title,
      {
        fontFamily: FONT.display,
        fontStyle: 'bold',
        fontSize: `${layout.fontSize}px`,
        color: '#ffffff',
        align: 'center',
        fixedWidth: region.w,
        maxLines: layout.maxLines,
        wordWrap: { width: region.w, useAdvancedWrap: true },
        stroke: '#111722',
        strokeThickness: Math.max(1, this.px(2)),
      },
    ).setOrigin(0.5, 0).setName(FANTASY_CARD_TITLE_NAME);
    title.setLineSpacing(layout.lineSpacing);
    /**
     * THE TITLE GETS THE SAME CUE THE BODY DOES (2026-09-06, audit).
     *
     * Phaser's own `maxLines` truncates with NO marker, so at the 140px card
     * "Bramble Covenant" wraps to two lines under `title-medium`'s one-line
     * budget and simply renders "Bramble" — a card silently displaying a
     * DIFFERENT CARD'S plausible name. The body was fixed for exactly this and
     * the title was left doing it, on the same thumbnail, in the same frame.
     *
     * Measured with Phaser's OWN wrapper (`getWrappedText`) rather than a
     * character-width estimate: re-deriving the wrap is the mistake
     * `segmentedLineSurvivors` was deleted for making, and the real
     * proportional metrics are what decide this.
     */
    const fitFont = (lines: number, start: number): number => {
      let size = start;
      title.setFontSize(size);
      while (title.getWrappedText(model.title).length > lines && size > TITLE_MIN_FONT_PX) title.setFontSize(--size);
      return title.getWrappedText(model.title).length <= lines ? size : 0;
    };
    const oneLineFont = fitFont(layout.maxLines, layout.fontSize);
    const twoLineStart = Math.min(layout.fontSize, Math.floor(layout.room / (2 * (layout.lineHeight / layout.fontSize))));
    const twoLineFont = layout.maxLines < 2 && model.title.includes(' ') ? fitFont(2, twoLineStart) : 0;
    const lineBudget = twoLineFont > oneLineFont ? 2 : layout.maxLines;
    title.setMaxLines(lineBudget);
    title.setFontSize(lineBudget === 2 ? twoLineFont : oneLineFont || TITLE_MIN_FONT_PX);
    const wrapped = title.getWrappedText(model.title);
    if (wrapped.length > lineBudget) {
      const kept = wrapped.slice(0, lineBudget).map((line) => line.trimEnd());
      let last = kept[kept.length - 1] ?? '';
      const head = kept.slice(0, -1);
      const fits = (candidate: string): boolean =>
        title.getWrappedText([...head, candidate].join('\n')).length <= lineBudget;
      // Shed a word at a time first (a title cut mid-word reads as a typo),
      // then characters if a single word is itself too long for the line.
      while (last.includes(' ') && !fits(`${last}…`)) last = last.slice(0, last.lastIndexOf(' ')).trimEnd();
      while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
      title.setText([...head, `${last}…`].join('\n'));
    }
    return title;
  }

  private makeDivider(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Graphics {
    const region = this.region(model.regions.divider);
    const g = scene.add.graphics();
    g.fillStyle(model.skin.dividerColor, 0.9);
    g.fillRoundedRect(-halfW + region.x, -halfH + region.y, region.w, Math.max(2, region.h), 2);
    return g;
  }

  // Manual word-wrap so {{keyword}} tokens can carry their own color/weight —
  // Phaser text objects are single-style, so the body is laid out word by word.
  private makeBody(
    scene: Phaser.Scene,
    model: ReturnType<typeof buildFantasyCardTemplateModel>,
    halfW: number,
    halfH: number,
  ): Phaser.GameObjects.Container {
    const region = this.region(model.regions.bodyBox);
    const box = { ...region, x: -halfW + region.x, y: -halfH + region.y };
    if (this.spec.printed) return makePrintedCardBody(scene, model, box, this.cardScale, FANTASY_CARD_BODY_NAME);
    return makeClassicCardBody(scene, model.rows, box, this.cardScale, FANTASY_CARD_BODY_NAME);
  }
}
