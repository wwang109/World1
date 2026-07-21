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
  type: Phaser.AUTO, width: 720, height: 1280, parent: 'app',
  backgroundColor: '#f6f0e7',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, PrepScene, BattleScene],   // add new scenes here
});
```
The design canvas is **720×1280 portrait**, scaled with `FIT` and centered.
Design phone-first. Do not add landscape layouts unless the target is a tablet
or a separate breakpoint is explicitly requested.

## 2. Scene inventory (current)

| File | Scene key | What it is |
|---|---|---|
| `src/game/scenes/BootScene.ts` | `Boot` | Tiny routing scene for local UI work. It reads URL params, resets `demoState`, and sends the app to `Prep` or `Battle`. |
| `src/game/scenes/PrepScene.ts` | `Prep` | Portrait out-of-combat hub with three main tabs: `Prep` (CHOOSE FIGHT — configure one or two enemies independently, including each enemy's level + rank + title (mob/normal/elite/boss) + reserved MODIFIERS slot, with the fight card showing each enemy's resolved skill list), `Deck Build` (hero-level stepper, active deck rail above the card bag, socket gems, drag cards between the 10-slot rail and 10-slot bag, and use one temporary transfer slot that returns its card when leaving the tab), and `Wiki`. Wiki has three header subtabs: `Cards` (ten-card catalog pages with tier preview, filters, copy counts, `+ BAG`, and card sheets), `Opponents` (reference-only eight-enemy pages with shared Level/Title/Card Tier scenario controls and resolved detail sheets), and `Template` (live Arcane Bolt preview using the approved fantasy card template with frame, tier, and dark-area controls). Opponent preview defaults to Level 1/Normal/Bronze, has no Auto tier, and CLEAR restores those defaults. Encounter configuration stays on Prep; Wiki browsing never changes it. The FIGHT action hands the exact hero/deck and ordered enemy setups to Battle. Fight scaling is resolved by `src/run/encounter.ts` (`buildEnemyEncounter`/`buildAutoHeroSetup`), never in the scene. The Prep loadout detail panel now shows the exact current deck being brought into the fight instead of an inspect prompt. |
| `src/game/scenes/BattleScene.ts` | `Battle` | Portrait deterministic combat board: player slots left, continuous paged turn log center, enemy slots right. It resolves the precomputed event log immediately; each page shows 10 turns, and tapping a turn highlights both queued skills (`ACTIVATED` versus `FAILED / SPEED BANKED`) while exposing the exact speed math. |
| `src/game/ui/CardView.ts` | — | Reusable card widget. It supports the larger board treatment plus smaller bag/wiki/combat card variants. Width = `size * SLOT_W`. |
| `src/game/ui/FantasyCardTemplate.ts` | — | User-approved full-card skill template for Wiki/card-sheet presentation. It renders the borderless full-art silhouette, tier WT plate, type/archetype icon stacks, `SLOT N` board footprint label, and tier-colored skill-text box from any `SkillDef`. Card art assets live in `public/game-art/cards/` and are attached through this file's `CARD_ART_KEY` map. The live builder/preview is the Wiki `Template` subtab (`?view=template`). Current card-art direction is Japanese/Korean anime TCG skill art: cel-shaded spell/weapon/relic objects, crisp linework, bold graphic VFX, saturated color, and a calmer lower third for text; avoid drifting into photoreal fantasy rendering. **Always reuse this file for new full-size skill-card presentations; do not generate, sketch, or create a separate card template.** |
| `src/game/ui/SkillDetailPanel.ts` | — | Shared inspector/detail panel used anywhere a clicked/hovered skill or gem should reveal authored details, and a summary mode for Prep's current-deck readout. |
| `src/game/theme.ts` | — | The design system (see §3). |
| `src/game/demoState.ts` | — | Mutable demo session state shared between scenes (the player's instance-owned `pieces`, ordered per-enemy `enemyTeam` configs, `seed`, current prep tab, 10 bag slots, mocked loose gem inventory, and hero setup). Every card copy has a stable `instanceId`, authored `skillId`, and per-copy `tier`; duplicate skills are valid while one instance may occupy only the bag or board. Each enemy config preserves its own id, level, rank, title, and reserved modifiers. Socketed gems return to `gemInventory` when an instance is unequipped. This is a stand-in until the run layer exists. |

## 2.5. Dev Launch Shortcuts

For screen-building work, prefer going straight to the target state via URL
instead of clicking through the hub every run. `BootScene` supports:

- `?view=prep` (alias: `?view=loadout`)
- `?view=deck-build` (alias: `?view=bag`)
- `?view=wiki`
- `?view=template`
- `?scene=battle`
- `?scene=multi` (two-enemy mobile sample: Giant Rat + Ember Imp)
- `?enemy=wolf_king`
- `?enemies=giant_rat,ember_imp` (with `?scene=battle`)
- `?seed=42`
- `?board=empty`

Examples:

- `http://127.0.0.1:4173/?view=prep`
- `http://127.0.0.1:4173/?view=deck-build`
- `http://127.0.0.1:4173/?view=wiki`
- `http://127.0.0.1:4173/?view=template`
- `http://127.0.0.1:4173/?scene=battle&enemy=bandit_duelist&seed=1`
- `http://127.0.0.1:4173/?scene=multi`
- `http://127.0.0.1:4173/?view=deck-build&board=empty`

Current reference screenshots are committed under `docs/screenshots/`, and
Claude-specific capture notes live in `docs/screenshot-howto.md`.

## 3. Design system (`src/game/theme.ts`)

**You are the design owner** — you may evolve this, but keep ALL visual constants
centralized here (never hardcode colors/sizes in scenes), and log system changes
in the handoff doc so Claude's summaries stay accurate.

Current palette (`UI`):
```
bg 0x07131d  panel 0x10202f  panelAlt 0x142738  panelMuted 0x0d1b28  slot 0x132536
playerCard 0x23384b  enemyCard 0x412e24  playsCard 0x122130  chip 0xc69948  border 0xb88a45
good/hp 0x7cab63  bad 0xc36a57  hpBack 0xcbb894  shield 0x5f83a6  text #ecd7a4  textDim #b89460
```
Semantic color keys (don't invent parallel ones — extend these):
- `PROPERTY_COLOR`: physical `#d98a3d` (orange) · magical `#5a8dee` (blue) · true `#e8d5a0` (gold-white). `PROPERTY_LABEL`: PHYS/MAG/TRUE.
- `ARCHETYPE_COLOR` / `ARCHETYPE_ICON`: offense ⚔ `#cc4444` · defensive 🛡 `#4a7ab5` · healing ✚ `#4caf6e` · support ♦ `#c9a227` · debuff ☠ `#9b59b6`.
- `ELEMENT_ICON`: fire 🔥 · frost ❄ · lightning ⚡ · nature 🌿 · holy ☀ · dark 🌑.
- `WEAPON_ICON`: sword 🗡 · axe 🪓 · lance 🔱 · bow 🏹 · beast 🐾.
- `STATUS_ICON`: poison ☠ · burn 🔥 · stun 💫 · buff ▲ · debuff ▼ · guard ⛨ · negate ⦵.
- `GEM_RARITY_COLOR`: common/rare/epic/legendary socket colors. Gems add
  uncapped bonus PL on top of the host card and should show both gem PL and
  host total PL in the inspector.

**Design language (baseline — elevate it, keep it coherent):**
- **Portrait, outlined, tactical.** The current direction uses a phone-first
  single column, thin bronze outlines, ornate corner brackets, restrained
  offset shadows, and gold selected states over a dark navy surface. Ordinary
  controls/cards sit at 1-2 px; stronger outlines are reserved for active
  highlights. Keep the screen usable at 720×1280 with no incoherent text
  overlap.
- **Type:** display text uses a humanist sans fallback and compact data uses
  monospace. The scale lives in `theme.ts`; do not add one-off scene font sizes
  unless the component needs a local exception.
- **Legibility of mechanics is the #1 design goal.** Readiness gain and spend
  (`readiness + Speed`, then `readiness - weight`), matchup advantage, shields, and durations
  must be readable at a glance — that's the game's core counterplay surface.
- **Motion/juice** (tasteful): cast highlights, hit shake, floating numbers,
  status pop/fade. Never let motion carry *meaning* that isn't also in the log
  (accessibility + the log is the source of truth).
- Spacing/layout: use the portrait bands in the current scenes; the board is a
  row of `SLOT_W`-wide cells. Enemy sits above the turn flow, hero near the
  bottom, with the log and inspector between.
- Shared frame language now lives in `src/game/ui/displayLibrary.ts`:
  `drawBackdrop()` provides the reusable dark backdrop and corner flourishes,
  `drawPanelShell()` draws the ornate section chrome, and
  `drawCompactTextBlock()` handles wrapped text blocks with overflow auditing.
  Header spacing for that shell is centralized in `DISPLAY_THEME.spacing`
  (`panelHeaderX/Y`, `panelAccentY`, `panelLineY`), so fight-card and tab chrome
  can be tuned without hardcoding scene-local offsets.

## 4. The event-log playback contract (battle scene)

`simulate()` returns `events: CombatEvent[]`. The battle scene walks them in
order and applies them as a read-only projection of the predetermined result.
**You render events; you never compute them.** The event
kinds you can rely on (see `src/engine/combat/events.ts` for exact shapes):

`gain` · `play` · `cost` · `cursor` · `busy` · `wait` · `end` · `skillCast` (compatibility) ·
`damage` (amount, property, blocked, crit, matchup?, guarded?, hpAfter, source) ·
`heal` · `shieldGain` (property, amount, wasted, totalAfter) · `statusApplied`
(status, property?, turns, charges?) · `statusExpired` · `cleansed` · `slowedNext` ·
`staggered` · `shieldBroken` · `negated` · `suddenDeathStart` · `fatigueStart` ·
`died` · `combatEnd` (result, turns).

Aura cards use an explicit `AURA` marker anywhere a card is shown. Their detail
view explains reach, filters, and modifiers from `SkillDef.aura`. On the current
combat contract, `play.auras` is the source of truth for contribution
credit in a cast row; render every supplied source and never infer aura effects
from board adjacency in the scene.

Active printed board auras remain visible in Battle through `AURA VIEW`, which
defaults on. The source card uses its element color when present (otherwise its
property color); reached cards use thin positive/negative edge markers. Turning
the view off hides persistent overlays only. Hovering an aura or selecting a log
row that credits one temporarily restores its exact source and reach. Aura source
names and modifier tokens in compact and selected log views use the same card
accent while signs and wording retain positive/negative meaning. Opponent-placed
aura lifecycle and timed card/unit effects remain blocked on Claude Request #8;
the UI must not infer those states before authoritative events exist.

The combat history is one continuous tagged event stream. Every living
combatant emits `gain` once per gameplay turn. The resolve loop then emits any
number of `play` + `cost` + `cursor` lines in true activation order, followed by
authoritative `busy`/`wait` reasons and `end`. Player lines are gold/green,
enemy lines are coral/red, and neutral turn boundaries are parchment. Selecting
a line highlights its exact referenced board card; no initiative or cooldown
state is inferred in Phaser.

Start-of-turn poison/burn damage is emitted before `gain` and renders as a
`PRE-TURN` row. The UI groups all combatants' `gain` events beneath one turn
heading and uses `baseSpeed`/`speedModifier`/`speed` to expose temporary Speed
effects without recalculating them.

Each `play` is one compact activation block: cast, effect/result, authoritative
damage calculation, readiness payment, and next cursor are grouped instead of
becoming separate timeline cards. `damage.calculation` supplies every displayed
term; `statusApplied.stat/pct/amount` supplies buff magnitude. Never rebuild a
damage formula from card or actor state in Phaser.

Battle playback advances one complete global turn at a time instead of applying
the full deterministic result immediately. Each step applies that turn's event
batch, reveals its new grouped log rows, updates board state, and selects the
latest row. Pacing is content-aware: at `1×`, rows enter 300 ms apart and the
next turn waits `800 ms + 300 ms per new row`, so effect-heavy turns remain
readable while simple turns move faster. The player can switch to `2×` or use
`TO END` to resolve the remaining deterministic events instantly without stale
delayed HP feedback. The result badge appears only when the `combatEnd`
event is reached. HP has separate logical and displayed values: damage/healing
tweens the visible bar and number on the matching grouped row's reveal delay,
while combat state continues to come directly from the event's `hpAfter`.
`suddenDeathStart` and `fatigueStart` are explicit red timeline steps, not only
temporary banners.

The selected-turn box is the expanded teaching surface above the log. It keeps
the selected action, result/readiness payment, and one authoritative math strip
separate. Flat damage reads `BASE + ATK/MAG + BUFF/FX - DEF ... = HP damage`
using `DamageCalculation.power` and the supplied integer terms.

Clicking a combat card opens an ownership-neutral card information sheet rather
than a tooltip: optional board-slot context, archetype/property tags, effective
weight/size/cooldown, total PL, authored card text, aura reach, and socketed gem
PL/text. Do not label cards as `YOUR CARD` or `ENEMY CARD`; this presentation is
designed for reuse in combat, Bag, and Wiki. The sheet blocks taps through to
combat and closes only from its X button or the dimmed outside area.

Every reusable Prep control routes its centered label through
`src/game/ui/controlLayoutAudit.ts`. The guard preserves minimum label padding,
stores an audit result on the control, and exposes strict visual checking through
`?layoutAudit=1`. Long text blocks that can overflow a fixed panel also route
through the same audit file so the app can flag clipped copy in strict mode.
Follow `docs/ui-spacing-audit.md` after changing buttons, chips, tabs,
steppers, modal controls, or any fixed-width text block; red outlines or
layout-audit console errors block handoff.

The Wiki filter uses a compact ledger sheet: one dark header band, one thin
outer frame, category labels and choices on the same row, and a single footer
rule above CLEAR/APPLY. Do not wrap filter rows in separate panels or return to
the previous tall stacked-label layout.

Timeline containers stay neutral. Meaning lives in the verb labels: readiness
blue, player play green, enemy play/hit red, wait amber, heal green, and neutral
boundaries dark. Visible rows reveal with one short staggered fade/slide on load
and page changes; selection and gameplay meaning never depend on animation.

The battle shell uses thin 1–2 px warm-brown outlines rather than heavy black
frames. Party surfaces are muted honey/sage, enemy surfaces soft coral/clay,
the log is warm parchment, and only semantic verbs/highlights use saturated
colors. Slot borders stay low-contrast so the ten-position structure remains
visible without turning the screen into nested boxes.

The ten board positions use the full available combat-lane height (84 px per
slot). Card names use the display face at 11 px bold, metadata is 9 px bold,
and empty-slot numbers are darker and larger so card placement remains legible
at phone scale.

Combat card faces expose their gameplay identity without inspection: up to two
archetype badges use the shared archetype colors, weapon/element labels use
their own semantic color maps and icons, and the footer states effective base
weight plus occupied slot count. The property strip remains the left-edge cue.

Combatant summaries use two compact stat lines: `ATK / MAG / SPD` and
`DEF / RES / CRIT`. `DEF` displays `armor`; `RES` displays `magicResist`.
Tapping either line opens the full combatant stat sheet.

The mobile multi-enemy sample keeps every enemy's live HP, readiness, and Speed
visible in the roster. The first enemy's full-width ten-slot board is selected
by default; tapping another roster chip or its log action swaps the focused
board and preserves exact card highlighting. Only one enemy rotation is visible
at a time, and the center log keys every row by `(side, unit)` so `E` and `E2`
remain distinct. Roster cards place `SPD` beside the name and use a larger bold
HP line beneath it.

If you want to show something the log doesn't currently carry (e.g. an exact
value, a new flag), **request the field in the handoff doc** — Claude adds it to
the event in the engine; you then read it. (That's exactly how the negate
charge-count and `damage.guarded` fields were added.)

## 5. How to build UI here (patterns)

- **Widgets** are `Phaser.GameObjects.Container` subclasses (see `CardView`).
  Compose text/rectangles/images into a container; expose small methods
  (`setHighlight`, etc.). Reuse `CardView` for any card display and
  `SkillDetailPanel` for card-detail reveal.
- Shared display chrome now has a reusable theme/token layer in `src/game/theme.ts`
  plus a small panel/text library in `src/game/ui/displayLibrary.ts`. Prefer
  those helpers for new panels, compact text blocks, and repeated stat/list
  displays before duplicating scene-local chrome.
- **New scene:** subclass `Phaser.Scene`, `super('Key')`, build in `create()`,
  register in `src/main.ts`. Read state from `demoState` (or, later, the run
  layer) — never from the engine internals.
- **Drag-and-drop** (see PrepScene): placement rules live in pure `src/run/loadout.ts`
  (`canPlace`, `clampSlot`); the scene computes the target slot arithmetically and
  calls those. Don't reimplement placement logic in the scene.
- **Click-to-inspect** is now part of the baseline interaction model. If a skill
  is visible, the user should be able to reveal its authored text and stats via
  the shared detail panel.
- **Aura presentation** lives in `ui/skillPresentation.ts`; use its shared
  labels/formatters instead of calling an aura "passive." The target readiness
  model treats aura cards as valid plays, so `AURA` is the future-safe role.
- **Gem socketing** is view-only over `src/run/loadout.ts`: socket badges on
  board cards open a gem picker, then call `socketGem`, `swapGem`, or
  `unsocketGem`. Demo loose gems live in `demoState.gemInventory` until Claude
  replaces them with real run inventory.
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
4. `npm run dev` and look at it at 720×1280. Screenshot if your tooling allows.
   Shortcut: use the query-parameter launcher above to jump directly to the
   screen you are styling.
5. There's a Playwright smoke script (`scripts/smoke.mjs`) that drives
   prep → fight → end; the chromium path is machine-specific (bundled under the
   Playwright browsers dir). Use it if convenient.

## 8. UI / design backlog (pick from here; keep entries updated in the handoff)

**Polish (existing scenes):**
- Elevate the visual design of Prep and Battle beyond the current blocky
  prototype: real type scale, spacing rhythm, panel styling, card art treatment.
- Battle juice: hit shake, cast flash, crit emphasis, "super effective ▲ / resisted ▼"
  matchup callouts made punchier, damage-number choreography.
- Make readiness gain, card cost, and remaining readiness a clear HUD element (it's the
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
- Responsive/safe-area checks at the 720×1280 FIT canvas.
- Optional: persist the selected battle playback speed between fights.

Always: only `src/game/`, keep it a dumb view, keep the build + tests green, and
log what you did.
