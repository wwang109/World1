> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Opponents Reference Tab Design

## Goal

Add a dedicated, reference-only opponent encyclopedia without changing the configured fight.

## Navigation

- Add `OPPONENTS` as the fourth Prep tab beside Deck, Bag, and Wiki.
- Rebalance the four tab widths to fit the 720px portrait canvas.
- Support direct launch with `?view=opponents`.

## Catalog

- Show eight opponents per page in a two-column by four-row grid.
- Each tile shows identity tier, base HP/Speed/offense/defenses, affinities or weakness, rewards, and base card names.
- Tapping a tile opens a full reference sheet; it never changes `demoState.enemyTeam` or the next fight.

## Detail Sheet

- Clearly label values as base-floor reference data.
- Show complete stats, affinities, weakness, rewards, and authored card rotation.
- Show each card's property, weight, size, and canonical action summary.
- Close only through the X control or dimmed backdrop.

## Verification

- Confirm direct launch, pagination, and modal opening at 720x1280.
- Confirm browsing leaves the configured encounter unchanged.
- Require zero strict layout-audit errors, no overflow, and green build/tests.
