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

**Effect 2 — the affinity payoff (`affinityStrike`, 2026-08-25).** This is the
"distinct same-type reward mechanic" the paragraph above reserved, on the terms
it set: named and priced on its own rather than folded into the identity as a
blanket bonus. A card may carry an `affinityStrike` action, an EXTRA HIT of flat
`power` that resolves only when the caster carries the affinity matching that
card's own type. It is opt-in per card, so an identity by itself still grants
nothing offensive; only cards that were authored and paid for it benefit.

Three properties keep it from disturbing anything above:

- **Additive, never redistributive.** Only `kind: 'damage'` actions enter the
  multi-hit divisor (`countDamageActions`), so the extra hit never carves a share
  out of the card's own hit. Opening the gate can only add damage. The printed
  base hit reads identically on an on-type board and an off-type one.
- **Flat.** It takes no stat share, no `mods.damageFlat` and no rider bonus —
  the same self-contained shape a gem-appended hit has.
- **Fixed for the fight.** A board cannot change mid-combat, so the gate is open
  for the whole fight or shut for the whole fight. That is *why* it is priced on
  its own terms (`PRICE.affinityPayoffNum/Den`, 4/5 of the strike rate) instead of
  at the ½ conditional-trigger discount, which prices a gate that is only
  sometimes open. Derivation: `IDENTITY_THRESHOLD − 1` further slots are dictated
  by the card's demand out of `HERO_BOARD_SLOTS`, i.e. one fifth of the board.

A card with an `affinityStrike` must HAVE a type; `validateSkillContent` refuses
a typeless one, since its gate could never open on any board.

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
