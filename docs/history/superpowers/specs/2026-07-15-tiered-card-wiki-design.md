> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Tiered Card Wiki Design

## Goal

Turn the Wiki into a readable mobile card catalog that exposes canonical action verbs, previews every tier, and adds duplicate card instances to the ten-slot bag.

## Catalog

- Replace variable-width card rows with six uniform catalog tiles per page in a two-column, three-row layout.
- Every tile shows card name, property, weight, PL, canonical action verbs, short effect values, and owned-copy counts.
- Action verbs come directly from `SkillDef.effects`; authored card text remains the full explanation in the shared inspector.
- Verbs use semantic colors: attack/red-orange, defense/blue, healing/green, buffs/gold, debuffs/purple, and tempo/amber.

## Tier Preview

- A shared Bronze/Silver/Gold/Diamond selector changes the whole catalog preview.
- Tiles and inspection use `applyTier`, so displayed power, weight, text, and PL come from the existing tier resolver rather than UI calculations.
- The selected tier is attached to newly added copies.

## Card Instances

- Every owned copy receives a stable sequential `instanceId` such as `card_011`.
- `skillId` identifies the authored card definition; `instanceId` identifies one owned copy; `tier` belongs to that copy.
- Duplicate skill IDs are allowed in the bag and deck. Movement between bag and deck preserves instance ID and tier.
- `+ BAG` fills the first empty bag slot. A full bag shows `BAG FULL` without changing state.

## Naming

- Display-name changes remain in Claude's `src/data/skills.ts` ownership.
- Keep stable skill IDs even when display names become more evocative.
- Request a naming audit beginning with `Follow-Through` and other mechanical placeholder names.

## Verification

- Inspect all Wiki pages and all four tier previews at 720x1280.
- Add two copies of one skill at different tiers, verify unique IDs and tier-preserving bag/deck movement, and verify bag-full behavior.
- Run typecheck, build, tests, and `git diff --check`.
