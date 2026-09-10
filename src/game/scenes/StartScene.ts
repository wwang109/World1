import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { getLifetimeStats } from '../metaStore';
import { SCREEN, START_SCENE_INK, startSceneTextRole, UI } from '../theme';
import { addBrightRunArt, RUN_ART_KEYS } from '../ui/runArt';
import { BRIGHT_ART_TREATMENT } from '../ui/brightArtTreatment';
import { getActiveRun, getPendingSeed, rerollPendingSeed, startRun } from '../runStore';
import { attachButtonFeel } from '../ui/motion';
import {
  startSceneAssetPaths,
  startSceneLayout,
  startSceneLifetimeOffsets,
  startScenePrimaryPresentation,
  startScenePrimaryVisualLayout,
  type CenteredRect,
  type StartScenePrimaryPresentation,
} from '../ui/startSceneLayout';

/**
 * The illustrated front door on both profiles. Release play is unmistakably
 * primary; Sandbox remains the quiet route to the free-build playground.
 */
export class StartScene extends Phaser.Scene {
  constructor() { super('Start'); }

  preload(): void {
    const assets = startSceneAssetPaths(ACTIVE_PROFILE.id);
    if (!this.textures.exists('start-background')) this.load.image('start-background', assets.background);
    if (!this.textures.exists('start-cta-frame')) this.load.image('start-cta-frame', assets.ctaFrame);
    if (!this.textures.exists('start-icons')) {
      this.load.spritesheet('start-icons', assets.icons, { frameWidth: 543, frameHeight: 724 });
    }
  }

  create(): void {
    const mobile = ACTIVE_PROFILE.id === 'mobile';
    const layout = startSceneLayout(ACTIVE_PROFILE.id, SCREEN.width, SCREEN.height);
    this.cameras.main.setBackgroundColor(UI.bg);

    // Preserve the approved bright-world backdrop and its established crop.
    const backdrop = addBrightRunArt(this, RUN_ART_KEYS.runMap, {
      x: 0, y: 0, width: SCREEN.width, height: SCREEN.height,
    }, BRIGHT_ART_TREATMENT.start);
    backdrop.image?.setAlpha(1);
    backdrop.lift.setAlpha(0.04);
    const background = this.add.image(layout.centerX, SCREEN.height / 2, 'start-background');
    const backgroundScale = Math.max(SCREEN.width / background.width, SCREEN.height / background.height);
    background.setDisplaySize(background.width * backgroundScale, background.height * backgroundScale);

    // Layered ellipses produce the mockup's localized soft vignette without
    // returning to the large rectangular focus plate the redesign removes.
    const v = layout.vignette;
    for (let i = 0; i < BRIGHT_ART_TREATMENT.start.vignette.layers; i++) {
      const scale = 1 - i * BRIGHT_ART_TREATMENT.start.vignette.scaleStep;
      this.add.ellipse(v.x, v.y, v.width * scale, v.height * scale, UI.bg, BRIGHT_ART_TREATMENT.start.vignette.layerAlpha);
    }

    this.add.text(layout.centerX, layout.eyebrowY, 'A ROGUELITE SKILL-BOARD BATTLER', {
      ...startSceneTextRole('eyebrow'), letterSpacing: mobile ? 2 : 4,
    }).setOrigin(0.5).setShadow(0, 2, START_SCENE_INK.shadow, 5, true, true);

    this.add.text(layout.title.x, layout.title.y, 'WORLD1', {
      ...startSceneTextRole('masthead'), letterSpacing: mobile ? 1 : 4,
    }).setOrigin(0.5).setShadow(0, 5, START_SCENE_INK.shadow, 8, true, true);
    this.ornamentalRule(layout.centerX, layout.ruleY, mobile ? 255 : 500);

    const activeRun = getActiveRun();
    const primary = startScenePrimaryPresentation(Boolean(activeRun), ACTIVE_PROFILE.id);
    this.primaryButton(layout.primary, primary, () => {
        if (getActiveRun()) {
          this.scene.start(mobile ? 'MobileRunMap' : 'DesktopRunMap');
        } else {
          startRun(getPendingSeed());
          this.scene.start(mobile ? 'MobileDraft' : 'DesktopDraft');
        }
      });

    this.sandboxButton(layout.sandbox, () => {
      this.scene.start(mobile ? 'MobilePrep' : 'DesktopPrep');
    });

    this.renderLifetimeLine(layout.centerX, layout.lifetimeY, mobile);
    this.ornamentalRule(layout.centerX, layout.lowerRuleY, mobile ? 245 : 460);

    if (!activeRun) this.seedButton(layout.seed, mobile);
  }

  private ornamentalRule(cx: number, y: number, width: number): void {
    const gold = 0xd89a2b;
    const gap = 18;
    const half = (width - gap) / 2;
    this.add.rectangle(cx - gap / 2 - half / 2, y, half, 1, gold, 0.85);
    this.add.rectangle(cx + gap / 2 + half / 2, y, half, 1, gold, 0.85);
    this.add.rectangle(cx, y, 10, 10, gold, 0.95).setRotation(Math.PI / 4);
    this.add.rectangle(cx, y, 5, 5, UI.bg, 1).setRotation(Math.PI / 4);
  }

  private primaryButton(
    rect: CenteredRect,
    presentation: StartScenePrimaryPresentation,
    onPress: () => void,
  ): void {
    const mobile = ACTIVE_PROFILE.id === 'mobile';
    const visual = startScenePrimaryVisualLayout(ACTIVE_PROFILE.id, rect);
    const plate = this.add.image(rect.x, visual.frameY, 'start-cta-frame')
      .setDisplaySize(visual.frameWidth, visual.frameHeight);
    const target = this.add.rectangle(rect.x, rect.y, rect.width, rect.height, 0x000000, 0.001)
      .setInteractive({ useHandCursor: true });
    const labelText = this.add.text(rect.x, visual.labelY, presentation.label, {
      ...startSceneTextRole(mobile ? 'primaryLabelCompact' : 'primaryLabel'),
      letterSpacing: ACTIVE_PROFILE.id === 'mobile' ? 0 : 1,
    }).setOrigin(0.5).setScale(mobile ? presentation.labelFontSize / 20 : 1)
      .setShadow(0, 2, START_SCENE_INK.primaryShadow, 3, true, true);
    const subText = this.add.text(rect.x, visual.detailY, presentation.detail, {
      ...startSceneTextRole('primaryDetail'),
    }).setOrigin(0.5).setScale(mobile ? 0.8 : 1);
    target.on('pointerover', () => plate.setTint(0xffe1c9));
    target.on('pointerout', () => plate.clearTint());
    target.on('pointerdown', () => plate.setTint(0xd99b88));
    target.on('pointerup', () => plate.setTint(0xffe1c9));
    attachButtonFeel(this, target, {
      fill: 0x000000, hover: 0x000000, alpha: 0.001, follow: [plate, labelText, subText], lift: 2,
      onPress: () => { playSfx('uiClick'); onPress(); },
    });
  }

  private sandboxButton(rect: CenteredRect, onPress: () => void): void {
    const fill = UI.bg;
    const target = this.add.rectangle(rect.x, rect.y, rect.width, rect.height, fill, 0.08)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(rect.x, rect.y - 8, 'SANDBOX  ›', {
      ...startSceneTextRole('sandboxLabel'), letterSpacing: 2,
    }).setOrigin(0.5).setScale(ACTIVE_PROFILE.id === 'mobile' ? 0.9 : 1)
      .setShadow(0, 2, START_SCENE_INK.shadow, 4, true, true);
    const sub = this.add.text(rect.x, rect.y + 20, 'Free build & balance playground', {
      ...startSceneTextRole('sandboxDetail'),
    }).setOrigin(0.5).setScale(ACTIVE_PROFILE.id === 'mobile' ? 0.9 : 1)
      .setShadow(0, 1, START_SCENE_INK.shadow, 3, true, true);
    attachButtonFeel(this, target, {
      fill, hover: 0x1d3950, alpha: 0.18, follow: [label, sub], lift: 1,
      onPress: () => { playSfx('uiClick'); onPress(); },
    });
  }

  private renderLifetimeLine(cx: number, y: number, mobile: boolean): void {
    const lifetime = getLifetimeStats();
    if (lifetime.runsStarted === 0) return;
    const offsets = startSceneLifetimeOffsets(mobile ? 'mobile' : 'desktop');
    const unit = mobile ? 0.65 : offsets.unit;
    const groups = [
      { frame: 0, x: cx + offsets.icons[0], text: `${lifetime.runsStarted} runs`, textX: cx + offsets.text[0] },
      { frame: 1, x: cx + offsets.icons[1], text: `${lifetime.totalBossesCleared} bosses`, textX: cx + offsets.text[1] },
      { frame: 2, x: cx + offsets.icons[2], text: `best: wave ${lifetime.bestRun.deepestWave}`, textX: cx + offsets.text[2] },
    ];
    for (const group of groups) {
      this.add.image(group.x, y, 'start-icons', group.frame).setDisplaySize(32 * unit, 43 * unit);
      this.add.text(group.textX, y, group.text, startSceneTextRole('lifetime'))
        .setOrigin(0, 0.5)
        .setShadow(0, 2, START_SCENE_INK.shadow, 4, true, true);
    }
    for (const separatorX of offsets.separators.map((offset) => cx + offset)) {
      this.add.text(separatorX, y, '·', startSceneTextRole('lifetime')).setOrigin(0.5);
    }
  }

  private seedButton(rect: CenteredRect, mobile: boolean): void {
    const fill = UI.bg;
    const seedLabel = (): string => `seed ${getPendingSeed()}  ·  reroll`;
    const visualWidth = mobile ? 160 : rect.width;
    const visualHeight = mobile ? 36 : rect.height;
    const plate = this.add.rectangle(rect.x, rect.y, visualWidth, visualHeight, fill, 0.78)
      .setStrokeStyle(1, 0xd89a2b, 0.95);
    const target = this.add.rectangle(rect.x, rect.y, rect.width, rect.height, fill, 0.001)
      .setInteractive({ useHandCursor: true });
    const iconX = rect.x - visualWidth / 2 + 22;
    const dividerX = rect.x - visualWidth / 2 + 43;
    const icon = this.add.image(iconX, rect.y, 'start-icons', 3)
      .setDisplaySize(mobile ? 27 : 36, mobile ? 36 : 48);
    const divider = this.add.rectangle(dividerX, rect.y, 1, visualHeight - 8, 0xd89a2b, 0.9);
    const label = this.add.text(rect.x + (mobile ? 17 : 20), rect.y, seedLabel(), {
      ...startSceneTextRole('seed'),
    }).setOrigin(0.5).setScale(mobile ? 0.75 : 1);
    attachButtonFeel(this, target, {
      fill, hover: 0x1d3950, alpha: 0.001, follow: [plate, icon, divider, label],
      onPress: () => {
        playSfx('uiClick');
        rerollPendingSeed();
        label.setText(seedLabel());
      },
    });
  }
}
