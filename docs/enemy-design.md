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
| Stone Beetle (`stone_beetle`) | Basic | Nature warden — armored tank, now with a bleed+guard counter-layer (Barbed Rampart, 2026-08-21) | 3 | element: nature | maxHp/armor-dominant |
| Ember Imp (`ember_imp`) | Basic | Fire DoT caster | 3 | element: fire | magicPower-dominant, no HP (glass) |
| Bandit Duelist (`bandit_duelist`) | Elite (tag only) | Sword duelist — balanced tempo, parry | 3 | weapon: sword | attack/speed balanced, light HP |
| The Wolf King (`wolf_king`) | Boss (tag only) | Beast alpha / brute — poison, lifesteal AND a thorns counter-punch (Nettle Lash, 2026-08-21) | 3 | weapon: beast | attack-dominant, moderate HP |
| Seraph (`seraph`) | Basic | Holy guardian / support caster | 3 | element: holy | magicPower/magicResist balanced, light HP |
| Knight (`knight`) | Basic | Sword warden — block, buff, parry | 3 | weapon: sword | maxHp/armor-dominant |
| Mage (`mage`) | Basic | Lightning blaster — glass cannon | 2 | element: lightning | magicPower only (no HP/armor/resist) |
| Hunter (`hunter`) | Basic | Bow marksman — disrupt, expose, then a volley (Rapid Volley, 2026-08-21) | 3 | weapon: bow | attack-dominant, moderate speed |
| Lancer (`rogue`) | Basic | Lance skirmisher — reach and thrust, now a literal shieldBreak-at-range opener (Piercing Reach, 2026-08-21) | 3 | weapon: lance | attack-dominant, moderate speed, light HP |
| Berserker (`berserker`) | Basic | Axe brute — heavy, slow, big hits, now with desperation (Cornered Beast hits harder at or below half HP, 2026-08-21, replacing its stun) | 3 | weapon: axe | attack/HP balanced, zero speed (slow) |
| Necromancer (`necromancer`) | Basic | Dark curse-debuffer, now the legacy roster's `curse` showcase (Dulling Hex added, 2026-08-21) | 3 | element: dark | magicPower/magicResist balanced, no HP |
| Cleric (`cleric`) | Basic | Holy warden-healer, now with a cleanse-that-scales-with-what-it-strips (Penitent Mending, 2026-08-21, replacing its damage finisher) | 3 | element: holy | magicPower/magicResist/HP balanced |
| Toxic Druid (`toxic_druid`) | Basic | Nature poisoner — three poison hybrids, no pure-damage filler | 3 | element: nature | magicPower-dominant, light magicResist (its own heal card), no HP (glass) |
| Reaver (`bleed_reaver`) | Basic | Axe bleed duelist — shieldBreak opens the guard, bleed piles on, armor shred softens the follow-up | 3 | weapon: axe | attack-dominant, light HP, no speed |
| Warbreaker (`warbreaker`) | Basic | Axe tempo-denial brute — the roster's `burden + splash` showcase, shieldBreak follow-up | 2 | weapon: axe | attack/speed balanced (tempo-first), light HP |
| Thornback (`thorn_beast`) | Basic | Beast thorns+shield — punishes fast/multi-hit attackers (unless they wear ARMOR, 2026-08-21), sits behind a big shield | 2 | weapon: beast | maxHp/armor-dominant, light attack |
| Sentinel (`warded_sentinel`) | Elite (tag only) | Sword warded protector — ward+guard denial layered on a flat shield, the roster's hardest normal-pool pick | 3 | weapon: sword | armor-dominant (edges out maxHp), light attack |
| Venom Stalker (`venom_stalker`) | Basic | Beast poison->exploit ambusher — Venom Fang applies, Second Bite exploits the poison it finds and re-applies | 2 | weapon: beast | attack-dominant, light HP |
| Pyre Acolyte (`pyre_acolyte`) | Basic | Fire caster — two burn appliers feeding Burn Detonator's per-stack payoff | 3 | element: fire | magicPower-dominant, light speed/HP |
| Shield Warden (`shield_warden`) | Basic | Sword shieldBurst tank — Iron Bulwark banks a shield, Aegis Charge spends it as bonus damage | 2 | weapon: sword | maxHp/armor-dominant, light attack |
| Bloodletter (`blood_duelist`) | Basic | Axe bleed->stackBonus duelist — Rupturing Strike opens the wound, Bleed Executioner reads the stack | 2 | weapon: axe | attack-dominant, light speed/HP |

Source of truth for exact numbers is always `src/data/enemies.ts` (cards/
affinity) and `src/run/leveling.ts` (`MONSTER_PROFILES`, weights) — this
table is a snapshot for quick reference and should be kept in sync when the
roster or its profiles change. (The `rogue` id is unchanged for save-data/
profile-lookup compatibility — only its display name and cards became
"Lancer".)

## Keyword-family roster expansion (2026-08-19)

The 2026-08-19 card catalog growth (ward 3->8, thorns 6->10, bleed 4->7, new
ward/shield/thorns hybrids, poison hybrids, the roster's first spread-burden
card)
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

Follow-up (2026-08-19, gameplay-programmer): all five now have an explicit
`MONSTER_PROFILES` entry in `src/run/leveling.ts` (see the table above for
each one's emphasis, and that file's own comments for the per-card scaling
read the weights were built from) — none fall back to `DEFAULT_PROFILE` any
more. `tests/run/leveling.test.ts` asserts every id in `src/data/enemies.ts`
has an explicit profile entry, so a future enemy landing without one now
fails loudly instead of silently inheriting the flat default.

## Thornback vs ARMOR — the reflect is PHYSICAL now (2026-08-21)

The user ruling that a thorns reflect is ordinary **physical** damage (armor
first; see §9 of [`docs/combat-model-spec.md`](combat-model-spec.md)) lands
squarely on Thornback, whose whole identity was an unanswerable counter-punch:
its Bulwark Thicket pile stung for the raw stack count as TRUE damage — 20, then
39, then 58 on the recast ladder — and no defensive stat on the hero's sheet
could touch it.

**Measured** on `npm run fight thorn_beast` (same board, same seed, hero armor
varied, the only change being the reflect's property):

| hero armor | OLD (TRUE reflect) | NEW (physical reflect) |
|---|---|---|
| 1 (base) | 117 reflect HP, loss T13 | 85 reflect HP, loss T14 |
| 6 | 117 reflect HP, loss T13 | 60 reflect HP, **win T16** |
| 12 | 117 reflect HP, loss T13 | 30 reflect HP, win T16 |
| 20 | 117 reflect HP, loss T15 | **1** reflect HP, win T16 |
| 40 | 117 reflect HP, loss T15 | 1 reflect HP, win T16 |

Reflect damage was **literally invariant in armor** before (117 at every value,
40 armor included); it now scales down with armor and the hero's own physical
shield can absorb the remainder. **That is the point of the ruling** — armor is
supposed to answer a spike-shirt.

**Counter-play (updated):** wear ARMOR — a physical guard or physical shield
works too, and all three used to do nothing here. DoT/poison decks still never
trigger thorns at all (it only answers a landed DIRECT hit), and `shieldBreak`
still strips the 56/57 shield before a big single hit.

**Open, for a content/balance pass (NOT done here — engine change only):**
Thornback is *not* gutted against an ordinary statline (base armor 1 still loses
the fight on T14, and its shield+bite kit still fights), but its signature is now
cheaply hard-countered: armor costs 1 PL per point (`LEVEL_STAT_COST`) at 3 PL
per level, so ~5 PL of armor already flips this matchup and ~19 PL erases the
reflect entirely. If Thornback is to keep punishing armored attackers it needs a
content answer — a deeper pile, an armor-shred line (`debuffStat` armor /
`shieldBreak`), or a non-physical punish — priced by `balance-designer`.

## Synergy-rider roster expansion (2026-08-21)

The 2026-08-19/21 card batch landed 9 "carrier" cards that pay off a status
the REST of a board already applies (`exploit`, `stackBonus`,
`shieldBurst`, `taxBonus`) — `blight_feast`, `second_bite`,
`thorn_reckoning`, `bleed_executioner`, `burn_detonator`,
`control_opportunist`, `debuff_crusher`, `aegis_charge`, `deadweight_toll` —
with no enemy fielding any of them, so a player could draft the exploit/
per-stack/burst mechanic and never see it played back. Four monsters
(`venom_stalker`, `pyre_acolyte`, `shield_warden`, `blood_duelist`) close
that gap, one per rider family the brief called out: `exploit` on poison,
`stackBonus` on burn, `shieldBurst` on your own shield, `stackBonus` on
bleed. Every board below is real catalog cards only, Bronze floor, a small
2-3 piece board, universal statline — same rule as every enemy above.

`goldReward` was again chosen to seat each at a deliberate rung of the
`FIGHT_POOL` depth ladder (`src/run/enemyDepth.ts`, now derived over 21
non-boss enemies instead of 17): Venom Stalker (25) and Pyre Acolyte (26)
land in tier-2 (`[9,16]`, next to Knight/Warbreaker/Berserker) — a two-card
combo that rewards learning the counterplay rather than an end-game reveal.
Shield Warden (29) and Bloodletter (33) land in tier-3 (`[13,∞)`,
Bloodletter now the roster's single toughest fight-pool anchor, just above
Warded Sentinel's 32) — these two combos hit hardest when fully assembled
and are meant to show up once the player already has some tools to answer
them.

Per-monster counterplay (see each one's own comment in `src/data/enemies.ts`
for the full reasoning):

- **Venom Stalker** (`venom_fang` + `second_bite`): cleanse the poison stack
  between casts and Second Bite's `exploit` bonus never fires — it checks
  BEFORE the card acts, so a stack removed even one beat earlier denies it
  outright. Poison bypasses shields, so a shield alone does not answer this.
- **Pyre Acolyte** (`cinder_dart` + `ember_lash` + `burn_detonator`): burn
  halves every turn on its own, so simply surviving a turn or two before
  Burn Detonator lands shrinks its `stackBonus` for free; cleanse removes the
  stacks outright, and a Ward charge denies burn from landing at all.
- **Shield Warden** (`iron_bulwark` + `aegis_charge`): `shieldBreak` (or
  simply not letting the shield bank) denies Aegis Charge's `shieldBurst` a
  target before the Warden can spend its own wall back at you as damage.
- **Bloodletter** (`rupturing_strike` + `bleed_executioner`): cleanse the
  bleed stack (or out-heal/out-tank the opener) before Bleed Executioner
  reads it and its `stackBonus` falls back to nothing; bleed is blocked by
  shields, so a banked shield denies the opener's stack from landing in the
  first place.

Follow-up owed: `src/run/leveling.ts`'s `MONSTER_PROFILES` gained matching
entries for all four (no `DEFAULT_PROFILE` fallthrough) in the same commit.

## Legacy roster refresh (2026-08-21)

The 13 pre-2026-08-19 enemies (`giant_rat` through `cleric`) predated that
date's ~35-card keyword-family/rider batch (ward/thorns/bleed/poison hybrids,
heavy stat debuffs, the burden+splash family, the `dulling_hex`/`sapping_arc`
curse pair, the 8 rider payoff cards) and had never fielded any of it. This
pass enhances 8 of the 13 with one genuinely-fitting new catalog card each,
leaves 5 deliberately untouched, and documents one change that was tried and
then reverted after measurement.

**A hard constraint drove every choice here**: `REFERENCE_ENEMY_DECK_SIZE`
(`src/run/encounter.ts`) is `Math.max(...enemies[*].pieces.length)` — today 3,
shared by 13 of the roster's 22 enemies — and feeds a LITERALLY PINNED test
(`tests/run/packFights.test.ts`'s `soloThreatDeci(2/6/12, 'normal')` ===
330/450/630 and the LV18/LV40 pack-engagement worked example), a file outside
this pass's ownership. Any enemy already at 3 pieces can only be enhanced by a
SWAP (same `pieces.length`); only the two enemies still at 2 pieces
(`stone_beetle`, `necromancer`) could safely take a plain ADD, since that only
brings them up TO the existing worst case, never past it. Every edit below
respects this.

**Edited (8)**:

| Enemy | Change | Kind | Rationale |
|---|---|---|---|
| `stone_beetle` | + Barbed Rampart | ADD (2->3 pieces) | 2nd defensive layer (-20% incoming physical) + the roster's first bleed on an armored tank |
| `necromancer` | + Dulling Hex | ADD (2->3 pieces) | gives the curse-debuffer a 3rd, distinct debuff family (`curse`), the dark half of the `dulling_hex`/`sapping_arc` curse pair |
| `berserker` | Stunning Smash -> Cornered Beast | SWAP (3 pieces) | "hits harder when hurt" is the literal berserker mechanic — a tighter fit than a generic stun |
| `wolf_king` | Savage Bite -> Nettle Lash | SWAP (3 pieces) | adds a 3rd distinct mechanic (thorns) alongside poison + lifesteal — the alpha now punishes being hit, not just hitting |
| `hunter` | Hunter's Shot -> Rapid Volley | SWAP (3 pieces) | same total flat base (20 vs 10+10) — disrupt, expose, THEN a volley reads as a complete marksman sequence |
| `rogue` (Lancer) | Lance Thrust -> Piercing Reach | SWAP (3 pieces) | makes "reach" literal (`shieldBreak` at range) instead of carried only by the name |
| `cleric` | Purging Strike -> Penitent Mending | SWAP (3 pieces) | trades a token damage finisher for a cleanse that scales with what it strips — a truer "warden-healer" |
| `bandit_duelist` | *(none — see below)* | — | a swap was tried, measured, and reverted |

**Deliberately unchanged (5)**: `giant_rat` (thief minimalism — every unused
beast card is either defensive/thorns, contradicting "no defensive
investment," or size-2/3, contradicting "no size-2/3 card"), `ember_imp`
(DoT-forward glass caster — the only unused fire cards add either a useless-
to-a-caster physical DEF-shred or a defensive tool that contradicts its
documented glass identity), `seraph` (its ward_of_silence `negate` is the
roster's ONLY one and is called out by name in this doc as load-bearing; no
swap adds without cannibalizing it), `knight` (block/buff/parry is already
complete; every candidate swap removes one leg of that triad for no net
gain), `mage` (explicitly re-themed 2026-08-18 to "no rider, no DoT, no
debuff — a flat MATK glass cannon"; every unused lightning card carries a
rider, so touching it would undo that fix).

**The bandit_duelist swap that was tried and reverted.** Sword Slash -> Twin
Slash (same weapon, same size, would have primed Follow Through's own "+20 if
previous cast was Offense" bonus every cast) looked like a clean fit and was
authored first. Measuring it before shipping caught a real problem: Twin
Slash's audited Bronze price banks its budget in the `extraHitPremium` (2
hits x 6 base + premium + a lighter weight), not in flat power — its total
FLAT base is 12 against Sword Slash's 20, a cut the "multi-hit stat
contribution is hit-count-invariant" rule does NOT offset (ATK is 1 at the
floor, so the stat term is negligible either way — this is a flat-damage cut,
not an armor-mitigation tax). Against the default drafted-starter hero board
(`scripts/fight.ts`'s `DEFAULT_HERO_PIECES`) this fight is a genuine
knife-edge — the only one of the 13 legacy fights that board loses at all —
and the swap flipped it from loss to win on EVERY ONE of 300 sampled seeds
(`playerTeam` vs the two kits, seeds 1..300, via `simulate()` directly). This
is not the "emergent outcome noise" CLAUDE.md's balance philosophy says not
to chase — that rule protects an HONESTLY-PRICED kit from being retuned to
hit a winrate; here the kit's REALIZED flat damage output genuinely dropped,
and this one fight had no room to absorb it. `bandit_duelist` ships with its
original `sword_slash`/`follow_through`/`bramble_ward` kit, unchanged.

**goldReward / depth-band before-after** (`src/run/enemyDepth.ts` derives
bands from `goldReward` over the sorted fight-pool roster; `wolf_king` is the
boss pool and is not banded):

| Enemy | goldReward before | goldReward after | Why |
|---|---|---|---|
| `stone_beetle` | 15 | 17 | real PL added (a whole extra Bronze card) |
| `necromancer` | 20 | 22 | real PL added (a whole extra Bronze card) |
| `berserker` | 24 | 24 (unchanged) | Bronze-for-Bronze swap, same size — no PL change |
| `wolf_king` | 60 | 60 (unchanged) | Bronze-for-Bronze swap, same size — no PL change |
| `hunter` | 17 | 17 (unchanged) | Bronze-for-Bronze swap, same total flat base — no PL change |
| `rogue` | 20 | 20 (unchanged) | Bronze-for-Bronze swap, same size — no PL change |
| `cleric` | 18 | 18 (unchanged) | Bronze-for-Bronze swap, same size — no PL change |
| `bandit_duelist` | 30 | 30 (unchanged) | kit unchanged |

Swap-only edits keep goldReward flat on principle (CLAUDE.md: PL is the
balance unit, and a same-tier same-size swap does not move a board's PL
budget) rather than chasing the single-seed turn/HP deltas `npm run fight`
shows — those deltas are real but are exactly the "emergent, build-dependent"
variation the design pillar says not to tune against. `stone_beetle` and
`necromancer` get a genuine bump because they gained an entire extra card's
worth of PL, not because any fight outcome moved.

Depth-band impact was checked with `computeEnemyDepthBands` directly
(before-pool = the live roster with the two edited `goldReward`s reverted to
their old values, after-pool = the live roster as shipped):
`stone_beetle`'s band is unchanged (`[1, 8]` both before and after — it only
passed `toxic_druid`/`hunter` within the SAME tier, not across a tier
boundary), but `necromancer`'s band genuinely moved, `[5, 12]` ->
`[9, 16]` — one tier stronger, since 22 now sits with `knight`/`warbreaker`
(22) rather than `rogue`/`seraph` (20). This is the CORRECT, intended
consequence of `necromancer` gaining a real extra card's worth of PL: it now
anchors slightly deeper into the ladder, matching its new strength, rather
than an accident. `tests/run/enemyDepth.test.ts` (rank-based, no literal
band values pinned) stays green either way — the tier-count/no-gap/no-orphan
invariants it checks hold regardless of which enemy occupies which tier.

**The outcome baseline (`tests/engine/fixtures/outcomeBaseline.json`)** does
NOT field any named enemy from `src/data/enemies.ts` at all — its sweep
(`tests/engine/helpers/sweepConfigs.ts`) builds synthetic combatants
(`sweepUnit`) from the FROZEN `FROZEN_SWEEP_SKILL_IDS` pool with randomized
stats/boards, entirely independent of the enemy roster. Confirmed by reading
`captureOutcomeBaseline.ts`/`sweepConfigs.ts` before touching anything: no
`enemies` import anywhere in that path. Editing `src/data/enemies.ts`
therefore cannot move this fixture by construction, and it was not
regenerated — `npm test`'s existing pass (2244/2244, including the baseline's
own byte-identity assertions) confirms zero drift.

Every edited enemy's `MONSTER_PROFILES` entry (`src/run/leveling.ts`) was
checked against its new kit and needed NO change: every added/swapped-in card
scales off a stat its enemy's profile already weights (Barbed Rampart/
Cornered Beast/Nettle Lash/Rapid Volley/Piercing Reach are physical, scaling
Attack, already weighted on `stone_beetle`/`berserker`/`wolf_king`/`hunter`/
`rogue`; Dulling Hex is magical dark, scaling Magic Power, already weighted on
`necromancer`; Penitent Mending's heal scales Magic Resist, already weighted
on `cleric`) — none introduce a scaling stat the profile weights at zero.
