> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Expanded Wiki Catalog Design

## Goal

Use the Wiki exclusively for card discovery and show more cards without reducing card readability.

## Layout

- Remove the duplicate enemy Scout Strip from the Wiki tab.
- Expand the Card Wiki panel from the top content boundary to the Inspect panel.
- Render ten cards per page in a two-column by five-row grid.
- Preserve the existing 308x118 card tiles, filter/tier controls, and Inspect panel.

## Verification

- Preview the unfiltered catalog and a filtered result at 720x1280.
- Require ten visible cards on a full page with no overlap into Inspect.
- Run strict control spacing audit, typecheck, build, and tests.
