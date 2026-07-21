# Wiki Card Filters Design

## Goal

Let players narrow the full mobile card catalog without shrinking tiles or crowding the existing tier row.

## Interaction

- Add one compact `FILTER` button beside the Wiki bag count.
- Open a modal sheet with one selectable choice per category: Role, Property, Weight, Card Size, and Sort.
- Categories combine with AND logic; choosing `All` disables that category.
- `CLEAR` resets the draft, `APPLY` commits it and returns to page one, and the close control discards uncommitted changes.
- The button displays the active-filter count.

## Filter Semantics

- Role: Attack, Defense, Heal, Buff, Debuff, or Support, derived from authored archetypes/effects.
- Property: Physical, Magical, or True.
- Weight: Light (0-9), Medium (10-19), or Heavy (20+), using authoritative `weightOf`.
- Card Size: 1 slot, 2 slots, or 3+ slots, using the authored `SkillDef.size`.
- Sort: Name ascending, Weight ascending, or selected-tier PL descending.

## Layout And Verification

- Keep six catalog tiles per page and the existing Bronze/Silver/Gold/Diamond preview row.
- Show filtered result count and recompute page count from the filtered set.
- Verify combined filters, empty results, and all sort modes at 720x1280.
