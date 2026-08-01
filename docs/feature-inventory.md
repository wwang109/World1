# Feature Inventory — per-page checklist

The authoritative list of what every screen DOES. **Check this before and
after touching a scene: nothing on this list may silently disappear.** When a
feature is added/changed, update this file in the same commit. Gaps are listed
explicitly as `[ ]` so "missing" is always distinguishable from "regressed".

Legend: `[x]` built and verified · `[ ]` known gap (intentional, not a
regression) · **D** desktop (1440×900) · **M** mobile (412×892).

Launch routes: `?scene=desktop-prep|desktop-deck|desktop-wiki|desktop-battle|desktop-shop|desktop-draft|desktop-runmap|desktop-runprep`
· `?scene=mprep|mdeck|mwiki|mbattle|mobile-shop|mobile-draft|mrunmap|mrunprep` · extras: `seed`,
`enemy`, `enemies`, `title`, `rank`, `enemyLevel`, `heroLevel`,
`mods=diamond,swift`, `board=empty`, `gold` (starting wallet, clamped 0..999).

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
| Gold payout (`battleGoldReward`, base + win bonus) shown in the banner, credited exactly once per fetched result | [x] | [x] |
| PREP / REPLAY / END controls | [x] | [x] |
| Per-step redraw destroys old objects (no texture leak) | [x] | [x] |

## SHOP (D: `DesktopShopScene` · M: `MobileShopScene`)

| Feature | D | M |
|---|---|---|
| Storefront picker: 5 themed shops (name + tagline), tap to browse | [x] | [x] |
| Shelf view: up to 4 card offers (CardToken) + 3 gem offers, gold price tags | [x] | [x] |
| Gold balance always visible in the header | [x] | [x] |
| Tap a card/gem → inspect/detail overlay (mirrors Wiki detail) with a BUY button | [x] | [x] |
| BUY → confirm dialog (mirrors deck-build trash-confirm) → deducts gold, lands the card in the bag (nearest-fit, respects capacity) or gem in the pouch; offer leaves the shelf (finite stock) | [x] | [x] |
| Can't-afford / bag-full → BUY disabled/dimmed, no dead taps | [x] | [x] |
| REROLL (costs 1 gold) → a brand-new shelf from a deterministic seed sequence (`rollShopStock(shopId, baseSeed + rerollCount)`) | [x] | [x] |
| Nav tabs PREP / DECK / WIKI / SHOP / DRAFT | [x] | [x] |

## DRAFT (D: `DesktopDraftScene` · M: `MobileDraftScene`)

| Feature | D | M |
|---|---|---|
| 4 sets of 5 bronze cards (`rollStartDraft`): OFFENSE / DEFENSE / SUPPORT / WILDCARD | [x] *(all four rows at once)* | [x] *(one set at a time, SET n/4 + BACK/NEXT)* |
| Tap a card to pick it for its set; changeable any time before START | [x] | [x] |
| START (enabled only once all 4 sets are picked) replaces the board/bag with the 4 picks and zeroes gold, then goes to Prep | [x] | [x] |
| Nav tabs PREP / DECK / WIKI / SHOP / DRAFT | [x] | [x] |

## RUN MODE (D: `DesktopRunMapScene`/`DesktopRunPrepScene` · M: `MobileRunMapScene`/`MobileRunPrepScene`)

Reuses the Draft/Shop/Battle scenes above IN RUN CONTEXT (discriminated by
the active run's own state — `isRunDrafting()`, `currentNode()?.kind`,
`getBattleContext()` — never a duplicated scene). See
`docs/release-game-plan.md` / `docs/run-shops-design.md`.

| Feature | D | M |
|---|---|---|
| RUN MAP: START A NEW RUN panel (seed + REROLL) when no run is active | [x] | [x] |
| RUN MAP: node trail (fight/elite/shop/boss columns), pick 1 of 2-3 next nodes | [x] | [x] |
| RUN MAP: shop node choice panel shows its theme name ("SHOP · Arcanum") | [x] | [x] |
| RUN MAP: fight/elite node choice panel previews the rolled foe (name/LV/title) | [x] | [x] |
| **SHARED RUN HUD** (`renderRunHud`, `src/game/ui/RunProgressStrip.ts` + `runScreenTemplate.ts`): IDENTICAL header on every run screen (map/prep/event/shop/draft/deck-build in run context) — kicker+title, ONE always-on stats strip `DAY n · WAVE n · GOLD g · LV n · LIVES n · BOSSES n` (unbounded, LIVES reads danger-red at 1), banked-PL badge in its own slot, and a fixed 4-role action row (back/secondary=DECK·BAG/tertiary=RETIRE/primary=FIGHT·START·CONTINUE›·LEAVE SHOP) — every role sits in the SAME rect on every screen regardless of which roles a given screen uses (empty slots stay empty, never reflowed into) | [x] | [x] |
| RUN MAP: `'defeat'`/`'retired'` end-summary banner (bosses cleared/days survived/gold/hero LV/W-L) + NEW RUN — `'victory'` (legacy, engine never sets it) is no longer handled | [x] | [x] |
| RUN MAP: a fresh run (status `drafting`) routes straight to the Draft scene in run context | [x] | [x] |
| DRAFT (run context): same 4-set UI as Sandbox; shares the HUD's kicker/title/stats (no DECK/BAG or RETIRE slot yet — the run is still `drafting`); START installs picks via `applyRunDraft` (not `demoState`) and routes to the run map | [x] | [x] |
| RUN PREP (reached by picking a fight/elite/boss node): read-only rolled foe (title chip/LV/stat sheet/tier-resolved skill board, no dials/foe picker/+FOE), read-only YOUR DECK column; FIGHT is the HUD's fixed primary action (no ‹ MAP — the node is committed) | [x] | [x] |
| BATTLE (run context): FIGHT launches the existing Battle scenes against the run's current node (`battleContext.ts` source discriminator, not a forked scene) | [x] | [x] |
| BATTLE (run context): on result, gold = `battleGoldReward` on a WIN, 0 on a LOSS (run rule — sandbox's loss-still-pays-base is unchanged), credited exactly once per fetched result via `resolveRunBattleResult` | [x] | [x] |
| BATTLE (run context) banner buttons: REPLAY + CONTINUE › (map, or the end-summary banner the map scene already renders if lives hit 0) — no PREP/END; Battle itself does NOT yet carry the shared HUD (autoplay screen, out of scope for the HUD unification pass — see `phaser-ui-programmer` deviations) | [x] | [x] |
| SHOP (run context): picking a shop node opens a SINGLE storefront (no 5-shop picker) stocked via `rollShopStock(shopId, shopSeed, depth)`, wallet = run gold, purchases land in `RunState` (bag/gems); LEAVE SHOP is the HUD's fixed primary action | [x] | [x] |
| Shop theme bag: no-repeat-until-all-5-seen per run (draw-without-replacement, reshuffled when empty) | [x] | [x] *(shared `runMap.ts` logic)* |
| Shop stock tier split shifts with node depth (1-3: 70/25/5 · 4-6: 45/45/10 · 7-9: 25/55/20; sandbox callers omit depth, unchanged 70/25/5) | [x] | [x] *(shared `run/shop.ts` logic)* |
| DECK / BAG entry point (HUD secondary slot, every run screen) opens the shared Deck Build scene in RUN CONTEXT (`deckBuildContext.ts` source discriminator, mirrors Shop/Draft/Battle) — reads/writes the run's `pieces`/`bagSlots`/`gemInventory` via `runStore`, not `demoState`; Deck Build's own HUD uses the `back` role ("‹ MAP") instead of primary | [x] | [x] |
| RETIRE (HUD tertiary slot, every active-run screen) → confirm dialog (`renderRetireConfirm`) → `retireActiveRun()` (`src/run/runState.ts#retireRun`) → routes to the Run Map's end-summary banner | [x] | [x] |
| Fog-of-war zone map, multiple zones, meta persistence | [ ] *(out of scope for v1, see release-game-plan.md)* | [ ] |
| WAVE-shaped map: shared DAY/WAVE progress strip, alternating route/day bands with audited WAVE and depth labels, plus MANDATORY tag on single-node fight/boss columns | [x] | [x] |
| Map planner: visible CHOOSE YOUR NEXT STOP heading above compact content-fit choice rows — kind + theme title, one-line hint (shop: tagline + shelf shape "N cards/N gems"; event: theme; fight/boss: enemy · LV n · TITLE), SELECT affordance when available, and dimmed LOCKED when unavailable | [x] | [x] *(event theme label pending `src/data/events.ts` `theme` field — TODO left in both map scenes)* |
| EVENT nodes (`DesktopRunEventScene`/`MobileRunEventScene`, `?scene=desktop-runevent` / `mrunevent`): shared Run Mode status chrome and DECK / BAG access; visible EVENT SELECT hierarchy; title/body panel; 2-3 cost + reward-hint choice rows with SELECT / dimmed LOCKED affordances; outcome panel showing the granted card/gem token or gold/level result (`fellBack` note on a full bag); `bonusDraft` opens a single-set CardToken picker row (1-5 cards) before its own outcome; CONTINUE › back to the map | [x] | [x] |
| Picking an event node now routes to the RunEvent scene (`runStore.pickNode` no longer auto-resolves it) | [x] | [x] |
| STAT / LEVEL allocation panel (`RunStatPanel.ts`, shared builder): priced HP/ATK/MAG/DEF/RES/SPD grid via `LEVEL_STAT_COST`, CONFIRMABLE SCRATCH EDIT — +/− steppers operate on a local uncommitted allocation (PL SPENT/BANKED updates live), CONFIRM commits via `commitHeroAllocation` (`runState.ts#setHeroAllocation`), CANCEL discards; nothing is written to the run until CONFIRM | [x] | [x] |
| Panel reachable from the shared HUD's badge slot on EVERY run screen via a pulsing "n PL TO SPEND" badge (`renderBankedPlBadge`), hidden when no PL is banked | [x] | [x] |
| Hover/tap explanations (`ui/hoverTip.ts`): hero/foe STAT labels (battle statlines, Run Prep foe panel, stat allocation grid) explain what each stat does; the battle turnline explains turn-order math; HIT/DEBUFF/BUFF rows with D: math show "how this was reached" (reads the already-formatted log string, never recomputes); GEMS (pouch, socket panel, event reward chip) show effect text/rarity/+PL (`ui/gemGlossary.ts`) | [x] | [x] |
| Draft cards / shop shelves / event card grants advertise a size-N card's board footprint with a "×N SLOTS" badge (`CardToken`, shown whenever no slot is yet assigned) — a player can never draft/buy a multi-slot card unaware | [x] | [x] |
| Post-battle (run context): banner shows "LEVEL UP → LV n · m PL BANKED" alongside the gold payout (the hero levels after every fight, win or lose) | [x] | [x] |
| Variable-size shop shelves: 1-6 card/gem offers lay out without dead gaps; a shop with 0 cards or 0 gems skips that row cleanly; `shopPoolInfo` (`src/run/shop.ts`) caps slot counts at the theme's whole pool and flags `fullStock` (both axes fit the shelf) so REROLL is hidden/relabeled "FULL STOCK" instead of inviting a wasted gold | [x] | [x] |

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
