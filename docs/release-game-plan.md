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
| Run shape v1 *(rev. 2026-07-29)* | **Wave rhythm**: a run is **5 waves**; each wave = 2–3 **stop** columns (pick 1 of 2–3 event/shop choices per stop) followed by a **mandatory fight**. Fights 1–2 normal, 3–4 elite, 5 = boss. No fog-of-war map yet. |
| Leveling *(rev. 2026-07-29)* | **Lockstep**: the hero gains +1 level after EVERY fight (win or lose); enemy level = fight number (1..5). Losses sting through gold only. |
| Loss rule | **Bazaar-style**: losing a normal fight pays nothing (no gold, no reward) but the run continues — the punishment is starving while enemies keep scaling. |
| Run end | Beat the **boss** (fight 5) → run won. Lose to the boss → run over. (A "3 losses ends the run" hardening dial may come later.) |
| Events | Built with this revision — see [`run-events-design.md`](run-events-design.md) for the outcome vocabulary and v1 catalog; events are the main stop-node content. |
| Both platforms | Every run screen ships desktop (1440×900) AND mobile (412×892) — the both-platforms rule applies with full force. |

## The run loop

```
Menu → DRAFT (4-set start draft, existing scenes)
     → WAVE 1 … WAVE 5   (each wave: 2–3 stop columns, then one fight)
         stop column → pick 1 of 2–3:
             ├─ EVENT → EVENT DIALOGUE (2–3 choices, seeded outcomes) → map
             └─ SHOP  → single themed storefront (run wallet) → map
         fight column → RUN PREP (read-only foe) → BATTLE → reward → map
     → WAVE 5 fight = BOSS → VICTORY / DEFEAT summary → Menu
```

- Enemy strength scales with the **fight number** via `FIGHT_TABLE`
  (fight n → level n; titles normal/normal/elite/elite/boss) through the
  existing encounter dials — no new balance machinery; the PL economy stays
  the single authority.
- Gold: existing `battleGoldReward` (base + win bonus) on wins only; shops and
  reroll prices unchanged from Shops v1.
- Determinism: the whole run derives from one run seed — map generation,
  encounter rolls, event rolls, shop stock (`rollShopStock`), and fight seeds.

### Hero leveling & stat allocation (locked 2026-07-29)

- **+1 hero level after every fight, win or lose** — so the hero enters fight
  n at LV n, in lockstep with the enemy. Events may grant extra levels.
- Each level grants **3 PL** to spend via the existing priced
  `LEVEL_STAT_COST` economy (`heroAllocation`) — the run NEVER auto-spends it.
- **The player must be able to spend banked PL at any time between fights**,
  not only at a level-up moment. Required UI (both platforms):
  - A **STAT / LEVEL panel** reachable from the Run Map and from Run Prep
    (before the fight) — the same priced allocation grid the sandbox Prep
    uses (HP/ATK/MAG/DEF/RES/SPD, buys disabled when unaffordable), showing
    PL SPENT / PL BANKED.
  - **Banked-points nudge**: whenever PL is unspent, the map/prep header shows
    a highlighted "n PL TO SPEND" badge that opens the panel, so a player
    can't walk into a fight unaware of banked points.
  - Post-battle: the CONTINUE flow surfaces the level gained and the new
    banked total (level-up feedback), landing back on the map with the badge
    lit.
  - Allocation is a **confirmable scratch edit** (locked design, 2026-07-29,
    supersedes the earlier "additive-only, no respec in v1" line): the panel
    lets the player add AND subtract stat buys freely before confirming
    (`src/run/runState.ts#setHeroAllocation`/`heroAllocationCost`), and a
    confirm may lower a stat back toward zero relative to the last confirmed
    allocation — the only floor is that the confirmed allocation must fit the
    run's currently banked PL. Effectively free respec at any time between
    fights. The sandbox keeps its own separate auto-trim-on-level-down
    behavior.

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
