# Biome paths — proposal

> **Scope:** PROPOSAL (not yet built, not an owner doc). Design investigation for
> giving the endless run **legible paths** — bands of waves with a declared
> identity (mobs, boss, shops, events) the player can read *before* committing,
> chosen because they feed the deck being built. Nothing here is implemented.
> If accepted, `docs/run-structure.md` (LIVING, owner of run shape) absorbs the
> parts that ship and this file moves to `docs/history/`.
>
> Every number in §1 was measured against the real `generateRunMap` /
> `rollEncounter` / `rollShopStock` / `rollStartDraft`, not estimated. The
> scripts were throwaway (`.tmp/`, gitignored); §1.7 says how to reproduce them.

---

## 0. The ask, restated

In the user's words:

- *"create some sort of biome settings so certain events come at certain path
  same with the fights too so we can predict which boss mob might come up"*
- *"choosing paths once in a while that can branch into some sort of biome
  setting for different groups of mobs and boss fights"*
- *"we want somewhat predictable paths user can take and earn rewards to their
  deck build"*
- (separately) *"how about an extra battle for gold or levels"* as an event.

The load-bearing phrase is **"rewards to their deck build"**. Predictability is
not the goal by itself — the goal is that a fork in the road is a *deck-building
decision*: I look ahead, I see what a branch supplies, I take it because it
finishes the board I am trying to build. If the player cannot read the branch
ahead of committing, the feature does not exist.

---

## 1. What exists now, measured

### 1.1 The map is not a graph

`src/run/runMap.ts` builds a **list of columns**, not a graph. There are no
edges. `availableChoices` (`src/run/runState.ts:519`) returns
`columnAt(map, state.depth + 1)` — *every* node in the next column is reachable
from wherever you are, always. "Branching" today means "pick 1 of 3 in the next
column", with no consequence that outlives that node.

A wave = 2–3 stop columns (exactly 3 choices each, at most one shop) + one
mandatory fight column (3 risk options: easy / standard / hard) or, every 5th
wave, a single-node boss column.

`RunNodeKind` is a flat `'event' | 'shop' | 'fight' | 'boss'`. There is no
biome, region, zone, band, or path identity of any kind on `RunNode`, `RunMap`,
or `RunState`.

### 1.2 Lookahead is exactly one column

The run map scenes render `choices()` — the next column only. `RunRouteBoard`
(`src/game/ui/RunRouteBoard.ts`) draws the columns as
`{depth, wave, nodeCount, state}` dots: it knows how many nodes a future column
has and nothing about what is in them. The *only* forward-looking information in
the entire run UI is `renderRunBossCountdownPanel` — "boss in N waves" — and it
does not say **which** boss.

The fight at the end of the current wave is invisible until the player is
standing in front of its column, 2–3 stops later.

### 1.3 Variety per wave — 500 seeds, waves 1–10

| Measure | Value |
|---|---|
| Stop columns per wave | 2.50 avg |
| Event nodes **offered** in 10 waves | 70.0 avg (54–83) |
| Shop nodes **offered** in 10 waves | **4.96 avg** (1–9) |
| Waves (of 10) offering a shop at all | 4.96 |
| Distinct shop **themes** seen in 10 waves | **4.96 of 21** |
| Distinct event themes per wave (of 6) | 5.34 |
| Shop columns / stop columns | 0.198 |

Those "offered" counts are an upper bound: a shop node competes with two events
in its column, so **actual shop visits ≤ 4.96 in ten waves**, and each visit
consumes the stop that could have been an event.

### 1.4 A *specific* shop is effectively unreachable

The shop theme is drawn from a 21-entry no-repeat bag. Per theme, over 500 seeds:

```
first wave a SPECIFIC theme is offered (waves 1..10)
  emberworks      never-in-10w  76%   seen-by-w5  14%
  frosthold       never-in-10w  78%   seen-by-w5  11%
  swordwright     never-in-10w  73%   seen-by-w5  11%
  beastmoot       never-in-10w  77%   seen-by-w5  12%
  ... every one of the 21 themes sits in the same 72–80% / 10–16% band
```

Three quarters of runs never see any *named* stall in their first ten waves.
This is the mechanism, not bad luck: ~5 draws from a 21-entry bag.

### 1.5 Supply of a chosen card type — the real constraint

`tests/run/affinityReachability.test.ts` already proved gold is not the
constraint and that every one of the 11 card types now has a single-type stall.
What it does not measure is whether the player ever *reaches* the stall. Rolling
every shelf that is offered in waves 1–10 through the real `rollShopStock`, over
400 seeds:

| Type | Offers seen (avg) | P(≥3 offered) | P(zero offered) |
|---|---|---|---|
| element:fire | 2.10 | **29%** | 46% |
| element:frost | 2.00 | 28% | 43% |
| element:lightning | 2.08 | 27% | 41% |
| element:dark | 2.24 | 31% | 38% |
| element:holy | 2.61 | 36% | 32% |
| element:nature | 2.95 | 41% | 31% |
| weapon:lance | 2.50 | 33% | 35% |
| weapon:bow | 2.78 | 41% | 34% |
| weapon:axe | 2.88 | 41% | 26% |
| weapon:sword | 3.00 | 43% | 25% |
| weapon:beast | 3.13 | 47% | 28% |

`IDENTITY_THRESHOLD` is 3. **A player who decides at wave 1 to build Fire has a
29% chance of even being offered three Fire cards by wave 10, and a 46% chance
of being offered none at all** — before affordability, before choosing the shop
node over its two event siblings, before wanting a *particular* Fire card.

The start draft does better but is not steerable: over 400 seeds it can reach 3
of *some* type 90% of the time, but 3 of a **specific** type only:

```
axe 42% · sword 30% · lance 26% · holy 17% · beast 15% · nature 14%
dark 8% · lightning 8% · frost 4% · fire 3% · bow 3%
```

"Some type" is not a decision. The player cannot walk into the draft intending
to build Fire.

Catalog for reference: 156 cards, 24 affinity-gated, spread 10–22 cards and 1–3
gated cards per type.

### 1.6 Fights are varied; the boss is not

Enemy roster: 22 units — 21 in `FIGHT_POOL`, **1 in `BOSS_POOL`**.

Over 300 seeds × 20 waves (4 800 fight columns, 1 200 boss nodes):

- all three fight options are different enemies: **62%**
- all three are three different type identities: **43%**
- all three share one type identity: 8%
- **boss node enemy: `wolf_king`, 100% of the time. Always. Every seed, every
  boss wave, forever.**

Depth gating (`src/run/enemyDepth.ts`) already narrows *which* mobs may anchor a
fight: 6 eligible anchors at fights 1–4, 11 at 5–8, 10 at 10–15, 5 from fight 20
on. So the ladder already has a coarse "what lives here" rule — it is derived
from `goldReward`, carries no theme, and is invisible to the player.

Reachable type identities across a fight column's three options, by fight number:

```
fights 1-4   5 types (fire, holy, nature, beast, bow)
fights 6-8   9 types
fights 9-12  8 types
fights 13-16 5 types
fights 17+   3 types (axe, beast, sword)
```

The user's ask — *"predict which boss mob might come up"* — currently has no
possible answer other than "the Wolf King", and no ask at all past that.
**Biomes cannot deliver a predictable boss until the roster has more than one
boss.** That is a content prerequisite, not a mapgen problem (see §5, Phase 2).

### 1.7 Events: 32 events, 74 choices, and almost no deck-building steer

(The brief said 24/72; the catalog has grown since.)

| Theme | Events | Choices touching the deck |
|---|---|---|
| cache | 6 | 4/16 |
| forge | 6 | 5/13 |
| market | 5 | 2/11 |
| omen | 5 | 2/12 |
| recruit | 5 | 5/10 |
| training | 5 | 3/12 |

11 outcome kinds are declared in `EventOutcomeSpec`; 9 appear in the catalog
(`loseGold` is declared and unused). Of the 21 choices that put a card into the
deck or upgrade one, **exactly 4 carry any type filter at all**, and none is
single-type:

```
recruiter/pick_weapon         weapons: sword|axe|lance|bow|beast
sellsword_camp/browse_armory  weapons: sword|axe|lance|bow|beast
beast_nest/raid_prepared      weapons: bow|beast
crossroads_shrine/tithe       elements: holy|dark
```

So: **the event layer cannot currently feed a type identity.** A theme predicts
the *flavour* of a reward (recruit → drafts, training → levels, forge →
upgrades), never its type. That is a large, cheap surface for biomes to bind to.

No outcome starts a fight. There is no machinery at all for "an extra battle for
gold or levels" (§4).

### 1.8 Reproducing these numbers

The measurement scripts were throwaway `tsx` files under `.tmp/` (gitignored),
each a plain import of the real modules — no test harness, no fixtures. They:

1. build maps with `ensureWavesThrough(generateRunMap(seed), 10)` over 300–500
   seeds and census the columns;
2. roll every offered shop shelf through the real
   `rollShopStock(shopId, shopSeed, shopStockDepthForWave(wave))`;
3. type every offer with `cardType` from `src/engine/combat/typeIdentity.ts`;
4. roll fight/boss options through the real `rollEncounter` by handing it
   `{...createRun(seed), map, status:'active', currentNodeId: node.id}` — it
   reads nothing else.

If any of this is re-measured after a content change, re-measure rather than
citing this table.

---

## 2. The design

### 2.0 Does the type-system connection hold up? — yes, with one deliberate fork

The brief proposes exploiting the type system (5 weapons, 6 elements, the
`affinity` modifier that only pays on a board with 3+ of one type). **Agreed,
and it is the strongest argument for the feature.** Three reasons, in order of
weight:

1. **It solves a measured problem with an existing mechanism.** §1.5 is the
   problem: a *chosen* type is offered ≥3 times in ten waves 27–47% of the
   time. Adding more stalls does not fix it — 21 themes into ~5 draws is the
   bottleneck, and a 22nd theme makes it *worse*. Biasing *which* stalls the
   existing bag hands over is the only lever that moves the number without
   adding content. Projected below: 29% → 98%.
2. **It gives the branch a name a player can hold.** "The Emberwaste" means
   *fire mobs, fire shelves, fire-leaning events, a fire boss*. That is one
   word carrying a whole plan. Compare the alternative framings — "the hard
   path", "the gold path" — which are risk/reward dials the fight column
   (easy/medium/hard) already provides.
3. **The types are already authored everywhere.** Every one of the 22 enemies
   has an element or weapon affinity. All 11 single-type stalls exist. 156 cards
   are typed. The biome layer is *routing over existing data*, which is the same
   move `src/run/enemyDepth.ts` already made (derive from `goldReward`, author
   nothing new).

**Projected payoff**, modelling the §2.3 shop mechanism over 400 seeds,
waves 1–10 (approximate — reshuffles modelled with an independent Rng, so this
estimates the mechanism's effect, it is not a byte-exact preview):

| Biome lean | Offers of the lean type, w1–10 | P(≥3) | P(zero) |
|---|---|---|---|
| fire (today) | 2.10 | 29% | 46% |
| **fire (Emberwaste)** | **7.62** | **98%** | **1%** |
| frost (today) | 2.00 | 28% | 43% |
| **frost (Frostmarch)** | **7.68** | **98%** | **0%** |
| axe (today) | 2.88 | 41% | 26% |
| **axe (Ironmoot)** | **9.31** | **100%** | **0%** |

**The caveat, and it needs a deliberate ruling.** A biome full of Fire mobs is
not neutral ground for a Fire board. From `src/engine/elements.ts`:

- Same type vs same type is **neutral** both ways — a Fire board attacking Fire
  mobs is not penalised. Good; the obvious trap does not exist.
- But `ELEMENT_BEATS` means the type that *beats* the biome's lean gets +50%
  against its mobs, and the biome's own type takes +50% from that counter.
  Frost beats Fire. So the Emberwaste **supplies Fire and rewards Frost**.

That is a genuine, legible tension, not a bug — *enter a biome with its counter,
leave it with its own type, feeding the next choice*. But it must be chosen on
purpose:

> **DECISION 1 — what a biome supplies.**
> **(a) Its own type only** *(recommended)*. The Emberwaste sells Fire and is
> full of Fire mobs. Entering with Frost farms it at +50% but you must have
> sourced Frost elsewhere; entering to *build* Fire is neutral and safe. This
> makes the *sequence* of biomes matter, which is the whole point of a path.
> **(b) Its own type plus its counter.** Emberwaste sells Fire and Frost. Kinder
> and more forgiving; loses the sequencing decision and blurs the biome's name.
> **Tradeoff:** (a) is a sharper decision and needs the UI to state the matchup
> plainly, or it reads as a gotcha. (b) is safer and duller.

### 2.1 Where a biome attaches — per **wave band**, not per node or per edge

Three candidates were considered.

**Per node.** Rejected: a node is one stop; lookahead is already one column;
this adds a label without adding a decision.

**Per branch, with real graph edges.** Rejected — see §6.1. The map has no edge
concept at all; adding one touches `runMap`, `runState.availableChoices` /
`chooseNode` / `depth`, `RunRouteBoard`, and both map scenes, to deliver path
exclusivity the band model already delivers.

**Per wave band — recommended.** A **band** is exactly one boss block:
`BOSS_EVERY` (5) waves, ending in that band's boss.
`bandIndexOf(wave) = Math.floor((wave - 1) / BOSS_EVERY)`.

This is right because:

- The run already has a five-wave rhythm ending in a boss. "Choose your next
  five waves and the boss at the end of them" *is* the user's sentence.
- It needs **no graph change**. The map stays a column list. A biome is a
  property of a band, and every generator/pool lookup reads it as a filter.
- It is long enough to matter (a whole board's worth of shopping) and short
  enough to re-decide often (every 5th fight).

### 2.2 The data shape

New file, `src/data/biomes.ts` — declarative content only, no logic, mirroring
`shopTypes.ts` / `events.ts`:

```ts
import type { Element, WeaponType } from '../engine/types';
import type { EventTheme } from './events';

/** The type a biome leans into — the whole reason a player picks it. */
export type BiomeLean =
  | { kind: 'element'; type: Element }
  | { kind: 'weapon'; type: WeaponType };

export interface BiomeDef {
  id: string;
  /** "The Emberwaste" — what the fork panel and band banner say. */
  name: string;
  /** One line, fork-panel sized. "Ash and cinder. Fire mobs, fire shelves." */
  tagline: string;
  lean: BiomeLean;
  /** Enemy ids this biome PREFERS for its fight nodes. Sorted array, never a
   *  Set — pool order fixes the draw (tests/run/contentPoolOrder.test.ts). */
  mobs: readonly string[];
  /** The boss at the end of this band. The "predict the boss" promise. */
  boss: string;
  /** Shop theme ids this biome PREFERS. Sorted array. */
  shops: readonly string[];
  /** Event themes this biome PREFERS. */
  eventThemes: readonly EventTheme[];
  /** Art key for the band banner / fork panel (docs/art-prompt-pack.md). */
  art: string;
}

export const biomeCatalog: Record<string, BiomeDef>;
/** Id-sorted, for deterministic iteration. */
export const biomeIds: readonly string[];
```

**Membership lives here as id lists. Do not add a `biome` field to `EnemyDef`,
`SkillDef`, or `ShopTypeDef`** — see §6.3. This is exactly the precedent
`src/run/enemyDepth.ts` set when it derived depth bands from existing data
rather than authoring a 13th enemy field, and it keeps the frozen content JSON
(`src/data/content/*.v1.json`) and its parity/idempotency tests out of the blast
radius entirely.

A starting catalog of 5–6 biomes covering the types the roster can actually
staff (§1.6: fire, holy, nature, beast, bow early; axe/sword/lance/lightning/
dark later) is enough. Do not author 11.

The ledger, on `RunMap`:

```ts
export interface RunMap {
  seed: number;
  depths: RunNode[][];
  /** Chosen biome id per band, index = bandIndexOf(wave). Plain data, exactly
   *  like the theme bags — so the lazy rebuild-from-wave-1 stays valid. An
   *  index past the end (or the whole field absent) means "unchosen": that
   *  band uses `defaultBiomeFor(seed, band)`, so every existing caller of
   *  `generateRunMap(seed)` keeps compiling and keeps its current behaviour. */
  biomes?: readonly string[];
}
```

And on `RunNode`, for rendering and for the pool lookups:

```ts
  /** The band's biome id, stamped at generation on EVERY node. Display + pool
   *  routing; never a gameplay branch of its own. */
  biomeId?: string;
```

### 2.3 How a biome binds to shops, events and mobs — **filters, not new dice**

This is the most important implementation rule in the proposal:

> **Every biome binding is a preference or a filter over a pool that is already
> being drawn from. No binding spends a new `Rng` call.**

That keeps the determinism invariant ("all randomness flows through `Rng` in a
fixed call order") untouched, keeps the map's *shape* byte-identical, and makes
every change reviewable as "which array did the existing draw index into".

**Shops.** `generateWave`'s `nextShopTheme` already scans the no-repeat bag with
`findIndex` for the first entry eligible by `minWave`. Add one preference pass
in front of it:

```ts
// prefer this band's biome stalls; fall back to today's behaviour exactly.
let idx = shopThemeBag.findIndex((id) => eligible(id) && biome.shops.includes(id));
if (idx === -1) idx = shopThemeBag.findIndex(eligible);
```

Zero extra Rng calls, no new randomness, the 21-theme no-repeat bag survives
intact, and the biome's stall is drawn *whenever one is still in the bag*. This
is the mechanism §2.0's projection measures.

**Events.** `nextEventThemes` already does `findIndex(t => !drawn.includes(t))`.
Same one-line preference for `biome.eventThemes` with the same fallback.

Binding events by *theme* is only half the value, because §1.7 shows a theme
does not predict a reward's type. The other half is content: give the
card-granting outcomes type filters. `EventOutcomeSpec` already supports it —
`cardChoice`/`bonusDraft`/`grantCard` all take a `CardFilter`, and
`CardFilterClause` already has `elements` / `weapons`. **No new outcome kind is
needed to make events feed an identity**; it is a content pass over
`src/data/events.ts`. The cheapest version that fully closes §1.7's gap:
a biome-leaning `cardChoice` in the `recruit` and `forge` themes whose filter is
`[{ elements: [biome.lean.type] }]`. That requires the resolver to know the
band's biome — pass it into `resolveEventChoice` (the node already carries
`biomeId`), or resolve the filter at roll time.

**Mobs.** `rollEncounter` already narrows via `anchorPoolFor` / `fillerPoolFor`,
which filter an array and **fall back to the full pool if the filter empties**.
Add the biome as a second narrowing with the identical fallback:

```ts
const depthPool = anchorPoolFor(pool, bands, gateDepth);
const biomePool = depthPool.filter((id) => biome.mobs.includes(id));
const anchorPool = biomePool.length > 0 ? biomePool : depthPool;
```

Again zero new Rng calls — only which array `rng.int(pool.length)` indexes.

**Boss.** A boss node reads `biome.boss` directly instead of drawing from
`BOSS_POOL`. This is the line that makes the user's sentence true, and it is
blocked on boss content (§1.6, §5 Phase 2).

**Prefer, never silo.** Every one of the above degrades to today's behaviour
when the biome's list is empty or unavailable. That is not defensive
boilerplate — it is what keeps `tests/run/contentReachability.test.ts` and
`tests/run/affinityReachability.test.ts` trivially green (§4), keeps every
enemy reachable at every depth, and stops a wrong biome pick from being
unrecoverable.

**Do not mix the biome id into the wave seed.** `generateWave` seeds from
`hashSeed('wave', seed, wave)`. Leave that alone. If biome only *filters
content*, the map's structure (stop counts, choice counts, shop placement) is
byte-identical to today for every seed, and the diff a reviewer has to hold is
"which pool did this draw index into". Mixing the biome into the seed would
change every structural roll for no design gain and would make every
before/after comparison unreadable.

### 2.4 How the player sees it — the part the feature *is*

Four surfaces, in ascending cost. The first two are worth shipping even if
nothing else here is built.

**(a) Name the boss.** `renderRunBossCountdownPanel`
(`src/game/ui/RunStatsPanel.ts:167`) already says "boss in N waves". The boss
node is deterministic and previewable through the same pure `rollEncounter` the
map choice panels use — `previewEncounter` already does exactly this for the
next column, and nothing stops it being called on a future boss node. Add the
boss's **name, level and art**. Both platforms.

**(b) Band banner.** A persistent strip on the run map: biome name, lean chip
("FIRE"), and the boss line. This is the "where am I and what does it supply"
read, and it is one render function.

**(c) Route board tint.** `RunRouteBoard` already walks the columns and knows
each one's wave; tinting each column by its band's biome makes the map's shape
legible at a glance. Cheap, cosmetic, high value.

**(d) The fork panel.** Before a band, one panel per candidate biome:

```
  THE EMBERWASTE                    [FIRE]
  Ash and cinder. Fire shelves, fire mobs.
  MOBS   Ember Imp · Pyre Acolyte · Toxic Druid
  BOSS   Cinder Tyrant · LV 15 · BOSS
  SHOPS  Emberworks · Arcanum · Alchemist
  ---
  Frost hits these mobs for +50%.
```

That last line is not decoration — it is what makes DECISION 1(a) fair rather
than a gotcha.

Implementation notes for (d): reuse `RunChoiceViewModel` with extra rows rather
than a new panel type; respect `runChoicePanelMinHeight` (a too-short row
silently ellipsizes the detail line — the documented 2026-08-19 bug); and cap
the fork at **3 options**, the same mobile bound `EventDef.choices` lives under
(`src/game/ui/runEventStoryLayout.ts`, proven at N=3 in
`tests/game/runEventStoryLayout.test.ts`). Both platforms, never a scene fork.

**The predictability contract this establishes**, and it should be stated in
`docs/run-structure.md` when it ships: *predictable in kind, surprising in
detail.* The band's character — its types, its mob family, its boss, its
stalls — is fully readable at the fork. Which specific event, which specific
shelf, which of three risk tiers, stay hidden until the column. Do not be
tempted to reveal individual future nodes; that removes the reason to walk the
map at all.

### 2.5 Choosing the biome — the fork

> **DECISION 2 — is the biome chosen or dealt?**
> **(a) Dealt (seeded).** Each band's biome is a pure function of
> `(seed, band)`. The player reads it ahead but cannot steer. Almost free: no
> ledger, no fork column, no new node kind, no `chooseNode` change.
> **(b) Chosen at a fork** *(recommended, and the user's actual ask)*. A fork
> column after each boss offers 2–3 biomes; the pick is recorded and the next
> band generates from it.
> **Tradeoff:** (a) delivers all of the *supply* fix and all of the
> *legibility*, and none of the *agency*. It is a genuinely good intermediate
> ship (§5 Phase 1) and it de-risks (b) by proving the plumbing first. But it is
> not what was asked for, and shipping only (a) would be a bait-and-switch.

The fork, concretely:

- New `RunNodeKind` member `'fork'`. A fork column holds 2–3 `'fork'` nodes,
  each carrying a `biomeId`, and sits **immediately after a boss column** — it
  is the first column of the band it decides.
- **No fork before the first band.** The run starts in a fixed starting biome.
  A brand-new player with 4 bronze cards has no basis for the choice, and
  inserting a column before depth 1 breaks several depth-1 tests for nothing
  (§4).
- Candidate biomes come from `sampleDistinct(rng, biomeIds, 3)` off a
  band-scoped Rng (`hashSeed('fork', seed, band)`) — a fresh Rng per band, same
  idiom as `generateWave`, so it does not disturb any wave's call order.
- `chooseNode` gains one branch: a `'fork'` node **resolves instantly** — it
  appends the biome to `map.biomes`, regenerates the map from wave 1 through the
  current horizon, advances `depth`, and does **not** set `currentNodeId`. No
  new scene. (Whether a fork pays `DAILY_INCOME` is a coin flip; recommend
  **no**, since it is a decision, not a day.)
- New pure transition, in `runState.ts`:
  `chooseBiome(state, bandIndex, biomeId): RunState`.

**The invariant that makes this safe**, and it must be a test:

> A wave in band *b* reads `biomes[b]` and nothing else. Therefore appending a
> biome for band *b+1* **cannot** change any wave in bands 0…*b*.

This is true *by construction* (each wave's Rng is seeded from
`hashSeed('wave', seed, wave)`, and the biome only filters pools within that
wave), not merely by convention. `chooseBiome` must additionally refuse a band
index at or below the current one, so a rebuild can never rewrite walked ground.
Determinism becomes "same `(seed, biomes)` → same map", which is still a pure
function and still reload-safe, because `biomes` is plain data living in state.

---

## 3. The extra-battle event

*"How about an extra battle for gold or levels."* Nothing in the events layer
can do this today: no `EventOutcome` starts a fight, and the battle plumbing is
hard-gated on combat nodes.

### 3.1 The thin-client constraint, stated exactly

`scripts/check-boundaries.mjs` forbids `src/game` from value-importing
`resolveBattle` / `combat/simulate`, directly or transitively. So the event
resolver **may not resolve a battle**. What it may do is produce a *battle
specification* — a deterministic, fully-resolved `EncounterPack` plus a seed —
which the client posts to the battle service exactly like any other fight, and
which comes back as an event log.

`buildEnemyEncounter` (`src/run/encounter.ts`) is pure and does not simulate;
building the pack in the resolver is fine.

### 3.2 The pieces, in dependency order

**1. Outcome kind** — `src/data/events.ts`, `EventOutcomeSpec`:

```ts
| { kind: 'battle';
    /** Named foe, or a filter resolved against the band's biome mobs. */
    enemyId?: string;
    /** Level relative to the current fight track. 0 = this wave's spec. */
    levelDelta?: number;
    title?: EnemyTitle;
    /** What a win pays. `level: true` is deliberately NOT offered — see below. */
    reward: { gold: number };
  }
```

**2. Deferred resolution** — `src/run/events.ts` gains `battleOutcome(...)`,
returning a deferred `EventOutcome` in the *same* "roll now, resolve later"
shape `bonusDraft` / `gemChoicePick` / `upgradeCardPick` already use:
`{ kind: 'battlePending', foes, seed, reward }`. Seed from
`hashSeed('eventBattle', node.eventSeed, choiceId)` — a fresh derivation, so it
disturbs no existing draw.

**3. The one genuinely new piece of state.** Unlike a `bonusDraft` pick, the
player *leaves the event scene*, plays a battle, and comes back — so the pending
battle must survive that trip and a reload:

```ts
  /** An event choice that started a fight, awaiting its verdict. Plain data. */
  pendingEventBattle?: {
    nodeId: string;
    choiceId: string;
    foes: readonly BattleFoeConfig[];
    seed: number;
    reward: { gold: number };
  };
```

**4. Battle input.** `src/game/battleContext.ts#runBattleInput` returns `null`
for a non-combat node. Add a branch: when `run.pendingEventBattle` is set, build
the `BattleTimelineInput` from it (`pieces`, `heroLevel`, `heroAllocation`,
`enemyTeam` from `foes`, `seed`). The client still only posts and renders — no
new combat capability crosses the boundary.

**5. Settlement — a NEW transition, not `recordBattleResult`.**
`recordBattleResult` throws unless the current node is a fight/boss, and applies
fight semantics: a life on a loss, **+1 hero level always**, `bossesCleared`,
`wins`/`losses`. None of that is right here. Add
`resolveEventBattle(state, { won }): RunState` in `runState.ts`.

**6. Scene routing.** Both event scenes gain a "fight" resolution path
(`setBattleContext(...)` → RunPrep → Battle), and RunPrep must return to the
**event** scene, not the map. Do this with a discriminator on `battleContext`
(`'run' | 'run-event'`) — **never** a forked scene (CLAUDE.md, both-platforms
rule). Desktop and mobile, same commit.

### 3.3 The rules that need the user's ruling

> **DECISION 3 — what an event battle costs on a loss.**
> **(a) One life**, exactly like a real fight *(recommended)*. Events are the
> "spend risk" leg of the run (`docs/run-structure.md`); a battle with no
> downside is a free gold button and the choice stops being a choice.
> **(b) Nothing** — you simply do not get paid. Safe, and inert.
> **(c) The stake** — the choice has an upfront gold `cost` that is lost.
> Already supported by `EventChoiceDef.cost` with no new machinery.
> **Tradeoff:** (a) makes the event matter and costs the player a run resource
> for a side reward, which is the honest trade; it also means a bad roll can end
> a run at an event, which some players will read as unfair. (c) is the mildest
> real cost and needs zero new code.

**Not the user's call — a hard recommendation: the event battle must NOT grant a
hero level, and `reward: { level: true }` should not be built.** The run's
difficulty curve rests on `heroLevel == fightNumber` lockstep — enemy level
tracks the fight number 1:1 (`fightSpecFor`), and
`tests/run/runState.test.ts`'s *"the hero is exactly LV n entering fight n while
under the cap"* asserts it directly. An event that grants a level puts the hero
permanently ahead of the ladder it is priced against, silently flattening every
fight after it. The user asked for "gold **or levels**"; gold is the safe half,
and the `grantLevel` outcome **already exists** in the training theme for the
levels half without a battle attached. If levels-for-a-fight is wanted anyway,
it needs a balance-designer pass on the whole ladder first, not an event.

Likewise recommend the event battle does **not** touch `wins` / `losses` /
`bossesCleared` — those are the fight ladder's score and `bossesCleared` is the
run's high-score axis. Fold its damage numbers into `RunStats` (the ledger is
already additive and generic) and, if it wants a counter, add
`stats.eventBattles`.

**Which foe.** The event should name a foe *through the biome* — draw from
`biome.mobs` at the current track level via `buildEnemyEncounter`, so it is
priced by the same PL economy as everything else. **Never hand-write a
statline** (`docs/enemy-design.md`).

**Catalog lint.** `tests/run/events.test.ts` enforces 2–3 choices and a cost-0
safe exit per event. A battle choice is *not* a safe exit — the event still
needs its walk-away.

---

## 4. Migration — what breaks

### 4.1 Frozen artefacts

- **`tests/engine/fixtures/outcomeBaseline.json`** (the 400-case frozen sweep,
  read by `tests/engine/outcomeRule.test.ts` and
  `tests/engine/frozenSweepSkillIds.test.ts`): **not at risk.** It locks
  `simulate` over `tests/engine/helpers/sweepConfigs.ts`, which never touches
  `src/run`. Nothing in this proposal edits `src/engine`. It comes under threat
  only if someone tries to express a biome as a *combat rule* (an ambient
  element buff, a world modifier) — see §6.5. **If a change to this proposal
  would require regenerating that fixture, the change is wrong.**
- **`skills-lock.json`, `src/data/content/*.v1.json`** and their parity /
  idempotency / schema tests (`tests/data/enemiesJsonParity`,
  `enemiesExportIdempotency`, `contentSchema`, `enemiesContentSchema`,
  `modifiers*`): **not at risk if §2.2 is followed** — no new field on
  `EnemyDef`/`SkillDef`. They are squarely at risk the moment anyone adds one.

### 4.2 Tests that will actually go red

| Test | Why | Mitigation |
|---|---|---|
| `tests/run/runMap.test.ts` — `assertColumnInvariants` | Asserts every non-combat column has exactly 3 nodes and is not all-one-kind. A fork column is all-`fork`, size 2–3. | Teach the helper the fork case. Unavoidable and correct. |
| `tests/run/runMap.test.ts` — determinism / eager-vs-lazy suite | All call `generateRunMap(seed)`. Stays green **only** if `biomes` defaults to unchosen and structure stays seed-only (§2.3). | Optional field + default. Add a new test for `(seed, biomes)` equality. |
| `tests/run/runState.test.ts` — `availableChoices surfaces the depth-1 column`, `chooseNode rejects a node that is not an available choice` | A fork column before wave 1 would shift depth 1. | **No fork before band 0** (§2.5). Then these stay green. |
| `tests/run/runState.test.ts` — hero/enemy lockstep, `recordBattleResult throws when no combat node is active` | Broken by any event battle that levels the hero or reuses `recordBattleResult`. | §3.3: separate transition, no level grant. |
| `tests/run/enemyDepthGating.test.ts` — *"boss nodes are ungated (single-boss pool, always solo, always the boss id)"* | Dies the moment a biome names its boss. | Expected; rewrite as "a boss node fields its band's biome boss". |
| `tests/run/enemyDepthGating.test.ts` — *"the whole non-boss roster is reachable as an anchor somewhere"* | Dies if biome filtering is a hard silo. | Prefer-not-restrict (§2.3) keeps it green. |
| `tests/run/affinityReachability.test.ts` | Measures per-shelf density, so unaffected by *which* stalls are drawn. Breaks only if a biome **removes** stalls from the bag, which would make "every type has a stall" conditional on biome. | Prefer-not-restrict. |
| `tests/run/contentReachability.test.ts` | Same: every card must stay reachable via draft/shop/event. | Prefer-not-restrict. |
| `tests/run/contentPoolOrder.test.ts` | Id-sorted pools are what fixes the draw per seed. | `BiomeDef.mobs`/`shops` must be **sorted arrays**, never Sets. |
| `tests/run/events.test.ts` | 2–3 choices, cost-0 safe exit, affordability predicate. | A battle event still needs its walk-away choice. |
| `tests/game/runEventStoryLayout.test.ts` | The N=3 mobile bound. | Fork panels and battle events both cap at 3. |
| `tests/build/boundaryChecker.test.ts` + `scripts/check-boundaries.mjs` | The event-battle path must not pull `resolveBattle`/`simulate` into `src/game`. The temptation is real: the resolver hands back a pack and someone will want to "just resolve it here". | §3.1. |

### 4.3 Determinism rules to honour while implementing

- Filters over existing pools, **no new `Rng` calls** (§2.3). Where a new draw
  is genuinely needed (fork candidates), give it its **own** Rng seeded from a
  new `hashSeed` domain so it cannot perturb an existing call order.
- Integers only; no `Date.now()` / `Math.random()`.
- Iterate arrays by index. Never `Map`/`Set` where order matters — including
  `biome.mobs.includes(...)`, which is fine as a *predicate* over an ordered
  array but must never become "iterate a Set of biome mobs".
- `RunMap.biomes` is plain data, like the theme bags — that is precisely what
  keeps `ensureWavesThrough`'s rebuild-from-wave-1 valid.
- Leave `hashSeed('wave', seed, wave)` alone (§2.3).

### 4.4 Docs

`docs/run-structure.md` (LIVING, owns run shape) must absorb the ladder/biome
change **in the same commit**. `docs/INDEX.md` gains a row if biomes get their
own owner doc. `docs/art-prompt-pack.md` gains the band-banner and fork-panel
assets. `docs/design-locked.md` gains a dated row for whatever the user rules on
DECISIONS 1–3.

---

## 5. Phased plan

Each phase is shippable on its own and green on `npm test`.

**Phase 0 — name the boss.** *No biomes.* Extend
`renderRunBossCountdownPanel` to show the upcoming boss's name, level and art,
via `previewEncounter` on the future boss node. Both platforms.
*Proves:* whether forward information actually changes how the player plays,
for an afternoon of UI work. *Exposes immediately:* there is only one boss
(§1.6), so the panel will say "Wolf King" forever — which is the honest, visible
statement of the content gap everything else depends on.

**Phase 1 — biomes exist, dealt not chosen.** `src/data/biomes.ts`; band biome
as a pure function of `(seed, band)`; bind **shops and events by preference**
(§2.3); band banner + route-board tint. No fork, no mob binding, no new node
kind, no `RunState` change.
*Proves:* the data shape; that preference-not-silo leaves every reachability
audit green; that map *structure* is byte-identical per seed; and — the number
that justifies the feature — that a named type's supply moves from ~29% to ~98%
(§2.0). *Smallest slice that delivers real value:* the deck-building supply fix
lands here, before any agency exists.

**Phase 2 — mobs and the boss.** Requires **boss content first**: at least one
boss per biome. Cheapest honest route is to let `BiomeDef.boss` name any enemy
and have the boss node read it directly — the `'boss'` **title** already
supplies the rank/stat bump, and `isBoss` is only an identity tag, so promoting
existing kits (Pyre Acolyte for the Emberwaste, Bandit Duelist for a sword
biome…) needs no new statlines. Then narrow `rollEncounter`'s anchor pool by
biome with fallback.
*Proves:* "I know what I am fighting for the next five waves", and finally makes
the boss line in the banner say something different per band.

**Phase 3 — the fork.** `RunMap.biomes` ledger, `'fork'` node kind, fork column
after each boss, `chooseBiome`, fork panels on both platforms, the
"appending a later band cannot change walked ground" test.
*Proves:* the user's actual ask — a path chosen, not dealt.

**Phase 4 — the extra-battle event.** Independent of 1–3 and could be done at
any point, but sequenced last because it is the largest new-state change
(`pendingEventBattle`) and it wants biome-leaned foes to be worth fighting.
*Proves:* that a non-node battle can round-trip through the battle service and
settle without touching `recordBattleResult` or the level ladder.

**Not scheduled — biome-specific event *content*** (bespoke events per biome, as
opposed to Phase 1's theme preference + type-filtered rewards). Real value, but
it is a content backlog, not a system, and it should wait until the system has
been played.

---

## 6. What I would not do

**6.1 Would not build a real branching graph with edges.** The map is a column
list with no edge concept; `availableChoices` returns "the next column" and
`depth` is a single integer. Adding edges means reworking `runMap`, three
`runState` functions, `RunRouteBoard`, and both map scenes — to deliver path
*exclusivity*, which the wave band already delivers by making the whole band the
unit of choice. If a genuine graph is ever wanted, it is its own project with
its own proposal, not a rider on this one.

**6.2 Would not silo pools per biome.** A hard restriction ("the Emberwaste
sells *only* fire") breaks `contentReachability` and `affinityReachability`,
thins the anchor pool at depths where §1.6 shows it is already down to 5
enemies, and makes a wrong fork unrecoverable — the player who picks Emberwaste
and then draws two gated Frost cards has no way back. Prefer-first-eligible with
fallback (§2.3) produces the same *read* at a fraction of the risk, and the
projection in §2.0 is measured on the preference mechanism, not on a silo.

**6.3 Would not add a `biome` field to `EnemyDef` / `SkillDef` / `ShopTypeDef`.**
It puts run-layer routing inside frozen content JSON that has parity, schema and
export-idempotency tests attached, and it forces content-designer's book to know
about a run-layer concept. Membership belongs in `src/data/biomes.ts` as id
lists — the precedent `src/run/enemyDepth.ts` already set, for the same reason,
one feature ago.

**6.4 Would not let an event battle grant hero levels or count as a fight.**
§3.3. The `heroLevel == fightNumber` lockstep is the spine of the difficulty
curve and there is a test asserting it by name.

**6.5 Would not give a biome a mechanical effect on combat.** No "+10% Fire
damage in the Emberwaste", no ambient world rule, no biome-wide enemy modifier.
PL is the balance unit (`docs/design-locked.md`), an ambient multiplier is a
balance number outside the PL economy, and it would drag the frozen combat
baseline (§4.1) into a run-layer feature. The biome's entire value is **supply
and legibility**. If a biome needs to feel dangerous, use the tools that are
already priced: `MODIFIER_PRESETS` on its encounters, or its mob roster.

**6.6 Would not fork the map or event scenes.** Both-platforms rule. The fork
panel is a `RunChoiceViewModel` variant; the event battle is a discriminator on
`battleContext`, not a second RunPrep.

**6.7 Would not put a fork before the first band.** A player holding four bronze
cards cannot evaluate "the Emberwaste supplies Fire"; and it breaks depth-1
tests for a decision made with no information. Start in a fixed biome, fork
after the first boss.

**6.8 Would not stamp a biome on individual nodes as the *primary* model.**
`RunNode.biomeId` should exist only as a denormalised copy of the band's value
for rendering and pool lookups. If two nodes in the same band could ever carry
different biome ids, the band stops being a promise and the fork panel starts
lying.

**6.9 Would not add randomised biome rewards or a "mystery" biome.** The events
layer deliberately deleted its weighted-gamble machinery once every choice
became a real pick (`src/data/events.ts` header). A biome whose contents are
hidden is the exact opposite of the thing being asked for.

**6.10 Would not ship Phase 1 and call the feature done.** Dealt biomes fix the
supply problem and are worth shipping on their own, but the request was for
*choosing* paths. Shipping legibility without agency and closing the ticket
would answer a question the user did not ask.
