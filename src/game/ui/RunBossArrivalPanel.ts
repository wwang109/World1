import type Phaser from 'phaser';
import { enemies } from '../../data/enemies';
import { BAND_WAVES, biomeFor, leanLabel } from '../../run/biome';
import type { EncounterPack } from '../../run/encounter';
import type { RunNode, RunState } from '../../run/runState';
import { textRoleFor, UI, type InkRole, type TextRole } from '../theme';
import { playSfx } from '../audio/sfxSynth';
import { auditControlLabel, auditTextBlock } from './controlLayoutAudit';
import { BRIGHT_ART_TREATMENT } from './brightArtTreatment';
import { attachButtonFeel } from './motion';
import { addRunArt } from './runArt';
import { biomeArtKey, RUN_ART_KEYS } from './runArtKeys';
import { encounterDestinationLabel } from './runTravelChoiceViewModel';
import type { Rect } from './runScreenTemplate';

export interface RunBossArrivalViewModel {
  nodeId: string;
  bossName: string;
  level: number;
  title: string;
  regionName: string;
  leanLabel: string;
  artKey: string;
  regionDay: number;
}

/** Only presents the supplied encounter. Selection and deterministic encounter
 * resolution stay in the existing store; this model never rolls or mutates. */
export function bossArrivalViewModel(
  run: RunState,
  node: RunNode,
  encounter: EncounterPack | null,
): RunBossArrivalViewModel | null {
  const primary = encounter?.units[0];
  if (encounterDestinationLabel(node, encounter) !== 'REGION BOSS' || !primary) return null;
  const biome = biomeFor(run.seed, node.wave, node.biomeId);
  return {
    nodeId: node.id,
    bossName: enemies[primary.enemyId]?.name ?? primary.enemyId,
    level: primary.effectiveLevel,
    title: 'REGION BOSS',
    regionName: biome.name,
    leanLabel: leanLabel(biome.lean),
    artKey: biomeArtKey(biome.id),
    regionDay: BAND_WAVES,
  };
}

/** The rendering copy for the mandatory regional-boss destination. */
export function bossArrivalEyebrow(model: Pick<RunBossArrivalViewModel, 'regionDay'>): string {
  return `MANDATORY DESTINATION · REGION DAY ${String(model.regionDay)}/${String(BAND_WAVES)}`;
}

export interface RunBossArrivalPanelLayout {
  art: Rect;
  emblem: Rect;
  eyebrow: Rect;
  headline: Rect;
  region: Rect;
  chips: readonly Rect[];
  action: Rect;
}

/** All geometry comes from the route host, never the full viewport. Desktop
 * keeps copy beside the existing boss emblem; compact stacks them. */
export function runBossArrivalPanelLayout(bounds: Rect, opts: { compact: boolean }): RunBossArrivalPanelLayout {
  const { compact } = opts;
  const pad = Math.min(compact ? 16 : 28, bounds.width * 0.04, bounds.height * 0.05);
  const innerH = Math.max(1, bounds.height - pad * 2);
  const width = Math.max(1, Math.min(bounds.width - pad * 2, compact ? 520 : bounds.width * 0.58));
  const x = compact ? bounds.x + (bounds.width - width) / 2 : bounds.x + pad;
  const gap = Math.min(compact ? 10 : 16, innerH * 0.025);
  const eyebrowH = Math.min(compact ? 22 : 24, innerH * 0.08);
  const headlineH = Math.min(compact ? 72 : 120, innerH * 0.22);
  const regionH = Math.min(compact ? 34 : 40, innerH * 0.1);
  const chipH = Math.min(compact ? 34 : 40, innerH * 0.1);
  const actionH = Math.min(compact ? 48 : 54, innerH * 0.16);
  const actionGap = Math.min(compact ? 16 : 24, innerH * 0.04);
  const height = eyebrowH + headlineH + regionH + chipH + actionH + gap * 3 + actionGap;
  let y = compact ? bounds.y + bounds.height - pad - height : bounds.y + (bounds.height - height) / 2;
  const block = (height: number): Rect => {
    const rect = { x, y, width, height };
    y += height + gap;
    return rect;
  };
  const eyebrow = block(eyebrowH);
  const headline = block(headlineH);
  const region = block(regionH);
  const chipWidth = Math.min(compact ? 124 : 140, (width - gap * 2) / 3);
  const chips = [0, 1, 2].map((i) => ({ x: x + i * (chipWidth + gap), y, width: chipWidth, height: chipH }));
  const action = { x, y: y + chipH + actionGap, width: compact ? width : Math.min(260, width), height: actionH };
  const emblemSize = Math.max(1, Math.min(compact ? 180 : 300,
    compact ? bounds.width * 0.42 : bounds.width * 0.3,
    compact ? innerH - height - gap : innerH * 0.8));
  const emblem = {
    x: compact ? bounds.x + (bounds.width - emblemSize) / 2 : bounds.x + bounds.width - pad - emblemSize,
    y: compact ? bounds.y + pad : bounds.y + (bounds.height - emblemSize) / 2,
    width: emblemSize, height: emblemSize,
  };
  return { art: { ...bounds }, emblem, eyebrow, headline, region, chips, action };
}

/** A committed mandatory destination has one forward action. Closing the panel
 * would imply that its already-picked node can be unchosen, so no close exists. */
export function renderRunBossArrivalPanel(
  scene: Phaser.Scene,
  bounds: Rect,
  model: RunBossArrivalViewModel,
  opts: { compact: boolean; onFaceBoss: () => void },
): void {
  const layout = runBossArrivalPanelLayout(bounds, opts);
  const profile = opts.compact ? 'mobile' : 'desktop';
  scene.add.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, UI.panelMuted, 1)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8);
  addRunArt(scene, model.artKey, layout.art);
  const scrim = scene.add.graphics();
  if (opts.compact) {
    scrim.fillGradientStyle(UI.panelMuted, UI.panelMuted, UI.panelMuted, UI.panelMuted, 0.24, 0.24, 0.98, 0.98);
  } else {
    scrim.fillGradientStyle(UI.panelMuted, UI.panelMuted, UI.panelMuted, UI.panelMuted, 0.98, 0.35, 0.98, 0.35);
  }
  scrim.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  // Reuse the installed boss emblem, not a fabricated enemy-specific portrait.
  const emblem = layout.emblem;
  scene.add.rectangle(emblem.x - 2, emblem.y - 2, emblem.width + 4, emblem.height + 4, UI.panelMuted, 0.96)
    .setOrigin(0, 0).setStrokeStyle(2, UI.bad, 0.9);
  addRunArt(scene, RUN_ART_KEYS.icon.bossSkull, emblem);
  const addText = (rect: Rect, value: string, role: TextRole, ink: InkRole): void => {
    const text = scene.add.text(rect.x, rect.y, value, {
      ...textRoleFor(profile, role, { ink }), wordWrap: { width: rect.width },
    }).setStroke(BRIGHT_ART_TREATMENT.biome.textStroke, BRIGHT_ART_TREATMENT.biome.textStrokeThickness);
    auditTextBlock(text, { name: `Boss arrival ${role}: ${value}`, maxWidth: rect.width, maxHeight: rect.height, minFontSize: 9 });
  };
  addText(layout.eyebrow, bossArrivalEyebrow(model), 'kicker', 'alarm');
  addText(layout.headline, model.bossName, 'display', 'primary');
  addText(layout.region, model.regionName.toUpperCase(), 'body', 'secondary');
  const facts = [`LV ${model.level}`, model.title, model.leanLabel];
  layout.chips.forEach((rect, index) => {
    const chip = scene.add.rectangle(rect.x, rect.y, rect.width, rect.height, UI.panelMuted, 0.96)
      .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 0.65);
    const label = scene.add.text(rect.x + rect.width / 2, rect.y + rect.height / 2, facts[index]!,
      textRoleFor(profile, 'label', { ink: 'resource' })).setOrigin(0.5);
    auditControlLabel(chip, label, { name: `Boss arrival fact ${index}`, horizontalPadding: 8, verticalPadding: 6, minFontSize: 9 });
  });
  const action = scene.add.rectangle(layout.action.x, layout.action.y, layout.action.width, layout.action.height, UI.bad, 1)
    .setOrigin(0, 0).setStrokeStyle(1, UI.bad, 1).setInteractive({ useHandCursor: true });
  const label = scene.add.text(layout.action.x + layout.action.width / 2, layout.action.y + layout.action.height / 2,
    'FACE THE BOSS ›', textRoleFor(profile, 'label', { ink: 'onAlarm' })).setOrigin(0.5);
  auditControlLabel(action, label, { name: 'Face the boss', horizontalPadding: 12, verticalPadding: 8, minFontSize: 9 });
  attachButtonFeel(scene, action, {
    fill: UI.bad, hover: UI.bad, lift: 1, follow: [label],
    onPress: () => { playSfx('uiClick'); opts.onFaceBoss(); },
  });
}
