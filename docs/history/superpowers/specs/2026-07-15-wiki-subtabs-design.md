> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Wiki Subtabs Design

## Goal

Unify card and opponent reference content under Wiki while keeping Deck and Bag as primary preparation destinations.

## Navigation

- Main tabs return to Deck, Bag, Wiki.
- Wiki contains two first-level subtabs: Cards and Opponents.
- Keep subtabs inside the Wiki panel header so ten card tiles and eight opponent tiles still fit.
- Cards is the default Wiki section.

## Direct Launch

- `?view=wiki/card` opens Wiki/Cards.
- `?view=wiki/opponents` opens Wiki/Opponents.
- Keep legacy `?view=wiki`, `?view=codex`, and `?view=opponents` aliases for existing screenshots and handoffs.

## Behavior

- Cards retains catalog filters, tier preview, adding copies, and card inspection.
- Opponents retains Level/Title/Tier previews and opponent detail sheets.
- Switching Wiki subtabs never mutates the prepared fight.

## Verification

- Check both direct routes and subtab switching at 720x1280.
- Confirm the selected Wiki subtab is visually clear without reducing catalog capacity.
- Require strict spacing audit, no overflow, and green build/tests.
