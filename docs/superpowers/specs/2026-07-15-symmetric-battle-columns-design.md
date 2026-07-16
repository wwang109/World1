# Symmetric Battle Columns

## Goal

Make the battle board visually balanced and ensure every top header matches the panel directly beneath it.

## Geometry

- Keep the usable horizontal area from x=28 through x=692.
- Set Party to x=28 with width 202.
- Use a 12-pixel gap.
- Set Turn Log to x=242 with width 236.
- Use a 12-pixel gap.
- Set Enemies to x=490 with width 202.
- Keep all lane headers 42 pixels tall.

## Alignment

- Party header and party roster use the full 202-pixel Party width.
- Enemies header and enemy roster use the full 202-pixel Enemies width.
- Turn Log header, Turn Detail panel, log feed, and log rows use the full 236-pixel Turn Log width.
- HP bars and card faces retain a small internal gutter; those are content inside the panel rather than separate panel edges.
- Player and enemy card rails use the same available width and therefore render symmetrically.

## Selection Treatment

- Keep every roster panel's outer border at 1 pixel in selected and unselected states.
- Show the active Party or Enemy with a 3-pixel accent bar drawn inside the panel bounds plus the existing fill tint.
- Hide the accent bar on inactive enemy roster panels.
- Move the accent bar with the roster panel during damage-shake animation.
- Never change panel dimensions or outer stroke width to communicate selection.

## Behavior

- Do not change combat playback, event grouping, targeting, card selection, or engine calculations.
- Preserve the current vertical positions, log-row height, paging, playback controls, and modal behavior.
- Multi-enemy roster chips continue dividing the enemy roster width evenly.

## Verification

- Check one-enemy and two-enemy scenes at 720 x 1280.
- Confirm every header shares exact left and right edges with its panel.
- Confirm Party and Enemies have equal widths and card rails.
- Confirm text, controls, cards, and roster chips do not overflow.
- Confirm selecting either enemy does not change any panel's outer dimensions.
- Run type checking, production build, and the full test suite.
