import { describe, expect, it } from 'vitest';
import {
  buildStatAllocationRows,
  runStatPanelLayout,
} from '../../src/game/ui/RunStatPanel';

describe('runStatPanelLayout', () => {
  it('anchors the desktop allocation panel as a right-side drawer', () => {
    const layout = runStatPanelLayout({ width: 1440, height: 900 }, false);

    expect(layout.panel).toEqual({ x: 846, y: 146, width: 576, height: 730 });
    expect(layout.columns).toBe(1);
    expect(layout.rowHeight).toBe(66);
    expect(layout.rowGap).toBe(8);
  });

  it('keeps the mobile allocation overlay inside the safe viewport', () => {
    const layout = runStatPanelLayout({ width: 412, height: 892 }, true);

    expect(layout.panel.x).toBe(12);
    expect(layout.panel.width).toBe(388);
    expect(layout.panel.y).toBeGreaterThanOrEqual(16);
    expect(layout.panel.y + layout.panel.height).toBeLessThanOrEqual(876);
    expect(layout.columns).toBe(1);
    expect(layout.rowHeight).toBeGreaterThanOrEqual(48);
  });
});

describe('buildStatAllocationRows', () => {
  it('shows committed-to-preview values and preserves hero gem contributions', () => {
    const rows = buildStatAllocationRows(
      { maxHp: 1, attack: 1 },
      { maxHp: 2, attack: 1, speed: 1 },
      { speed: 4 },
    );

    expect(rows.map(({ stat, current, preview, pending, gemAdd }) => ({
      stat, current, preview, pending, gemAdd,
    }))).toEqual([
      { stat: 'maxHp', current: 105, preview: 110, pending: true, gemAdd: 0 },
      { stat: 'attack', current: 2, preview: 2, pending: false, gemAdd: 0 },
      { stat: 'magicPower', current: 1, preview: 1, pending: false, gemAdd: 0 },
      { stat: 'armor', current: 1, preview: 1, pending: false, gemAdd: 0 },
      { stat: 'magicResist', current: 1, preview: 1, pending: false, gemAdd: 0 },
      { stat: 'speed', current: 14, preview: 15, pending: true, gemAdd: 4 },
    ]);
  });
});
