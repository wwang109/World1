# Attached Turn Detail Panel

## Goal

Remove the unused gap beneath the `TURN LOG` header and make the selected turn easier to read on a 720 x 1280 portrait screen.

## Layout

- Move the Turn Detail panel from `y = 208` to `y = 148`, leaving a two-pixel seam below the lane header.
- Match its horizontal edges to the log rows at `x = 212` with a width of `212` pixels.
- Increase its height from `174` to `234` pixels.
- Keep the panel's bottom edge at `y = 382`, so the combat-log feed still starts at `y = 394` and the rest of the screen does not move.
- Use the extra height for a clearer vertical order: turn heading, activation summary, aura/effect sources, result lines, then the calculation strip.
- Wrap long calculation tokens within the 38-pixel strip instead of clipping the final result at the narrower aligned width.
- Keep the center lane width unchanged and preserve the current thin border, color system, paging, playback controls, and card highlighting.

## Behavior

- Selecting a log entry continues to update the panel and highlight the relevant card slots.
- The panel displays only values from the precomputed combat event log. No combat rules or calculations move into the UI.
- Empty or short sections collapse naturally within their reserved text bounds without changing the feed position.

## Verification

- Check the single-enemy and multi-enemy portrait scenes at 720 x 1280.
- Confirm the detail content does not overlap the first log row.
- Confirm the log feed, paging, and playback controls remain at their existing positions.
- Run type checking, production build, and the full test suite.
