/**
 * Run screen layout -- `runScreenTemplate`'s fixed spec PROJECTED onto the
 * live design viewport.
 *
 * `runScreenTemplate.ts` is the authored source of truth, and it is authored
 * against the profile's canvas (1440x900 / 412x892). Since 2026-08-06 the
 * canvas FILLS the browser window (`Phaser.Scale.RESIZE`, see
 * `game/viewport.ts`), so the real drawable area is that canvas PLUS whatever
 * slack the window has. This module is the one place that knows how each
 * authored rect should absorb that slack:
 *
 *   left-anchored   (kicker, title, content.x)    unchanged
 *   right-anchored  (desktop stats/badge/actions) translate by the width slack
 *   full-width      (mobile stats/badge/actions)  grow by the width slack
 *   bottom-anchored (mobile footer)               translate by the height slack
 *   the content box                               grows by both
 *
 * Everything else is DERIVED from those, using proportions read back out of
 * the authored template rather than re-declared here -- the action-row gap is
 * measured from the authored slots, and the reward stack's fixed row heights
 * are measured from the authored reward rects. There is therefore no second
 * copy of any layout constant: change `runScreenTemplate.ts` and this follows.
 *
 * Consumers read THIS, not `runScreenTemplate` directly. The returned object
 * satisfies the same `RunScreenTemplate` interface, so
 * `renderRunRewardPanel(scene, template, ...)` and friends need no change.
 *
 * Pure module (no Phaser import), unit-tested in
 * `tests/game/runScreenLayout.test.ts`.
 */

import { viewport } from '../viewport';
import {
  buildRewardSlot,
  runScreenTemplate,
  type Rect,
  type RunActionRole,
  type RunScreenRegion,
  type RunScreenTemplate,
  type RunTemplateChrome,
  type RunTemplatePlatform,
} from './runScreenTemplate';

function translated(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

function grown(r: Rect, dw: number, dh: number): Rect {
  return { x: r.x, y: r.y, width: r.width + dw, height: r.height + dh };
}

/**
 * Re-splits an authored row of equal-width slots across a WIDER region. The
 * slot count and the inter-slot gap are measured from the authored slots
 * themselves, so this stays correct if the template ever changes either.
 * A row of zero-area slots (the `statsOnly` chrome's unused action roles) is
 * returned untouched -- there is nothing there to stretch.
 */
function stretchRow(slots: Rect[], region: Rect, dw: number): Rect[] {
  const count = slots.length;
  const first = slots[0];
  if (count === 0 || !first || first.width <= 0 || dw === 0) return slots.map((s) => ({ ...s }));
  const second = slots[1];
  const gap = second ? second.x - (first.x + first.width) : 0;
  const width = (region.width + dw - gap * (count - 1)) / count;
  return slots.map((slot, i) => ({ x: region.x + i * (width + gap), y: slot.y, width, height: slot.height }));
}

/**
 * Rebuilds the reward stack for a wider/taller `content`. CHANGED 2026-08-06:
 * this used to re-derive panel/icon/headline/detail/feature from scratch
 * (reading only the authored FIXED heights/gaps off `base` and otherwise
 * assuming the panel fills the whole of `content`) — a second copy of
 * `buildRewardSlot`'s own formula, which is exactly the duplication this
 * module's own doc comment disclaims ("no second copy of any layout
 * constant"). It went stale the moment `buildRewardSlot` stopped filling
 * `content` (the reward redesign that caps the panel to a reasoned max size
 * and centers/bottom-anchors it, `runScreenTemplate.ts`'s
 * `REWARD_PANEL_MAX_W`/`_H` doc comment) — this reimplementation had no way
 * to know about that cap, so a projected (wide/tall) viewport silently
 * un-capped the panel again, stretching it back across the whole grown
 * `content` width. Delegating to the SAME exported `buildRewardSlot` used
 * for the authored (un-projected) template closes that gap by construction:
 * whatever cap/pad/centering rule that function encodes is what gets
 * projected, with nothing left to keep in sync by hand.
 */
function projectReward(platform: RunTemplatePlatform, content: Rect): RunScreenTemplate['contentSlots']['reward'] {
  return buildRewardSlot(content, platform);
}

/** Pure projection -- exported for the unit test, which drives it with
 * explicit viewports instead of the live one. */
export function projectRunScreenTemplate(
  base: RunScreenTemplate,
  view: { width: number; height: number },
): RunScreenTemplate {
  const dw = Math.max(0, view.width - base.canvas.width);
  const dh = Math.max(0, view.height - base.canvas.height);
  if (dw === 0 && dh === 0) return base;

  const desktop = base.platform === 'desktop';
  const b = base.regions;
  // Desktop's stats/badge/actions are RIGHT-anchored fixed-width blocks, so
  // they translate. Mobile's are FULL-width bands, so they grow. That is the
  // only per-platform difference in the whole projection.
  const bandProject = (r: Rect): Rect => (desktop ? translated(r, dw, 0) : grown(r, dw, 0));

  const content = grown(b.content, dw, dh);
  const regions: Record<RunScreenRegion, Rect> = {
    kicker: { ...b.kicker },
    title: { ...b.title },
    stats: bandProject(b.stats),
    badge: bandProject(b.badge),
    actions: bandProject(b.actions),
    content,
    footer: grown(translated(b.footer, 0, dh), dw, 0),
  };

  const roles: RunActionRole[] = ['back', 'secondary', 'tertiary', 'primary'];
  // A role whose slot lives in `footer` (mobile's primary) follows the footer;
  // the rest are sub-rects of `actions` and follow it.
  const inActions = roles.filter((role) => base.actionRegionOf[role] === 'actions');
  const stretched = desktop
    ? inActions.map((role) => translated(base.actionSlots[role], dw, 0))
    : stretchRow(inActions.map((role) => base.actionSlots[role]), b.actions, dw);
  const actionSlots = {} as Record<RunActionRole, Rect>;
  inActions.forEach((role, i) => { actionSlots[role] = stretched[i] ?? { ...base.actionSlots[role] }; });
  for (const role of roles) {
    if (base.actionRegionOf[role] === 'actions') continue;
    const slot = base.actionSlots[role];
    // Footer-hosted roles inherit the footer's move AND its new width -- unless
    // they are the zero-area placeholder a chrome variant leaves behind.
    actionSlots[role] = slot.width > 0 ? { ...regions.footer } : { ...slot };
  }

  const baseChoices = base.contentSlots.choices;
  const choices: Rect = {
    // Authored centred inside `content` on both platforms -- stay centred.
    x: Math.round(content.x + (content.width - baseChoices.width) / 2),
    y: baseChoices.y,
    width: baseChoices.width,
    // Mobile's choices block is bottom-bounded by the footer, so it grows with
    // it; desktop's is a fixed-height panel stack.
    height: desktop ? baseChoices.height : baseChoices.height + dh,
  };

  return {
    platform: base.platform,
    chrome: base.chrome,
    canvas: { width: view.width, height: view.height },
    regions,
    actionSlots,
    actionRegionOf: base.actionRegionOf,
    contentSlots: { choices, reward: projectReward(base.platform, content) },
  };
}

/** Memo so the many reads inside one render share one object (and one
 * identity), while a viewport change produces a fresh one. */
let cacheKey = '';
const cache = new Map<string, RunScreenTemplate>();

/** The authored template projected onto the CURRENT viewport. Call at LAYOUT
 * time -- never cache the result in a module-level const. */
export function runScreenLayout(platform: RunTemplatePlatform, chrome: RunTemplateChrome = 'full'): RunScreenTemplate {
  const view = viewport();
  const key = String(view.width) + 'x' + String(view.height);
  if (key !== cacheKey) { cacheKey = key; cache.clear(); }
  const id = platform + ':' + chrome;
  const hit = cache.get(id);
  if (hit) return hit;
  const built = projectRunScreenTemplate(runScreenTemplate(platform, chrome), view);
  cache.set(id, built);
  return built;
}

/**
 * A LIVE reference to the projected layout, shaped exactly like a
 * `RunScreenTemplate`. Scenes keep their existing `const TEMPLATE = ...`
 * module constant and every `TEMPLATE.regions.content` read stays as written --
 * but each read now resolves against the CURRENT viewport, which is what makes
 * the conversion one line per scene instead of dozens.
 */
export function runScreenLayoutRef(platform: RunTemplatePlatform, chrome: RunTemplateChrome = 'full'): RunScreenTemplate {
  const live = (): RunScreenTemplate => runScreenLayout(platform, chrome);
  return {
    platform,
    chrome,
    get canvas() { return live().canvas; },
    get regions() { return live().regions; },
    get actionSlots() { return live().actionSlots; },
    get actionRegionOf() { return live().actionRegionOf; },
    get contentSlots() { return live().contentSlots; },
  };
}
