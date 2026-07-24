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

That is the whole effect. There is **no flat same-type damage bonus** — the old
v1 "+20% on matching cards" was removed 2026-07-22. (A distinct same-type
reward mechanic may be revisited later; if added, it must be named and priced
on its own.)

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
