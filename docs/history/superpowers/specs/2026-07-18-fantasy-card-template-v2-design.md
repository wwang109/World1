> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Fantasy Card Template V2 Design

Date: 2026-07-18
Owner: Codex
Scope: `src/game/ui/` full-card template only

## Summary

Replace the current full-card fantasy template implementation with a new
component built from a fixed template spec instead of accumulated position
adjustments. The new system must define locked layout regions for art, icons,
WT, slot label, title, divider, and body text, plus tier-specific visual skins
for bronze, silver, gold, and diamond cards.

This design explicitly forbids per-card layout nudges for art, icons, and text.
If a card asset or authored text does not fit the template rules, the asset or
content must be corrected before entering the project, or rejected by the
template contract.

## Problem

The current template has drifted toward a patch model:

- Layout behavior is partly expressed as semantic regions and partly as manual
  offsets.
- Tier handling includes special centering adjustments instead of a unified
  geometry contract.
- The template currently adapts to problematic card assets after import instead
  of defining asset requirements before import.
- This makes the template harder to reason about, harder to extend, and more
  likely to regress when new art or new tiers are added.

The user wants a real card template system with:

- fixed placement rules
- explicit icon and text-box sizing requirements
- tier-specific color/border variants
- no hardcoded adjustment to icons, images, or text per card

## Goals

- Build a new card-template component instead of retrofitting the current one.
- Define one reusable geometry shared by all tiers.
- Separate geometry from styling.
- Enforce fixed layout regions with named responsibilities.
- Support tier variants through visual skins only.
- Define an art-ingest contract so images are prepared before import.
- Keep the existing feature surface: art, WT plate, icon rails, slot label,
  title, and body text.

## Non-goals

- No change to combat logic, data balance, or authored skill semantics.
- No per-card layout exceptions.
- No responsive redesign of the whole Prep/Wiki scene.
- No HTML/CSS DOM card renderer. This remains a Phaser component.
- No attempt to preserve internal compatibility with the old implementation if
  that blocks a cleaner structure.

## Design Principles

- One geometry, many skins.
- Region-based placement, never ad hoc coordinates in caller code.
- Fixed content slots for icons and labels.
- Narrow, explicit text-fit rules.
- Asset quality is validated against the template instead of corrected by the
  renderer.
- Tier changes appearance, not structure.

## New Architecture

Create a new component path instead of extending the current file in place.

### Proposed files

- `src/game/ui/FantasyCardTemplateV2.ts`
- `src/game/ui/fantasyCardTemplateSpec.ts`
- `src/game/ui/fantasyCardTierSkins.ts`
- `src/game/ui/fantasyCardAssetRules.ts`

The old `FantasyCardTemplate.ts` remains temporarily as the legacy component
until the new implementation is validated and callers are switched.

### Component roles

`fantasyCardTemplateSpec.ts`

- Defines card geometry.
- Declares named regions, dimensions, anchors, padding, and slot counts.
- Owns allowed text-fit rules and icon capacity.

`fantasyCardTierSkins.ts`

- Defines bronze, silver, gold, and diamond visual tokens.
- Contains frame references, accent colors, WT plate treatment, divider color,
  text plate trim, and ornament styling.
- Must not change geometry.

`fantasyCardAssetRules.ts`

- Defines the card-art contract.
- Encodes safe area, quiet lower-third requirement, no-critical-detail zones,
  and accepted fit behavior.

`FantasyCardTemplateV2.ts`

- Reads `SkillDef`, chosen tier, chosen skin, and template spec.
- Resolves content into fixed regions.
- Applies only approved fit modes and text rules.
- Refuses to add card-specific placement logic.

## Canonical Card Geometry

V2 uses one canonical full-card design size and scales from there.

### Base design size

- Card canvas: `420 x 690 px`
- Corner radius: `28 px`
- Origin model: top-left region definitions in template spec; renderer may still
  place the final container by center point in Phaser.

This becomes the single geometry source for the template. Gallery thumbnails and
other smaller views scale the entire card uniformly. They do not redefine
internal layout.

### Full-card frame shape

- Shape: portrait rounded rectangle
- Outer bounds: `420 x 690 px`
- Outer corner radius: `28 px`
- Inner visual safe inset for frame art: `18 px`
- Transparent outside the frame silhouette

If a frame PNG is used, it must match this silhouette exactly.

## Locked Region Dimensions

All measurements below are defined against the canonical `420 x 690 px` card.

### `artFrame`

- Bounds: `x 22, y 20, w 376, h 468`
- Shape: rounded rectangle
- Corner radius: `26 px`
- Fit mode: `cover`
- Quiet lower-third begins at `68%` of art-frame height

### `leftRail`

- Bounds: `x 34, y 40, w 72, h 214`
- Layout: 3 fixed cells
- Cell 1: primary archetype badge
  Bounds: `58 x 60`
- Cell 2: WT plate
  Bounds: `56 x 60`
- Cell 3: type badge reserve
  Bounds: `46 x 48`
- Vertical gaps: `10 px`, centered inside rail

### `rightRail`

- Bounds: `x 314, y 38, w 72, h 180`
- Layout: up to 3 badge cells
- Each cell bounds: `50 x 50`
- Vertical gap: `8 px`
- Horizontal alignment: centered in rail

### `tierFrame`

- Outer frame bounds: `420 x 690`
- Decorative text-frame plate bounds:
  `x 18, y 488, w 384, h 174`
- Tier ornaments and trim must stay inside these bounds and cannot change them.

### `slotLabel`

- Bounds: `x 265, y 497, w 92, h 18`
- Alignment: centered text inside fixed slot-label band

### `titleBox`

- Bounds: `x 52, y 530, w 284, h 44`
- Alignment: centered
- Max lines: 2

### `divider`

- Bounds: `x 60, y 579, w 268, h 2`
- Alignment: centered horizontally in text section

### `bodyBox`

- Bounds: `x 50, y 592, w 292, h 50`
- Alignment: left text inside fixed box
- Max lines by rule: 3, 4, or 5

### `wtPlate`

- Plate bounds: `56 x 60`
- Plate anchor point: centered in WT cell of `leftRail`
- Weight text anchor: center of the plate, fixed across tiers

## PNG Asset Size Requirements

The renderer works from the canonical geometry above. PNG assets must be sized
to match it instead of relying on code adjustment.

### 1. Tier frame PNG

Use when the frame is a pre-rendered asset instead of fully procedural.

- Required canvas: `420 x 690 px`
- Background: transparent
- Shape: same rounded-rectangle silhouette as the card
- One PNG per tier:
  `bronze`, `silver`, `gold`, `diamond`

Recommended export:

- Working source: `840 x 1380 px` at 2x
- Runtime PNG: `420 x 690 px`

### 2. Full card art PNG

The art fills `artFrame` using `cover`, so the image must tolerate crop.

- Minimum runtime source: `840 x 1040 px`
- Recommended working source: `1024 x 1536 px` or larger portrait
- Safe focal zone target:
  keep the main subject inside the center `260 x 250 px` area of the art frame
- Quiet lower-third:
  leave the bottom `150 px` of the art frame free of critical detail

Art is not required to match the full card canvas size. It must be portrait and
large enough for clean `cover` cropping into `376 x 468`.

### 3. Badge/icon PNG

Use when a symbol is supplied as image art instead of drawn procedurally.

- Primary badge symbol working box: `58 x 60 px`
- Secondary badge symbol working box: `50 x 50 px`
- Type badge symbol working box: `46 x 48 px`

Recommended export:

- Runtime PNG: match the working box above
- Preferred source PNG: 2x each runtime size

The visible icon shape should stay inside an inner safe margin of `6 px` on all
sides so tier or metal badge rims do not clip the symbol.

### 4. WT plate PNG

- Runtime PNG: `56 x 60 px`
- Preferred source PNG: `112 x 120 px`
- Weight numeral safe center: `28 x 24 px` centered in the plate

### 5. Divider ornament PNG

If divider art is supplied as a PNG:

- Runtime PNG: `268 x 8 px`
- Transparent background
- Ornament must visually center inside the fixed divider bounds

### 6. Optional text-frame plate PNG

If the lower text frame is supplied as an asset instead of procedural drawing:

- Runtime PNG: `384 x 174 px`
- Preferred source PNG: `768 x 348 px`
- Transparent background outside the plate silhouette

## Asset Acceptance Checklist

A PNG is acceptable for V2 only if all of the following are true:

- It matches the required runtime aspect ratio for its region.
- It fits its designated runtime bounds with no manual offset.
- It remains legible after uniform scaling.
- It respects the safe margins defined for the region.
- It does not require card-specific crop tuning to look correct.

## Template Regions

The new template uses the following locked regions:

### `artFrame`

- The masked art display area.
- Fixed position and shape for every card.
- V2 uses one global fit mode: `cover`.
- Optional focal anchoring is allowed only as a small fixed enum such as
  `center`, `upper-center`, or `lower-center`.
- No freeform x/y offset is allowed.

### `leftRail`

- Vertical rail for the primary archetype badge and WT plate stack.
- Contains fixed cells with fixed dimensions.
- Each cell centers its content automatically.
- No card-specific icon repositioning is allowed.

### `rightRail`

- Vertical rail for type and secondary archetype badges.
- Fixed maximum icon count.
- Fixed badge box size and gap.
- Overflow is not allowed; excess badges are a content error.

### `wtPlate`

- Dedicated region for the WT/tier badge.
- The plate frame comes from the selected tier skin.
- Weight digits must center through one geometry rule, not tier-specific
  numeric nudges.
- Digit-count changes may choose from predefined text styles, but the anchor
  remains fixed.

### `slotLabel`

- Fixed region attached to the top edge of the text-frame area.
- Shows `SLOT N`.
- Same geometry across tiers.
- Tier may change color treatment only.

### `titleBox`

- Fixed title area inside the text section.
- Uses a small set of predefined title styles such as:
  `title-short`, `title-medium`, `title-long`.
- The rule is selected by content length only.
- Manual line-break tuning is not allowed.

### `divider`

- Fixed ornamental or line divider between title and body.
- Style varies by tier skin only.

### `bodyBox`

- Fixed text area for authored skill text.
- Uses a small finite rule set such as:
  `body-3-line`, `body-4-line`, `body-5-line`.
- Line count, font size, and spacing come from the selected text rule only.
- If text still does not fit, the authored text or template rule must change;
  card-specific nudging is forbidden.

### `tierFrame`

- Decorative outer frame or inner plate styling linked to the chosen tier.
- Must preserve the same geometry across tiers.
- Border art, ornament color, and trim may vary.

## Tier Variant Rules

Tier cards are not a separate template family. They are the same template
geometry rendered with different approved skins.

### Shared across all tiers

- card size
- art frame size and position
- icon rail geometry
- WT plate position
- slot label position
- title, divider, and body bounds
- padding
- mask shape

### Allowed to vary by tier

- border/frame art
- border color
- WT plate color treatment
- text-frame trim color
- ornament accent color
- optional subtle glow/shimmer tokens if already aligned with the visual style

### Tier set

- `bronze`
- `silver`
- `gold`
- `diamond`

If future tiers are added, they must provide a new skin object without changing
the geometry contract.

## Art Ingest Contract

Card art must be prepared for the template before import.

### Required art rules

- The main focal subject must stay inside the template's focal-safe region.
- The lower text-safe area must avoid critical detail because the body plate
  overlays it.
- The left and right rail zones must not contain critical content that the card
  requires for readability.
- The outer corners must tolerate masking/cropping.
- The image must remain readable under the fixed matte/shade treatment.

### Allowed renderer behavior

- scale to fit by approved mode
- crop uniformly by approved mode
- apply the shared lower shade/matte treatment
- apply masking through the shared shape

### Forbidden renderer behavior

- card-specific image x/y correction
- card-specific scaling beyond the approved fit rules
- manual badge dodging around art details
- per-card safe-area overrides

If an asset violates the contract, the fix happens in the source art, not in
the renderer.

## Content Fit Rules

The template is allowed to choose from predefined rule sets. It is not allowed
to invent one-off corrections.

### Title rules

Title selects from a short finite set based on length:

- `title-short`
- `title-medium`
- `title-long`

Each rule defines:

- font size
- max lines
- line spacing
- wrap width

### Body rules

Body text selects from a finite set based on total text density:

- `body-3-line`
- `body-4-line`
- `body-5-line`

Each rule defines:

- font size
- max lines
- line spacing
- wrap width

### Weight digits

Weight text may switch between a small number of digit-count styles:

- `wt-1-digit`
- `wt-2-digit`
- `wt-3-digit`

These are style choices, not offset corrections. The text anchor remains fixed.

## Rendering Rules

The renderer must follow these constraints:

- Region placement comes only from the template spec.
- Tier appearance comes only from the tier skin.
- Art fit comes only from the asset rules.
- Text style comes only from predefined text rules.
- Callers provide semantic content, not layout overrides.

The renderer must not expose public options for:

- ad hoc icon offsets
- ad hoc text offsets
- per-card art offsets
- tier-specific geometry overrides

If the code needs those options to make a card look correct, the template design
or source asset is wrong and must be corrected upstream.

## Migration Plan

### Phase 1: Build V2 alongside legacy

- Add the new spec, skins, and renderer files.
- Recreate the current approved visual direction as closely as practical within
  the new rules.
- Existing frame artwork may be reused only as a skin asset source. It must fit
  the new geometry without card-specific crop or offset logic.
- Keep the old template untouched during initial build.

### Phase 2: Switch the template view

- Point the Wiki `Template` preview and any controlled callers to
  `FantasyCardTemplateV2`.
- Do not add a compatibility wrapper unless a caller is blocked by interface
  churn. Prefer direct controlled adoption in the template preview first.
- Validate the representative cards already used in the gallery:
  Arcane Bolt, Fireball, Crippling Strike, Mana Ward, Venom Fang, and
  War Banner.

### Phase 3: Remove legacy path

- After validation, either replace usages of the legacy component or rename V2
  to the canonical `FantasyCardTemplate`.
- Remove dead offset logic from the legacy path.

## Validation

The new template is acceptable only if all of the following are true:

- No card-specific position corrections exist for art, icons, or text.
- Tier variants change only approved styling tokens.
- The six current gallery cards render acceptably without manual tweaks.
- New cards can be onboarded by following the asset contract rather than
  editing layout code.
- The template API accepts semantic card data without layout overrides.

## Risks

- Some existing art may not satisfy the new ingest contract and will need
  replacement or re-cropping.
- Reproducing the current visual treatment exactly may not be worth preserving
  if it conflicts with the new no-adjustment rule.
- Long authored text may reveal cases where the current text-density heuristics
  need revision at the template-system level.

## Decisions Locked By This Spec

- Build a new template implementation rather than patching the old one.
- Keep Phaser as the renderer.
- Use one shared geometry across all tiers.
- Treat tiers as skins, not separate layouts.
- Use one global art fit mode in V2: `cover`.
- Forbid per-card nudges for art, icons, and text.
- Allow only fixed-enum focal anchoring, never freeform image offsets.
- Enforce an asset-ingest contract before art enters the project.
