# Deck Affinity (v1 — updated 2026-07-22)

Every card is typed by exactly one **weapon or element** (enforced by
`tests/engine/elements.test.ts`). When a combatant's board leans hard into one
type, the board gains that type's **affinity**.

> Naming: internally the derivation still lives in `typeIdentity.ts`
> (`boardTypeIdentity`), but everything the player sees calls this **affinity**.
> There is no separate "identity" concept and no "identity" wording in the UI.

## Rule

- **Card type** = `skill.element ?? skill.weapon` (exactly one exists).
- **Affinity**: count the types across ALL cards on a combatant's board
  (buffs, shields, auras, and TRUE cards' cosmetic types included; a size-N
  card counts once). If a single type has the **highest count and that count
  is ≥ 3**, the board gains that type's affinity. An exact tie for the top
  count → no affinity.
- Recomputed at combat setup only (boards are static during a fight).
- **Symmetric**: enemy boards gain affinity by the same rule.

## Effect

**The weapon/element triangle, unlocked.** The affinity becomes the
combatant's attunement for matchups — element affinity fills `elementAffinity`,
weapon affinity fills `weaponAffinity` — but **only where no authored affinity
exists** (an enemy's authored affinity always wins; heroes have none, so this is
the first source of hero affinity). Standard matchup math then applies both
ways: your attacks deal **+50%** into the type your affinity beats, and take
**−25%** from that type; attacks of the type that beats your affinity deal
**+50%** into you.

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
holds the affinity matching the card's own type; when the gate is shut it is
skipped entirely, as though the card never listed it. It is opt-in per action, so
an identity by itself still grants nothing offensive.

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
- **PRICING: the effect prices on its own family's terms and the gate refunds
  4/5** (`PRICE.affinityPayoffNum/Den`; derivation there). The one thing the
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
unchanged. Deck-building tradeoff: stacking one type unlocks the triangle in
your favor but hands the enemy a known attack vector into you.

## Explicitly deferred (explore later)

- A named/priced same-type reward mechanic (the removed +20% was unpriced).
- Multiple simultaneous affinities / second threshold tiers (e.g. 5+).
- Boosting heals/shields of the affinity type.

## UI hooks

Available to the UI: `finalState.<unit>.boardIdentity` (the computed affinity)
and the incoming matchup via the existing `damage.matchup` field. The signed
triangle contribution is `damage.calculation.matchupBonusDamage`, surfaced as
the **AFFINITY** term in the battle/`fight` damage strip. There is no longer an
`identityBonusDamage` field.
