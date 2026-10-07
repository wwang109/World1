import Phaser from 'phaser';
import type { CombatEvent } from '../../engine/combat/events';
import { describePassiveReceipt, describePassiveChanges } from '../../engine/passives/text';
import type { PassiveEffectDefinition } from '../../engine/passives/types';
import type { TurnFx } from '../battleTimeline';
import { FONT, UI } from '../theme';

type Receipt = Extract<CombatEvent, { kind: 'preBattleEffect' }>;
const SOURCE_STYLE = {
  relic: { color: 0xe8b446, text: '#f1cf79', icon: 'seal' },
  talent: { color: 0x57c4dc, text: '#8bd9f1', icon: 'branch' },
  equipment: { color: 0x92afbd, text: '#b7ced8', icon: 'ring' },
} as const;
const EFFECT_MOTION: Readonly<Partial<Record<PassiveEffectDefinition['effect']['kind'], {duration: number; peak: number}>>> = {
  setupShield: { duration: 260, peak: 0.9 },
  cardShieldPower: { duration: 220, peak: 0.7 },
};
const DEFAULT_EFFECT_MOTION = { duration: 220, peak: 0.7 };

export interface PassiveBoardBounds {
  side: 'player' | 'enemy'; unit: number;
  x: number; y: number; width: number; height: number;
  slotCount?: number; gap?: number;
}
export function passiveFxAt(fxs: readonly TurnFx[]): Receipt | undefined {
  return fxs.find(fx => fx.kind === 'passive')?.passive;
}
export function passiveMotionAllowed(): boolean {
  return typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function renderBattlePassiveNotice(
  scene: Phaser.Scene, receipt: Receipt,
  opts: { x: number; y: number; width: number; compact: boolean; bottom?: boolean; animate: boolean; speedMult: number },
): number {
  const style = SOURCE_STYLE[receipt.source.kind];
  const motion = receipt.active && opts.animate && passiveMotionAllowed();
  const root = scene.add.container(opts.x, opts.y).setDepth(24).setData('battlePassiveCue', true);
  root.setData('sourceKind', receipt.source.kind).setData('activePassive', receipt.active).setData('passiveAnimated', motion);
  const title = scene.add.text(44, 9, `${receipt.source.kind.toUpperCase()} · ${receipt.source.displayName ?? receipt.source.id.replace(/[_-]+/g, ' ')}${receipt.active ? '' : ' · INACTIVE'}`, {
    fontFamily: FONT.body, fontSize: opts.compact ? '12px' : '14px', fontStyle: 'bold', color: style.text,
    wordWrap: { width: opts.width - 56 },
  });
  const effect = scene.add.text(44, title.y + title.height + 4, receipt.effectText, {
    fontFamily: FONT.body, fontSize: opts.compact ? '12px' : '13px', color: UI.textBright,
    wordWrap: { width: opts.width - 56 },
  });
  const changesText = receipt.changes.map(change => {
    const target = receipt.targets.find(target => target.slot === change.slot && target.skillId === change.skillId);
    const label = target ? `${target.name ?? target.skillId} · Slot ${target.slot + 1} · ` : '';
    return change.field === 'weight'
      ? `${label}WT ${change.before} → ${change.after}`
      : change.field === 'shieldPower' ? `${label}Shield power ${change.before} → ${change.after}`
      : `${label}${describePassiveChanges([change])}`;
  }).join('\n');
  const changes = changesText ? scene.add.text(44, effect.y + effect.height + 4, changesText, {
    fontFamily: FONT.body, fontSize: opts.compact ? '12px' : '13px', color: style.text,
    wordWrap: { width: opts.width - 56 },
  }) : undefined;
  const condition = scene.add.text(44, (changes ?? effect).y + (changes ?? effect).height + 4, [describePassiveReceipt(receipt), receipt.conditionsText].filter(Boolean).join(' · '), {
    fontFamily: FONT.body, fontSize: '11px', color: UI.textMuted, wordWrap: { width: opts.width - 56 },
  });
  const height = condition.y + condition.height + 10;
  const bg = scene.add.rectangle(0, 0, opts.width, height, 0x101a2a, 0.98).setOrigin(0).setStrokeStyle(1, style.color, receipt.active ? 0.85 : 0.4);
  const icon = scene.add.graphics().lineStyle(2, style.color, receipt.active ? 1 : 0.45);
  if (style.icon === 'seal') {
    icon.strokeCircle(22, 25, 12).strokeCircle(22, 25, 7);
    icon.beginPath().moveTo(22, 9).lineTo(25, 22).lineTo(38, 25).lineTo(25, 28).lineTo(22, 41).lineTo(19, 28).lineTo(6, 25).lineTo(19, 22).closePath().strokePath();
  } else if (style.icon === 'branch') {
    icon.beginPath().moveTo(22, 40).lineTo(22, 25).lineTo(11, 14).moveTo(22, 25).lineTo(33, 14).moveTo(22, 25).lineTo(22, 10).strokePath();
    for (const [x, y] of [[11, 14], [33, 14], [22, 10], [22, 40]]) icon.strokeCircle(x!, y!, 3);
  } else icon.strokeCircle(22, 25, 10);
  root.add([bg, icon, title, effect, ...(changes ? [changes] : []), condition]).setSize(opts.width, height);
  if (opts.bottom) root.setY(opts.y - height);
  if (motion && style.icon !== 'ring') scene.tweens.add({ targets: icon, alpha: 0.45, duration: 120 / opts.speedMult, yoyo: true, ease: 'Sine.easeInOut' });
  root.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(icon));
  return height;
}

export function highlightBattlePassiveTargets(
  scene: Phaser.Scene, receipt: Receipt, boards: readonly PassiveBoardBounds[], animate: boolean, speedMult: number,
): void {
  if (!receipt.active) return;
  const board = boards.find(bounds => bounds.side === receipt.side && bounds.unit === receipt.unit);
  if (!board) return;
  const style = SOURCE_STYLE[receipt.source.kind];
  const motion = animate && passiveMotionAllowed();
  const recipe = EFFECT_MOTION[receipt.effect.kind] ?? DEFAULT_EFFECT_MOTION;
  const count = board.slotCount ?? 10; const gap = board.gap ?? 5;
  const rowH = (board.height - gap * (count - 1)) / count;
  for (const target of receipt.targets) {
    const y = board.y + target.slot * (rowH + gap);
    const height = rowH * target.size + gap * (target.size - 1);
    const ring = scene.add.rectangle(board.x + 2, y + 2, board.width - 4, height - 4, style.color, 0)
      .setOrigin(0).setStrokeStyle(2, style.color, 0.8).setDepth(22).setData('battlePassiveTarget', { slot: target.slot, size: target.size, sourceKind: receipt.source.kind });
    if (motion && style.icon !== 'ring') {
      scene.tweens.add({ targets: ring, alpha: recipe.peak, duration: recipe.duration / speedMult, yoyo: true, ease: 'Sine.easeInOut' });
      if (style.icon === 'branch') {
        const sweep = scene.add.rectangle(board.x + 4, y + 3, board.width - 8, 2, style.color, 0.65).setOrigin(0).setDepth(23).setData('battlePassiveSweep', true);
        scene.tweens.add({ targets: sweep, y: y + height - 5, alpha: 0, duration: recipe.duration / speedMult, onComplete: () => sweep.destroy() });
        sweep.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(sweep));
      }
    }
    ring.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(ring));
  }
}
