Grep recipes that actually work on this checkout. Owner: whichever file each
recipe targets — this is a shortcut into the code, not a source of truth.
Every recipe below was run against the current tree on 2026-09-15 and
returned at least one real hit; if one comes up empty for you, the tree moved
and the recipe (not the fact) needs fixing.

```bash
# A card, by id, in the authored document
grep -n '"id": "sworn_edge"' src/data/content/skills.v1.json

# One keyword end to end: price -> text -> behaviour
grep -n "burn" src/engine/keywords/pricing.ts src/engine/keywords/text.ts
grep -n "case 'burn'" src/engine/combat/interpreter.ts

# Every Action kind the engine knows (the union every registry must agree on)
grep -n "ActionKinds" src/engine/types.ts
grep -n "case '" src/engine/combat/interpreter.ts

# What a price constant is, and who reads it
grep -rn "TIER_BUDGET_DECI\|EFFECT_CAPS_DECI" src/ scripts/

# An event, from authored pack to runtime to the generated wiki
grep -rn '"id": "feathered_cairn"' src/data/content/event-packs/
grep -rln "feathered_cairn" src/ docs/generated/   # authored pack -> aggregate -> consumers -> wiki

# An enemy kit (authored TS, not JSON)
grep -n "id: 'bandit_duelist'" src/data/enemies.ts

# Both platforms of one screen - if only one file comes back, the change is half done
ls src/game/scenes/ | grep -i shop

# Who consumes a RunState field
grep -rn "\.lives\b" src/run src/game

# Prove a boundary before claiming one
node scripts/check-boundaries.mjs
```
