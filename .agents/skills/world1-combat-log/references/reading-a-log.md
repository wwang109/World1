# Reading a log — line by line

Every shape below was matched against a real run and against
`scripts/fight.ts` / `scripts/logFormat.ts` / `src/engine/combat/events.ts`
on this checkout.

## The turn-loop bookkeeping (not an effect — the readiness model itself)

- `gain` — a combatant's `readiness` grows by its speed this turn.
- `cost` — a combatant paid its queued card's weight out of `readiness`.
- `cursor` — which card a combatant's queue now points at (size-N cards walk
  slot by slot; `wrap` means the cursor looped back to slot 1).
- `busy` — a size-N card resolving; the caster is busy for N−1 further turns.
- `wait` — could not act, with a reason: `cantAfford` (readiness < weight),
  `cooling` (cooldown not yet up, with turns left), `stunned`, or the
  fallback (no usable card).
- `end` — turn over.
- `comparison` — the per-turn initiative comparison across every living
  unit (`entries[]`, team-aware), and who it picked to perform.

None of these are combat EFFECTS — they are the readiness-model mechanics
`docs/combat-model-spec.md` owns. Do not read a `wait` line as a bug; it is
the model working (the unit simply couldn't afford or wasn't off cooldown).

## The cast and the hit

- `play` — the readable cast record: caster, card id, slot (`1 of N` for a
  multi-slot card), weight paid, the targeting decision (`target <foe>
  (<policy> <value>)`), and — for a single-hit card — the damage/hp inline.
- `damage` — one hit lands: amount, property, whether it was `blocked`
  (shield absorbed some/all), the victim's hp after, the source tag (`[burn]`
  etc. for a non-skill source), and an `[affinity <type>]` suffix when the
  hit fired because a gated action's condition was met (`fmtAffinity`,
  `scripts/logFormat.ts` — the same vocabulary the card face uses,
  `{{Affinity}} <Type>`).
- `calc` — the derivation line immediately under a `damage`/`heal` event
  (`fmtDamage`, `scripts/logFormat.ts`), a CLOSED ledger: every printed term
  sums to the printed total. Nothing external pins that any more — **the log
  itself is the pin**: add the printed terms and they must equal the printed
  total, and two same-seed runs diffed must be byte-identical
  (`fight-recipes.md`, "Recipe: determinism").
  Term order follows the engine's own pipeline
  (`DamageCalculation`, `src/engine/combat/events.ts`):

  ```
  baseDamage  +STAT  +BONUS  -DEF  +MIN  +AFFINITY  +RAMP  -GUARD  +EXPOSE  -BLOCK  = hpDamage HP
  ```

  Any term that is `0` is simply omitted from the line — a hit with no
  matchup bonus prints no `AFFINITY` term at all, not `+AFFINITY0`.

## The shield ledger

`shieldGain` reports the total AFTER a gain (`+N ... shield -> M total`);
`damage`'s own `blocked`/`shieldDrain` fields don't say what's left, so
`scripts/fight.ts` tracks a `wall` map itself and prints "N shield left"
alongside "N blocked" on every blocked hit — this is what a hand-written
demo once got wrong (it said "plating spent" instead of "blocked" and never
printed what remained; see `SKILL.md`'s USER-LOCKED rule). `shieldBroken`
distinguishes `burst: true` (the holder spent its OWN plating as bonus
damage, `shieldBurst`) from an ordinary `shieldBreak` shatter — same two
numbers, opposite cause, and the line says which.

## Status and resource lines

`statusApplied`/`statusExpired`/`cleansed`/`negated`/`slowed`/`warded`/
`wardReleased`/`aggroChanged`/`disrupted`/`shieldBroken` each print in one
line what changed and the resulting state (charges left, stacks gained,
aggro value, bank drained). `burdened`/`cursed`/`curseExpired` additionally
print which of the victim's board SLOTS were hit, bracketing the anchor
slot and appending `[splash]` when more than one slot was hit by a spreader.

## Stalemate breakers — NOT bugs

Three lines mark the engine's own designed stalemate breakers
(`src/engine/combat/simulate.ts`, `docs/combat-model-spec.md`). Seeing one
mid-fight is the model working as intended, not a defect to report:

- `suddenDeathStart` — fires once BOTH sides have accumulated
  `DEFAULT_SUDDEN_DEATH_ROUND` performances each (a performance COUNT,
  not a turn number); ramps a small damage amplifier thereafter.
- `attritionStart` — fires at `ATTRITION_START_TURN`; every living
  combatant takes escalating TRUE damage every turn from here on, lowest
  initiative first.
- `fatigueStart` — fires at `DEFAULT_FATIGUE_TURN`; a further TRUE
  damage backstop (`FATIGUE_BASE`, growing every turn thereafter), so no
  fight runs forever.

A `performSkipped` line paired with `wait ... stunned` means a stunned
unit's turn was consumed outright, not merely delayed — also expected
behaviour, not a missed cast.

## `died` / `combatEnd`

`died` marks a unit reaching 0 hp; `combatEnd` prints the result
(`win`/`loss`/`draw`) and the turn count. The final summary line
`scripts/fight.ts` prints after the log (`final: ...`) restates every
surviving/dead unit's hp — read it, don't recompute it from the log above.
