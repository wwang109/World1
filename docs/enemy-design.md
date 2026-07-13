# Enemy Design: Bronze Floor, Scaling Deferred to the Run Layer

Every monster in `src/data/enemies.ts` — basic, elite, or boss alike — is
authored at a **Bronze / lowest-level FLOOR**: a small basic board (2-3
Bronze cards, no gems, no tier overrides) and each monster's own modest
default statline. Enemies are not tuned against simulated winrates; the fight
outcome against any given player build is emergent and intentionally
variable — a well-countered hero should struggle against a monster even at
the floor, and a poorly-countered monster should fall easily. Do not adjust
these numbers to chase a target winrate; adjust them only if the *rule*
itself changes (ask `game-director` / `balance-designer`).

## The floor rule

Every enemy card is Bronze (10 PL). Every monster's depth-1 definition gets:

- **A small basic board**: 2-3 Bronze cards, no gems, no tier overrides.
  `boardSize` is sized to exactly fit the sum of the pieces' `size` (see
  "Slot/size bookkeeping" below).
- **Its own non-inflated default statline**, hand-picked to preserve the
  monster's characteristic shape (a frail fast beast, a tanky bruiser, a
  fragile caster, a balanced duelist, a modestly tougher beast) at a modest
  magnitude — roughly at/around the hero baseline (150 HP, 12 atk/mp, 2
  armor/mr, 12 speed, 10% crit), never hand-inflated with extra cards, extra
  HP, or extra crit to signal "elite" or "boss".
- **Its authored `element`/`weaponAffinity`** (identity) and its
  `goldReward`/`xpReward`.

`isElite` / `isBoss` on a `EnemyDef` are **encounter-role tags** for the run
layer (e.g. where/how a monster is placed, whether it gets a boss-room UI
treatment) — they are NOT stat or board-size multipliers. At the floor, an
elite or a boss still gets the same small 2-3 card board and a modest
statline as any basic. Any extra difficulty an elite or boss is meant to
carry is a **future depth/level-scaling concern**, not something baked into
the depth-1 definition by hand-inflating its board or stats.

## Depth/level scaling (deferred)

How board richness (bigger boards, tier-ups on repeat enemy types) and
HP/stat magnitude change with dungeon depth or monster level is **deferred
to the run layer** — this doc covers the depth-1 floor principle only. When
depth-scaling is designed, it should scale up FROM the floor values in
`src/data/enemies.ts` via a depth-multiplier system (e.g. a data table or
formula applied at encounter-generation time), rather than having per-depth
numbers hand-authored into these base `EnemyDef`s. In particular: do not
re-inflate an elite's or boss's depth-1 board/HP by hand again — express any
future "this monster is scarier at depth N" intent as a multiplier applied
on top of its floor definition.

## Slot/size bookkeeping

`boardSize` is a hard capacity — the sum of placed cards' `size` must fit
without overlap (enforced by the engine at combatant setup). When a card list
includes a size-2/3 card (e.g. `crippling_strike`, `rending_claws`), size the
enemy's `boardSize` to exactly the sum of its pieces' sizes so there's no
wasted or ambiguous slack.

## Current depth-1 floor roster (reference)

| Enemy | Role | Cards | HP | Key stats | Affinity |
|---|---|---|---|---|---|
| Giant Rat | Basic | 2 | 90 | atk 9, spd 13, crit 5 (fast beast glass cannon) | weapon: beast |
| Stone Beetle | Basic | 2 | 150 | atk 8, armor 5, spd 7 (tanky) | element: nature, weapon: beast |
| Ember Imp | Basic | 2 | 85 | mp 13, crit 10 (magic glass cannon) | element: fire |
| Bandit Duelist | Elite (tag only) | 2 | 120 | atk 12, armor 2, crit 8 (balanced human duelist, ~hero baseline) | weapon: sword |
| The Wolf King | Boss (tag only) | 3 | 160 | atk 13, armor 2, spd 13, crit 8 (modest beast, not a wall) | weapon: beast |

Source of truth for exact numbers is always `src/data/enemies.ts` — this
table is a snapshot for quick reference and should be kept in sync when the
roster changes.
