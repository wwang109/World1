# Party Battles Plan — 1v1 · 1v2 · 1v3 · 2v2 · 3v3 … up to 5v5

Goal: any battle shape from 1v1 to 5v5 (max 5 combatants per side). This is a
plan, not an implementation — nothing here is built yet.

## Why this is cheap in principle

The engine already treats combat as a pure calculator: cards are data, the
interpreter applies a closed Action DSL, and every combatant is the same
`CombatantState` shape (stats, board, shields, statuses, bank). Nothing about
"the player" or "the enemy" is special except that the state holds exactly one
of each. Going wide means turning those two slots into two *arrays* and
answering the questions that only exist once a side has more than one member:
who acts, who gets hit, and when the fight ends.

## Phase A — engine generalization (pure TS, no UI)

### State

```ts
// state.ts
export interface CombatState {
  turn: number;
  player: CombatantState[];   // 1–5
  enemy: CombatantState[];    // 1–5
}
// CombatantState gains: `unit: number` (index within its side, fixed at init)
```

`CombatConfig.player/enemy` accept `CombatantSetup | CombatantSetup[]`
(single stays valid — every existing test and call site keeps compiling).
Validation: 1–5 per side, hard error otherwise.

### Turn scheduling — same comparison, wider field

Today: two scores compete, higher performs, loser banks. Generalized:

- every non-busy combatant on BOTH sides queues its next card (own rotation,
  own cursor) and computes `score = bank + speed − weight`;
- the single highest score across ALL ready combatants performs;
- ties break player-side-first, then lower unit index (deterministic);
- everyone else (including the performer's allies) banks their Speed.

One performance per global turn keeps the initiative math, the event
stream, and the playback pacing identical in spirit to 1v1 — a 5v5 just has
ten contenders instead of two. A side with more members naturally acts more
often in wall-clock turns but each member individually paces by its own
weight — outnumbered fights feel outnumbered, which is the point of 1v2/1v3
encounter design.

### Targeting — the new question

Offensive actions need a victim; supportive ones keep applying to the caster.

- **v1 rule: front-line targeting.** Each side's array order is its
  formation; hostile actions hit the FIRST ALIVE member of the opposing
  side. Deterministic, zero data changes, and formation order becomes a
  real pre-battle decision (your slot-1 hero is the tank).
- Target resolves **per strike**, not per cast — a multi-hit that kills the
  front unit rolls its remaining hits into the next one; thorns pays back
  the actual attacker.
- **v2 (later, priced like everything else):** targeting riders on cards —
  `{ target: 'backline' | 'lowestHp' | 'all' }`. AoE ("hit ALL enemies")
  gets a PL multiplier per extra target (~×0.6 per additional victim,
  tuned by sim). This is data + one interpreter switch, no new engine
  concepts — same pattern as the ability riders.

### End, sudden death, fatigue

- A side is defeated when ALL members are dead; player wins simultaneous
  wipes (unchanged).
- Sudden death: today it arms when both sides have performed N times.
  Generalized per side: armed when `side.totalPerforms >= N × side.size`
  ("every member has averaged N performances"). Amp stacks stay
  per-combatant.
- Fatigue backstop unchanged: flat true damage to every living combatant.

### Events

Every side-carrying event gains `unit: number`. The comparison event keeps
its `player`/`enemy` best-contender fields (existing tests/UI keep working)
and adds `contenders: ComparisonUnit[]` for full multi-side display.

### Tests (the real work)

- 1v1 golden-master: simulate the existing demo matchups before/after the
  refactor — event streams must be BYTE-IDENTICAL (this proves the
  generalization changed nothing for current content).
- Scheduling: 2v1 — the pair performs ~2× as often; per-unit pacing by
  weight still holds.
- Targeting: front-line focus, retarget mid-multiHit on kill, thorns pays
  the actual attacker, dead units skipped.
- End conditions: side-wipe only; sudden-death arming at N×size.
- Determinism: 100 random NvM configs, double-run equality.
- `scripts/fight.ts`: `npm run fight -- giant_rat,ember_imp,wolf_king 42`
  (comma list = enemy party) for eyeballing.

Estimated size: ~300 lines engine diff + ~150 lines tests. No data changes.

## Phase B — 1vN demo (first playable slice)

Smallest UI that shows the feature: one hero versus an enemy PARTY.

- Prep: enemy picker becomes multi-select (click to add/remove, 1–5, dupes
  allowed via a chip row). `demoState.enemyId` → `enemyIds: string[]`.
- Battle scene: hero layout unchanged; the enemy area swaps to N compact
  panels (name, HP/shield bar, statuses, queued-card line) once N > 1 —
  full enemy board rendering stays for 1v1. Kill order left→right makes
  front-line targeting legible.
- Reward preview sums the party's gold/xp.

## Phase C — party prep (2v2+)

Needs real design (this is where "don't build yet" matters most):

- A party = up to 5 heroes, EACH with its own 10-slot board — prep needs a
  hero switcher (tabs) and a formation row (drag to reorder = who tanks).
- Where do extra heroes come from? Ties into the run layer (recruit events)
  and the meta skills tree (Legacy branch could unlock party slots) — the
  demo can fake it with "add a hero" cloning base stats.
- Card ownership: one collection shared across boards, or per-hero drafts?
  Recommendation: shared collection, a card can sit on only one board
  (the Cards page inventory already models the shared pool).
- Battle scene: both sides as compact panels at 3v3+; tap a panel to peek
  at its board. This is the biggest UI lift — schedule after Phase A/B
  have soaked.

## Sequencing & effort

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| A | engine arrays + targeting + tests | ~1 session | nothing |
| B | 1vN prep picker + battle panels | ~1 session | A |
| C | party prep UI + shared collection | 2+ sessions, needs design sign-off | A, B; run-layer/meta decisions |
| v2 targeting riders (AoE, backline, lowest-HP) | data + pricing + sim tuning | ~1 session | A |

Open questions to settle before Phase C:
1. Hero acquisition: run-layer recruits, meta-tree unlocks, or both?
2. Shared XP/level or per-hero?
3. Should enemy parties share a formation-wide aura row (banner-style
   pieces), mirroring how player support cards work positionally?
