import { afterEach, describe, expect, it } from 'vitest';
import { DESIGN_SIZE, resetViewport, setViewport, slack, viewport } from '../../src/game/viewport';
import { ACTIVE_PROFILE } from '../../src/game/layoutProfile';
import { SCREEN } from '../../src/game/theme';

afterEach(() => resetViewport());

describe('viewport: the fill-the-window contract', () => {
  it('starts at the profile canvas, so anything reading it before the first frame sees the design size', () => {
    expect(viewport()).toEqual(ACTIVE_PROFILE.canvas);
    expect(DESIGN_SIZE).toEqual(ACTIVE_PROFILE.canvas);
    expect(slack()).toEqual({ width: 0, height: 0 });
  });

  it('never reports LESS room than the design canvas -- a layout that fits today can never start overflowing', () => {
    setViewport({ width: 320, height: 200 });
    expect(viewport()).toEqual(ACTIVE_PROFILE.canvas);
  });

  it('extends the axis with slack and floors to whole pixels', () => {
    setViewport({ width: DESIGN_SIZE.width + 306.7, height: DESIGN_SIZE.height });
    expect(viewport()).toEqual({ width: DESIGN_SIZE.width + 306, height: DESIGN_SIZE.height });
    expect(slack()).toEqual({ width: 306, height: 0 });
  });

  it('SCREEN.width/height are LIVE getters onto it -- this is what converts every layout call site at once', () => {
    setViewport({ width: DESIGN_SIZE.width + 306, height: DESIGN_SIZE.height + 12 });
    expect(SCREEN.width).toBe(DESIGN_SIZE.width + 306);
    expect(SCREEN.height).toBe(DESIGN_SIZE.height + 12);
    resetViewport();
    expect(SCREEN.width).toBe(DESIGN_SIZE.width);
    expect(SCREEN.height).toBe(DESIGN_SIZE.height);
  });

  it('safe-area insets stay CONSTANT -- they are a property of the device, not the window', () => {
    setViewport({ width: DESIGN_SIZE.width + 400, height: DESIGN_SIZE.height + 400 });
    expect(SCREEN.safeX).toBe(ACTIVE_PROFILE.safe.x);
    expect(SCREEN.safeTop).toBe(ACTIVE_PROFILE.safe.top);
    expect(SCREEN.safeBottom).toBe(ACTIVE_PROFILE.safe.bottom);
  });
});
