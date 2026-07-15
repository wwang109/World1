# Aura and Effect Log Design

## Goal

Make persistent auras, timed card effects, and timed unit effects understandable
from the combat log. The board treatment reinforces the log but never replaces
it. Every displayed modifier comes from authoritative combat events.

## Effect Families

### Persistent auras

- A printed board aura projects from its own board position.
- A placed aura is played onto a card on either side, including an opponent card,
  and projects from that anchored position using the existing `left`, `right`,
  `adjacent`, `allBoard`, `reach`, and filter rules.
- Auras are weaker area effects and have no turn counter.
- An activated aura remains active until an explicit combat event disables,
  dispels, replaces, or otherwise removes it.
- Existing aura rules exclude the anchor card unless the engine explicitly lists
  that card among the affected targets.

### Timed card effects

- A card buff or debuff targets one skill card.
- Card effects may use flat or percentage modifiers where the engine permits it.
- Examples include weight, card damage, card healing, critical chance, and
  activation restrictions.
- Card effects have an authoritative remaining-turn counter and expire
  automatically unless removed earlier.

### Timed unit effects

- A unit buff or debuff targets the hero or monster, never an individual card.
- Unit effects are percentage modifiers over the combatant, such as damage
  dealt, damage taken, defense, or healing done.
- Unit effects have an authoritative remaining-turn counter and expire
  automatically unless removed earlier.
- This is a deliberate exception to the current "no percentages except crit"
  modifier rule and requires Claude to settle the engine math and stacking order.

## Required Event Contract

Claude owns the exact TypeScript names, but the event stream must carry the
following information without requiring Phaser to infer combat state.

### Aura lifecycle

- Placement event: unique aura instance ID, source card identity and
  `(side, unit, slot)`, anchor `(side, unit, slot)`, direction, reach, filters,
  modifiers, and the authoritative affected card targets.
- Removal event: aura instance ID and a reason such as `dispelled`, `disabled`,
  `hostRemoved`, or `replaced`.
- Contribution references: readiness, play, damage, healing, and defense events
  identify every aura instance that changed the result.

### Timed-effect lifecycle

- Application event: unique effect instance ID, source card identity and
  location, target scope (`card` or `unit`), target location, modifier, and
  authoritative turns remaining.
- Update event: effect instance ID and the new authoritative turns remaining.
- Removal event: effect instance ID and whether it expired, was cleansed, was
  dispelled, or lost its host.
- Refreshing or replacing an effect must be explicit; the UI does not guess from
  duplicate names.

### Calculation contributions

Every calculation affected by an aura, buff, or debuff supplies named source
terms. A source term needs the effect ID, source skill ID, source location,
target scope, modified stat, flat-or-percent operation, authored value, and the
actual applied delta where rounding is involved.

The engine remains responsible for stacking, caps, rounding, and the final
number. The UI only formats the supplied terms.

## Battle Presentation

### Persistent aura borders

- `AURA VIEW` defaults on and toggles persistent aura overlays without changing
  combat state.
- The aura anchor uses a thin border in the source card's accent: element color
  when present, otherwise property color. This matches the combat card face.
- Positively affected cards use a green edge marker; negatively affected cards
  use a red edge marker.
- Multiple auras use separate compact edge markers rather than thicker stacked
  borders.
- Turning Aura View off hides persistent borders only. Inspecting an aura or
  selecting its log row temporarily reveals its complete source and reach.
- Timed-effect badges and counters never disappear with Aura View because their
  duration is gameplay-critical.

### Timed effects

- Card effects appear as compact badges on the affected card.
- Unit effects appear as compact status chips beside the combatant stats.
- Buffs use a plus/up icon and debuffs use a minus/down icon in addition to
  green/red coloring.
- Every badge shows remaining turns and opens the effect detail when tapped.

## Log Presentation

The compact timeline names the event and its source without expanding every
formula by default:

```text
AURA     Hex Field anchored to Enemy S4 - affects S2-S3
STATUS   Hero gains Battle Focus - +20% damage dealt - 3 turns
PLAY     Hero - Sword Slash - weight 10 -> Enemy -34 HP
DISPEL   Enemy removed Hex Field
```

Selecting a row opens the complete authoritative calculation:

```text
READINESS  Base SPD 12 - Hex Field 4 = +8
DAMAGE     Base 18 + Sword Slash 6 + Battle Focus 20%
           + Exposed 15% - Defense 8 = 34 HP
```

- Source names and modifier tokens use the same card accent: element color when
  present, otherwise property color, derived in the UI from `sourceSkillId`.
- Positive and negative meaning still uses signs, icons, and wording; color is
  never the only signal.
- The whole sentence is not tinted. Only the source label, modifier token, and a
  thin row accent receive the card color so long calculations remain readable.
- Tapping a source term or its row highlights the exact source card, target card
  or unit, and any active aura reach. Multi-enemy focus follows `(side, unit)`.
- Applying, refreshing, counting down, expiring, disabling, and cleansing effects
  use distinct verbs. The bottom summary does not repeat the same information.

## Playback and State

- Battle UI reconstructs visible aura/effect state only by replaying lifecycle
  events in order.
- Normal playback reveals lifecycle rows and calculation terms with the existing
  content-aware pacing.
- `TO END` applies the same events immediately and leaves the correct final
  overlays, counters, and log rows without delayed animation.
- Selecting an earlier log row shows the aura/effect state at that event rather
  than the final combat state.

## Edge Cases

- Multiple effects with the same source skill remain distinct through instance
  IDs.
- Source removal, anchor removal, death, cleanse, replacement, and combat end
  always produce an authoritative removal event defined by the engine.
- An Aura View toggle never suppresses calculation credit in the log.
- Source colors are presentation-only and are never stored in engine events.
- If a source card no longer exists on the visible board, its log term still
  keeps the card-derived accent and opens card information.

## Delivery Split

1. Claude defines the new aura/effect lifecycle and contribution fields, settles
   unit-percentage math, and adds deterministic engine tests.
2. Codex adds persistent overlays, timed-effect badges, source-colored log terms,
   selected-row reconstruction, and mobile visual verification.

## Verification

- Cover friendly and opponent-board placed auras in every direction and reach.
- Cover positive and negative aura contributions, including Speed/readiness.
- Cover card-targeted and unit-targeted timed effects, refresh, expiry, cleanse,
  and early removal.
- Cover stacked effects from duplicate source cards using distinct IDs.
- Cover single-enemy and multi-enemy focus/highlighting.
- Confirm the 720x1280 layout has no text or border overflow with long effect
  names and multi-line calculations.
- Require typecheck, build, full tests, layout audit, and a visual playback pass.
