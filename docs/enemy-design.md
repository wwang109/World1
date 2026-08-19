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

Since the unified-statline lock (2026-07-24), every monster's floor `stats`
is the SAME Level-1 statline as the player (maxHp 100, atk 1, magicPower 1,
armor 1, magicResist 1, speed 10) — there is no bespoke per-monster HP/stat
row any more, and crit was removed from the engine entirely (2026-07-23), so
this table no longer carries an "HP"/"Key stats" column of hand-authored
numbers. A monster's identity now lives in three places: its **cards**, its
declared **affinity**, and its `MONSTER_PROFILES` **level-up weight profile**
(`src/run/leveling.ts`) — the weights below are ratios (only relative
proportions matter), not absolute point totals; see that file for the exact
allocation algorithm.

| Enemy (id) | Role | Theme | Cards | Affinity | Level-up profile emphasis |
|---|---|---|---|---|---|
| Giant Rat (`giant_rat`) | Basic | Beast thief — fast, light, chip damage | 2 | weapon: beast | speed-dominant, light attack, minimal HP |
| Stone Beetle (`stone_beetle`) | Basic | Nature warden — armored tank | 2 | element: nature | maxHp/armor-dominant |
| Ember Imp (`ember_imp`) | Basic | Fire DoT caster | 3 | element: fire | magicPower-dominant, no HP (glass) |
| Bandit Duelist (`bandit_duelist`) | Elite (tag only) | Sword duelist — balanced tempo, parry | 3 | weapon: sword | attack/speed balanced, light HP |
| The Wolf King (`wolf_king`) | Boss (tag only) | Beast alpha / brute | 3 | weapon: beast | attack-dominant, moderate HP |
| Seraph (`seraph`) | Basic | Holy guardian / support caster | 3 | element: holy | magicPower/magicResist balanced, light HP |
| Knight (`knight`) | Basic | Sword warden — block, buff, parry | 3 | weapon: sword | maxHp/armor-dominant |
| Mage (`mage`) | Basic | Lightning blaster — glass cannon | 2 | element: lightning | magicPower only (no HP/armor/resist) |
| Hunter (`hunter`) | Basic | Bow marksman | 3 | weapon: bow | attack-dominant, moderate speed |
| Lancer (`rogue`) | Basic | Lance skirmisher — reach and thrust | 3 | weapon: lance | attack-dominant, moderate speed, light HP |
| Berserker (`berserker`) | Basic | Axe brute — heavy, slow, big hits | 3 | weapon: axe | attack/HP balanced, zero speed (slow) |
| Necromancer (`necromancer`) | Basic | Dark curse-debuffer | 2 | element: dark | magicPower/magicResist balanced, no HP |
| Cleric (`cleric`) | Basic | Holy warden-healer | 3 | element: holy | magicPower/magicResist/HP balanced |
| Toxic Druid (`toxic_druid`) | Basic | Nature poisoner — three poison hybrids, no pure-damage filler | 3 | element: nature | *(no profile entry — falls back to `DEFAULT_PROFILE`)* |
| Reaver (`bleed_reaver`) | Basic | Axe bleed duelist — shieldBreak opens the guard, bleed piles on, armor shred softens the follow-up | 3 | weapon: axe | *(no profile entry — falls back to `DEFAULT_PROFILE`)* |
| Warbreaker (`warbreaker`) | Basic | Axe tempo-denial brute — the roster's `splash` showcase, shieldBreak follow-up | 2 | weapon: axe | *(no profile entry — falls back to `DEFAULT_PROFILE`)* |
| Thornback (`thorn_beast`) | Basic | Beast thorns+shield — punishes fast/multi-hit attackers, sits behind a big shield | 2 | weapon: beast | *(no profile entry — falls back to `DEFAULT_PROFILE`)* |
| Sentinel (`warded_sentinel`) | Elite (tag only) | Sword warded protector — ward+guard denial layered on a flat shield, the roster's hardest normal-pool pick | 3 | weapon: sword | *(no profile entry — falls back to `DEFAULT_PROFILE`)* |

Source of truth for exact numbers is always `src/data/enemies.ts` (cards/
affinity) and `src/run/leveling.ts` (`MONSTER_PROFILES`, weights) — this
table is a snapshot for quick reference and should be kept in sync when the
roster or its profiles change. (The `rogue` id is unchanged for save-data/
profile-lookup compatibility — only its display name and cards became
"Lancer".)

## Keyword-family roster expansion (2026-08-19)

The 2026-08-19 card catalog growth (ward 3->8, thorns 6->10, bleed 4->7, new
ward/shield/thorns hybrids, poison hybrids, the roster's first `splash` card)
predated any enemy fielding most of those families — a depth-1 player could
draft a mechanic the roster never played back. The five enemies added above
(`toxic_druid`, `bleed_reaver`, `warbreaker`, `thorn_beast`, `warded_sentinel`)
are that fix: every board is real catalog cards only (no bespoke enemy-only
effects), Bronze floor, small 2-4 piece board, universal statline — same rule
as every other monster on this roster.

`goldReward` was chosen deliberately per monster (not just "next round
number") to seat each at a specific rung of the `FIGHT_POOL` depth ladder
(`src/run/enemyDepth.ts` derives depth bands from `goldReward`, four
overlapping bands over the sorted pool): Toxic Druid (16) lands in the
weakest band alongside Giant Rat/Stone Beetle/Hunter/Cleric — poison
stacking is meant to be met early, not saved for a late reveal. Bleed Reaver
(19) and Warbreaker (22) sit in the two middle bands. Thorn Beast (27) and
Sentinel (32, now above Bandit Duelist's 30) anchor the roster's toughest
band — Sentinel is tagged `isElite` as the new hardest normal-pool pick, the
same encounter-role-only tag Bandit Duelist already carried.

None of the five have a `MONSTER_PROFILES` entry in `src/run/leveling.ts` yet
(out of this pass's file scope — that module belongs to gameplay-programmer);
they fall back to `DEFAULT_PROFILE` (`maxHp:2, attack:2, magicPower:1,
armor:1, magicResist:1, speed:1`) until a follow-up gives each its own
identity-shaped weights (e.g. Toxic Druid should probably lean `magicPower`,
Sentinel probably `armor`/`maxHp`, mirroring how every other caster/tank on
the roster already does).
