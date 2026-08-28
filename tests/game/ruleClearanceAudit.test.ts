import { describe, expect, it } from 'vitest';
import { renderRunHud, renderRunStatsStrip, type RunProgressSnapshot } from '../../src/game/ui/RunProgressStrip';
import { runScreenLayout } from '../../src/game/ui/runScreenLayout';
import { resetViewport, setViewport } from '../../src/game/viewport';
import {
  bandBannerLayout,
  BAND_BANNER_METRICS,
  type BandBannerMode,
  type BandBannerViewModel,
} from '../../src/game/ui/bandBannerViewModel';
import {
  FANTASY_CARD_TEMPLATE_SPEC,
  fantasyTitleLayout,
  selectTitleRule,
  TITLE_LINE_HEIGHT_RATIO,
  TITLE_RULE_CLEARANCE_PX,
  type FantasyTemplateTextRuleKey,
} from '../../src/game/ui/fantasyCardTemplateSpec';
import { skillBook } from '../../src/data/skills';

/**
 * RULE CLEARANCE AUDIT — a hairline may never be drawn through the thing it is
 * supposed to sit beside, on EITHER layout profile.
 *
 * THE SHIPPED BUG THIS EXISTS TO CATCH (`2ca972a`, 2026-08-28).
 * `RunProgressStrip.renderRunHud` drew the shared run-header rule at a
 * hardcoded `content.y - 14`. On DESKTOP that lands at 116 against an action
 * row ending at 108 — 8px clear, which is where the number was authored. On
 * MOBILE the identical expression lands at 86, and the mobile action band is
 * 74..96 with its labels centred at 85: the rule was drawn 1px off the exact
 * centre of the DECK/BAG and RETIRE labels and read as strikethrough on EVERY
 * mobile run screen. It survived because nothing in the suite asserted where a
 * drawn line lands relative to what it has to clear — only that regions did
 * not overlap (`runScreenTemplate.test.ts`) and that labels fit inside their
 * own buttons (`controlLayoutAudit.test.ts` / `actionBarFit.test.ts`). Neither
 * of those can see a 1px rule at all.
 *
 * HOW IT CHECKS. The `renderRunHud` block below drives the REAL renderer
 * through a duck-typed fake scene — the same stance `actionBarFit.test.ts`
 * takes, and for the same reason: the arithmetic that decides where the rule
 * goes is Phaser-free, so the only thing a real canvas would add is exact
 * glyph metrics, which the crops in `scratchpad/audit/shots/` cover instead.
 * Text height is modelled as `fontSize * TEXT_LINE_BOX` with a deliberately
 * GENEROUS ratio (measured 1.11-1.15 at the sizes this HUD uses), so the
 * modelled text band is taller than the real one — the audit can therefore
 * only ever be stricter than the screen, never looser.
 *
 * `bandBannerLayout` and `fantasyTitleLayout` are already pure, so those two
 * blocks read the geometry directly.
 */

// ---------------------------------------------------------------------------
// Fake scene — exactly the surface `renderRunHud` / `renderRunStatsStrip`
// touch, recording every drawn rect and text in SCREEN coordinates.
// ---------------------------------------------------------------------------

/** Rendered line box / font size. See the module doc: intentionally high. */
const TEXT_LINE_BOX = 1.2;
/** Advance width per character / font size, for the bold body face. */
const TEXT_PX_PER_CHAR = 0.6;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DrawnRect extends Box {
  interactive: boolean;
}

interface DrawnText extends Box {
  content: string;
  fontSize: number;
}

interface Recording {
  rects: DrawnRect[];
  texts: DrawnText[];
}

/** Rules the HUD draws: a hairline is a wide, <=3px-tall filled rect. */
function rulesIn(rec: Recording): DrawnRect[] {
  return rec.rects.filter((r) => r.height <= 3 && r.width >= 30);
}

/** Tap targets a rule must stay out of — every interactive plate of button
 * size. (The full-screen scrim/veil rects a dialog draws are excluded by the
 * height band; nothing that tall is a control.) */
function tapBandsIn(rec: Recording): DrawnRect[] {
  return rec.rects.filter((r) => r.interactive && r.height >= 8 && r.height <= 120);
}

function overlapsHorizontally(a: Box, b: Box): boolean {
  return Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > 2;
}

/** A rule at `y` crosses `box` when it is strictly inside it and they share x. */
function crosses(y: number, rule: Box, box: Box): boolean {
  return overlapsHorizontally(rule, box) && y > box.top && y < box.top + box.height;
}

/** Everything a rule drawn at `y` (with `rule`'s x-span) would cut through. */
function offendersAt(y: number, rule: Box, rec: Recording): string[] {
  const out: string[] = [];
  for (const t of rec.texts) if (crosses(y, rule, t)) out.push(`text "${t.content}"`);
  for (const b of tapBandsIn(rec)) if (crosses(y, rule, b)) out.push(`tap band ${b.top}..${b.top + b.height}`);
  return out;
}

function makeText(x: number, y: number, content: string, style: { fontSize?: string | number }): Record<string, unknown> {
  const state = {
    x,
    y,
    content,
    fontSize: Number.parseFloat(String(style.fontSize ?? 12)),
    originX: 0,
    originY: 0,
    visible: true,
    destroyed: false,
  };
  const self: Record<string, unknown> = {
    type: 'Text',
    get x() { return state.x; },
    set x(v: number) { state.x = v; },
    get y() { return state.y; },
    set y(v: number) { state.y = v; },
    get text() { return state.content; },
    get width() { return state.content.length * state.fontSize * TEXT_PX_PER_CHAR; },
    get height() { return state.fontSize * TEXT_LINE_BOX; },
    style: { get fontSize() { return `${state.fontSize}px`; } },
    __state: state,
    setOrigin(ox = 0, oy?: number) { state.originX = ox; state.originY = oy ?? ox; return self; },
    setX(v: number) { state.x = v; return self; },
    setY(v: number) { state.y = v; return self; },
    setPosition(px: number, py: number) { state.x = px; state.y = py; return self; },
    setDepth() { return self; },
    setVisible(v: boolean) { state.visible = v; return self; },
    setFontSize(size: number) { state.fontSize = size; return self; },
    setText(v: string) { state.content = v; return self; },
    setLineSpacing() { return self; },
    setData() { return self; },
    setInteractive() { return self; },
    setScrollFactor() { return self; },
    on() { return self; },
    destroy() { state.destroyed = true; },
  };
  return self;
}

function makeRect(x: number, y: number, w: number, h: number): Record<string, unknown> {
  const state = { x, y, w, h, originX: 0, originY: 0, interactive: false, destroyed: false };
  const self: Record<string, unknown> = {
    type: 'Rectangle',
    get x() { return state.x; },
    set x(v: number) { state.x = v; },
    get y() { return state.y; },
    set y(v: number) { state.y = v; },
    get displayWidth() { return state.w; },
    get displayHeight() { return state.h; },
    __state: state,
    setOrigin(ox = 0, oy?: number) { state.originX = ox; state.originY = oy ?? ox; return self; },
    setStrokeStyle() { return self; },
    setFillStyle() { return self; },
    setDepth() { return self; },
    setInteractive() { state.interactive = true; return self; },
    setScrollFactor() { return self; },
    setData() { return self; },
    on() { return self; },
    destroy() { state.destroyed = true; },
  };
  return self;
}

function makeScene(): { scene: unknown; record: () => Recording } {
  const objects: Array<Record<string, unknown>> = [];
  const scene = {
    add: {
      text(x: number, y: number, content: string, style: { fontSize?: string | number } = {}) {
        const t = makeText(x, y, content, style);
        objects.push(t);
        return t;
      },
      rectangle(x: number, y: number, w: number, h: number) {
        const r = makeRect(x, y, w, h);
        objects.push(r);
        return r;
      },
      container() {
        const c: Record<string, unknown> = { add() { return c; }, setMask() { return c; }, setY() { return c; }, setDepth() { return c; } };
        return c;
      },
    },
    tweens: {
      killTweensOf() { /* no motion in a geometry audit */ },
      add() { return {}; },
      addCounter() { return {}; },
    },
    input: { on() { /* no pointer wiring */ } },
  };
  const record = (): Recording => {
    const rects: DrawnRect[] = [];
    const texts: DrawnText[] = [];
    for (const o of objects) {
      const s = o.__state as { destroyed: boolean; visible?: boolean; x: number; y: number; originX: number; originY: number; w?: number; h?: number; interactive?: boolean; content?: string; fontSize?: number };
      if (s.destroyed) continue;
      if (o.type === 'Rectangle') {
        const w = s.w ?? 0;
        const h = s.h ?? 0;
        rects.push({ left: s.x - s.originX * w, top: s.y - s.originY * h, width: w, height: h, interactive: s.interactive === true });
      } else {
        if (s.visible === false) continue;
        const content = s.content ?? '';
        if (!content.trim()) continue;
        const w = (o.width as number);
        const h = (o.height as number);
        texts.push({ left: s.x - s.originX * w, top: s.y - s.originY * h, width: w, height: h, content, fontSize: s.fontSize ?? 0 });
      }
    }
    return { rects, texts };
  };
  return { scene, record };
}

const SNAPSHOT: RunProgressSnapshot = {
  day: 12, wave: 7, gold: 148, heroLevel: 5, lives: 3, bossesCleared: 1, wins: 9, losses: 2,
};

/** Every action role a run screen can populate — the WORST case for the rule,
 * since an empty slot draws no plate and no label to be crossed. */
function allActions(): NonNullable<Parameters<typeof renderRunHud>[1]['actions']> {
  return {
    back: { label: '‹ MAP', onPress: () => {} },
    secondary: { label: 'DECK / BAG', onPress: () => {} },
    tertiary: { label: 'RETIRE', onPress: () => {}, danger: true },
    primary: { label: 'CONTINUE ›', onPress: () => {} },
  };
}

/** Design canvases plus the grown viewports `runScreenLayout` has to project
 * onto — same shapes `runScreenLayout.test.ts` already pins. */
const VIEWS: Record<'mobile' | 'desktop', Array<{ width: number; height: number }>> = {
  mobile: [
    { width: 412, height: 892 },
    { width: 412, height: 1080 },
    { width: 640, height: 892 },
  ],
  desktop: [
    { width: 1440, height: 900 },
    { width: 1746, height: 900 },
    { width: 1440, height: 1200 },
  ],
};

describe('rule clearance: the shared run HUD header rule', () => {
  for (const platform of ['mobile', 'desktop'] as const) {
    for (const view of VIEWS[platform]) {
      const label = `${platform} @ ${view.width}x${view.height}`;

      const render = (): Recording => {
        setViewport(view);
        const { scene, record } = makeScene();
        renderRunHud(scene as never, {
          screen: 'RUN',
          snapshot: SNAPSHOT,
          compact: platform === 'mobile',
          actions: allActions(),
          ...(platform === 'mobile' ? { onOpenStatsOverlay: () => {} } : {}),
        });
        const rec = record();
        resetViewport();
        return rec;
      };

      it(`${label}: draws exactly one header rule`, () => {
        expect(rulesIn(render())).toHaveLength(1);
      });

      it(`${label}: the header rule cuts through nothing`, () => {
        const rec = render();
        const rule = rulesIn(rec)[0]!;
        const y = rule.top + rule.height / 2;
        expect(offendersAt(y, rule, rec)).toEqual([]);
      });

      it(`${label}: the header rule clears the action band it sits under`, () => {
        setViewport(view);
        const t = runScreenLayout(platform);
        const actionsBottom = t.regions.actions.y + t.regions.actions.height;
        const badgeBottom = t.regions.badge.y + t.regions.badge.height;
        resetViewport();
        const rule = rulesIn(render())[0]!;
        // Below both header bands, and never past the content top — a rule
        // that dropped INTO `content` would cross whatever the scene draws.
        expect(rule.top).toBeGreaterThanOrEqual(Math.max(actionsBottom, badgeBottom) + 2);
        setViewport(view);
        expect(rule.top).toBeLessThanOrEqual(runScreenLayout(platform).regions.content.y);
        resetViewport();
      });
    }
  }

  /**
   * THE TEETH. Same recording, same predicate, but asked about the y the old
   * code computed. If this test ever goes green in both directions the audit
   * above has stopped being able to see the defect it was written for.
   */
  it('REJECTS the pre-2ca972a formula (content.y - 14) on mobile, and shows why desktop hid it', () => {
    for (const platform of ['mobile', 'desktop'] as const) {
      setViewport({ width: platform === 'mobile' ? 412 : 1440, height: platform === 'mobile' ? 892 : 900 });
      const t = runScreenLayout(platform);
      const legacyY = t.regions.content.y - 14;
      const { scene, record } = makeScene();
      renderRunHud(scene as never, {
        screen: 'RUN', snapshot: SNAPSHOT, compact: platform === 'mobile', actions: allActions(),
      });
      const rec = record();
      const rule = rulesIn(rec)[0]!;
      const offenders = offendersAt(legacyY, rule, rec);
      resetViewport();

      if (platform === 'mobile') {
        // 86 lands inside the 74..96 action band, through both labels.
        expect(legacyY).toBe(86);
        expect(offenders).not.toEqual([]);
        expect(offenders.some((o) => o.includes('DECK / BAG'))).toBe(true);
        expect(offenders.some((o) => o.includes('RETIRE'))).toBe(true);
        expect(offenders.some((o) => o.startsWith('tap band'))).toBe(true);
      } else {
        // The same expression was harmless here, which is exactly why the
        // constant was believed correct: 116 against a row ending at 108.
        expect(legacyY).toBe(116);
        expect(offenders).toEqual([]);
      }
    }
  });
});

describe("rule clearance: battle's statsOnly chrome rule", () => {
  for (const platform of ['mobile', 'desktop'] as const) {
    for (const view of VIEWS[platform]) {
      it(`${platform} @ ${view.width}x${view.height}: the stats-strip rule cuts through nothing`, () => {
        setViewport(view);
        const { scene, record } = makeScene();
        renderRunStatsStrip(scene as never, { snapshot: SNAPSHOT, compact: platform === 'mobile' });
        const rec = record();
        const content = runScreenLayout(platform, 'statsOnly').regions.content;
        resetViewport();
        const rules = rulesIn(rec);
        expect(rules).toHaveLength(1);
        const rule = rules[0]!;
        expect(offendersAt(rule.top + rule.height / 2, rule, rec)).toEqual([]);
        expect(rule.top).toBeLessThanOrEqual(content.y);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The band banner's own hairlines (`bandBannerLayout` — pure).
// ---------------------------------------------------------------------------

function bandVm(resolvedBoss: boolean): BandBannerViewModel {
  return {
    name: 'THE THORNWOOD MARCHES',
    waveRange: 'WAVES 6-10',
    leanChip: 'FIRE',
    leanType: 'fire',
    boss: {
      resolved: resolvedBoss,
      headline: resolvedBoss ? 'THE BRAMBLE MATRIARCH' : 'ONE OF THESE:',
      sub: resolvedBoss ? 'LV 14 · BOSS' : '',
      entries: resolvedBoss ? [] : ['THE BRAMBLE MATRIARCH', 'THE ROTBOUND HERALD'],
    },
    bossClaim: { subject: 'THIS BOSS', kind: 'definite', types: ['fire'], lines: ['FIRE HITS THIS BOSS +50%'] },
    mobsClaim: { subject: 'THESE MOBS', kind: 'none', types: [], lines: ['NOTHING COUNTERS THESE MOBS'] },
    card: ['THE THORNWOOD MARCHES', 'WAVES 6-10'],
  };
}

describe('rule clearance: the band banner hairlines', () => {
  for (const mode of ['mobile', 'desktop'] as BandBannerMode[]) {
  for (const resolvedBoss of [true, false]) {
    it(`${mode} (boss ${resolvedBoss ? 'resolved' : 'shortlist'}): no 'rule' row crosses a text row or the READ button`, () => {
      const layout = bandBannerLayout(bandVm(resolvedBoss), mode);
      const m = BAND_BANNER_METRICS[mode];
      const rules = layout.rows.filter((r) => r.style === 'rule');
      // Two hairlines by construction (above BOSS, above MOBS) — if that
      // changes, the loop below still covers whatever is there, but a banner
      // that silently stopped drawing them is worth failing on.
      expect(rules.length).toBeGreaterThanOrEqual(2);
      for (const rule of rules) {
        const y = rule.y + rule.height / 2;
        for (const row of layout.rows) {
          if (row === rule) continue;
          if (row.style === 'rule') continue;
          // A text row's rendered box, and the button's own plate.
          const boxH = row.style === 'button' ? row.height : row.height * TEXT_LINE_BOX;
          expect(
            y > row.y && y < row.y + boxH,
            `${mode}: hairline at ${y} crosses ${row.style} "${row.text}" (${row.y}..${row.y + boxH})`,
          ).toBe(false);
        }
      }
      // Both hairlines stay inside the banner the caller reserved.
      for (const rule of rules) {
        expect(rule.y).toBeGreaterThan(m.pad - 1);
        expect(rule.y + rule.height).toBeLessThan(layout.height);
      }
    });
  }
  }
});

// ---------------------------------------------------------------------------
// The card template's title vs its own divider (`fantasyTitleLayout` — pure).
// ---------------------------------------------------------------------------

/** The card scales `src/game` actually instantiates the 420x690 template at:
 * 140 (cardDetailOverlay / MobileDeckBuild bag detail / MobileDraft detail),
 * 150 (MobileWiki + MobileShop detail), 187 (DesktopWiki gallery at 1440),
 * 200 (DesktopShop dock), 220 (DesktopWiki detail), 260 (UiKit), 420 (base).
 * Swept CONTINUOUSLY rather than listed so a new call site at any width is
 * covered without this list having to be maintained. */
const CARD_SCALES = Array.from({ length: 71 }, (_, i) => 0.30 + i * 0.01);

describe('rule clearance: the fantasy card title vs its divider', () => {
  const { titleBox, divider } = FANTASY_CARD_TEMPLATE_SPEC.regions;
  const RULES: FantasyTemplateTextRuleKey[] = ['title-short', 'title-medium', 'title-long'];

  for (const ruleKey of RULES) {
    it(`${ruleKey}: the title block clears the divider at every card scale`, () => {
      for (const s of CARD_SCALES) {
        const l = fantasyTitleLayout(ruleKey, s);
        const blockH = l.maxLines * l.lineHeight + (l.maxLines - 1) * l.lineSpacing;
        const room = (divider.y - titleBox.y) * s;
        // The one exception the helper documents: a single line always
        // renders, even on a card too small to hold it comfortably — that is
        // the case that has always shipped, and it is not a strikethrough.
        if (l.maxLines === 1) continue;
        expect(
          blockH <= room - TITLE_RULE_CLEARANCE_PX,
          `${ruleKey} @ scale ${s.toFixed(2)}: ${l.maxLines} lines = ${blockH.toFixed(1)}px into ${room.toFixed(1)}px of room`,
        ).toBe(true);
      }
    });
  }

  it('is a NO-OP at the authored card size — the full-size ladder is untouched', () => {
    for (const ruleKey of RULES) {
      const rule = FANTASY_CARD_TEMPLATE_SPEC.textRules[ruleKey];
      const l = fantasyTitleLayout(ruleKey, 1);
      expect(l.fontSize, ruleKey).toBe(rule.fontSize);
      expect(l.maxLines, ruleKey).toBe(rule.maxLines);
      expect(l.lineSpacing, ruleKey).toBe(rule.lineSpacing);
    }
  });

  /**
   * THE TEETH, again. The pre-fix renderer used the text rule's own
   * `maxLines` with a font size floored at 13px; below cardScale ~0.65 that
   * put a second `title-long` line straight through the divider (measured
   * 11.3px past it at 0.333, 0.8px at 0.524 — see `fantasyTitleLayout`'s doc
   * comment). This asserts the audit above can still see that.
   */
  it('REJECTS the pre-fix line budget (the text rule cap, unbounded by the divider)', () => {
    const offenders: string[] = [];
    for (const s of CARD_SCALES) {
      const rule = FANTASY_CARD_TEMPLATE_SPEC.textRules['title-long'];
      const l = fantasyTitleLayout('title-long', s);
      const legacyLines = rule.maxLines;
      const blockH = legacyLines * l.lineHeight + (legacyLines - 1) * l.lineSpacing;
      const room = (divider.y - titleBox.y) * s;
      if (blockH > room) offenders.push(s.toFixed(2));
    }
    // Every scale below ~0.62 — i.e. every card the mobile detail overlays and
    // the desktop wiki/shop panels draw.
    expect(offenders.length).toBeGreaterThan(20);
    expect(offenders).toContain('0.33');
    expect(offenders).toContain('0.52');
  });

  it('no card in the book needs a line the divider cannot hold, at any live scale', () => {
    for (const skill of Object.values(skillBook)) {
      const ruleKey = selectTitleRule(skill.name);
      for (const s of CARD_SCALES) {
        const l = fantasyTitleLayout(ruleKey, s);
        const blockH = l.maxLines * l.lineHeight + (l.maxLines - 1) * l.lineSpacing;
        const room = (divider.y - titleBox.y) * s;
        if (l.maxLines === 1) continue;
        expect(blockH <= room - TITLE_RULE_CLEARANCE_PX, `${skill.name} @ ${s.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('models the line box no smaller than the real one — the audit may only be strict', () => {
    // Measured in Chromium for the display face: 13px -> 15, 20px -> 25,
    // 22px -> 25, 24px -> 27. The ratio used must be >= all of those or the
    // check above could pass a case the screen fails.
    for (const [px, measured] of [[13, 15], [20, 25], [22, 25], [24, 27]] as const) {
      expect(px * TITLE_LINE_HEIGHT_RATIO).toBeGreaterThanOrEqual(measured);
    }
  });
});
