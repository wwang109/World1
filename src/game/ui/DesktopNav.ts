import Phaser from 'phaser';
import { FONT, SCREEN, UI } from '../theme';
import { DESKTOP_PROFILE } from '../layoutProfile';

export type DesktopPage = 'prep' | 'deck' | 'wiki';

const F = DESKTOP_PROFILE.font;

/**
 * Shared desktop chrome geometry — every desktop scene lays out content
 * between `contentTop` and `SCREEN.height - safe.bottom`, inset by `gutter`.
 */
export const DESKTOP_LAYOUT = {
  gutter: DESKTOP_PROFILE.safe.x,
  /** First y a scene may draw content at (below header + tabs + divider). */
  contentTop: 168,
  gap: DESKTOP_PROFILE.gap,
  tabH: DESKTOP_PROFILE.minTap,
} as const;

export function renderDesktopHeader(scene: Phaser.Scene, title: string, active: DesktopPage): void {
  const gx = DESKTOP_LAYOUT.gutter;
  scene.add.text(gx, 24, 'WORLD1 / ARCANE LOADOUT', {
    fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
  });
  scene.add.text(gx, 44, title, {
    fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big}px`, color: UI.text,
  });

  const tabs: Array<[string, DesktopPage]> = [['PREP', 'prep'], ['DECK BUILD', 'deck'], ['WIKI', 'wiki']];
  const tabY = 102;
  let x = gx;
  for (const [label, page] of tabs) {
    const activeTab = active === page;
    const width = 44 + label.length * 9;
    const button = scene.add.rectangle(x, tabY, width, DESKTOP_LAYOUT.tabH, activeTab ? UI.chip : UI.panelAlt)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, activeTab ? 1 : 0.6).setInteractive({ useHandCursor: true });
    scene.add.text(x + width / 2, tabY + DESKTOP_LAYOUT.tabH / 2, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`,
      color: activeTab ? UI.textOnChip : UI.textDim,
    }).setOrigin(0.5);
    if (!activeTab) {
      button.on('pointerover', () => button.setFillStyle(UI.slotHover));
      button.on('pointerout', () => button.setFillStyle(UI.panelAlt));
      button.on('pointerdown', () => {
        const target = page === 'prep' ? 'DesktopPrep' : page === 'deck' ? 'DesktopDeck' : 'DesktopWiki';
        scene.scene.start(target);
      });
    }
    x += width + DESKTOP_LAYOUT.gap;
  }
  scene.add.rectangle(gx, DESKTOP_LAYOUT.contentTop - 14, SCREEN.width - gx * 2, 1, UI.border, 0.7).setOrigin(0, 0);
}

export function renderDesktopBackground(scene: Phaser.Scene): void {
  scene.cameras.main.setBackgroundColor(UI.bg);
  scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);
  scene.add.circle(SCREEN.width * 0.56, -100, 400, UI.bgBlobA, 0.26);
  scene.add.circle(SCREEN.width * 0.95, SCREEN.height * 0.68, 340, UI.bgBlobB, 0.18);
}
