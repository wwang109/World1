/**
 * Run screen template — THE single source of truth for where every Run Mode
 * screen's header/stats/badge/action controls live, on both platforms. Pure
 * module (no Phaser import, unit-tested in
 * `tests/game/runScreenTemplate.test.ts`) — same spec-driven idiom as
 * `cardTokenSpec.ts`/`fantasyCardTemplateSpec.ts`: when a region needs to
 * move or grow, adjust it HERE; scenes never hardcode a header/button
 * coordinate. `renderRunHud` (RunProgressStrip.ts) is the only renderer that
 * reads these rects.
 *
 * Regions:
 *   kicker  — "WORLD1 / RUN MODE" eyebrow line.
 *   title   — the screen name (RUN / PREP · FIGHT / EVENT / SHOP / DECK / BATTLE).
 *   stats   — the one always-on stat strip (DAY · WAVE · GOLD · LV · LIVES · BOSSES).
 *   badge   — the banked-PL "n PL TO SPEND" slot (own slot — no longer fights
 *             the stats row for the top-right corner).
 *   actions — the fixed button ROW, split into role slots (see below).
 *   content — the ONLY region a scene may lay out freely.
 *   footer  — mobile's bottom primary-action bar (thumb-reachable); zero-height
 *             (unused) on desktop, where all 4 roles sit in one header row.
 *
 * Action roles (`RunActionRole`) are assigned to a FIXED slot rect regardless
 * of which roles a given screen actually uses — an unused role's slot is
 * simply left empty, never reflowed into by its neighbors. `actionRegionOf`
 * records which region (`actions` or `footer`) each role's slot lives inside,
 * so the unit test can verify containment without hardcoding platform
 * differences into the assertion itself.
 */

import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';

export type RunScreenRegion = 'kicker' | 'title' | 'stats' | 'badge' | 'actions' | 'content' | 'footer';
export type RunActionRole = 'back' | 'secondary' | 'tertiary' | 'primary';
export type RunTemplatePlatform = 'desktop' | 'mobile';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RunScreenTemplate {
  platform: RunTemplatePlatform;
  canvas: { width: number; height: number };
  regions: Record<RunScreenRegion, Rect>;
  actionSlots: Record<RunActionRole, Rect>;
  /** Which region each action role's slot is a sub-rect of. */
  actionRegionOf: Record<RunActionRole, RunScreenRegion>;
  /**
   * Named sub-rects INSIDE `content` (so they legitimately overlap it, unlike
   * the mutually-exclusive `regions`). `choices` is the stop/fight selection
   * block: it must be in the SAME place on every visit. It used to be
   * positioned from the player's current depth on the trail, so the panels
   * slid across the screen as a run advanced and you had to re-find them each
   * time — exactly the "information moving around" the template exists to stop.
   */
  contentSlots: { choices: Rect };
}

/** Splits `region` into `count` equal-width slots left to right, `gap` apart. */
function splitRow(region: Rect, count: number, gap: number): Rect[] {
  const width = (region.width - gap * (count - 1)) / count;
  const slots: Rect[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ x: region.x + i * (width + gap), y: region.y, width, height: region.height });
  }
  return slots;
}

function buildDesktopTemplate(): RunScreenTemplate {
  const { width, height } = DESKTOP_PROFILE.canvas;
  const gx = DESKTOP_PROFILE.safe.x;
  const regions: Record<RunScreenRegion, Rect> = {
    kicker: { x: gx, y: 16, width: 260, height: 20 },
    title: { x: gx, y: 36, width: 460, height: 34 },
    stats: { x: width - gx - 640, y: 20, width: 640, height: 20 },
    badge: { x: width - gx - 200, y: 46, width: 200, height: 22 },
    actions: { x: width - gx - 460, y: 74, width: 460, height: 34 },
    content: { x: gx, y: 130, width: width - gx * 2, height: height - 130 - 24 },
    footer: { x: gx, y: height - 24, width: width - gx * 2, height: 0 },
  };
  const [back, secondary, tertiary, primary] = splitRow(regions.actions, 4, 12) as [Rect, Rect, Rect, Rect];
  // Centred at a FIXED x/y: three 92px panels + gaps + the two heading lines.
  const choicesW = 420;
  const choices: Rect = {
    x: Math.round(regions.content.x + (regions.content.width - choicesW) / 2),
    y: regions.content.y + 12,
    width: choicesW,
    height: 356,
  };
  return {
    platform: 'desktop',
    canvas: { width, height },
    regions,
    actionSlots: { back, secondary, tertiary, primary },
    actionRegionOf: { back: 'actions', secondary: 'actions', tertiary: 'actions', primary: 'actions' },
    contentSlots: { choices },
  };
}

function buildMobileTemplate(): RunScreenTemplate {
  const { width, height } = MOBILE_PROFILE.canvas;
  const sx = MOBILE_PROFILE.safe.x;
  const regions: Record<RunScreenRegion, Rect> = {
    kicker: { x: sx, y: 8, width: 180, height: 12 },
    title: { x: sx, y: 20, width: 220, height: 18 },
    stats: { x: sx, y: 40, width: width - sx * 2, height: 14 },
    badge: { x: sx, y: 56, width: width - sx * 2, height: 16 },
    actions: { x: sx, y: 74, width: width - sx * 2, height: 22 },
    content: { x: sx, y: 100, width: width - sx * 2, height: 892 - 100 - 10 - 54 },
    // Primary sits in the bottom footer, thumb-reachable — mobile's one
    // deliberate per-platform difference from desktop (see module doc).
    footer: { x: sx, y: height - sx - 44, width: width - sx * 2, height: 44 },
  };
  const [back, secondary, tertiary] = splitRow(regions.actions, 3, 8) as [Rect, Rect, Rect];
  // Mobile stacks the route board above the choices, so the block sits at a
  // fixed y below it — already stable horizontally, now declared not literal.
  const choicesW = 330;
  const choicesY = 438;
  const choices: Rect = {
    x: Math.round(regions.content.x + (regions.content.width - choicesW) / 2),
    y: choicesY,
    width: choicesW,
    height: regions.footer.y - 12 - choicesY,
  };
  return {
    platform: 'mobile',
    canvas: { width, height },
    regions,
    actionSlots: { back, secondary, tertiary, primary: { ...regions.footer } },
    actionRegionOf: { back: 'actions', secondary: 'actions', tertiary: 'actions', primary: 'footer' },
    contentSlots: { choices },
  };
}

const TEMPLATES: Record<RunTemplatePlatform, RunScreenTemplate> = {
  desktop: buildDesktopTemplate(),
  mobile: buildMobileTemplate(),
};

/** The fixed template for a platform — pure, cached, never mutated by callers. */
export function runScreenTemplate(platform: RunTemplatePlatform): RunScreenTemplate {
  return TEMPLATES[platform];
}
