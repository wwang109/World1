> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Opponent Scenario Preview Design

## Goal

Let players preview how every opponent changes across encounter Level, Title, and uniform Card Tier without modifying the prepared fight.

## Controls

- Add a shared preview toolbar to Opponents.
- Level: 1-50 stepper.
- Title: Mob, Normal, Elite, Boss.
- Card Tier: Bronze, Silver, Gold, Diamond; no Auto state.
- Default: Level 1, Normal, Bronze.
- CLEAR restores those defaults.

## Resolution

- Resolve title level deltas and extra cards through `buildEnemyEncounter`.
- Convert the selected uniform tier to rank steps across the resolved deck and call `buildEnemyEncounter` again with that rank override.
- Read effective stats, cards, card tiers, board size, and PL from the resolved encounter.
- Never write the preview settings into `demoState.enemyTeam` or Deck encounter controls.

## Presentation

- Tiles and detail sheets use the selected preview title rather than authored `isElite`/`isBoss` identity labels.
- Show effective level and selected card tier prominently.
- Expanded Elite/Boss rotations remain fully visible in the detail sheet.

## Verification

- Check default Level 1/Normal/Bronze and a non-default Boss/Diamond scenario.
- Confirm CLEAR restores defaults and prepared-fight header remains unchanged.
- Require strict spacing audit, no overflow, and green build/tests.
