import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import { applyTier } from '../../engine/cards';
import type { SkillTier } from '../../engine/types';
import { FONT } from '../theme';
import { FantasyCardTemplateV2, FANTASY_CARD_BODY_NAME, FANTASY_CARD_TITLE_NAME } from './FantasyCardTemplateV2';
import { cardTemplateSpec, type FantasyCardTemplateVariant } from './fantasyCardTemplateSpec';
import { CARD_ART_CATALOG, cardArtUrl } from './cardArtCatalog';
import { CARD_TEMPLATE_BADGE_ASSETS } from './cardArtPresentation';

export interface CardTemplatePreviewState {
  id: string;
  tier: SkillTier;
  template: FantasyCardTemplateVariant;
  artwork: boolean;
  progress: boolean;
  guide?: boolean;
  title?: string;
  stress?: boolean;
}

export function mountCardTemplatePreview(host: HTMLElement, initial: CardTemplatePreviewState) {
  let state = initial;
  let scene: Phaser.Scene | undefined;
  let card: FantasyCardTemplateV2 | undefined;
  let ready = false;
  const loading = new Set<string>();
  const width = () => Math.max(1, Math.round(host.clientWidth));
  const height = () => {
    const size = cardTemplateSpec(state.template).baseSize;
    return Math.round(width() * size.height / size.width);
  };
  const initialSize = cardTemplateSpec(state.template).baseSize;
  host.style.aspectRatio = `${initialSize.width} / ${initialSize.height}`;

  function draw() {
    if (!scene || !ready) return;
    host.dataset.ready = 'false';
    card?.destroy();
    const resolved = applyTier(skillBook[state.id]!, state.tier);
    const skill = { ...resolved, name: state.title ?? resolved.name };
    if (state.stress && !state.guide) {
      skill.effects = Array.from({ length: 15 }, (_, index) => ({ kind: 'debuffStat' as const, stat: index % 2 ? 'armor' as const : 'attack' as const, pct: 20, turns: 2 }));
    }
    const cardW = width();
    const cardH = height();
    const art = CARD_ART_CATALOG[state.id];
    const artReady = !art || scene.textures.exists(art.textureKey);
    if (state.artwork && !state.guide && art && !artReady && !loading.has(art.textureKey)) {
      loading.add(art.textureKey);
      scene.load.once(`filecomplete-image-${art.textureKey}`, () => { loading.delete(art.textureKey); draw(); });
      scene.load.image(art.textureKey,cardArtUrl(art));
      scene.load.start();
    }
    card = new FantasyCardTemplateV2(scene, cardW / 2, cardH / 2, skill, {
      width: cardW, height: cardH, template: state.template, tier: state.tier,
      artwork: state.artwork && !state.guide && artReady, glossary: false,
      progress: state.progress ? { tier: state.tier, points: 1 } : undefined,
    });
    const updateChromeReady = () => {
      const chromeReady = state.template === 'classic' || card?.getByName('fantasy-card-chrome')?.getData('rasterReady') === true;
      host.dataset.chromeReady = String(chromeReady);
      host.dataset.ready = String(chromeReady && (!state.artwork || state.guide || artReady));
    };
    card.on('chrome-ready', updateChromeReady);
    updateChromeReady();
    if (state.guide) {
      const spec = cardTemplateSpec(state.template);
      const scale = cardW / spec.baseSize.width;
      for (const child of card.getAll()) {
        if (child.name === FANTASY_CARD_BODY_NAME || child.name === FANTASY_CARD_TITLE_NAME || child.name === 'fantasy-card-badges') {
          (child as Phaser.GameObjects.Container | Phaser.GameObjects.Text).setVisible(false);
        }
      }
      const chrome = card.getByName('fantasy-card-chrome') as Phaser.GameObjects.Container | null;
      (chrome?.getByName('fantasy-card-rules-caption') as Phaser.GameObjects.Text | null)?.setVisible(false);
      for (const [key, label] of [['artFrame','ARTWORK'],['header',''],['titleBox','TITLE'],['rulesBand',''],['rulesCaption','RULES'],['bodyBox','RULES ROWS'],['footer',''],['progress',''],['typeBadge','TYPE'],['rightRail','ROLES']] as const) {
        const box = spec.regions[key];
        if (!box) continue;
        const x = -cardW / 2 + box.x * scale;
        const y = -cardH / 2 + box.y * scale;
        const outline = scene.add.rectangle(x,y,box.w * scale,box.h * scale)
          .setOrigin(0,0).setFillStyle(0,0).setStrokeStyle(1,0x22799d,0.65);
        card.add(outline);
        if (!label) continue;
        const caption = box.h * scale >= 32 ? `${label}\n${box.w} x ${box.h}` : label;
        const text = scene.add.text(x + box.w * scale / 2,y + box.h * scale / 2,caption, {
          fontFamily: FONT.body, fontSize: Math.max(8,Math.round(13 * scale)),
          align: 'center', color: spec.printed?.ink ?? '#ffffff',
        }).setOrigin(0.5);
        text.setScale(Math.min(1,box.w * scale / Math.max(1,text.width),box.h * scale / Math.max(1,text.height)));
        card.add(text);
      }
    }
    host.dataset.template = state.template;
    host.dataset.artReady = String(!state.artwork || state.guide || artReady);
    host.dataset.truncated = String(card.getByName(FANTASY_CARD_BODY_NAME)?.getData('truncated') ?? false);
    (host as HTMLElement & { previewCard?: FantasyCardTemplateV2 }).previewCard = card;
  }

  class PreviewScene extends Phaser.Scene {
    preload() {
      for (const asset of CARD_TEMPLATE_BADGE_ASSETS) this.load.image(asset.key,asset.path);
    }
    create() { scene = this; ready = true; draw(); }
  }
  const game = new Phaser.Game({
    type: Phaser.CANVAS, parent: host, width: width(), height: height(),
    transparent: true, scene: PreviewScene, audio: { noAudio: true },
    render: { antialias: true }, banner: false,
  });
  const observer = new ResizeObserver(() => {
    game.scale.resize(width(),height());
    draw();
  });
  observer.observe(host);
  return {
    update(next: CardTemplatePreviewState) { state = next; draw(); },
    destroy() { observer.disconnect(); game.destroy(true); },
  };
}
