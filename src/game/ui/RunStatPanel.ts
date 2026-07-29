import Phaser from 'phaser';
import { LEVEL_STAT_COST, spentPL, totalLevelPL, type LevelStat } from '../../run/leveling';
import { buyCurrentHeroStat, currentBankedPL, currentHeroAllocation, currentHeroLevel } from '../runStore';
import { FONT, SCREEN, UI } from '../theme';
import type { TutorialAnchorRect } from '../tutorial/types';

/** Anchor rects this panel exposes for the run tutorial's PL lesson (see
 * `src/game/tutorial`) — the priced allocation grid and the PL SPENT/BANKED
 * readout it sits under. Callers pass these straight through to
 * `renderTutorialCard`; this module has no tutorial logic of its own. */
export interface RunStatPanelAnchors { gridAnchor: TutorialAnchorRect; plLineAnchor: TutorialAnchorRect; }

/**
 * Run Mode's stat/level allocation overlay — the one place a player spends
 * banked PL (see docs/release-game-plan.md "Hero leveling & stat allocation",
 * a HARD user requirement). Reachable from BOTH the Run Map and Run Prep
 * headers via the "n PL TO SPEND" badge (`renderBankedPlBadge` below).
 * Additive-only: every button is a `+` buy through `buyCurrentHeroStat`
 * (`src/run/runState.ts#buyHeroStatAllocation`) — no sell/respec here, unlike
 * the Sandbox's LV stepper (a run's level only ever goes up).
 *
 * One shared implementation for both platforms — `compact` picks the mobile-
 * friendly sizing (narrower panel, smaller type, 2-column grid) vs desktop's
 * roomier 3-column grid. Renders as a full-screen scrim + centered panel;
 * `onChanged` is called after every buy so the calling scene can `rerender()`
 * itself (this module never rebuilds a scene on its own).
 */
export function renderRunStatPanel(
  scene: Phaser.Scene,
  opts: { compact: boolean; onClose: () => void; onChanged: () => void },
): RunStatPanelAnchors {
  const { compact, onClose, onChanged } = opts;
  const level = currentHeroLevel();
  const alloc = currentHeroAllocation();
  const banked = currentBankedPL();
  const total = totalLevelPL(level);
  const spent = spentPL(alloc);

  const rows: Array<[LevelStat, string]> = [
    ['maxHp', 'HP'], ['attack', 'ATK'], ['magicPower', 'MAG'],
    ['armor', 'DEF'], ['magicResist', 'RES'], ['speed', 'SPD'],
  ];
  const cols = compact ? 2 : 3;
  const cellH = compact ? 46 : 40;
  const btn = compact ? 26 : 32;
  const gap = compact ? 6 : 10;

  const pw = Math.min(SCREEN.width - 40, compact ? SCREEN.width - 32 : 460);
  const gridRows = Math.ceil(rows.length / cols);
  const ph = (compact ? 96 : 100) + gridRows * (cellH + gap) + (compact ? 60 : 66);
  const px = (SCREEN.width - pw) / 2;
  const py = Math.max(compact ? 16 : 30, (SCREEN.height - ph) / 2);

  const nameSize = compact ? 15 : 18;
  const smallSize = compact ? 9 : 11;
  const labelSize = compact ? 10 : 12;

  const scrim = scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.78).setOrigin(0, 0).setInteractive().setDepth(5000);
  scrim.on('pointerdown', onClose);
  const panel = scene.add.rectangle(px, py, pw, ph, UI.panelAlt, 0.98).setOrigin(0, 0).setStrokeStyle(2, UI.chip, 1).setInteractive().setDepth(5001);
  void panel; // swallows scrim clicks under the panel

  const innerX = px + 20;
  const innerW = pw - 40;
  let cursor = py + 18;

  scene.add.text(innerX, cursor, 'STAT ALLOCATION', {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${nameSize}px`, color: UI.text,
  }).setDepth(5002);
  const closeBtn = scene.add.text(px + pw - 20, cursor + 2, '✕ CLOSE', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: UI.textDim,
  }).setOrigin(1, 0).setInteractive({ useHandCursor: true }).setDepth(5002);
  closeBtn.on('pointerdown', onClose);
  cursor += nameSize + 8;

  scene.add.text(innerX, cursor, `HERO LV ${level}`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize}px`, color: UI.textAccent,
  }).setDepth(5002);
  const plLineText = scene.add.text(px + pw - 20, cursor, `PL ${spent}/${total} SPENT · ${banked} BANKED`, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: banked > 0 ? UI.textAccent : UI.textDim,
  }).setOrigin(1, 0).setDepth(5002);
  const plLineAnchor: TutorialAnchorRect = { x: plLineText.x - plLineText.width, y: plLineText.y, w: plLineText.width, h: plLineText.height };
  cursor += labelSize + 10;
  scene.add.rectangle(innerX, cursor, innerW, 1, UI.border, 0.5).setOrigin(0, 0).setDepth(5002);
  cursor += 14;

  const gridTop = cursor;
  const cellW = (innerW - gap * (cols - 1)) / cols;
  rows.forEach(([stat, label], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = innerX + col * (cellW + gap);
    const cy = cursor + row * (cellH + gap);
    const buys = alloc[stat] ?? 0;
    const cost = LEVEL_STAT_COST[stat];
    const canBuy = banked >= cost.pl;
    const gained = buys * cost.gain;

    scene.add.rectangle(cx + btn + 4, cy, cellW - (btn + 4), cellH, UI.panelMuted, 0.7).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.4).setDepth(5002);
    scene.add.text(cx + btn + 14, cy + cellH / 2 - 8, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: UI.textDim,
    }).setDepth(5002);
    scene.add.text(cx + btn + 14, cy + cellH / 2 + 6, gained > 0 ? `+${gained}` : '·', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${smallSize}px`, color: gained > 0 ? UI.textAccent : UI.textSoft,
    }).setDepth(5002);
    scene.add.text(cx + cellW - 10, cy + cellH / 2, `${cost.pl} PL`, {
      fontFamily: FONT.body, fontSize: `${smallSize - 1}px`, color: UI.textSoft,
    }).setOrigin(1, 0.5).setDepth(5002);

    const plusFill = canBuy ? UI.panelAlt : UI.panelMuted;
    const plusColor = canBuy ? UI.text : UI.textSoft;
    const plusBtn = scene.add.rectangle(cx, cy, btn, cellH, plusFill, canBuy ? 1 : 0.4).setOrigin(0, 0)
      .setStrokeStyle(1, UI.border, canBuy ? 0.7 : 0.25).setDepth(5002);
    scene.add.text(cx + btn / 2, cy + cellH / 2, '+', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${labelSize + 2}px`, color: plusColor,
    }).setOrigin(0.5).setDepth(5002);
    if (canBuy) {
      plusBtn.setInteractive({ useHandCursor: true });
      plusBtn.on('pointerdown', () => { buyCurrentHeroStat(stat); onChanged(); });
    }
  });
  const gridAnchor: TutorialAnchorRect = { x: innerX, y: gridTop, w: innerW, h: gridRows * (cellH + gap) - gap };
  cursor += gridRows * (cellH + gap) + 6;

  scene.add.text(innerX, cursor, 'Additive only — no respec in a run. Buy any time between fights.', {
    fontFamily: FONT.body, fontSize: `${smallSize - 1}px`, color: UI.textSoft, wordWrap: { width: innerW },
  }).setDepth(5002);

  return { gridAnchor, plLineAnchor };
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
