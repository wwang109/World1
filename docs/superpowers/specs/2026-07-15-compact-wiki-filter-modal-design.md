# Compact Wiki Filter Modal Design

## Goal

Make the Wiki filter feel like a lightweight card-game utility instead of a large nested panel.

## Layout

- Center a 612px-wide floating sheet within the 720px portrait canvas.
- Use one dark header band for title, short AND-logic guidance, and close control.
- Put each category label and its choices on the same horizontal row.
- Keep Role, Property, Weight, Card Size, and Sort visible together with no scrolling or collapsed sections.
- Anchor CLEAR and APPLY FILTERS in one compact footer row.

## Visual Treatment

- Use the existing parchment, forest, ink, and warm-border palette.
- Keep one tinted shadow and one thin outer border; do not place rows inside additional panels.
- Use low-contrast inactive chips and a forest active state.
- Preserve at least 8px horizontal and 5px vertical label clearance through the control layout audit.

## Verification

- Open Wiki at 720x1280 with `layoutAudit=1`.
- Inspect the default and active-choice modal states.
- Require zero layout-audit errors, no overlap, and no overflow.
