import Phaser from 'phaser';
import { ACTIVE_PROFILE } from '../layoutProfile';
import { WAVE_COUNT, type RunState } from '../runStore';
import { FONT, SCREEN, UI } from '../theme';

export interface RunProgressSnapshot {
  currentWave: number;
  waveCount: number;
  currentDepth: number;
  totalDepth: number;
  gold: number;
  heroLevel: number;
  wins: number;
  losses: number;
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

/** Builds display-only progress data without adding a separate persisted day. */
export function snapshotRunProgress(run: Readonly<RunState>): RunProgressSnapshot {
  const currentColumn = run.map.depths[run.depth];
  const nextColumn = run.map.depths[run.depth + 1];
  const currentWave = nextColumn?.[0]?.wave ?? currentColumn?.[0]?.wave ?? 1;

  return {
    currentWave,
    waveCount: WAVE_COUNT,
    currentDepth: run.depth,
    totalDepth: run.map.depths.length - 1,
    gold: run.gold,
    heroLevel: run.heroLevel,
    wins: run.wins,
    losses: run.losses,
  };
}

export function renderRunProgressStrip(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number },
  snapshot: RunProgressSnapshot,
  opts: { compact?: boolean; track?: Phaser.GameObjects.GameObject[] } = {},
): void {
  const compact = opts.compact ?? false;
  const font = ACTIVE_PROFILE.font;
  const width = Math.min(bounds.w, SCREEN.width);
  const labelSize = compact ? font.small : font.label;
  const markerY = bounds.y + (compact ? font.small + 13 : font.label + 18);
  const dayCopy = compact
    ? `D${snapshot.currentWave}/${snapshot.waveCount}`
    : `DAY ${snapshot.currentWave} / ${snapshot.waveCount}`;
  const waveCopy = compact
    ? `W${snapshot.currentWave}/${snapshot.waveCount}`
    : `WAVE ${snapshot.currentWave} / ${snapshot.waveCount}`;

  const day = scene.add.text(bounds.x, bounds.y, dayCopy, {
    fontFamily: FONT.body,
    fontStyle: 'bold',
    fontSize: `${labelSize}px`,
    color: UI.textAccent,
  });
  const wave = scene.add.text(bounds.x + width, bounds.y, waveCopy, {
    fontFamily: FONT.body,
    fontStyle: 'bold',
    fontSize: `${labelSize}px`,
    color: UI.textDim,
  }).setOrigin(1, 0);
  const line = scene.add.rectangle(bounds.x, markerY, width, 1, UI.border, 0.42).setOrigin(0, 0.5);
  trackObject(opts.track, day);
  trackObject(opts.track, wave);
  trackObject(opts.track, line);

  const markerInset = compact ? 8 : 12;
  const markerSpan = Math.max(0, width - markerInset * 2);
  for (let waveIndex = 1; waveIndex <= WAVE_COUNT; waveIndex++) {
    const x = bounds.x + markerInset + markerSpan * ((waveIndex - 1) / (WAVE_COUNT - 1));
    if (waveIndex < snapshot.currentWave) {
      const marker = scene.add.circle(x, markerY, compact ? 3 : 4, UI.chip, 0.68);
      trackObject(opts.track, marker);
      continue;
    }
    if (waveIndex === snapshot.currentWave) {
      const ring = scene.add.circle(x, markerY, compact ? 5 : 6, 0, 0).setStrokeStyle(2, UI.chip, 1);
      const marker = scene.add.circle(x, markerY, compact ? 2 : 3, UI.chip, 1);
      trackObject(opts.track, ring);
      trackObject(opts.track, marker);
      continue;
    }
    const marker = scene.add.circle(x, markerY, compact ? 3 : 4, UI.panelMuted, 0.92).setStrokeStyle(1, UI.border, 0.42);
    trackObject(opts.track, marker);
  }
}
