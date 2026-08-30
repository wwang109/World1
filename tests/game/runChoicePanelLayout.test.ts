import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import { DESKTOP_PROFILE, MOBILE_PROFILE, type LayoutProfile } from '../../src/game/layoutProfile';
import { runChoicePanelLayout, runChoicePanelMinHeight } from '../../src/game/ui/RunChoicePanel';
import { runScreenTemplate } from '../../src/game/ui/runScreenTemplate';

/**
 * THE REWARD LINE IS LOAD-BEARING (2026-08-30).
 *
 * A run choice panel is three facts stacked in one box: what the option IS
 * (the title), what it GIVES (`REWARD · ...`), and what it COSTS (the footer).
 * The middle one is what the choice is FOR, and it is the one that used to
 * disappear.
 *
 * On `crossroads_shrine` the middle option — the PAID one, 2 gold — rendered
 * its reward line as the literal string "R…" on a phone while its two
 * siblings read "REWARD · CHOICE OF 3 CARDS" and "REWARD · +3 GOLD", and the
 * same desktop panel showed all three in full. The cause was an ordering
 * mistake, not a sizing one: the title was laid out FIRST with a loose
 * `max(font.name * 2, bounds.h * 0.42)` height allowance, and `detail` was
 * handed whatever vertical space happened to be left. A label long enough to
 * WRAP (44+ characters at mobile's column width — three exist in the catalog)
 * doubled the title's height, dropped the remainder below one line, and
 * `auditTextBlock` dutifully shrank-then-ellipsized the reward hint down to a
 * single character. It even warned about it on the console every time.
 *
 * `runChoicePanelLayout` now reserves from the BOTTOM UP, and these tests hold
 * that order — arithmetically, against the real profiles and the real event
 * catalog, in the same idiom as `runEventStoryLayout.test.ts`.
 */

const PROFILES: Array<[string, LayoutProfile]> = [
  ['mobile', MOBILE_PROFILE],
  ['desktop', DESKTOP_PROFILE],
];

/** Phaser's own line box, the same over-estimate `RunChoicePanel` uses. */
const lineH = (px: number): number => Math.ceil(px * 1.4);

/** The widest choice row each platform actually draws, taken from the screen
 * template rather than retyped: mobile's event rows span the content region
 * inset by 10 a side; desktop's are the run-event panel's inner column. */
function rowWidthFor(profile: LayoutProfile): number {
  return profile.id === 'mobile'
    ? profile.canvas.width - 20
    : runScreenTemplate('desktop').contentSlots.reward.panel.width - 64;
}

describe('runChoicePanelLayout: the reward line always gets a full line', () => {
  for (const [name, profile] of PROFILES) {
    const F = profile.font;
    const w = rowWidthFor(profile);

    it(`${name}: at the declared minimum height, a one-line title AND a one-line reward hint both fit`, () => {
      const h = runChoicePanelMinHeight(F);
      const layout = runChoicePanelLayout({ x: 0, y: 0, w, h }, F, true);
      // The title gets exactly one line — no more, and crucially no less.
      expect(layout.titleMaxH).toBeGreaterThanOrEqual(lineH(F.name));
      // And the reward line's own slot is a full line, measured the way the
      // renderer measures it: from the bottom of the title's budget down to
      // the floor the bottom row leaves.
      const detailSlot = layout.detailFloor - (layout.titleTop + layout.titleMaxH + 5);
      expect(detailSlot).toBeGreaterThanOrEqual(layout.detailH);
      expect(layout.detailH).toBe(lineH(F.small));
    });

    it(`${name}: a title that WRAPS cannot eat the reward line — the title's budget is capped, not the detail's`, () => {
      const h = runChoicePanelMinHeight(F);
      const layout = runChoicePanelLayout({ x: 0, y: 0, w, h }, F, true);
      // A two-line title is what broke this. It is now impossible for one to
      // be ACCEPTED at the minimum height: `titleMaxH` is under two lines, so
      // `auditTextBlock` shrinks the title instead of pushing `detail` down.
      expect(layout.titleMaxH).toBeLessThan(lineH(F.name) * 2);
    });

    it(`${name}: an UNDER-SIZED panel still reserves the reward line — the title is what pays`, () => {
      // The old shipped bug was h=84 against a ~99 stack. Even there, the
      // priority order must hold: title squeezed, reward line intact.
      const h = runChoicePanelMinHeight(F) - 20;
      const layout = runChoicePanelLayout({ x: 0, y: 0, w, h }, F, true);
      expect(layout.titleMaxH).toBeLessThan(lineH(F.name));
      expect(layout.detailH).toBe(lineH(F.small));
      expect(layout.titleMaxH).toBeGreaterThan(0);
    });

    it(`${name}: extra height goes to the TITLE, and the reward line's own slot never shrinks`, () => {
      const base = runChoicePanelLayout({ x: 0, y: 0, w, h: runChoicePanelMinHeight(F) }, F, true);
      const tall = runChoicePanelLayout({ x: 0, y: 0, w, h: runChoicePanelMinHeight(F) + 40 }, F, true);
      expect(tall.titleMaxH).toBeGreaterThan(base.titleMaxH);
      expect(tall.detailH).toBe(base.detailH);
    });

    it(`${name}: the title wraps to the WHOLE content column, not the column minus the SELECT affordance`, () => {
      // THE SECOND HALF OF THE FIX. SELECT used to sit in the top-right corner
      // beside the title and cost it `actionReserve` (62px of mobile's 300px
      // column) — which is what made three catalog labels wrap in the first
      // place. It shares the bottom row with the footer now, so the title owns
      // the full column and the FOOTER is the row that yields to it.
      const layout = runChoicePanelLayout({ x: 0, y: 0, w, h: runChoicePanelMinHeight(F) }, F, true);
      expect(layout.footerW).toBe(layout.contentW - layout.actionReserve);
      expect(layout.contentW).toBeGreaterThan(layout.footerW);
      // The footer strings this panel draws ("COST 2 GOLD" / "FREE") are short;
      // the column it keeps must stay comfortably wider than the affordance it
      // is sharing the row with.
      expect(layout.footerW).toBeGreaterThan(layout.actionReserve);
    });
  }
});

describe('runChoicePanelMinHeight: the bottom row exists whether or not there is a footer', () => {
  for (const [name, profile] of PROFILES) {
    it(`${name}: the minimum includes the shared footer/affordance row`, () => {
      const F = profile.font;
      const inset = Math.max(14, F.small + 6);
      // Spelled out rather than re-calling the function: this is the contract
      // the run map and run event scenes reserve their columns against.
      expect(runChoicePanelMinHeight(F)).toBe(
        inset * 2 + lineH(F.name) + 5 + lineH(F.small) + 7 + lineH(F.tiny),
      );
    });
  }
});

/**
 * THE THREE OFFENDERS, BY NAME. The bug was reported against specific event
 * choices, so the catalog is checked for the property that made them fail —
 * a label long enough to wrap — and the layout is checked to hold regardless.
 * `43 chars and under survive` was the measured boundary at mobile's OLD
 * (238px) title column; the fix is that the boundary no longer exists at the
 * catalog's lengths, because the column is the full 300px.
 */
describe('the event catalog: every choice label, on a panel sized by the contract', () => {
  const LONG = ['moon_rite', 'salvage_properly', 'walk_around'];

  it('those three labels are still the long ones (the fixture this test is about)', () => {
    const byId = new Map<string, string>();
    for (const event of Object.values(eventCatalog)) {
      for (const choice of event.choices) byId.set(choice.id, choice.label);
    }
    for (const id of LONG) {
      expect(byId.get(id), `choice "${id}" is gone from the catalog`).toBeDefined();
      expect(byId.get(id)!.length).toBeGreaterThan(43);
    }
  });

  for (const [name, profile] of PROFILES) {
    it(`${name}: every catalog choice row reserves its reward line`, () => {
      const F = profile.font;
      const h = runChoicePanelMinHeight(F);
      const layout = runChoicePanelLayout({ x: 0, y: 0, w: rowWidthFor(profile), h }, F, true);
      for (const event of Object.values(eventCatalog)) {
        for (const choice of event.choices) {
          // Geometry is per-panel, not per-label, which is precisely the
          // guarantee: no label, however long, can move these numbers.
          const detailSlot = layout.detailFloor - (layout.titleTop + layout.titleMaxH + 5);
          expect(detailSlot, `${event.id}/${choice.id}`).toBeGreaterThanOrEqual(lineH(F.small));
        }
      }
    });
  }
});
