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
| Run shape *(rev. 2026-07-30 — ENDLESS)* | **Endless wave ladder**: a wave = 2–3 **stop** columns (pick 1 of 2–3 event/shop choices) then a **fight column**. Waves keep coming — the map generates lazily, wave N deterministic from the run seed alone. Non-boss fight columns offer **two foes** (standard / hard). |
| Run end *(rev. 2026-07-30)* | **3 lives + retire.** EVERY fight loss costs a life, including a boss loss; at 0 lives the run ends (`defeat`). **RETIRE** any time to stop voluntarily (`retired`). `bossesCleared` is the run's score. There is no "victory" state — the engine keeps the legacy `'victory'` status member unset so `src/game` still compiles. |
| Bosses *(rev. 2026-07-30)* | A **milestone boss every 5th fight** (5, 10, 15…), each harder. Titles repeat per 5-fight block: normal, normal, elite, elite, boss. |
| Scaling *(rev. 2026-07-30)* | Enemy level tracks the fight number, **capped at 30**; the hero likewise caps at 30 (still +1 per fight, win or lose). Past the cap difficulty keeps growing through **rank (tier-steps) and modifier affixes**, never plateauing. |
| Loss rule | Losing costs a **life** and the fight's gold, but the day's +1 income still lands (see Gold below). Supersedes the earlier "a loss pays nothing".|
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
- Gold *(rev. 2026-07-30, user-locked)*: **+1 basic income per DAY, where a day
  is every node you commit to** (`DAILY_INCOME`, awarded in `chooseNode`). A
  fight day pays daily 1 + the fight's base 1 = **2 minimum on a win**, plus the
  difficulty win bonus. **A loss still earns that day's 1** — this supersedes the
  earlier "a loss pays nothing" rule; only the fight's own gold is withheld.
  Measured totals and the resulting pacing question: see
  [`run-shops-design.md`](run-shops-design.md) §2.
- Fights *(rev. 2026-07-30, user-locked)*: each wave's mandatory fight column
  offers a **choice of two foes** — `fightOption: 'standard' | 'hard'`, the hard
  one a title rung and a level above, paying more. Wave 5's boss is a single
  node.
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
