import { describe, expect, it } from 'vitest';
import { desktopRunMapPanelColumns } from '../../src/game/ui/desktopRunMapPanelLayout';

describe('desktop run-map panel columns', () => {
  it('releases the region width to the destination panel when the region rail is collapsed', () => {
    const expanded = desktopRunMapPanelColumns({ x: 24, width: 1392 }, 438, false);
    const collapsed = desktopRunMapPanelColumns({ x: 24, width: 1392 }, 438, true);

    expect(expanded.region.width).toBe(390);
    expect(expanded.planner.x).toBe(438);
    expect(collapsed.region.width).toBe(180);
    expect(collapsed.planner.x).toBe(220);
    expect(collapsed.planner.width).toBe(expanded.planner.width + 218);
  });
});
