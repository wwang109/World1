# Combat model spec — readiness turns, multi-cast, cursor traversal

**Status:** target contract for a turn-loop REBUILD. The engine committed today
still runs the OLD one-performer-per-turn model; this doc supersedes that turn
structure. Card resolution (damage/elements/weapon triangle/crit/shields/DoTs/
riders/auras/guard-negate/targeting/gems) is unchanged — this only redefines the
turn loop, the pacing currency, the cursor, and the event log.

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

---

## 7. Determinism

Pure `simulate(cfg, seed)`; integer-only state; the only RNG is the coin-flip
tiebreak, drawn from the seeded `Rng` in a fixed call order; canonical iteration
(player side first, then unit index) except where §2.4 play-order applies.
