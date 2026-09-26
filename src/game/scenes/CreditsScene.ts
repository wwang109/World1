import Phaser from 'phaser';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { SCREEN, UI, textRole } from '../theme';
import { attachButtonFeel } from '../ui/motion';
import {
  CC_BY_LICENSE_URL,
  SFX_CC0_SOURCE_NOTE,
  SFX_CC0_THANKS,
  SFX_CC_BY_CREDITS,
} from '../audio/sfxCredits';

/** Shared scene like `StartScene`/`UiKitScene`, not a Desktop/Mobile pair. */
export class CreditsScene extends Phaser.Scene {
  constructor() { super('Credits'); }

  create(): void {
    const mobile = ACTIVE_PROFILE.id === 'mobile';
    this.cameras.main.setBackgroundColor(UI.bg);
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.bg).setOrigin(0, 0);

    const centerX = Math.round(SCREEN.width / 2);
    const wrapWidth = mobile ? SCREEN.width - 56 : 760;
    const rowGap = mobile ? 4 : 6;
    const sectionGap = mobile ? 16 : 22;

    let y = mobile ? 64 : 90;
    const draw = (text: string, role: Parameters<typeof textRole>[0], extraGap: number): void => {
      const line = this.add.text(centerX, y, text, {
        ...textRole(role), align: 'center', wordWrap: { width: wrapWidth },
      }).setOrigin(0.5, 0);
      y += line.height + extraGap;
    };

    draw('WORLD1 / CREDITS', 'kicker', mobile ? 10 : 14);
    draw('AUDIO CREDITS', 'title', sectionGap);

    draw('REQUIRED ATTRIBUTION', 'kicker', mobile ? 10 : 14);
    for (const entry of SFX_CC_BY_CREDITS) {
      draw(entry.attribution, 'label', rowGap);
      draw(entry.detail, 'micro', sectionGap);
    }

    draw('THANK YOU — CC0 SOURCES', 'kicker', mobile ? 10 : 14);
    draw(SFX_CC0_THANKS.join('  ·  '), 'body', rowGap);
    draw(`via ${SFX_CC0_SOURCE_NOTE}`, 'micro', sectionGap);

    draw(`CC-BY 3.0 license: ${CC_BY_LICENSE_URL}`, 'micro', mobile ? 22 : 28);

    this.renderBackButton(centerX, y, mobile);
  }

  private renderBackButton(centerX: number, y: number, mobile: boolean): void {
    const width = mobile ? 140 : 160;
    const height = mobile ? 38 : 42;
    const cy = y + height / 2;
    const plate = this.add.rectangle(centerX, cy, width, height, UI.panelAlt)
      .setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    const label = this.add.text(centerX, cy, '‹ BACK', textRole('label')).setOrigin(0.5);
    attachButtonFeel(this, plate, {
      fill: UI.panelAlt, hover: UI.slotHover, follow: [label],
      sfx: 'uiBack',
      onPress: () => { this.scene.start('Start'); },
    });
  }
}
