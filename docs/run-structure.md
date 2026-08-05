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
  event/shop nodes; a fight column has 1-2 nodes.
- Node kinds: `'event' | 'shop' | 'fight' | 'boss'` (`RunNodeKind`).
- **Boss every `BOSS_EVERY` (5)th wave** — a milestone boss, not a run end.
  Non-boss fight columns offer **two foes**: standard / hard
  (`RunNode.fightOption`; hard = title bumped one rung + 1 level, see
  `fightTableEntryForNode` in `runState.ts`).

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

- **Variant roll**: one `rng.int(100)` off the node's OWN `encounterSeed`
  (fixed solo/pair/trio order) against `PACK_VARIANT_WEIGHTS`
  (`encounter.ts`) — v1 mix **70 / 20 / 10**. **Boss nodes never roll a
  variant** (always `'solo'`, no Rng draw spent on it) — packs are a
  non-boss fight-column texture only. Members then roll their OWN enemy id
  independently from `FIGHT_POOL` (can repeat).
- **Level discount** (`PACK_LEVEL_DISCOUNT`): pair members roll at
  `trackLevel − 3`, trio at `trackLevel − 5`, floored at 1 (`clampLevel`'s
  floor). Deliberately steeper than a naive "split the stat budget N ways" —
  the readiness engine's initiative check runs once per ALIVE unit per turn,
  so an extra member is an extra FULL turn of casts, not just extra stats.
- **Title cap** (`capPackTitle`): pack members are **mob/normal only** — no
  elite/boss packs in v1. The node's base title/level still comes from the
  SAME `fightTableEntryForNode` spec a solo roll would use (so a `'hard'`
  option's +1 level lands on every member; its title bump is capped back down
  to `'normal'` rather than skipped). Rank stays the ordinary
  `TITLE_PRESETS[title].rank` per member — no second budget path.
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
  1); gems 1-3 gold via `goldPriceOfGem` (monotonic in the gem's own PL).

## Shops (`src/run/shop.ts`, themes in `src/data/shopTypes.ts`)

- 5 themed shops as declarative card/gem filters; a shop NODE opens a single
  storefront (the 5-shop picker is Sandbox-only). The node's theme is decided
  at map generation and shown on the choice panel.
- **Theme no-repeat**: draw-without-replacement bag per run, reshuffled when
  empty (shared `runMap.ts` logic).
- **Stock**: `rollShopStock(shopId, seed, depth)` — deterministic;
  REROLL costs 1 gold and re-rolls the same theme's shelf
  (`baseSeed + rerollCount`). Tier split shifts with depth (depths 1-3 →
  70/25/5 bronze/silver/gold · 4-6 → 45/45/10 · 7-9 → 25/55/20; Diamond never
  appears in shops). Sandbox callers omit depth and get 70/25/5 unchanged.
- `shopPoolInfo` caps shelf slot counts at the theme's whole pool and flags
  `fullStock` so the UI can hide REROLL instead of inviting wasted gold.
- Per-NODE shelves persist in `RunState.shopShelves` (bought offers stay
  gone; reload-safe).

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
  `deepestDepth` / `deepestWave` (from `chooseNode`), and `livesLost`. Updated
  at the SAME transitions that already touch the counterpart field
  (`chooseNode`, `recordBattleResult`, `buyRunCard`/`buyRunGem`/
  `rerollRunShop`, `resolveEventChoice`) — every transition still returns a
  new `RunState` (`stats` included), no exception.
- **Lifetime** (`src/meta/lifetimeStats.ts`, new module — `src/meta` has no
  other code yet): cross-run aggregation — `runsStarted`/`runsRetired`/
  `runsDead`, `totalFights`/`totalWins`/`totalLosses`/`totalBossesCleared`, a
  `bestRun` high-water mark (`bossesCleared`, `deepestWave`), and a `totals`
  sum of every `RunStats` counter. Persists via an INJECTED `StorageDriver`
  (`{get(key), set(key,value)}`) so `src/meta` stays DOM-free; a real
  `window.localStorage`-backed driver lives in `src/game/metaStore.ts`, which
  also owns the two call sites (`runStore.ts#startRun` ->
  `noteRunStarted`, and the retire/defeat transitions -> `noteRunEnded`).
  Versioned (`schemaVersion`) with a tolerant loader — bad/missing/malformed
  JSON, or an unrecognized future shape, all normalize to safe zeroed
  defaults field-by-field rather than crashing boot.

## `src/run` module map

| Module | Owns |
|---|---|
| `runState.ts` | The `RunState` shape + every pure transition (create/choose/resolve node, battle result, retire, gold, shelves, event bags) |
| `runMap.ts` | Lazy endless wave-ladder generation, node kinds, `BOSS_EVERY`, stop-choice anchoring |
| `encounter.ts` | Additive enemy resolver: titles, ranks, modifiers, `buildEnemyEncounter`, `buildAutoHeroSetup`; PACK constants (`PackVariant`, `PACK_VARIANT_WEIGHTS`, `PACK_LEVEL_DISCOUNT`, `capPackTitle`, `EncounterPack`) |
| `leveling.ts` | `PL_PER_LEVEL`, `LEVEL_STAT_COST`, allocation math, monster auto-spend profiles |
| `shop.ts` | Shop filters/pools, gold prices, `rollShopStock`, `shopPoolInfo`, `battleGoldReward` |
| `events.ts` | Event roll/resolve/bonus-draft, affordability, no-repeat bags |
| `draft.ts` | `rollStartDraft` — the 4-set start draft |
| `loadout.ts` | Board/bag placement: `canPlace`, `shiftInsert`, `moveWithinStrip`, gem socket/unsocket/swap |
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
