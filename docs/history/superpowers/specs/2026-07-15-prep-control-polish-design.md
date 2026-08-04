> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Prep Control Polish Design

## Goal

Keep the existing card-game identity while making the mobile Prep screen feel lighter, smoother, and less cramped.

## Visual Treatment

- Reduce ordinary control and card outlines to 1-2 px; reserve stronger outlines for selected/highlighted states.
- Retain square card-game geometry and the current palette.
- Add small, low-opacity offset shadows to cards and major buttons rather than heavier borders.
- Keep tiny controls flat so repeated shadows do not create visual noise.

## Layout

- Group enemy level and rank into separate compact stepper surfaces.
- Give labels, values, and minus/plus buttons fixed breathing room within each group.
- Apply the same grouped treatment to the hero-level control.
- Preserve all current panel sizes, safe-area insets, and 720x1280 portrait behavior.

## Verification

- Inspect the full Prep screen at 720x1280 and confirm no text touches button borders or overlaps adjacent controls.
- Verify enemy and hero steppers, foe tabs, footer buttons, and FIGHT navigation still work.
- Run typecheck, build, tests, and `git diff --check`.
