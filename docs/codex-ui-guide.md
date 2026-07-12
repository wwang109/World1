# Codex UI & Design Guide

Your handbook for the UI/UX and visual design of World1. You own `src/game/`.
Everything here is grounded in the current code — when you change the system,
update this doc and log it in `docs/codex-handoff.md`.

---

## 1. Architecture (how the UI relates to everything else)

```
src/engine/   Pure deterministic combat sim. simulate(config, seed) -> { result, events, finalState }.  (Claude's — read-only for you)
src/data/     Cards, enemies, heroes.  (Claude's — read-only for you)
src/run/      In-run state: board placement, mapgen, shop (mostly not built yet).  (Claude's)
src/game/     Phaser scenes + rendering.  ← YOUR HOME. Only this layer may import phaser.
src/main.ts   Phaser.Game bootstrap.
```

The **golden rule**: the UI is a *view*. It reads pure data/results and draws
them. It never owns game logic. The battle scene in particular is a **playback
head** over an event log the engine produced up-front — see §4.

`src/main.ts` config (change here to register new scenes):
```ts
new Phaser.Game({
  type: Phaser.AUTO, width: 1280, height: 720, parent: 'app',
  backgroundColor: '#0e0e12',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [PrepScene, BattleScene],   // add new scenes here
});
```
The design canvas is **1280×720**, scaled with `FIT` (letterboxed) and centered.
Design to that logical resolution; it scales to any window.

## 2. Scene inventory (current)

| File | Scene key | What it is |
|---|---|---|
| `src/game/scenes/PrepScene.ts` | `Prep` | Board-arranging screen: drag multi-slot cards onto the 10-slot board, aura highlights, tooltips (archetype/property/element/weapon/PL/weight/span), enemy picker + preview, FIGHT button. |
| `src/game/scenes/BattleScene.ts` | `Battle` | Turn-by-turn playback of a fight: both boards, per-turn comparison math, HP + typed-shield bars, floating numbers, combat log, status icons, guard/negate, sudden-death banner, speed/skip/replay/seed controls. |
| `src/game/ui/CardView.ts` | — | Reusable card widget (name, archetype icons, property color + label, element/weapon icon, weight). Width = `size * SLOT_W`. |
| `src/game/theme.ts` | — | The design system (see §3). |
| `src/game/demoState.ts` | — | Mutable demo session state shared between scenes (the player's `pieces`, chosen `enemyId`, `seed`). This is a stand-in until the run layer exists. |

## 3. Design system (`src/game/theme.ts`)

**You are the design owner** — you may evolve this, but keep ALL visual constants
centralized here (never hardcode colors/sizes in scenes), and log system changes
in the handoff doc so Claude's summaries stay accurate.

Current palette (`UI`):
```
bg 0x0e0e12  panel 0x1a1a22  panelLight 0x24242e  slot 0x2a2a36  slotHover 0x3a3a4a
good/hp 0x4caf6e  bad 0xcc4444  hpBack 0x333340   text #e8e8f0   textDim #8a8a9a
```
Semantic color keys (don't invent parallel ones — extend these):
- `PROPERTY_COLOR`: physical `#d98a3d` (orange) · magical `#5a8dee` (blue) · true `#e8d5a0` (gold-white). `PROPERTY_LABEL`: PHYS/MAG/TRUE.
- `ARCHETYPE_COLOR` / `ARCHETYPE_ICON`: offense ⚔ `#cc4444` · defensive 🛡 `#4a7ab5` · healing ✚ `#4caf6e` · support ♦ `#c9a227` · debuff ☠ `#9b59b6`.
- `ELEMENT_ICON`: fire 🔥 · frost ❄ · lightning ⚡ · nature 🌿 · holy ☀ · dark 🌑.
- `WEAPON_ICON`: sword 🗡 · axe 🪓 · lance 🔱 · bow 🏹 · beast 🐾.
- `STATUS_ICON`: poison ☠ · burn 🔥 · stun 💫 · buff ▲ · debuff ▼ · guard ⛨ · negate ⦵.

**Design language (baseline — elevate it, keep it coherent):**
- **Dark, legible, tactical.** Backgrounds dark; information carried by the
  semantic accent colors above. Contrast must stay AA-readable on `bg`.
- **Type:** currently monospace throughout (reads as a "board = program" system).
  A real type scale (display / heading / body / caption) is welcome — define it
  in `theme.ts` and apply consistently. If you introduce a webfont, it must be
  bundled/self-hosted (no external CDN — Vite build + offline).
- **Legibility of mechanics is the #1 design goal.** The comparison math
  (`bank + Speed − weight = score`), matchup advantage, shields, and durations
  must be readable at a glance — that's the game's core counterplay surface.
- **Motion/juice** (tasteful): cast highlights, hit shake, floating numbers,
  status pop/fade. Never let motion carry *meaning* that isn't also in the log
  (accessibility + the log is the source of truth).
- Spacing/layout: use a consistent grid; the board is a row of `SLOT_W`-wide
  cells. Keep the two boards visually mirrored (enemy top, hero bottom).

## 4. The event-log playback contract (battle scene)

`simulate()` returns `events: CombatEvent[]`. The battle scene walks them in
order, applying each to the view with a per-kind delay (`DELAYS` in
`BattleScene.ts`). **You render events; you never compute them.** The event
kinds you can rely on (see `src/engine/combat/events.ts` for exact shapes):

`comparison` (per-turn bank/speed/weight/score + performer) · `skillCast` ·
`damage` (amount, property, blocked, crit, matchup?, guarded?, hpAfter, source) ·
`heal` · `shieldGain` (property, amount, wasted, totalAfter) · `statusApplied`
(status, property?, turns, charges?) · `statusExpired` · `cleansed` · `slowedNext` ·
`staggered` · `shieldBroken` · `negated` · `suddenDeathStart` · `fatigueStart` ·
`died` · `combatEnd` (result, turns).

If you want to show something the log doesn't currently carry (e.g. an exact
value, a new flag), **request the field in the handoff doc** — Claude adds it to
the event in the engine; you then read it. (That's exactly how the negate
charge-count and `damage.guarded` fields were added.)

## 5. How to build UI here (patterns)

- **Widgets** are `Phaser.GameObjects.Container` subclasses (see `CardView`).
  Compose text/rectangles/images into a container; expose small methods
  (`setHighlight`, etc.). Reuse `CardView` for any card display.
- **New scene:** subclass `Phaser.Scene`, `super('Key')`, build in `create()`,
  register in `src/main.ts`. Read state from `demoState` (or, later, the run
  layer) — never from the engine internals.
- **Drag-and-drop** (see PrepScene): placement rules live in pure `src/run/loadout.ts`
  (`canPlace`, `clampSlot`); the scene computes the target slot arithmetically and
  calls those. Don't reimplement placement logic in the scene.
- **Tooltips/labels** pull from card/skill data + `theme.ts` glyphs. Card `text`
  is authored to a style guide (`docs/card-text-style-guide.md`) — render it as-is.

## 6. Future scenes (need the run layer — coordinate)

The run loop (map, shop, forge, draft, stat-sheet, main menu, run-over) isn't
built yet; its state lives in `src/run`/`src/meta` (Claude's, mostly TODO). You
can and should **design and scaffold these views**, but:
- Build the **view** against a small mock/stub of the state shape, and record the
  shape you assumed in the handoff doc so Claude can implement the real one to match.
- Keep them dumb: they render run-state and emit intent (e.g. "player picked node
  3"), they don't run mapgen/economy.
Design targets from the plan: **fog-of-war map** (see only the next areas in
detail, farther nodes vague), boss per zone, 3 lives, full-HP each fight.

## 7. Verify before you're done

1. `npm run build` — must pass (this is the real "does it compile & bundle" gate).
2. `npm test` — must stay green (you didn't touch tests, so this catches
   boundary violations and accidental breakage).
3. `npm run typecheck` — clean.
4. `npm run dev` and look at it. Screenshot if your tooling allows.
5. There's a Playwright smoke script (`scripts/smoke.mjs`) that drives
   prep → fight → end; the chromium path is machine-specific (bundled under the
   Playwright browsers dir). Use it if convenient.

## 8. UI / design backlog (pick from here; keep entries updated in the handoff)

**Polish (existing scenes):**
- Elevate the visual design of Prep and Battle beyond the current blocky
  prototype: real type scale, spacing rhythm, panel styling, card art treatment.
- Battle juice: hit shake, cast flash, crit emphasis, "super effective ▲ / resisted ▼"
  matchup callouts made punchier, damage-number choreography.
- Make the per-turn comparison math a clear, always-readable HUD element (it's the
  core teaching surface).
- Typed shield bars, status-icon row with countdown/charges, sudden-death banner —
  refine clarity and hierarchy.
- Prep: clearer aura-adjacency visualization, better drag ghosting/snap feedback,
  a board-PL / total-power readout, enemy affinity "weak to …" surfaced prominently.

**Scaffold (design + stub, coordinate state with Claude):**
- Main menu, run-map (fog-of-war), shop, forge, draft, stat-sheet, run-over screens.
- A shared HUD (lives, gold, depth) once the run layer exists.

**System:**
- Establish the type scale + spacing tokens in `theme.ts`.
- Responsive/safe-area checks at the 1280×720 FIT canvas.
- Optional: a lightweight settings toggle (playback speed persistence, etc.).

Always: only `src/game/`, keep it a dumb view, keep the build + tests green, and
log what you did.
