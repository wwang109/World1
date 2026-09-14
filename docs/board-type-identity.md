# Deck Affinity (v1 — updated 2026-09-12)

Every card is typed by exactly one **weapon or element** (enforced by
`tests/engine/elements.test.ts`). When a combatant's board leans hard into one
type, the board gains that type's **affinity**.

> **THE BOARD IS THE ONLY SOURCE** (user ruling 2026-09-06): *"affinity are just
> passive buffs based on the board"* / *"so if they meet the requirements they
> should have the affinity effect"* / *"there should be no hardcoded enemy that
> break the rule."* Meet the requirement, get the buff. Nothing else grants one.

> Naming: internally the derivation still lives in `typeIdentity.ts`
> (`boardAffinities`), but everything the player sees calls this **affinity**.
> There is no separate "identity" concept and no "identity" wording in the UI.

## Rule

- **Card type** = `skill.element ?? skill.weapon` (exactly one exists).
- **Two axes, counted SEPARATELY.** Element and weapon are orthogonal, so a
  board runs one tally per axis and can hold **both** an element affinity and a
  weapon affinity. Count the types across ALL cards on a combatant's board
  (buffs, shields, auras, and TRUE cards' cosmetic types included; a size-N
  card counts once) into the tally for that card's own axis. If a single type
  has the **highest count on its axis and that count is ≥ 3**, the board gains
  that type's affinity.
- **Defensive matchup affinity remains singular per axis.** A tie still leaves
  that axis neutral for the weapon/element triangle. This is separate from the
  card-effect gate below.
- Recomputed at combat setup only (boards are static during a fight).
- **Symmetric**: enemy boards gain affinity by the same rule. There is no
  authored override — `CombatantSetup.elementAffinity` / `.weaponAffinity` are
  deprecated and ignored by `initCombatant`.

## Effect

**Matchups compare the attacking card's type with the target's affinity.**
The element tally fills the defender's `elementAffinity`; the weapon tally fills
`weaponAffinity`. An attacking card does **not** need its caster to have affinity
to gain its matchup bonus. Magical attacks consult the target's elemental
affinity; physical attacks consult its weapon affinity. True damage ignores both.

An advantageous attack deals **+50%** damage; a disadvantaged attack deals
**−25%**. Sword/Axe/Lance and the four-element wheel retain their existing
advantages and disadvantages. Holy and Dark are mutually advantageous.

**Beast exception (user-approved 2026-09-12):** Beast attacks are neutral into
every weapon affinity, including Bow. Bow attacks still deal **+50%** damage
against Beast affinity. This one-way bonus no longer implies a reverse Beast
damage penalty. It does not alter any other matchup or the affinity threshold.

There is still **no flat same-type damage bonus** — the old v1 "+20% on matching
cards" was removed 2026-07-22, and nothing about an identity multiplies a card's
damage.

**Effect 2 — the affinity gate (2026-08-25).** This is the "distinct same-type
reward mechanic" the paragraph above reserved, on the terms it set: named and
priced on its own rather than folded into the identity as a blanket bonus.

**Affinity is a MODIFIER, not a keyword** (user ruling: *"it should be affinity,
which gives back PL, because affinity adds a requirement to use the effect, so
it's a composite of another effect"*). Any action may carry `affinity: true`
(`AffinityGated`, engine/types.ts). That action resolves ONLY when the caster
has at least three cards matching the card's own type; when the gate is shut it
is skipped entirely, as though the card never listed it. Each type is checked
independently: 3 fire + 3 frost activates gated Fire effects and gated Frost
effects. A tie never cancels either effect. It is opt-in per action, so a
defensive affinity by itself still grants nothing offensive.

Player-facing rule text: **“Requires 3 cards of this type on your board to
activate this effect.”** Affinity is shown as its own glossary entry beside the
action keyword it gates, never folded into a label such as “Burn (Affinity).”

Three consequences, each load-bearing:

- **It composes with every keyword in the game, for free.** A gated `poison`,
  `stun`, `heal` or `damage` all work the day the content is authored — one gate
  check in `applyAction`, one refund in `actionsPriceDeci`, and no keyword needs
  to know affinity exists. This replaced a family of bespoke keywords
  (`affinityStrike`, `affinityCharge`) that each needed a pricing row, an
  interpreter arm, a validator case, a glossary entry and a face badge.
- **The gate changes nothing but whether the action happens.** A gated `damage`
  is an ordinary damage action: it takes its stat share, its aura and rider
  bonuses, and its place in the multi-hit divisor. The DIVISOR is therefore
  gate-aware (`countDamageActions`) — a hit that cannot happen on this board must
  not take a share of the cast's stat pool, or an off-type card would be
  permanently taxed for a payload it can never reach. So the same card is a
  genuine single-hit card at full stat off-type and a genuine two-hit card
  on-type.
- **PRICING: the effect prices on its own family's terms and the gate is
  half-price** (`PRICE.affinityPayoffNum/Den = 1/2`; derivation there). The one thing the
  refund does NOT cover is the multi-hit premium, which is not charged on gated
  hits at all: that premium prices a property the card *reliably* has, and a
  gated hit makes the hit count board-dependent.

A card with a gated action must HAVE a type, which is already universal ("a card
must carry an element OR a weapon").

**`attunedShield` is NOT part of this.** Plating tuned to the card's own type
absorbs 2 damage per point from that type and 1 from everything else. It is
always active — the type-matching decides an exchange RATE, not whether the
effect happens — so it is its own keyword rather than a gated `shield`.

**`empowerNext`** (arm flat bonus damage for the caster's next cast of this
card's type) is likewise its own keyword: the forward arming is the effect, and
the gate is the separate flag. It ships gated or ungated from one row.

## Balance stance

PL-neutral, like all matchups: the swing lives in board composition (and the
counterplay it exposes), not in any card's price. The audited PL table is
unchanged. Deck-building tradeoff: stacking one type establishes a defensive
matchup profile and can unlock explicitly gated effects, while giving enemies
a known attack vector into you.

## Explicitly deferred (explore later)

- A named/priced same-type reward mechanic (the removed +20% was unpriced).
- Second threshold tiers (e.g. 5+). *(One element affinity plus one weapon
  affinity on the same board is no longer deferred — it shipped 2026-09-06.)*
- Boosting heals/shields of the affinity type.

## UI hooks

Available to the UI: `finalState.<unit>.elementAffinity` and
`.weaponAffinity` — **the honest pair**, either, both, or neither — plus
`finalState.<unit>.boardIdentity`, a single-label collapse of the two (element
first) kept for surfaces that can only show one and **lossy on a dual-affinity
board**. `boardAffinities(skills)` is the pure derivation for anything outside
the sim; `boardTypeIdentity(skills)` is the same collapse, defined in terms of
it so the two can never disagree.

Also available: the incoming matchup via the existing `damage.matchup` field. The signed
triangle contribution is `damage.calculation.matchupBonusDamage`, surfaced as
the **AFFINITY** term in the battle/`fight` damage strip. There is no longer an
`identityBonusDamage` field.
