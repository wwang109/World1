# Run Mode — Skippable Tutorial design plan

World1's numbers are legible but not self-explanatory: why a hit landed for
that amount, why a unit acted first, and what 3 PL per level actually buys.
A **small, skippable tutorial** teaches exactly three things — **stats → damage**,
**PL growth**, and **Speed → who acts** — and it teaches them **inside a real
fight**, not in a wall of text before one.

Companion to [`release-game-plan.md`](release-game-plan.md). Build after the
Run UI phase (event scenes + stat panel) lands, since it points at that UI.

## Principles

- **Skippable always.** A persistent `SKIP TUTORIAL` control on every step,
  and skipping is remembered for the rest of the run (and, once
  `src/meta` exists, across runs). Never block input for more than one tap.
- **Diegetic, not modal-spam.** Each step is a small pointer card anchored to
  the real UI element it describes (the actual HP bar, the actual turnline,
  the actual PL badge) — the game underneath stays visible and running.
- **Teach on the first occurrence, then stop.** A step fires when its subject
  first happens naturally (first hit, first Speed comparison, first level-up),
  not on a fixed timer.
- **Numbers, from the real fight.** Every step quotes the *live* values from
  the current event ("your 14 damage = 10 base + 4 ATK, minus 2 DEF"), which
  the battle log already computes — the tutorial reads them, never recomputes.
  No parallel math, or it will drift from the engine.

## The three lessons (v1 scope)

### 1. Stats → damage (in battle, at the first HIT event)
Anchored to the damage number / the expanded D: math sub-line the battle log
already renders on tap:
- physical/magical hits scale off **ATK / MAG** and are reduced by **DEF /
  RES**; **true** damage ignores both.
- Point at the existing D: breakdown and say "tap any HIT row to see this
  math" — the feature exists; the tutorial's job is to reveal it.
- Second beat (same lesson, next hit if the fight provides one): the
  **element / weapon matchup** multiplier when one applies (±50% / −25%), read
  off the log tag rather than explained abstractly.

### 2. Speed → who acts (in battle, at the first turnline)
Anchored to the turnline that already prints every unit's SPD:
- each turn, score = **bank + Speed − queued card weight**; higher acts, and
  the loser **banks** its Speed for next turn.
- a **size-N card busies its caster N−1 further turns** — point at a multi-slot
  card's `1/3, 2/3, 3/3` span markers in the log (that feature shipped).
- Payoff line: "high Speed acts more often; heavy cards cost you turns."

### 3. PL growth (post-battle → run map)
Fires on the first level-up (which now happens after every fight, win or lose):
- "+1 level = **3 PL** to spend" anchored to the level-up feedback line.
- then anchored to the **"n PL TO SPEND" badge**: open the panel, and the
  pointer sits on the priced allocation grid — "each stat costs PL; SPD costs
  more because it buys turns."
- Closing beat anchored to a card's PL cost: "cards cost PL too — PL is the
  one currency for power; gold only buys access."

## Shape & where it lives

- `src/game/tutorial/` — a small **step registry**: each step declares an `id`,
  a `trigger` (which game moment fires it), an `anchor` (which UI element to
  point at, resolved by the host scene), and its copy. Steps are pure data +
  a tiny controller; the scenes expose anchors and call
  `tutorial.notify(moment, payload)`.
- Progress lives on `RunState` (`tutorialSeen: string[]`, plus a
  `tutorialSkipped` flag) so it is part of the run and survives the
  scene-rebuild idiom — add the field + a pure `markTutorialSeen` helper in
  `src/run/runState.ts` with a unit test. It must be **inert when absent** so
  existing runs/tests are unaffected.
- **Sandbox is untouched**: tutorial steps only arm in run context
  (`battleContext === 'run'`). The Sandbox stays a bare tool.
- Both platforms; the pointer card is anchor-relative so it works at 412×892
  and 1440×900 without separate copy.

## Entry point & control

- First run ever (no `tutorialSeen`) → the Run Map shows a one-line
  **"TUTORIAL: ON · skip"** chip rather than a forced intro screen. Nothing
  gates the START button.
- A `?tutorial=off` launch flag (and `=reset`) for dev/QA.
- Explicitly NOT in v1: voiced/animated onboarding, a scripted tutorial fight
  with fixed enemy, forced first-fight choices, or gating any screen.

## Tests

- `markTutorialSeen` is pure/idempotent; a skipped tutorial never re-arms.
- Each step fires at most once per run, and only in run context.
- A step whose anchor is missing must no-op (never throw) — the
  tutorial can never crash a fight.
- Determinism untouched: the tutorial reads the event log and mutates no
  simulation input (assert a run's event log is byte-identical with the
  tutorial on and off).

## Build order

1. `tutorialSeen`/`markTutorialSeen` on RunState + step registry + controller.
2. Battle steps (stats→damage, Speed→turnline) anchored in both battle scenes.
3. PL step across battle-banner → run map → stat panel.
4. Skip/reset plumbing, launch flags, feature-inventory rows.
