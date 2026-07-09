# Skills Tree Expansion Plan

State of the catalog today (`src/data/skills.ts`): **29 cards, all Bronze tier**,
every kit audited against the Power-Level budget table in `src/engine/balance.ts`
(Bronze 10 · Silver 15 · Gold 20 · Diamond 25 PL). The type system already
declares Silver/Gold/Diamond tiers and a `legendary` rarity, but zero cards use
them. This plan turns the flat Bronze card list into an actual *tree*: authored
upgrade paths per card, new priced DSL actions to build them from, and content
to fill the matrix gaps the current set leaves open.

## Where the gaps are

| Axis | Declared | Actually used | Gap |
|---|---|---|---|
| Tiers | bronze/silver/gold/diamond | bronze only | 3 empty tiers; no upgrade data structure at all |
| Rarity | common/rare/epic/legendary | common/rare/epic | no legendary cards |
| Aura reach | adjacent/left/right/allBoard | adjacent only | directional and board-wide auras unused |
| Elements | 6 | 1–2 cards each | frost/nature/dark have no direct-damage identity |
| Weapons | 5 | sword 2 · axe 3 · lance 2 · bow 2 · beast 4 | thin per-weapon lines |
| Specials registry | `registerSpecial()` escape hatch | empty | reserved for behavior the DSL can't express |
| Rider catalog | 5 shipped | — | Execute, Quicken, Thorns, Multi-hit, Purge named in the rider commit as "remaining catalog" but never priced/built |

## P0 — Tier-up paths: make it a tree

The balance system was designed for this ("Tier upgrades are predictable: an
authored +5 PL path per card") but no data structure exists.

**Schema** (`src/engine/types.ts`):

```ts
interface SkillDef {
  // ...
  /** Ids of the next-tier variants this card can upgrade into (1–2 branches). */
  upgradesTo?: string[];
}
```

Upgraded cards are ordinary `SkillDef`s in the book — the tree is just edges
between them, so the engine needs zero changes. A run-layer `upgradeSkill()`
helper swaps the board piece's `skillId` in place (same size ⇒ same slots; if a
branch grows in size, the Prep scene re-validates placement with `canPlace`).

**Branching rule** — every Bronze card gets **two** Silver branches that spend
the +5 PL differently, so the tree forks meaningfully:

- *Magnitude branch*: bigger numbers, same feel (Fireball → **Greater Fireball**:
  260% + burn 7×3).
- *Identity branch*: the +5 PL buys a new rider or shape (Fireball → **Fire
  Lance**: 200% + burn 5×3 but weight −10, becoming a tempo card).

Silver → Gold converges (one authored Gold per pair), Gold → Diamond is the
capstone (epic/legendary rarity, allowed a `special` if the DSL can't express
it). Full tree for 29 Bronze roots ≈ 29×2 Silver + 29 Gold + ~10 Diamond
capstones ≈ **~100 new card defs**, authored in waves (start with the 8 pure
Offense cards + the 5 rider showcases).

**Audit extensions** (`tests/engine/balance.test.ts`):
- every card in an `upgradesTo` list exists and is exactly one tier up;
- upgrades preserve weapon/element family (a sword line stays a sword line);
- every non-Diamond card has at least one upgrade path; no cycles;
- all nodes on budget (already enforced, now covers new tiers).

## P1 — New priced DSL actions (the "remaining catalog")

These five were explicitly deferred; price them with the existing deci-PL
table conventions and add to the `Action` union + interpreter + pricing switch:

| Action | Shape | Price (deci-PL) |
|---|---|---|
| `execute` | `{ kind: 'execute'; pct; belowPct }` — +pct% damage this cast when enemy HP < belowPct% | `pct × 2/3` at belowPct 50, scaled: `floor(pct * belowPct / 75)` |
| `quicken` | `{ kind: 'quicken'; weight }` — caster's NEXT action is X lighter | mirror of `slowNext`: `weight × 5/2` (1 PL per 4) |
| `thorns` | `{ kind: 'thorns'; pct; turns }` — reflect pct% of pre-mitigation damage taken | like buffs: `pct × turns` (10%-turn = 1 PL) |
| `multiHit` | `{ kind: 'multiHit'; power; hits }` — hits× separate strikes, crit rolls each | `floor(power × hits / 2) + hits × 5` (per-hit crit/shield-chewing premium) |
| `purge` | `{ kind: 'purge' }` — strip the ENEMY's stat buffs (mirror of cleanse) | flat 60 (6 PL — narrower than cleanse's 4 status families) |

Plus one free win: `regen` (`{ amount; turns }`, heal-over-time ticking like a
reversed burn, priced `amount × turns × 2`) — completes the DoT/HoT symmetry
and gives Healing lines a Silver branch identity.

Each action lands with: interpreter case, combat-log event + BattleScene/ASCII
narration, pricing case, and a rider test in `tests/engine/riders.test.ts`
(the multi-hit test must pin RNG order — one crit roll per hit, fixed sequence,
per the determinism rules in `types.ts`).

Showcase Bronze cards to prove each rider (audited at 10 PL): **Executioner's
Chop** (axe, execute), **Windstep Jab** (lance, quicken), **Bramble Coat**
(nature, thorns), **Flurry of Knives** (sword, multiHit), **Dispelling Arrow**
(bow, purge), **Soothing Spores** (nature, regen).

## P2 — Fill the matrix gaps with new Bronze roots

~10 new cards so every element/weapon has a playable line and the unused aura
reaches get exercised:

- **Element identity**: Frost direct hit (frost belongs to slows/shields today),
  Nature damage + regen hybrid, Dark drain (damage + lifesteal — dark's theme),
  Holy smite (holy is heal-only today).
- **Directional auras** (`left`/`right`, currently dead code): e.g. **Drill
  Sergeant** — "the card to my RIGHT deals +40% damage" — makes board ORDER a
  puzzle, not just adjacency.
- **allBoard aura** at its doubled price: e.g. **Chronoshard** (allBoard
  weightDelta −2) as an epic support.
- **Legendary rarity debut**: 1–2 Diamond-tier drop-only cards using the
  `special` registry (first real `registerSpecial` use), e.g. **Mirror of
  Fates** — copies the enemy's last cast. Registry stays in-engine per the
  existing rule: promote to DSL when a third card needs the behavior.

## P3 — Consumers of the tree (run layer + UI)

Without these the tree exists but can't be climbed:

- **Upgrade economy**: spend the gold that enemies already drop (`goldReward`
  is dead currency today) — Silver ~25g, Gold ~60g, Diamond ~150g, elite/boss
  fights gate Gold+.
- **PrepScene tree view**: tapping a board card shows its upgrade fork
  (two branch previews with PL-diff highlights), buy → swap in place.
- **Enemy tiers**: depth-2+ presets in `src/data/enemies.ts` carrying Silver
  boards so upgraded heroes meet upgraded enemies (the file already notes
  "the run layer will scale by depth later").

## Suggested sequencing

1. **P0 schema + audits** with ONE fully-authored tree (Fireball line to
   Diamond) as the reference implementation.
2. **P1 actions** — they're prerequisites for interesting Silver identity
   branches.
3. **P0 content waves**: Offense lines → rider showcases → support/heal/debuff.
4. **P2 new roots**, then **P3 economy/UI** once there's a tree worth buying.

Estimated test surface: +~40 tests (tree-shape audits, 6 rider suites,
upgrade-swap placement, determinism re-run over the grown book).
