import type Phaser from 'phaser';
import type { BiomePickOption, BiomePickViewModel } from '../../run/biomePickViewModel';
import type { Rect } from './runScreenTemplate';
import { bandBannerViewModel } from './bandBannerViewModel';
import { biomeArtKey, desktopBiomeArtKey } from './runArtKeys';
import { addRunArt } from './runArt';
import { textRoleFor, UI } from '../theme';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { attachButtonFeel, flashConfirm } from './motion';
import { roundRect } from './roundedRect';

export interface BiomePickCardModel {
  biomeId: string;
  artKey: string;
  name: string;
  tagline: string;
  leanChip: string;
  bossLine: string;
  counterLines: readonly string[];
}

export function biomePickCardModel(option: BiomePickOption, mode: 'desktop' | 'mobile'): BiomePickCardModel {
  const vm = bandBannerViewModel(option.forecast);
  const bossName = vm.boss.resolved ? vm.boss.headline : vm.boss.entries[0] ?? vm.boss.headline;
  return {
    biomeId: option.biomeId,
    artKey: mode === 'desktop' ? desktopBiomeArtKey(option.biomeId) : biomeArtKey(option.biomeId),
    name: vm.name,
    tagline: option.forecast.tagline,
    leanChip: vm.leanChip,
    bossLine: `BOSS · ${bossName}`,
    counterLines: vm.bossClaim.lines,
  };
}

export function runBiomePickCardsLayout(bounds: Rect, count: number, compact: boolean): Rect[] {
  const gap = compact ? 8 : 16;
  if (compact) {
    const height = Math.max(84, Math.floor((bounds.height - gap * (count - 1)) / Math.max(1, count)));
    return Array.from({ length: count }, (_, index) => ({
      x: bounds.x, y: bounds.y + index * (height + gap), width: bounds.width, height,
    }));
  }
  const width = Math.max(1, (bounds.width - gap * (count - 1)) / Math.max(1, count));
  return Array.from({ length: count }, (_, index) => ({
    x: bounds.x + index * (width + gap), y: bounds.y, width, height: bounds.height,
  }));
}

function renderBiomePickCard(
  scene: Phaser.Scene, bounds: Rect, model: BiomePickCardModel,
  opts: { compact: boolean; onChoose: () => void },
): void {
  const { compact } = opts;
  const profile = compact ? 'mobile' : 'desktop';
  const pad = compact ? 10 : 16;
  const plate = roundRect(scene.add.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, UI.panelAlt, 0.98), compact ? 12 : 0)
    .setOrigin(0, 0).setStrokeStyle(2, UI.chip, 0.85);

  const artSize = compact ? Math.min(56, bounds.height - pad * 2) : 0;
  const artH = compact ? 0 : Math.min(96, bounds.height * 0.3);
  const textX = bounds.x + pad + (compact ? artSize + 10 : 0);
  const textW = bounds.width - pad * 2 - (compact ? artSize + 10 : 0);
  if (compact) {
    addRunArt(scene, model.artKey, { x: bounds.x + pad, y: bounds.y + (bounds.height - artSize) / 2, width: artSize, height: artSize });
  } else {
    addRunArt(scene, model.artKey, { x: bounds.x + 1, y: bounds.y + 1, width: bounds.width - 2, height: artH - 1 });
  }

  const actionH = compact ? 32 : 40;
  const actionY = bounds.y + bounds.height - pad - actionH;
  const textTop = bounds.y + pad + (compact ? 0 : artH + 6);
  const textBottom = actionY - 8;

  const name = scene.add.text(textX, textTop, model.name, {
    ...textRoleFor(profile, 'section'), wordWrap: { width: textW },
  });
  auditTextBlock(name, { name: `${model.biomeId} pick name`, maxWidth: textW, maxHeight: compact ? 20 : 26, minFontSize: 9 });

  const taglineY = textTop + name.height + 4;
  const taglineMaxH = compact ? 14 : 32;
  const tagline = scene.add.text(textX, taglineY, model.tagline, {
    ...textRoleFor(profile, 'micro'), wordWrap: { width: textW },
  });
  auditTextBlock(tagline, { name: `${model.biomeId} pick tagline`, maxWidth: textW, maxHeight: taglineMaxH, minFontSize: 8 });

  const chipY = taglineY + tagline.height + 4;
  const chip = scene.add.text(textX, chipY, model.leanChip, {
    ...textRoleFor(profile, 'label', { ink: 'accent' }),
  });
  auditTextBlock(chip, { name: `${model.biomeId} pick lean`, maxWidth: textW, maxHeight: 18, minFontSize: 8 });

  const bossY = chipY + chip.height + 4;
  const boss = scene.add.text(textX, bossY, model.bossLine, {
    ...textRoleFor(profile, 'micro'), wordWrap: { width: textW },
  });
  auditTextBlock(boss, { name: `${model.biomeId} pick boss`, maxWidth: textW, maxHeight: compact ? 14 : 18, minFontSize: 8 });

  const counterY = bossY + boss.height + 3;
  const counterMaxH = Math.max(0, textBottom - counterY);
  const counter = scene.add.text(textX, counterY, model.counterLines.join('\n'), {
    ...textRoleFor(profile, 'micro', { ink: 'secondary' }), wordWrap: { width: textW }, lineSpacing: 1,
  });
  if (counterMaxH > 0) auditTextBlock(counter, { name: `${model.biomeId} pick counter`, maxWidth: textW, maxHeight: counterMaxH, minFontSize: 8 });

  const action = roundRect(scene.add.rectangle(bounds.x + pad, actionY, bounds.width - pad * 2, actionH, UI.chip, 1), compact ? 10 : 0)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.9).setInteractive({ useHandCursor: true });
  const actionLabel = scene.add.text(bounds.x + bounds.width / 2, actionY + actionH / 2, 'CHOOSE REGION', textRoleFor(profile, 'label', { ink: 'onAccent' })).setOrigin(0.5);
  auditControlLabel(action, actionLabel, { name: `${model.biomeId} pick choose`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 8 });

  attachButtonFeel(scene, action, {
    fill: UI.chip, hover: UI.border, follow: [actionLabel], lift: 0,
    onPress: () => { flashConfirm(scene, plate); opts.onChoose(); },
  });
}

export function renderRunBiomePickPanel(
  scene: Phaser.Scene, bounds: Rect, pick: BiomePickViewModel,
  opts: { compact: boolean; onChoose: (biomeId: string) => void },
): void {
  const mode = opts.compact ? 'mobile' : 'desktop';
  const models = pick.options.map((option) => biomePickCardModel(option, mode));
  const cards = runBiomePickCardsLayout(bounds, models.length, opts.compact);
  models.forEach((model, index) => {
    renderBiomePickCard(scene, cards[index]!, model, { compact: opts.compact, onChoose: () => opts.onChoose(model.biomeId) });
  });
}
