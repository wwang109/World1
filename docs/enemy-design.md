# Enemy Design: PL-by-Principle Tier Budgets

Enemies are authored to a **board-PL budget rule**, not tuned against
simulated winrates. The fight outcome against any given player build is
emergent and intentionally variable — a well-countered hero should struggle
against an enemy even at "fair" PL, and a poorly-countered enemy should fall
easily. Do not adjust these numbers to chase a target winrate; adjust them
only if the *rule* itself changes (ask `game-director` / `balance-designer`).

## The rule

Every enemy card is Bronze (10 PL), so **board PL = 10 × card count**. Budgets
are set as a multiple of the hero's starter board PL:

- Hero baseline: **150 HP**, 12 atk / 12 mp, starter board = **5 cards = 50
  PL**.

| Tier | Board PL target | Card count | HP guidance | Stat guidance |
|---|---|---|---|---|
| Basic | ~0.4× hero board (20 PL) | 2 cards | at/below hero HP (85–150) | at/below hero baseline (atk/mp ≤ hero's 12) |
| Elite | ~1.0× hero board (50 PL) | 5 cards | ~175 HP | modest bump above hero baseline; trim variance (lower crit than a basic enemy would carry) |
| Boss | ~1.4× hero board (70 PL) | 7 cards | ~250 HP (a partial wall — not a pure DPS race) | above hero baseline across the board |

Difficulty is the **product of board PL and HP**, not either alone — a
high-PL board on a glass-cannon body plays very differently from the same
board on a wall of HP. Both axes are set deliberately per tier:

- **Basic**: low PL *and* low-to-moderate HP. Each basic should teach exactly
  one mechanic (a beast glass-cannon, an armored tank, a magic glass-cannon)
  cleanly, without competing signals.
- **Elite**: PL parity with the hero's starter board, moderate HP bump. The
  point is a **scoutable, real threat** — a coherent thematic board (e.g. a
  sword duelist: an aura + a debuff-rider kit + a follow-up payoff) that
  rewards recognizing the pattern and counter-picking gear/cards, not a
  variance wall. This is why elite crit is trimmed relative to what a basic
  enemy might carry loosely — high crit variance reads as "unfair", not
  "hard".
- **Boss**: board PL clearly above the hero's, HP as a partial wall (long
  enough to matter, not a pure sponge). Bosses should have a **rich,
  thematically dense board** (multiple synergistic pieces on one archetype —
  e.g. a beast package of bite/claw/venom cards plus an aura and a debuff)
  with an authored `weaponAffinity`/`elementAffinity` that makes the
  intended counter-pick (a bow vs. beast, fire vs. nature, etc.) a clearly
  better path in than brute-forcing the fight.

## Slot/size bookkeeping

`boardSize` is a hard capacity — the sum of placed cards' `size` must fit
without overlap (enforced by the engine at combatant setup). When a tier's
card list includes a size-2/3 card (e.g. `crippling_strike`, `rending_claws`),
size the enemy's `boardSize` to exactly the sum of its pieces' sizes so there's
no wasted or ambiguous slack — a card-count budget (PL) and a slot-capacity
budget (`boardSize`) are two different constraints and both must be
satisfied.

## Depth scaling (deferred)

These budgets and stat values are **depth-1 anchors** (`baseDepth: 1`). How
both board PL (e.g. via richer kits/tier-ups on repeat enemy types) and HP/stat
scaling change with dungeon depth is **deferred to the run layer** — this doc
covers the depth-1 principle only. When depth-scaling is designed, it should
scale the same two axes (board PL and HP/stats) called out above, and this
doc should be extended with a depth-multiplier table rather than having
per-enemy numbers hand-authored per depth.

## Current depth-1 roster (reference)

| Enemy | Tier | Cards | Board PL | HP | Key stats | Affinity |
|---|---|---|---|---|---|---|
| Giant Rat | Basic | 2 | 20 | 90 | atk 9, spd 13, crit 5 (fast beast glass cannon) | weapon: beast |
| Stone Beetle | Basic | 2 | 20 | 150 | atk 8, armor 5, spd 7 (tanky) | element: nature, weapon: beast |
| Ember Imp | Basic | 2 | 20 | 85 | mp 13, crit 10 (magic glass cannon) | element: fire |
| Bandit Duelist | Elite | 5 | 50 | 175 | atk 14, crit 12 (trimmed variance) | weapon: sword |
| The Wolf King | Boss | 7 | 70 | 250 | atk 17, armor 4, mr 3, spd 14, crit 12 | weapon: beast |

Source of truth for exact numbers is always `src/data/enemies.ts` — this
table is a snapshot for quick reference and should be kept in sync when the
roster changes.
