# Run structure — the pattern QUEUE (deck-construction first)

> **Scope:** REFERENCE + PROPOSAL. This doc owns no fact about the project.
> Where it describes World1, code wins, then the owner named in
> [`INDEX.md`](INDEX.md). Nothing here is implemented.
>
> It is a **build queue**, not an essay: every entry is one buildable unit of
> work, costed against real files, and the last section orders them.
>
> **If any of this ships, the shipped fact belongs in
> [`run-structure.md`](run-structure.md) (or the owner doc for the system it
> touches), and this entry gets struck — not restated.** This doc gets no
> `INDEX.md` row until it stops being a queue.

---

## Why a new doc instead of extending the existing one

[`design-reference-roguelite-structure.md`](design-reference-roguelite-structure.md)
(patterns `P1`–`P26`) is a **map/boss/elite/reward-routing** reference written
against [`biome-paths-proposal.md`](biome-paths-proposal.md).

Most of its cheap items have since shipped (biomes, band forecast, boss
shortlists, type-filtered event doors). Its remaining items are large.

This doc is a **different axis**: what pays off inside DECK CONSTRUCTION,
measured against the systems that landed after that doc was written —
affinity gates, `minTier` locks, titles-by-position, biomes.

So: sibling doc, own numbering (`Q1`…), and it deliberately does **not**
restate any `P`-number. Where a `P` is still open work it is named once, in the
ranked list, and the argument is left where it lives.

---

## 0. The rule this document is written under

**Patterns only. Never content.** Same rule as that doc's §0, unchanged.

No named character, creature, region or boss from another game.
No stat block, table, curve or tuned value.
No distinctively named mechanic, no trademarked term.
No art, text, icon or asset.

Every pattern body below is written **name-free** — the structural idea in this
project's own vocabulary. Attribution lives in §15, as "a place this pattern is
observable", never as a thing to copy. Our names come from our own fiction; our
numbers come from `src/engine/balance.ts`.

Three ideas were dropped outright because they could not be described without
naming someone's IP. They are listed in §13 as dropped, without description.

---

## 0.1 The three filters every pattern had to pass

A pattern that fails any of these is not in the queue, however good it is
elsewhere.

**1. Combat is automatic — so the payoff must land in construction.**
Nothing the player does mid-fight is a decision. A pattern only counts if it
changes what the player BUYS, KEEPS, PLACES or TIERS UP between fights.
"It makes the fight more exciting to watch" is not a pass.

**2. PL is the balance unit — so nothing may rest on "this is just strong".**
Every number must come out of `PRICE` / `TIER_BUDGET_DECI` / `LEVEL_STAT_COST`
or out of the gold economy (explicitly a pacing knob, never a balance number —
`src/run/shop.ts`). A pattern whose whole content is a multiplier is out
(`docs/design-locked.md`).

**3. Determinism — so no hidden per-player state.**
`simulate(config, seed)` is pure; the run is a pure function of its seed plus
recorded player choices. A pattern that needs adaptive difficulty, a hidden
pity counter the player cannot see, or per-player tuning, is out. A counter is
fine if it lives on `RunState` and the UI shows it.

---

## 0.2 What is already built

Stated so the queue does not re-propose shipped work. Measured over
`src/data/content/skills.v1.json` on 2026-08-26 — **166 cards** after the
Q1/Q2/Q3 pass below; the pre-pass figures are kept beside each line because they
are what the queue was argued from.

- **Affinity gate** — 34 gated cards: **29 whose gate is open on the copy the
  player is first offered**, plus the 5 Diamond capstones whose gated hit is
  `minTier`-locked to Diamond (so it is a payoff at the top rank and nothing on a
  Bronze shelf — the two are counted separately, see Q3).
  Bronze-reachable per type: sword 3 · fire 3 · holy 3 · axe 3 · lance 3 ·
  beast 3 · nature 3 · frost 3 · lightning 3 · dark 3 · bow 3.
  *(Was: sword/fire/holy 3, seven types at 2, **bow 1** — 24 in total.)*
- **Tier lock (`minTier`)** — **25 content users** (was zero): the 24 cards
  migrated off `tierUpgrades.effects` restatements (Q1), plus `rimebarb_vigil`,
  authored with the lock from the start. The offer-surface plumbing a locked card
  needs (`cardOfferableAtTier` / `minOfferableTier` in `src/engine/types.ts`,
  consumed by `src/run/draft.ts` and `src/run/shop.ts`) landed in `d1ac673`.
- **Positional auras** — `affects: adjacent|left|right|allBoard` and `reach`
  (the edge-to-edge GAP dial; there is no separate `gap` field), all resolved in
  `src/engine/combat/auras.ts` and priced in
  `PRICE.auraDamageFlat/auraHealFlat/auraWeightDelta`.
  Content using it: **12 cards of 166** — 6 `adjacent`, 1 `allBoard`, and 5 at
  `left`/`right` with `reach: 2`, spread over offense / defensive / debuff /
  healing / support. *(Was: 6 of 156, all `support`, all `adjacent` or
  `allBoard`, and NOTHING at `reach` > 1 or on a direction.)*
  **The rate is reach-blind** — `powerLevelDeci` multiplies by `affects` only —
  so coverage is capped at 2 pieces by a content rule
  (`tests/engine/auraCoverage.test.ts`); see `docs/power-level-reference.md`.
- **Duplicate merge** — two copies tier up (`mergeRunCard`, `shop.ts`).
- **Sell-back** — half price, floored at 1 (`sellRunCard`/`sellRunGem`).
- **Targeted upgrade** — `upgradeCardPick` events (`src/run/events.ts`).
- **Type-filtered event doors** — one single-type door per card type
  (`src/data/events.ts`).
- **Biomes** — 6 bands, dealt per band, mob weighting + boss shortlists +
  stall/event preference (`src/data/biomes.ts`, `src/run/biome.ts`).
- **Band forecast** — lean, mob family, stalls, event themes and the REAL boss
  from `rollEncounter` (`src/run/biomeForecast.ts`).
- **Enemy affixes** — `MODIFIER_PRESETS`: **2 presets**, both pure numbers
  (`forceTier`, `bonusPL`+`bonusProfile`).

Two numbers in that list *were* the whole argument for the top of the queue: a
gate family with **one** content user, and a positional system with **six**. Both
are now closed — Q1, Q2 and Q3 shipped together on 2026-08-26, and their verdicts
below have been rewritten from ADOPT NOW to SHIPPED with what actually landed.

---

## Q1 — One definition carries the whole tier ladder

**The pattern.**
When a card gets stronger at higher ranks, there are two ways to author it:
restate the card's whole kit once per rank, or declare the kit once and mark
the lines that only exist from a given rank upward. The second is the same
information with one copy of it. The first is a duplication that drifts — a
number changes somewhere central and every hand-solved restatement has to be
re-derived by hand, with nothing to catch the one that was missed.

**Why it fits here.**
This is not a genre import; it is a migration the codebase already built the
target for. `TierLocked` (`src/engine/types.ts`) exists, is enforced in exactly
one place (`tierResolved` strips a locked action below its lock), prices
correctly by construction (a stripped action is charged nothing), and — AT THE
TIME THIS WAS WRITTEN — had **zero** content users, while 72 of 156 cards
restated an effects list in `tierUpgrades`. It pays off in construction because the tier solver then
re-solves every rung from one definition — so the player reads one card face
whose higher rungs are budget-honest rather than hand-solved.

**What it would cost.**
Content-only, and it is the cheapest item in this doc.
`src/data/content/skills.v1.json` — replace a `tierUpgrades.<tier>.effects`
restatement with a `minTier` on the one action that was being added.
No engine change. No new price. `npm test` already covers it
(`tests/data/contentSchema.test.ts`, the budget audit, `autoScaleTier`).

**MEASURED, RE-DERIVED, AND SHIPPED (2026-08-26).** The doc's own method — a
card qualifies when every `tierUpgrades` entry sets no `scope` and appends to a
leading action list that matches the base exactly — actually yields **29**
candidates, not 28 (`hemorrhage` was missed). Of those 29, **24 migrate with
byte-identical resolved output at all four tiers** and are done:

    arcane_bolt · armor_break · battle_howl · bramblewrath · cinder_skin
    crippling_strike · disarming_blow · frost_ward · hex_of_frailty
    hunter_shot · iron_riposte · judgment_light · lance_thrust
    leeching_fang · mind_frost · retaliation_stance · ruinous_hex
    static_jolt · storm_guard · stunning_smash · thorn_shackle
    umbral_ward · unbreakable_stance · ward_of_silence

**Five candidates are NOT pure adds and were left alone.** The doc's signature
test ignores numbers, which is right for a card the solver re-derives — but these
five change an EXISTING line's magnitude per tier, so there is nothing for the
solver to reproduce:

- `swift_march`, `time_crystal`, `warlord_banner` — the appended `buffStat` grows
  15 → 20 → 25% per rank. `buffStat` is FROZEN empower; the solver holds it at 15
  and the authored ladder cannot be recovered.
- `verdant_rebuke` — its `lifesteal` grows 45 → 60%. Same reason.
- `hemorrhage` — its `expose` grows 20 → 30% AND its base is a DoT the solver
  grows greedily, so the migrated card is a different card at every rank.

Migrating any of them would need the solver to scale a frozen empower magnitude,
which is a user-locked rule (2026-07-23), not a content decision.

**What the migration actually deletes, and what it keeps.** Gone: 811 lines of
restated `effects`. Kept: the per-tier `text` override on every rung at or above a
lock — `retextScaledNumbers` rewrites CHANGED numbers in existing prose and cannot
invent the clause for a line the Bronze face never mentioned, so a text block is
mandatory there and `tests/engine/tierLock.test.ts` now asserts it.

**The equivalence is pinned as a real before/after**, not a self-consistent
tautology: `tests/engine/tierLockMigration.test.ts` reads the PRE-migration
definitions out of `git show d695eaa:src/data/content/skills.v1.json` through the
production loader and compares effects, order, numbers, aura, weight, cooldown,
scope, text, the per-part price breakdown, AND the fully assembled
`resolveEffectiveSkill` output (which matters: `leeching_fang` is in the set and is
the one card `orderCastSinks` reorders). Corroborating: 14 of the 24 sit in
`FROZEN_SWEEP_SKILL_IDS`, and `outcomeBaseline.json` did not move.

**Verdict: SHIPPED 2026-08-26 (24 of 29).** Content-only, no price moved, and
the five it could not take are named above with the reason. `minTier` went from
zero content users to 25 (the 24 migrated plus `rimebarb_vigil`, which the lock
made expressible for the first time — see Q3).

---

## Q2 — The board is a place, not a bag

**The pattern.**
Where a build lives on a fixed strip of slots, the slot a piece occupies is
itself a decision. Effects that read a piece's NEIGHBOURS turn a flat
collection into a layout puzzle: the same set of cards is a different build
depending on order, so "which card" and "which slot" become two questions
instead of one. This is the standard depth generator in board-shaped
autobattlers, and it costs nothing at runtime — the interaction is between
things the player already owns.

**Why it fits here.**
It pays off ENTIRELY in construction: a positional payoff is a decision made
with the fight not running, and re-made every time the board changes. It is
PL-honest already — `auraModsDeci` prices `damageFlat`/`healFlat`/`weightDelta`
by magnitude against measured neighbour coverage (`PRICE.auraDamageFlat` = 10 =
5 × its 2-neighbour coverage), so a wider aura costs more with no new
argument. And it is deterministic: the board is static during a fight and
`resolveAuras` walks it by index.

The gap is content, not machinery. Six cards of 156 carry an aura. All six are
`support`. `reach` — the dial that makes "one slot away" or "across a gap" a real
distinction — has **no content at all**, and neither does either DIRECTION
(`left`/`right`). The 10-slot board is currently, for 150 of 156 cards, an
unordered bag.

**What it would cost.**
Content-only for the first pass: new entries in
`src/data/content/skills.v1.json` carrying `aura` (and `reach`/`gap`), priced
by the existing `auraModsDeci`. Cards outside `support` are the interesting
half — an offensive card that also lifts its left neighbour makes placement
matter for a board that is not spending a slot on a pure buff piece.

A later pass wants aura mods beyond the three current fields, which is NOT
content-only: a new mod kind needs a rate in `PRICE`, a fold in
`src/engine/cards.ts`, and a cap-family decision. Keep that separate.

**SHIPPED 2026-08-26 — six new positional cards, and the pricing constraint the
pass ran into.**

| card | type | roles | aura |
|---|---|---|---|
| `enfilade_volley` | bow | offense | `right` reach 2, `damageFlat` 3 |
| `packline_flank` | beast | offense + support | `left` reach 2, `damageFlat` 4 |
| `rearguard_pike` | lance | defensive + support | `left` reach 2, `weightDelta` −2 |
| `gravelight_choir` | dark | healing + support | `left` reach 2, `healFlat` 4 |
| `rimebound_pact` | frost | offense + debuff | `right` reach 2, `weightDelta` −2 |
| `stormrank_relay` | lightning | offense + support | `adjacent`, magical filter, `weightDelta` −2 |

So `left`/`right` and `reach: 2` have content for the first time, and five of the
twelve aura cards in the book are no longer `support`. Every one of the six also
carries an affinity-gated line, which is Q3 in the same card: the aura is
UNCONDITIONAL (an aura cannot be gated — the lock and the gate are both
per-ACTION), so the positional half works on any board and only the extra line
asks for the identity. Two layers of construction decision, one slot.

**THE CONSTRAINT THE PASS FOUND, and it is a real hole.** `powerLevelDeci` prices
an aura as `auraModsDeci(mods) * (affects === 'allBoard' ? 2 : 1)` — **it never
reads `AuraDef.reach`** — while `PRICE.auraDamageFlat`'s own derivation is "the
best adjacent placement (**2 casting neighbors**) is PL-fair". So `adjacent` at
`reach: 2` reaches up to FOUR pieces at the two-piece price: free PL. One-sided
reach is the honest shape (at most two, all on one side, exactly the calibration),
which is why five of the six above are `left`/`right` rather than a widened
`adjacent`. The rule is now enforced as content —
`tests/engine/auraCoverage.test.ts` measures coverage by walking the real 10-slot
board through the real `auraCovers`, and separately proves the pricer is
reach-blind so the rule is guarding a live hole rather than restating code. Full
write-up: `docs/power-level-reference.md`, "Aura coverage".

**NO NEW `allBoard` CARD, deliberately.** `allBoard` is the one aura shape for
which position does not matter, which is the opposite of what this pattern is for
— and its ×2 multiplier against up to 9 pieces is a documented approximation
(`warlord_banner`) this pass had no reason to widen exposure to.

**Verdict: SHIPPED 2026-08-26** for the content pass; **ADOPT LATER** for
widening the mod vocabulary — and that LATER now also owns a **reach term in
`PRICE`**, without which `adjacent` cannot legally project further than one slot.

---

## Q3 — A payoff needs a measured supply of enablers

**The pattern.**
An archetype exists when the offer pool reliably contains both halves of it:
the payoff that rewards commitment, and enough enablers to reach the
commitment. Density is the whole design. Too few enablers and the payoff is a
trap; too few payoffs and the enablers are just cards. The discipline is to
declare a target ratio per archetype and then MEASURE the live pool against it,
rather than authoring by feel and hoping.

**Why it fits here.**
The game has exactly one commitment payoff — the affinity gate at
`IDENTITY_THRESHOLD` = 3 — and eleven archetypes it can key on. Payoff density
is 1 to 3 cards per type, and **bow has one**. Enabler density (cards of the
type at all) runs axe 22 down to bow 10 and frost 10. So the payoff a bow
board is offered is a single card, and the pool it must fill three slots from
is the thinnest in the book.

(Measured precisely for the pass: BRONZE-REACHABLE payoffs per type were bow 1;
frost / lightning / dark / beast / nature / lance / axe 2; fire / holy / sword 3
— 24 in all. The other five gated cards are the Diamond capstones, whose payoff
is `minTier`-locked and therefore is not supply on any shelf below Diamond;
counting them would have claimed reachability the shop does not have.)

This is squarely a construction pattern, needs no new mechanism, and is
PL-neutral: an affinity card is already priced with its refund, so authoring
more of them adds no power, only reachability.

**What it would cost.**
Content: more gated cards in the thin types
(`src/data/content/skills.v1.json`).
Plus one test extension: `tests/run/affinityReachability.test.ts` already
measures per-shelf TYPE density; it does not measure **payoff-to-enabler ratio
per type**, so a type can have plenty of cards and one payoff and pass. Add
that assertion and the floor becomes enforceable rather than aspirational.

**SHIPPED 2026-08-26 — nine new gated cards, a declared floor, and a test that
holds it.**

Six of the nine are the Q2 positional cards above (bow, beast, lance, dark,
frost, lightning). Three are gated-only, chosen to widen the gate's ARCHETYPE
spread as well as its type spread — 17 of the 24 pre-pass bronze-reachable gated
cards were `offense`:

- `marksmans_creed` — bow, offense + debuff, gated `expose`. Bow was the whole
  point: one payoff, thinnest enabler pool. Now three.
- `cleaving_creed` — axe, offense + debuff, gated `bleed`. Axe is the WIDEST type
  in the book (22 on-type) and had the largest enabler-to-payoff gap measured.
- `bramble_covenant` — nature, defensive + debuff, gated `poison`.

Every type is now at **3 or more** bronze-reachable payoffs.

**THE FLOOR, DECLARED AND ASSERTED** in `tests/run/affinityReachability.test.ts`:

1. **≥ 3 bronze-reachable payoffs per type.** One is a lottery, two is a coin
   flip on which one the shop rolls; three is where the reward becomes a choice.
   Deliberately the same number as `IDENTITY_THRESHOLD` — the ask and the answer
   are the same size.
2. **Non-payoff on-type cards ≥ `(IDENTITY_THRESHOLD − 1) × payoffs`.** This is
   the ratio the rot shows up in: a future pass that keeps adding gated cards to a
   thin type raises the payoff count without adding anything that can open the
   gate. Held with room today (tightest is bow: 9 non-payoff cards against a
   required 6) — a tripwire, not a fit.
3. **Capstones are counted separately and cannot lift a type over the floor** —
   asserted, so the measurement cannot quietly start crediting a Diamond-only
   payoff to a Bronze shelf.

**AND THE THORNS GAP, closed in the same pass.** No thorns card's stack count had
ever grown with rank: `thorns` is EMPOWER, which is FROZEN across tiers
(user-locked 2026-07-23), and `autoScaleTier` never scales an empower magnitude —
so all twelve shipped thorns cards carried their Bronze pile at Diamond. Since a
reflect is an ordinary PHYSICAL hit (user-locked 2026-08-21) with the attacker's
armor subtracted and a min-1 floor, the eight small ones (5-8 stacks) sting for
exactly 1 against any 8-armor attacker, at every depth and every rank.

`rimebarb_vigil` (frost, defensive, size 2) is the first card whose reflect grows:
four `thorns` lines on ONE definition, three behind `minTier`, merging into a
single pile (one pile per holder, like the DoTs) for **5 / 8 / 11 / 14** stacks at
bronze / silver / gold / diamond. Each locked line is charged in full at and above
its lock and nothing below it, so the tier-up genuinely BUYS reflect. **This card
is only expressible because of Q1** — a `tierUpgrades` restatement growing a frozen
empower magnitude is exactly the shape the solver refuses.

Stated plainly, because the pricing law binds here: `EFFECT_CAPS_DECI.empower` is
150 deci at size 2 (= 15 stacks) and 200 at size 3 (= 20), frozen at every tier,
so **no authored card of any size can put more than 20 stacks up in one cast** and
none can out-scale late-depth armor by stack count alone. Raising that needs a rate
or cap change — balance-designer's call, not a card's. What a card can do is reach
the pile that runtime stacking compounds, and `rimebarb_vigil` is built for it:
`speedWeight` 14 against a size-2 baseline of 20 makes it the quickest wall in the
book, and a recast merges into the existing pile (runtime stacking is intentional
gameplay, user-locked 2026-07-20 — never clamped).

**Verdict: SHIPPED 2026-08-26.** Content plus the floor test; the one payoff
keyword in the game is now reachable for every type it claims to serve, and the
gap cannot silently reopen.

---

## Q4 — Let the player DECLARE the build before the pool narrows

**The pattern.**
A commitment payoff is only a decision if the player can decide to pursue it.
If the pool is wide and undirected, a synergy does not get built — it gets
noticed, late, by accident. The fix is a declaration surface early enough to
act on: the player names an intent, and the offers thereafter serve it.

**Why it fits here.**
`P21` in the sibling doc adopts this at BAND level, and biomes now deliver it.
The gap this entry names is one level earlier and still open: the **start
draft**. `rollStartDraft` deals four sets themed by ARCHETYPE — offense,
defense, support, wildcard. Nothing in it is themed by TYPE, which is the axis
the payoff actually keys on. The proposal measured the consequence: a run
reaches 3 cards of a NAMED type out of the start draft as rarely as 3%.

So the run's first four decisions — the only decisions taken with a clean board
— cannot express the one commitment the game rewards. A player who wants a
frost board cannot start one; they can only hope.

**What it would cost.**
Small, run-layer, no engine: `src/run/draft.ts`. Make one of the four sets a
TYPE set — five cards of one type, the type drawn from the run seed — or offer
two type sets and let the pick itself be the declaration. Pool builders and
deterministic backfill already exist there.
Tests: `tests/run/draft.test.ts` (set shape), and
`tests/run/affinityReachability.test.ts` should then measure the draft as an
acquisition surface, not just shelves.
UI: the Draft scene already renders four labelled sets — a type set needs its
label to say the type, both platforms.

**Verdict: ADOPT NOW.** Cheapest fix to the biggest measured gap between what
the content asks for and what the run supplies.

---

## Q5 — The harder rung must be a different fight, not a bigger one

**The pattern.**
When a difficulty rung is a pure number — more health, more damage, a higher
rank — the encounter is longer, not harder, and nothing in the player's build
has to change. When the rung instead adds one clearly stated BEHAVIOUR, the
player's answer has to change, and because the change is known in advance it
becomes a shopping instruction.

**Why it fits here.**
This is `P14`, carried forward because it is **still unbuilt** and because
measurement since makes it sharper than the sibling doc could state.

- `TITLE_PRESETS.elite` is +2 levels, +2 rank, +1 extra card. All numbers.
- `fightSpecFor` attaches an affix only past `MAX_LEVEL` (30) — one more
  distinct id every 5 fights. So **no fight before 31 has an affix at all**.
- `MODIFIER_PRESETS` holds **2 entries, both pure numbers** (`forceTier`,
  `bonusPL`). There is currently no behavioural affix to attach.

So "make the elite behavioural" is not a wiring job, as the sibling doc reads
it — the affix vocabulary itself has to grow one field first.

The honest lever is already sitting there: `EXTRA_CARD_POOL`
(`src/run/encounter.ts`) is a hardcoded 6-card pool split by property, and an
extra card is already priced inside the encounter's board cost. An affix that
grants a NAMED card — a taunt, a cleanse, a thorns piece — changes the player's
priority order without inventing an out-of-PL dial.

**What it would cost.**
- `src/data/modifiers.ts` — one new optional field on
  `EnemyModifierPreset` (a card grant), plus the new presets as content.
  `src/data/content/modifiers.v1.json` + `validateModifierContent.ts`.
- `src/run/encounter.ts` — one branch reusing the existing `addExtraCards`.
  Check the cost lands in `soloThreatDeci` so packs stay budget-honest.
- `src/run/runState.ts` — `fightSpecFor` gives elite-titled fights an affix
  before level 30 (still a pure function of the fight number).
- `src/game/runStore.ts` — `encounterHintDetail` prints name/level/title and
  nothing else today; the affix has to appear there, both platforms, or the
  pattern delivers nothing.

**Verdict: ADOPT NOW**, with the affix-field work understood as part of it. The
run's middle rung currently means "the same fight, larger" for the first 30
fights, which is most of most runs.

---

## Q6 — A second rung on the commitment

**The pattern.**
A single threshold makes commitment binary: you are at the bar or you are not,
and past the bar every further card of the type adds nothing to the payoff. A
LADDER of thresholds turns the same commitment into a spectrum — go deeper, get
a distinctly bigger payoff — so the build keeps having decisions after it has
qualified.

**Why it fits here.**
`board-type-identity.md` already lists this under "explicitly deferred"
("multiple simultaneous affinities / second threshold tiers (e.g. 5+)"), so it
is a sanctioned direction rather than a new idea.

It is construction-only by definition — the threshold is counted at combat
setup from a board that cannot change mid-fight. And it is PL-honest with no
new argument, because the existing refund derivation is already stated as a
price for **commitment measured in dictated slots**: a 5-card requirement
dictates more slots, so it earns a larger refund by the same reasoning that set
the current one.

The board is 10 slots and 105 of 156 cards are size 1, so a 5-of-a-type
requirement is reachable but genuinely expensive — which is what makes it a
decision rather than a formality.

**What it would cost.**
Engine, small but determinism-adjacent — brief the combat-engine specialist.
- `src/engine/combat/typeIdentity.ts` — the derivation returns a COUNT (or a
  rung), not just an identity.
- `src/engine/types.ts` — the gate flag carries a rung, staying the same
  cross-cutting shape as `affinity`/`minTier` (one flag, one check, one price).
- `src/engine/combat/interpreter.ts` — `affinityOpen` compares against the
  rung.
- `src/engine/balance.ts` — one refund constant per rung, derived the way the
  current one is, with its derivation written down.
- `src/engine/keywords/pricing.ts` + `validateSkillContent.ts` + the card face.
- Determinism: the un-featured input must resolve byte-identical (the 100-config
  test and the budget audit are the bar).

**Verdict: ADOPT LATER.** Right shape, sanctioned, but it touches the pricing
of the one keyword family the game currently leans on — do it after Q1–Q5 have
proven the family carries content.

---

## Q7 — The requirement family, not one more keyword

**The pattern.**
Discounting an effect in exchange for a build requirement is a *generator*, not
a feature. Once the engine can express "this line exists only when the build
satisfies X", every future X is a small addition instead of a new mechanic:
one gate check, one price adjustment, and every existing keyword composes with
it for free. The design work moves from inventing effects to choosing which
requirements are interesting to satisfy.

**Why it fits here.**
The project has already discovered this twice and written it down both times.
`AffinityGated` gates on the BOARD and refunds; `TierLocked` gates on the CARD'S
RANK and prices by stripping. Both are one flag on `Action`, enforced in one
place, unknown to every keyword — and the doc comments say explicitly that this
shape replaced a family of bespoke keywords that each wanted a pricing row, an
interpreter arm, a validator case, a glossary entry and a face badge.

So the pattern to adopt is: **the next mechanic should be a requirement, not a
keyword.** Candidate requirements, all statically checkable and all
construction-facing:

- **Position** — the line exists only when the card sits at an edge of the
  strip, or has a neighbour, or has none. Pairs directly with Q2, and the
  footprint machinery (`slotsOf`, `canPlace`) already knows all of it.
- **Board shape** — only when the board holds no other copy of this card, or
  only when the board is at most N pieces. Prices like affinity (a dictated
  slot count), and rewards a deliberately thin board — a shape nothing in the
  game currently rewards.
- **Rank spread** — only when the card is the board's highest tier. Reads off
  state the resolver already has.

Each is a REQUIREMENT the player meets in the shop and the loadout, which is
precisely where this game's decisions live.

**What it would cost.**
Per requirement, mirroring the affinity precedent exactly:
- `src/engine/types.ts` — one optional flag on `Action`, documented like its
  two siblings.
- one check — `applyAction`/`interpreter.ts` for cast-time requirements,
  `tierResolved`/`cards.ts` for statically strippable ones.
- one price — a refund constant in `src/engine/balance.ts` **with its
  derivation written down**, plus its row in `keywords/pricing.ts`.
- `validateSkillContent.ts` (refuse a requirement no board can meet), the card
  face, and the glossary.
- Then content is free: every keyword composes.

Note the one rule the existing docs establish and any new member must obey:
a CONDITIONAL payload may never be paid for out of the always-on payload
(`wildfire_rite`'s shipped bug), while an UNCONDITIONAL tier-locked line may.

**Verdict: ADOPT LATER**, one member at a time, position-gating first (it is
the one that makes Q2's content pass compound). Not now: the family already has
a member with 29 users and a member with zero, and adding a third before those
carry content is how a generator becomes a graveyard.

---

## Q8 — Guarantee the category; roll the instance

**The pattern.**
A player only routes toward a supply promise they can rely on. A promise that
is statistically likely but not certain gets read as certain, then breaks once,
and after that the player stops reading the label — at which point the whole
legibility feature is dead weight. Where a guarantee is cheap, take it, and word
everything else as the lean it is.

**Why it fits here.**
The sibling doc adopts this as `P22`/`P4` at the level of PANEL WORDING. This
entry is the mechanical half, and biomes make it newly concrete: every biome
binding is deliberately a PREFERENCE with fallback (`preferIds`/`weightIds`),
which is the correct engineering call — a hard silo measurably collapsed band
variety and breaks the reachability audits. But it means the band's SUPPLY
promise is statistical, while the band's BOSS is certain.

The affinity threshold is a hard requirement: three cards of one type, or the
gated half of 29 cards does not exist. A statistical supply against a hard
requirement is the shape that produces a dead run.

So the cheap guarantee worth buying: **the band's first stall of its own lean
type offers at least one card of that type.** One slot, once per band. Not a
silo — a floor.

**What it would cost.**
`src/run/shop.ts` — `rollShopStock` overrides ONE slot when the shelf's theme
is the band's lean stall. Determinism-sensitive: it must not spend an extra
`Rng` call or reorder existing draws (the biome layer's own contract, and the
reason band binding was built as "which array an existing draw indexes into").
Brief it as a determinism-critical change and pin it with
`tests/run/affinityReachability.test.ts` (which already measures per-shelf
density and would show the floor).
Alternative, cheaper and fully outside the shop: author the guarantee as an
EVENT door filtered to the band's lean type — `src/data/events.ts` already has
single-type doors and `CardFilterClause` already filters on type, so this is
content-only. Worth pricing both before choosing.

**Verdict: ADOPT LATER.** High value, but it is either a determinism-sensitive
edit or a content pass that wants the band's lean threaded into event rolling —
after Q1–Q5.

---

## Q9 — Let the player hold an offer they cannot afford yet

**The pattern.**
A shop that fully re-rolls destroys information the player just paid attention
to. Letting them RESERVE one offer across the refresh converts "I cannot afford
the right card" from a dead end into a plan: save this turn, buy next turn.
It is a small mechanic with an outsized effect on how deliberately a build gets
assembled, and it is a near-universal convention in shop-driven autobattlers.

**Why it fits here.**
Pure construction. It is PL-neutral by construction — it moves nothing but
WHEN a purchase happens, and gold is explicitly a pacing knob, not a balance
number. It is deterministic and reload-safe in the way this codebase already
does it: per-node shelves already persist on `RunState.shopShelves`, and a
reroll already re-rolls from `baseSeed + rerollCount`, so a held slot is
recorded state the UI can show — not hidden state.

It also directly serves the affinity problem: the third card of a type is
exactly the purchase a player is most often one or two gold short of.

**What it would cost.**
- `src/run/shop.ts` / `src/run/runState.ts` — a `held` slot index (or a small
  array) on `RunShopShelf`; `rerollRunShop` carries held offers across
  instead of replacing them.
- Decide the price: free but limited to one slot, or 1 gold. A price is the
  safer default — it keeps reroll pressure real.
- `src/game/shopActions.ts` — the sandbox mirror.
- UI both platforms: a hold affordance on the shelf and a visible held state
  (`docs/feature-inventory.md` is the ledger).
- Tests: `tests/run/shop.test.ts` — held offers survive a reroll, and reroll
  seeding is otherwise unchanged.

**Verdict: ADOPT LATER.** Genuinely good and cheap in the pure layers, but it
is a two-platform UI feature — rank it after the content-only wins.

---

## Q10 — A declared wager on the next band

**The pattern.**
Optional difficulty works best when the player DECLARES it, up front, for a
stated stretch of the run, in exchange for a stated reward category. It reads
as a contract rather than a slider: harder in a named way, for a known payoff,
chosen while the player can still shop against it.

**Why it fits here.**
The run is endless with no victory state, so the only escalation the player
currently controls is the fight column's three rungs — and those vary on one
axis, risk-to-gold. A band-scoped wager gives the endless ladder a second dial
the player owns.

It is PL-honest in a way a generic "hard mode" is not: the wager IS a
`MODIFIER_PRESETS` affix, priced through the same bonus-PL economy as every
other stat point, and `battleGoldReward` already scores modifier count into the
payout. It is construction-facing because it is declared BEFORE the band's
shops — announcing "everything here is faster" is a shopping instruction.
And it is deterministic: the choice is recorded on `RunState`, not inferred.

Two cautions. It compounds with Q5 (the affix vocabulary must exist first,
or the only wagers available are pure numbers). And the reward must not pay
the ladder's own currency — gold or a card category, never hero level
(`heroLevel == fightNumber` lockstep is asserted by name in the run tests).

**What it would cost.**
- `src/run/runState.ts` — a per-band declared-affix field, applied by
  `fightTableEntryForNode` on that band's fights.
- `src/data/modifiers.ts` — the affix set worth wagering on (needs Q5).
- `src/run/shop.ts` — the payout side, if it pays gold.
- `src/run/biomeForecast.ts` — the band panel states the wager.
- UI both platforms: the declaration surface, most naturally on the band
  banner the forecast already feeds.

**Verdict: ADOPT LATER.** Right shape for an endless ladder, but it is
downstream of Q5 and of the biome fork (`P`-track Phase 3).

---

## Q11 — A comeback lane that buys deck repair, not survival

**The pattern.**
Run-based games with a persistent economy often let a losing streak pay better
than a winning one. The point is not mercy: it converts a bad stretch into
PURCHASING POWER, so the player's response to losing is to rebuild the deck
rather than to walk the same deck into the same wall.

**Why it fits here.**
Every loss already costs exactly one life out of three, so the run's failure
mode is a small number of hard, irreversible steps. In between them the player
gets +1 gold per node and no fight gold on a loss — so a losing run gets
LESS ability to fix itself, precisely when fixing itself is the only move.

Gold is the honest currency for this: `src/run/shop.ts` says in its own comment
that gold is an economy-pacing knob and never a balance number, so tilting it
is not a balance change. Deterministic if the streak counter lives on
`RunState` beside `wins`/`losses` and the HUD shows it.

The risk is real and worth stating: this softens the exact tension lives exist
to create, and it is the one entry here whose value is a guess rather than a
measurement.

**What it would cost.**
- `src/run/runState.ts` — a consecutive-loss counter on `RunState`
  (`RunStats` already has the transition points), reset on a win.
- `src/run/shop.ts` — `battleGoldReward` (or the daily income) reads it.
- HUD line, both platforms, or it is hidden state.
- Tests: `tests/run/runState.test.ts`, `tests/run/shop.test.ts`.

**Verdict: ADOPT LATER**, lowest of the LATERs — and only after a playtest says
losing runs actually stall. It is the one item here proposed on theory.

---

## Q12 — One declarable region per archetype

**The pattern.**
If a region's identity is the mechanism by which a player declares a build,
then any archetype WITHOUT a region cannot be declared — it can only be
stumbled into. Coverage of the declaration surface is therefore a design
requirement, not a content nicety: the set of declarable identities is the set
of regions, whatever the card pool says.

**Why it fits here.**
Six biomes against eleven card types. Fire, holy, nature, sword, axe and beast
have a band. **Frost, lightning, dark, bow and lance do not** — and those are
four of the five thinnest types in the book (bow 10, frost 10, lightning 11,
dark 12).

`src/data/biomes.ts` mitigates the SUPPLY half honestly: every homeless
single-type stall is carried at priority 1 by some band, with the invariant
pinned by `tests/run/biomeSupply.test.ts`. So a frost shelf still appears. What
cannot happen is a frost BAND — five waves whose mobs, boss, stalls and events
all point one way, which is the thing that makes a declaration worth making.

The blocker is named in the file's own comment and it is not biome data: the
roster fields 1 or 0 mobs for each of those five types, so a band for them
would be a name with no monsters behind it. Two of the five bosses already ride
as guests in other bands for exactly this reason.

**What it would cost.**
- **Enemy content first** (the real cost): `src/data/enemies.ts` +
  `content/enemies.v1.json` — mobs of the missing types spread across the depth
  tiers `computeEnemyDepthBands` splits the pool into. Bronze-floor authoring
  only; scaling belongs to the run layer (`docs/enemy-design.md`).
- **Then the band is five lines** of content in `src/data/biomes.ts`, exactly
  as that file says.
- Tests already waiting: `tests/run/biomeSupply.test.ts`,
  `biomeMobs.test.ts`, `enemyDepthGating.test.ts`.

**Verdict: ADOPT LATER.** The biome half is trivial; the enemy roster half is
the largest content item in this doc. Sequence it as an enemy-content project
that ends in a five-line biome entry, never the reverse.

---

## 13. Rejected, and dropped

**REJECT — a service that changes a card's TYPE.**
It looks like the perfect fix for a near-miss affinity board, and matchups are
PL-neutral so it would price at zero. That is exactly why it fails: the
affinity refund is explicitly paid for *commitment* — slots dictated at build
time, plus handing the enemy a known attack vector. A cheap retype makes the
commitment retroactive, so the refund is paying for a cost the player no longer
bears. Not a balance bug; a hole in the reason the discount exists.

**REJECT — a paid card-removal service.**
The genre's classic scarce service, but this game already has the honest
version twice over: `sellRunCard` at half price, and a 10-slot board where the
opportunity cost is the slot rather than a deck-thinning probability. There is
no draw step, so thinning has no meaning here. Adding a removal shop would be a
second door onto a solved problem.

**REJECT — adaptive difficulty of any kind.**
Reading how the player is doing and quietly retuning the next encounter is the
standard fix for pacing, and it is unbuildable here: it is hidden per-player
state, so it breaks the "wave N is deterministic from the run seed" contract,
and it prices nothing.

**REJECT — a hidden pity counter.**
Same objection, narrower. A guaranteed floor is fine (Q8) as long as the rule
is stated. A counter the player cannot see is not.

**REJECT — an ambient region combat rule** ("+X% of the band's type here").
Already rejected in the sibling doc and in `biome-paths-proposal.md` §6.5;
restated only because it is the first idea a "biome" invites. PL is the balance
unit; a biome is supply and legibility.

**REJECT — mid-fight phase changes.** No phase concept in the engine, and
adding one is a core-loop change the resolver seam exists to prevent.

**DROPPED for the copyright guardrail** — three patterns are omitted entirely
because each is inseparable from a specific game's named content:
one region-identity system whose whole structure is its named locations,
one boss-encounter convention that is a named roster and its scripted rules,
and one relic/artifact economy whose design *is* its named item list.
Nothing about them is described above, deliberately. The generic ideas nearby
that CAN be stated without them are already in the queue (Q8, Q12, and `P8`).

---

## 14. The two content gaps in the brief, as they actually read today

Neither is fixed here (another agent is live in those files). Both were
re-measured, and both readings have moved:

**(1) `ironmoot`'s `blood_duelist` is not a leftover placeholder.**
`rollEncounter` builds a boss column's anchor pool as
`biome.bosses.filter((id) => enemies[id] !== undefined)` — it filters on
ROSTER EXISTENCE, not on `isBoss`. `BOSS_POOL` is not consulted when a
shortlist resolves. Both `src/data/biomes.ts` and `src/run/runState.ts` state
the intent in their comments: `isBoss` is an authored identity tag, while the
boss TITLE is applied BY POSITION to whatever mob rolls at the end of a band.
So a plain mob in a shortlist is the designed path, not a hole.

What is still worth a decision is a *design* question, not a bug: a shortlisted
plain mob and an authored boss kit read differently to the player at the same
title. If they should not, the fix is an authoring rule ("a shortlist entry is
either an `isBoss` kit or a deliberate champion, and the panel says which"),
plus a test in `tests/run/bossRoster.test.ts`. **Queue position: not in the
ranked list — it needs a ruling, not an implementation.**

**(2) All 11 bosses are reachable; the gap is five typeless BANDS.**
`dawn_arbiter` and `hollow_crown` both sit in `hallowfield`'s shortlist today,
and `rime_tyrant`/`galewright` ride as guests in `howlmoor`/`emberwaste`. So no
boss is orphaned.

The real remaining gap is Q12: frost, lightning, dark, bow and lance have no
band at all, so those five identities cannot be declared, and their bosses
appear only as guests in a band that leans elsewhere. That is an ENEMY-ROSTER
project, and it is ranked as one.

---

## 15. Build next — ranked

Ordered by (value delivered) ÷ (machinery disturbed). Each item is
independently shippable and green.

**Content-only — ~~do these first~~ DONE 2026-08-26.**

1. ~~**`minTier` migration (Q1).**~~ **SHIPPED** — 24 of 29 re-derived
   candidates, byte-identical resolved output at all four tiers, pinned against
   the pre-migration defs read out of git. Five are not pure adds and are named
   in Q1.
2. ~~**Positional content pass (Q2).**~~ **SHIPPED** — six cards on
   `left`/`right` + `reach: 2` (plus one filtered `adjacent`), across five roles.
   Left behind for the LATER pass: **a reach term in `PRICE`**, without which
   `adjacent` cannot legally project past one slot (see Q2).
3. ~~**Affinity payoff density (Q3).**~~ **SHIPPED** — nine gated cards take
   every type to ≥ 3 bronze-reachable payoffs, and
   `tests/run/affinityReachability.test.ts` asserts the payoff floor AND the
   payoff-to-enabler ratio. Plus `rimebarb_vigil`, the first thorns card whose
   stacks grow with rank.

**Small run-layer — do these first now.**

4. **A type set in the start draft (Q4).** `src/run/draft.ts` + Draft-scene
   labels. Closes the 3%-of-runs measurement on declaring a type early.
5. **The elite affix (Q5).** Needs one new field on `EnemyModifierPreset`,
   its content, a branch in `encounter.ts`, an affix before fight 31 in
   `fightSpecFor`, and the affix printed in `encounterHintDetail`.
   Fixes "the same fight, larger" for the first 30 fights of every run.

**Systems — after the above have landed.**

6. **The lean-type supply floor (Q8).** Prefer the content-only event-door
   route; take the `rollShopStock` route only with a determinism brief.
7. **Hold an offer across a reroll (Q9).** Cheap in the pure layers, two
   platforms of UI.
8. **A second commitment rung (Q6).** Engine + a new refund derivation;
   combat-engine specialist, after affinity content has grown.
9. **One more requirement flag (Q7)** — position-gating first, because it
   compounds with item 2.
10. **The declared band wager (Q10).** Downstream of item 5 and of the biome
    fork.

**Content project — parallel track, own timeline.**

11. **Mobs for the five typeless bands, then the bands (Q12).** Enemy roster
    first; the biome entries are five lines each once mobs exist.

**Lowest — theory only.**

12. **Comeback gold (Q11).** Only if a playtest shows losing runs stall.

Two items from the sibling doc are still open and are not re-argued here:
`P14` is item 5 above, and `P18`/`P20` (the fight column is a one-axis fork)
still needs a balance-designer ruling before it can be queued at all.

**Items 1–3 are shipped; the note below is kept as the reasoning that put them
first.** They were content-only, they needed no
decision from anyone, and each one makes an already-built system carry the
content it was built for.

---

## 16. Sources, and the network

Cited as places a **pattern** is observable. Nothing was copied from any of
them, and no source's content, names or numbers appear above. Retrieved
2026-08-26.

**Deck economy, removal, and thinning**
- <https://www.gamedeveloper.com/design/tackling-deckbuilding-design-in-abrakam-s-roguebook> *(EGRESS_BLOCKED; search summary only)*
- <https://steamcommunity.com/app/1076200/discussions/0/2953789422404133845/>
- <https://rogueliker.com/roguelike-deckbuilders/>

**Archetypes, payoffs and enabler density**
- <https://medium.com/@felix.moll.pro/archetypes-in-deckbuilding-games-f9bb2933393f>
- <https://www.gamedeveloper.com/design/archetypes-in-deckbuilding-games> *(EGRESS_BLOCKED; search summary only)*
- <https://printacube.com/mtg-cube-archetype-density-how-many-payoffs-and-enablers-you-actually-need/> *(EGRESS_BLOCKED; search summary only)*
- <https://www.mtgnexus.com/articles/1091-sywtbas-draft-archetypes>

**Autobattler construction phase, shops, merging, positioning**
- <https://grokipedia.com/page/Auto_battler>
- <https://dinogame.gg/blog/what-is-an-autobattler/>
- <https://mobalytics.gg/the-bazaar/guides/beginner-guide>
- <https://thebazaarzone.com/tips/>

**Endless modes and opt-in difficulty**
- <https://entaltostudios.com/5-essential-tips-to-make-your-roguelite-game-work/> *(EGRESS_BLOCKED; search summary only)*
- <https://voidcrew.wiki.gg/wiki/Update_4_-_Roguelite_Endless_Mode>

**Randomness, cost granularity, commitment**
- <https://thethoughtfulgamer.com/2021/01/28/slay-the-spire-and-randomness-tolerance/> *(EGRESS_BLOCKED; cited in the sibling doc)*
- <https://critpoints.net/2024/01/18/cost-granularity-in-card-games/> *(EGRESS_BLOCKED; search summary only)*

**Note on access.** WebSearch worked; WebFetch was blocked on six of the seven
domains attempted (`gamedeveloper.com`, `thethoughtfulgamer.com`,
`critpoints.net`, `printacube.com`, `entaltostudios.com`). Those five are
marked and rest on search-result summaries, which is why every pattern above is
argued from **this repo's measurements** rather than from an external source's
reasoning. The measured numbers in §0.2, Q1, Q2, Q3 and Q5 were taken directly
from `src/data/content/*.json` and the run/engine modules named beside them, so
they are auditable here regardless of network state.

**Re-measurement discipline (2026-08-26).** Q1/Q2/Q3 shipped, and every number
in those three sections was re-derived from the book rather than trusted: Q1's
candidate set came out at 29 rather than the 28 recorded here (`hemorrhage` was
missing), and Q3's payoff counts had to be split into bronze-reachable versus
`minTier`-locked before they meant anything. If a future pass quotes a figure
from this doc, re-derive it first — the two that were wrong were both wrong in
the direction of looking smaller than they were.
