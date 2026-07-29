import type Phaser from 'phaser';
import { FONT, SCREEN, UI } from '../theme';
import type { ArmedTutorialCard, TutorialAnchorRect } from './types';

/**
 * Rendering for the tutorial's pointer card + entry chip. Pure Phaser
 * drawing over data the scene already resolved (a step + its anchor rect) —
 * no combat/PL logic lives here; every number in a step's copy came from the
 * `payload` the calling scene handed `notifyTutorial` (see `controller.ts`).
 */

const DEPTH = 9000;
const CARD_W = 260;

/**
 * Draws one small pointer card near `anchor`, with a persistent SKIP
 * TUTORIAL control and a GOT IT dismiss. A missing `card` (nothing queued)
 * OR a missing `anchor` (the current scene doesn't expose that anchor id
 * this frame) is a silent no-op — the tutorial must never crash or block a
 * fight over a layout gap.
 */
export function renderTutorialCard(
  scene: Phaser.Scene,
  card: ArmedTutorialCard | undefined,
  anchor: TutorialAnchorRect | undefined,
  onDismiss: () => void,
  onSkip: () => void,
): void {
  if (!card || !anchor) return;
  const { step, payload } = card;

  const bodyText = step.body(payload);
  const pad = 10;
  const titleH = 13;
  const maxTextW = CARD_W - pad * 2;

  // Measure the wrapped body height before placing the card (a throwaway,
  // invisible text object — destroyed immediately after).
  const measure = scene.add.text(0, 0, bodyText, {
    fontFamily: FONT.body, fontSize: '11px', color: UI.text, wordWrap: { width: maxTextW },
  }).setVisible(false);
  const bodyH = measure.height;
  measure.destroy();

  const footerH = 22;
  const cardH = pad * 2 + titleH + 6 + bodyH + 8 + footerH;

  // Prefer sitting just BELOW the anchor; flip above it if that would run
  // off the bottom edge. Clamp X so the card stays fully on-screen at both
  // 1440×900 and 412×892 without needing per-platform copy or layout.
  let cy = anchor.y + anchor.h + 8;
  if (cy + cardH > SCREEN.height - 8) cy = Math.max(8, anchor.y - cardH - 8);
  let cx = anchor.x + anchor.w / 2 - CARD_W / 2;
  cx = Math.max(8, Math.min(SCREEN.width - CARD_W - 8, cx));

  // Highlight the real UI element the card is teaching, so the pointer
  // reads as diegetic (pointing at the actual bar/badge/grid) rather than a
  // detached modal.
  scene.add.rectangle(anchor.x, anchor.y, Math.max(1, anchor.w), Math.max(1, anchor.h), 0, 0)
    .setOrigin(0, 0).setStrokeStyle(2, UI.chip ?? 0xb78a46, 0.9).setDepth(DEPTH);

  scene.add.rectangle(cx, cy, CARD_W, cardH, UI.panelAlt, 0.98)
    .setOrigin(0, 0).setStrokeStyle(2, UI.chip ?? 0xb78a46, 1).setDepth(DEPTH + 1);
  scene.add.text(cx + pad, cy + pad, step.title, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: '11px', color: UI.textAccent,
  }).setDepth(DEPTH + 2);
  scene.add.text(cx + pad, cy + pad + titleH + 6, bodyText, {
    fontFamily: FONT.body, fontSize: '11px', color: UI.text, wordWrap: { width: maxTextW },
  }).setDepth(DEPTH + 2);

  const footerY = cy + cardH - pad - footerH + 2;
  const skip = scene.add.text(cx + pad, footerY + 10, 'SKIP TUTORIAL', {
    fontFamily: FONT.body, fontSize: '9px', color: UI.textSoft,
  }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).setDepth(DEPTH + 2);
  skip.on('pointerover', () => skip.setColor(UI.textDim));
  skip.on('pointerout', () => skip.setColor(UI.textSoft));
  skip.on('pointerdown', onSkip);

  const gotItW = 64;
  const gotIt = scene.add.rectangle(cx + CARD_W - pad - gotItW, footerY, gotItW, footerH - 2, UI.chip, 1)
    .setOrigin(0, 0).setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true }).setDepth(DEPTH + 2);
  scene.add.text(cx + CARD_W - pad - gotItW / 2, footerY + (footerH - 2) / 2, 'GOT IT', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: '10px', color: UI.textOnChip,
  }).setOrigin(0.5).setDepth(DEPTH + 2);
  gotIt.on('pointerdown', onDismiss);
}

/**
 * The Run Map's one-line tutorial entry indicator: "TUTORIAL: ON · skip" —
 * NOT a gate on anything (START/every screen stays reachable), just a
 * persistent, always-tappable reminder that the tutorial is armed and can be
 * turned off right there.
 */
export function renderTutorialEntryChip(
  scene: Phaser.Scene,
  x: number, y: number, fontSize: number,
  onSkip: () => void,
): void {
  const label = 'TUTORIAL: ON · skip';
  const t = scene.add.text(x, y, label, {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${fontSize}px`, color: UI.textDim,
  }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
  t.on('pointerover', () => t.setColor(UI.textAccent));
  t.on('pointerout', () => t.setColor(UI.textDim));
  t.on('pointerdown', onSkip);
}
