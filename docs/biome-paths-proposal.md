# Biome paths — proposal

> **Scope:** PROPOSAL, **Phase 1 now BUILT** (2026-08-26). Design investigation
> for giving the endless run **legible paths** — bands of waves with a declared
> identity (mobs, boss, shops, events) the player can read *before* committing,
> chosen because they feed the deck being built.
> **What shipped:** `src/data/biomes.ts` (**11 biomes** — 6 in phase 1, the
> five typeless leans added 2026-08-26 with the mob roster that staffs them),
> `src/run/biome.ts` (the deal
> + the two binding primitives), `src/run/biomeForecast.ts` (the read),
> biome-preferred shop themes and event themes in `src/run/runMap.ts`, and
> biome-weighted mobs + a per-biome boss shortlist in `rollEncounter`. Biomes are
> **dealt**, not chosen — the fork is still Phase 3. Tests:
> `tests/run/biomeDeal.test.ts`, `biomeSupply.test.ts`, `biomeMobs.test.ts`.
> **Every §1 number was re-measured against the real code before building**, and
> §2.0/§2.3/§5 now carry MEASURED results where they used to carry projections.
> When `docs/run-structure.md` (LIVING, owner of run shape) absorbs the shipped
> parts, this file moves to `docs/history/`.
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

> **RE-MEASURED 2026-08-26 before building** (400 seeds, same harness, current
> catalog): the table reproduces. fire 2.26 offers / 32% P(≥3) / 44% P(zero),
> frost 2.12 / 29% / 41%, axe 2.77 / 42% / 30%, beast 3.21 / 51% / 25% — mean
> across the eleven types 2.60 offers, 37% P(≥3), 34% P(zero). The problem this
> section describes is real and current.

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

### 1.6 Fights are varied; the boss is a TITLE, not an enemy

> **CORRECTED 2026-08-26 (user-verified, re-measured before building Phase 1).**
> The original text of this section read *"boss node enemy: `wolf_king`, 100% of
> the time… Biomes cannot deliver a predictable boss until the roster has more
> than one boss."* **That conclusion was wrong**, and it was wrong in a way that
> would have mis-scheduled the whole plan (it put the boss binding behind a
> content prerequisite it never had). The corrected reading, and what it means
> for the design, is below. The paragraph is corrected rather than deleted so the
> mistake stays legible.

**`'boss'` is a TITLE, assigned by POSITION, to whatever mob rolls there.**
`fightSpecFor` (`src/run/runState.ts`) is the whole rule:

```ts
const pos = ((n - 1) % BOSS_EVERY) + 1;
const title: EnemyTitle = pos <= 2 ? 'normal' : pos <= 4 ? 'elite' : 'boss';
```

and `TITLE_PRESETS.boss` is `{ levelDelta: +4, rank: +4, extraCards: 2 }`
(`src/run/encounter.ts`). A fight column's `'hard'` option bumps its title one
rung as well (`TITLE_BUMP`, `elite -> boss`), so fights 3, 4, 8, 9, 13, 14, … each
carry a boss-titled option too. `isBoss` on an `EnemyDef` decides one thing only:
which pool a boss-KIND *column* draws from. It is not what makes a fight a boss
fight.

Measured over fights 1-40 against the roster as it stood (22 enemies, 21 in
`FIGHT_POOL`, 1 in `BOSS_POOL`), asking "which enemy ids can appear wearing the
boss title":

```
fight  3 (fight column)  hard option: 6 eligible anchors
fight  4 (fight column)  hard option: 6
fight  5 (BOSS COLUMN)               1
fight  8 (fight column)  hard option: 11
fight  9 (fight column)  hard option: 10
fight 10 (BOSS COLUMN)               1
...
fight 18/19             hard option: 5      fight 20 (BOSS COLUMN): 1

distinct enemies that wore the boss title over fights 1-40: 22 of 22
```

So **every enemy on the roster could already wear the boss title**, at some
depth, before any content was added. What was true — and remains true, it is the
one part of the original claim that survives — is narrower: the boss **COLUMN**
at waves 5/10/15/… drew from `BOSS_POOL`, which held exactly one id, so *that*
node was `wolf_king` on every seed forever. Per-depth the anchor pools are 5-11
wide (11 at fight 5, 10 at 10 and 15, 5 from fight 20 on), not 22 — the 22 is
the union across the ladder, not the pool at any one fight.

**What this changes about the plan.** The problem was never "there is exactly one
boss". The problem is **TELEGRAPHING**: any of the roster could turn up wearing
+4 levels, +4 rank and 2 extra cards, and the player had no way to see which one
before committing to the column. That is a *legibility* problem, which is
squarely a mapgen/UI job — so the boss binding is **not** blocked on boss content
and does **not** belong in a later phase behind a content gate. It ships with
Phase 1, in two halves:

- the boss COLUMN draws from the band biome's **boss shortlist** (any roster id
  is legal — the title supplies the power, so promoting an existing kit needs no
  new statline), and
- every other fight draws from the band biome's **mob list**, which the band
  banner has already shown the player.

Boss *content* is still worth having — it makes the shortlists signatures rather
than promotions — but it is an enrichment, not a prerequisite. (A boss-roster
pass landed alongside this work and added 11 `isBoss` kits; the shortlists in
`src/data/biomes.ts` name them, and would have worked without them.)

Depth gating (`src/run/enemyDepth.ts`) already narrows *which* mobs may anchor a
fight: 6 eligible anchors at fights 1-4, 11 at 5-8, 10 at 10-15, 5 from fight 20
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

Over 300 seeds x 20 waves, all three fight options were three different enemies
**62%** of the time, and three different type identities 43% of the time. That
62% is the variety baseline the mob binding has to protect — see §2.3, where a
hard biome filter was measured taking it to 9% and was replaced.

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

**MEASURED payoff** (2026-08-26, replacing this section's original projection).
400 seeds, every shelf OFFERED in the window rolled through the real
`rollShopStock`, typed with the real `cardType`. "BEFORE" is the pre-biome
generator (a `git show HEAD:src/run/runMap.ts` copy) run over the same seeds, so
both columns come from the same harness.

The unit of the promise is the BAND, so the number that matters is *the lean the
band's banner NAMES, inside that band's own five waves*:

| Window | Offers of the announced lean | P(≥3) | P(zero) |
|---|---|---|---|
| band 0 (w1–5), before | 1.36 | 19% | 56% |
| **band 0 (w1–5), after** | **6.82** | **98%** | **3%** |
| band 1 (w6–10), before | 1.47 | 22% | 55% |
| **band 1 (w6–10), after** | **6.85** | **98%** | **2%** |
| bands 0–3 pooled (w1–20), before | 1.48 | 21% | 55% |
| **bands 0–3 pooled, after** | **5.90** | **85%** | **9%** |

**98%, and it matches the projection** — but only because `BiomeDef.shops` is
walked in AUTHORED PRIORITY ORDER rather than bag order (§2.3). With the naive
"first preferred entry the bag happens to hold" version it measured 85-87%.

Two honest caveats the projection did not have:

1. **It decays with depth.** The 21-theme bag is a no-repeat bag that refills
   only when empty (~20 shop draws), so by band 3 a biome dealt earlier may find
   its own stall already spent: band 3 measures 61%. Still ~3× the 21% baseline.
2. **A biome only owns five waves.** A player who fixes on one type at wave 1 and
   refuses to re-read the banner gets biome help for band 0 and then a *different*
   band. Measured over waves 1–10 with a FIXED type, the mean across all eleven
   types is 2.72 offers / 38% P(≥3) after, against 2.60 / 37% before — i.e.
   **unchanged**. The gain is real and large, and it is entirely conditional on
   the player reading the band. That is the feature working as designed (the band
   is the unit of the decision), not the number underdelivering.

The original §1.5 table is also re-measured and reproduces: fixed-type P(≥3) sits
at 29-51% per type before the change, 30-47% after — **no type was crowded out**.
Getting there took one fix; see §2.3, "what the measurement caught".

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
>
> **NOW SHIPPED AS (a)-STRICT, ALL ELEVEN BANDS (2026-08-26). The exception is
> gone and the ruling is no longer blocking.** Phase 1 shipped (a) with one
> measured exception: priority 1 of each band had to carry the single-type stall
> of a type NO biome leaned on (forced by the crowd-out measurement in §2.3, not
> by preference), and for the Hallowfield that stall was `umbral_stall` — its own
> counter — so holy was accidentally (b). With a band per card type, every
> single-type stall sits at **priority 0 of its own band** and priority 1 is free
> for generalists again: no band sells its own counter, and the coverage
> invariant is satisfied without the patch. If the ruling ever comes back (b) it
> still generalises in eleven lines of data.
> **The counter is stated plainly either way**: `counterTypeFor` is part of
> `BandForecast` and the renderer prints "frost hits these mobs for +50%" — and,
> for the one lean nothing counters, "nothing counters these mobs."
> **AND THE MOB LINE IS NOW TRUE OF EVERY MOB IT DESCRIBES**, which it was not in
> phase 1: five of the six `mobs` lists carried borrowed off-type members, so
> "dark hits these mobs" was false of the Hallowfield's `necromancer`. See §2.3.

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

**As built** (`src/data/biomes.ts`), with the two deltas from the sketch called
out:

```ts
export type BiomeLean =
  | { kind: 'element'; type: Element }
  | { kind: 'weapon'; type: WeaponType };

export interface BiomeDef {
  id: string;
  name: string;      // "The Emberwaste"
  tagline: string;   // one line, panel-sized
  lean: BiomeLean;
  /** Enemy ids this biome PREFERS. Sorted array, never a Set. */
  mobs: readonly string[];
  /** DELTA 1: a SHORTLIST, not a single `boss: string`. Two entries per biome
   *  means the boss line is a promise ("one of these two") without being the
   *  same name forever, and it degrades to one entry cleanly. */
  bosses: readonly string[];
  /** DELTA 2: authored PRIORITY order, not sorted — index 0 is the biome's own
   *  single-type stall, index 1 is the stall it carries for a type no biome
   *  leans on. Position is load-bearing (§2.3), and it is worth 13 points of
   *  P(>=3) on its own. */
  shops: readonly string[];
  eventThemes: readonly EventTheme[];
}

export const biomeCatalog: Record<string, BiomeDef>;
export const biomeIds: readonly string[];   // id-sorted
```

No `art` key was authored: nothing renders a banner yet (§2.4), and an unused
content field is a field that rots. It is one line when the Phaser work lands.

**Six biomes shipped in phase 1** — `emberwaste` (fire), `hallowfield` (holy),
`thornwild` (nature), `ironmoot` (axe), `swornhold` (sword), `howlmoor` (beast):
one per type the roster could actually staff with MOBS. Frost, lightning, dark,
bow and lance fielded 1 or 0 mobs each, so a "Frostmarch" would have been a name
with no monsters behind it; their stalls and their bosses were carried by the
biome each read beside (the coverage invariant in §2.3) so nothing was orphaned.

**ELEVEN NOW — one per card type (2026-08-26).** The five missing bands landed
with the enemy content that staffs them (`arrowfell` bow, `duskbarrow` dark,
`frostmarch` frost, `pikewold` lance, `stormreach` lightning), because the
blocker was never biome data: it was the roster. 13 mobs were authored — three
each for the five homeless types counting the one existing kit four of them had
(`mage`, `necromancer`, `hunter`, `rogue`), plus one holy and one nature kit so
the Hallowfield and the Thornwild keep their depth coverage once their BORROWED
members are removed. `rime_tyrant` and `galewright`, which rode as guests in
bands that leaned elsewhere, are now the headliners of the bands they were
written for; so are `hollow_crown` and `thornpike_marshal`.

Every band now shortlists **its own signature boss plus its own toughest on-type
mob** — the pattern `ironmoot` already used with `blood_duelist` — so no band
hosts another type's boss and no boss line is one name forever. NO NEW BOSS WAS
NEEDED: the 11 signature bosses of `106b9bd` are exactly one per card type, and
`tests/run/bossRoster.test.ts` pins that as a contract, so authoring a 12th would
have broken it. `greenwood_sovereign` sits in TWO shortlists, honestly — it is
the only dual-affinity boss (nature + bow) and is genuinely a face of both the
Thornwild and the Arrowfell.

**Membership lives here as id lists. Do not add a `biome` field to `EnemyDef`,
`SkillDef`, or `ShopTypeDef`** — see §6.3. This is exactly the precedent
`src/run/enemyDepth.ts` set when it derived depth bands from existing data
rather than authoring a 13th enemy field, and it keeps the frozen content JSON
(`src/data/content/*.v1.json`) and its parity/idempotency tests out of the blast
radius entirely.

A starting catalog of 5–6 biomes covering the types the roster can actually
staff (§1.6: fire, holy, nature, beast, bow early; axe/sword/lance/lightning/
dark later) is enough. ~~Do not author 11.~~ **Superseded 2026-08-26**: eleven is
now the right number, and for a reason this line did not have — the set of
DECLARABLE identities is the set of bands, so a type with no band cannot be
committed to at all (docs/run-structure-patterns.md Q12). The sequencing advice
stands and was followed: enemy content first, then the band is five lines.

**`RunMap.biomes` was NOT built.** It is the fork's ledger, and Phase 1 deals
biomes rather than choosing them, so there is nothing to record: the deal is
`biomeIdForBand(seed, band)`, a pure function with its own `hashSeed` domain and
no `Rng` instance at all. That means no new `RunState`/`RunMap` field, no
persistence question, and a reload re-derives the whole thing. The ledger lands
with the fork in Phase 3, exactly as sketched.

One deal rule was added that the sketch did not have: **no immediate repeat** —
band *b* never deals band *b−1*'s biome. Five waves in the Emberwaste followed by
five more is not a path. It stays a pure function of `(seed, band)` by dealing
band *b* out of the other *n−1* biomes and shifting past the previous pick.

`RunNode.biomeId` shipped as sketched:

```ts
  /** The band's biome id, stamped at generation on EVERY node. Display + pool
   *  routing; never a gameplay branch of its own. Optional so a map persisted
   *  before biomes existed still loads — `biomeFor` re-derives the band. */
  biomeId?: string;
```

### 2.3 How a biome binds to shops, events and mobs — **filters, not new dice**

This is the most important implementation rule in the proposal, and it **holds —
verified, not assumed**:

> **Every biome binding is a preference or a filter over a pool that is already
> being drawn from. No binding spends a new `Rng` call.**

**How it was verified.** A structural fingerprint (every node's id, depth, wave,
kind, `fightNumber`, `fightOption`, `encounterSeed`, `eventSeed`, `shopSeed` —
deliberately *not* `shopId`/`eventTheme`/`biomeId`) was hashed over 50 seeds ×
12 waves, 6 097 nodes, with the biome code in place and again with
`src/run/runMap.ts` + `src/run/runState.ts` stashed back to their pre-biome
state. **Identical both ways**:
`2ae0ecdbc647b00883aba45995b0ae676a87eef9573a2c2068409ba700d10441`. That hash is
now frozen in `tests/run/biomeDeal.test.ts`, and it was mutation-checked: adding
one component to `hashSeed('wave', seed, wave)` fails it immediately.

**Shops — as sketched, with one correction that is worth 13 points.** The sketch
was:

```ts
let idx = shopThemeBag.findIndex((id) => eligible(id) && biome.shops.includes(id));
if (idx === -1) idx = shopThemeBag.findIndex(eligible);
```

That works and measures **85-87%** P(≥3) on the announced lean. The problem is
that it takes whichever *preferred* entry the shuffle happened to put earliest in
the bag — so a band's one shop visit lands on the biome's generalist stall as
often as on the single-type stall that hands the identity over in one shelf. What
shipped walks the BIOME's own list in order instead, which costs nothing (it is a
scan, not a draw) and measures **98%**:

```ts
let idx = -1;
for (let i = 0; i < biome.shops.length && idx === -1; i++) {
  const wanted = biome.shops[i]!;
  idx = shopThemeBag.findIndex((id) => id === wanted && eligible(id));
}
if (idx === -1) idx = shopThemeBag.findIndex(eligible);   // today's behaviour, verbatim
```

`BiomeDef.shops` is therefore authored **priority order**, not sorted, and that
is content, not incidental ordering.

**What the measurement caught — the crowd-out.** With each biome preferring only
stalls of its own lean, the three types **no biome leans on** (frost, lightning,
dark — the roster fields no mob for any of them) fell from 2.1-2.5 offers per ten
waves to **0.96-1.19**, and P(≥3) from 29-34% to **10-16%**. Preference crowds out
whatever it does not name, and `tests/run/affinityReachability.test.ts` could not
see it: that suite measures per-SHELF density, and the shelves were unchanged —
it was the *frequency of reaching them* that halved.

Fixed by the **coverage invariant**, now asserted in `tests/run/biomeSupply.test.ts`:

> Every card type's single-type stall sits at priority 0 or 1 of some biome.

In phase 1 that meant a priority-1 carriage: `stormspire` by the Emberwaste
(whose `mage` was already its caster kin), `umbral_stall` by the Hallowfield
(whose `necromancer` is the thing the ground keeps out), `frosthold` by the
Howlmoor, `fletchers_loft` by the Thornwild. After it, every one of the eleven
types was back within noise of its pre-biome supply.

**THE ELEVEN-BAND PASS RETIRES THE CARRIAGE (2026-08-26).** Every type has a band
now, so every single-type stall sits at priority 0 of its own band and priority 1
is generalists again. The invariant is unchanged and still asserted — it is what
would catch a 12th band that leans a type twice while another loses its home.

**MEASURED, same harness, 400 seeds, 6 bands vs 11.** The number the feature is
actually about is *can a run be dealt a band that names my type, and does that
band then supply it*:

| Lean | runs with such a band, 6 bands | 11 bands | in-band P(>=3), 6 | 11 |
|---|---|---|---|---|
| frost / lightning / dark / bow / lance | **0%** (no band existed) | **31-38%** | n/a | **87-91%** |
| fire / holy / nature / axe / sword / beast | 52-61% | 30-36% | 81-89% | 85-92% |

The five homeless leans go from *structurally undeclarable* to a third of runs,
and the six original leans pay for it evenly — total steering is unchanged (one
preferred stall per band either way), it is simply spread over eleven types
instead of six. Their in-band supply actually improves, because the 21-theme
no-repeat bag is now contended by eleven different priority-0 stalls rather than
six, which also lifts the DEEP bands: pooled announced-lean P(>=3) at band 2 goes
83% -> 88% and at band 3 **61% -> 74%**, partly undoing the decay §2.0 recorded
as this mechanism's honest ceiling.

Fixed-TYPE supply over waves 1-10 (the §1.5 metric, a player who commits at wave
1 and never re-reads the banner) is unchanged as expected — mean 2.73 -> 2.72
offers, P(>=3) 37% -> 36% — and P(ZERO) improves for every one of the eleven
types (e.g. fire 58% -> 46%, lightning 57% -> 40%, frost 55% -> 41%), because the
supply is less bimodal when eleven stalls share the steering. No type was crowded
out; `biomeSupply.test.ts`'s per-type floor is what keeps that honest.

**AND THE MOB LISTS ARE NOW ON-TYPE, which is a correctness fix, not tidying.**
The forecast's MOB line states the counter of the biome's declared LEAN, and five
of the six phase-1 `mobs` lists carried BORROWED off-type members — the
Hallowfield's `necromancer` (dark) and `knight` (sword), the Thornwild's three
beast mobs, the Emberwaste's `mage` (lightning, which takes -25% from frost, not
+50%) — borrowed precisely because on-type mobs did not exist. The line was FALSE
of every one of them: the same defect `3881717` fixed one level up for the boss
line and recorded as found-and-not-fixed here. All six lists are cleaned; where a
lean lost depth coverage the answer was to AUTHOR an on-type mob (`vigil_keeper`
for holy's deep tier, `blight_shambler` for nature's middle), never to borrow.
`tests/run/biomeForecastCounter.test.ts` now checks the claim against EVERY listed
mob through the engine's own matchup math.

**Events — the binding is frequency-neutral by arithmetic, and that is stated
rather than papered over.** The sketch's one-line preference was built as
described, and measured over 400 seeds × 20 waves it moves the aggregate
on-theme share from an unbiased **33.3%** to **33.4%**. The event theme bag holds
all six themes with no repeat until it empties; preferring two of them inside a
no-repeat bag changes the ORDER the bag is spent in, never the FREQUENCY over a
cycle. Every way around that (reshuffling at a band boundary, a weighted bag)
spends extra `Rng` calls inside `generateWave` and moves the structural
fingerprint, which the rule above forbids.

What it *does* buy, on the same sweep: **the first event column of a band is
63.2% on-theme against 33.3% by chance** — a band OPENS in its own flavour, then
relaxes. That is genuinely worth having and it is what the test asserts.

The rest of the event value is a CONTENT pass, exactly as this section already
said: §1.7 shows a theme predicts a reward's *flavour*, never its *type*, and
`EventOutcomeSpec`'s `cardChoice`/`bonusDraft`/`grantCard` already take a
`CardFilter` with `elements`/`weapons`. **No new outcome kind is needed.** Left
to Phase 2 (§5).

**Mobs — the sketched hard filter was measured and REPLACED.** As written:

```ts
const biomePool = depthPool.filter((id) => biome.mobs.includes(id));
const anchorPool = biomePool.length > 0 ? biomePool : depthPool;
```

it produces a **silo in all but name**, because a biome's mob list intersects a
single depth tier at one or two ids. Measured at 60 seeds × 20 waves: 100% of
fight anchors came from the band's list, the share of fight columns offering
three DIFFERENT enemies collapsed from the **62%** baseline (§1.6) to **9%**, and
bands existed that fielded a single enemy for five straight waves. Every
reachability audit stayed green throughout — they ask whether an enemy is
reachable *somewhere*, not whether a band is monotonous.

What shipped is a **weighted** preference (`weightIds` in `src/run/biome.ts`) —
still exactly one `rng.int` call, still array-ordered, no Set:

```ts
// biome mobs repeated BIOME_MOB_WEIGHT times in front of the untouched pool
const weighted = [...kept, ...kept, ...kept, ...pool];
const enemyId = weighted[rng.int(weighted.length)]!;
```

At `BIOME_MOB_WEIGHT = 3`: **55% of anchors are biome mobs against 25% unweighted**
(a 2.2× lift), three-different-enemies recovers to **54%** against the 62%
baseline, and all 21 fight-pool enemies still anchor somewhere. The band reads as
a place without becoming one enemy on repeat.

**Boss — NOT blocked on content (§1.6 correction).** A boss COLUMN draws its
anchor from the band biome's `bosses` shortlist instead of `BOSS_POOL`, ungated
by depth exactly as boss nodes have always been. Any roster id is legal in a
shortlist, because the boss TITLE supplies the power. This is the line that makes
the user's sentence true, and it shipped in Phase 1.

A boss-TITLED *fight* option (`'hard'` on an elite fight — the same title) keeps
the ordinary mob weighting on purpose: it is a risk dial inside the band, not the
band's boss, and the banner has already shown the mob list it draws from. Both
boss-titled cases are therefore telegraphed, which was the actual problem.

**Prefer, never silo.** Every one of the above degrades to today's behaviour
when the biome's list is empty or unavailable. That is not defensive
boilerplate — it is what keeps `tests/run/contentReachability.test.ts` and
`tests/run/affinityReachability.test.ts` trivially green (§4), keeps every
enemy reachable at every depth, and stops a wrong biome pick from being
unrecoverable. Two of the three bindings needed a *measurement* to find where
"prefer" had quietly become "only".

**Do not mix the biome id into the wave seed.** `generateWave` seeds from
`hashSeed('wave', seed, wave)`. Left alone — and the frozen fingerprint above is
what keeps it that way.

### 2.4 How the player sees it — the part the feature *is*

Four surfaces, in ascending cost. The first two are worth shipping even if
nothing else here is built.

> **BUILT IN PHASE 1: the MODEL for all four, and the text form of it.**
> `src/run/biomeForecast.ts` composes the whole read once — biome name, tagline,
> lean chip, mob list, the boss (its **real** enemy id/name/level/title, rolled
> through the same pure `rollEncounter` the map's own fight previews use, on a
> band the run has not reached yet), the preferred stalls, the event themes, and
> the counter line. Every surface below is to render THAT model; a second
> derivation would eventually name a different boss, which is exactly the class
> of drift the project already paid for with a hand-written combat-log renderer.
>
> `forecastBand(state, band)` extends a COPY of the map (`ensureWavesThrough`)
> and composes a throwaway `currentNodeId` — the `runStore.ts#previewEncounter`
> idiom — so previewing band 6 from band 0 is free, repeatable, and provably
> non-mutating (asserted).
>
> `renderBandForecast` is its text form, mobile-first per CLAUDE.md (one fact per
> line, nothing past 28 characters — asserted line-by-line in the test, not
> eyeballed). Real output of `renderBandForecast(forecastBand(createRun(7), n))`,
> two bands of one run, stacked as separate labelled blocks:
>
> ```
> ===== seed 7 · band 0 =====
> THE HALLOWFIELD
> [HOLY] w1-5
> Consecrated ground and the things it keeps out.
>
> BOSS
>   The Dawn Arbiter
>   LV 5 · BOSS
> dark hits this
> boss for +50%.
>
> MOBS
>   Cleric
>   Seraph
>   Vigil Keeper
> dark hits these
> mobs for +50%.
>
> SHOPS
>   Reliquary
>   Sanctum
>   Bulwark
>
> EVENTS
>   omen
>   training
>
> ===== seed 7 · band 1 =====
> THE PIKEWOLD
> [LANCE] w6-10
> Drill ground and hedgerow. Every line here is braced.
>
> BOSS
>   The Thornpike Marshal
>   LV 10 · BOSS
> axe hits this
> boss for +50%.
>
> MOBS
>   Phalanx Veteran
>   Pike Conscript
>   Lancer
> axe hits these
> mobs for +50%.
>
> SHOPS
>   Lancer's Rest
>   Armory
>   Bulwark
>   Caravan
>
> EVENTS
>   forge
>   training
> ```
>
> **RE-CAPTURED 2026-08-26** (the earlier capture predates two fixes and both are
> visible above): `3881717` moved each counter sentence INSIDE the block it
> describes and gave it a subject, and the eleven-band pass cleaned the `mobs`
> lists of borrowed off-type members — the old Hallowfield capture listed `Knight`
> (sword) and `Necromancer` (dark) under a line promising +50% for dark, which was
> false of both. Seed 7's band 1 is now a band that did not exist then.
>
> The one lean nothing counters reads like this instead — real information, not a
> dropped line (`WEAPON_BEATS` has no entry mapping to bow):
>
> ```
> MOBS
>   Cordon Archer
>   Deadeye Stalker
>   Hunter
> nothing counters
> these mobs.
> ```
>
> The boss line is the whole point of the feature and it is not a guess: the test
> rolls the boss node the player will actually stand in front of and asserts it is
> the id the forecast named, for four bands of twelve seeds.
>
> **NOT built in Phase 1: the Phaser half.** `src/game/**` was out of scope for
> this pass, so (a)-(d) below are still to do — but each is now "render this
> model", not "work out what to say".

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
| `tests/run/enemyDepthGating.test.ts` — *"boss nodes are ungated (single-boss pool, always solo, always the boss id)"* | Predicted to die the moment a biome names its boss. **It did not** — despite its NAME, that test only asserts solo/1-unit, never the id. It stayed green untouched, and `tests/run/biomeMobs.test.ts` now carries the "a boss node fields its band's biome shortlist" assertion the row asked for. | None needed. |
| `tests/run/enemyDepthGating.test.ts` — *"the whole non-boss roster is reachable as an anchor somewhere"* | Dies if biome filtering is a hard silo. | Prefer-not-restrict (§2.3) keeps it green. |
| `tests/run/affinityReachability.test.ts` | Measures per-shelf density, so unaffected by *which* stalls are drawn. Breaks only if a biome **removes** stalls from the bag, which would make "every type has a stall" conditional on biome. | Prefer-not-restrict. |
| `tests/run/contentReachability.test.ts` | Same: every card must stay reachable via draft/shop/event. | Prefer-not-restrict. |
| `tests/run/contentPoolOrder.test.ts` | Id-sorted pools are what fixes the draw per seed. | Green. `BiomeDef.mobs`/`bosses`/`eventThemes` are sorted arrays (asserted in `biomeDeal.test.ts`); `shops` is deliberately **authored priority order** instead — see §2.3, it is worth 13 points of P(≥3) — which is equally deterministic and is content, not incidental iteration order. |
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

**Phase 0 — name the boss.** *Folded into Phase 1 and superseded.* The §1.6
correction removed its reason to exist as a separate step: the panel would not
have said "Wolf King forever" for the reason this section claimed, and the model
that answers "which boss" (`biomeForecast.ts`) now exists, so the UI work is a
render of it rather than an investigation.

**Phase 1 — biomes exist, dealt not chosen. ✅ SHIPPED 2026-08-26.**
Delivered: `src/data/biomes.ts` (6 biomes; **11 since 2026-08-26**) ·
`src/run/biome.ts` (the `(seed,
band)` deal with no-immediate-repeat, plus the two binding primitives `preferIds`
/ `weightIds`) · shop-theme and event-theme preference in `generateWave` ·
biome-weighted mobs **and** the per-biome boss shortlist in `rollEncounter`
(pulled forward from Phase 2 — see §1.6, it was never blocked on content) ·
`src/run/biomeForecast.ts`, the readable-before-entered model and its mobile
text renderer · `RunNode.biomeId` · 30 assertions across
`tests/run/biomeDeal.test.ts`, `biomeSupply.test.ts`, `biomeMobs.test.ts`.

*Proved:* the data shape; that prefer-not-silo keeps every reachability audit
green (all 21 fight-pool enemies still anchor, every shop theme still reaches the
run); that map STRUCTURE is byte-identical per seed (frozen fingerprint,
mutation-checked); and the number that justifies the feature — the announced
lean's supply moves **19% → 98%** P(≥3) inside its own band, 21% → 85% pooled
over four bands.

*Not delivered (out of scope for this pass):* the Phaser surfaces — band banner,
route-board tint, boss-countdown panel — `src/game/**` belongs to another owner.
`RunMap.biomes` was deliberately not built (nothing to record while biomes are
dealt).

**Phase 2 — make the band pay off in EVENTS, and finish the read.** Two pieces,
both flushed out by Phase 1's measurements:
1. **Type-filtered event rewards** (§1.7, §2.3). The event-theme preference is
   frequency-neutral by arithmetic — it can only make a band OPEN on its themes
   (63% vs 33%), never change how often they appear. The value the proposal
   wants from events therefore has to come from CONTENT: give the card-granting
   outcomes in `recruit`/`forge` a `CardFilter` of `[{ elements: [lean] }]`,
   resolved against the node's `biomeId`. No new outcome kind needed.
2. **The Phaser read** — render `BandForecast` as the band banner, the
   route-board tint, and the boss line in `renderRunBossCountdownPanel`. Both
   platforms, one model, no second derivation.

~~Also here: **biomes for the five types that have none**~~ — **DONE 2026-08-26,
ahead of the rest of phase 2.** `arrowfell` (bow), `duskbarrow` (dark),
`frostmarch` (frost), `pikewold` (lance) and `stormreach` (lightning) shipped
with the 13-mob TYPELESS-BAND MOB ROSTER that staffs them; `rime_tyrant` and
`galewright` are the Frostmarch's and the Stormreach's headliners, exactly as
this line anticipated. NO NEW BOSS was authored — the eleven signature bosses are
already one per card type and `tests/run/bossRoster.test.ts` pins that, so each
new band takes its own boss home from whichever band was hosting it as a guest,
plus its own toughest on-type mob as a second face. The same pass cleaned the six
original `mobs` lists of their borrowed off-type members (§2.3) and made the
counter-less bow band's forecast read honestly instead of printing nothing.

**Known thin spots, named rather than hidden.** `computeEnemyDepthBands` splits
the now-34-strong fight pool into tiers with bands [1,8]/[5,12]/[9,16]/[13,inf).
Eight of the eleven bands span three tiers; fire, nature, beast and lance field
no tier-3 on-type mob, so those four read generic from fight 17 on (the weighting
finds no intersection and falls back to the untouched depth pool — a graceful
degradation, not a lie). Fire is the thinnest at two on-type mobs, both mid-tier.
One mob each is the next content increment; no band needs a borrowed member to
function.

**Phase 3 — the fork.** `RunMap.biomes` ledger, `'fork'` node kind, fork column
after each boss, `chooseBiome`, fork panels on both platforms, the
"appending a later band cannot change walked ground" test.
*Proves:* the user's actual ask — a path chosen, not dealt. Phase 1 measured what
this is worth: dealt biomes give the player the 98% supply **only if they read
the banner and build what the band names**; the fork is what lets them bring the
build and pick the band. Nothing in Phase 1 has to change for it — the deal
function is the only thing the ledger replaces.

**Phase 4 — the extra-battle event.** Independent of 1–3 and could be done at
any point, but sequenced last because it is the largest new-state change
(`pendingEventBattle`) and it wants biome-leaned foes to be worth fighting.
*Proves:* that a non-node battle can round-trip through the battle service and
settle without touching `recordBattleResult` or the level ladder.

**Not scheduled — biome-specific event *content*** (bespoke events per biome, as
opposed to Phase 2's theme preference + type-filtered rewards). Real value, but
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
fallback (§2.3) produces the same *read* at a fraction of the risk, and §2.0's
payoff is measured on the preference mechanism, not on a silo.

> **AND THE AUDITS DO NOT CATCH A SILO ON THEIR OWN — measured 2026-08-26.** This
> section assumed the reachability suites were the backstop. They are not, twice
> over. (1) The sketched hard mob filter (§2.3) siloed a band to one or two
> enemies and took three-different-enemies from 62% to 9%; every reachability
> audit stayed green, because they ask whether an enemy is reachable *somewhere*
> across the whole ladder, never whether a band is monotonous. (2) The shop
> preference halved the supply of the three types no biome names; `affinity
> Reachability` measures per-SHELF density, and the shelves were unchanged — it
> was the frequency of reaching them that moved. Both were found by measuring,
> not by the suite going red, and both now have their own assertions in
> `tests/run/biomeSupply.test.ts` / `biomeMobs.test.ts` with the control computed
> inside the test rather than frozen as a number.

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

> **Still true after Phase 1 shipped, and now with a number on it.** The 98%
> supply is conditional on the player reading the band and building what it
> names; measured over waves 1-10 with a FIXED type chosen at wave 1 and never
> revisited, supply is *unchanged* from before biomes existed (2.72 offers / 38%
> after, 2.60 / 37% before). Phase 1 makes the run legible and makes committing
> to the band pay. It does not yet let the player bring a build and choose the
> band that feeds it — that is Phase 3, and it is still the ask.
