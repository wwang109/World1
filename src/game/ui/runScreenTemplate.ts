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
 *   title   — the screen name (RUN / PREP · FIGHT / EVENT / SHOP / DECK /
 *             BATTLE (stats-only chrome — no badge/actions)).
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
 *
 * Chrome variants (`RunTemplateChrome`): `'full'` (default) is every non-
 * battle Run Mode screen — kicker/title/stats/badge/actions/content/footer as
 * described above. `'statsOnly'` is the BATTLE scenes' chrome (2026-08-04
 * decision, docs/design-locked.md): the IDENTICAL kicker/title/stats rects
 * (so the stat string can never diverge from other screens) but NO badge and
 * NO action-role band — battle is a playback screen with no decisions, so it
 * draws its own bottom controls (REPLAY/speed/SUMMARY/CONTINUE) instead of
 * the template's action roles. `badge`/`actions` collapse to zero-area rects
 * (present only so every region key stays populated) and `content` starts
 * right below `stats` instead of below the (now-absent) actions row.
 */

import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../layoutProfile';

export type RunScreenRegion = 'kicker' | 'title' | 'stats' | 'badge' | 'actions' | 'content' | 'footer';
export type RunActionRole = 'back' | 'secondary' | 'tertiary' | 'primary';
export type RunTemplatePlatform = 'desktop' | 'mobile';
/** `'full'` — every non-battle screen (kicker/title/stats/badge/actions).
 * `'statsOnly'` — battle's chrome: kicker/title/stats only, no badge/action
 * roles, a higher content top (see module doc). */
export type RunTemplateChrome = 'full' | 'statsOnly';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RunScreenTemplate {
  platform: RunTemplatePlatform;
  chrome: RunTemplateChrome;
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

/** A zero-area rect at a point that cannot fall inside any populated region
 * (y=0, above even `kicker`) — used by `statsOnly` chrome for `badge`/
 * `actions`, which that chrome never renders but the region map must still
 * populate (every `RunScreenRegion` key is required). */
function unusedRect(x: number): Rect {
  return { x, y: 0, width: 0, height: 0 };
}

function buildDesktopTemplate(chrome: RunTemplateChrome): RunScreenTemplate {
  const { width, height } = DESKTOP_PROFILE.canvas;
  const gx = DESKTOP_PROFILE.safe.x;
  const statsOnly = chrome === 'statsOnly';
  const regions: Record<RunScreenRegion, Rect> = {
    kicker: { x: gx, y: 16, width: 260, height: 20 },
    title: { x: gx, y: 36, width: 460, height: 34 },
    stats: { x: width - gx - 640, y: 20, width: 640, height: 20 },
    badge: statsOnly ? unusedRect(width - gx - 200) : { x: width - gx - 200, y: 46, width: 200, height: 22 },
    actions: statsOnly ? unusedRect(width - gx - 460) : { x: width - gx - 460, y: 74, width: 460, height: 34 },
    // statsOnly (battle): no badge/actions band to clear — content starts
    // right below the title/stats row (contentTop ≈ 84 — see module doc).
    content: statsOnly
      ? { x: gx, y: 84, width: width - gx * 2, height: height - 84 - 24 }
      : { x: gx, y: 130, width: width - gx * 2, height: height - 130 - 24 },
    footer: { x: gx, y: height - 24, width: width - gx * 2, height: 0 },
  };
  // statsOnly never renders action-role buttons — zero-area slots rather than
  // splitting the (already zero-area) `actions` region, which would otherwise
  // produce negative-width rects.
  const [back, secondary, tertiary, primary] = (statsOnly
    ? [unusedRect(gx), unusedRect(gx), unusedRect(gx), unusedRect(gx)]
    : splitRow(regions.actions, 4, 12)) as [Rect, Rect, Rect, Rect];
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
    chrome,
    canvas: { width, height },
    regions,
    actionSlots: { back, secondary, tertiary, primary },
    actionRegionOf: { back: 'actions', secondary: 'actions', tertiary: 'actions', primary: 'actions' },
    contentSlots: { choices },
  };
}

function buildMobileTemplate(chrome: RunTemplateChrome): RunScreenTemplate {
  const { width, height } = MOBILE_PROFILE.canvas;
  const sx = MOBILE_PROFILE.safe.x;
  const statsOnly = chrome === 'statsOnly';
  const regions: Record<RunScreenRegion, Rect> = {
    kicker: { x: sx, y: 8, width: 180, height: 12 },
    title: { x: sx, y: 20, width: 220, height: 18 },
    stats: { x: sx, y: 40, width: width - sx * 2, height: 14 },
    badge: statsOnly ? unusedRect(sx) : { x: sx, y: 56, width: width - sx * 2, height: 16 },
    actions: statsOnly ? unusedRect(sx) : { x: sx, y: 74, width: width - sx * 2, height: 22 },
    // statsOnly (battle): no badge/actions band to clear — content starts
    // right below the stats row (content.y ≈ 62 — see module doc).
    content: statsOnly
      ? { x: sx, y: 62, width: width - sx * 2, height: 892 - 62 - 10 - 54 }
      : { x: sx, y: 100, width: width - sx * 2, height: 892 - 100 - 10 - 54 },
    // Primary sits in the bottom footer, thumb-reachable — mobile's one
    // deliberate per-platform difference from desktop (see module doc).
    // statsOnly (battle) never renders a template footer either — the scene
    // draws its own bottom playback bar — so this stays zero-height there.
    footer: statsOnly ? unusedRect(sx) : { x: sx, y: height - sx - 44, width: width - sx * 2, height: 44 },
  };
  const [back, secondary, tertiary] = (statsOnly
    ? [unusedRect(sx), unusedRect(sx), unusedRect(sx)]
    : splitRow(regions.actions, 3, 8)) as [Rect, Rect, Rect];
  // Mobile stacks the route board above the choices, so the block sits at a
  // fixed y below it — already stable horizontally, now declared not literal.
  const choicesW = 330;
  const choicesY = 438;
  const choices: Rect = {
    x: Math.round(regions.content.x + (regions.content.width - choicesW) / 2),
    y: choicesY,
    width: choicesW,
    height: (statsOnly ? height - sx - 44 : regions.footer.y) - 12 - choicesY,
  };
  return {
    platform: 'mobile',
    chrome,
    canvas: { width, height },
    regions,
    actionSlots: { back, secondary, tertiary, primary: statsOnly ? unusedRect(sx) : { ...regions.footer } },
    actionRegionOf: { back: 'actions', secondary: 'actions', tertiary: 'actions', primary: 'footer' },
    contentSlots: { choices },
  };
}

const TEMPLATES: Record<RunTemplateChrome, Record<RunTemplatePlatform, RunScreenTemplate>> = {
  full: { desktop: buildDesktopTemplate('full'), mobile: buildMobileTemplate('full') },
  statsOnly: { desktop: buildDesktopTemplate('statsOnly'), mobile: buildMobileTemplate('statsOnly') },
};

/** The fixed template for a platform (and, optionally, chrome variant) —
 * pure, cached, never mutated by callers. `chrome` defaults to `'full'` so
 * every existing call site (every non-battle screen) is unchanged. */
export function runScreenTemplate(platform: RunTemplatePlatform, chrome: RunTemplateChrome = 'full'): RunScreenTemplate {
  return TEMPLATES[chrome][platform];
}
