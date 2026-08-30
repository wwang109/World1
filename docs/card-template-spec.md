# Fantasy Card Template Specification (V2)

The **single source of truth** for the full-size skill-card template. It defines
the card's geometry, every named region, the exact PNG assets and their sizes,
and the typography system — so the card renders like a real printed TCG card,
with zero per-card or per-tier pixel nudging in code.

**Code mirror:** `src/game/ui/fantasyCardTemplateSpec.ts` (geometry + text
rules) and `src/game/ui/fantasyCardAssetRules.ts` (asset sizes). This document
and those two files must always agree; a change to one is a change to all
three, in the same commit. The renderer is `src/game/ui/FantasyCardTemplateV2.ts`
— per the durable decision, **no parallel card template may exist**.

---

## 1. The no-nudging contract (hard rules)

The legacy V1 template accumulated `numberOffsetByTier`, `frameCenterOffsetX: 5`,
`contentCenterOffsetX: 5`, and crop rectangles into a monolithic parts sheet.
None of that is allowed in V2:

1. **Every element is placed by a named region rect** from
   `FANTASY_CARD_TEMPLATE_SPEC.regions` — center or corner of the rect, nothing
   else. No free-floating coordinate constants in the renderer.
2. **No per-tier, per-card, or per-asset pixel offsets in code.** All four tier
   variants of an asset share identical geometry; only color changes. If a
   tier's plate looks off-center, the **PNG is wrong — fix the PNG**, never add
   an offset.
3. **Assets carry their own centering.** Every part PNG is authored with its
   optical center at the canvas center and its padding baked into the canvas.
   The renderer may only `setDisplaySize(region.w, region.h)` and place at the
   region center.
4. **One PNG per part.** No sprite-sheet crop rectangles for template parts
   (crop frames couple code to art pixel positions — that's nudging by another
   name). Sheets are fine for icons only if frames are generated from a
   manifest, but the default is individual files.
5. **Uniform scaling only.** The card renders at any size via
   `scale = min(width / 420, height / 690)`; every region rect and font size
   multiplies by that one scalar. Never scale X and Y independently, never
   round differently per element.
6. **Text never moves a box.** When text is long, it steps down the type ladder
   (§5) inside its fixed region; region rects never change per card.

If a card looks wrong, the fix is (in order): fix the asset → fix the region
rect in the spec (all three artifacts, same commit) → only then touch renderer
code.

---

## 2. Canonical geometry

- **Base canvas: 420 × 690** layout units (1× = 1 px at base render size).
  Aspect ratio 0.609 — a deliberately tall portrait card.
- **Corner radius: 28** on the card silhouette. Card art runs full-bleed to the
  rounded silhouette; there is **no outer card frame** (user-locked decision).
- **Layout grid: 2-unit base grid.** Every region coordinate and size is even.
- **Safe inset: 16** — no text or critical badge detail closer than 16 units to
  the card edge.

The card is **full-art**: the artwork runs edge-to-edge under everything, a
gradient scrim (not a boxed plate) carries the text block, and the only frame
is a single thin tier-colored trim line hugging the silhouette.

```
 ┌────────────────────────────┐  0
 │ ◈ type          archetype ◈│  38: small uniform 48×48 badges over art, inside the corner filigree
 │                 (stack ×3)◈│
 │                            │
 │        FULL-BLEED ART      │  artFrame 0,0 → 420×690 (whole card)
 │      (focal safe zone:     │
 │       x 80–340, y 130–420) │
 │                            │
 │░░ gradient scrim starts ░░░│  440: tierFrame (scrim, no border)
 │        Card Title          │  titleBox 500
 │  ──────── divider ───────  │  550
 │  Body rules text, up to    │  bodyBox 562
 │  five lines at minimum pt. │
 │  WT 20    ◆     Slot ▢▢▢   │  644: footer row — weight left, tier diamond
 └────────────────────────────┘  690   center, slots right
```

## 3. Region map

All rects are `x, y, w, h` in base units, origin top-left of the card.
These are the values in `FANTASY_CARD_TEMPLATE_SPEC.regions` — the table is
the human-readable contract for the same numbers.

| Region | Rect (x, y, w, h) | Contents & rules |
|---|---|---|
| `artFrame` | 0, 0, 420, 690 | Full-bleed art window — the whole card, corner radius 28. Art is **cover-fit** (fill, center-crop), masked to the card silhouette. |
| `leftRail` | 34, 34, 56, 56 | Left identity column (envelope around the type badge). |
| `typeBadge` | 38, 38, 48, 48 | The card's **type badge** — EVERY card is typed by exactly one weapon or element (buffs/shields/auras included; a TRUE card's type is cosmetic). Centered in its rect. All badges on the card are the same 48×48 size. **The template draws no chrome behind badges** — the badge PNG carries its own plate/shape; only the no-texture text fallback gets a minimal dark disc. |
| `wtPlate` | 34, 644, 110, 20 | **Weight marker**, bottom-left of the footer row: the word `WT` (9 pt) + the bare weight number (WT ladder, §5), left-aligned, frameless — same typography treatment as the slot marker opposite it. |
| `tierDiamond` | 198, 642, 24, 24 | **Tier diamond**, centered in the footer row between weight and slots. Its fill is the tier color (bronze / silver / gold / diamond); dark outline + inner accent facet. Drawn by code from `TIER` skin colors — no PNG. |
| `rightRail` | 334, 38, 48, 160 | **Archetype badges** (1–3, in `SkillDef.archetypes` order), 48×48, centered on the rail's x-axis; first center 24 below the rail top, pitch 56 (`archetypeStack`). |
| `tierFrame` | 0, 440, 420, 250 | **Text scrim**: a soft dark gradient (alpha 0 → 0.85 over the top 30%, then solid 0.85) with the card's bottom corner radius. No box, no border — the full-art direction keeps frames minimal. |
| `titleBox` | 40, 500, 340, 44 | Card name. Center-aligned, title ladder (§5). |
| `divider` | 60, 550, 300, 2 | Horizontal rule between title and body (tier divider color). |
| `bodyBox` | 40, 562, 340, 76 | Authored card `text` with `{{keyword}}` markup styled inline (§5c). Left-aligned, body ladder (§5). |
| `slotLabel` | 230, 644, 156, 20 | Board footprint: the word `Slot` (9 pt) + one box glyph per occupied slot (12 pt, gap 8; `slotDisplay`), **right-aligned, bottom-right after the text block**. Boxes, not numerals. |

**Art focal safe zone:** badges cover x 26–74 and x 350–390 in the top ~170
units, and the scrim darkens everything below y 440. Critical art focal detail
must live inside **x 80–340, y 130–420**; the lower third of the art should be
calm (per the locked anime-TCG art direction) so text reads over the scrim.

---

## 4. PNG asset manifest

All template part PNGs live under **`public/game-art/template/`** (card art
stays in `public/game-art/cards/`). All parts: PNG-24 with alpha, transparent
background, **authored at exactly 2× the display canvas** so they stay crisp on
high-DPI, optical center = canvas center, no baked outer drop shadows (the
template owns shadows).

| Asset | File | Source px (@2×) | Displayed (1×) | Authoring rules |
|---|---|---|---|---|
| Type badge | `template/badge-{sword\|axe\|lance\|bow\|fangs\|fire\|frost\|lightning\|nature\|holy\|dark}.png` | 96 × 96 (80 × 80 accepted) | 48 × 48 | **Hexagonal plate** (pointy-top), beveled rim, emblem centered. The emblem MAY overflow the hexagon by ~10–15% (baked into the PNG; the renderer never clips badges) — but the artwork's bounding box stays inside the canvas and its optical center stays at canvas center. **All badges share the same 48×48 display size.** |
| Archetype badge | `template/badge-{offense\|defensive\|healing\|support\|debuff}.png` | 96 × 96 (80 × 80 accepted) | 48 × 48 | **Octagonal plate** (flat top/bottom for clean stacking), same badge language and size as the type badge. |
| Divider | `template/divider.png` | 600 × 16 | 300 × 8 | Symmetric ornament; horizontally centered flourish. Optional — the renderer draws a plain tier-colored rule when absent. |
| Card art MASTER | `cards/<skill_id>.png` | preferred 1024 × 1536, min 840 × 1040 | never shipped | Authoring source only. File name is the **exact `SkillDef.id`** (e.g. `arcane_bolt.png`) so the art key is derivable — no hand-maintained name map, no `-anime`/`-spell` suffix variants. |
| Card art SHIPPED | `cards/<skill_id>.webp` | max 1024 tall, WebP q82 (~95 KB) | cover-fit into `artFrame` | GENERATED from the master by `npm run art:encode` (`scripts/encode-card-art.ts`) — never hand-authored, never committed by hand. 1024 is 2.4× the tallest real draw (427 design px). Texture key: `card-art:<skill_id>`. **Not loaded at boot**: `cardArtLoader.ts` streams it on first use. |

Deprecated once V2 assets land: `card-template-parts.png`,
`card-template-parts-transparent.png` (monolithic sheets), the
suffixed card-art file names, and the procedurally drawn badge fallbacks in
V1. Missing card art falls back to `cardArtPlaceholder.ts` — the card's own
identity colour washed over the panel navy with its type badge ghosted in,
NOT a neutral matte — and so does art that is still streaming, deliberately:
"no art yet" and "art not here yet" must not be two different looks. Never a
differently-positioned layout either way.

Sizes here must equal `FANTASY_CARD_ASSET_RULES` (display-size values); update
both together. Ready-to-use AI generation prompts (per-icon and sprite-sheet
workflows, plus the mechanical crop/recenter commands) live in
[`icon-generation-prompts.md`](icon-generation-prompts.md).

---

## 5. Typography

Two faces only, both defined in `src/game/theme.ts` (`FONT`) — never inline a
font family in the template:

- **Display** (`FONT.display`, serif): card title, weight number.
- **Body** (`FONT.body`, humanist sans): rules text, slot label.

Text over art or plates always carries a dark stroke for contrast — that is
the template's legibility guarantee, not a per-card choice.

| Role | Face / weight | Color / stroke | Align | Ladder (auto-fit, never moves the box) |
|---|---|---|---|---|
| Title | Display, bold | `#ffffff`, stroke `#111722` × 3 | center in `titleBox` | 24 pt / 1 line (≤14 chars) → 22 pt / 1 line (≤24) → 20 pt / 2 lines, line-spacing −5/−5/−6 |
| Body | Body, regular (keywords bold + semantic color, §5c) | `#f1efe8`, stroke `#111722` × 2 | left in `bodyBox`, top-anchored | 13 pt / 3 lines (density ≤90) → 12 pt / 4 (≤145) → 11 pt / 5; line-spacing +5/+4/+3. Density = `text.length + 28 × (effects − 1)`. |
| Weight marker | `WT` word: Body bold 9 pt `#f4ead0`; number: Display bold `#ffffff`, stroke `#111722` × 2 | — | left in `wtPlate` footer row, gap 8 | number: 15 pt (1 digit) → 13 pt (2) → 11 pt (3) |
| Slot label | Body, bold | `#f4ead0` | right-aligned in `slotLabel` (bottom-right, after the text block) | fixed 9 pt word + 12 pt box glyphs, gap 8 |

Ladder rules:

- Selection is **deterministic from the card data** (name length, text density,
  digit count) — implemented by `selectTitleRule` / `selectBodyRule` /
  `selectWtRule`. No measuring-then-nudging.
- Point sizes scale by the same uniform card scale as geometry, floored at
  13 pt title / 8 pt body-equivalent legibility at the 720×1280 canvas.
- If a card's text cannot fit 5 lines at the smallest body step, the **card
  text is too long — fix the text** (style guide caps at two sentences), not
  the template.

---

## 5b. Glossary interaction (hover / tap explanations)

Every identity element on the card is a teaching surface: hovering or tapping
it shows a plain-language explanation the printed text can't fit.

- **Zones** (exactly the region rects — no separate hit boxes): `typeBadge`
  (element wheel / weapon triangle / property matchup), each archetype badge,
  `wtPlate` (readiness cost), `slotLabel` (board footprint + spell span), and
  `bodyBox` (glossary of every mechanical keyword the card's effects use —
  poison vs burn, stun, guard, negate, riders…).
- **Tip panel**: rendered in the `glossaryTip` region (20, 704, 380, 180) —
  **below the card silhouette**, top-anchored and growing downward, so
  explanations never cover any part of the card. Title 13 pt gold caps, body
  11 pt (`glossaryText`).
- **Copy source**: `src/game/ui/cardGlossary.ts` — pure text derived from the
  engine's locked mechanics; keep wording in sync with
  `docs/card-text-style-guide.md` §1.

## 5c. Keyword markup in card text (`{{verb}}`)

Card `text` in `src/data/content/skills.v1.json` (see its README) may wrap a
mechanical verb in double
braces: `'Deal Fire damage +42 (+Magic Power) · {{Burn}} 5 (3 turns).'`

- **Authoring**: the braces carry no engine meaning; the display keeps the
  author's casing, the keyword id is the lowercased content. Only mark real
  mechanical verbs (poison, burn, stun, guard, negate, cleanse, shield,
  lifesteal, stagger, slow, combo, shatter, thorns, true).
- **Clause-aware wrapping**: the body is laid out word-by-word with clause
  grouping — text between ` · ` separators is one clause, and a clause that
  would straddle a line break moves to the next line whole (it only splits
  internally when longer than a full line). Related text like
  `-25% enemy Attack (2 turns)` never separates from its numbers.
- **Template rendering**: the V2 body lays text out word-by-word so marked
  keywords render **bold in their semantic color**
  (`KEYWORD_TEXT_COLOR` in `src/game/ui/cardTextMarkup.ts`); every keyword in
  the data must have a color there (enforced by
  `tests/game/cardTextMarkup.test.ts`).
- **Plain renderers** (log, list rows, detail panels) must strip the braces
  via `stripCardTextMarkup` — braces must never reach the player raw.
- The number drift-guard test ignores markup (it only extracts digits), so
  data numbers stay enforced.

## 6. Tier system

Tier appears in exactly three places: the **thin trim line** on the card
silhouette, the **tier diamond** in the footer row, and the **divider** color.
Everything else — art, scrim, badges, text — is tier-agnostic. Tier colors are
the canonical skin values in `fantasyCardTierSkins.ts` (aligned with
`TIER_COLOR` in `theme.ts`); tier variants differ **only** in color, never in
geometry.

---

## 7. Verification checklist (every template change)

1. `tests/game/fantasyCardTemplateSpec.test.ts` +
   `fantasyCardTemplateModel.test.ts` green (`npm test`).
2. `npm run typecheck` and `npm run build` clean.
3. Eyeball `?view=template` at 720×1280 across: shortest + longest card name,
   1/2/3-slot cards, 1–3 archetypes, all four tiers, a card with no art
   (fallback matte), and 1/2/3-digit weights.
4. Grep the renderer for banned patterns: any identifier matching
   `offset|nudge|ByTier.*x:|centerOffset` in layout code is a review blocker.
5. Log the change in `docs/codex-handoff.md`.
