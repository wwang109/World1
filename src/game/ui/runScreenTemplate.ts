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
  contentSlots: {
    choices: Rect;
    /**
     * The REWARD block — the ONE template every resolved event outcome (and
     * the "PICK ONE TO KEEP" bonus-draft row) renders into, so the reward
     * screen is a consistent, reusable FORMAT rather than a per-outcome-kind
     * layout: `RunRewardPanel.ts` reads these rects, `renderRunRewardPanel`
     * never advances a cursor. Declared parts:
     *
     *   panel    — everything above the buttons. A HARD CEILING, not a
     *              suggestion: content taller than this must shrink to it.
     *   gap      — the breathing room between panel and buttons, declared
     *              here so it is identical on every reward screen.
     *   buttons  — a FIXED bottom-anchored row. It is reserved before the
     *              panel gets any space, so a tall reward can never push the
     *              confirm action off the bottom of the screen.
     *   icon     — the small outcome-kind icon (top of panel).
     *   headline — "Gained a BRONZE card" — the one-line (up to 2) summary.
     *   detail   — an optional second line ("The gamble paid off.").
     *   feature  — the reward's own visual: a `CardToken` for `grantCard`, a
     *              gem chip for `grantGem`, nothing for gold/level/nothing.
     *              Gets WHATEVER is left down to the panel's bottom edge, so
     *              it is the one part that shrinks — never the ceiling.
     *
     * `icon`/`headline`/`detail`/`feature` are stacked top-to-bottom INSIDE
     * `panel`, ANCHORED AT `panel.y` — the reward screen owns the WHOLE panel
     * (it does not share it with a re-shown story header): once a choice
     * resolves, the outcome replaces the event's narrative column entirely,
     * exactly the way `RunChoicePanel` replaces nothing — it IS the content.
     * This exists because the reward section used to render BELOW the full
     * story column (area caption + a 260px art image + title + a body-text
     * panel with no height cap), so a flat 230px card appended to a cursor
     * that column had already pushed to ~650-790px (on a 900-tall canvas)
     * had nowhere to go — clamping the card's height alone couldn't fix that,
     * since even the headline could already start past the panel's bottom
     * edge. Giving the reward screen the whole panel (not "whatever's left
     * under the header") makes the fit arithmetically guaranteed instead of
     * probable.
     */
    reward: {
      panel: Rect; gap: number; buttons: Rect;
      icon: Rect; headline: Rect; detail: Rect; feature: Rect;
    };
  };
}

/** Height of the reward confirm-button row, and the gap above it. Declared
 * per platform, never inline at a call site. */
const REWARD_BUTTON_H: Record<RunTemplatePlatform, number> = { desktop: 44, mobile: 40 };
const REWARD_GAP: Record<RunTemplatePlatform, number> = { desktop: 20, mobile: 14 };

/** Fixed per-platform heights for the reward panel's top three rows (icon,
 * headline, detail) and the gap between every consecutive pair of
 * icon/headline/detail/feature — `feature` (the actual card/gem visual) gets
 * whatever height remains down to the panel's bottom edge, never a fixed
 * size, which is what makes it the part that shrinks instead of the ceiling
 * that gets breached. */
const REWARD_ICON_H: Record<RunTemplatePlatform, number> = { desktop: 56, mobile: 48 };
const REWARD_HEADLINE_H: Record<RunTemplatePlatform, number> = { desktop: 64, mobile: 52 };
const REWARD_DETAIL_H: Record<RunTemplatePlatform, number> = { desktop: 28, mobile: 22 };
const REWARD_INNER_GAP: Record<RunTemplatePlatform, number> = { desktop: 14, mobile: 10 };

/**
 * Breathing room between the panel's own border and the icon/headline/
 * detail/feature stack it frames — applied on all four sides. Before this
 * existed, the stack touched the panel's edges exactly (icon flush against
 * the top border, `feature` flush against the bottom one): fine as pure
 * rect math, but a visibly unfinished "frame with no mat" once the panel
 * actually reads as a frame (see `REWARD_PANEL_MAX_W`/`_H` below) rather
 * than an edge-to-edge fill.
 */
const REWARD_PANEL_PAD: Record<RunTemplatePlatform, number> = { desktop: 24, mobile: 16 };

/**
 * Reasoned CEILING on the reward panel's size — DESKTOP ONLY. Before this
 * existed, `panel` took the WHOLE remainder of `content` (deliberately, per
 * the module's original "feature gets whatever's left, never a fixed
 * ceiling" invariant). That was fine at a 1440x900 window, but the game now
 * runs `Phaser.Scale.EXPAND` (`viewport.ts`): on a wide desktop window
 * `content.width` can exceed 1900px, and a single ~140px-wide card centered
 * in a panel that wide reads as a token lost in a stadium, not a reward —
 * exactly the live-screenshot regression this redesign (2026-08-06) fixes.
 * Capping the panel (and centering it in `content`, see `buildRewardSlot`)
 * makes the reward read as a deliberately-sized announcement card again.
 *
 * WIDTH (850): generous enough for the bonus-draft's 5-card row at its own
 * natural, un-bumped ideal size (`RunRewardPanel.ts`'s
 * `FEATURE_CARD_SIZE.desktop` — reverted alongside this cap, see that
 * file's doc comment — 142px wide) plus its inter-card gap and this
 * module's own side padding: `5*142 + 4*DESKTOP_PROFILE.gap(12) +
 * 2*REWARD_PANEL_PAD(24) = 806`, rounded up to 850 for a comfortable
 * (not razor-thin) margin either side of that row.
 *
 * HEIGHT (480): the tight icon+headline+detail+feature stack at a SINGLE
 * card's natural height (233) plus top/bottom padding:
 * `56+14+64+14+28+14+233 + 2*24 = 471`, rounded up to 480. The SAME height
 * fits the 5-card bonus-draft row — one row is exactly as tall as one card,
 * it only needs the WIDTH above — so this ceiling never squeezes it.
 *
 * Mobile is deliberately NOT capped here: its bonus-draft row wraps into 2-3
 * STACKED rows (its narrow column only fits 2 cards across), which already
 * needs more height than a tight single-card stack provides — capping it as
 * tight as desktop's single-card case would only shrink that wrapped grid.
 * A single feature on mobile instead gets a dedicated top-anchor in
 * `RunRewardPanel.ts`'s `renderFeature` (see its doc comment) so it still
 * sits close under the headline instead of centering in that leftover
 * height, without taking room away from the grid.
 */
const REWARD_PANEL_MAX_W: Partial<Record<RunTemplatePlatform, number>> = { desktop: 850 };
const REWARD_PANEL_MAX_H: Partial<Record<RunTemplatePlatform, number>> = { desktop: 480 };

/** Splits `content` into the reward panel / gap / bottom-anchored button row,
 * then subdivides the panel itself into the icon/headline/detail/feature
 * stack (see the `reward` doc comment above). The BUTTONS are reserved
 * first, at their ORIGINAL full-content-width bottom-anchored rect (a
 * full-bleed confirm bar reads fine as its own thing, and staying full-width
 * keeps every containment/gap invariant below unchanged) — the panel then
 * gets AT MOST `REWARD_PANEL_MAX_W`/`_H` (desktop only; mobile still gets
 * whatever is left, see that constant's doc comment) of what's left,
 * centered horizontally in `content` and BOTTOM-anchored within the
 * available vertical band: any slack from the cap collects ABOVE the panel
 * (nearer the header) rather than between the panel and the buttons row, so
 * CONTINUE stays exactly `gap` (plus the panel's own bottom padding) below
 * the panel's visible content by construction — "sits near the content,"
 * not "happens to." `feature` is still reserved LAST, getting whatever the
 * (now much smaller, on desktop) panel has left after icon/headline/detail:
 * the same "fixed items first, flexible item gets the remainder" rule as
 * before, still arithmetically incapable of pushing anything off the
 * bottom edge — capping `panel` only ever makes it SMALLER than the space
 * `buttons` already reserved around, never bigger. */
export function buildRewardSlot(content: Rect, platform: RunTemplatePlatform): RunScreenTemplate['contentSlots']['reward'] {
  const buttonH = REWARD_BUTTON_H[platform];
  const gap = REWARD_GAP[platform];
  const buttons: Rect = {
    x: content.x,
    y: content.y + content.height - buttonH,
    width: content.width,
    height: buttonH,
  };

  const availableH = Math.max(0, content.height - buttonH - gap);
  const maxW = REWARD_PANEL_MAX_W[platform] ?? content.width;
  const maxH = REWARD_PANEL_MAX_H[platform] ?? availableH;
  const panelW = Math.min(content.width, maxW);
  const panelH = Math.min(availableH, maxH);
  const panel: Rect = {
    x: content.x + (content.width - panelW) / 2,
    y: content.y + (availableH - panelH),
    width: panelW,
    height: panelH,
  };

  const pad = REWARD_PANEL_PAD[platform];
  const innerX = panel.x + pad;
  const innerW = Math.max(0, panel.width - pad * 2);
  const innerGap = REWARD_INNER_GAP[platform];
  const icon: Rect = { x: innerX, y: panel.y + pad, width: innerW, height: REWARD_ICON_H[platform] };
  const headline: Rect = { x: innerX, y: icon.y + icon.height + innerGap, width: innerW, height: REWARD_HEADLINE_H[platform] };
  const detail: Rect = { x: innerX, y: headline.y + headline.height + innerGap, width: innerW, height: REWARD_DETAIL_H[platform] };
  const featureTop = detail.y + detail.height + innerGap;
  const featureBottom = panel.y + panel.height - pad;
  const feature: Rect = { x: innerX, y: featureTop, width: innerW, height: Math.max(0, featureBottom - featureTop) };
  return { panel, gap, buttons, icon, headline, detail, feature };
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
    contentSlots: { choices, reward: buildRewardSlot(regions.content, 'desktop') },
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
    contentSlots: { choices, reward: buildRewardSlot(regions.content, 'mobile') },
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
