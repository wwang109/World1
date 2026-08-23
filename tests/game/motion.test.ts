import { describe, expect, it } from 'vitest';
import { MOTION, lerpColor, pressedFill } from '../../src/game/ui/motion';
import { UI } from '../../src/game/theme';

/**
 * UI MOTION — the token drift-lock and the colour maths.
 *
 * `src/game/ui/motion.ts` is importable here at all because it takes NO runtime
 * Phaser dependency (its Phaser import is `import type`, erased at compile time)
 * — so the two things in it that carry real decisions, the token table and the
 * channel blend, are unit-testable without standing up a game.
 *
 * What is NOT tested here: the tween wiring itself (`attachButtonFeel`,
 * `appearPanel`, `flashConfirm`), which needs a live Phaser scene and belongs to
 * the visual verification pass in docs/ui-workbook.md.
 */

describe('motion tokens', () => {
  // A DRIFT LOCK, the same stance `PRICE` takes on the balance side: changing
  // interaction feel must be a deliberate edit here, not a number that quietly
  // moved. If this fails, confirm the new feel was intended and update it.
  it('every token matches its locked value', () => {
    expect(MOTION).toEqual({
      hoverIn: 90,
      hoverOut: 140,
      press: 45,
      release: 120,
      panelIn: 200,
      selectPulse: 260,
      hoverLift: 2,
      pressSink: 1,
      panelRise: 12,
      panelAlphaFrom: 0,
      easeHover: 'Sine.easeOut',
      easePanel: 'Quad.easeOut',
      easePulse: 'Sine.easeInOut',
    });
  });

  it('the asymmetry that makes it feel responsive is intact', () => {
    // Arrival faster than decay: the control answers the cursor immediately and
    // relaxes afterwards. Reversing these is what makes UI feel laggy.
    expect(MOTION.hoverIn).toBeLessThan(MOTION.hoverOut);
    // The press is the fastest thing in the table — a ramp there reads as input
    // latency — and the release back out is slower, so the control settles.
    expect(MOTION.press).toBeLessThan(MOTION.hoverIn);
    expect(MOTION.press).toBeLessThan(MOTION.release);
    // Nothing interactive may cross the ~250ms mark where motion starts being
    // perceived as waiting rather than as smoothness. The panel arrival is the
    // only token allowed near it, and it is not blocking a click.
    for (const key of ['hoverIn', 'hoverOut', 'press', 'release'] as const) {
      expect(MOTION[key], key).toBeLessThan(250);
    }
    expect(MOTION.panelIn).toBeLessThanOrEqual(250);
  });

  it('the offsets stay subtle — a lift you notice is a lift that is too big', () => {
    expect(MOTION.hoverLift).toBeLessThanOrEqual(3);
    expect(MOTION.pressSink).toBeLessThanOrEqual(MOTION.hoverLift);
    // A panel travels further than a button does, by design.
    expect(MOTION.panelRise).toBeGreaterThan(MOTION.hoverLift);
  });
});

describe('lerpColor', () => {
  it('returns the endpoints exactly at t=0 and t=1', () => {
    expect(lerpColor(0x102030, 0xa0b0c0, 0)).toBe(0x102030);
    expect(lerpColor(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0);
  });

  it('blends PER CHANNEL, not as one packed number', () => {
    // THE BUG THIS EXISTS TO CATCH: interpolating the packed integer linearly
    // walks through colours neither endpoint contains. Halfway from pure red to
    // pure blue must be a dark purple with both channels at half — NOT the
    // numeric midpoint of 0xff0000 and 0x0000ff (0x7f8080, a grey-blue).
    expect(lerpColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
    expect(lerpColor(0xff0000, 0x0000ff, 0.5)).not.toBe(Math.round((0xff0000 + 0x0000ff) / 2));
  });

  it('clamps t outside 0..1 instead of extrapolating past a valid colour', () => {
    // An overshooting ease (or a tween that reports >1) must never produce a
    // channel above 0xff, which would corrupt the packed value.
    expect(lerpColor(0x102030, 0xa0b0c0, -3)).toBe(0x102030);
    expect(lerpColor(0x102030, 0xa0b0c0, 42)).toBe(0xa0b0c0);
  });

  it('never emits a channel outside 0..255 across the whole sweep', () => {
    for (const [a, b] of [[0x000000, 0xffffff], [UI.chip, UI.chipDark], [UI.panelAlt, UI.slotHover]] as const) {
      for (let i = 0; i <= 20; i += 1) {
        const c = lerpColor(a, b, i / 20);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
        for (const shift of [16, 8, 0]) {
          const ch = (c >> shift) & 0xff;
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe('pressedFill', () => {
  it('darkens, never lightens, every fill in the shipped palette', () => {
    // The press state has to read as "down" against every fill the theme uses —
    // a bright bronze chip, a near-black panel, a muted red. Derived rather than
    // authored per call site precisely so this property holds everywhere.
    const lum = (c: number): number => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);
    for (const fill of [UI.chip, UI.chipDark, UI.panelAlt, UI.slotHover, UI.badSoft, UI.panelMuted]) {
      const pressed = pressedFill(fill);
      expect(lum(pressed), `pressed fill of ${fill.toString(16)} must be darker`).toBeLessThanOrEqual(lum(fill));
    }
  });

  it('is a visible change on a bright fill and still lands in range on black', () => {
    // Visible: the bronze chip is the brightest thing a player presses, so if the
    // darken is perceptible there it is perceptible everywhere.
    expect(pressedFill(UI.chip)).not.toBe(UI.chip);
    // Degenerate input stays valid rather than going negative.
    expect(pressedFill(0x000000)).toBe(0x000000);
  });
});
