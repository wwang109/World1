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
  mini-draft) · `nothing`; `gambled` marks risk outcomes.
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

## `src/run` module map

| Module | Owns |
|---|---|
| `runState.ts` | The `RunState` shape + every pure transition (create/choose/resolve node, battle result, retire, gold, shelves, event bags) |
| `runMap.ts` | Lazy endless wave-ladder generation, node kinds, `BOSS_EVERY`, stop-choice anchoring |
| `encounter.ts` | Additive enemy resolver: titles, ranks, modifiers, `buildEnemyEncounter`, `buildAutoHeroSetup` |
| `leveling.ts` | `PL_PER_LEVEL`, `LEVEL_STAT_COST`, allocation math, monster auto-spend profiles |
| `shop.ts` | Shop filters/pools, gold prices, `rollShopStock`, `shopPoolInfo`, `battleGoldReward` |
| `events.ts` | Event roll/resolve/bonus-draft, affordability, no-repeat bags |
| `draft.ts` | `rollStartDraft` — the 4-set start draft |
| `loadout.ts` | Board/bag placement: `canPlace`, `shiftInsert`, `moveWithinStrip`, gem socket/unsocket/swap |
| `resolveBattle.ts` | `BattleRequest → BattleLog` — the battle service's whole payload (the ONLY combat entry point above the engine) |
| `analysis.ts` | `damagePerTurn` sustained-damage band (prep preview, served by the API) |
| `logAnalysis.ts` | `cardContributions` — per-card damage/heal report from an event log |

The `src/game` side discriminates run vs sandbox context via
`battleContext.ts` / `deckBuildContext.ts` source discriminators and
`runStore` — never forked scenes. UI chrome: `docs/ui-workbook.md`.

## Still planned (not built)

- Fog-of-war zone map, multiple zones, meta persistence (`src/meta`).
- Run tutorial (`docs/run-tutorial-design.md`).
- Anti-heal world rule (approved, unbuilt — `docs/design-locked.md`).
