# Run structure — the endless ladder AS BUILT

> **Scope:** LIVING — Run Mode as it exists in code: the endless wave ladder,
> lives/retire, gold economy, shops, events, leveling, the start draft, and
> the `src/run` module map. Supersedes `docs/history/release-game-plan.md`,
> `run-shops-design.md`, and `run-events-design.md` (plans). Update in the
> same commit as any run-layer change.

Run Mode is the **release game**; the free-dial Prep/Deck/Wiki/Battle app is
the **Sandbox** (balance-testing / deck-idea tool, its checklist in
`docs/feature-inventory.md`). Nothing here may regress the Sandbox.

## The ladder (`src/run/runMap.ts`)

- **Endless**: waves keep coming forever; the map generates **lazily** —
  `generateRunMap(seed, throughWave)` builds `INITIAL_WAVES` up front,
  `ensureWavesThrough`/`ensureDepthThrough` extend it, and wave N is
  deterministic from the run seed alone.
- A **wave** = 2-3 **stop columns**, then a **fight column**. Every stop
  column offers **exactly THREE choices** (user-locked 2026-07-31) of
  event/shop nodes; a fight column has 1 node (boss wave) or 3 (non-boss
  wave, see below).
- Node kinds: `'event' | 'shop' | 'fight' | 'boss'` (`RunNodeKind`).
- **Boss every `BOSS_EVERY` (5)th wave** — a milestone boss, not a run end.
  Non-boss fight columns offer **THREE risk tiers** (USER-DIRECTED
  2026-08-04, supersedes the 2026-07-30 two-option "standard/hard" rule):
  `RunNode.fightOption: 'easy' | 'standard' | 'hard'`, labeled EASY / MEDIUM /
  HARD in the UI (`FIGHT_TIER_LABEL`, `src/game/runStore.ts` — `'standard'`
  keeps its original id/spelling as the unchanged middle rung).
  - **EASY** = MEDIUM's level −1 (floored at 1 via `Math.max(1, ...)`), title
    capped at `'normal'` (never `'elite'` — `capTitleAtNormal`).
  - **MEDIUM** (`fightOption: 'standard'`) = exactly `fightSpecFor(fightNumber)`,
    byte-identical to before three-tier existed.
  - **HARD** = title bumped one rung + 1 level (unchanged from the old "hard"
    option).
  All three come from `fightTableEntryForNode` in `runState.ts`. Gold reward
  (`battleGoldReward`) and the PL-budgeted pack solve (`resolvePackMemberLevel`
  in `encounter.ts`) both read `entry.level`/`entry.title` off whichever
  tier's `FightSpec` was resolved — the easy <= medium <= hard gold/threat
  gradient and "an easy pack solves off the easy solo cost" both FALL OUT of
  this one function, with no per-tier branch anywhere else in the roll flow
  (see `tests/run/runState.test.ts`'s "fight column offers 3 foe options"
  block and `tests/run/packFights.test.ts`'s easy-pack tests). Fight 1 stays
  solo regardless of tier (`MIN_PACK_FIGHT_NUMBER` gates on the fight NUMBER,
  not the tier).

## Run end: lives + retire (`src/run/runState.ts`)

- `LIVES_PER_RUN = 3`. EVERY fight loss (boss included) costs exactly one
  life; at 0 lives the run ends with status `'defeat'`.
- `retireRun` sets `'retired'` — voluntary stop, any time.
- There is **no victory state** (user-locked 2026-07-30): `'victory'` stays
  in the `RunStatus` union purely so old `src/game` branches compile; nothing
  ever sets it. `bossesCleared` is the run's score.

## Difficulty escalation (`fightSpecFor`, `src/run/runState.ts`)

Every dial is a PURE function of the 1-indexed fight number — no RNG:

- **Title cadence** repeats per `BOSS_EVERY` block: positions 1-2 `'normal'`,
  3-4 `'elite'`, 5 `'boss'`.
- **Enemy level = fight number, uncapped** — it tracks the fight number 1:1
  forever. The HERO caps at `MAX_LEVEL` (30), so the gap widens by design.
- **Modifiers**: one additional DISTINCT `MODIFIER_PRESETS` id unlocks every
  `MODIFIER_PER_OVERFLOW_FIGHTS` (5) fights past `MAX_LEVEL`, capped at the
  preset count; level keeps climbing after this axis plateaus.
- The encounter itself is built additively over the Bronze floor by
  `buildEnemyEncounter` (`src/run/encounter.ts`): base monster + Title preset
  (rank/stat dials) + Level (priced stat economy) + Modifiers.

## Packs (`rollEncounter`, `src/run/runState.ts` + `src/run/encounter.ts`)

Non-boss fight nodes can roll as a **PACK** (2-3 LOWER-LEVEL foes) instead of
one foe at the node's full track level — "fair but different": a pack leans
on **action economy** (extra casts per round) instead of raw per-unit
strength. `rollEncounter` now returns an `EncounterPack` (`{ variant, units }`,
`variant: 'solo' | 'pair' | 'trio'`, `units: EncounterUnit[]`, length 1-3) —
`units[0]` is the "primary" foe every pre-pack consumer used to read directly.

- **Early-game gate** (`MIN_PACK_FIGHT_NUMBER`, `encounter.ts`): fight nodes
  with `fightNumber < MIN_PACK_FIGHT_NUMBER` (v1: `2` — the very first fight
  only) never roll the pack-variant Rng draw at all and are always `'solo'`.
  Gated on the fight NUMBER, not the resolved level, because a `'hard'`
  fight-option bumps level +1 on top of the base fight-1 spec — gating on
  level would let fight 1's hard option pack the instant its level ticked up.
  This is the explicit, auditable backstop for the ONE case that must never
  depend on a formula: a brand-new hero (LV 1-2, 4 Bronze cards) meeting
  their first fight. Below this gate is deliberately narrow — the BUDGET
  math below naturally floors out packs for most of the early game anyway
  (see next bullet); the gate only needs to guarantee fight 1 itself.
- **Variant roll**: one `rng.int(100)` off the node's OWN `encounterSeed`
  (fixed solo/pair/trio order) against `PACK_VARIANT_WEIGHTS`
  (`encounter.ts`) — v1 mix **70 / 20 / 10**. **Boss nodes never roll a
  variant** (always `'solo'`, no Rng draw spent on it) — packs are a
  non-boss fight-column texture only. Members then roll their OWN enemy id
  independently from `FIGHT_POOL` (can repeat).
- **Budget-derived member level** (re-priced 2026-08-04, REPLACES the old
  flat `PACK_LEVEL_DISCOUNT` trackLevel −3/−5): a flat discount barely
  mattered at low levels (it floored at level 1 same as solo, so an early
  pack was nearly as strong per-member as the solo it replaced, while
  bringing 2-3x the casts/turn) and never checked the pack's TOTAL threat
  against what a solo foe would actually cost at that depth — the two real
  bugs a live playtest surfaced. The replacement (`encounter.ts`):
  1. `soloThreatDeci(level, title, modifiers)` — the depth-derived "vs
     player" reference: the SOLO encounter's stat-scaling PL
     (`monsterLevelPL`, the same 3 PL/level currency every monster and the
     player level through) plus its board's tier budget
     (`TIER_BUDGET_DECI` per card, priced generically off
     `REFERENCE_ENEMY_DECK_SIZE` — the WORST CASE base card count in the
     roster, so this never under-prices a real enemy's deck) plus any
     `MODIFIER_PRESETS` cost (bonus-PL stat mods, or a `forceTier` deck
     override) — same currency `powerLevelDeci`'s tier-budget audit uses.
  2. `packBudgetDeci` tapers that total by `PACK_ACTION_ECONOMY_TAX_PCT`
     (v1: 30%) per extra member beyond the first — an explicit, named price
     for the same action-economy premium (K−1 extra full turns of casts per
     round) the old flat discount was gesturing at, now applied to the
     shared budget instead of invented as a level offset.
  3. `resolvePackMemberLevel` splits the taxed budget evenly across members
     (packs stay a single homogeneous roster) and solves the LEVEL that
     lands each member's stat spend on its exact share, net of the fixed
     cost of its capped title's own board. If the solve can't even afford
     LEVEL 1 within its share, `rollEncounter` **falls back to a solo
     encounter** — a pack is never shipped over its taxed budget.
  Worked examples (normal title): fight-track LV2/6/12 all floor to solo (a
  2-3 card Bronze board is already most of an early solo's whole budget);
  pairs first engage around LV18 (member LV1), trios around LV40 — elite/
  boss-titled entries (extra rank/cards baked into their preset) engage much
  earlier. `PACK_ACTION_ECONOMY_TAX_PCT`/`REFERENCE_ENEMY_DECK_SIZE` are
  balance-designer's retune knobs; the roll flow itself never changes.
- **Title cap** (`capPackTitle`): pack members are **mob/normal only** — no
  elite/boss packs in v1. The node's base title/level still comes from the
  SAME `fightTableEntryForNode` spec a solo roll would use, for WHICHEVER
  tier (easy/standard/hard) the player picked — a `'hard'` option's +1 level
  feeds every member's budget solve with its title bump capped back down to
  `'normal'` rather than skipped; an `'easy'` option's −1 level/normal-capped
  title feeds the SAME solve from a smaller budget, so an easy pack is
  solved from the easy solo cost with no separate code path. Rank stays the
  ordinary `TITLE_PRESETS[title].rank` per member — no second budget path.
- **Gold/battle wiring is already generic**: `battleGoldReward` and
  `resolveBattle`/`simulate` already accept a foe LIST (this is how the
  Sandbox's 5v1 mode works) — `battleContext.ts#runBattleInput` just always
  populates `BattleTimelineInput.enemyTeam` from `pack.units` (mirroring the
  primary into the singular fields for 1v1-only readers), so a pack fight
  flows through the existing multi-foe battle scenes/gold math unmodified.
- **UI**: map choice hints (`runStore.ts#encounterHintDetail`) read
  `"PACK OF 2 · Wolf · LV 3"` instead of a title chip for packs (title is
  capped/uninformative); RunPrep's foe panel shows the whole roster on
  desktop (`packMemberLines`, one line per distinct enemy+level, `"×N"` when
  repeated) and a compact `"+N MORE"` suffix on mobile — both convey count +
  level, never lie about the pack's shape.

## Gold economy

Gold is an **economy-pacing knob, never a balance number** — PL remains the
only balance currency (see the comment block in `src/run/shop.ts`).

- **Daily income**: `DAILY_INCOME` (+1) per node committed to via
  `chooseNode` (user-locked 2026-07-30). A loss still earns the day's +1;
  only the fight's own gold is withheld.
- **Fight gold**: `battleGoldReward` (`src/run/shop.ts`) — `base: 1` plus a
  win-only `winBonus` 1-3 derived from a difficulty score (title weight +
  level-over-hero + modifier count per foe, + extra-foe count). In run
  context a LOSS credits 0 fight gold (`resolveRunBattleResult`); the
  Sandbox's loss-still-pays-base behavior is unchanged.
- **Prices**: cards by offered tier via `GOLD_PRICE_BY_TIER` (bronze 2 …
  diamond 5, shop `priceDelta` folded by `goldPriceOfCardForShop`, floored at
  1); gems via `goldPriceOfGem` (monotonic in the gem's own PL, one rung per
  rarity band) — Common 1, Rare 2, Epic 3, Legendary 4 gold, each rung a flat
  20 deci-PL/gold (Legendary bumped from 3, 2026-08-09: the 46→35 gem
  migration left Legendary as a genuinely build-defining band, resonant_echo/
  the Echo among them. Epic split out of the shared Rare/Epic rung,
  2026-08-18: the shared rung had priced Epic at 30 deci-PL/gold, a 1.5x
  outlier against the flat 20 everywhere else in the gold economy).

## Shops (`src/run/shop.ts`, themes in `src/data/shopTypes.ts`)

- **16 themed shops** as declarative card/gem filters; a shop NODE opens a
  single storefront (the 16-shop picker is Sandbox-only). The node's theme is
  decided at map generation and shown on the choice panel.
- **Theme no-repeat**: draw-without-replacement bag per run, reshuffled when
  empty (shared `runMap.ts` logic).
- **Stock**: `rollShopStock(shopId, seed, depth, rarityGated)` —
  deterministic; REROLL costs 1 gold and re-rolls the same theme's shelf
  (`baseSeed + rerollCount`). Tier split shifts with depth (depths 1-3 →
  70/25/5 bronze/silver/gold · 4-6 → 45/45/10 · 7-9 → 25/55/20; Diamond never
  appears in shops). Sandbox callers omit depth and get 70/25/5 unchanged.
- **Gem rarity distribution** (2026-08-09, gem ruleset v1 §9.6 + fork 5): a
  shelf's gem offers are drawn WEIGHTED by rarity band (Common 60 · Rare 25 ·
  Epic 10 · Legendary 5 — see the rationale comment above `GEM_RARITY_WEIGHT`
  in `src/run/shop.ts`), capped at one Legendary per shelf, and Legendary is
  additionally GATED below depth 5 (wave 2+; Epic is left ungated). Sandbox
  callers pass `rarityGated: false` — the balance playground shows every
  rarity unconditionally, gate or no gate.
- **Shelf size** (2026-08-04, "shops sell more" pass): every shop targets ~6
  card offers + ~5 gem offers (`ShopTypeDef.shelf`), capped gracefully at
  whatever the theme's own pool actually holds — an element specialist stall
  (thin-by-design, USER-LOCKED) just shows its whole 1-9-card pool instead of
  an artificially truncated slice of it. Gemcutter is the one deliberate
  exception, kept at 6 gems (its identity, matching the gem grid's row
  capacity) and 0 cards.
- `shopPoolInfo` caps shelf slot counts at the theme's whole pool and flags
  `fullStock` so the UI can hide REROLL instead of inviting wasted gold.
- Per-NODE shelves persist in `RunState.shopShelves` (bought offers stay
  gone; reload-safe).
- **Selling** (2026-08-04): `sellRunCard(state, 'board'|'bag', index)` /
  `sellRunGem(state, pouchIndex)` — the reverse of a purchase. Half-price,
  rounded down, floored at 1 gold (`sellPriceOfCard`/`sellPriceOfGem`,
  `src/run/shop.ts`); a sold board piece's socketed gem returns to
  `gemInventory` rather than being destroyed. Sold items do NOT return to any
  shelf — REROLL pricing/behavior is unaffected. Sandbox mirror:
  `sellCard`/`sellGem` in `src/game/shopActions.ts` (credits gold for
  consistency even though the sandbox wallet is unlimited/ignored).
- **Buy-to-slot** (2026-08-04, for the upcoming drag-to-deck UI):
  `buyRunCardTo(state, nodeId, index, dest)` where
  `dest: {where:'board', slot} | {where:'bag', slot}` — buys straight into an
  explicit destination instead of nearest-fit, validating footprint/occupancy
  via `canPlace` (`src/run/loadout.ts`; the bag axis reuses it too through
  `bagAsBoardPieces`, so there's one overlap-check implementation for both).
  `buyRunCard` (nearest-fit) stays the plain-tap path; buy-to-slot never
  offers a merge. Sandbox mirror: `buyCardTo` in `src/game/shopActions.ts`.

## Events (`src/data/events.ts` + `src/run/events.ts`)

Fights spend attention, shops spend gold, **events spend risk**: text
dialogues with 2-3 choices, seeded outcomes.

- Catalog is pure data (`EventDef`: id, `theme: EventTheme`, title, body,
  choices); resolution is pure (`rollEventForNode`, `resolveEventChoice`,
  `applyBonusDraftPick`), all randomness from the node seed via `Rng`.
- Outcome vocabulary (`EventOutcome`): `grantCard` (nearest-fit insert,
  bag-full → `fellBack` to gold) · `grantGem` · `grantGold` · `loseGold` ·
  `grantLevel` (capped at `MAX_LEVEL`) · `bonusDraft` (single-set 1-5 card
  mini-draft) · `upgradeCard` (bumps one owned card +1 tier, see below) ·
  `nothing`; `gambled` marks risk outcomes.
- `upgradeCard` (2026-08-04): +1 tier (bronze→silver→gold→diamond) on ONE
  already-owned card. **v1 has no picker UI** — `upgradeCardOutcome`
  (`run/events.ts`) deterministically targets the lowest-tier eligible
  (non-diamond) card: board `pieces` are checked before the bag, ties broken
  by ascending board `slot`/bag array order. Nothing eligible (no owned
  cards, or every one is already diamond) → `{fellBack: true}` plus
  `CARD_FALLBACK_GOLD`, reported as `upgradeCard`/`fellBack` (NOT re-kinded to
  `grantGold` like `grantCard`'s bag-full fallback — the reason differs, so
  the UI needs to say something different). A choose-your-card picker is a
  later pass. Three Cinderworks (forge) events use it (guaranteed-pay, a free
  coin-flip, and a paid-better-odds coin-flip).
- No-repeat bags: a per-run `eventBag` plus per-theme bags
  (`eventThemeBags`), reshuffled deterministically via refill counters.
- Affordability: `isEventChoiceAffordable` is the single predicate both the
  resolver and the UI use; `rollEventForNode` skips events with no playable
  choice at current gold.

## Leveling (`src/run/leveling.ts`)

ONE PL-budget economy for player AND monsters (locked 2026-07-23/24):
`PL_PER_LEVEL = 3` per level, spent via the priced `LEVEL_STAT_COST` table
(speed costs double; maxHp buys grant 5). Monsters auto-spend by profile
weights (`allocateMonsterPL`); the player spends by hand
(`heroAllocation`, committed via `setHeroAllocation`). The hero gains +1
level after EVERY fight, win or lose, capped at `MAX_LEVEL`.

## Start draft (`src/run/draft.ts`)

`rollStartDraft(seed)`: 4 sets × 5 distinct bronze cards — `offense`,
`defense` (defensive|healing), `support` (support|debuff), `wildcard`
(anything left), themed pools backfilled deterministically from the full
book when thin. The player picks exactly 1 per set; a fresh run (status
`'drafting'`) routes straight to the Draft scene, and `applyRunDraft`
installs the picks.

## Stats (`RunState.stats`, `src/meta/lifetimeStats.ts`)

Two layers, both pure/integer, no UI yet (a stats screen is separate):

- **Per-run** (`RunState.stats: RunStats`, `runState.ts`): additive counters
  NOT already tracked elsewhere on `RunState` — `wins`/`losses`/
  `bossesCleared`/`lives` stay the single source of truth for those; a
  stats-screen selector merges them in. `RunStats` holds `damageDealt` /
  `damageTaken` / `healingDone` (folded from a fight's `BattleLog` via
  `battleStatsFromEvents` in `logAnalysis.ts` — NO re-simulation), `goldEarned`
  / `goldSpent`, `cardsBought` / `gemsBought`, `eventsResolved`,
  `deepestWave` (from `chooseNode`), and `livesLost`. Updated
  at the SAME transitions that already touch the counterpart field
  (`chooseNode`, `recordBattleResult`, `buyRunCard`/`buyRunGem`/
  `buyRunCardTo`/`sellRunCard`/`sellRunGem`/`rerollRunShop`,
  `resolveEventChoice`) — every transition still returns a new `RunState`
  (`stats` included), no exception.
- **Lifetime** (`src/meta/lifetimeStats.ts`, new module — `src/meta` has no
  other code yet): cross-run aggregation — `runsStarted`/`runsRetired`/
  `runsDead`, `totalFights`/`totalWins`/`totalLosses`/`totalBossesCleared`, a
  `bestRun` high-water mark (`bossesCleared`, `deepestWave`), and a `totals`
  sum of every `RunStats` counter. Persists via an INJECTED `StorageDriver`
  (`{get(key), set(key,value)}`) so `src/meta` stays DOM-free; a real
  `window.localStorage`-backed driver lives in `src/game/metaStore.ts`, which
  also owns the two call sites (`runStore.ts#startRun` ->
  `noteRunStarted`, and the retire/defeat transitions -> `noteRunEnded`).
  Versioned (`schemaVersion`), stable storage key (`LIFETIME_STATS_STORAGE_KEY`,
  NOT re-derived per version — see its doc comment), with a tolerant loader
  and a NOT-tolerant saver: `loadLifetimeStats` never throws — bad/missing/
  malformed JSON, or an unrecognized future shape, all normalize to safe
  zeroed defaults field-by-field for READING (an unparseable blob is copied
  to a side backup key first, so it isn't destroyed) — but `saveLifetimeStats`
  refuses to write (`SaveOutcome`) if the blob currently on disk is from a
  NEWER `schemaVersion` than this build understands, so a stale tab or a
  rollback can never downgrade-and-overwrite a future version's ledger. A
  `StorageDriver`-level write failure (quota exceeded, private mode) is
  reported the same way rather than swallowed.

## `src/run` module map

| Module | Owns |
|---|---|
| `runState.ts` | The `RunState` shape + every pure transition (create/choose/resolve node, battle result, retire, gold, shelves, event bags) |
| `runMap.ts` | Lazy endless wave-ladder generation, node kinds, `BOSS_EVERY`, stop-choice anchoring |
| `encounter.ts` | Additive enemy resolver: titles, ranks, modifiers, `buildEnemyEncounter`, `buildAutoHeroSetup`; PACK constants (`PackVariant`, `PACK_VARIANT_WEIGHTS`, `MIN_PACK_FIGHT_NUMBER`, `capPackTitle`, `EncounterPack`) and budget helpers (`soloThreatDeci`, `packBudgetDeci`, `resolvePackMemberLevel`, `PACK_ACTION_ECONOMY_TAX_PCT`, `REFERENCE_ENEMY_DECK_SIZE`) |
| `leveling.ts` | `PL_PER_LEVEL`, `LEVEL_STAT_COST`, allocation math, monster auto-spend profiles |
| `shop.ts` | Shop filters/pools, gold prices, `rollShopStock`, `shopPoolInfo`, `battleGoldReward`, sell-back pricing (`sellPriceOfCard`, `sellPriceOfGem`) |
| `events.ts` | Event roll/resolve/bonus-draft, affordability, no-repeat bags |
| `draft.ts` | `rollStartDraft` — the 4-set start draft |
| `loadout.ts` | Board/bag placement: `canPlace`, `shiftInsert`, `moveWithinStrip`, gem socket/unsocket/swap, `bagAsBoardPieces` (bag-as-`BoardPiece[]` view so `canPlace` validates the bag axis too) |
| `resolveBattle.ts` | `BattleRequest → BattleLog` — the battle service's whole payload (the ONLY combat entry point above the engine) |
| `analysis.ts` | `damagePerTurn` sustained-damage band (prep preview, served by the API) |
| `logAnalysis.ts` | `cardContributions` — per-card damage/heal report from an event log; `battleStatsFromEvents` — the run stats ledger's per-fight delta |

The `src/game` side discriminates run vs sandbox context via
`battleContext.ts` / `deckBuildContext.ts` source discriminators and
`runStore` — never forked scenes. UI chrome: `docs/ui-workbook.md`.

## Still planned (not built)

- Fog-of-war zone map, multiple zones.
- ~~Meta persistence (`src/meta`)~~ — lifetime STATS built 2026-08-04 (see
  "Stats" above); a real save/load of the run itself (mid-run resume across
  reloads, account progression beyond stats, respec) is still unbuilt.
- Run tutorial (`docs/run-tutorial-design.md`).
- ~~Anti-heal world rule~~ — BUILT 2026-08-03 in the engine (`docs/design-locked.md`);
  the dedicated anti-heal DEBUFF that will replace it (cap −80%) is still unbuilt.
