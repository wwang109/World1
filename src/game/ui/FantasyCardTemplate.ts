import Phaser from 'phaser';
import { weightOf, type SkillDef, type SkillTier } from '../../engine/types';
import { FONT } from '../theme';
import {
  archetypeBadges,
  cardTypeBadge,
  fantasyTemplateCardArtKey,
  tierPlateStyle,
  type CardIconKey,
} from './cardArtPresentation';

export interface FantasyCardTemplateOptions {
  skillFrame?: 'frameless' | 'ornate';
  height?: number;
  lowerShadeStartRatio?: number;
  tier?: SkillTier;
  width?: number;
}

type CropFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type TextRule = {
  fontSize: string;
  lineSpacing?: number;
  maxChars: number;
  maxLines: number;
};

type ResolvedTextRules = {
  body: TextRule;
  title: TextRule;
};

type ResolvedCardTemplateLayout = {
  archetypes: {
    gap: number;
    h: number;
    max: number;
    w: number;
    xFromRight: number;
    yFromTop: number;
  };
  primaryArchetype: {
    h: number;
    w: number;
    xFromLeft: number;
    yFromTop: number;
  };
  skillBox: {
    frameCenterX: number;
    frameCenterY: number;
    frameH: number;
    frameW: number;
    h: number;
    sizeLabelX: number;
    sizeLabelY: number;
    top: number;
  };
  text: {
    bodyW: number;
    bodyX: number;
    bodyY: number;
    centerX: number;
    dividerW: number;
    dividerY: number;
    titleW: number;
    titleY: number;
  };
  textRules: ResolvedTextRules;
  wt: {
    fontSize: string;
    h: number;
    numberOffsetByTier: typeof CARD_TEMPLATE_LAYOUT.badges.wt.numberOffsetByTier;
    numberOffsetX: number;
    numberOffsetY: number;
    w: number;
    xFromLeft: number;
    yFromTop: number;
  };
};

const PARTS_KEY = 'card-template-parts';
const BADGE_TEXTURE_PREFIX = 'card-template-badge';
const WT_TEXTURE_PREFIX = 'card-template-wt';

const EXTRACTED_BADGE_TEXTURE_KEY: Partial<Record<CardIconKey, string>> = {
  sword: 'card-badge:template:sword',
  lance: 'card-badge:template:lance',
  axe: 'card-badge:template:axe',
  bow: 'card-badge:template:bow',
  fangs: 'card-badge:template:fangs',
  fire: 'card-badge:template:fire',
  frost: 'card-badge:template:frost',
  lightning: 'card-badge:template:lightning',
  nature: 'card-badge:template:nature',
  holy: 'card-badge:template:holy',
  dark: 'card-badge:template:dark',
  offense: 'card-badge:template:offense',
  defensive: 'card-badge:template:defensive',
  healing: 'card-badge:template:healing',
  support: 'card-badge:template:support',
  debuff: 'card-badge:template:debuff',
};

export const CARD_TEMPLATE_LAYOUT = {
  artMatte: {
    cornerRadius: 28,
    lowerShadeStartRatio: 0.66,
  },
  badges: {
    primaryArchetype: { xFromLeft: 44, yFromTop: 50, w: 58, h: 60 },
    wt: {
      xFromLeft: 44,
      yFromTop: 116,
      w: 56,
      h: 60,
      numberOffsetX: 0,
      numberOffsetY: 0,
      numberOffsetByTier: {
        bronze: { x: 0, y: 0 },
        silver: { x: 0, y: 2 },
        gold: { x: 0, y: 2 },
        diamond: { x: 0, y: 0 },
      },
    },
    type: { xFromLeft: 50, yFromTop: 184, w: 46, h: 48 },
    archetypes: { xFromRight: 40, yFromTop: 46, gap: 54, w: 50, h: 50, max: 3 },
  },
  skillBox: {
    heightRatio: 0.28,
    bottomPadding: 26,
    frameCenterOffsetX: 5,
    contentCenterOffsetX: 5,
    frameInsetX: 30,
    frameExtraH: 22,
    sizeLabel: { xFromCenter: 112, yFromFrameTop: 30, fontSize: '8px' },
    inner: {
      xPad: 48,
      titleTop: 43,
      dividerTop: 80,
      bodyTop: 96,
      titleWidthPad: 82,
      dividerWidthPad: 92,
      bodyWidthPad: 96,
    },
  },
  textRules: {
    title: [
      { maxChars: 14, fontSize: '24px', maxLines: 1, lineSpacing: -5 },
      { maxChars: 24, fontSize: '22px', maxLines: 1, lineSpacing: -5 },
      { maxChars: 40, fontSize: '20px', maxLines: 2, lineSpacing: -6 },
      { maxChars: Number.POSITIVE_INFINITY, fontSize: '18px', maxLines: 2, lineSpacing: -6 },
    ],
    body: [
      { maxChars: 90, fontSize: '13px', maxLines: 3, lineSpacing: 5 },
      { maxChars: 145, fontSize: '12px', maxLines: 4, lineSpacing: 4 },
      { maxChars: Number.POSITIVE_INFINITY, fontSize: '11px', maxLines: 5, lineSpacing: 3 },
    ],
  },
} as const;

const SKILL_BOX_FRAME: Record<SkillTier, CropFrame> = {
  bronze: { x: 116, y: 748, w: 860, h: 176 },
  silver: { x: 116, y: 935, w: 860, h: 176 },
  gold: { x: 116, y: 1122, w: 860, h: 176 },
  diamond: { x: 116, y: 1308, w: 860, h: 176 },
};

/**
 * Reusable full-bleed card template preview. The icon and border pieces are
 * cropped from the approved parts sheet so the live card matches the concept.
 */
export class FantasyCardTemplate extends Phaser.GameObjects.Container {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    skill: SkillDef,
    options: FantasyCardTemplateOptions = {},
  ) {
    super(scene, x, y);

    ensureTemplateFrames(scene);

    const width = options.width ?? 380;
    const height = options.height ?? 590;
    const lowerShadeStartRatio = options.lowerShadeStartRatio ?? CARD_TEMPLATE_LAYOUT.artMatte.lowerShadeStartRatio;
    const skillFrame = options.skillFrame ?? 'ornate';
    const tier = options.tier ?? skill.tier;
    const halfW = width / 2;
    const halfH = height / 2;
    const type = cardTypeBadge(skill);
    const archetypes = archetypeBadges(skill);
    const layout = resolveCardTemplateLayout(width, height, skill);
    const wtNumberOffset = layout.wt.numberOffsetByTier[tier];
    const children: Phaser.GameObjects.GameObject[] = [];

    this.addCardArt(children, scene, skill, width, height, lowerShadeStartRatio);

    const primaryArchetype = archetypes[0];
    if (primaryArchetype) {
      this.addBadgePart(
        children,
        scene,
        -halfW + layout.primaryArchetype.xFromLeft,
        -halfH + layout.primaryArchetype.yFromTop,
        primaryArchetype.iconKey,
        primaryArchetype.color,
        layout.primaryArchetype.w,
        layout.primaryArchetype.h,
      );
    }

    this.addWtPart(children, scene, -halfW + layout.wt.xFromLeft, -halfH + layout.wt.yFromTop, tier, layout.wt.w, layout.wt.h);
    children.push(scene.add.text(
      -halfW + layout.wt.xFromLeft + layout.wt.numberOffsetX + wtNumberOffset.x,
      -halfH + layout.wt.yFromTop + layout.wt.numberOffsetY + wtNumberOffset.y,
      String(weightOf(skill)),
      {
      fontSize: layout.wt.fontSize,
      color: '#ffffff',
      fontFamily: FONT.display,
      fontStyle: 'bold',
      stroke: '#211104',
      strokeThickness: 3,
      },
    ).setOrigin(0.5));
    this.addBadgePart(
      children,
      scene,
      halfW - layout.archetypes.xFromRight,
      -halfH + layout.archetypes.yFromTop,
      type.iconKey,
      type.color,
      layout.archetypes.w,
      layout.archetypes.h,
    );

    archetypes.slice(1, layout.archetypes.max).forEach((archetype, index) => {
      this.addBadgePart(
        children,
        scene,
        halfW - layout.archetypes.xFromRight,
        -halfH + layout.archetypes.yFromTop + (index + 1) * layout.archetypes.gap,
        archetype.iconKey,
        archetype.color,
        layout.archetypes.w,
        layout.archetypes.h,
      );
    });

    if (skillFrame === 'ornate') {
      this.addSheetPart(children, scene, layout.skillBox.frameCenterX, layout.skillBox.frameCenterY, frameName('skill-box', tier), layout.skillBox.frameW, layout.skillBox.frameH);
    } else {
      children.push(this.makeFramelessSkillPlate(scene, layout.skillBox.frameCenterX, layout.skillBox.frameCenterY, layout.skillBox.frameW, layout.skillBox.frameH));
    }
    children.push(scene.add.text(layout.skillBox.sizeLabelX, layout.skillBox.sizeLabelY, `SLOT ${skill.size}`, {
      fontSize: CARD_TEMPLATE_LAYOUT.skillBox.sizeLabel.fontSize,
      color: '#f5ead0',
      fontFamily: FONT.body,
      fontStyle: 'bold',
      stroke: '#111722',
      strokeThickness: 2,
    }).setOrigin(0.5));

    const title = scene.add.text(layout.text.centerX, layout.text.titleY, skill.name, {
      fontSize: layout.textRules.title.fontSize,
      color: '#ffffff',
      fontFamily: FONT.display,
      fontStyle: 'bold',
      align: 'center',
      fixedWidth: layout.text.titleW,
      maxLines: layout.textRules.title.maxLines,
      wordWrap: { width: layout.text.titleW, useAdvancedWrap: true },
      stroke: '#111722',
      strokeThickness: 3,
    }).setOrigin(0.5, 0);
    title.setLineSpacing(layout.textRules.title.lineSpacing ?? 0);

    const divider = scene.add.rectangle(layout.text.centerX, layout.text.dividerY, layout.text.dividerW, 1, 0xcdd9e8, 0.58);
    const body = scene.add.text(-halfW + layout.text.bodyX + layout.text.centerX, layout.text.bodyY, skill.text, {
      fontSize: layout.textRules.body.fontSize,
      color: '#f1efe8',
      fontFamily: FONT.body,
      fixedWidth: layout.text.bodyW,
      maxLines: layout.textRules.body.maxLines,
      wordWrap: { width: layout.text.bodyW, useAdvancedWrap: true },
      lineSpacing: layout.textRules.body.lineSpacing ?? 0,
      stroke: '#111722',
      strokeThickness: 2,
    }).setOrigin(0, 0);

    children.push(title, divider, body);
    this.add(children);
    this.setSize(width, height);
    scene.add.existing(this);
  }

  private makeFramelessSkillPlate(scene: Phaser.Scene, x: number, y: number, width: number, height: number): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    g.fillStyle(0x07101a, 0.66);
    g.fillRoundedRect(x - width / 2, y - height / 2, width, height, 16);
    return g;
  }

  private addCardArt(
    children: Phaser.GameObjects.GameObject[],
    scene: Phaser.Scene,
    skill: SkillDef,
    width: number,
    height: number,
    lowerShadeStartRatio: number,
  ): void {
    const artKey = fantasyTemplateCardArtKey(skill);
    if (!artKey || !scene.textures.exists(artKey)) {
      children.push(this.makeArtMatte(scene, width, height, lowerShadeStartRatio));
      return;
    }

    const halfW = width / 2;
    const halfH = height / 2;
    const radius = CARD_TEMPLATE_LAYOUT.artMatte.cornerRadius;
    const lowerShadeY = -halfH + height * lowerShadeStartRatio;
    const image = scene.add.image(0, 0, artKey);
    const source = image.texture.getSourceImage() as { width: number; height: number };
    const scale = Math.max(width / source.width, height / source.height);
    const maskShape = scene.add.graphics();
    maskShape.fillStyle(0xffffff, 1).fillRoundedRect(this.x - halfW, this.y - halfH, width, height, radius).setVisible(false);
    this.once(Phaser.GameObjects.Events.DESTROY, () => maskShape.destroy());
    image.setDisplaySize(source.width * scale, source.height * scale);
    image.setMask(maskShape.createGeometryMask());

    const lowerShade = scene.add.graphics();
    lowerShade.fillStyle(0x02050b, 0.52);
    lowerShade.fillRoundedRect(-halfW, lowerShadeY, width, halfH - lowerShadeY, radius);

    children.push(image, lowerShade);
  }

  private makeArtMatte(scene: Phaser.Scene, width: number, height: number, lowerShadeStartRatio: number): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    const halfW = width / 2;
    const halfH = height / 2;
    const radius = CARD_TEMPLATE_LAYOUT.artMatte.cornerRadius;
    const lowerShadeY = -halfH + height * lowerShadeStartRatio;

    g.fillStyle(0x111722, 1);
    g.fillRoundedRect(-halfW, -halfH, width, height, radius);
    g.fillStyle(0x1c2a38, 0.48);
    g.fillRoundedRect(-halfW + 2, -halfH + 2, width - 4, height - 4, radius - 2);
    g.fillStyle(0x04060b, 0.36);
    g.fillRoundedRect(-halfW, lowerShadeY, width, halfH - lowerShadeY, radius);
    return g;
  }

  private addSheetPart(
    children: Phaser.GameObjects.GameObject[],
    scene: Phaser.Scene,
    x: number,
    y: number,
    frame: string,
    displayW: number,
    displayH: number,
  ): void {
    const image = scene.add.image(x, y, PARTS_KEY, frame).setDisplaySize(displayW, displayH);
    children.push(image);
  }

  private addBadgePart(
    children: Phaser.GameObjects.GameObject[],
    scene: Phaser.Scene,
    x: number,
    y: number,
    iconKey: CardIconKey,
    color: number,
    displayW: number,
    displayH: number,
  ): void {
    const key = ensureBadgeTexture(scene, iconKey, color);
    const image = scene.add.image(x, y, key).setDisplaySize(displayW, displayH);
    children.push(image);
  }

  private addWtPart(
    children: Phaser.GameObjects.GameObject[],
    scene: Phaser.Scene,
    x: number,
    y: number,
    tier: SkillTier,
    displayW: number,
    displayH: number,
  ): void {
    const key = ensureWtTexture(scene, tier);
    const image = scene.add.image(x, y, key).setDisplaySize(displayW, displayH);
    children.push(image);
  }
}

export function createTemplateBadgePreview(
  scene: Phaser.Scene,
  x: number,
  y: number,
  iconKey: CardIconKey,
  color: number,
  width: number,
  height: number,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, ensureBadgeTexture(scene, iconKey, color)).setDisplaySize(width, height);
}

export function createTemplateWtPreview(
  scene: Phaser.Scene,
  x: number,
  y: number,
  tier: SkillTier,
  width: number,
  height: number,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, ensureWtTexture(scene, tier)).setDisplaySize(width, height);
}

function ensureTemplateFrames(scene: Phaser.Scene): void {
  if (!scene.textures.exists(PARTS_KEY)) return;

  const texture = scene.textures.get(PARTS_KEY);
  for (const [tier, crop] of Object.entries(SKILL_BOX_FRAME) as Array<[SkillTier, CropFrame]>) {
    addFrame(texture, frameName('skill-box', tier), crop);
  }
}

function addFrame(texture: Phaser.Textures.Texture, name: string, crop: CropFrame): void {
  if (texture.has(name)) return;
  texture.add(name, 0, crop.x, crop.y, crop.w, crop.h);
}

function ensureBadgeTexture(scene: Phaser.Scene, iconKey: CardIconKey, color: number): string {
  const extractedKey = EXTRACTED_BADGE_TEXTURE_KEY[iconKey];
  if (extractedKey && scene.textures.exists(extractedKey)) {
    return extractedKey;
  }

  const key = `${BADGE_TEXTURE_PREFIX}:${iconKey}:${color.toString(16)}`;
  if (scene.textures.exists(key)) return key;

  const width = 144;
  const height = 156;
  const graphics = scene.make.graphics({});
  drawBadgeFrame(graphics, width, height, {
    edge: lightenColor(color, 0.42),
    fill: darkenColor(color, 0.72),
    highlight: lightenColor(color, 0.72),
  }, 'icon');
  drawBadgeSymbol(graphics, iconKey, width / 2, height / 2 + 1, Math.min(width, height) * 0.28);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
  return key;
}

function ensureWtTexture(scene: Phaser.Scene, tier: SkillTier): string {
  const key = `${WT_TEXTURE_PREFIX}:${tier}`;
  if (scene.textures.exists(key)) return key;

  const width = 156;
  const height = 168;
  const style = tierPlateStyle(tier);
  const graphics = scene.make.graphics({});
  drawBadgeFrame(graphics, width, height, style, 'wt');
  graphics.generateTexture(key, width, height);
  graphics.destroy();
  return key;
}

function drawBadgeFrame(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  colors: { edge: number; fill: number; highlight: number },
  variant: 'icon' | 'wt',
): void {
  const outer = badgePoints(width, height, variant === 'wt' ? 0.2 : 0.16, variant === 'wt' ? 0.22 : 0.18);
  const inner = badgePoints(width * 0.82, height * 0.82, variant === 'wt' ? 0.2 : 0.16, variant === 'wt' ? 0.22 : 0.18);
  const core = badgePoints(width * 0.68, height * 0.68, variant === 'wt' ? 0.2 : 0.16, variant === 'wt' ? 0.22 : 0.18);

  graphics.fillStyle(colors.edge, 1);
  graphics.fillPoints(outer, true);

  graphics.fillStyle(mixColor(colors.fill, 0x06080d, 0.16), 1);
  graphics.fillPoints(inner, true);

  graphics.lineStyle(3, colors.highlight, 0.9);
  graphics.strokePoints(inner, true, true);

  graphics.lineStyle(2, lightenColor(colors.highlight, 0.15), 0.75);
  graphics.strokePoints(core, true, true);

  graphics.fillStyle(0x02050b, 0.28);
  graphics.fillPoints(offsetPoints(core, 0, height * 0.03), true);

  drawBadgeStud(graphics, width / 2, height * 0.08, colors.highlight, 10, variant === 'wt');
  if (variant === 'wt') {
    drawBadgeStud(graphics, width / 2, height * 0.92, colors.highlight, 10, true);
  } else {
    drawBadgeStud(graphics, width * 0.15, height / 2, colors.highlight, 7, false);
    drawBadgeStud(graphics, width * 0.85, height / 2, colors.highlight, 7, false);
  }
}

function drawBadgeStud(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  color: number,
  radius: number,
  vertical: boolean,
): void {
  const points = vertical
    ? [
      new Phaser.Geom.Point(x, y - radius),
      new Phaser.Geom.Point(x + radius * 0.55, y),
      new Phaser.Geom.Point(x, y + radius),
      new Phaser.Geom.Point(x - radius * 0.55, y),
    ]
    : [
      new Phaser.Geom.Point(x - radius, y),
      new Phaser.Geom.Point(x, y - radius * 0.55),
      new Phaser.Geom.Point(x + radius, y),
      new Phaser.Geom.Point(x, y + radius * 0.55),
    ];
  graphics.fillStyle(color, 0.92);
  graphics.fillPoints(points, true);
  graphics.fillStyle(0xffffff, 0.35);
  graphics.fillCircle(x, y, Math.max(2, radius * 0.18));
}

function badgePoints(width: number, height: number, shoulder: number, notch: number): Phaser.Geom.Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const halfW = width / 2;
  const halfH = height / 2;
  return [
    new Phaser.Geom.Point(cx, cy - halfH),
    new Phaser.Geom.Point(cx + halfW * (1 - shoulder), cy - halfH * notch),
    new Phaser.Geom.Point(cx + halfW, cy),
    new Phaser.Geom.Point(cx + halfW * (1 - shoulder), cy + halfH * notch),
    new Phaser.Geom.Point(cx, cy + halfH),
    new Phaser.Geom.Point(cx - halfW * (1 - shoulder), cy + halfH * notch),
    new Phaser.Geom.Point(cx - halfW, cy),
    new Phaser.Geom.Point(cx - halfW * (1 - shoulder), cy - halfH * notch),
  ];
}

function offsetPoints(points: Phaser.Geom.Point[], dx: number, dy: number): Phaser.Geom.Point[] {
  return points.map((point) => new Phaser.Geom.Point(point.x + dx, point.y + dy));
}

function drawBadgeSymbol(
  graphics: Phaser.GameObjects.Graphics,
  iconKey: CardIconKey,
  cx: number,
  cy: number,
  scale: number,
): void {
  if (iconKey === 'offense') {
    drawOffenseEmblem(graphics, cx, cy, scale);
    return;
  }
  graphics.lineStyle(Math.max(3, scale * 0.16), 0x1a1109, 0.88);
  drawSymbolPath(graphics, iconKey, cx, cy + scale * 0.06, scale);
  graphics.lineStyle(Math.max(2, scale * 0.1), 0xf7f1df, 1);
  drawSymbolPath(graphics, iconKey, cx, cy, scale);
}

function drawOffenseEmblem(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  scale: number,
): void {
  drawFilledCrossedSwords(graphics, cx, cy + scale * 0.08, scale, 0x1a1109, 0x070403);
  drawFilledCrossedSwords(graphics, cx, cy, scale, 0xf5e8cb, 0x2a180b);
  graphics.fillStyle(0xfff8eb, 1);
  const centerDiamond = [
    new Phaser.Geom.Point(cx, cy - scale * 0.12),
    new Phaser.Geom.Point(cx + scale * 0.12, cy),
    new Phaser.Geom.Point(cx, cy + scale * 0.12),
    new Phaser.Geom.Point(cx - scale * 0.12, cy),
  ];
  graphics.fillPoints(centerDiamond, true);
  graphics.lineStyle(Math.max(2, scale * 0.08), 0x2a180b, 0.9);
  graphics.strokePoints(centerDiamond, true, true);
}

function drawSymbolPath(
  graphics: Phaser.GameObjects.Graphics,
  iconKey: CardIconKey,
  cx: number,
  cy: number,
  scale: number,
): void {
  switch (iconKey) {
    case 'offense':
      drawCrossedSwords(graphics, cx, cy, scale);
      return;
    case 'defensive':
      drawShield(graphics, cx, cy, scale);
      return;
    case 'healing':
      drawCross(graphics, cx, cy, scale);
      return;
    case 'support':
      drawStar(graphics, cx, cy, scale);
      return;
    case 'debuff':
      drawSkull(graphics, cx, cy, scale);
      return;
    case 'sword':
      drawSword(graphics, cx, cy, scale, 0);
      return;
    case 'axe':
      drawAxe(graphics, cx, cy, scale);
      return;
    case 'lance':
      drawLance(graphics, cx, cy, scale);
      return;
    case 'bow':
      drawBow(graphics, cx, cy, scale);
      return;
    case 'fangs':
      drawFangs(graphics, cx, cy, scale);
      return;
    case 'fire':
      drawFlame(graphics, cx, cy, scale);
      return;
    case 'frost':
      drawSnowflake(graphics, cx, cy, scale);
      return;
    case 'lightning':
      drawLightning(graphics, cx, cy, scale);
      return;
    case 'nature':
      drawLeaf(graphics, cx, cy, scale);
      return;
    case 'holy':
      drawSun(graphics, cx, cy, scale);
      return;
    case 'dark':
      drawCrescent(graphics, cx, cy, scale);
      return;
    case 'physical':
      drawImpact(graphics, cx, cy, scale);
      return;
    case 'magical':
      drawArcaneSigil(graphics, cx, cy, scale);
      return;
    case 'true':
      drawRadiantDiamond(graphics, cx, cy, scale);
      return;
  }
}

function drawCrossedSwords(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  drawSword(graphics, cx - scale * 0.08, cy + scale * 0.04, scale * 0.8, -0.72);
  drawSword(graphics, cx + scale * 0.08, cy + scale * 0.04, scale * 0.8, 0.72);
}

function drawFilledCrossedSwords(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  scale: number,
  fillColor: number,
  strokeColor: number,
): void {
  drawFilledSword(graphics, cx - scale * 0.13, cy + scale * 0.05, scale * 0.88, -0.82, fillColor, strokeColor);
  drawFilledSword(graphics, cx + scale * 0.13, cy + scale * 0.05, scale * 0.88, 0.82, fillColor, strokeColor);
}

function drawFilledSword(
  graphics: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  scale: number,
  angle: number,
  fillColor: number,
  strokeColor: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotate = (x: number, y: number): Phaser.Geom.Point =>
    new Phaser.Geom.Point(cx + x * cos - y * sin, cy + x * sin + y * cos);

  const blade = [
    rotate(0, -scale * 0.92),
    rotate(scale * 0.16, -scale * 0.48),
    rotate(scale * 0.1, scale * 0.04),
    rotate(scale * 0.04, scale * 0.16),
    rotate(-scale * 0.04, scale * 0.16),
    rotate(-scale * 0.1, scale * 0.04),
    rotate(-scale * 0.16, -scale * 0.48),
  ];
  const guard = [
    rotate(-scale * 0.28, scale * 0.02),
    rotate(-scale * 0.08, scale * 0.18),
    rotate(scale * 0.08, scale * 0.18),
    rotate(scale * 0.28, scale * 0.02),
    rotate(scale * 0.08, -scale * 0.06),
    rotate(-scale * 0.08, -scale * 0.06),
  ];
  const grip = [
    rotate(-scale * 0.06, scale * 0.16),
    rotate(scale * 0.06, scale * 0.16),
    rotate(scale * 0.05, scale * 0.46),
    rotate(-scale * 0.05, scale * 0.46),
  ];
  const pommel = [
    rotate(0, scale * 0.66),
    rotate(scale * 0.1, scale * 0.56),
    rotate(0, scale * 0.46),
    rotate(-scale * 0.1, scale * 0.56),
  ];

  graphics.fillStyle(fillColor, 1);
  graphics.fillPoints(blade, true);
  graphics.fillPoints(guard, true);
  graphics.fillPoints(grip, true);
  graphics.fillPoints(pommel, true);

  graphics.lineStyle(Math.max(1.5, scale * 0.08), strokeColor, 0.95);
  graphics.strokePoints(blade, true, true);
  graphics.strokePoints(guard, true, true);
  graphics.strokePoints(grip, true, true);
  graphics.strokePoints(pommel, true, true);
}

function drawSword(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number, angle: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotate = (x: number, y: number): Phaser.Geom.Point =>
    new Phaser.Geom.Point(cx + x * cos - y * sin, cy + x * sin + y * cos);
  const blade = [
    rotate(0, -scale * 0.86),
    rotate(scale * 0.16, -scale * 0.22),
    rotate(0, scale * 0.18),
    rotate(-scale * 0.16, -scale * 0.22),
  ];
  graphics.strokePoints(blade, true, true);
  graphics.beginPath();
  const leftGuard = rotate(-scale * 0.24, scale * 0.1);
  const rightGuard = rotate(scale * 0.24, scale * 0.1);
  graphics.moveTo(leftGuard.x, leftGuard.y);
  graphics.lineTo(rightGuard.x, rightGuard.y);
  const pommelTop = rotate(0, scale * 0.12);
  const pommelBottom = rotate(0, scale * 0.48);
  graphics.moveTo(pommelTop.x, pommelTop.y);
  graphics.lineTo(pommelBottom.x, pommelBottom.y);
  graphics.strokePath();
  graphics.fillStyle(0xf7f1df, 1);
  const pommel = rotate(0, scale * 0.58);
  graphics.fillCircle(pommel.x, pommel.y, Math.max(2, scale * 0.08));
}

function drawShield(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const points = [
    new Phaser.Geom.Point(cx, cy - scale * 0.82),
    new Phaser.Geom.Point(cx + scale * 0.62, cy - scale * 0.42),
    new Phaser.Geom.Point(cx + scale * 0.48, cy + scale * 0.34),
    new Phaser.Geom.Point(cx, cy + scale * 0.84),
    new Phaser.Geom.Point(cx - scale * 0.48, cy + scale * 0.34),
    new Phaser.Geom.Point(cx - scale * 0.62, cy - scale * 0.42),
  ];
  graphics.strokePoints(points, true, true);
  graphics.beginPath();
  graphics.moveTo(cx, cy - scale * 0.6);
  graphics.lineTo(cx, cy + scale * 0.58);
  graphics.moveTo(cx - scale * 0.34, cy - scale * 0.08);
  graphics.lineTo(cx + scale * 0.34, cy - scale * 0.08);
  graphics.strokePath();
}

function drawCross(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.beginPath();
  graphics.moveTo(cx, cy - scale * 0.82);
  graphics.lineTo(cx, cy + scale * 0.82);
  graphics.moveTo(cx - scale * 0.82, cy);
  graphics.lineTo(cx + scale * 0.82, cy);
  graphics.strokePath();
}

function drawStar(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const points: Phaser.Geom.Point[] = [];
  for (let index = 0; index < 8; index++) {
    const angle = (-Math.PI / 2) + (index * Math.PI) / 4;
    const radius = index % 2 === 0 ? scale * 0.88 : scale * 0.36;
    points.push(new Phaser.Geom.Point(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  graphics.strokePoints(points, true, true);
}

function drawSkull(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.strokeCircle(cx, cy - scale * 0.1, scale * 0.56);
  graphics.beginPath();
  graphics.moveTo(cx - scale * 0.34, cy + scale * 0.28);
  graphics.lineTo(cx - scale * 0.22, cy + scale * 0.72);
  graphics.lineTo(cx + scale * 0.22, cy + scale * 0.72);
  graphics.lineTo(cx + scale * 0.34, cy + scale * 0.28);
  graphics.moveTo(cx - scale * 0.2, cy - scale * 0.18);
  graphics.lineTo(cx - scale * 0.04, cy);
  graphics.lineTo(cx - scale * 0.24, cy + scale * 0.04);
  graphics.moveTo(cx + scale * 0.2, cy - scale * 0.18);
  graphics.lineTo(cx + scale * 0.04, cy);
  graphics.lineTo(cx + scale * 0.24, cy + scale * 0.04);
  graphics.moveTo(cx, cy + scale * 0.1);
  graphics.lineTo(cx - scale * 0.1, cy + scale * 0.28);
  graphics.lineTo(cx + scale * 0.1, cy + scale * 0.28);
  graphics.lineTo(cx, cy + scale * 0.1);
  graphics.strokePath();
}

function drawAxe(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.beginPath();
  graphics.moveTo(cx, cy - scale * 0.8);
  graphics.lineTo(cx, cy + scale * 0.8);
  graphics.moveTo(cx, cy - scale * 0.18);
  graphics.lineTo(cx + scale * 0.56, cy - scale * 0.46);
  graphics.lineTo(cx + scale * 0.56, cy + scale * 0.12);
  graphics.lineTo(cx, cy + scale * 0.06);
  graphics.strokePath();
}

function drawLance(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.beginPath();
  graphics.moveTo(cx, cy + scale * 0.8);
  graphics.lineTo(cx, cy - scale * 0.76);
  graphics.lineTo(cx + scale * 0.18, cy - scale * 0.52);
  graphics.moveTo(cx, cy - scale * 0.76);
  graphics.lineTo(cx - scale * 0.18, cy - scale * 0.52);
  graphics.moveTo(cx - scale * 0.32, cy + scale * 0.12);
  graphics.lineTo(cx + scale * 0.32, cy + scale * 0.12);
  graphics.strokePath();
}

function drawBow(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const curve = [
    new Phaser.Geom.Point(cx - scale * 0.3, cy - scale * 0.84),
    new Phaser.Geom.Point(cx + scale * 0.02, cy - scale * 0.46),
    new Phaser.Geom.Point(cx + scale * 0.16, cy),
    new Phaser.Geom.Point(cx + scale * 0.02, cy + scale * 0.46),
    new Phaser.Geom.Point(cx - scale * 0.3, cy + scale * 0.84),
  ];
  graphics.strokePoints(curve, false, false);
  graphics.beginPath();
  graphics.moveTo(cx - scale * 0.24, cy - scale * 0.72);
  graphics.lineTo(cx + scale * 0.18, cy);
  graphics.lineTo(cx - scale * 0.24, cy + scale * 0.72);
  graphics.strokePath();
}

function drawFangs(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const left = [
    new Phaser.Geom.Point(cx - scale * 0.46, cy - scale * 0.44),
    new Phaser.Geom.Point(cx - scale * 0.12, cy + scale * 0.64),
    new Phaser.Geom.Point(cx - scale * 0.02, cy - scale * 0.28),
  ];
  const right = [
    new Phaser.Geom.Point(cx + scale * 0.46, cy - scale * 0.44),
    new Phaser.Geom.Point(cx + scale * 0.12, cy + scale * 0.64),
    new Phaser.Geom.Point(cx + scale * 0.02, cy - scale * 0.28),
  ];
  graphics.strokePoints(left, true, true);
  graphics.strokePoints(right, true, true);
}

function drawFlame(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const points = [
    new Phaser.Geom.Point(cx, cy - scale * 0.86),
    new Phaser.Geom.Point(cx + scale * 0.48, cy - scale * 0.2),
    new Phaser.Geom.Point(cx + scale * 0.22, cy + scale * 0.76),
    new Phaser.Geom.Point(cx, cy + scale * 0.38),
    new Phaser.Geom.Point(cx - scale * 0.22, cy + scale * 0.76),
    new Phaser.Geom.Point(cx - scale * 0.48, cy - scale * 0.2),
  ];
  graphics.strokePoints(points, true, true);
}

function drawSnowflake(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.beginPath();
  for (let index = 0; index < 3; index++) {
    const angle = (index * Math.PI) / 3;
    const dx = Math.cos(angle) * scale * 0.84;
    const dy = Math.sin(angle) * scale * 0.84;
    graphics.moveTo(cx - dx, cy - dy);
    graphics.lineTo(cx + dx, cy + dy);
  }
  graphics.strokePath();
}

function drawLightning(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const points = [
    new Phaser.Geom.Point(cx + scale * 0.12, cy - scale * 0.86),
    new Phaser.Geom.Point(cx - scale * 0.26, cy - scale * 0.08),
    new Phaser.Geom.Point(cx + scale * 0.06, cy - scale * 0.08),
    new Phaser.Geom.Point(cx - scale * 0.12, cy + scale * 0.84),
    new Phaser.Geom.Point(cx + scale * 0.34, cy + scale * 0.08),
    new Phaser.Geom.Point(cx, cy + scale * 0.08),
  ];
  graphics.strokePoints(points, false, false);
}

function drawLeaf(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const points = [
    new Phaser.Geom.Point(cx, cy - scale * 0.84),
    new Phaser.Geom.Point(cx + scale * 0.58, cy - scale * 0.12),
    new Phaser.Geom.Point(cx + scale * 0.14, cy + scale * 0.78),
    new Phaser.Geom.Point(cx - scale * 0.44, cy + scale * 0.18),
  ];
  graphics.strokePoints(points, true, true);
  graphics.beginPath();
  graphics.moveTo(cx - scale * 0.12, cy + scale * 0.7);
  graphics.lineTo(cx + scale * 0.18, cy - scale * 0.44);
  graphics.strokePath();
}

function drawSun(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.strokeCircle(cx, cy, scale * 0.36);
  graphics.beginPath();
  for (let index = 0; index < 8; index++) {
    const angle = (index * Math.PI) / 4;
    const inner = scale * 0.52;
    const outer = scale * 0.84;
    graphics.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    graphics.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
  }
  graphics.strokePath();
}

function drawCrescent(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.strokeCircle(cx - scale * 0.04, cy, scale * 0.58);
  const inner = [
    new Phaser.Geom.Point(cx + scale * 0.16, cy - scale * 0.54),
    new Phaser.Geom.Point(cx + scale * 0.34, cy - scale * 0.28),
    new Phaser.Geom.Point(cx + scale * 0.4, cy),
    new Phaser.Geom.Point(cx + scale * 0.34, cy + scale * 0.28),
    new Phaser.Geom.Point(cx + scale * 0.16, cy + scale * 0.54),
  ];
  graphics.strokePoints(inner, false, false);
}

function drawImpact(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const points: Phaser.Geom.Point[] = [];
  for (let index = 0; index < 8; index++) {
    const angle = (-Math.PI / 2) + (index * Math.PI) / 4;
    const radius = index % 2 === 0 ? scale * 0.86 : scale * 0.3;
    points.push(new Phaser.Geom.Point(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  graphics.strokePoints(points, true, true);
}

function drawArcaneSigil(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  graphics.strokeCircle(cx, cy, scale * 0.58);
  graphics.strokeCircle(cx, cy, scale * 0.28);
  graphics.beginPath();
  for (let index = 0; index < 3; index++) {
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / 3;
    graphics.moveTo(cx, cy);
    graphics.lineTo(cx + Math.cos(angle) * scale * 0.74, cy + Math.sin(angle) * scale * 0.74);
  }
  graphics.strokePath();
}

function drawRadiantDiamond(graphics: Phaser.GameObjects.Graphics, cx: number, cy: number, scale: number): void {
  const outer = [
    new Phaser.Geom.Point(cx, cy - scale * 0.86),
    new Phaser.Geom.Point(cx + scale * 0.7, cy),
    new Phaser.Geom.Point(cx, cy + scale * 0.86),
    new Phaser.Geom.Point(cx - scale * 0.7, cy),
  ];
  const inner = [
    new Phaser.Geom.Point(cx, cy - scale * 0.34),
    new Phaser.Geom.Point(cx + scale * 0.28, cy),
    new Phaser.Geom.Point(cx, cy + scale * 0.34),
    new Phaser.Geom.Point(cx - scale * 0.28, cy),
  ];
  graphics.strokePoints(outer, true, true);
  graphics.strokePoints(inner, true, true);
}

function mixColor(a: number, b: number, ratio: number): number {
  const clamped = Phaser.Math.Clamp(ratio, 0, 1);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const blue = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | blue;
}

function lightenColor(color: number, ratio: number): number {
  return mixColor(color, 0xffffff, ratio);
}

function darkenColor(color: number, ratio: number): number {
  return mixColor(color, 0x000000, ratio);
}

function frameName(group: 'skill-box', name: string): string {
  return `${group}:${name}`;
}

function resolveCardTemplateLayout(width: number, height: number, skill: SkillDef): ResolvedCardTemplateLayout {
  const scale = Math.min(width / 380, height / 590);
  const halfH = height / 2;
  const skillBoxHeight = Math.round(height * CARD_TEMPLATE_LAYOUT.skillBox.heightRatio);
  const skillBoxTop = halfH - skillBoxHeight - CARD_TEMPLATE_LAYOUT.skillBox.bottomPadding;
  const textRules = resolveTextRules(skill, scale);
  const inner = CARD_TEMPLATE_LAYOUT.skillBox.inner;
  const wtDigits = String(weightOf(skill)).length;
  const baseWtFontSize = wtDigits >= 3 ? 11 : wtDigits === 2 ? 13 : 15;

  return {
    primaryArchetype: {
      ...CARD_TEMPLATE_LAYOUT.badges.primaryArchetype,
      w: Math.round(CARD_TEMPLATE_LAYOUT.badges.primaryArchetype.w * scale),
      h: Math.round(CARD_TEMPLATE_LAYOUT.badges.primaryArchetype.h * scale),
      xFromLeft: Math.round(CARD_TEMPLATE_LAYOUT.badges.primaryArchetype.xFromLeft * scale),
      yFromTop: Math.round(CARD_TEMPLATE_LAYOUT.badges.primaryArchetype.yFromTop * scale),
    },
    wt: {
      ...CARD_TEMPLATE_LAYOUT.badges.wt,
      fontSize: `${Math.max(10, Math.round(baseWtFontSize * scale))}px`,
      w: Math.round(CARD_TEMPLATE_LAYOUT.badges.wt.w * scale),
      h: Math.round(CARD_TEMPLATE_LAYOUT.badges.wt.h * scale),
      xFromLeft: Math.round(CARD_TEMPLATE_LAYOUT.badges.wt.xFromLeft * scale),
      yFromTop: Math.round(CARD_TEMPLATE_LAYOUT.badges.wt.yFromTop * scale),
    },
    archetypes: {
      ...CARD_TEMPLATE_LAYOUT.badges.archetypes,
      gap: Math.round(CARD_TEMPLATE_LAYOUT.badges.archetypes.gap * scale),
      h: Math.round(CARD_TEMPLATE_LAYOUT.badges.archetypes.h * scale),
      w: Math.round(CARD_TEMPLATE_LAYOUT.badges.archetypes.w * scale),
      xFromRight: Math.round(CARD_TEMPLATE_LAYOUT.badges.archetypes.xFromRight * scale),
      yFromTop: Math.round(CARD_TEMPLATE_LAYOUT.badges.archetypes.yFromTop * scale),
    },
    skillBox: {
      frameCenterX: CARD_TEMPLATE_LAYOUT.skillBox.frameCenterOffsetX,
      frameCenterY: skillBoxTop + skillBoxHeight / 2,
      frameH: skillBoxHeight + CARD_TEMPLATE_LAYOUT.skillBox.frameExtraH,
      frameW: width - CARD_TEMPLATE_LAYOUT.skillBox.frameInsetX,
      h: skillBoxHeight,
      sizeLabelX: CARD_TEMPLATE_LAYOUT.skillBox.frameCenterOffsetX + CARD_TEMPLATE_LAYOUT.skillBox.sizeLabel.xFromCenter * scale,
      sizeLabelY: skillBoxTop - CARD_TEMPLATE_LAYOUT.skillBox.frameExtraH / 2 + CARD_TEMPLATE_LAYOUT.skillBox.sizeLabel.yFromFrameTop * scale,
      top: skillBoxTop,
    },
    text: {
      bodyW: width - inner.bodyWidthPad * scale,
      bodyX: inner.xPad * scale,
      bodyY: skillBoxTop + inner.bodyTop * scale,
      centerX: CARD_TEMPLATE_LAYOUT.skillBox.contentCenterOffsetX,
      dividerW: width - inner.dividerWidthPad * scale,
      dividerY: skillBoxTop + inner.dividerTop * scale,
      titleW: width - inner.titleWidthPad * scale,
      titleY: skillBoxTop + inner.titleTop * scale,
    },
    textRules,
  };
}

function resolveTextRules(skill: SkillDef, scale = 1): ResolvedTextRules {
  const effectWeight = skill.effects.length > 1 ? (skill.effects.length - 1) * 28 : 0;
  const bodyLength = skill.text.length + effectWeight;
  const bodyMinPx = bodyLength >= 120 ? 6 : bodyLength >= 95 ? 7 : 8;
  return {
    body: scaleTextRule(pickTextRule(CARD_TEMPLATE_LAYOUT.textRules.body, bodyLength), scale, bodyMinPx),
    title: scaleTextRule(pickTextRule(CARD_TEMPLATE_LAYOUT.textRules.title, skill.name.length), scale, 13),
  };
}

function pickTextRule(rules: readonly TextRule[], length: number): TextRule {
  return rules.find((rule) => length <= rule.maxChars) ?? rules[rules.length - 1]!;
}

function scaleTextRule(rule: TextRule, scale: number, minPx: number): TextRule {
  const fontPx = Math.max(minPx, Math.round(parseInt(rule.fontSize, 10) * scale));
  const lineSpacing = rule.lineSpacing == null ? undefined : Math.round(rule.lineSpacing * scale);
  return {
    ...rule,
    fontSize: `${fontPx}px`,
    lineSpacing,
  };
}
