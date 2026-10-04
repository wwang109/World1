# Card Template Implementation Workflow

Scope: the staged process and drift checks for implementing the proposed card
redesign. Geometry, assets, and typography remain owned by
[card-template-spec.md](card-template-spec.md) and its canonical code modules.
The Anime Relic mockup direction was selected on 2026-10-03. The rendered
candidate still needs visual confirmation; `classic` remains the game default.

## 1. Make the design concrete

Review the reusable master, populated cards, all four tiers, and desktop/mobile
captures in [the workbench](mockups/card-template-workbench.html).

Settle the frame treatment, artwork crop, title/rules regions, badge sizes,
typography ladders, tier treatment, and upgrade-progress placement. The workbench
uses the real Phaser renderer, generated rules, actual badge count, and the
instance-progress model. Affinity and Timing rows appear only when generated
for the selected card; no category is a mandatory fixed row.

Design acceptance records the exact reference files and their SHA-256 hashes.
Existing workbench screenshots are candidates, not accepted goldens. Keep the
accepted files immutable; later candidates get new names.

## 2. Freeze one machine-readable contract

Implement the approved geometry in
`src/game/ui/fantasyCardTemplateSpec.ts`, asset constraints in
`src/game/ui/fantasyCardAssetRules.ts`, and tier tokens in
`src/game/ui/fantasyCardTierSkins.ts`. Update their human-readable owner,
`docs/card-template-spec.md`, in the same change.

Every region, padding, ornament placement, font step, and crop anchor belongs in
the contract. The renderer reads those values. No per-card or per-tier position
adjustments, independent X/Y scaling, or scene-specific copies of the frame.
Tier variants share geometry and change the approved color tokens only.

Record the approved replacement of the previous full-bleed design in
`docs/design-locked.md` when that replacement is accepted. Merely creating this
workflow does not supersede the existing ruling.

## 3. Build reusable visual parts

Generate or author the frame, ornaments, and any plate textures as separate
parts with the contract's dimensions and transparent padding. Approve each
shared part once. Store its path, dimensions, and hash with the reference.

Card illustrations remain independent of those parts. Image generation supplies
artwork or ornament textures; the renderer supplies titles, generated rules,
badges, weight, slots, tier, and real upgrade progress. Text and mechanics are
never baked into a generated card image.

Use the existing art master/derivative pipeline from `card-template-spec.md`.
Changing a shared part creates a new visual candidate rather than overwriting an
accepted asset invisibly.

## 4. Implement through the real renderer

Modify the existing `src/game/ui/FantasyCardTemplateV2.ts` in stages: silhouette
and frame, artwork/crop, badges, title/rules, then footer/progress and glossary
hit regions. Continue reading `buildFantasyCardTemplateModel`; preserve its
generated body, slot count, tier-resolved weight, badge identities, and progress.

Replace the workbench's duplicate HTML card drawing with a preview of that same
Phaser component. The controls can remain HTML. The master and populated
previews must read the same contract and render path as production.

At each stage, capture the same fixtures and compare with the frozen design.
Do not compensate for an incorrect asset with a renderer offset. Make any
necessary departure visible in a named candidate and explain its cause.

## 5. Add repeatable drift checks

Extend the existing audit tooling, without adding test files, to produce these
checks. These extensions are planned, not implemented by this document.

| Check | Failure condition |
|---|---|
| Contract | Region or typography values appear in renderer/scene copies rather than the canonical contract; tier changes move regions. |
| Assets | Missing files, wrong canvas dimensions, or unrecorded hash changes. |
| Content | Card face differs from the canonical model; badges/slots/weight/progress are missing; long text overflows without an explicit cue. |
| Geometry | Rendered region edges differ from the contract after uniform scaling; text or hit regions overlap reserved areas. |
| Visual | The same fixture's card crop differs from its accepted production-renderer screenshot outside the agreed tolerance. |

Visual comparisons use a pinned browser, fonts, viewport, device-pixel ratio,
fixture data, scale, and loaded-art state. Disable animation and wait for fonts
and textures. Compare the card crop, not the surrounding page. Establish the
pixel tolerance by capturing the unchanged fixture twice; report the difference
image as well as the score. Never automatically bless a failing capture.

Separate fixed visual fixtures from live-catalog checks: content updates should
not rewrite the design baseline. The fixed fixtures use model snapshots saved
at acceptance; the live sweep resolves the current book and every tier.

The fixture manifest must include short/long titles, sparse/dense rules, 1-3
slots, 1-3 archetypes, all tiers, all available weight-digit lengths, artwork
present/fallback, and valid progress states including Diamond. Synthetic edge
cases are marked as layout fixtures, never passed off as catalog cards.

## 6. Verify in actual game surfaces

First prove the shared renderer in Wiki at `?scene=desktop-wiki` (1440 x 900)
and `?scene=mwiki` (412 x 892). Then check its actual sizes and interactions in
hover/details, Deck Build, Draft, and Shop on both platforms, using the routes
owned by `docs/ui-workbook.md`.

Run `npm run audit:cardface` and `npm test`. Preserve existing truncation cues
and full-text access; do not loosen audit limits just to obtain a pass. Check
the new drift audit once implemented. A passing existing audit does not by
itself prove fidelity to the reference.

Attach desktop/mobile screenshots and reference-versus-result comparisons.
Report technical verification separately from user visual acceptance. Compact
`CardToken` rows are a separate visual scope and are not silently restyled.

## 7. Keep changes explicit after acceptance

Any future change to contract values, shared assets, typography, crop policy,
or tier styling produces a before/after candidate and reruns the fixture checks.
The accepted baseline is updated only after the user accepts that visual change.

Routine card-data changes use the existing template and live-catalog checks.
They do not trigger redesign or per-card layout patches. Preserve unrelated
shared-checkout work; commit, push, and deploy require the user's authorization.

## Current State

- Built: shared-renderer workbench, switchable candidate, categorized rules,
  and Claude's display typography/centering changes.
- Selected direction: illustrated Anime Relic top header, open upper/middle
  art, lower rules panel, dynamic type/archetype icons and footer.
- Source reference: `art-src/template-references/anime-relic-approved-layout.png`.
- Reusable chrome master: `art-src/templates/anime-relic-chrome.png`; derivative:
  `public/game-art/template/anime-relic-chrome.webp`.
- Encode only this group with `npm run art:encode -- --group templates`.
- Pending: rendered visual acceptance and default switch. No rollout,
  publication, or design-locked default decision is implied by the mockup.

## V2 Candidate Build Plan

User request: build a switchable V2 candidate, including separate rules rows.
Keep the existing default until visual acceptance.

- [x] Add `classic` / `printed-v2` layout selection and a printed contract in
  `fantasyCardTemplateSpec.ts`; preserve the current exported classic contract.
- [x] Expose typed clause metadata from the existing composer without changing
  generated wording or order; project each clause into a categorized face row.
- [x] Teach the existing `FantasyCardTemplateV2` renderer both contracts. Keep
  existing call sites and use one shared default plus a URL preview override.
- [x] Replace HTML card drawing in the workbench with the real Phaser renderer.
- [ ] Verify all card/tier text against a pre-change snapshot, region/text bounds,
  ellipsis cues, both viewports, preview switching, and `npm test`.

No test files, unrelated edits, commits, or deployment. Compact board tokens
keep their established presentation. Verification does not mark the candidate
visually accepted or change the default.
