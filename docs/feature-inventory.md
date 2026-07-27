# Feature Inventory — per-page checklist

The authoritative list of what every screen DOES. **Check this before and
after touching a scene: nothing on this list may silently disappear.** When a
feature is added/changed, update this file in the same commit. Gaps are listed
explicitly as `[ ]` so "missing" is always distinguishable from "regressed".

Legend: `[x]` built and verified · `[ ]` known gap (intentional, not a
regression) · **D** desktop (1440×900) · **M** mobile (412×892).

Launch routes: `?scene=desktop-prep|desktop-deck|desktop-wiki|desktop-battle`
· `?scene=mprep|mdeck|mwiki|mbattle` · extras: `seed`, `enemy`, `enemies`,
`title`, `rank`, `enemyLevel`, `heroLevel`, `mods=diamond,swift`, `board=empty`.

---

## PREP (D: `DesktopPrepScene` · M: `MobilePrepScene`)

| Feature | D | M |
|---|---|---|
| Foe chips (up to `MAX_FOES` = 5), click to select the foe being edited | [x] *(grid goes 2→3 columns past 4 cells)* | [x] *(2-per-row grid)* |
| Swap foe: click the ACTIVE chip → roster picker overlay | [x] | [x] |
| + FOE: add another enemy via roster picker (to 5) | [x] | [x] |
| ✕ remove a foe (shown with 2+ foes) | [x] | [x] |
| Enemy stat sheet (HP/SPD/ATK/MAG/DEF/RES · cards) for the active foe | [x] | [x] |
| Live DMG/turn band (`damagePerTurn`) | [x] | [x] |
| Title chips mob/normal/elite/boss (sets preset rank) — per foe | [x] | [x] |
| Modifier chips (DIAMOND-POWERED, SWIFT…) — per foe, multi-select | [x] | [x] |
| Enemy LV stepper — per foe | [x] | [x] |
| RANK stepper: shows RESOLVED rank, caps at deckSize×3, inert + labeled when a tier-forcing modifier owns it | [x] | [x] |
| Hero LV stepper + PL SPENT/BANKED readout | [x] | [x] |
| Hero stat allocation grid (HP/ATK/MAG/DEF/RES/SPD, priced buys, disabled when unaffordable, auto-trim on level-down) | [x] | [x] |
| YOUR DECK column (real resolved deck, live stat scaling) | [x] | [x] |
| ENEMY SKILLS board(s) — tier-resolved cards | [x] *(2 foes stack; 3+ = tab per foe)* | [x] *(active foe, named `· n/N`; the foe chips are the selector — two stacked 10-slot boards don't fit 412×892, see MobilePrepScene comment)* |
| SEED display + deterministic REROLL | [x] | [x] |
| FIGHT → battle scene | [x] | [x] |
| Control changes re-render in place — ONE idiom, both platforms (`sceneRebuild.ts`: clears tweens/timers/scene-level input listeners, keeps class fields, no blank frame) | [x] | [x] |
| Nav tabs PREP / DECK BUILD / WIKI | [x] | [x] |

## DECK BUILD (D: `DesktopDeckBuildScene` · M: `MobileDeckBuildScene`)

| Feature | D | M |
|---|---|---|
| ACTIVE DECK (10 slots) vs BAG (10 slots), size-N cards span N rows | [x] | [x] |
| Pointer drag-and-drop between deck/bag (pure `run/loadout.ts` placement) | [x] | [x] |
| Drag ghost: dimmed copy + dashed outline stays in the source slot | [x] | [x] |
| Gold drop-hint on the hovered row | [x] | [x] |
| TEMP HOLDING parking slot | [x] | [x] |
| TRASH drop zone + confirm dialog (CANCEL/DELETE) | [x] | [x] |
| Deck identity / affinity pips (3-to-unlock) | [x] | [x] |
| Hero meta line (LV · stats · slots · PL · gems) | [x] | [x] |
| Gem-socketed cards show a ◆ badge (CardToken accessory rail) | [x] | [x] |
| Gem socket/swap/unsocket panel — CLICK a deck card (drag still drags); pouch list, rarity/PL, displaced gems return to pouch | [x] | [x] *(TAP opens it)* |
| TEMP HOLDING + trash-confirm survive the post-drop re-render | [x] | [x] |

## WIKI (D: `DesktopWikiScene` · M: `MobileWikiScene`)

| Feature | D | M |
|---|---|---|
| Full card catalog (all 36), alpha-sorted | [x] | [x] |
| CARDS / GEMS view tabs | [x] | [x] |
| GEMS: full 12-gem catalog (rarity color, kind, +PL, text) + detail + ADD TO POUCH | [x] | [x] |
| Tier selector (BRONZE→DIAMOND) in the detail: previews scaled card/PL/text, ADD TO BAG stamps the chosen tier | [x] | [x] |
| ALL / WEAPON / MAGIC filter chips + honest count label | [x] | [x] |
| Scrollable masked grid (drag; D also mouse-wheel) + scroll indicator | [x] | [x] |
| Card art follows the card while scrolling (V2 mask tracks setPosition) | [x] | [x] |
| Click card → detail (large card render, PL·tier, markup-stripped text) | [x] | [x] |
| ADD TO BAG (size-aware nearest-fit insert) + toast, bag-full case | [x] | [x] |
| Badge/keyword glossary on hover/tap (FantasyCardTemplateV2) | [x] | [x] |
| Card art for every card | [ ] *(twin_slash has no PNG yet)* | [ ] *(same)* |
| BALANCE / BUFFS / DEBUFFS / opponents / template subtabs | [ ] *(legacy PrepScene wiki only)* | [ ] |

## BATTLE (D: `DesktopBattleScene` · M: `MobileBattleScene`)
Both are dumb playback heads over the shared `battleTimeline.ts` model
(one `simulate()` run; scenes never compute combat).

| Feature | D | M |
|---|---|---|
| Multi-foe: fights every `demoState.enemyTeam` entry (verified to 5v1) | [x] | [x] |
| START baseline step — playback opens at full HP before any event | [x] | [x] |
| Per-foe HP bars (tween, shake, shield strip, ailment tint + pips) | [x] | [x] |
| Per-foe enemy boards, gold cursor on the casting card, cast pulse | [x] | [x] |
| Hero statline visible in battle (ATK/MAG/DEF/RES/SPD incl. allocation) | [x] | [x] |
| Foe statline under each foe's bar | [x] | [x] |
| Combat log: tag colors, turn markers, turnline with every unit's SPD | [x] | [x] |
| Tap a HIT row → expand its D: damage math | [x] | [x] |
| Floating damage/heal/shield numbers (DoT ticks in ailment colors) | [x] | [x] |
| Event-level scrubber (D: horizontal · M: vertical), turn ticks, drag stops playback | [x] | [x] |
| Auto-playback 450ms/step (160ms after DOWN) | [x] | [x] |
| Playback speed control ×½ / ×1 / ×2 (persists across REPLAY) | [x] | [x] |
| Victory/defeat banner + compact BATTLE LEDGER card output summary | [x] | [x] |
| PREP / REPLAY / END controls | [x] | [x] |
| Per-step redraw destroys old objects (no texture leak) | [x] | [x] |

## Shared systems (engine/run/data — not screens, but what screens rely on)

- Deterministic `simulate(config, seed)`; 100-config determinism + balance audit tests.
- Encounter dials: base monster + Title (mob/normal/elite/boss) + Level + Rank
  (tier-steps, cap deckSize×3) + Modifiers (`MODIFIER_PRESETS`: `diamond`
  forces all cards Diamond & pins rank; `swift` +8 PL of Speed via the priced
  economy; unknown ids throw).
- Unified PL leveling economy (3 PL/level; priced `LEVEL_STAT_COST`; monsters
  auto-spend by profile, the player spends by hand via `heroAllocation`).
- Disrupt pricing: escalating brackets (pts 1-5: 5 deci · 6-10: 15 · 11-15: 30 ·
  16+: 60) — magnitudes above 10 are deliberately unaffordable.
- Card presentation: `cardTokenSpec.ts` (strip token regions + accessory rail)
  and `fantasyCardTemplateSpec.ts` (full card) are the ONLY geometry sources.
- Tier-up honesty: `applyTier`'s auto-scale path rewrites changed numbers in
  the display `text` (authored `tierUpgrades` carry their own text) — locked
  by `tests/engine/tierText.test.ts`.
- `demoState.enemyTeam` is the fight roster; singular `enemyId/…` fields always
  mirror `enemyTeam[0]` (`syncPrimaryFoe()` after every team mutation).
