import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { gemHeroStats } from '../../engine/cards';
import { BASE_HERO_STATS } from '../../data/heroes';
import { LEVEL_STAT_COST, totalLevelPL, type Allocation, type LevelStat } from '../../run/leveling';
import { commitHeroAllocation, currentHeroAllocation, currentHeroLevel, currentRunPieces, heroAllocationScratchCost } from '../runStore';
import { FONT, SCREEN, textRole, textRoleSize, UI } from '../theme';
import { addHoverTipZone } from './hoverTip';
import { statHoverEntry, STAT_TOKEN } from './statLabels';

/**
 * Run Mode's stat/level allocation overlay — the one place a player spends
 * banked PL (see docs/release-game-plan.md "Hero leveling & stat allocation",
 * a HARD user requirement). Both platforms open it from the shared HUD's
 * glowing LV cell (`RunProgressStrip.ts#renderRunHud`).
 *
 * CONFIRMABLE SCRATCH EDIT (2026-07-29 rework): +/- steppers operate on a
 * local, uncommitted `Allocation` (`scratch`, module-level so it survives the
 * scene-rebuild idiom's re-render without any scene owning it) — PL SPENT/
 * BANKED updates live against the scratch as the player clicks, nothing is
 * written to the run until CONFIRM (`commitHeroAllocation` → `src/run/
 * runState.ts#setHeroAllocation`). CANCEL discards the scratch and reverts to
 * the run's last-confirmed allocation. `scratch` is reset to `null` on every
 * close (cancel OR confirm) so the NEXT open always reseeds fresh off the
 * run's current committed allocation — never stale across sessions.
 *
 * One shared implementation for both platforms: desktop uses a right-side
 * drawer while compact keeps the same six rows in a viewport-safe sheet.
 */

let scratch: Allocation | null = null;

/** Lazily seeds the scratch allocation from the run's current committed
 * allocation the first time the panel opens after a close. */
function ensureScratch(): Allocation {
  if (!scratch) scratch = { ...currentHeroAllocation() };
  return scratch;
}

/** Discards any in-progress scratch edit — called on both CANCEL and CONFIRM
 * so the next open reseeds fresh. Exported so a scene can force-discard (e.g.
 * navigating away) without importing the module's internal state. */
export function discardStatPanelScratch(): void {
  scratch = null;
}

export interface RunStatPanelLayout {
  panel: { x: number; y: number; width: number; height: number };
  columns: 1;
  rowHeight: number;
  rowGap: number;
  padding: number;
}

/** Pure geometry for the allocation overlay. Desktop is a right-side drawer;
 * compact stays a centered, viewport-safe sheet instead of inheriting a
 * desktop-width panel. */
export function runStatPanelLayout(
  view: { width: number; height: number },
  compact: boolean,
): RunStatPanelLayout {
  const width = compact ? Math.min(388, view.width - 24) : Math.min(576, view.width - 48);
  const height = compact ? Math.min(640, view.height - 32) : Math.min(730, view.height - 48);
  const x = compact ? Math.round((view.width - width) / 2) : view.width - width - 18;
  const y = compact ? Math.max(16, Math.round((view.height - height) / 2)) : view.height - height - 24;
  return {
    panel: { x, y, width, height },
    columns: 1,
    rowHeight: compact ? 52 : 66,
    rowGap: compact ? 6 : 8,
    padding: compact ? 16 : 18,
  };
}

export interface StatAllocationRow {
  stat: LevelStat;
  label: string;
  current: number;
  preview: number;
  pending: boolean;
  gemAdd: number;
  cost: number;
}

const ALLOCATION_STATS: ReadonlyArray<readonly [LevelStat, string]> = [
  ['maxHp', STAT_TOKEN.maxHp],
  ['attack', STAT_TOKEN.attack],
  ['magicPower', STAT_TOKEN.magicPower],
  ['armor', STAT_TOKEN.armor],
  ['magicResist', STAT_TOKEN.magicResist],
  ['speed', STAT_TOKEN.speed],
];

/** Builds the row values without touching Phaser or run state. The displayed
 * total includes hero gems in both columns, while only scratch allocation
 * changes between current and preview. */
export function buildStatAllocationRows(
  committed: Allocation,
  preview: Allocation,
  gemAdds: Partial<Record<LevelStat, number>> = {},
): StatAllocationRow[] {
  return ALLOCATION_STATS.map(([stat, label]) => {
    const { gain, pl } = LEVEL_STAT_COST[stat];
    const base = stat === 'maxHp' ? BASE_HERO_STATS.maxHp : BASE_HERO_STATS[stat];
    const gemAdd = gemAdds[stat] ?? 0;
    const current = base + (committed[stat] ?? 0) * gain + gemAdd;
    const next = base + (preview[stat] ?? 0) * gain + gemAdd;
    return { stat, label, current, preview: next, pending: next !== current, gemAdd, cost: pl };
  });
}

export function renderRunStatPanel(
  scene: Phaser.Scene,
  opts: { compact: boolean; onCancel: () => void; onConfirm: () => void; onChanged: () => void },
): void {
  const { compact, onCancel, onConfirm, onChanged } = opts;
  const level = currentHeroLevel();
  const alloc = ensureScratch();
  const committed = currentHeroAllocation();
  const total = totalLevelPL(level);
  const spent = heroAllocationScratchCost(alloc);
  const banked = total - spent;

  const geometry = runStatPanelLayout({ width: SCREEN.width, height: SCREEN.height }, compact);
  const { x: px, y: py, width: pw, height: ph } = geometry.panel;
  const { rowHeight, rowGap, padding } = geometry;
  const rows = buildStatAllocationRows(committed, alloc, gemHeroStats(currentRunPieces()));

  const cancelAndClose = (): void => { playSfx('uiBack'); discardStatPanelScratch(); onCancel(); };

  const scrim = scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.62).setOrigin(0, 0).setInteractive().setDepth(5000);
  scrim.on('pointerdown', cancelAndClose);
  const panel = scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 1).setInteractive().setDepth(5001);
  void panel; // swallows scrim clicks under the panel

  const innerX = px + padding;
  const innerW = pw - padding * 2;
  let cursor = py + (compact ? 16 : 22);

  scene.add.text(px + pw / 2, cursor, 'LEVEL UP', textRole('title')).setOrigin(0.5, 0).setDepth(5002);
  cursor += textRoleSize('title') + (compact ? 8 : 10);

  scene.add.text(px + pw / 2, cursor, `HERO LV ${level}`, textRole('label')).setOrigin(0.5, 0).setDepth(5002);
  // BANKED PL is a `resource` when there is any to spend (it is the thing this
  // panel exists to let you spend) and a plain `label` when there is not —
  // which is the whole "a zero is not neutral" rule, applied to the one number
  // that changes what this panel is for.
  cursor += textRoleSize('label') + (compact ? 10 : 14);
  const plBoxW = compact ? 166 : 270;
  const plBoxH = compact ? 38 : 42;
  const plBoxX = px + (pw - plBoxW) / 2;
  scene.add.rectangle(plBoxX, cursor, plBoxW, plBoxH, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.chip, 1).setDepth(5002);
  const plLineText = scene.add.text(px + pw / 2, cursor + plBoxH / 2, `${banked} PL AVAILABLE`, {
    ...textRole('label', { ink: banked > 0 ? 'resource' : 'label' }), fontStyle: 'bold',
  }).setOrigin(0.5).setDepth(5002);
  void plLineText;
  addHoverTipZone(scene, { x: plBoxX, y: cursor, w: plBoxW, h: plBoxH }, [
    { title: 'PL available', body: 'Spend PL on stats. Changes apply when you confirm.' },
  ], 5003);
  cursor += plBoxH + (compact ? 12 : 16);
  scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.55).setOrigin(0, 0).setDepth(5002);
  cursor += compact ? 10 : 14;

  // Every row shows the committed total beside the scratch preview. Hero gem
  // contribution stays visible as its own green delta rather than being
  // mistaken for a level purchase.
  const cellW = innerW;
  const cellH = rowHeight;
  const btn = compact ? 44 : 58;
  const gap = rowGap;
  rows.forEach(({ stat, label, current, preview, pending, gemAdd, cost: costPl }, i) => {
    const cx = innerX;
    const cy = cursor + i * (cellH + gap);
    const buys = alloc[stat] ?? 0;
    const canBuy = banked >= costPl;
    const canSell = buys > 0;

    const plusX = cx + cellW - btn;
    const minusX = plusX - gap - btn;
    const infoRight = minusX - (compact ? 10 : 18);
    scene.add.rectangle(cx, cy, cellW, cellH, UI.panelMuted, 0.72).setOrigin(0, 0)
      .setStrokeStyle(1, pending ? UI.good : UI.border, pending ? 0.9 : 0.45).setDepth(5002);
    scene.add.text(cx + (compact ? 10 : 14), cy + cellH / 2, label, textRole(compact ? 'statLabelTight' : 'section'))
      .setOrigin(0, 0.5).setDepth(5002);
    const valueX = cx + (compact ? 76 : 142);
    scene.add.text(valueX, cy + cellH / 2, String(current), textRole('statValueTight')).setOrigin(1, 0.5).setDepth(5002);
    scene.add.text(valueX + (compact ? 14 : 18), cy + cellH / 2, '→', textRole('statLabelTight')).setOrigin(0.5).setDepth(5002);
    scene.add.text(valueX + (compact ? 28 : 36), cy + cellH / 2, String(preview),
      textRole('statValueTight', { ink: pending && preview > current ? 'gain' : 'primary' }))
      .setOrigin(0, 0.5).setDepth(5002);
    // 5003: above the modal panel/scrim, else the pointer never reaches it.
    addHoverTipZone(scene, { x: cx, y: cy, w: minusX - cx, h: cellH }, [statHoverEntry(label)], 5003);
    const rightEdge = infoRight;
    if (gemAdd > 0) {
      scene.add.text(rightEdge, cy + cellH / 2 + (compact ? 10 : 12), `◆+${gemAdd}`, textRole('micro', { ink: 'gain' }))
        .setOrigin(1, 0.5).setDepth(5002);
    }
    scene.add.text(rightEdge, cy + cellH / 2 - (compact ? 9 : 11), `${costPl} PL`, textRole('micro', { ink: 'cost' }))
      .setOrigin(1, 0.5).setDepth(5002);

    // MINUS (left)
    const minusFill = canSell ? UI.panelAlt : UI.panelMuted;
    const minusBtn = scene.add.rectangle(minusX, cy + 1, btn, cellH - 2, minusFill, canSell ? 1 : 0.4).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, canSell ? 0.7 : 0.25).setDepth(5002);
    scene.add.text(minusX + btn / 2, cy + cellH / 2, '−', {
      ...textRole('section', { ink: canSell ? 'primary' : 'disabled' }), fontFamily: FONT.body,
    }).setOrigin(0.5).setDepth(5002);
    if (canSell) {
      minusBtn.setInteractive({ useHandCursor: true });
      minusBtn.on('pointerdown', () => {
        playSfx('uiClick');
        const next = { ...ensureScratch(), [stat]: Math.max(0, (alloc[stat] ?? 0) - 1) };
        scratch = next;
        onChanged();
      });
    }

    // PLUS (right)
    const plusFill = canBuy ? (pending ? UI.goodSoft : UI.panelAlt) : UI.panelMuted;
    const plusBtn = scene.add.rectangle(plusX, cy + 1, btn, cellH - 2, plusFill, canBuy ? 1 : 0.4).setOrigin(0, 0)
      .setStrokeStyle(1, pending ? UI.good : UI.border, canBuy ? 0.9 : 0.25).setDepth(5002);
    scene.add.text(plusX + btn / 2, cy + cellH / 2, '+', {
      ...textRole('section', { ink: canBuy ? 'primary' : 'disabled' }), fontFamily: FONT.body,
    }).setOrigin(0.5).setDepth(5002);
    if (canBuy) {
      plusBtn.setInteractive({ useHandCursor: true });
      plusBtn.on('pointerdown', () => {
        playSfx('uiClick');
        const next = { ...ensureScratch(), [stat]: (alloc[stat] ?? 0) + 1 };
        scratch = next;
        onChanged();
      });
    }
  });
  cursor += rows.length * cellH + (rows.length - 1) * gap + (compact ? 12 : 16);

  // CONFIRM / CANCEL row.
  const btnH = compact ? 44 : 50;
  const btnW = (innerW - 10) / 2;
  const cancelBtn = scene.add.rectangle(innerX, cursor, btnW, btnH, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setDepth(5002);
  scene.add.text(innerX + btnW / 2, cursor + btnH / 2, 'CANCEL', textRole('label')).setOrigin(0.5).setDepth(5002);
  cancelBtn.on('pointerdown', cancelAndClose);

  const confirmX = innerX + btnW + 10;
  const confirmBtn = scene.add.rectangle(confirmX, cursor, btnW, btnH, UI.chip, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true }).setDepth(5002);
  scene.add.text(confirmX + btnW / 2, cursor + btnH / 2, `CONFIRM ${spent} PL`, textRole('label', { ink: 'onAccent' })).setOrigin(0.5).setDepth(5002);
  confirmBtn.on('pointerdown', () => {
    playSfx(spent > 0 ? 'levelUp' : 'uiClick');
    commitHeroAllocation(ensureScratch());
    discardStatPanelScratch();
    onConfirm();
  });
}
