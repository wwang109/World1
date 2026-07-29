# World1 — Release Game Plan (Run Mode)

**This is the project file for the release version of World1**: a seeded
roguelite run — draft a starter deck, fight progressively stronger enemies,
spend gold in shops, choose your path node-by-node, and take down the zone
boss.

The existing app (Prep / Deck Build / Wiki / Battle with free dials) is **not**
the release game. It is the **Sandbox** — a balance-testing and
deck-idea tool. It stays alive at its current `?scene=` routes and keeps its
own checklist in [`feature-inventory.md`](feature-inventory.md). Nothing in
this plan may regress it.

---

## Locked design decisions (2026-07-29)

| Decision | Choice |
|---|---|
| UI split | **Separate run scenes** (new `*RunMapScene`, `*RunPrepScene` per platform) reusing shared components (CardToken, BoardColumn, battleTimeline) — not mode-flags inside sandbox scenes. |
| Run shape v1 | **Simple node choice**: after each node, pick 1 of 2–3 next nodes (fight / elite / shop). No fog-of-war map yet — that layers on later (see memory: map & encounters planned). |
| Loss rule | **Bazaar-style**: losing a normal fight pays nothing (no gold, no reward) but the run continues — the punishment is starving while enemies keep scaling. |
| Run end | **Fixed-depth zone**: ~10 node picks ending in a mandatory **boss** node. Beat the boss → run won. Lose to the boss → run over. (A "3 losses ends the run" hardening dial may come later.) |
| Both platforms | Every run screen ships desktop (1440×900) AND mobile (412×892) — the both-platforms rule applies with full force. |

## The run loop

```
Menu → DRAFT (4-set start draft, existing scenes)
     → RUN MAP (new) — pick next node
         ├─ FIGHT  → RUN PREP (new, read-only foe) → BATTLE (reused) → reward → map
         ├─ ELITE  → same, harder foe, better reward
         └─ SHOP   → SHOP (reused, run wallet) → map
     → … depth ~10 …
     → BOSS → BATTLE → VICTORY / DEFEAT summary (new) → Menu
```

- Enemy strength scales with **depth** through the existing encounter dials
  (base monster + Title mob/normal/elite/boss + Level + Rank + Modifiers) — no
  new balance machinery; the PL economy stays the single authority.
- Gold: existing `battleGoldReward` (base + win bonus) on wins only; shops and
  reroll prices unchanged from Shops v1.
- Hero leveling: grows with wins; the player spends PL via the existing priced
  allocation (`heroAllocation`), surfaced on the run prep / map screen.
- Determinism: the whole run derives from one run seed — map generation,
  encounter rolls, shop stock (`rollShopStock`), and fight seeds.

## Architecture

New code lands in the layers that already exist; boundaries unchanged.

```
src/run/runMap.ts     Seeded node-graph generator (depth-10 DAG, 2–3 choices
                      per step, boss terminal). Pure TS + tests.
src/run/runState.ts   Single source of truth for an active run: seed, map +
                      current node, gold, deck/bag/gem pouch, hero level +
                      allocation, wins/losses, depth. Encounter roll per node.
src/game/scenes/      DesktopRunMapScene / MobileRunMapScene
                      DesktopRunPrepScene / MobileRunPrepScene
                      Run summary (victory/defeat) screen
```

Reused with a run-routing parameter (already run-shaped):
**Draft** (run entry), **Shop** (shop nodes), **Deck Build** (between fights),
**Battle** (playback head returns to map + credits reward once; loss → 0).

Sandbox `demoState` is NOT the run store — run scenes read `runState`. The
battle scenes stay dumb playback heads over `battleTimeline.ts` / the battle
API either way.

## Build phases

1. **Run core** — `runMap.ts` + `runState.ts` + `tests/run/` (gameplay-programmer).
2. **Run Map scenes** D+M (phaser-ui-programmer).
3. **Wiring** — draft→run start, fight node→run prep→battle→reward→map,
   shop node→shop→map.
4. **Summary screen** + feature-inventory RUN section + Playwright smoke.

Gate for every phase: `npm test` green (boundary check + full vitest).

## Out of scope for v1 (planned later)

- Fog-of-war zone map, multiple zones, boss per zone.
- Text event encounter nodes (events granting cards is the next milestone
  after run v1).
- Meta persistence (`src/meta`) — run survives a refresh later, not v1.
- Enemy Modifiers as random affixes on elite/boss nodes (machinery exists;
  authoring pass later).
