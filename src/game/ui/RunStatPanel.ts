import Phaser from 'phaser';
import { LEVEL_STAT_COST, totalLevelPL, type Allocation, type LevelStat } from '../../run/leveling';
import { commitHeroAllocation, currentBankedPL, currentHeroAllocation, currentHeroLevel, heroAllocationScratchCost } from '../runStore';
import { FONT, SCREEN, UI } from '../theme';
import { addHoverTipZone } from './hoverTip';
import { statHoverEntry } from './statGlossary';

/**
 * Run Mode's stat/level allocation overlay — the one place a player spends
 * banked PL (see docs/release-game-plan.md "Hero leveling & stat allocation",
 * a HARD user requirement). Reachable from BOTH the Run Map and Run Prep
 * headers via the "n PL TO SPEND" badge (`renderBankedPlBadge` below).
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
 * One shared implementation for both platforms — `compact` picks the mobile-
 * friendly sizing (narrower panel, smaller type, 2-column grid) vs desktop's
 * roomier 3-column grid.
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

export function renderRunStatPanel(
  scene: Phaser.Scene,
  opts: { compact: boolean; onCancel: () => void; onConfirm: () => void; onChanged: () => void },
): void {
  const { compact, onCancel, onConfirm, onChanged } = opts;
  const level = currentHeroLevel();
  const alloc = ensureScratch();
  const total = totalLevelPL(level);
  const spent = heroAllocationScratchCost(alloc);
  const banked = total - spent;

  const rows: Array<[LevelStat, string]> = [
    ['maxHp', 'HP'], ['attack', 'ATK'], ['magicPower', 'MAG'],
    ['armor', 'DEF'], ['magicResist', 'RES'], ['speed', 'SPD'],
  ];
  const cols = compact ? 2 : 3;
  const cellH = compact ? 46 : 40;
  const btn = compact ? 24 : 28;
  const gap = compact ? 6 : 10;

  const pw = Math.min(SCREEN.width - 40, compact ? SCREEN.width - 32 : 460);
  const gridRows = Math.ceil(rows.length / cols);
  const ph = (compact ? 96 : 100) + gridRows * (cellH + gap) + (compact ? 66 : 74);
  const px = (SCREEN.width - pw) / 2;
  const py = Math.max(compact ? 16 : 30, (SCREEN.height - ph) / 2);

  const nameSize = compact ? 15 : 18;
  const smallSize = compact ? 9 : 11;
  const labelSize = compact ? 10 : 12;

  const cancelAndClose = (): void => { discardStatPanelScratch(); onCancel(); };

  const scrim = scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(5000);
  scrim.on('pointerdown', cancelAndClose);
  const panel = scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 1).setInteractive().setDepth(5001);
  void panel; // swallows scrim clicks under the panel

  const innerX = px + 20;
  const innerW = pw - 40;
  let cursor = py + 18;

  scene.add.text(innerX, cursor, 'STAT ALLOCATION', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${nameSize}px`, color: UI.text,
  }).setDepth(5002);
  cursor += nameSize + 8;

  scene.add.text(innerX, cursor, `HERO LV ${level}`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize}px`, color: UI.textAccent,
  }).setDepth(5002);
  const plLineText = scene.add.text(px + pw - 20, cursor, `PL ${spent}/${total} SPENT · ${banked} BANKED`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: banked > 0 ? UI.textAccent : UI.textDim,
  }).setOrigin(1, 0).setDepth(5002);
  addHoverTipZone(scene, { x: plLineText.x - plLineText.width, y: plLineText.y, w: plLineText.width, h: plLineText.height }, [
    { title: 'PL spent / banked', body: 'Every hero level grants 3 PL. Buy stats with +/-, then CONFIRM to spend it — nothing is written to the run until you confirm. Unaffordable buys are disabled.' },
  ], 5003);
  cursor += labelSize + 10;
  scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.5).setOrigin(0, 0).setDepth(5002);
  cursor += 14;

  const cellW = (innerW - gap * (cols - 1)) / cols;
  rows.forEach(([stat, label], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = innerX + col * (cellW + gap);
    const cy = cursor + row * (cellH + gap);
    const buys = alloc[stat] ?? 0;
    const cost = LEVEL_STAT_COST[stat];
    const canBuy = banked >= cost.pl;
    const canSell = buys > 0;
    const gained = buys * cost.gain;

    const labelW = cellW - (btn * 2 + 8);
    scene.add.rectangle(cx + btn + 4, cy, labelW, cellH, UI.panelMuted, 0.7).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4).setDepth(5002);
    scene.add.text(cx + btn + 14, cy + cellH / 2 - 8, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: UI.textDim,
    }).setDepth(5002);
    // 5003: above the modal panel/scrim, else the pointer never reaches it.
    addHoverTipZone(scene, { x: cx + btn + 4, y: cy, w: labelW, h: cellH }, [statHoverEntry(label)], 5003);
    scene.add.text(cx + btn + 14, cy + cellH / 2 + 6, gained > 0 ? `+${gained}` : '·', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: gained > 0 ? UI.textAccent : UI.textSoft,
    }).setDepth(5002);
    scene.add.text(cx + btn + 4 + labelW - 6, cy + cellH / 2, `${cost.pl}PL`, {
      fontFamily: FONT.body, fontSize: `${smallSize - 1}px`, color: UI.textSoft,
    }).setOrigin(1, 0.5).setDepth(5002);

    // MINUS (left)
    const minusFill = canSell ? UI.panelAlt : UI.panelMuted;
    const minusBtn = scene.add.rectangle(cx, cy, btn, cellH, minusFill, canSell ? 1 : 0.4).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, canSell ? 0.7 : 0.25).setDepth(5002);
    scene.add.text(cx + btn / 2, cy + cellH / 2, '−', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize + 2}px`, color: canSell ? UI.text : UI.textSoft,
    }).setOrigin(0.5).setDepth(5002);
    if (canSell) {
      minusBtn.setInteractive({ useHandCursor: true });
      minusBtn.on('pointerdown', () => {
        const next = { ...ensureScratch(), [stat]: Math.max(0, (alloc[stat] ?? 0) - 1) };
        scratch = next;
        onChanged();
      });
    }

    // PLUS (right)
    const plusX = cx + btn + 4 + labelW + 4;
    const plusFill = canBuy ? UI.panelAlt : UI.panelMuted;
    const plusBtn = scene.add.rectangle(plusX, cy, btn, cellH, plusFill, canBuy ? 1 : 0.4).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, canBuy ? 0.7 : 0.25).setDepth(5002);
    scene.add.text(plusX + btn / 2, cy + cellH / 2, '+', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize + 2}px`, color: canBuy ? UI.text : UI.textSoft,
    }).setOrigin(0.5).setDepth(5002);
    if (canBuy) {
      plusBtn.setInteractive({ useHandCursor: true });
      plusBtn.on('pointerdown', () => {
        const next = { ...ensureScratch(), [stat]: (alloc[stat] ?? 0) + 1 };
        scratch = next;
        onChanged();
      });
    }
  });
  cursor += gridRows * (cellH + gap) + 6;

  // CONFIRM / CANCEL row.
  const btnH = compact ? 34 : 38;
  const btnW = (innerW - 10) / 2;
  const cancelBtn = scene.add.rectangle(innerX, cursor, btnW, btnH, UI.panelMuted, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setDepth(5002);
  scene.add.text(innerX + btnW / 2, cursor + btnH / 2, 'CANCEL', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize}px`, color: UI.text,
  }).setOrigin(0.5).setDepth(5002);
  cancelBtn.on('pointerdown', cancelAndClose);

  const confirmX = innerX + btnW + 10;
  const confirmBtn = scene.add.rectangle(confirmX, cursor, btnW, btnH, UI.chip, 1).setOrigin(0, 0)
    .setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true }).setDepth(5002);
  scene.add.text(confirmX + btnW / 2, cursor + btnH / 2, 'CONFIRM', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize}px`, color: UI.textOnChip,
  }).setOrigin(0.5).setDepth(5002);
  confirmBtn.on('pointerdown', () => {
    commitHeroAllocation(ensureScratch());
    discardStatPanelScratch();
    onConfirm();
  });
  cursor += btnH + 6;

  scene.add.text(innerX, cursor, 'Add or subtract freely, then CONFIRM to spend. CANCEL discards.', {
    fontFamily: FONT.body, fontSize: `${smallSize - 1}px`, color: UI.textSoft, wordWrap: { width: innerW },
  }).setDepth(5002);
}

/**
 * Header badge: "n PL TO SPEND" whenever the run has unspent PL — the nudge
 * the locked design requires so a player never walks into a fight unaware of
 * banked points. Renders nothing when `bankedPL <= 0`. Returns the badge's
 * width so callers can lay out the rest of the header around it.
 */
export function renderBankedPlBadge(
  scene: Phaser.Scene,
  x: number, y: number, fontSize: number,
  onPress: () => void,
): number {
  const banked = currentBankedPL();
  if (banked <= 0) return 0;
  const label = `${banked} PL TO SPEND`;
  const padX = 10;
  const h = fontSize + 12;
  const text = scene.add.text(0, 0, label, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontSize}px`, color: UI.textOnChip,
  }).setVisible(false);
  const w = text.width + padX * 2;
  text.destroy();
  const badge = scene.add.rectangle(x, y, w, h, UI.chip, 1).setOrigin(1, 0).setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true });
  scene.add.text(x - w / 2, y + h / 2, label, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontSize}px`, color: UI.textOnChip,
  }).setOrigin(0.5);
  badge.on('pointerdown', onPress);
  scene.tweens.add({ targets: badge, alpha: 0.75, duration: 650, yoyo: true, repeat: -1 });
  return w;
}
