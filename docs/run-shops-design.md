# Run Mode — Shops & Themes design plan

Companion to [`release-game-plan.md`](release-game-plan.md). This plans how
the existing Shops v1 system (5 themed shops, declarative filters in
`src/data/shopTypes.ts`, deterministic `rollShopStock`) behaves **inside a
run**, and which new themes/services come next. Gold stays an economy-pacing
knob; PL stays the only balance currency.

## 1. Shop nodes in a run (v1 — wire-up, no new content)

- **One storefront per shop node**, not the 5-shop picker (that picker is a
  Sandbox browsing convenience). Which theme a node carries is decided at
  **map generation** and shown on the map choice panel ("SHOP · Arcanum"), so
  picking a shop node is an informed strategic choice, not a lottery.
- **Theme roll rule:** deterministic from the node's `shopSeed`; a run never
  repeats a theme until all 5 have appeared (draw-without-replacement bag,
  reshuffled when empty). Prevents the dead run where both shops are Sanctum
  for a beast/bow build.
- **REROLL stays 1 gold** and rerolls the same theme's shelf (existing
  `rollShopStock(shopId, baseSeed + rerollCount)` sequence).
- **Stock tiers by depth** (small, additive change to `rollOfferedTier`):
  the 70/25/5 bronze/silver/gold split is right for depths 1–3, but a depth-8
  shop selling mostly bronze is a dead node. Pass the node depth in and shift
  the split: depths 1–3 → 70/25/5 · 4–6 → 45/45/10 · 7–9 → 25/55/20.
  Diamond still never appears in shops (it stays a tier-up aspiration).
  Sandbox callers pass depth 1 and get today's behavior byte-identical.

## 2. Gold curve sanity (existing knobs, no changes needed for v1)

Income: ~7 fights/run × (1 base + 1–3 win bonus) ≈ **14–21 gold** on a good
run, front-loaded 2g/fight early. Prices: cards 2–5g, gems 1–3g, reroll 1g.
So a run affords roughly **4–6 purchases** across 2–3 shop visits — enough to
pivot a draft, not enough to buy a whole deck. That matches the intent
(the draft is your spine; shops are your steering). Revisit only after real
runs, and only by moving prices/win-bonus, never PL.

## 2b. Pool-size reality check (READ BEFORE ADDING A THEME)

The card book is **36 cards / 46 gems**, and the theme axes are lopsided:

| Axis | Counts |
|---|---|
| property | physical 19 · magical 12 · true 5 |
| weapon | sword 5 · axe 5 · beast 5 · lance 2 · bow 2 |
| element | holy 6 · dark 4 · frost 3 · nature 2 · fire 1 · lightning 1 |
| archetype | offense 20 · defensive 5 · debuff 5 · support 3 · healing 3 |

**USER-LOCKED rule (2026-07-29): thin pools are fine — "if they only have 1 or
2 cards, so be it."** A narrow theme sells a short shelf; that is honest, not
broken. A Fire shop with one fire card is a *specialist* stall, and it gets
richer for free as the card book grows. So element-themed shops ARE allowed.

What this requires instead of a pool floor:

- **Shelf = min(shelf size, pool size)**, which `sampleDistinct` already does.
  The shop SCENES must lay out 1–6 offers gracefully (no gaps that read as a
  bug, no offscreen overflow) — that's the real work, and it's a UI-phase
  requirement, not a content restriction.
- **A thin shop must not be a trap**: if its whole pool fits on the shelf,
  REROLL can only reshuffle tiers, so **hide/disable REROLL when
  `pool.length <= shelf.cards`** and label the shelf "FULL STOCK" so the
  player isn't invited to waste a gold.
- **Lint test floor is 1, not 8**: assert every theme's pool is non-empty (an
  empty shelf IS a bug) and that a card-selling shop has ≥ 1 card. Also assert
  the REROLL-suppression flag matches the pool arithmetic.

## 3. New shop themes (v1.5 — content only, no new mechanics)

Two additions fill real gaps in the current 5 (Armory/Wildworks/Arcanum/
Sanctum/Alchemist all sell 4 cards + 3 gems):

Target: **10 shop themes** so the no-repeat bag has real variety across a run's
2–4 shop visits, and so a deck-building intent (armor stack, poison, holy
heal, speed rush) can actually be shopped for. All are `shopTypes.ts` entries
plus two optional `ShopTypeDef` fields — `minWave` (map-gen respects it when
drawing from the theme bag) and `priceDelta` (per-card gold markup/discount).

Existing five, unchanged: **Armory** (sword/axe/lance) · **Wildworks**
(bow/beast) · **Arcanum** (elemental wheel) · **Sanctum** (holy/dark +
heal/support) · **Alchemist** (debuff).

| Shop | Tagline | Shelf | Card filter | Notes |
|---|---|---|---|---|
| **Gemcutter** | "Facets for every socket." | 0 cards · **6 gems** | — | Gems only, FULL gem book. The reliable socket shop. `minWave: 2`. |
| **Caravan** | "Everything, once, at a price." | **6 cards** · 2 gems | none (whole book) | The pivot shop. `priceDelta: +1`. |
| **Bulwark** | "Nothing gets through." | 4 · 3 | `[{archetypes:['defensive']},{archetypes:['support']},{properties:['physical'], archetypes:['defensive']}]` | Armor/shield/guard build shop; gems = bulwark/ward line. |
| **Assassins' Den** | "Fast, quiet, lethal." | 4 · 3 | `[{archetypes:['offense'], weapons:['bow','beast']},{properties:['true']}]` | Speed/true-damage/lifesteal; gems = swift/quickening/leeching. |
| **Relic Vault** | "Old power, honest price." | **3** · 2 | none, but tier roll is **silver-heavy** | The upgrade shop: rolls one band above the depth default, `priceDelta: +1`. `minWave: 3`. |

**Element specialist stalls** (thin by design, per the user-locked rule above —
each sells whatever it has, 1–7 cards, plus its matching gems). These give the
elemental wheel a shopping identity that Arcanum-as-one-shop can't:

| Shop | Tagline | Shelf | Card filter | Pool today |
|---|---|---|---|---|
| **Emberworks** | "Fire answers to nobody." | 4 · 2 | `[{elements:['fire']}]` | 1 card |
| **Frosthold** | "Cold patience." | 4 · 2 | `[{elements:['frost']}]` | 3 cards |
| **Stormspire** | "Thunder, sold by the bolt." | 4 · 2 | `[{elements:['lightning']}]` | 1 card |
| **Grovekeep** | "Roots outlast steel." | 4 · 2 | `[{elements:['nature']}]` | 2 cards |
| **Reliquary** | "Light kept in a jar." | 4 · 2 | `[{elements:['holy']}]` | 6 cards |
| **Umbral Stall** | "Ask no questions." | 4 · 2 | `[{elements:['dark']}]` | 4 cards |

These ship with REROLL auto-suppressed while their pool fits the shelf, so a
1-card Emberworks shows one offer, labels itself FULL STOCK, and sells no
false hope. As the card book grows they fill in with zero code changes.

That brings the catalog to **16 themes** (5 original + 5 build shops + 6
element stalls). The theme bag draws no-repeat across a run's 2–4 shop visits,
so a run's shops feel distinct without any of them being mandatory.

**Deck-building intent is the point**: between Armory/Bulwark (armor stack),
Alchemist/Assassins' Den (poison-speed), Sanctum (holy sustain), and
Arcanum/Gemcutter (elemental + sockets), every draft identity has at least
two shops that feed it, and the theme bag guarantees you see 2–4 different
ones per run.

## 4. Services (v2 — new mechanics, each needs a game-director gate)

Deliberately NOT in v1; listed in priority order:

1. **Forge (tier-up service):** pay gold to raise one owned card's tier
   (bronze→silver→gold; diamond only from the Forge, never on shelves).
   Price steep and rising (e.g. 4/6/9g). This is the gold sink that makes
   late-run income matter and the only path to Diamond in a run. Reuses
   `applyTier` — no engine work.
2. **Sell/salvage:** sell owned cards/gems for floor(price/2). Solves
   bag-pressure and dead drafts. Belongs on the shop screen, not a new node.
3. **Socketing service:** gems currently socket freely in Deck Build; if
   that stays free, Gemcutter covers the need. Only add a fee if free
   socketing proves degenerate (swapping the same gem around every fight).

## 5. Explicitly rejected (for the record)

- **Player-tailored stock** ("shops sell what your deck wants") — kills the
  pivot decision and the draft's identity pips; theme bag + Caravan gives
  agency without hand-holding.
- **Gold interest / banking bonuses** — Bazaar-style loss-continue already
  starves losers of gold; interest would snowball winners.
- **Shops selling stat points / hero levels** — hero PL growth is win-paced
  by design; buying levels with gold would create a second, unpriced
  progression currency.

## Build order

- **v1 (phase-3 wiring):** single-storefront shop node, theme bag, depth
  passed to `rollOfferedTier`, map panel shows the theme name. Tests: theme
  bag never repeats within 5, depth-tier split boundaries, sandbox
  passthrough unchanged at depth 1.
- **v1.5:** Gemcutter + Caravan entries, `minDepth`. Tests: pool sizes,
  price markup, minDepth respected in map gen.
- **v2:** Forge → sell → (maybe) socket fees, each gated by game-director.
