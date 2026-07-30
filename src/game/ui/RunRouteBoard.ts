import Phaser from 'phaser';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';
import { type RunState } from '../runStore';
import { FONT, UI } from '../theme';

export interface RunRouteColumnSnapshot {
  depth: number;
  wave: number;
  nodeCount: number;
  state: 'cleared' | 'current' | 'future';
}

export interface RunRouteSnapshot {
  columns: readonly RunRouteColumnSnapshot[];
  currentDepth: number;
  nextDepth: number;
}

function trackObject(track: Phaser.GameObjects.GameObject[] | undefined, object: Phaser.GameObjects.GameObject): void {
  track?.push(object);
}

export function snapshotRunRoute(run: Readonly<RunState>): RunRouteSnapshot {
  const actionableDepth = run.depth + 1;
  const columns = run.map.depths.slice(1).map((nodes, index) => {
    const depth = index + 1;
    return {
      depth,
      wave: nodes[0]?.wave ?? 1,
      nodeCount: nodes.length,
      state: depth < actionableDepth ? 'cleared' : depth === actionableDepth ? 'current' : 'future',
    } satisfies RunRouteColumnSnapshot;
  });

  return {
    columns,
    currentDepth: run.depth,
    nextDepth: run.depth + 1,
  };
}

export function renderRunRouteBoard(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; w: number; h: number },
  route: RunRouteSnapshot,
  opts: { mode: 'desktop' | 'mobile'; track?: Phaser.GameObjects.GameObject[] },
): void {
  const profile = opts.mode === 'desktop' ? DESKTOP_PROFILE : MOBILE_PROFILE;
  const columns = route.columns;
  if (columns.length === 0) return;

  const horizontal = opts.mode === 'desktop';
  const primaryStart = horizontal ? bounds.x : bounds.y;
  const primarySize = horizontal ? bounds.w : bounds.h;
  const crossStart = horizontal ? bounds.y : bounds.x;
  const crossSize = horizontal ? bounds.h : bounds.w;
  const inset = profile.gap;
  const usablePrimary = Math.max(0, primarySize - inset * 2);
  const cellSize = usablePrimary / columns.length;
  const centerPrimary = (index: number): number => primaryStart + inset + cellSize * (index + 0.5);
  const routeCross = crossStart + Math.max(profile.font.label + profile.gap * 2, crossSize * 0.58);
  const place = (primary: number, cross: number): { x: number; y: number } => horizontal
    ? { x: primary, y: cross }
    : { x: cross, y: primary };

  let waveStart = 0;
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]!;
    const nextWave = columns[index + 1]?.wave;
    if (nextWave === column.wave) continue;

    const bandStart = primaryStart + inset + cellSize * waveStart;
    const bandSize = cellSize * (index - waveStart + 1);
    const band = horizontal
      ? scene.add.rectangle(bandStart, bounds.y, bandSize, bounds.h, column.wave % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.2).setOrigin(0, 0)
      : scene.add.rectangle(bounds.x, bandStart, bounds.w, bandSize, column.wave % 2 === 0 ? UI.panelMuted : UI.panelAlt, 0.2).setOrigin(0, 0);
    const waveLabelPos = place(bandStart + bandSize / 2, crossStart + profile.gap);
    const waveLabel = scene.add.text(waveLabelPos.x, waveLabelPos.y, horizontal ? `WAVE ${column.wave}` : `— WAVE ${column.wave} —`, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${profile.font.tiny}px`,
      color: UI.textSoft,
    }).setOrigin(horizontal ? 0.5 : 0, 0);
    trackObject(opts.track, band);
    trackObject(opts.track, waveLabel);
    waveStart = index + 1;
  }

  const routeStart = place(centerPrimary(0), routeCross);
  const routeEnd = place(centerPrimary(columns.length - 1), routeCross);
  const routeLine = horizontal
    ? scene.add.rectangle(routeStart.x, routeCross, routeEnd.x - routeStart.x, 1, UI.border, 0.42).setOrigin(0, 0.5)
    : scene.add.rectangle(routeCross, routeStart.y, 1, routeEnd.y - routeStart.y, UI.border, 0.42).setOrigin(0.5, 0);
  trackObject(opts.track, routeLine);

  columns.forEach((column, index) => {
    const primary = centerPrimary(index);
    const point = place(primary, routeCross);
    const labelPos = place(primary, routeCross - (horizontal ? profile.font.label + profile.gap : crossSize * 0.34));
    const depthLabel = scene.add.text(labelPos.x, labelPos.y, `D${column.depth}`, {
      fontFamily: FONT.body,
      fontStyle: 'bold',
      fontSize: `${profile.font.tiny}px`,
      color: UI.textDim,
    }).setOrigin(horizontal ? 0.5 : 0, horizontal ? 1 : 0.5);
    trackObject(opts.track, depthLabel);

    if (column.state === 'cleared') {
      const pip = scene.add.circle(point.x, point.y, horizontal ? 5 : 4, UI.chip, 0.62);
      trackObject(opts.track, pip);
      return;
    }
    if (column.state === 'current') {
      const ring = scene.add.circle(point.x, point.y, horizontal ? 7 : 6, 0, 0).setStrokeStyle(2, UI.chip, 1);
      const pip = scene.add.circle(point.x, point.y, horizontal ? 3 : 2, UI.chip, 1);
      trackObject(opts.track, ring);
      trackObject(opts.track, pip);
      return;
    }

    const previewGap = horizontal ? 16 : 12;
    for (let previewIndex = 0; previewIndex < column.nodeCount; previewIndex++) {
      const offset = (previewIndex - (column.nodeCount - 1) / 2) * previewGap;
      const preview = horizontal
        ? scene.add.rectangle(point.x, point.y + offset, 14, 10, UI.panelMuted, 0.38).setStrokeStyle(1, UI.border, 0.22)
        : scene.add.rectangle(point.x + offset, point.y, 8, 8, UI.panelMuted, 0.38).setStrokeStyle(1, UI.border, 0.22);
      trackObject(opts.track, preview);
    }
  });
}
