import Phaser from 'phaser';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { getActiveRun, getPendingSeed, startRun } from '../runStore';

/**
 * Start screen — the game's front door on BOTH platforms (BootScene's
 * default target). Two doors, matching the release/sandbox split:
 *
 *   START RUN › — begins a run immediately: `startRun(seed)` then straight
 *                 into the start DRAFT (same handler the Run Map's start
 *                 panel uses). Becomes RESUME RUN › if a run is active
 *                 (e.g. navigating back here mid-session).
 *   SANDBOX     — the free-dial Prep/Deck/Wiki/Battle playground.
 *
 * One scene serves both profiles: layout derives from ACTIVE_PROFILE.
 */
export class StartScene extends Phaser.Scene {
  constructor() { super('Start'); }

  create(): void {
    const mobile = ACTIVE_PROFILE.id === 'mobile';
    const F = ACTIVE_PROFILE.font;
    const cx = SCREEN.width / 2;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const titleY = Math.round(SCREEN.height * (mobile ? 0.26 : 0.3));
    this.add.text(cx, titleY - (mobile ? 34 : 44), 'A ROGUELITE SKILL-BOARD BATTLER', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textMuted, letterSpacing: 2,
    }).setOrigin(0.5);
    this.add.text(cx, titleY, 'WORLD1', {
      fontFamily: FONT.display ?? FONT.body, fontStyle: 'bold', fontSize: `${mobile ? 44 : 64}px`, color: UI.textBright,
    }).setOrigin(0.5);
    this.add.rectangle(cx, titleY + (mobile ? 34 : 46), mobile ? 180 : 260, 2, 0xb78a46, 0.9);

    const btnW = mobile ? SCREEN.width - 80 : 340;
    const btnH = mobile ? 54 : 58;
    const firstY = Math.round(SCREEN.height * (mobile ? 0.5 : 0.52));
    const activeRun = getActiveRun();

    this.button(cx, firstY, btnW, btnH, activeRun ? 'RESUME RUN ›' : 'START RUN ›',
      'Draft your board · climb the endless ladder', true, () => {
        if (getActiveRun()) {
          this.scene.start(mobile ? 'MobileRunMap' : 'DesktopRunMap');
        } else {
          startRun(getPendingSeed());
          this.scene.start(mobile ? 'MobileDraft' : 'DesktopDraft');
        }
      });
    this.button(cx, firstY + btnH + (mobile ? 22 : 26), btnW, btnH, 'SANDBOX',
      'Free build & balance playground', false, () => {
        this.scene.start(mobile ? 'MobilePrep' : 'DesktopPrep');
      });

    if (!activeRun) {
      this.add.text(cx, SCREEN.height - (mobile ? 24 : 30), `seed ${getPendingSeed()}`, {
        fontFamily: 'monospace', fontSize: `${F.tiny}px`, color: UI.textDisabled,
      }).setOrigin(0.5);
    }
  }

  private button(cx: number, y: number, w: number, h: number, label: string, sub: string, primary: boolean, onPress: () => void): void {
    const r = this.add.rectangle(cx, y, w, h, primary ? 0xb78a46 : 0x131f32)
      .setStrokeStyle(2, primary ? 0xe8b446 : UI.border, 0.9)
      .setInteractive({ useHandCursor: true });
    r.on('pointerdown', onPress);
    this.add.text(cx, y - 8, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${ACTIVE_PROFILE.font.title}px`,
      color: primary ? UI.textOnChip : UI.textBright,
    }).setOrigin(0.5);
    this.add.text(cx, y + 14, sub, {
      fontFamily: FONT.body, fontSize: `${ACTIVE_PROFILE.font.tiny}px`,
      color: primary ? '#3a2a10' : UI.textMuted,
    }).setOrigin(0.5);
  }
}
