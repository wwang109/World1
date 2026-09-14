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
| RANK stepper: shows RESOLVED rank, caps at deckSize×3, inert + labeled when a custom deck, a tier-forcing modifier, or growth alone (`RANK · GROWN +n · MAX c`) pins it — one shared `rankStepperLabel`, both scenes | [x] | [x] |
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
| Deck affinity pips (3-to-unlock), ONE ROW PER DEFENSIVE AXIS — a 3-fire + 3-sword deck shows FIRE and SWORD. Separately, every type at 3 independently activates its matching gated card effects, including same-axis ties (`docs/board-type-identity.md`) | [x] | [x] |
| Hero meta line (LV · stats · slots · PL · gems) | [x] | [x] |
| Gem-socketed cards show a ◆ badge (CardToken accessory rail) | [x] | [x] |
| Gem socket/swap/unsocket panel — CLICK a deck card (drag still drags); pouch list, rarity/PL, displaced gems return to pouch | [x] | [x] *(TAP opens it)* |
| TEMP HOLDING + trash-confirm survive the post-drop re-render | [x] | [x] |

## WIKI (D: `DesktopWikiScene` · M: `MobileWikiScene`)

| Feature | D | M |
|---|---|---|
| Full card catalog (all 183 current `skillBook` entries), alpha-sorted | [x] | [x] |
| Card body GENERATED from `effects` (`renderSkillText`) — no authored `text` field anywhere; keyword mechanism lives once, in the registry, reached by tap/hover | [x] | [x] |
| Overflowing body ends in an ellipsis, never a silent cut (`FantasyCardTemplateV2.makeBody`) — the 140/150px card holds two lines at the font floor, so roughly half the catalog is cued there. **`npm run audit:cardface` owns the counts** (`CARD_WIDTHS`); it fails if any overflow goes uncued, or if the count creeps above its recorded mark | [x] | [x] |
| CARDS / GEMS view tabs | [x] | [x] |
| GEMS: full gem catalog (every `gemBook` entry — 53 at last count; rarity color, kind, and the gem's GENERATED face via `renderGemText`) + detail pane, which also prints the definitions its keywords/stats open (`gemDefinitionsText`) + ADD TO POUCH | [x] | [x] |
| Tier selector (BRONZE→DIAMOND) in the detail: previews scaled card/PL/text, ADD TO BAG stamps the chosen tier | [x] | [x] |
| ALL / WEAPON / MAGIC filter chips + honest count label | [x] | [x] |
| Scrollable masked grid (drag; D also mouse-wheel) + scroll indicator | [x] | [x] |
| Card art follows the card while scrolling (V2 mask tracks setPosition) | [x] | [x] |
| Click card → detail (large card render, PL·tier, markup-stripped text) | [x] | [x] |
| Detail: keyword DEFINITIONS first, then generic card metadata + full generated body (`renderCardInfoBox` → `cardGlossaryEntries`, scrollable); all bodies come from the canonical registry | [x] | [x] |
| ADD TO BAG (size-aware nearest-fit insert) + toast, bag-full case | [x] | [x] |
| Badge/keyword glossary on hover/tap (`FantasyCardTemplateV2`'s own `glossary` option); combined desktop hover uses the same complete canonical keyword bodies as detail, includes statuses referenced by Exploit/Stack Bonus, keeps AFFINITY separate, and creates no ATK/MATK/stat-suffix entry | [ ] *(token-local glossary remains disabled; combined hover/detail routes provide definitions)* | [ ] *(tap-to-inspect detail uses the same canonical keyword entries)* |
| Card art for every card | [x] *(183/183 catalog entries with canonical PNG masters and served WebP derivatives)* | [x] *(same shared catalog)* |
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
| Combat log: unchanged tag/header colors plus semantic body spans for player/enemy names, direct/ailment damage, healing, shield results, SPD and BANKED readiness; turn markers and turnline with every unit's SPD | [x] | [x] |
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
| Sandbox storefront picker: all 21 themed shops (name + tagline + stock counts), tap to browse; desktop pages the authored order 8/8/5 in a four-column, two-row layout while mobile independently pages it 6/6/6/3 in a two-column, three-row layout; both use minimum-40px pager controls | [x] | [x] |
| Shelf view: theme-sized stock capped to the real pool, up to 6 card offers (CardToken) + up to 6 gem offers, with gold price tags | [x] | [x] |
| Gold balance always visible in the header | [x] | [x] |
| Tap a card → **Card Details** modal with the full card, generated kit text, and keyword definitions from `renderCardInfoBox`; its BUY action leads to the existing BUY/MERGE confirmation. Desktop uses the reclaimed width for shelf + owned columns instead of reserving a permanent right inspect dock. A vertical swipe that starts over shelf card art scrolls the shelf without moving the card image; lateral drag-to-buy remains available. Gem and owned-card details retain their modal information paths. | [x] | [x] |
| BUY → confirm dialog (mirrors deck-build trash-confirm) → deducts gold, lands the card in the bag (nearest-fit, respects capacity) or gem in the pouch; offer leaves the shelf (finite stock) | [x] | [x] |
| Can't-afford / bag-full → BUY disabled/dimmed, no dead taps | [x] | [x] |
| REROLL → a brand-new same-theme shelf from the deterministic seed-plus-reroll sequence; Sandbox is free with its unlimited wallet, while Run Mode charges `rerollCostForNode` (`1 + rerollCount`, then wave-scaled) and shows `FULL STOCK` instead when the whole pool already fits | [x] | [x] |
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
| LANDING / FRONT DOOR (`StartScene`): full-bleed illustrated map; centered WORLD1 hierarchy; primary BEGIN/RESUME journey action; quiet SANDBOX route; conditional lifetime line; pending seed with >=44px REROLL target. Start opens the run Draft, Resume returns to the active Run Map, and Sandbox opens Prep. | [x] *(1440x900)* | [x] *(412x892)* |
| RUN MAP: expedition route through five-day regions; noncombat columns keep three event/shop choices with at most one shop, non-boss combat columns keep homogeneous EASY/MEDIUM/HARD, and boss columns have one mandatory destination. Internal `wave` state and map generation are unchanged. | [x] | [x] |
| RUN MAP: shop node choice panel shows its theme name ("SHOP · Arcanum") | [x] | [x] |
| RUN MAP: fight/elite node choice panel previews the rolled foe (name/LV/title) | [x] | [x] |
| **SHARED RUN HUD** (`renderRunHud`, `src/game/ui/RunProgressStrip.ts` + `runScreenTemplate.ts`): IDENTICAL header on every run screen (map/prep/event/shop/draft/deck-build in run context) — kicker+title, ONE always-on summary strip `STOP n · DAY n/5 · GOLD g · LIVES n · BOSSES n` on desktop (compact retains LV), and fixed back/secondary/tertiary/primary action slots (map: BAG, RUN LEDGER, RETIRE, unused primary; other screens retain their own role actions). Desktop places LV plus six player stats at the left and the action slots at the right of one shared middle row; banked PL appears as the LV cell's `+N` cue without changing Run/Bag spacing. Mobile retains its compact stacked header and PL badge. Every role sits in the SAME rect on every screen regardless of which roles a given screen uses (empty slots stay empty, never reflowed into). | [x] | [x] |
| RUN MAP: `'defeat'`/`'retired'` end-summary banner (bosses cleared/days survived/gold/hero LV/W-L) + NEW RUN — `'victory'` (legacy, engine never sets it) is no longer handled | [x] | [x] |
| RUN MAP: a fresh run (status `drafting`) routes straight to the Draft scene in run context | [x] | [x] |
| DRAFT (run context): same 4-set UI as Sandbox; shares the HUD's kicker/title/stats (no DECK/BAG or RETIRE slot yet — the run is still `drafting`); START installs picks via `applyRunDraft` (not `demoState`) and routes to the run map | [x] | [x] |
| RUN PREP (reached directly from non-boss combat selection, or via boss arrival's FACE THE BOSS): read-only rolled foe (title chip/LV/stat sheet/tier-resolved skill board, no dials/foe picker/+FOE), read-only YOUR DECK column; FIGHT is the HUD's fixed primary action (no ‹ MAP — the node is committed) | [x] | [x] |
| RUN PREP foe panel: `AFFINITY · <TYPE>` line, both axes joined when the board earns both (`boardAffinityHeadline`, board-derived only — `docs/board-type-identity.md`); mobile parity added 2026-09-06 (was desktop-only) | [x] | [x] |
| BATTLE (run context): FIGHT launches the existing Battle scenes against the run's current node (`battleContext.ts` source discriminator, not a forked scene) | [x] | [x] |
| BATTLE (run context): on result, gold = `battleGoldReward` on a WIN, 0 on a LOSS (run rule — sandbox's loss-still-pays-base is unchanged), credited exactly once per fetched result via `resolveRunBattleResult` | [x] | [x] |
| BATTLE (run context) banner buttons: REPLAY + CONTINUE › (map, or the end-summary banner the map scene already renders if lives hit 0) — no PREP/END | [x] | [x] |
| BATTLE HUD (2026-08-04 decision, `runScreenTemplate`'s `statsOnly` chrome + `renderRunStatsStrip`): run context draws ONLY the kicker + title('BATTLE') + the SAME always-on stats strip every other run screen shows — NO banked-PL badge, NO action-role buttons (battle keeps its own playback footer: REPLAY/speed/SUMMARY/CONTINUE›); Sandbox reserves the identical band but draws nothing in it, so board/log geometry never differs by context | [x] | [x] |
| SHOP (run context): picking a shop node opens a SINGLE storefront (no 5-shop picker) stocked via `rollShopStock(shopId, shopSeed, depth)`, wallet = run gold, purchases land in `RunState` (bag/gems); LEAVE SHOP is the HUD's fixed primary action | [x] | [x] |
| Shop theme bag: 21-theme draw-without-replacement sequence, preserving minimum-wave eligibility and reshuffling when empty | [x] | [x] *(shared `runMap.ts` logic)* |
| Shop stock tier split shifts with node depth (1-3: 70/25/5 · 4-6: 45/45/10 · 7-9: 25/55/20; sandbox callers omit depth, unchanged 70/25/5) | [x] | [x] *(shared `run/shop.ts` logic)* |
| DECK / BAG entry point (map HUD back slot; secondary slot on other supporting run screens) opens the shared Deck Build scene in RUN CONTEXT (`deckBuildContext.ts` source discriminator, mirrors Shop/Draft/Battle) — reads/writes the run's `pieces`/`bagSlots`/`gemInventory` via `runStore`, not `demoState`; Deck Build's own HUD uses the `back` role ("‹ MAP") instead of primary | [x] | [x] |
| RETIRE (HUD tertiary slot, every active-run screen) → confirm dialog (`renderRetireConfirm`) → `retireActiveRun()` (`src/run/runState.ts#retireRun`) → routes to the Run Map's end-summary banner | [x] | [x] |
| EVENT rung confirm-on-COST (2026-09-06 user ruling: confirm on anything that costs gold, cards, or gems — free rungs stay one tap): `mergeCards` (`ember_pit`/`ruined_anvil`) choice row states a COUNT only (`mergeRowPreviewText` → "SPENDS 3 CARDS · TAP TO SEE WHICH") plus a `COST 3 CARDS` footer (never `FREE`); tapping it is UNCONDITIONAL — it always opens `renderMergeConsumeConfirm`, naming every consumed card by name AND location (BOARD slot or BAG), before the trade resolves. Any OTHER rung with `cost > 0` gold opens `renderEventCostConfirm` ("SPEND N GOLD?" + the row's own reward hint) before `resolveCurrentRunEventChoice` runs. `sellGem` (`the_lapidary`/`flaw_finder`, footer `COST 1 GEM`) opens `renderSellGemConfirm` ("SELL <gem>?" + the gold it returns) AFTER the specific gem is picked in its picker, before the sale finalizes. CANCEL on any of the three returns to the rungs/picker with nothing resolved. | [x] | [x] |
| Fog-of-war zone map, multiple zones, meta persistence | [ ] *(future wish — see `docs/run-structure.md`)* | [ ] |
| EXPEDITION ROUTE: DAY 1–5 labels reset per region, absolute stop progress stays in the HUD, and days-until-boss copy reads from unchanged run facts. | [x] | [x] |
| RUN MAP biome identity: exact installed biome artwork; desktop uses a large region pane with lower-anchored name/lean/day/countdown copy and a distinct EXPLORE REGION footer, while compact uses a region summary and forecast sheet. Empty discoveries show NO DISCOVERIES YET. | [x] | [x] |
| Map planner: shared travel cards show actual event title/art from a read-only deterministic preview (exact art when available, theme fallback otherwise); selecting the same node/state commits the same event/version. Eligible legacy chains show concise earned-fact MET REQUIREMENTS receipts; unmet/unsupported/V3 requirements add no legacy receipt. Shop title/tagline/shelf and combat foe hints are preserved; enabled actions are CHOOSE EVENT › / TRAVEL HERE › for events, VISIT SHOP › for shops, INSPECT ENCOUNTER › for fights, and CONTINUE › then FACE THE BOSS › for the mandatory boss. Pending cards use `RETURN TO <KIND> ›`; disabled actions read LOCKED. | [x] | [x] |
| Pending event: its exact RETURN TO EVENT card occupies the route choice area and opens the existing event screen with its existing two or three outcomes; no event-to-combat outcome is added. | [x] | [x] |
| Mandatory boss arrival: committing the single day-5 boss opens installed region art with actual boss/region/level/title facts; FACE THE BOSS enters existing Run Prep, then Battle. Map re-entry reconstructs arrival from the committed node; there is no route-choice/cancel action. | [x] | [x] |
| RUN LEDGER: explicit map-header button on both profiles opens the existing stats overlay with unchanged calculations. EXPLORE REGION opens the current-band forecast; separate earned future MAP INTEL remains a desktop rail or compact scroll sheet. | [x] | [x] |
| Compact boot policy: 900×900 fine-pointer windows select mobile/compact; viewport width ≤900 and aspect ratio ≤1.25 apply after explicit UI/scene overrides. Resize requires reload to reselect; ordinary widescreen desktop and phone layouts remain supported. | [x] | [x] |
| EVENT nodes (`DesktopRunEventScene`/`MobileRunEventScene`, `?scene=desktop-runevent` / `mrunevent`): shared Run Mode status chrome and DECK / BAG access; visible EVENT SELECT hierarchy; title/body panel; discovered non-common rarity; `THE WORLD REMEMBERS` recap for satisfied prior-choice chains (never leaks unmet secret requirements); 2-3 cost + typed reward-hint choice rows with SELECT / dimmed LOCKED affordances. While choices are open, the same shared row presentation adds at most one graph-derived, spoiler-safe `MAY CONTINUE THIS STORY` (callback producer) or `MAY UNLOCK A SPECIAL EVENT` (positive event-level resolution dependency) label on both profiles, never a hidden destination name/requirement/biome/timing. The outcome panel shows the granted card/gem token, gold/level, or persisted map-info result (`fellBack` note on a full bag); `bonusDraft` opens a single-set CardToken picker row (1-5 cards) before its own outcome; dense upgrade/sell pickers page in authored order at readable row heights; CONTINUE › back to the map. Desktop and mobile use distinct measured story layouts; mobile keeps 44px actions and a line-snapped scroll affordance for long bodies. The three Bell stages use current shipped per-event illustrations selected by validated JSON `artId`; Feathered Cairn and Far Sight use existing cache/omen fallback art. Map previews use the previewed event's exact art when available, otherwise its theme fallback. | [ ] *(built; exact 1440×900 locked-row + picker-reload visual QA pending)* | [ ] *(built; exact 412×892 locked-row + picker-reload visual QA pending)* |
| Schema-v2 first slice: Feathered Cairn Bow OR eligibility, queued Far Sight at a compatible later Arrowfell omen node, typed three-gem curation, typed story completion, and persisted two/three-band map intelligence (desktop rail / mobile masked scroll) | [x] | [x] |
| LIVE V3 EVENT CONTENT: 66-ID generated aggregate with 15 new anchors/seven new callbacks, combat/journey ledgers, bindings, targeted upgrades, seeded pools/higher-tier event rewards, bounded deterministic model gates, a complete generated developer wiki, and 16 strict `accountStatus:"future"` discovery records; frozen V2 compatibility and the Bronze start draft remain unchanged | [ ] *(built and test-verified; visual gate above pending)* | [ ] *(built and test-verified; visual gate above pending)* |
| EVENT FOLLOW-ONS: account earning/seen-history and additional per-event illustrations beyond the shipped three-stage Bell set (other events currently use the six area fallbacks) | [ ] | [ ] |
| Picking an event node now routes to the RunEvent scene (`runStore.pickNode` no longer auto-resolves it) | [x] | [x] |
| STAT / LEVEL allocation panel (`RunStatPanel.ts`, shared builder): priced HP/ATK/MAG/DEF/RES/SPD grid via `LEVEL_STAT_COST`, CONFIRMABLE SCRATCH EDIT — +/− steppers operate on a local uncommitted allocation (PL SPENT/BANKED updates live), CONFIRM commits via `commitHeroAllocation` (`runState.ts#setHeroAllocation`), CANCEL discards; nothing is written to the run until CONFIRM | [x] | [x] |
| Panel reachable from the desktop shared HUD's LV cell when its `+N` banked-PL cue is present (including Run and run-context Bag); compact keeps the pulsing "n PL TO SPEND" badge (`renderBankedPlBadge`). Desktop's middle header band persistently shows LV, live HP current/max, ATK, MATK, DEF, MDEF, and SPD totals from committed allocation plus socketed hero gems. | [x] | [x] |
| Hover/tap explanations (`ui/hoverTip.ts`): hero/foe STAT labels (battle statlines, Run Prep foe panel, stat allocation grid) explain what each stat does; the battle turnline explains turn-order math; HIT/DEBUFF/BUFF rows with D: math show "how this was reached" (reads the already-formatted log string, never recomputes); GEMS reach the SAME keyword/stat definitions a card opens (`ui/gemPresentation.ts`, never gem-specific prose) on all six surfaces a gem appears on, by two routes: SOCKETED — deck-build socket panel, shop owned-card detail and the solo resolved-outcome chip get a `GEM EFFECT` header inside `renderCardInfoBox`, separated from the host card's own clauses; HOST-LESS — the shop's gem BUY dock and both Wiki GEMS detail panes print `gemDefinitionsText` under the gem's generated face, and the reward pickers ("PICK ONE TO KEEP"/"TO SELL") reach it by desktop hover or a mobile ⓘ badge that does not steal the pick tap. A gem SHELF/pouch cell is a drag source, so its block is one tap away through the detail it already opens; the stat labels' own definitions come from the same registry (`ui/statLabels.ts` re-exports it), so NO gem-specific or stat-specific prose exists anywhere — every sentence in this row lives once, in `engine/keywords/text.ts` | [x] | [x] |
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
