import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { getLifetimeStats } from '../metaStore';
import { FONT, SCREEN, UI } from '../theme';
import { brandMarkCenterY, renderBrandMark } from '../ui/brandMark';
import { getActiveRun, getPendingSeed, rerollPendingSeed, startRun } from '../runStore';
import { attachButtonFeel } from '../ui/motion';

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

    // Same block, same metrics, as the loading screen draws (`ui/brandMark.ts`)
    // -- the handoff Boot -> Start must not make the logo jump.
    renderBrandMark(this, cx, brandMarkCenterY(mobile ? 0.26 : 0.3), { rule: true });

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
    const secondY = firstY + btnH + (mobile ? 22 : 26);
    this.button(cx, secondY, btnW, btnH, 'SANDBOX',
      'Free build & balance playground', false, () => {
        this.scene.start(mobile ? 'MobilePrep' : 'DesktopPrep');
      });

    this.renderLifetimeStrip(cx, secondY + btnH / 2 + (mobile ? 26 : 30), mobile, F);

    if (!activeRun) {
      // The map's old start panel (deleted — one front door now) carried the
      // seed box + REROLL; this footnote inherits that job in-place.
      const seedLabel = (): string => `seed ${getPendingSeed()} · tap to reroll`;
      const seedText = this.add.text(cx, SCREEN.height - (mobile ? 24 : 30), seedLabel(), {
        fontFamily: 'monospace', fontSize: `${F.tiny}px`, color: UI.textMuted,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      seedText.on('pointerdown', () => {
        playSfx('uiClick');
        rerollPendingSeed();
        seedText.setText(seedLabel());
      });
    }
  }

  /** The account's lifetime strip — subtle, not a panel (`UI.textMuted`,
   * tiny/small type), only once at least one run has ever been started (a
   * brand-new install has nothing to brag about yet). One line either
   * platform: the string is short enough that desktop's extra width doesn't
   * need a second line, but `wordWrap` guards a very long best-run number. */
  private renderLifetimeStrip(cx: number, y: number, mobile: boolean, F: typeof ACTIVE_PROFILE.font): void {
    const lifetime = getLifetimeStats();
    if (lifetime.runsStarted === 0) return;
    const text = `${lifetime.runsStarted} runs · ${lifetime.totalBossesCleared} bosses · `
      + `best: ${lifetime.bestRun.bossesCleared} bosses / wave ${lifetime.bestRun.deepestWave}`;
    this.add.text(cx, y, text, {
      fontFamily: FONT.body, fontSize: `${mobile ? F.tiny : F.small}px`, color: UI.textMuted, align: 'center',
      wordWrap: { width: mobile ? SCREEN.width - 40 : 560 },
    }).setOrigin(0.5, 0);
  }

  private button(cx: number, y: number, w: number, h: number, label: string, sub: string, primary: boolean, onPress: () => void): void {
    const fill = primary ? 0xb78a46 : 0x131f32;
    const r = this.add.rectangle(cx, y, w, h, fill)
      .setStrokeStyle(2, primary ? 0xe8b446 : UI.border, 0.9)
      .setInteractive({ useHandCursor: true });
    const labelText = this.add.text(cx, y - 8, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${ACTIVE_PROFILE.font.title}px`,
      color: primary ? UI.textOnChip : UI.textBright,
    }).setOrigin(0.5);
    const subText = this.add.text(cx, y + 14, sub, {
      fontFamily: FONT.body, fontSize: `${ACTIVE_PROFILE.font.tiny}px`,
      color: primary ? '#3a2a10' : UI.textMuted,
    }).setOrigin(0.5);
    // THE FIRST SCREEN A PLAYER TOUCHES, and it had neither hover nor press
    // feedback — a click produced a sound and a scene change with no
    // acknowledgement from the button. One factory serves every Start button on
    // BOTH platforms (this scene branches on `mobile` internally), so wiring it
    // here covers them all. Both labels ride the plate.
    attachButtonFeel(this, r, {
      fill,
      hover: primary ? 0xc79b52 : 0x1d3950,
      follow: [labelText, subText],
      onPress: () => { playSfx('uiClick'); onPress(); },
    });
  }
}
