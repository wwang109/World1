> **Scope:** PROPOSAL, not yet built. Implementation contract for two sandbox features: custom foe decks and dual-use share codes (PLAY IT / FIGHT IT).

# Sandbox design spec — custom foe decks + dual-use share codes

Design-only deliverable. No repo files were written. Every mechanism cited below
was read at the stated file:line on 2026-09-02.

The two features are designed as ONE system, per the mid-flight requirement:
a **share code encodes a LOADOUT** (board + tiers + gems + bag + hero level/spend),
and on paste the player chooses **PLAY IT** (it becomes my hero setup) or
**FIGHT IT** (it becomes the enemy's board — which is exactly Feature A's
custom-foe-deck mechanism). Feature A is therefore the *data + resolver + editor*
for player-authored enemy boards; Feature B is the *codec + import/export UI*
whose "FIGHT IT" path writes Feature A's data shape.

---

## 0. Ground truth (what the code actually does today)

| Fact | Where |
|---|---|
| Sandbox state is one mutable in-memory object `demoState`; **not persisted** (localStorage is used only by audio settings `src/game/audio/audioBus.ts:37`, lifetime stats `src/game/metaStore.ts:26`, and the RUN save `src/game/runStore.ts:80-93`). A refresh resets the sandbox. | `src/game/demoState.ts:255-277` |
| Enemy team = `EnemyFightConfig[]` (max `MAX_FOES = 5`): `{ enemyId, level, title, rank, modifiers, affix? }`. Legacy singular fields mirror `enemyTeam[0]` via `syncPrimaryFoe()`. | `src/game/demoState.ts:23,37-54,100-110` |
| The battle request ships **dials, not boards**: `BattleFoeConfig { enemyId, level, title, rank, modifiers?, affix? }`; the service **re-resolves** each foe with `buildEnemyEncounter(...)`. Hero side ships literal `pieces: BoardPiece[]` (with full `Gem` objects socketed). | `src/run/resolveBattle.ts:22-53,70-84` |
| `buildEnemyEncounter(enemyId, level, title, rankOverride, modifiers, affix)` — order: scale stats → modifier `bonusPL` spends → install affix cards (eat the title's `extraCards` allowance) → backfill generic filler → `assignRankTiers` round-robin → modifier `forceTier` trumps rank → `boardSize = max(enemy.boardSize, nextFreeSlot(pieces))`. Throws on unknown enemy/modifier/affix id. | `src/run/encounter.ts:790-850` |
| The ENGINE already accepts arbitrary foe boards/stats: `scripts/fight.ts` `FIGHT_FOE_BOARD` (`foePieces`, :276-296, incl. `@tier` and `#gem` suffixes via `parsePiece` :170-198), `FIGHT_FOE_STATS` (:308-327), `FIGHT_FOE_SLOTS` (:256-264). |
| Gems work on ANY combatant's pieces: `initCombatant` folds hero-scope gems from `setup.pieces` for **every** unit, both sides (`applyHeroGems(stats, gemHeroStats(setup.pieces))`), and card-scope/effect gems fold per-piece in `resolveEffectiveSkill`. | `src/engine/combat/state.ts:323`, `src/engine/cards.ts:1062` |
| Thin client: `src/game` never simulates; battles go `battleRequestOf(input)` → `POST /battle` (`src/game/battleApi.ts:21-58`) → `server/battleApi.ts:44-49` / `functions/battle.ts` (both are pure pass-throughs of the JSON body into `resolveBattle`). Boundary enforced by `scripts/check-boundaries.mjs` (`PURE_DIRS = ['src/engine','src/data','src/run','src/meta']`). |
| Client-side preview and the fight resolve the SAME config through the SAME `buildEnemyEncounter` (the affix bug's lesson, `src/run/resolveBattle.ts:33-41`): call sites `src/game/scenes/DesktopPrepScene.ts:62-63`, `MobilePrepScene.ts:62`, `src/game/battleTimeline.ts:575`. |
| Board/bag geometry: hero board = `HERO_BOARD_SLOTS = 10` (`src/data/heroes.ts:22`); bag = 10 slots (scene consts `DesktopDeckBuildScene.ts:38`, `shopActions.ts:22`, `DEFAULT_BAG_SLOTS` length 10 `demoState.ts:125-136`); a size-N card covers N consecutive slots, stored at its first slot. Slot POSITION is mechanical (adjacency auras). |
| Tiers: 4 (`SkillTier`, `src/engine/types.ts:71`); per-owned-card tier floor via `clampTierToCard` (`types.ts:1347`), applied at the sandbox's single stamping point `createOwnedCard` (`demoState.ts:332-338`). |
| Leveling economy is UNIFIED: `PL_PER_LEVEL = 3` for hero and monsters (`src/run/leveling.ts:359`), `LEVEL_STAT_COST` (:371-378), stat order pinned (`STAT_ORDER`, :30). Hero spends by hand (`Allocation`, :32; guarded by `applyPlayerLevelAllocation` :436); a monster auto-spends via `profileFor(enemyId)` → `DEFAULT_PROFILE` fallback (:347-349) inside `scaleMonsterToLevel` (:581-589). All 59 enemies share the universal L1 floor statline (verified over `enemies.v1.json`: one distinct statline = `{100 hp, 1/1/1/1, 10 spd}`, the same `BASE_HERO_STATS`, `src/data/heroes.ts:12-20`). |
| Content is versioned: `skills.v1.json` `schemaVersion: 1`, **174 cards**; `gems.v1.json` **53 gems**; `enemies.v1.json` **59 enemies**. Loader resolves highest `version` per id and canonicalizes **sorted-by-id** order (`src/data/skillsContent.ts:79-102`, sort at :92). Per-run version pinning deliberately does not exist (`src/data/content/README.md` "Versions"). |
| **Hazard**: any new catalog enemy enters the run's seeded pools (`FIGHT_POOL = Object.values(enemies)...`, `src/run/runState.ts:344-361`) and would shift frozen run fingerprints + roster tests (`tests/run/biomeIntegrity.test.ts:51`, `bossRoster.test.ts:29`, `enemyDepth.test.ts:22`). So the design adds **no vessel enemy** (see §2.4). |
| No clipboard/DOM-input affordance exists anywhere in `src` (grep: zero hits for `clipboard`, `createElement('input'|'textarea')`, `execCommand`); the Phaser config has no DOM container (`src/main.ts:50-80`). The paste UI must be introduced (§3.7). |
| URL deep-links are an established sandbox idiom (`src/game/devLaunch.ts:161-208`: `?scene=&enemies=&title=&rank=&mods=&affix=&gold=`), applied via `resetDemoState` overrides. |

---

## 1. Shared data shape — `FoeDeckCard` and the extended configs

One new pure type, defined next to its consumer in `src/run/encounter.ts`
(src/game already imports types from there — `EnemyTitle` at `demoState.ts:5`):

```ts
// src/run/encounter.ts
/** One player-authored card on a custom foe deck. `slot` is the leftmost
 *  occupied slot (size comes from the skill book), same contract as
 *  BoardPiece (engine/types.ts:1477). `gemId` is a gemBook id — the config
 *  ships the ID and the resolver socketes the real Gem, so the request stays
 *  small and gem definitions have one source of truth. */
export interface FoeDeckCard {
  skillId: string;
  slot: number;
  tier?: SkillTier;          // omitted = the card's own authored tier
  gemId?: string | null;     // omitted/null = no gem
}
```

Extensions (all optional — every existing literal, test fixture, and the
sandbox defaults stay valid unchanged, the same additive rule `affix` followed,
`demoState.ts:43-53`):

```ts
// src/game/demoState.ts — EnemyFightConfig gains:
/** Player-built deck replacing the authored board entirely (sandbox only).
 *  null/omitted = the normal authored+title+rank pipeline. Structural twin of
 *  BattleFoeConfig.deck so the config travels prep -> timeline -> battle
 *  request intact (same rule as `affix`). */
deck?: FoeDeckCard[] | null;

// src/run/resolveBattle.ts — BattleFoeConfig gains:
deck?: readonly FoeDeckCard[] | null;

// src/run/encounter.ts — buildEnemyEncounter gains a 7th optional param:
export function buildEnemyEncounter(
  enemyId: string, level: number, title: EnemyTitle = 'normal',
  rankOverride?: number, modifiers: readonly string[] = [],
  affix: string | null = null,
  deck?: readonly FoeDeckCard[] | null,   // NEW
): EncounterUnit
```

### 1.1 Resolver semantics when `deck` is present (`buildEnemyEncounter`)

Replaces the board pipeline, keeps the stat pipeline. Exact behavior:

1. Stats: unchanged — `scaleMonsterToLevel(enemy, level + TITLE_PRESETS[title].levelDelta)`
   then modifier `bonusPL` spends (`encounter.ts:810-819`). The dials LV / TITLE /
   MODIFIERS keep meaning exactly what they mean today.
2. Pieces: `deck` maps 1:1 to `BoardPiece[]` — `{ skillId, slot, tier?, gem: gemBook[gemId] }`.
   **Skipped entirely**: affix card install (`addNamedCards`), title filler
   (`addExtraCards`), and `assignRankTiers`. The player-authored tiers ARE the tiers.
3. `forceTier` modifiers (DIAMOND-POWERED) still trump explicit tiers
   (`encounter.ts:833-837`) — consistent with today's "modifier tier overrides
   trump rank assignment"; the UI already labels the rank stepper
   "MAXED BY <modifier>" (`DesktopPrepScene.ts:303`), and the deck row reuses that.
4. `boardSize = max(enemy.boardSize, nextFreeSlot(pieces))` — unchanged
   (`encounter.ts:838`); a 10-slot custom deck legitimately grows any chassis.
5. `EncounterUnit.rank` echoes the deck's real tier-steps
   (Σ tierIndex(piece.tier) − tierIndex(card's authored tier)) so the prep
   stat sheet and `battleGoldReward`-style consumers stay honest.
6. Validation THROWS (typos scream, the resolver's existing contract,
   `encounter.ts:797-805`): unknown `skillId`, unknown `gemId`, `deck.length === 0`,
   overlapping slots, any `slot + size > FOE_DECK_SLOTS` (new const = 10, defined
   as `HERO_BOARD_SLOTS`' twin in encounter.ts — the pure layers must not import
   the game layer, and `heroes.ts:22` is `src/data`, so import it directly).
   Tier below the card's authored floor is **clamped** via `clampTierToCard`
   (types.ts:1347), not thrown — mirrors `createOwnedCard` (`demoState.ts:332`).
7. `affix` and `deck` are mutually exclusive at the resolver: an affix is only a
   card installation (`affixCardsFor`, `encounter.ts:256-259`), which a custom
   deck replaces. If both arrive, throw (`"a custom deck already owns the board"`)
   — the UI never produces this (§2.3 clears `affix` on APPLY).

Determinism note for the implementer: with `deck` absent the function must be
**byte-identical** to today (the resolver-seam rule, CLAUDE.md §Additive
features); the existing frozen tests prove it for free since the param defaults
to undefined.

### 1.2 Why this shape and not alternatives

- **Dials-only stays the wire contract.** The client still never ships a
  *resolved* setup (no stats, no name); it ships the deck *recipe* and both
  preview (`DesktopPrepScene.ts:62`) and service (`resolveBattle.ts:76-78`)
  re-resolve identically — the same design that fixed the affix preview bug.
- **Gem ids, not Gem objects**, on the foe path: the hero path ships full `Gem`
  objects only because `demoState.pieces` historically stores them
  (`demoState.ts:114-115`); nothing requires repeating that. Ids keep the
  request small and canonical.
- **Explicit slots, not packed order**: slots are mechanics (adjacency auras),
  and FIGHT IT's round-trip guarantee (§3.5, test T2) requires the source
  board's geometry to survive.
- **Stats are NOT player-editable** in v1. `FIGHT_FOE_STATS` exists for scripts,
  but the sandbox already has a complete, PL-honest stat vocabulary (LV/TITLE/
  MODIFIERS steppers on both prep scenes); raw stat entry would bypass the
  PL economy and need a 7-field form on a panel that is at vertical capacity
  (`DesktopPrepScene.ts:320-330`). The dials stay the stat surface.

---

## 2. Feature A — build the enemy's board and fight it

### 2.1 Where the UI lives

The sandbox foe picker/dials live in **DesktopPrepScene** (CHOOSE FIGHT panel,
foe chips :140-183, title/modifier/affix chips :201-291, LV/RANK steppers
:297-309) and **MobilePrepScene** (roster :113-154, enemy sheet :201-311).
The deck editor is an overlay owned by those same scenes — NOT a new scene —
matching the established overlay idiom (`renderPicker`,
`DesktopPrepScene.ts:522-571` / `MobilePrepScene.ts:157-199`: scrim + panel +
rebuildScene survival).

**Entry point** (both platforms): a `DECK` row directly under the RANK stepper:

- Auto deck: `DECK · AUTO (4 CARDS)` + `[EDIT]` button.
- Custom deck: `DECK · CUSTOM (6 CARDS · 8/10 SLOTS)` + `[EDIT]` + `[✕ AUTO]`
  (reset to authored pipeline, `deck = null`).
- While custom: the RANK stepper renders inert with label `RANK · CUSTOM DECK`
  (exact mechanism as the `forceTier` freeze, `DesktopPrepScene.ts:302-309` /
  `MobilePrepScene.ts:303-309`), and the ELITE AFFIX row is hidden (its cards
  are just cards now — the player adds them from the catalog if wanted).

### 2.2 Reuse DeckBuild vs. a lighter picker — evaluated honestly

**Decision: a new lightweight editor overlay (`src/game/ui/foeDeckEditor.ts`),
not the DeckBuild scenes.**

- DeckBuild is built around *owned inventory*: `OwnedCard` instanceIds, a
  10-slot bag, a gem inventory, TEMP HOLDING, trash/merge confirms, and a
  run/demo source discriminator threaded through ~10 accessors
  (`DesktopDeckBuildScene.ts:45-116`; Mobile twin is 988 lines). A foe deck has
  **none** of that: no ownership, no bag, no economy — it is "pick cards from
  the whole book, set tiers, optionally socket a gem". Pointing DeckBuild at a
  foe means a third context source plus hiding half the scene on both
  platforms — more code than the picker it would replace, in two 900+-line files.
- What the foe editor actually needs already exists as shared pieces: the
  overlay idiom (above), the scroll window (`src/game/ui/gridWindow.ts:99`),
  card rows/faces (`CardToken`/`cardInfoBox` as used by the Wiki), and
  `clampTierToCard` for tier cycling.

**Editor spec** (one module, two layout profiles, same pattern as
`affixPresentation.ts` serving both scenes):

- **Deck list** (left on desktop, top on mobile): one row per card, in slot
  order — `name · SIZE n · [tier chip] · [gem chip] · ✕`. Tier chip tap cycles
  bronze→silver→gold→diamond→bronze, skipping tiers below the card's authored
  floor. Gem chip tap switches the catalog pane to gem mode for that row; `✕`
  on the gem chip clears it. Header meter: `8/10 SLOTS`; APPLY disabled at 0
  cards or overflow (unreachable by construction — adds are blocked when the
  card's size doesn't fit).
- **Catalog pane** (right on desktop, bottom sheet on mobile): all 174 cards,
  canonical id order, rows `NAME · size · property/type badge`, scrolled via
  `gridWindow`. Tap = append at `nextFreeSlot` packing (the editor re-packs
  slots contiguously on every add/remove; imported decks keep their imported
  slots until the first edit, then re-pack — one rule, stated in the UI as
  "editing re-packs the board"). In gem mode the same pane lists the 53 gems +
  a NONE row.
- **Buttons**: `APPLY` (writes `foe.deck`, sets `foe.affix = null`, `syncPrimaryFoe()`,
  rerender), `AUTO` (deck = null), `CANCEL`. Seeded on open from the current
  **resolved** encounter (`encounter.setup.pieces` mapped to `FoeDeckCard[]`,
  gem→`gem.id`) so editing an elite starts from the exact board previewed.
- **Desktop layout**: centered overlay ~1040×720 inside the 1440×900 canvas,
  deck list 420px left column, catalog right, buttons bottom-right — same
  scrim/panel/z-order as the foe picker (:522-537).
- **Mobile layout**: full-screen overlay (the `renderPicker` pattern,
  `MobilePrepScene.ts:157-168`): deck list (max ~5 rows visible, scrolls),
  slots meter, catalog list below, `AUTO / CANCEL / APPLY` as a bottom
  `renderActionBar` row (`src/game/ui/ActionBar.ts:34`, `FOOTER_HEIGHT` 40).
  Tap targets ≥ 40px (the existing stepper buttons are 24px on mobile but the
  layout audits gate NEW controls — keep 40).

### 2.3 What the player can set

| Dial | Custom-deck behavior |
|---|---|
| Board cards | Any card in `skillBook` (all 174 — sandbox is anything-goes), duplicates allowed (affix precedent: `addNamedCards` allows copies, `encounter.ts:262-266`), total size ≤ 10 slots, ≥ 1 card. |
| Per-card tier | bronze/silver/gold/diamond, floored at the card's authored tier (`clampTierToCard`). |
| Per-card gem | Any of the 53 gems, or none. Engine-supported on foes (state.ts:323). |
| Stats | Via the existing LV / TITLE / MODIFIERS dials only (unchanged). |
| Elite affix | Cleared and hidden while a custom deck is set (§1.1.7). |
| Board size / slots | Fixed cap 10 (`FOE_DECK_SLOTS`); slots packed by the editor, preserved on import. |

### 2.4 No new catalog enemy (the vessel question)

A neutral "challenger" enemy was considered for FIGHT IT imports and rejected:
`FIGHT_POOL`/`BOSS_POOL` enumerate `Object.values(enemies)` (`runState.ts:344-361`),
so a catalog addition silently enters every seeded run roster and moves frozen
fingerprints + at least 4 roster tests. Instead, a custom deck rides **whatever
chassis enemy the foe entry already has** (name, affinities, stat profile) —
which composes with the existing picker: swap the chassis with the SWAP overlay,
keep the deck. Since all enemies share the universal L1 floor statline (§0),
chassis choice only tints the auto stat *spread* (`profileFor`) and the
element/weapon affinities, both visible on the enemy sheet.

### 2.5 Save-shape

None required. `demoState` is session-only (§0); `deck` is an optional field on
an in-memory struct. The only serialization surface that must understand it is
`cloneEnemyTeam` (`demoState.ts:239-241` — must deep-copy `deck` arrays) and
`resetDemoState`'s enemyTeam override path (`demoState.ts:280-294` — carries
whatever the override ships; no change needed beyond the clone). The RUN save
(`src/meta/runSave.ts`) never sees `EnemyFightConfig` and is untouched.

### 2.6 Feature A file-change list (one line each)

| File | Change |
|---|---|
| `src/run/encounter.ts` | Add `FoeDeckCard`, `FOE_DECK_SLOTS = 10`; `buildEnemyEncounter` 7th param `deck` with §1.1 semantics + rank echo. |
| `src/run/resolveBattle.ts` | `BattleFoeConfig.deck?`; pass `f.deck ?? null` into `buildEnemyEncounter` (:76-78). |
| `src/game/demoState.ts` | `EnemyFightConfig.deck?`; deep-copy it in `cloneEnemyTeam`. |
| `src/game/battleApi.ts` | `battleRequestOf` maps `deck: c.deck ?? null` (:22-33). |
| `src/game/battleTimeline.ts` | Pass `cfg.deck ?? null` at the `buildEnemyEncounter` call (:575); add `deck?` to the `EnemyFightConfig`-shaped inputs (type flows from demoState import). |
| `src/game/scenes/DesktopPrepScene.ts` | Pass `cfg.deck` (:63); DECK row + rank-stepper freeze + affix-row hide; open/close editor overlay. |
| `src/game/scenes/MobilePrepScene.ts` | Same three changes in the enemy sheet (:62, :298-309); sheet height grows (existing growth pattern :216-219). |
| `src/game/ui/foeDeckEditor.ts` | NEW — shared overlay editor per §2.2 (desktop + mobile profiles). |
| `tests/run/encounter.test.ts` (or new `tests/run/foeDeck.test.ts`) | Custom-deck resolution: verbatim pieces, tier clamp, gem socket, skip-affix/filler/rank, forceTier trump, boardSize growth, throw cases, deck-absent byte-identity. |
| `tests/run/resolveBattle.test.ts` | One request-with-deck case (event log reflects the custom board). |

9 files + tests. `server/battleApi.ts` and `functions/battle.ts` are untouched
(pure JSON pass-throughs).

---

## 3. Feature B — dual-use share codes

### 3.1 What a code carries (the loadout struct)

A code is ONE side's loadout — everything `demoState` carries that constitutes
"my sandbox build" (`demoState.ts:56-93`):

```ts
// src/run/shareCode.ts (pure — see §3.6)
export interface ShareLoadout {
  heroLevel: number;                    // demoState.heroLevel
  allocation: number[];                 // 6 buy-counts in STAT_ORDER (leveling.ts:30)
  board: Array<{ skillId: string; tier: SkillTier; slot: number; gemId: string | null }>;
  bag: Array<{ skillId: string; tier: SkillTier }>;   // re-packed on import
  gems: string[];                       // loose gem inventory ids
}
export interface DecodeResult { loadout: ShareLoadout; report: DecodeReport }
export interface DecodeReport {
  unknownCards: number;   // entries skipped: id-hash not in this build's book
  unknownGems: number;
  clamped: string[];      // human lines: "LV clamped to 255", "alloc re-fit", "tier floored on X"
}
```

**Not carried, deliberately**: seed (one tap to reroll; a *fight* code is a
different feature), enemy team (a code is one side — FIGHT IT is how a loadout
becomes the enemy; a whole-lobby code can be codec v2), gold/shop shelves
(session economy, not a build). Bag slot GAPS are not carried (bag order is
cosmetic — bag cards never fight; board slots ARE carried, they are mechanics).

### 3.2 The two apply paths (mappers live in NEW `src/game/shareActions.ts`)

**`captureLoadout(): ShareLoadout`** — read `demoState`: pieces sorted by slot
(canonical form → equal builds mint equal codes), `gem?.id ?? null`, bag
filtered to non-null in slot order, gemInventory verbatim, heroLevel,
allocation as the 6 STAT_ORDER buy counts.

**PLAY IT — `applyAsHero(loadout)`** (lossless):
- `demoState.pieces` ← board, minting fresh instanceIds through
  `createOwnedCard(skillId, tier)` (the sandbox's single stamping point with its
  tier floor, `demoState.ts:332-338`), then `slot` and `gem: gemBook[gemId]`.
- `demoState.bagSlots` ← bag re-packed by card size into the 10-slot rail
  (the `DEFAULT_BAG_SLOTS` packing rule, `demoState.ts:120-136`); overflow past
  10 slots → dropped with a report line (can only happen on a tampered-but-
  CRC-lucky or future-version code; count it, never silently).
- `demoState.gemInventory` ← gems; `heroLevel` ← level;
  `heroAllocation` ← allocation, then re-fit with the exact un-buy loop the LV
  stepper already uses (`DesktopPrepScene.ts:362-368`) so
  `applyPlayerLevelAllocation` can never throw (`leveling.ts:436-441`).

**FIGHT IT — `applyAsFoe(loadout)`** (writes Feature A's shape onto the ACTIVE foe):
- `foe.deck` ← board mapped 1:1 (`skillId/tier/slot/gemId`) — **card-for-card,
  tier-for-tier, gem-for-gem, slot-for-slot** identical to the source board.
- `foe.level` ← `heroLevel` — same PL budget by construction:
  `totalLevelPL(L) = (L−1)·3 = monsterLevelPL(L)` (`leveling.ts:359,381,540`).
- `foe.title` ← `'normal'` (levelDelta 0 — the import means "fight this build
  at its own level", `TITLE_PRESETS`, `encounter.ts:78-83`); `foe.rank` display
  comes from the deck echo (§1.1.5); `foe.affix` ← null; `foe.modifiers`
  left as-is (they are the challenger's dials, not the code's).
- Chassis `enemyId` stays the active foe's (§2.4). Then `syncPrimaryFoe()`.
- Disabled for an empty-board code (a card-less foe just stalls into attrition).

### 3.3 Asymmetry audit — what maps, what drops, and how the UI says it

| Loadout field | PLAY IT (hero) | FIGHT IT (foe) |
|---|---|---|
| board (cards+tiers+slots) | 1:1 | 1:1 (`foe.deck`) |
| socketed gems | 1:1 (Gem objects from gemBook) | 1:1 (`gemId`s; engine folds them for foes, state.ts:323 — including hero-scope Charms, which buff the FOE, correctly) |
| hero level | 1:1 | → `foe.level`, title NORMAL (same PL budget, see above) |
| stat allocation (hand spend) | 1:1 (re-fit if overspent) | **DROPPED** — the foe auto-spends the same PL through its chassis profile (`profileFor`, `leveling.ts:347`) |
| bag | 1:1 (re-packed) | **DROPPED** — a foe has no bag |
| loose gem inventory | 1:1 | **DROPPED** — no inventory, only sockets |

No silent drops: the FIGHT IT confirmation line (in the import dialog, §3.7)
states exactly: `imports board (N cards, gems kept) + LV → foe LV · drops: bag,
loose gems, stat spend (foe auto-spends its LV)`. PLAY IT states `replaces your
board, bag, gems, LV & stat spend`. Enemy-side extras that a code can NEVER
carry (title/modifiers/affix/chassis) are visibly the prep panel's own dials —
they belong to the challenger, not the shared build.

Gems on the foe side are **kept, not stripped** (the coordinator's question 3):
`BattleFoeConfig` today carries no board at all, but Feature A's `deck` field
ships `gemId`s and the engine already resolves gems on any side's pieces
(`state.ts:323`; proven by `parsePiece`'s `#gem` suffix on `FIGHT_FOE_BOARD`,
`fight.ts:170-198`). Stripping would break the round-trip property for no
technical reason.

### 3.4 Codec — exact format

**Text form**: `W1-` + Crockford base32 of (payload ‖ CRC).
Example shape: `W1-2C5RTJ0AZ8...` (uppercase minted; decoder is
case-insensitive and maps Crockford aliases `I,L→1`, `O→0`, ignores `-`/spaces
after the prefix so codes survive re-typing and chat re-wrapping).

*Alphabet tradeoff*: base64url is ~20% shorter but carries `_` (markdown-italic
bait in chat) and case-sensitivity + lookalikes (`l/I`, `O/0`) that a re-typed
code dies on. Crockford base32 decodes the common misreads by design.
**Committed: Crockford base32.**

**Payload = MSB-first bitstream** (a ~40-line BitWriter/BitReader pair inside
the codec; no dependency):

| # | Field | Bits | Notes |
|---|---|---|---|
| 0 | codecVersion | 8 | `1`. Decoder: `> 1` → hard reject (§3.5). |
| 1 | flags | 8 | reserved, must be 0 in v1 (nonzero → reject as newer-minor). |
| 2 | heroLevel | 8 | 1..255 (encode clamps, report line). |
| 3 | allocation | 6×8 | buy counts, STAT_ORDER `[maxHp, attack, magicPower, armor, magicResist, speed]` (`leveling.ts:30`). |
| 4 | boardCount | 4 | 0..10. |
| 5 | per board card | 20+2+4+1 (+20) | `cid20(skillId)` · tier (0=bronze..3=diamond, `TIER_ORDER` `encounter.ts:47`) · slot (0..9) · hasGem · [gid20(gemId)]. |
| 6 | bagCount | 4 | 0..10. |
| 7 | per bag card | 20+2 | `cid20` · tier. |
| 8 | gemInvCount | 6 | 0..63 (encode clamps; report). |
| 9 | per loose gem | 20 | `gid20`. |
| 10 | zero-pad | 0..7 | to byte boundary. |
| 11 | checksum | 16 | fold16(FNV-1a-32 over all preceding payload bytes). |

**Id references — `cid20`/`gid20`** (the stability decision):
`h = fnv1a32(idString); ref = (h ^ (h >>> 20)) & 0xFFFFF` — one 20-bit hash per
content id, computed against the id STRING, in two separate namespaces (card
refs only ever resolve against `skillBook`, gem refs against `gemBook`).

*Tradeoff vs. a sorted-index table*: an index against the canonical sorted-id
list (`skillsContent.ts:92`) is 8 bits/ref — but **adding any card renumbers
every id after it alphabetically**, so every code in the wild goes stale on
every content drop; pinning would require shipping historical id-list
registries per content version, which the README explicitly declines to build
("per-run version pinning is deliberately not built"). Hashed ids never
renumber: additions are free, and only a REMOVED/RENAMED card degrades — per
entry, reported, not whole-code.
**Committed: per-id 20-bit FNV fold.** Verified zero collisions across today's
174+53 ids (and zero even at 16 bits); at a doubled book (~450 ids) the birthday
risk is ~9%, and a collision is caught at AUTHORING time by a pinned uniqueness
test (new `tests/run/shareCode.test.ts`, running inside `npm test` like every
other content gate) — the escape is codec v2 with a wider hash, never a silent
mis-decode in the field.

**Checksum**: 16-bit fold of the same FNV-1a-32 (one hash algorithm in the whole
module). A single flipped/dropped character fails the CRC check loudly before
any field is trusted.

**Lengths** (computed from the layout above):
- Board-only starter (5 cards, no gems, empty bag/inventory): 221 bits → 30
  bytes with CRC → **51 chars** incl. prefix.
- **Realistic full loadout** (5-card board with 2 gems, 8 bag cards, 10 loose
  gems): 637 bits → 82 bytes → **135 chars**.
- Legal maximum (10 gemmed size-1 board cards, 10 bag, 63 gems): 2036 bits →
  257 bytes → **~415 chars** — still one chat message.

**Canonical form**: encode sorts board by slot and emits bag/gems in stored
order; `encode(decode(code).loadout)` reproduces the byte-identical code
(pinned by test T11) so codes are comparable as strings.

### 3.5 Failure UX — reject vs. partial-load

Two distinct failure classes, two behaviors:

1. **Structural failure → hard reject with a message.** Bad prefix, non-alphabet
   char, truncation, CRC mismatch, `codecVersion > 1`, nonzero flags, counts out
   of range, slot overlap/overflow. Message is one line in the import dialog:
   `"Not a valid code"` / `"Code from a newer game version"`. Rationale: the
   payload cannot be trusted field-by-field once framing or checksum is broken —
   partial-loading garbage is the CRC's whole reason to exist.
2. **Content drift → partial-load with a report.** A well-framed v1 code whose
   id-hash misses the current book (card/gem removed or renamed since minting):
   skip that entry, count it, load the rest. Dialog shows
   `"2 cards + 1 gem no longer exist — skipped"` above the PLAY IT / FIGHT IT
   buttons; FIGHT IT additionally disables if the surviving board is empty.
   *Tradeoff*: whole-code rejection is simpler and impossible to half-apply,
   but it turns every content rename into "all old codes are dead", which for a
   living-content game means shares rot in days; a skipped-entry report keeps a
   90%-intact build usable and says exactly what was lost.
   **Committed: partial-load with a report** (framing/CRC failures still hard-reject).

### 3.6 Module home (layer rules)

**`src/run/shareCode.ts`** — pure TS, no Phaser, no DOM: imports `skillBook`
(`src/data/skills`), `gemBook` (`src/data/gems`), types from `src/engine/types`,
`clampTierToCard`, and leveling constants. `src/run` already imports `src/data`
this way (`encounter.ts:27-30`) and sits inside the boundary checker's guarded
`PURE_DIRS` (`scripts/check-boundaries.mjs` — `['src/engine','src/data','src/run','src/meta']`),
so a NEW top-level `src/share` directory would be *outside* the checker's guard
until the script is edited; `src/run` gets the enforcement for free and matches
the architecture doc's description of the layer ("in-run state, pure TS:
loadout, …" — `docs/architecture.md` Layers; `loadout.ts` is the precedent for
sandbox-serving pure logic living there). Importable by `src/game` (both prep
scenes already import `src/run/encounter`), by `scripts/`, and by tests.

The demoState↔ShareLoadout mappers are game-layer glue in NEW
**`src/game/shareActions.ts`** (naming idiom: `draftActions.ts`, `shopActions.ts`),
because `OwnedBoardPiece`/instanceIds/`createOwnedCard` live in `src/game/demoState.ts`
and a pure module may not import them.

### 3.7 UI — copy & paste on both platforms (both-platforms rule is USER-LOCKED)

**Clipboard mechanics** (no affordance exists today, §0): NEW
`src/game/ui/codePrompt.ts` —
- `copyToClipboard(code)`: `navigator.clipboard.writeText` on the button's
  pointer handler (a user gesture, so no permission prompt in Chromium/Safari);
  on rejection, fall back to showing the code in the prompt overlay pre-selected
  with a "copy it manually" hint.
- `promptForCode(): Promise<string|null>`: appends a real
  `<textarea>` + CANCEL/APPLY buttons to `document.body` (position:fixed,
  centered over the canvas, styled to the UI palette), autofocuses; APPLY/Enter
  resolves the trimmed text, scrim/Escape resolves null, element removed either
  way. A real DOM field is the only paste surface that works everywhere —
  `navigator.clipboard.readText()` is permission-gated and absent in Firefox —
  and mobile keyboards/long-press-paste need a genuine input. DOM access from
  `src/game` is established (window/localStorage in `metaStore.ts:26-40`); the
  Phaser DOM plugin is NOT enabled (`src/main.ts:50-80`) and stays off — this
  overlay never enters the Phaser display list.

**Desktop (DesktopPrepScene)**: two compact buttons on the `YOUR DECK` label
line (`renderColumns`, :442 — the label is centered in a ~450px column with
free horizontal room; the CHOOSE FIGHT panel is at vertical capacity per its
own seed-row clamp :320-330, so nothing new goes there):
`[⧉ COPY CODE]` right-aligned, `[⇩ IMPORT]` beside it (28px tall, F.tiny).
- COPY: `captureLoadout` → `encodeLoadout` → clipboard → transient toast on the
  button label (`CODE COPIED · 135 CHARS`).
- IMPORT: `promptForCode` → decode → **import dialog** (scrim+panel overlay,
  the picker idiom): summary block (`LV 12 · 5 CARDS (2 GEMMED) · BAG 8 · GEMS 10`
  + report lines from §3.5) and three buttons — `PLAY IT` (applyAsHero),
  `FIGHT IT` (applyAsFoe on the active foe), `CANCEL`. Both apply paths end in
  `rerender()`; the changed columns/sheet are immediately visible proof.

**Mobile (MobilePrepScene)**: the footer ActionBar (:462-474) gains a third
item: `[CODE] [SEED n] [FIGHT(flex 2)]` (`renderActionBar` takes any item list,
`ActionBar.ts:8-34`). Tap CODE → small two-row overlay: `COPY MY CODE` /
`PASTE A CODE`; paste flows into the same `promptForCode` + import dialog,
full-screen variant, `PLAY IT` / `FIGHT IT` / `CANCEL` as an ActionBar row.

**Stretch (not v1)**: `?code=` param in `devLaunch.ts` that stashes the raw
string and has the prep scene open the import dialog on entry — the parser
idiom is ready (`devLaunch.ts:161-208`) but it adds a cross-module pending-state
channel; ship the in-app flow first.

### 3.8 Feature B file-change list

| File | Change |
|---|---|
| `src/run/shareCode.ts` | NEW — BitWriter/Reader, fnv1a32 + fold20/fold16, Crockford base32 enc/dec, `encodeLoadout`, `decodeCode`, `DecodeReport`, id-hash tables built once from the books. |
| `tests/run/shareCode.test.ts` | NEW — the §3.9 list incl. the id-hash uniqueness gate. |
| `src/game/shareActions.ts` | NEW — `captureLoadout`, `applyAsHero`, `applyAsFoe` (per §3.2). |
| `src/game/ui/codePrompt.ts` | NEW — DOM textarea prompt + clipboard copy with fallback. |
| `src/game/scenes/DesktopPrepScene.ts` | COPY/IMPORT buttons on the YOUR DECK line + import dialog overlay. |
| `src/game/scenes/MobilePrepScene.ts` | CODE footer button + copy/paste overlay + import dialog. |
| `tests/game/` (new `shareImport.test.ts`) | Mapper tests: applyAsHero mints instanceIds via `createOwnedCard`, bag re-pack, alloc re-fit; applyAsFoe writes `deck`/level/title and drops the documented fields. |

7 files. Depends on Feature A's `deck` field for FIGHT IT.

### 3.9 Codec test list (what QA writes)

1. **Round-trip**: `decode(encode(L))` deep-equals canonical L for: default
   sandbox loadout, `EMPTY_BOARD_OVERRIDES` loadout, empty-everything, max-legal.
2. **Round-trip as foe** (coordinator's property): encode(hero) → `applyAsFoe`
   → `buildEnemyEncounter(..., deck)` pieces equal the source board
   card-for-card, tier-for-tier, slot-for-slot, gem-for-gem; foe level =
   heroLevel; bag/gems/allocation absent and the report/drop lines say so.
3. **Tamper**: for each position in a valid code, flipping the char to another
   alphabet char → structural reject (CRC), never a loaded loadout.
4. **Truncation/extension**: any prefix/suffix mutation → reject.
5. **Stale version**: version byte 2 / nonzero flags → `"newer game version"` reject.
6. **Unknown id (content drift)**: mint with a synthetic hash absent from the
   book → entry skipped, `report.unknownCards/unknownGems` counted, remainder
   loads; FIGHT IT disabled when the surviving board is empty.
7. **Oversized/degenerate**: boardCount 11, overlapping slots, slot+size > 10,
   gemInvCount encode-clamp at 63, LV 0 and LV 300 (clamp+report), allocation
   overspend (re-fit via the un-buy order, report line).
8. **Alphabet forgiveness**: lowercase, `I/L/O` aliases, inserted hyphens/spaces
   all decode to the same loadout.
9. **Canonical stability**: `encode(decode(c).loadout) === c`; board order
   independence (shuffled pieces → same code).
10. **Id-hash uniqueness gate**: fold20 over all current skill ids and all gem
    ids (separately) has no duplicates — the authoring-time tripwire for a
    future collision.
11. **Tier floor**: a code carrying bronze for a silver-floored card decodes
    with the tier clamped + report line (mirrors `createOwnedCard`).

---

## 4. Implementation order (dependency-sorted), sizes, test risk

| # | Task | Size | Depends on |
|---|---|---|---|
| 1 | `FoeDeckCard` + `buildEnemyEncounter(deck)` + `BattleFoeConfig.deck` + resolver tests | **M** | — |
| 2 | Plumbing: `demoState.deck` (+clone), `battleRequestOf`, `battleTimeline:575`, both prep scenes pass `cfg.deck` | **S** | 1 |
| 3 | `src/run/shareCode.ts` codec + full test list (§3.9 T1,3-11) | **M** | — (parallel with 1) |
| 4 | `src/game/shareActions.ts` mappers + mapper tests (T2 lands here) | **S** | 1, 3 |
| 5 | `foeDeckEditor.ts` + DECK row / rank-freeze / affix-hide on BOTH prep scenes | **L** | 2 |
| 6 | `codePrompt.ts` + COPY/IMPORT buttons + import dialog (PLAY IT / FIGHT IT) on BOTH platforms | **M** | 4 |
| 7 | Playwright smoke of both flows at both viewports; layout-audit pass; optional `?code=` stretch | **S** | 5, 6 |

**Existing tests that could break** (brief the workers):
- `tests/run/encounter.test.ts`, `tests/run/resolveBattle.test.ts` — signature
  grows (optional param/field: should stay green; any frozen request-shape
  snapshot would need the optional field added).
- `tests/game/battleTimeline.test.ts`, `tests/game/battleContextSeam.test.ts` —
  `BattleTimelineInput`/`EnemyFightConfig` fixtures gain an optional field (green
  unless exhaustively shape-checked).
- `tests/game/controlLayoutAudit.test.ts`, `actionBarFit.test.ts`,
  `pointerConsumptionAudit.test.ts`, `battlePanelOverlapAudit.test.ts` — the
  REAL risk: new buttons/rows/overlays on both prep scenes are exactly what
  these audits gate (tap-target size, overlap, pointer consumption after
  `rebuildScene`). Budget time in tasks 5–6 for them.
- `tests/run/packFights.test.ts` / determinism & balance audits — must stay
  untouched; nothing here edits the engine or pricing (deck-absent resolution
  is byte-identical by construction).

## 5. Left for the user (short)

1. **Chassis semantics of FIGHT IT** — spec'd as "active foe keeps its
   name/affinities/stat profile" (no new catalog enemy, §2.4). If a perfectly
   neutral mirror is wanted instead, it costs a `sandboxOnly` enemy flag + pool
   filters + fingerprint churn — a user-level tradeoff.
2. **Whether elite-affix chips should coexist with a custom deck** (spec'd:
   hidden/cleared; the affix card can be added by hand) — pure taste.
3. Everything else is committed above.
