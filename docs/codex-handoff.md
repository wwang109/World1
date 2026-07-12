# Codex ↔ Claude Handoff Ledger

The shared coordination doc between **Codex CLI** (UI/design, `src/game/`) and
**Claude Code** (engine/data/balance/tests). It exists so the two agents stay in
sync on the same repo without clobbering each other.

## How to use this doc
- **Codex:** append a **Session entry** (template below) every time you do work.
  Put anything you need from Claude into **Requests to Claude**. Record UI
  decisions worth keeping in **Durable UI decisions**.
- **Claude:** read new entries, verify the work (build/tests/boundaries + a look),
  and reply inline under the entry's **Claude review** line. Action items you need
  from Codex go in **Requests to Codex**.
- Keep newest entries at the top of the Session log. Never delete history —
  append. Each agent stamps its entries with a real date.

---

## Durable UI decisions (both agents honor these)
_A running list of settled UI/design conventions so we don't thrash. Add here
when a decision should outlive a single session._
- Canvas is 1280×720, `Phaser.Scale.FIT`, centered. Design to that logical size.
- All visual constants live in `src/game/theme.ts`; scenes never hardcode colors/sizes.
- Semantic colors are keyed by property/archetype/element/weapon/status (see the
  UI guide §3) — extend those maps, don't invent parallel ones.
- The battle scene is a dumb playback head over the engine event log; it never
  computes combat. New display values are added to the event log by Claude on request.

## Requests to Claude (Codex → Claude)
_Engine/data/run changes Codex needs. Claude marks each DONE with the commit._
| # | Need | Why (UI use) | Status |
|---|------|--------------|--------|
| _(none yet)_ | | | |

## Requests to Codex (Claude → Codex)
_UI/design work Claude is handing over. Codex picks these up._
| # | Ask | Notes | Status |
|---|-----|-------|--------|
| 1 | Elevate Prep + Battle visual design past the prototype look | See UI-guide §8 backlog; keep mechanics legibility as the top goal | OPEN |

---

## Session log (newest first)

### Entry template — copy this for each Codex session
```
### <YYYY-MM-DD> — Codex — <short title>
- CHANGED: <one-line summary>
- FILES: <paths under src/game/ (and docs/)>
- DESIGN: <what the player now sees/does; any theme/system changes>
- VERIFY: npm run build = pass/fail · npm test = pass/fail (+count) · typecheck = clean? · looked at it via dev? screenshot?
- ASSUMPTIONS: <e.g. run-state shape you mocked, event field you expect>
- REQUESTS TO CLAUDE: <#refs added to the table above, or "none">
- OPEN: <anything unfinished / questions>
- Claude review: <left blank for Claude to fill: verdict + notes>
```

---

### Baseline — Claude — current state at handover
- CHANGED: Established this handoff + the Codex UI guide + AGENTS.md. No UI code changed.
- STATE OF THE UI: Two working Phaser scenes — `Prep` (drag cards onto a 10-slot
  board, tooltips, enemy picker/preview, FIGHT) and `Battle` (event-log playback:
  per-turn comparison math, HP + typed-shield bars, floating numbers, combat log,
  status icons incl. guard ⛨ / negate ⦵, matchup callouts, sudden-death banner,
  speed/skip/replay/seed controls). Both render at a functional-but-prototype
  visual level — this is the design surface to elevate.
- ENGINE CONTRACT: `simulate(config, seed)` returns `{ result, events, finalState }`.
  The battle scene walks `events`; event shapes are in `src/engine/combat/events.ts`.
  Cards render via `CardView` + `theme.ts` glyphs; card `text` follows
  `docs/card-text-style-guide.md`.
- VERIFY BASELINE: `npm test` green (109), `npm run build` passes, typecheck clean.
- NOTES FOR CODEX: The run layer (map/shop/menu/etc.) isn't built — scaffold those
  views against mocked state and record the shapes here so Claude implements them to
  match. Never touch `src/engine`, `src/data`, or `tests/`; request engine/log
  changes via the table above. `demoState.ts` is the temporary session state until
  the run layer lands.
- Claude review: n/a (baseline).
