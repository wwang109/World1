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
- **Modifiers**: one additional DISTINCT id from the **escalation pool**
  (`ENEMY_MODIFIER_IDS` — every `MODIFIER_PRESETS` entry NOT flagged
  `affix: true`, today `diamond`/`swift`) unlocks every
  `MODIFIER_PER_OVERFLOW_FIGHTS` (5) fights past `MAX_LEVEL`, capped at the
  pool size; level keeps climbing after this axis plateaus.
- The encounter itself is built additively over the Bronze floor by
  `buildEnemyEncounter` (`src/run/encounter.ts`): base monster + Title preset
  (rank/stat dials) + Level (priced stat economy) + Modifiers + one Elite
  Affix.

## Elite affixes (`eliteAffixIdFor`, `src/run/encounter.ts`)

`elite` used to be a pure STAT RUNG — +2 levels, +2 rank, +1 **generic** filler
card off `EXTRA_CARD_POOL`. Combat is fully automatic, so a fight that is only
numerically bigger asks the player's deck nothing; the only place a title can
create interest is by changing **what the deck has to answer**.

**Every elite fight now carries EXACTLY ONE affix**, dealt from
`ELITE_AFFIX_IDS` (the `MODIFIER_PRESETS` entries flagged `affix: true`) and
surfaced on `EncounterUnit.affix` — so `previewEncounter`
(`src/game/runStore.ts`), which returns the SAME `rollEncounter` the FIGHT
button runs, names it **before** the fight. Look the id up in
`MODIFIER_PRESETS` for its `name`/`blurb`.

| affix | card installed | what it taxes | answered by |
|---|---|---|---|
| `braced` BRACED | `braced_pike` | **one damage property** — −20% incoming physical, and `guard` never matches a different property | magical (`arcane_bolt`, `fireball`, `shadow_bolt`) or TRUE (`void_pierce`, `purging_strike`, `soul_rend`, `annihilation_strike`) hits, which a physical guard cannot see; or `expose` to pay it back (`piercing_arrow`, `ruinous_hex`, `sundering_roar`) |
| `hobbling` HOBBLING | `hamstring` | **tempo** — `slow` +16 weight on your next action, and card weights are constants so this tax never decays | build LIGHT: weight-8 cards (`twin_slash`, `purging_strike`, `arcane_bolt`, `static_jolt`) pay 24 to act where a weight-20 anchor pays 36; and every point of SPD buys it back. Held on the piece, not as a status, so `cleanse` does NOT answer this one — board construction is the whole answer |
| `leeching` LEECHING | `leeching_fang` | **the clock** — 45% lifesteal on a scaling hit | the anti-heal world rule: each affliction CATEGORY standing on the elite cuts its drain 20%, cap 60% — a DoT (`hemorrhage`, `cinder_dart`), a stat debuff (`armor_break`, `hex_of_frailty`), an `expose` (`piercing_arrow`); or burst |
| `venomous` VENOMOUS | `second_bite` | **shields and heals** — poison bypasses shields, is an anti-heal category on you, and the card's own exploit pays +4 more on an already-poisoned target | `cleanse` removes the stacks and disarms the exploit (`purify`, `purge_the_rot`, `graveside_rite`, `poison_ritual`, `penitent_mending`, `warding_prayer`); or `ward`, which prevents the ailment outright (`unbreakable_stance`, `umbral_ward`, `sanctified_vigil`, `verdant_rebuke`) |

- **PL cost: ZERO, by construction.** The affix's card CONSUMES the title's own
  `extraCards` allowance instead of adding to it, and every bronze card in the
  book audits to exactly one bronze tier budget (100 deci-PL). Same card count,
  same slots, same rank distribution, same `soloThreatDeci`. No affix strength
  was ever chosen, so none can be mis-tuned.
- **Threat-NEUTRAL, checked not assumed.** An affix that swaps a scaling (+ATK)
  filler swing for a flat defence quietly makes elites EASIER: over an identical
  288-fight probe, hero winrate against the plain filler was 19%, but
  `bastion_stance` took it to 33%, `frost_ward` 35%, `ward_of_silence` 27%. The
  four shipped cards measured 19-21%. Every affix is therefore "an offensive
  card carrying a rider", never a pure defensive cast.
- **And the payload has to keep pace with the ladder.** There is deliberately NO
  thorns affix, despite thorns being the most interesting hit-count tax in the
  book: a reflect is armor-mitigated with a min-1 floor (`reflectThorns`), so a
  bronze pile of 5-8 stacks degrades to 1 damage per hit against any hero who
  bought armor at all, at every depth. Each shipped affix pays in a currency
  that does not decay — a percent (`braced`, `leeching`, `venomous`'s anti-heal),
  a shield bypass (`venomous`'s poison), or flat weight against card weights
  that are themselves constants (`hobbling`).
- **NO `Rng` draw.** The deal is `eliteAffixIdFor(seed, fightNumber)` — its own
  `hashSeed` domain, no `Rng` instance, exactly the `biome.ts` precedent — so it
  cannot shift `rollEncounter`'s pack-variant or enemy-id draws, and the frozen
  map-structure fingerprint (`tests/run/biomeDeal.test.ts`) is untouched.
- Keyed on the FIGHT NUMBER, so all three of a fight column's risk options
  agree which affix that rung carries. Only an ELITE title carries one: `'easy'`
  caps an elite back to `'normal'` and `'hard'` promotes it to `'boss'`, and
  pack members are `mob`/`normal` (`capPackTitle`) so **no pack is ever
  affixed**.
- **BOSSES GET NO AFFIX** (the design fork). A boss is telegraphed BY NAME a
  whole band ahead by its biome's boss shortlist, and its authored kit IS its
  behavioural signature; a rolled affix on top would blur the one fight the
  player can prepare for specifically. Affixes are what makes an elite a
  DIFFERENT problem from a boss, so the ladder alternates a rolled-shape problem
  (elite) with a known-shape one (boss) instead of stacking both.
- The affix is **not** in `EncounterUnit.modifiers`, so `battleGoldReward`'s
  `modifiers.length` difficulty term (and therefore fight gold) is unchanged.
- Rules pinned in `tests/run/eliteAffix.test.ts`.

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
- **BASE prices**: cards by offered tier via `GOLD_PRICE_BY_TIER` (bronze 2 …
  diamond 5, shop `priceDelta` folded by `goldPriceOfCardForShop`); gems via
  `goldPriceOfGem` (monotonic in the gem's own PL, one rung per rarity band) —
  Common 1, Rare 2, Epic 3, Legendary 4 gold, each rung a flat 20 deci-PL/gold
  (Legendary bumped from 3, 2026-08-09: the 46→35 gem migration left Legendary
  as a genuinely build-defining band, resonant_echo/the Echo among them. Epic
  split out of the shared Rare/Epic rung, 2026-08-18: the shared rung had
  priced Epic at 30 deci-PL/gold, a 1.5x outlier against the flat 20 everywhere
  else in the gold economy).
- **Depth price scaling** (2026-08-30): every SHOP-side gold number — card
  offers, gem offers and the REROLL toll — is the base above times
  `priceScaleNum(wave) / PRICE_SCALE_DEN` (`src/run/shop.ts`), round-half-up,
  keyed off the shop node's OWN wave (not the saturating
  `shopStockDepthForWave` band). x1.0 through wave 5 · x3.0 at wave 25 · x6.0
  at wave 100 · x10.0 at 200, and never flat. WHY: measured over real runs, a
  run's income is essentially FLAT past wave 40 (~11 gold/wave) while spend
  capacity is capped by the shelf, the 10-slot bag and the diamond merge
  ceiling — so a small surplus banks every wave, forever. On the old flat table
  that integrated to ~155 gold by wave 100 against a ~25-gold shelf: every
  offer on every shelf affordable, and the shop stopped asking a question. A
  higher flat table only moves the depth at which that happens. Gold remains an
  economy-pacing knob, NOT a PL/balance number — `PRICE`/`TIER_BUDGET_DECI`/
  `EFFECT_CAPS_DECI` are untouched. Invariants pinned in
  `tests/run/depthPricing.test.ts`.
- **Sell-back does NOT scale** — see "Selling" below.
- **Event `choice.cost` does NOT scale** (deliberate, 2026-08-30): an event
  toll is priced against a wave's INCOME, and income is flat, so a 2-gold toll
  is the same ~25-35% bite of a shop-bound wallet at wave 100 as at wave 5 once
  the shelf side stops hoarding. Scaling it too would double-tax the same flat
  income, invert every authored gold-for-gold gamble (`stake 2 → get 3`), and
  falsify the 32 catalog labels that state their own price in prose.

## Shops (`src/run/shop.ts`, themes in `src/data/shopTypes.ts`)

- **21 themed shops** as declarative card/gem filters; a shop NODE opens a
  single storefront (the full-catalog picker is Sandbox-only). The node's theme
  is decided at map generation and shown on the choice panel.
  16 -> 21 (2026-08-26, affinity-supply pass): the six single-ELEMENT stalls
  gained five single-WEAPON counterparts (Swordwright's Bench, The Cleaving
  Yard, Lancer's Rest, Fletcher's Loft, The Beastmoot). Before that, only
  elements had a stall whose whole shelf is one type — the "identity in one
  visit" an affinity card asks for — and weapon-typed affinity cards were
  effectively unbuildable (`tests/run/affinityReachability.test.ts` measures the
  floor).
- **Theme no-repeat**: draw-without-replacement bag per run, reshuffled when
  empty (shared `runMap.ts` logic).
- **Stock**: `rollShopStock(shopId, seed, depth, rarityGated, priceWave)` —
  deterministic; REROLL costs `rerollCostForNode` (escalating `1 + rerollCount`
  per node, then depth-scaled by the shop node's wave) and re-rolls the same
  theme's shelf (`baseSeed + rerollCount`). Tier split shifts with depth (depths 1-3 →
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
  `sellRunGem(state, pouchIndex)` — the reverse of a purchase. Half of the BASE
  price, rounded down, floored at 1 gold (`sellPriceOfCard`/`sellPriceOfGem`,
  `src/run/shop.ts`), and — unlike the buy side — NOT depth-scaled
  (2026-08-30): sell-back is a scrap value, not a market price. A sell price
  that tracked the current wave would let a run buy cheap early and cash out
  dear deep, and the gem pouch is uncapped, so that pump would be unbounded.
  Keeping it constant also makes "sell can never exceed buy" structural — buy
  is non-decreasing in wave, sell is constant — at every depth, theme and tier; a sold board piece's socketed gem returns to
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
  `nothing` · `gemChoicePick` (3-wide gem pick) · `sellGemPick`/`sellGem`
  (sell a pouch gem at `sellPriceOfGem`). All outcomes are
  deterministic — the gamble machinery and its `gambled` flag were deleted
  once every risk choice became a real pick.
- `upgradeCard` (2026-08-04, picker 2026-08-08): +1 tier
  (bronze→silver→gold→diamond) on ONE already-owned card the PLAYER picks.
  `upgradeCardOutcome` (`run/events.ts`) collects every eligible (non-diamond)
  owned card — board `pieces` first (ascending `slot`), then bag `bagSlots`
  (array order) — and returns a deferred `{kind:'upgradeCardPick', options}`;
  `applyUpgradeCardPick` bumps whichever `instanceId` comes back. Nothing
  eligible (no owned cards, or every one is already diamond) → `{fellBack:
  true}` plus `CARD_FALLBACK_GOLD`, reported as `upgradeCard`/`fellBack` (NOT
  re-kinded to `grantGold` like `grantCard`'s bag-full fallback — the reason
  differs, so the UI needs to say something different). Three Cinderworks
  (forge) events use it.
- **`mergeCards` (2026-08-26)** — THREE owned cards of ONE tier in, a CHOICE
  of three cards at tier+1 out; the only destructive card outcome in the
  vocabulary. Same-tier input (never "any 3, upgrade the lowest", which would
  let a player feed a Diamond into a Bronze trade) and three candidates out
  (never one rolled card, which would make it a slot machine). Two forge doors,
  both cost 0 — the three cards ARE the price: `ruined_anvil/beat_together`
  and `ember_pit/feed_the_coals`.
  - `mergeCardsPlan` (`run/events.ts`) is the SINGLE authority on all four
    decisions, and the gate, the offer and the finalizer all call it: **which
    tier** (the LOWEST non-diamond tier with 3 owned cards — three Golds are a
    built deck, three Bronzes are surplus), **which three** (bag array order
    first, then board by ascending `slot` — the inverse of `upgradeCard`'s
    board-first order, because this outcome DESTROYS what it touches), **what
    comes back** (`EVENT_CHOICE_SIZE` = 3 candidates drawn from cards
    `cardOfferableAtTier` at tier+1 that also FIT the post-removal bag), and
    **whether to offer at all**.
  - **Diamond**: the top rung has no tier+1, so a Diamond trio is never an
    input; a player whose only trio is Diamond gets the rung reported UNUSABLE
    (`isEventChoiceUsable`) — the same gating vocabulary `sellGem` uses for an
    empty pouch — rather than a button that spends three Diamonds for nothing.
    Both doors keep another non-`nothing` choice, so the EVENT still appears.
  - **No room for the output**: answered BEFORE anything is consumed, by not
    making the offer. Candidates are pre-filtered by `runBagHasRoomFor` against
    the state the removal leaves, so a shown offer cannot fail to deliver; if
    no tier can deliver, the rung is dark. `applyMergeCardsPick` is atomic —
    any failure returns the ORIGINAL state plus the `grantGold`/`fellBack`
    consolation, so no path consumes inputs without delivering an output.
    A socketed gem on a consumed board piece returns to the pouch, exactly as
    `sellRunCard` does.
  - The pending offer rides on `resolveEventChoice`'s return as an OPTIONAL
    `merge` field beside `outcome: {kind:'nothing'}` (nothing has happened to
    the run yet), NOT as a new `EventOutcome` member — `outcomeHeadline`
    (`src/game`) closes its switch on `never`, so a new member cannot be added
    without the Phaser phase. A client that ignores `merge` resolves the event
    as an inert no-op. **The UI phase is not wired yet**: read `merge`, render
    `merge.consumed` + `from`→`to` above `merge.candidates`, and call
    `applyMergeCardsPick` on a tap.
  - Measured over the real run layer, 120 seeds to wave 10: 83.3% of runs meet
    a usable merge door (64.2% with only one door — hence two), 1.32 merges per
    run, and a merging player ends wave 10 with 8.72 cards (5.49 bronze / 2.66
    silver) against the control's 11.11 (9.21 / 1.38) — ~2.4 cards of raw count
    traded for ~1.3 extra Silvers. `tests/run/cardMerge.test.ts`.
- No-repeat bags: a per-run `eventBag` plus per-theme bags
  (`eventThemeBags`), reshuffled deterministically via refill counters.
- Affordability: `isEventChoiceAffordable` (gold) and `isEventChoiceUsable`
  (gold PLUS any outcome-specific precondition — `sellGem`'s pouch,
  `mergeCards`'s plan) are the single predicates both the resolver and the UI
  use; `rollEventForNode` skips events with no playable choice at current gold.

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
| `encounter.ts` | Additive enemy resolver: titles, ranks, modifiers, elite affixes (`eliteAffixIdFor`, `ELITE_AFFIX_IDS`), `buildEnemyEncounter`, `buildAutoHeroSetup`; PACK constants (`PackVariant`, `PACK_VARIANT_WEIGHTS`, `MIN_PACK_FIGHT_NUMBER`, `capPackTitle`, `EncounterPack`) and budget helpers (`soloThreatDeci`, `packBudgetDeci`, `resolvePackMemberLevel`, `PACK_ACTION_ECONOMY_TAX_PCT`, `REFERENCE_ENEMY_DECK_SIZE`) |
| `leveling.ts` | `PL_PER_LEVEL`, `LEVEL_STAT_COST`, allocation math, monster auto-spend profiles |
| `shop.ts` | Shop filters/pools, gold prices, `rollShopStock`, `shopPoolInfo`, `battleGoldReward`, sell-back pricing (`sellPriceOfCard`, `sellPriceOfGem`) |
| `events.ts` | Event roll/resolve/bonus-draft, affordability + usability gates, no-repeat bags, the card merge (`mergeCardsPlan`/`applyMergeCardsPick`) |
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
