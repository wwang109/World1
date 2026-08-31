# Combat model spec — readiness turns, multi-cast, cursor traversal

**Status:** IMPLEMENTED — this model is the loop the engine runs
(`src/engine/combat/simulate.ts`); the old one-performer-per-turn model is
gone. Card resolution (damage/elements/weapon triangle/crit/shields/DoTs/
riders/auras/guard-negate/targeting/gems) is unchanged — this doc defines the
turn loop, the pacing currency, the cursor, and the event log.

**Post-spec addition — attrition (locked 2026-07-30/31):** from
`ATTRITION_START_TURN` (15), every living combatant takes accelerating TRUE
damage each turn (shields bypassed, lowest initiative score ticked first), so
every fight is decided — no draws. See `attritionDamage` in `simulate.ts` and
the register row in `docs/design-locked.md`.

**The outcome rule — FIRST TO FALL LOSES (locked 2026-08-04):** every damage in
this engine can be said to be dealt or taken FIRST, so the fight ends at the
exact **application** that wipes a side, and nothing later in the same step ever
applies — no DoT/attrition/fatigue tick after the killing blow, no bleed tick on
a performer whose cast just won, no lifesteal-back off a killing blow. The
application order is the one the loop already defines: a cast's effects in
RESOLVED order → the performer's bleed tick; burn at the start of a turn, poison
at the end; attrition in ascending initiative score, fatigue in canonical pool
order — and both sweeps STOP at the tick that wipes a side, so the units later in
the order are never reached that turn. Because one application only ever damages
one victim, **mutual wipes cannot occur**: this supersedes the 2026-07-30/31
tempo tiebreak (lower-initiative-loses → lower-HP-loses → player wins), which is
now unreachable and kept in `decideOutcome` only as a documented defensive
fallback for a future simultaneous-damage mechanic. One stated consequence: in a
perfectly mirrored fight the score tie falls back to canonical order (player side
first), so the PLAYER's unit takes the killing tick and the fight is a loss —
the inverse of the retired "player wins ties" convention.

("RESOLVED order", not authored: the loop walks whatever `resolveEffectiveSkill`
hands it, and since the **cast-order ruling of 2026-08-31** that is the card's
authored list with its AFTERMATH riders — `poison`/`burn`/`bleed` and the
`lifesteal` sink — folded behind every hit of the cast. Its SETUP lines
(`debuffStat`, `expose`, and every control/buff/guard/ward/heal line beside them)
are NOT moved, so a debuff a card writes ahead of its own hit is cashed in by
that hit. The rule lives entirely in `castPhaseOf`/`orderCastRiders` at the
resolver seam; the loop is unchanged and still just walks the list. One
consequence worth naming HERE, because it is this section's own rule winning: a
cast whose last hit wipes the enemy side applies no aftermath rider at all — the
DoT on a killing blow is simply not spent, exactly as the leech on a killing blow
has not been since 2026-08-26. Setup lines are unaffected: they resolve ahead of
the hit that ends the fight. See `docs/design-locked.md`, 2026-08-31.)

See `sweep` /
`decideOutcome` in `simulate.ts`, `applyCast` in `interpreter.ts`, and
`tests/engine/outcomeRule.test.ts`.

This is the single source of truth for the new loop. The **log auditor**
(below) encodes every rule and must pass on every simulated fight.

---

## 1. Vocabulary

- **readiness** — a combatant's built-up initiative. Grows by its Speed each
  turn; spent to play cards. This *is* the "speed" that decides who plays.
- **Speed** — the stat added to readiness at the start of every turn.
- **base Speed** — the raw Speed stat, used only to break ties in play order.
- **weight** — the readiness a card costs to play (its *expense*). Independent
  of size (a card can be big but light, or small but heavy).
- **size** — how many board slots a card occupies AND how many cursor positions
  it spans. Size is a *footprint / time* cost, NOT a readiness cost.
- **cursor** — per combatant, points at one board slot. A size-N card occupies
  N cursor positions: `slot 1 of N` … `slot N of N`.

Key separation (this was the recurring bug): **weight = the readiness expense;
size = the cursor/time footprint.** They never stand in for each other.

---

## 2. The turn

Every turn has three phases.

### Phase 1 — Gain (once)
Each living combatant: `readiness += Speed`. Always — including combatants that
are busy (mid-cast) or that won't play. Exactly once per living combatant.

### Phase 2 — Resolve plays (loop)
Repeat until it ends:

1. **Current card** — each combatant reads the card at its cursor, scanning
   forward past empty slots and on-cooldown cards. **Passives are valid plays**
   (not skipped). If the cursor sits on the *tail* of a multi-slot card it
   already fired (slot 2..N), the combatant is **busy** (see §3) and has no
   current card this step.
2. **Eligible** = has a current card AND `readiness ≥ its weight` AND not busy.
3. **If no one is eligible → the turn ends** (go to Phase 3).
4. **The highest-readiness eligible combatant plays.** Tie → higher **base
   Speed** → **coin flip** (seeded RNG, fixed call order).
5. **Play it:** `readiness -= weight` (**keep the leftover**) · effects resolve
   (all existing resolution) · **cursor advances one slot** · card goes on
   cooldown · if the card is size > 1 the caster is now **busy** (its cursor is
   on slot 2 of N — see §3).
6. Go to 1.

Because step 4 compares *readiness* and step 5 only spends the card's *weight*
(keeping the rest), a **fast build plays several times in one turn**: after
paying for one card it can still be the highest-readiness eligible combatant and
afford its next card, so it comes up again. It stops the moment it can't afford
its next card, a rival's readiness passes it, or it plays a size>1 card (which
makes it busy). A slow build is tapped out after one play or none.

### Phase 3 — End checks
Deaths, sudden death, attrition (turn 15+), fatigue, win/lose. No winner → next turn → Phase 1.

---

## 3. Cursor & card size

The cursor advances **one slot per play**, and a multi-slot card is walked slot
by slot — the footprint *is* the card's time cost, and there is **no separate
busy/span counter** layered on top.

- Playing a card when the cursor is on its **first** slot fires the card once,
  then moves the cursor **+1** to the card's next slot.
- **Size-1 card:** slot 1 of 1 → firing moves the cursor to the next card's
  first slot immediately, so it can be chained (multi-cast) the same turn.
- **Size-N card (N>1):** firing moves the cursor to `slot 2 of N`, which is a
  *tail* slot. While the cursor sits on a tail slot the combatant is **busy**:
  it plays nothing and just advances the cursor +1 each turn until the cursor
  reaches the next card's first slot. So a size-3 card fires once, then busies
  the caster for **2 turns** (slot 2 of 3, slot 3 of 3) — the size delivers the
  wait, not a lock. This ends any multi-cast chain the moment a big card fires.
- Scanning for the current card skips empty slots and on-cooldown cards, jumping
  over a skipped card's **whole footprint** — the cursor never lands mid-card as
  a playable start. It wraps slot 10 → slot 1. A played card is on cooldown, so
  a wrap can't replay it (this bounds a multi-cast chain).

---

## 4. Cooldown

After a card plays on turn T it is unavailable on turns T+1..T+cooldown and
eligible again at T+cooldown+1 (`BASELINE_COOLDOWN` = 3 unless the card overrides
it). A combatant whose only reachable cards are all cooling has no current card
and waits. Cooldown counts **gameplay turns**.

---

## 5. Event log

The log is a flat, line-per-event stream. Each line is a **rendering** of a
structured event; the event carries the IDs the UI needs to render the line AND
to **highlight the right board card / combatant when a log row is clicked**.

### 5.1 Line format (what the player reads)

```
T1  gain    hero   readiness 0 → 20
T1  gain    enemy  readiness 0 → 8
T1  play    hero   Jab (slot 1) · weight 8            → enemy -12  [enemy 88]
T1  cost    hero   readiness 20 → 12   (paid 8)
T1  cursor  hero   → Poke (slot 2)
T1  play    hero   Poke (slot 2) · weight 8           → enemy -12  [enemy 76]
T1  cost    hero   readiness 12 → 4    (paid 8)
T1  cursor  hero   → Greatswing (slot 1 of 3)
T1  wait    hero   readiness 4 < Greatswing weight 20
T1  wait    enemy  readiness 8 < Slash weight 10
T1  end     turn over

T2  gain    hero   readiness 4 → 24
T2  gain    enemy  readiness 8 → 16
T2  play    hero   Greatswing (slot 1 of 3) · weight 20   → enemy -40  [enemy 36]
T2  cost    hero   readiness 24 → 4    (paid 20)
T2  cursor  hero   → Greatswing (slot 2 of 3)
T2  play    enemy  Slash (slot 1) · weight 10        → hero -15   [hero 85]
T2  cost    enemy  readiness 16 → 6    (paid 10)
T2  cursor  enemy  → wrap (slot 1)
T2  end     turn over

T3  gain    hero   readiness 4 → 24
T3  gain    enemy  readiness 6 → 14
T3  busy    hero   Greatswing resolving
T3  cursor  hero   → Greatswing (slot 3 of 3)
T3  wait    enemy  Slash cooling — 3 turns left
T3  end     turn over

T4  gain    hero   readiness 24 → 44
T4  gain    enemy  readiness 14 → 22
T4  busy    hero   Greatswing resolving
T4  cursor  hero   → Jab (slot 1, wrap)
T4  wait    enemy  Slash cooling — 2 turns left
T4  end     turn over
```

Tags: `gain` · `play` · `cost` · `cursor` · `busy` · `wait` · `end`.

### 5.2 Event fields (what Codex reads to render + highlight)

Every event carries `turn`, `type`, `side`, `unit`.

| type   | extra fields |
|--------|--------------|
| gain   | `readinessBefore`, `readinessAfter`, `baseSpeed`, `speedModifier`, `speed` |
| play   | `slot`, `skillId`, `weight`, `size`, `targetSide`, `targetUnit`, `damage`, `hpAfter` |
| cost   | `readinessBefore`, `readinessAfter`, `paid` |
| cursor | `slot`, `skillId`, `slotIndex`, `slotCount` (e.g. 2 of 3), `wrapped?` |
| busy   | `slot`, `skillId` (the card being resolved) |
| wait   | `reason`: `cantAfford` (+`readiness`, `weight`, `skillId`, `slot`) or `cooling` (+`skillId`, `slot`, `turnsLeft`) |
| end    | `reason` (`noEligible`) |

Direct-skill damage uses the **FLAT model**: `damage = card.power (a flat base) +
the caster's scaling stat` (Attack / Magic Power / higher for TRUE), then the
bounded multipliers/subtractions — aura+combo `effectPct`, flat armor/MR subtract
(TRUE: the flat base bypasses defenses entirely; the STAT ADD is reduced by the
enemy's matching defense — Attack vs Armor, Magic Power vs Magic Resist — capped
at the stat add, user-locked 2026-07-20), crit ×1.5 (chance capped at 50%),
matchup ±50%/−25%, sudden-death ramp. Non-TRUE heal/shield are likewise `power + stat`; TRUE heal/shield are pure
flat `power`. Damage and HP scale linearly, never multiplicatively.

Direct-skill `damage` events carry an optional authoritative `calculation` with
the exact integer stages used by the engine: scaling stat name, base/effective
stat, `power` (the flat base — field renamed from `powerPct`), base damage
(`power + baseStat`), stat-buff damage, other bonus damage/pct, defense,
minimum-damage clamp, crit, matchup, sudden-death ramp, guard, shield, and final
HP damage. DoT, attrition and fatigue damage omit it because they do not use a card formula.
`statusApplied` includes `stat` plus `pct` or flat `amount` for stat effects.

**Click → highlight:** a clicked row reads `side + unit + slot + skillId` and
highlights that board card and combatant — the cast card (`play`), the victim
(`targetSide/targetUnit`), or the cursor's current card (`cursor`, using
`slotIndex/slotCount` to light the correct cell of a size-N card).

---

## 6. Log auditor (the correctness gate)

`auditCombatLog(result, cfg)` walks the event stream and throws on the first
violated rule. It is run over many seeds × boards (big cards, cheap fast decks,
cooldown idling, ties, multi-cast). A bare pass count is NOT the gate — this is.

Checks:
- **Readiness continuity:** a combatant's `readinessAfter` at the end of turn N
  equals its readiness at the start of turn N+1 before Phase-1 gain.
- **Gain once:** each living combatant has exactly one `gain` per turn with
  `readinessAfter = readinessBefore + speed`, where `speed = baseSpeed +
  speedModifier`. The signed modifier exposes temporary Speed buffs/debuffs to
  playback without asking the UI to recompute stats.
- **Cost matches weight:** every `play` is followed by a `cost` with
  `readinessAfter = readinessBefore − weight`, `paid = weight`.
- **Eligibility:** a combatant `play`ed only if `readiness ≥ weight`, card not
  cooling, not busy — and it was the **highest readiness** among eligible at that
  step (tie → base Speed; coin flip allowed).
- **Multi-cast:** a repeat play by the same combatant in one turn only when it
  was still highest and still afforded; a size>1 play is never followed by
  another play by that combatant the same turn (it went busy).
- **Cursor:** advances exactly +1 per play and per busy step; a size-N card
  fires once then produces exactly N−1 `busy` turns walking slots 2..N; the
  cursor never lands mid-card as a playable start; wraps 10→1.
- **Cooldown:** a card never replays within its cooldown window; `wait/cooling`
  `turnsLeft` counts down correctly.
- **Turn end:** a turn ends (`end`) only when no combatant is eligible.
- **Determinism:** same seed → byte-identical event stream.

**What it does NOT check: the damage arithmetic.** Every rule above is about
*scheduling* — who acted, when, at what cost. The auditor never opens a `damage`
event's `calculation`, so the numbers a player actually reads off a hit were
unguarded until `tests/engine/damageLedger.test.ts`. That suite is the arithmetic
half of this gate: it sweeps a matrix built so every optional term is non-zero
somewhere (guard, expose, shield, the min-1 floor, both signs of the triangle,
the sudden-death ramp, a buffed stat, a paying rider), and asserts the reported
parts sum to `hpDamage`, that `amount = shieldBlocked + hpDamage`, that a landed
hit is never worth less than 1, and that the stat add and triangle multiplier
match §5's flat model rather than merely being self-consistent. It also drives
**both** renderers of the ledger — `formatDmg` (the in-game math strip) and
`fmtDamage` (the `npm run fight` log) — parsing each grammar back and re-summing
it, because a closed ledger printed with a term missing is the defect this found:
the CLI log had no `EXPOSE` term, so on any hit amplified by an active expose the
printed terms summed to less than the printed total (206 of 2208 audited hits).
A new stage in the damage pipeline has to appear in both renderers or that suite
fails. The suite also asserts its own **non-vacuity** — every term must actually
occur in the sweep — which is what keeps it from decaying into the blind spot it
was written to close.

---

## 7. Determinism

Pure `simulate(cfg, seed)`; integer-only state; the only RNG is the coin-flip
tiebreak, drawn from the seeded `Rng` in a fixed call order; canonical iteration
(player side first, then unit index) except where §2.4 play-order applies.

---

## 8. Typed guard — stacking is UNBOUNDED (user-locked 2026-08-20)

**User ruling, verbatim:** *"leave guard alone let player build what they want."*

Guard piles COEXIST and compound: a recast opens a second pile, and every
matching-`property` pile reduces an incoming hit multiplicatively in
statuses-array order (`dealDamage`, `interpreter.ts`). `MAX_GUARD_PCT` (60,
`balance.ts`) bounds ONE pile. **Nothing bounds the COUNT** — not per property,
not in total. Guard is deliberately unlike `MAX_NEGATE_CHARGES` /
`MAX_WARD_CHARGES` here: a deep wall is a legal build, and the player is allowed
to build it. Regression guard: `tests/engine/guardStacking.test.ts`.

A `MAX_GUARD_PILES = 3` apply-time cap shipped on 2026-08-19 (commit `7ad0664`,
with an at-cap strict-dominance replace/absorb rule and a `statusExpired` that
named the evicted pile) and was **rejected on 2026-08-20**. It, the named-expiry
event fields, and playback's eviction handling are all gone; `statusExpired`
again names nothing beyond the status kind, because every guard expiry is now
natural.

**The measurement that motivated the cap stands as recorded fact** — it was
true, and it is what an uncapped guard buys. A legal board of 6 physical-guard
cards, each socketing a `ward_of_silence_echo` gem (a gem's guard splices into
the host's cast: two piles per cast, zero extra slots, and gem inventory is
uncapped), stood **12 simultaneous physical piles** and measured **85–98%
physical mitigation**, winning vs berserker / Sentinel / Wolf King in 5–9 turns;
the same board without gems (6 piles) loses the Sentinel matchup, so the
stacking itself was the deciding variable. Two backstops remain and are the
reason the ruling is safe enough to live with:

- the guard loop's **min-1 remaining per pile** floor: however deep the stack, a
  matching hit always lands for at least 1;
- **attrition** (`ATTRITION_START_TURN`, `simulate.ts`) deals **TRUE** damage,
  which no typed guard pile can touch — a pure turtle still dies on the clock.

Shipped content does not approach any of this on its own: over 2400 random sweep
boards the deepest same-property stack observed was 2 (which is also why both
the introduction and the removal of the cap left the 400-case regression
baseline byte-identical). The exploitable tail is the gem/multi-copy build, and
the user chose **freedom over the bound**.

---

## 9. Thorns — the reflect is PHYSICAL (locked 2026-08-21)

**User ruling, verbatim:** *"its just a reflect — if either side has the thorn
buff and either side has armor it should hit armor first."*

A thorns reflect had been TRUE damage since the keyword's first commit
(`74d8463`) — an implementation default, never ratified, and the odd one out
among the DoT ticks, which all carry a property. It is now an **ordinary
physical hit**. The pipeline for one reflect (`reflectThorns` →
`dealDamage`, `src/engine/combat/interpreter.ts`):

1. `sting` = the pile's CURRENT stack count (unchanged; the pile then loses one
   stack, `statusExpired` at 0).
2. **The recipient's ARMOR is subtracted**, mirroring `applyStrike`'s physical
   branch verbatim: `max(1, max(0, sting − armor))` — the same min-1 floor, so
   an armored attacker always takes at least 1 per sting.
3. Delivered as **`physical`** with `source: 'thorns'`, so downstream in
   `dealDamage`: a matching **physical `guard`** reduces it (the guard loop runs
   for every source), a **physical shield pool** absorbs it, and the **TRUE pool
   no longer blocks it point-for-point** — as typed damage it drains that pool
   at the usual 2:1 spill rate.
4. **No matchup wheel and no sudden-death ramp.** Both live in `applyStrike`
   (`cardMatchup(skill, …)` needs a `SkillDef` to read a weapon/element off);
   thorns is a status with neither, and this path calls `dealDamage` directly, so
   both are skipped structurally rather than by a special case.
5. `negate` and `expose` still never see a reflect — both arms of `dealDamage`
   are `source === 'skill'`-only.

**Symmetry** is structural and unchanged: whoever holds the pile reflects at
whoever hit them, so armor helps either side identically.

**The reflect loop is gated by the CALL SITE, not by the property.**
`reflectThorns` is called from exactly one place — `applyStrike`, i.e. a card
strike — and `dealDamage` never calls it back. Going physical therefore cannot
create thorns-on-thorns; `source: 'thorns'` only keeps the sting out of the
`skill`-only arms and attributes it in the log.

**Pricing is unchanged** (`thorns: stacks × PRICE.dotPerStack`) and more honest
for it: that is a TYPED rate — TRUE `damage` pays double via
`truePremiumPerPoint` — and the reflect is now typed and mitigable.

Rules are pinned in `tests/engine/thorns.test.ts`. The 400-case outcome baseline
is **byte-identical**: the frozen sweep pool
(`tests/engine/fixtures/frozenSweepSkillIds.ts`, snapshotted 2026-08-08) carries
no thorns card at all, measured 0/400 carriers and 0 reflects.

---

## 10. Card-targeting keywords: `burden`, `curse`, and the `splash` spreader (locked 2026-08-21)

**User ruling, verbatim:** *"splash is an effect that spread other effect. It
doesn't just spread wt."*

`splash` shipped 2026-08-18 as `{ kind: 'splash', weight }` — one action that
both chose a band and taxed weight on it. That conflated a SPREADER with its
first PAYLOAD. The keyword is now three:

| keyword | payload | reach |
|---|---|---|
| `burden` (`weight`) | +weight on that card's NEXT play, then spent | the ANCHOR |
| `curse` (`amount`, `turns`) | −amount damage from that card for N global turns | the ANCHOR |
| `splash` | **none** | turns either of the above into the whole BAND |

### The anchor and the band

Both are computed by `cardTargetPieces` (`src/engine/combat/splash.ts`), the one
seam every card-targeting arm calls — which is why `splash` means exactly the same
thing for both keywords, and will for the next one.

- **THE ANCHOR** is "the target's current turn's card": the piece the victim's
  `castCursor` sits in; else the nearest piece AHEAD of the cursor; else — parked
  past the last card — the LAST CARD PLAYED. **Nothing wraps** (user-locked
  2026-08-19): the board is a line.
- **THE BAND** is the anchor plus the piece immediately before and immediately
  after it, measured **edge-to-edge, piece-to-piece** (`footprintGaps`, the same
  arithmetic aura coverage uses). A size-3 card is ONE neighbour, an empty slot
  between two cards does not break adjacency, and the band does not wrap — so it
  is **1 to 3 pieces wide**, decided by the VICTIM's board.

### The rules that hold for both payloads

- **Single-target at the UNIT level.** The cast resolves against one foe; what
  spreads is across that foe's own BOARD, never their team. `scope: 'all'` +
  `splash` is refused at authoring, and a gem `splash` is dropped on a
  multi-target host. (An AoE card carrying a bare `burden`/`curse` is legal: one
  card per foe is the linear reach an AoE `slow` already has, and it pays the
  reach multiplier. It is band × foes that is refused.)
- **Non-stacking.** A re-application takes the STRONGER value, never a sum
  (`burden`: `max` on the weight; `curse`: `max` on the amount AND, separately,
  on the expiry — the `expose` refresh rule). An unbounded stack would lock a
  card out of the fight.
- **A spreader with nothing to spread is refused**, not ignored:
  `validateSkillContent` fails the card, and THE SPLASH GATE
  (`spliceGemActions`, `src/engine/cards.ts`) drops a gem's splash when neither
  the host nor the gem supplies a payload — alongside its two older arms
  (multi-target host, host already splashes).
- **The spreader is CAST-SCOPED, not positional** (`castSpreadsBand`): a gem
  `splash`, which splices AFTER the host's effects, still spreads the host's own
  burden. That independence is the socket the gem exists for.

### How each one ENDS — the deliberate asymmetry

- A **burden** rides its piece until that piece is next played, however many
  turns that takes, and is then **spent** (`delete piece.nextWeightPenalty` at the
  one site a cast really resolves). Unlike a `slow`, it never expires unpaid.
- A **curse** ends on a **clock**: `expiresAtTurn = applyTurn + turns`, deleted in
  the end-of-turn pass of that turn (`expireCurses`, `simulate.ts`) — the same
  window a `fresh` N-turn status gets — and announced by a `curseExpired` event.
  A play does NOT end it; a cursed card that fires twice inside its window is
  weakened twice.

A curse is applied by folding `−amount` into that piece's `mods.damageFlat`
(`resolveAuras`), the same attacker-side flat channel board auras and card-scope
stat gems ride. So every downstream rule — mitigation order, the **min-1 damage
floor**, per-hit application on a multi-hit card — applies unchanged, and no
arithmetic is duplicated. A curse deeper than the whole hit floors at 1; it never
heals.

### Pricing (every keyword standalone)

`burden` costs `slow`'s OWN per-point rate (one card taxed, one card's worth of
tempo). `splash` prices **flat and standalone** — `PRICE.splashFlatDeci`
(20 deci per cast), a normal keyword row like any other (user-locked
2026-08-21: "every gem pl is standalone" / "why did you make splash
different"). A cast carrying `burden + splash` pays two independent line
items; the payload's magnitude never changes what the spread costs. (The
briefly-shipped coverage-multiplier model — ×2 on the summed card-targeting
share — was reversed by that ruling; the four splash cards were re-solved to
exact budgets under the flat rate, and the two-gem burden+splash ladder
collapsed into ONE splash-only gem, `ripple_sliver`.)
`curse` prices its near-certain first denial (the flat-damage rate at the
conditional-trigger discount) plus its repeats (one further firing per
`BASELINE_COOLDOWN + 1` turns). Full derivations: `PRICE.burdenPerWeightNum`,
`PRICE.splashFlatDeci`, `PRICE.cursePerAmountNum` in `src/engine/balance.ts`.

Rules are pinned in `tests/engine/splash.test.ts`. The 400-case outcome baseline
is **byte-identical**: no card of this family is in the frozen sweep pool.
