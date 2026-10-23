import type Phaser from 'phaser';
import { eligibleRunSession } from './eligibleRunSession';
import { selectRunMode } from './runMode';
import { FONT, SCREEN, UI } from './theme';
import { attachButtonFeel } from './ui/motion';
import { roundRect } from './ui/roundedRect';

export interface CodexVisit {
  reference?: boolean;
  returnTo?: string;
  accountId?: string;
  runId?: string;
  revision?: number;
  drafting?: boolean;
}

export function renderRunCodexButton(scene: Phaser.Scene, mobile: boolean, refresh: (changed: boolean) => void): void {
  const x = SCREEN.width - (mobile ? 43 : 80), y = mobile ? 25 : 92;
  const target = scene.add.rectangle(x, y, mobile ? 68 : 100, mobile ? 24 : 30, UI.panelAlt)
    .setStrokeStyle(1, UI.border, .7).setInteractive({ useHandCursor: true }).setData('auditControlLabel', 'CODEX');
  if (mobile) roundRect(target, 12);
  const label = scene.add.text(x, y, 'CODEX', { fontFamily: FONT.body, fontStyle: 'bold', fontSize: mobile ? 10 : 13, color: UI.textDim }).setOrigin(.5);
  if (eligibleRunSession.state.busy) target.disableInteractive();
  attachButtonFeel(scene, target, { fill: UI.panelAlt, hover: UI.slotHover, follow: [label], onPress: () => openRunCodex(scene, mobile, refresh) });
}

export function openRunCodex(scene: Phaser.Scene, mobile: boolean, refresh: (changed: boolean) => void): void {
  const state = eligibleRunSession.state;
  if (state.busy || !state.view) return;
  const visit: CodexVisit = { reference: true, returnTo: scene.sys.settings.key, accountId: state.accountId,
    runId: state.view.id, revision: state.view.revision, drafting: state.view.state.status === 'drafting' };
  scene.events.once('codex:refresh', refresh);
  scene.scene.pause();
  const wiki = mobile ? 'MobileWiki' : 'DesktopWiki';
  scene.scene.launch(wiki, visit);
  scene.scene.bringToTop(wiki);
}

export async function returnFromCodex(scene: Phaser.Scene, visit: CodexVisit, status: (label: string) => void): Promise<void> {
  if (!visit.returnTo) { scene.scene.start('Start'); return; }
  if (eligibleRunSession.state.busy) return;
  const previousError = eligibleRunSession.state.error;
  status('CHECKING RUN…');
  await eligibleRunSession.resume();
  const state = eligibleRunSession.state;
  if (state.error) { status('RETRY RETURN'); return; }
  const mobile = scene.sys.settings.key === 'MobileWiki';
  const view = state.view;
  if (!view || state.accountId !== visit.accountId || view.id !== visit.runId
    || (visit.drafting && view.state.status !== 'drafting')) {
    scene.scene.stop(visit.returnTo);
    scene.scene.start(mobile ? 'MobileEligibleRun' : 'DesktopEligibleRun');
    return;
  }
  const caller = scene.scene.get(visit.returnTo);
  scene.scene.stop();
  selectRunMode('online');
  caller.scene.resume();
  const changed = view.revision !== visit.revision;
  if (changed || previousError !== state.error) caller.events.emit('codex:refresh', changed);
  else caller.events.removeAllListeners('codex:refresh');
}
