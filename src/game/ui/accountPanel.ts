import Phaser from 'phaser';
import { normalizeEmail, type AccountProvider } from '../../meta/account';
import { GHOST_NAME_MAX } from '../../run/ghost';
import { normalizeGhostName } from '../../run/ghostValidate';
import {
  clearAccountNotice,
  getAccountState,
  initAccount,
  onAccountChange,
  renameAccount,
  sendEmailSignIn,
  startSteamSignIn,
  type AccountState,
} from '../accountSession';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, START_SCENE_INK, startSceneTextRole, UI } from '../theme';
import { attachButtonFeel } from './motion';
import { promptForLine } from './textPrompt';

const PANEL_DEPTH = 1000;

function chipLabel(state: AccountState): string {
  if (state.account) return `ACCOUNT · ${state.account.displayName}`;
  return state.status === 'offline' ? 'ACCOUNT · offline' : 'ACCOUNT · …';
}

function linkLabel(state: AccountState, provider: AccountProvider): string | null {
  return state.account?.links.find((link) => link.provider === provider)?.label ?? null;
}

interface PanelMetrics {
  width: number;
  pad: number;
  rowH: number;
  labelW: number;
  buttonW: number;
  buttonH: number;
  title: number;
  body: number;
  small: number;
}

function panelMetrics(mobile: boolean): PanelMetrics {
  return mobile
    ? { width: Math.min(SCREEN.width - 28, 440), pad: 16, rowH: 52, labelW: 64, buttonW: 120, buttonH: 44, title: 16, body: 12, small: 11 }
    : { width: 540, pad: 24, rowH: 54, labelW: 90, buttonW: 150, buttonH: 38, title: 18, body: 14, small: 12 };
}

function buildPanel(scene: Phaser.Scene, state: AccountState, onClose: () => void): Phaser.GameObjects.Container {
  const mobile = ACTIVE_PROFILE.id === 'mobile';
  const m = panelMetrics(mobile);
  const container = scene.add.container(0, 0).setDepth(PANEL_DEPTH);
  const scrim = scene.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, 0.72).setOrigin(0, 0).setInteractive();
  scrim.on('pointerdown', onClose);
  container.add(scrim);

  const ready = state.status === 'ready' && state.account !== null;
  const textStyle = (size: number, color: string, bold = false): Phaser.Types.GameObjects.Text.TextStyle => ({
    fontFamily: FONT.body, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal',
  });

  const items: Phaser.GameObjects.GameObject[] = [];
  const left = (SCREEN.width - m.width) / 2;
  const heading = scene.add.text(left + m.pad, m.pad, 'ACCOUNT', { ...textStyle(m.title, UI.textAccent, true), letterSpacing: 2 });
  items.push(heading);
  let y = m.pad + heading.height + 12;

  const addButton = (label: string, rowY: number, onPress: () => void): void => {
    const x = left + m.width - m.pad - m.buttonW / 2;
    const plate = scene.add.rectangle(x, rowY, m.buttonW, m.buttonH, UI.chip, 1)
      .setStrokeStyle(1, UI.border, 1).setInteractive({ useHandCursor: true });
    const text = scene.add.text(x, rowY, label, { ...textStyle(m.small, UI.textOnChip, true), letterSpacing: 1 }).setOrigin(0.5);
    attachButtonFeel(scene, plate, { fill: UI.chip, hover: 0xd8ad5e, follow: [text], lift: 1, onPress });
    items.push(plate, text);
  };

  const addRow = (label: string, value: string, button: { label: string; onPress: () => void } | null): void => {
    const rowY = y + m.rowH / 2;
    items.push(scene.add.text(left + m.pad, rowY, label, { ...textStyle(m.small, UI.textMuted, true), letterSpacing: 1 }).setOrigin(0, 0.5));
    const valueMax = m.width - m.pad * 2 - m.labelW - (button ? m.buttonW + 8 : 0);
    items.push(scene.add.text(left + m.pad + m.labelW, rowY, value, {
      ...textStyle(m.body, UI.text), fixedWidth: valueMax,
    }).setOrigin(0, 0.5));
    if (button) addButton(button.label, rowY, button.onPress);
    items.push(scene.add.rectangle(left + m.pad, y + m.rowH, m.width - m.pad * 2, 1, UI.border, 0.35).setOrigin(0, 0.5));
    y += m.rowH;
  };

  if (ready) {
    const account = state.account!;
    addRow('NAME', account.displayName, {
      label: 'RENAME',
      onPress: () => {
        void promptForLine({
          title: 'ACCOUNT NAME',
          initial: account.displayName,
          hint: `Shown to other players who face your builds. Max ${GHOST_NAME_MAX} characters.`,
          validate: (value) => (normalizeGhostName(value) === null ? 'name cannot be empty' : null),
        }).then((value) => { if (value !== null) void renameAccount(value); });
      },
    });
    const steam = linkLabel(state, 'steam');
    addRow('STEAM', steam ? 'Linked' : 'Not linked', steam ? null : {
      label: 'LINK STEAM',
      onPress: () => { void startSteamSignIn(); },
    });
    const email = linkLabel(state, 'email');
    if (state.features.email) {
      addRow('EMAIL', email ?? 'Not linked', email ? null : {
        label: 'LINK EMAIL',
        onPress: () => {
          void promptForLine({
            title: 'EMAIL SIGN-IN',
            initial: '',
            hint: 'We send a one-time sign-in link. If this email is already linked, the link signs you in to that account.',
            applyLabel: 'SEND LINK',
            validate: (value) => (normalizeEmail(value) === null ? 'enter a valid email address' : null),
          }).then((value) => { if (value !== null) void sendEmailSignIn(value); });
        },
      });
    } else {
      addRow('EMAIL', email ?? 'Not available yet', null);
    }
  } else {
    addRow('STATUS', state.status === 'offline' ? "Can't reach the account server." : 'Connecting…', null);
  }

  y += 12;
  const hint = scene.add.text(left + m.pad, y, ready
    ? 'Link Steam or email to keep this account on other devices. If it is already linked to another account, you switch to that one.'
    : 'You can still play. Your builds upload once the account server is back.', {
    ...textStyle(m.small, UI.textMuted), wordWrap: { width: m.width - m.pad * 2 }, lineSpacing: 3,
  });
  items.push(hint);
  y += hint.height;

  if (state.notice) {
    y += 10;
    const notice = scene.add.text(left + m.pad, y, state.notice, {
      ...textStyle(m.body, UI.textAccent, true), wordWrap: { width: m.width - m.pad * 2 },
    });
    items.push(notice);
    y += notice.height;
  }

  y += 16;
  const closeY = y + m.buttonH / 2;
  addButton('CLOSE', closeY, onClose);
  y += m.buttonH + m.pad;

  const height = y;
  const top = Math.max(SCREEN.safeTop + 12, (SCREEN.height - height) / 2);
  const plate = scene.add.rectangle(left, top, m.width, height, UI.panelAlt, 1)
    .setOrigin(0, 0).setStrokeStyle(2, UI.border, 1).setInteractive();
  container.add(plate);
  for (const item of items) {
    const positioned = item as unknown as { y: number };
    positioned.y += top;
    container.add(item);
  }
  return container;
}

export function addAccountChip(scene: Phaser.Scene): void {
  const mobile = ACTIVE_PROFILE.id === 'mobile';
  const margin = mobile ? 14 : 24;
  const height = mobile ? 28 : 32;
  const width = mobile ? 210 : 280;
  const y = margin + height / 2;
  const target = scene.add.rectangle(margin, y, width, height, UI.bg, 0.001)
    .setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
  const label = scene.add.text(margin + 4, y, chipLabel(getAccountState()), {
    ...startSceneTextRole('sandboxDetail'), letterSpacing: 1,
  }).setOrigin(0, 0.5).setShadow(0, 1, START_SCENE_INK.shadow, 3, true, true);

  let panel: Phaser.GameObjects.Container | null = null;
  const close = (): void => {
    panel?.destroy();
    panel = null;
    clearAccountNotice();
  };
  const open = (): void => {
    panel?.destroy();
    panel = buildPanel(scene, getAccountState(), close);
  };

  attachButtonFeel(scene, target, {
    fill: UI.bg, hover: 0x1d3950, alpha: 0.001, follow: [label], lift: 1,
    onPress: () => {
      if (getAccountState().status === 'offline') void initAccount();
      open();
    },
  });

  const unsubscribe = onAccountChange((next) => {
    label.setText(chipLabel(next));
    if (panel || next.notice) open();
  });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    unsubscribe();
    panel = null;
  });
  void initAccount();
  if (getAccountState().notice) open();
}
