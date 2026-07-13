# Combat UI Spec (for Codex)

How to render the battle log correctly from the engine's event log. Authoritative
field names are in `src/engine/combat/events.ts` (`CombatEvent`). The battle scene
is a **dumb playback head**: it walks `result.events` in order and draws them; it
never recomputes combat.

---

## 1. Turn vs. Round

- **Turn** = the engine's atomic step, the `turn` field on every event (1-based).
  Each turn is exactly: DoTs tick → both sides queue their next card → one
  `comparison` → the higher scorer **performs one card** (or is stunned, or nobody
  can act). **One activation per turn, max.** A turn is "who acted this step and
  what happened."
- **Round** = a UI grouping of turns, NOT an engine loop. Definition: **a round
  completes once BOTH sides have performed once within it** — i.e. round `N` is the
  span of turns during which `min(playerPerforms, enemyPerforms)` climbs from
  `N-1` to `N`. This is identical to the engine's own sudden-death round counter,
  so "Round 5" in the UI == the sudden-death trigger point.

  **How to compute it (deterministic):** walk events; count `performStart` events
  per side (or read its `performs` field, which is that side's cumulative count).
  Close the current round at the turn where the slower side's count catches up so
  both sides have advanced by 1. A fast unit that acts twice before the slow side
  acts once → both its turns sit in the same round until the slow side acts.

So: **turn view** = one box per turn (default). **round view** = boxes grouped
under R1, R2, … by the rule above (your R-tabs). Same events, two groupings.

---

## 2. Speed bank · card weight · activation score

Each turn every ready combatant computes one number:

```
score = bank + effectiveSpeed − queuedCardWeight
```

- **weight** = the queued card's speed weight (heavier = slower; default size×10).
- **effectiveSpeed** = the combatant's Speed stat (after buffs/debuffs).
- **bank** (banked readiness) = carried-over initiative. A combatant that does NOT
  perform a turn **adds its Speed to `bank`**; when it performs, **`bank` resets to
  0**. So a heavy card loses early turns but its bank grows until its score wins —
  "heavy is paid for."
- **Higher score performs** (tie → player). The loser banks.
- **Spans:** a size-N card, once cast, keeps its caster **busy** for N−1 more turns
  (state `busy`, banking Speed, not competing).

Read all of this off the `comparison` event (see §4). Show both sides'
`bank + speed − weight = score` so the math is legible — that's the game's core.

---

## 3. What the battle log shows for a selected round

For the selected round, show each **turn** in it, in order. Per turn box:

1. **Header — the comparison / speed math:** both sides' `bank + speed − weight =
   score` and who won. For a non-competing side show its `state`
   (`busy (finishing cast)` / `nothing to cast`).
2. **The activation:** which side/unit performed and which card (name + slot), or
   "stunned — performance lost", or "nobody could act".
3. **The results of that activation** (in the same box): damage/heal/shield/status
   lines from the events that share this `turn`.

Round-summary (optional, for the round view): a one-line roll-up per round (e.g.
"R3: Hero cast Crushing Blow (36 dmg); Bandit banked to 24") with the turns
expandable underneath.

### 3b. Speed-bank continuity (required)

Each turn box shows, per combatant, its **starting bank → ending bank**, and the
next box's start MUST equal this box's end (a readable chain), unless a skill
changed it mid-turn — then the box shows why.

- **Starting bank** = `bank` on THIS turn's `comparison` event (per side).
- **Ending bank**, derived (no recomputation — these ARE the engine rules):
  - the **performer** ends at **0** (bank resets on performing; a stunned
    `performSkipped` also consumes the performance → 0);
  - every **non-performer** ends at `bank + speed` (it banked its Speed);
  - if a **`staggered`** event hits a combatant this turn, its bank was drained —
    the event's **`bankAfter`** is authoritative for the end value.
- Cross-check: the NEXT `comparison`'s `bank` for that combatant equals your
  computed end value. If you ever disagree, trust the events and flag it in the
  handoff ledger.
- Suggested display per side in the box: `bank 24 → 0 (performed)` ·
  `bank 12 → 24 (+12 banked)` · `bank 24 → 4 (staggered −20)`.

---

## 4. Which event fields to read

All events carry `turn`. Every event with `side` also carries `unit` (0-based
index of the actor/target within its side — **always 0 at 1v1; read it now** so
party/multi-enemy works later, see §6).

| You want… | Event `kind` | Fields |
|---|---|---|
| **Speed math / who performs** | `comparison` | `player`, `enemy` (each a `ComparisonSide`: `bank`, `speed`, `weight`, `score`, `state`, `queuedSkillId`, `queuedSlot`), `performer` (`'player'\|'enemy'\|null`) |
| **Actor + card cast** | `skillCast` | `side`, `unit`, `slot`, `skillId`, `span` |
| **Performance start / stun** | `performStart` (`side`,`unit`,`performs`) · `performSkipped` (`side`,`unit`,`reason:'stunned'`) · `noPerformer` |
| **Damage** | `damage` | `side` (victim), `unit`, `amount`, `blocked`, `crit`, `property`, `matchup?` (`'advantage'\|'disadvantage'`), `guarded?`, `hpAfter`, `source` (`'skill'\|'poison'\|'burn'\|'fatigue'`). **HP lost = `amount − blocked`.** `guarded` = amount a Magical Guard reduced. |
| **Heal** | `heal` | `side`, `unit`, `amount`, `flat`, `hpAfter` |
| **Shield gained** | `shieldGain` | `side`, `unit`, `property`, `amount`, `wasted`, `totalAfter` |
| **Status applied / expired** | `statusApplied` (`status`, `property?`, `turns`, `charges?` — charges is for negate) · `statusExpired` (`status`) |
| **Riders / special** | `slowedNext` (`weight`) · `staggered` (`amount`,`bankAfter`) · `shieldBroken` (`amount`,`totalAfter`) · `negated` (`property`) · `cleansed` (`removed`) |
| **Phase banners** | `suddenDeathStart` · `fatigueStart` (no side) |
| **Deaths / outcome** | `died` (`side`,`unit`) · `combatEnd` (`result:'win'\|'loss'\|'draw'`, `turns`) |

`skillId` → look up the card in `skillBook` for its display name/props. `slot` is
the board position that fired.

---

## 5. Turn box: activations AND their results — both

A turn box shows the **activation as the headline and the damage/heal/status as
sub-lines in the SAME box.** Do not split them into separate boxes. Rationale: a
"turn" means "X performed card Y → these effects happened", and all those events
share the same `turn` value. Group every event by `turn`; the `comparison` is the
header, `skillCast`/`performSkipped`/`noPerformer` is the activation line, and the
remaining events (`damage`/`heal`/`shieldGain`/`statusApplied`/riders/`died`) are
the result lines beneath it. Phase banners (`suddenDeathStart`, `fatigueStart`)
render as their own full-width markers, not inside a turn box.

---

## 6. Party / multiple enemies (forward-compatible now)

The engine is migrating from 1v1 to **teams** (each side an ordered array of
combatants). Design the log for it now so nothing breaks later:

- **Actor & target = the `(side, unit)` pair**, not just `side`. `unit` is the
  0-based lineup index within that side's team. Today it's always `0`; **key your
  rendering on `(side, unit)` now** and multi-unit works for free.
- **AoE** = several `damage` events with the same `turn`, one per victim `unit`, in
  ascending unit order — render them as multiple result lines under the one
  activation.
- The `comparison` event will later generalize from `{ player, enemy }` to a
  per-combatant `entries` list, each entry an actor `(side, unit)` with the same
  `ComparisonSide` numbers, plus `performer: { side, unit }`. Until then it stays
  1v1-shaped. Read `performer`/entries defensively so the switch is additive.
- **Ordering within a turn is canonical:** side `player` before `enemy`, then by
  `unit` index — safe to rely on for stable display order.

---

## Worked example (the current 1v1 build)

Turn 3, Hero casts Crushing Blow (slot 2, span 3) for 36:
- `comparison` → `player {bank:24, speed:12, weight:30, score:6, state:'ready', queuedSkillId:'crushing_blow', queuedSlot:2}`, `enemy {…score:2…}`, `performer:'player'`.
- `performStart {side:'player', unit:0, performs:2}`
- `skillCast {side:'player', unit:0, slot:2, skillId:'crushing_blow', span:3}`
- `damage {side:'enemy', unit:0, amount:36, blocked:0, crit:false, property:'physical', hpAfter:41, source:'skill'}`

→ one turn box: header "YOU 24+12−30=6 vs FOE 0+12−10=2 → HERO", activation
"Hero casts Crushing Blow (spans 3)", result "Bandit −36 → 41 HP".
