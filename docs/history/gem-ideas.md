> **HISTORICAL** — accurate as of its date; superseded by `src/data/gems.ts` (46 gems) and `docs/power-level-reference.md`. Never cite as current. Status marks reflect the 12-gem era.

# Gem Ideas — design backlog

Possible gems for the socket system. A gem is one of three kinds:
- **Effect** — appends an Action/rider to the host card (fires when that card casts).
- **Card-stat** — buffs the host card only (rides the aura-mods bundle).
- **Hero-stat** — flat bonus to the combatant's stats (rune-like).

**Rarity = power**, priced by band: **Common 2 · Rare 4 · Epic 6 · Legendary 8 PL**
(Legendary can also be a smaller effect on a heavier/anti-synergy host). Every gem
must sit on its band (the gem audit enforces it). PL adds ON TOP of the host card's
base; the base tier audit is untouched. See `docs/power-level-reference.md`.

Legend: ✅ built · 🟢 buildable now (existing actions) · 🔶 needs a new engine mechanic (additive rider).

---

## Effect gems (add a rider to the host card)

| Gem idea | Effect | Status |
|---|---|---|
| Venom Sliver | poison the target | ✅ built (common) |
| Stunning / Concussive Shard | stun 1–2 turns | ✅ built (rare/legendary) |
| Enfeebling Shard | debuff enemy Armor/MR | ✅ built (epic) |
| Ember gem | burn on hit | 🟢 |
| Leeching gem | lifesteal % of the cast's damage | 🟢 |
| Sapping gem | stagger (drain enemy banked readiness) | 🟢 |
| Hobbling gem | slowNext (enemy's next action heavier) | 🟢 |
| Sundering gem | shieldBreak before the hit | 🟢 |
| Chained gem | comboBonus (rewards same-archetype chains) | 🟢 |
| Cripple gem | debuff enemy Attack / Magic Power / Speed | 🟢 |
| Cleansing gem | cleanse the caster's own DoTs/debuffs on cast | 🟢 |
| Mending gem | small heal on cast | 🟢 |
| Warding gem | small shield on cast | 🟢 |
| Bulwark gem (effect) | grant guard % on cast | 🟢 |
| Silencing gem | grant a negate charge on cast | 🟢 |
| **Detonator gem** | detonate the target's poison for burst | 🔶 needs `detonate` |
| **Vulnerability gem** | mark: enemy takes +X% damage from all sources | 🔶 needs `vulnerable` |
| **Thorns gem** | reflect damage when the owner is hit | 🔶 needs `retaliate`/thorns |
| **Executioner gem** | +X% damage vs targets below Y% HP | 🔶 needs execute |
| **Split gem** | the card's damage becomes N smaller hits | 🔶 needs multi-hit |
| **Ramp gem** | the card grows in power each time it casts | 🔶 needs stacking/ramp state |
| **Trigger gems** | on-crit / on-kill / on-block effects | 🔶 needs a trigger/event hook |
| **Prism gem** | change the host card's element/weapon type | 🔶 needs type override in resolver |

## Card-stat gems (buff the host card)

| Gem idea | Effect | Status |
|---|---|---|
| Empowering Core | +damage % | ✅ built (epic) |
| Lightweight Core | −weight (casts sooner) | ✅ built (rare) |
| Keen Edge | +crit % | ✅ built (common) |
| Restorative Core | +heal % | ✅ built (legendary) |
| Focusing gem | + crit AND small +damage (split across two mods) | 🟢 |
| Featherweight (big) | large −weight for a heavy card | 🟢 |
| **Aura gem** | the host card projects an adjacency aura | 🔶 needs gem→aura in resolver |
| **Span gem** | shrink/grow the card's size/span | 🔶 needs size override |

## Hero-stat gems (global, rune-like)

| Gem idea | Effect | Status |
|---|---|---|
| Brawler's Core | +Attack | ✅ built (rare) |
| Archmage's Core | +Magic Power | ✅ built (legendary) |
| Bulwark Core | +Armor | ✅ built (epic) |
| Swift Charm | +Speed | ✅ built (common) |
| Warded gem | +Magic Resist | 🟢 |
| Deadeye gem | +Crit % | 🟢 |
| **Vital gem** | +Max HP | 🔶 minor: add `maxHp` to hero-scope stat set (not a BuffableStat today) |

---

## Notes for future authoring
- **Cheap wins first:** the 🟢 rows are pure content — just new `GemDef`s priced to a band. A full "one gem per rider + per stat, across rarities" pass would roughly double the catalog with zero engine work.
- **The 🔶 rows share mechanics with the theme backlog** (`detonate`, `vulnerable`, `retaliate`, execute, multi-hit) — build the rider once and both a card and a gem can use it. `vulnerable` and `detonate` are the highest-value additions (reused across many gems + themes).
- **Rarity ≠ just bigger numbers:** higher-rarity gems can unlock *kinds* of effects (triggers, detonate, aura-granting) that commons never get, giving chase-item feel.
- **Balance guardrail:** hero-stat gems are the strongest generically (help every card); keep their per-point rates honest and sim-tune (flagged with the deferred stun re-tune).
