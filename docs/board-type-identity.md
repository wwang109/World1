# Board Type Identity (v1 — locked 2026-07-19)

Every card is typed by exactly one **weapon or element** (enforced by
`tests/engine/elements.test.ts`). When a combatant's board leans hard into one
type, the board takes on that type as its **identity**.

## Rule

- **Card type** = `skill.element ?? skill.weapon` (exactly one exists).
- **Identity**: count the types across ALL cards on a combatant's board
  (buffs, shields, auras, and TRUE cards' cosmetic types included; a size-N
  card counts once). If a single type has the **highest count and that count
  is ≥ 3**, it is the board's identity. An exact tie for the top count → no
  identity.
- Recomputed at combat setup only (boards are static during a fight).
- **Symmetric**: enemy boards gain identities by the same rule.

## Effects

1. **Defensive attunement.** The identity becomes the combatant's affinity
   for INCOMING matchups — element identity fills `elementAffinity`, weapon
   identity fills `weaponAffinity` — but **only where no authored affinity
   exists** (an enemy's authored affinity always wins; heroes have none, so
   this is the first source of hero affinity). Standard matchup math applies:
   attacks of the type that beats the identity deal +50%, attacks of the type
   it beats deal −25%.
2. **Same-type damage bonus.** Cards whose type matches the board identity
   deal **+20% damage** (integer-floored, applied through the resolver seam
   like other per-card modifiers — the core loop stays feature-agnostic).
   Heals/shields are NOT boosted in v1.

## Balance stance

PL-neutral, like matchups: the swing lives in board composition (and the
counterplay it exposes), not in any card's price. The audited PL table is
unchanged. Deck-building tradeoff: stacking one type buys +20% on your core
cards but hands the enemy a known attack vector into you.

## Explicitly deferred (explore later)

- Offensive spillover (identity type applying to off-type cards).
- Multiple simultaneous identities / second threshold tiers (e.g. 5+).
- Boosting heals/shields of the identity type.
- Surfacing identity in Prep/Battle UI (Codex). Already available to the UI:
  `finalState.<unit>.boardIdentity` (the computed identity), the incoming
  matchup via the existing `damage.matchup` field, and the same-type bonus via
  `damage.calculation.identityBonusDamage` (optional informational subset of
  `effectBonusDamage`; the math strip sums exactly using `effectBonusDamage`
  alone). `npm run fight` already prints `+N board identity` on calc lines.
