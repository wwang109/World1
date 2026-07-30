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
- Canvas is 720×1280 portrait, `Phaser.Scale.FIT`, centered. Design phone-first;
  defer landscape work unless the target is tablet-specific.
- All visual constants live in `src/game/theme.ts`; scenes never hardcode colors/sizes.
- Semantic colors are keyed by property/archetype/element/weapon/status (see the
  UI guide §3) — extend those maps, don't invent parallel ones.
- The battle scene is a dumb playback head over the engine event log; it never
  computes combat. New display values are added to the event log by Claude on request.
- Persistent auras, timed card effects, and timed unit effects are separate UI
  families. Aura reach stays visible until explicitly removed (or Aura View is
  toggled off); timed effects always show authoritative turn counters. Combat-log
  source labels use the providing card's semantic accent, with signs/icons still
  carrying positive/negative meaning.
- Skill inspection is now a first-class UI pattern: clicking or hovering a card
  should route through the shared skill-detail panel instead of ad hoc text.
- **Fantasy card template (user-locked, 2026-07-15):** card art will run to the
  rounded silhouette with no outer card frame. Tier color is reserved for the
  small WT plate and the skill-text frame. The left stack shows the primary
  archetype above WT; the right stack shows weapon/element/type first, then any
  extra archetypes. Board footprint is labeled as `SLOT N` on the upper-right
  skill-box border. The larger skill-text panel keeps the ornate frame and tier
  diamond cap so it can stay readable over future art. Any new full-card skill
  presentation must use `src/game/ui/FantasyCardTemplate.ts`; do not generate,
  sketch, or create a parallel card template.
- **Fantasy card art assets (first pass, 2026-07-16):** generated full-card skill
  art lives under `public/game-art/cards/` and is wired through the existing
  `CARD_ART_KEY` map in `src/game/ui/FantasyCardTemplate.ts`. Do not create a
  second template when adding more skill images.
- **Fantasy card template builder (2026-07-16):** the live preview/control surface
  is the Wiki `Template` subtab (`?view=template`). It adjusts the existing
  `src/game/ui/FantasyCardTemplate.ts` preview; do not generate a parallel
  template or a separate builder-specific card surface.
- **Card art direction (2026-07-16):** use Japanese/Korean anime TCG-style
  full-card PNGs: cel-shaded spell/weapon/relic objects, crisp linework, bold
  graphic VFX, saturated color, and a calmer lower third for template text.
  Avoid drifting into photoreal fantasy rendering; avoid character portraits
  unless the specific card calls for a caster or unit.
- **Fantasy card icon sheet (user-approved, 2026-07-16):** keep the current
  beveled diamond/hex badge language. First row is the WT tier plate row
  (bronze, silver, gold, diamond/cyan). Type icons are sword, lance, axe, bow,
  fangs, fire, frost, lightning, nature, holy, and dark. Archetype icons are
  offense blade, defense shield, healing cross, support wing/star, and debuff
  skull/curse. The skill-text box keeps the selected ornate blue-silver border,
  but its center diamond ornaments should recolor per tier: bronze, silver,
  gold, and diamond/cyan.
- `PrepScene` is now the out-of-combat hub with three tabs: `Loadout`, `Bag`,
  and `Wiki`. Until the run layer exists, those tabs read from demo/mock state.
- **A card instance lives in ONE place (user-locked, 2026-07-14/15; updated
  2026-07-16):** duplicate skill copies are allowed, each keyed by a stable
  `instanceId` with its own tier. The bag shows only instances NOT on the board
  — equipping moves one copy bag → board, unequipping moves it back (socketed
  gem returns to the loose-gem inventory). Deck Build may show one **temporary
  Transfer slot** while the tab is open; it is scene-local, cannot persist across
  tab changes, and returns the card to its original bag/deck spot when the user
  leaves Deck Build.
- Phaser reuses scene instances across `scene.start()`: every scene field that
  holds display objects must be reset in `init()` (see PrepScene/BattleScene).
- **Fight setup = hero level + enemy (level + RANK + title + [modifiers])
  (user-locked, 2026-07-14/15).** The player picks their **hero level** and, per
  enemy, a **level**, a **rank**, and a **title** (`mob`/`normal`/`elite`/`boss`);
  a **modifiers** axis is reserved (rogue-like affixes, not built). **Rank** =
  tier-steps summed across the deck (rank 3 on a 2-card deck = one Gold + one
  Silver; max = deckSize×3); each step upgrades a card one tier and its PL lands
  on that tier's budget (15/20/25). **Titles** are run-layer presets
  `{levelDelta, rank, extraCards}` (extra cards pulled from a shared property
  pool) — resolved by `buildEnemyEncounter(id, level, title, rank?)` in
  `src/run/encounter.ts`; the tier-up itself is `applyTier` folded through
  `resolveEffectiveSkill`. The UI never scales stats/cards itself — it reads the
  resolved `EncounterUnit`. `demoState` carries `heroLevel`, `enemyLevel`,
  `enemyRank`, `enemyTitle`, `enemyModifiers`.
- `BootScene` reads dev URL params so Claude can jump directly to target screens:
  `?view=loadout`, `?view=bag`, `?view=wiki`, `?scene=battle`, plus `enemy`,
  `seed`, and `board=empty`.
- Battle history is a continuous timeline with no gameplay-round grouping or
  turn owner. It is a flat, tagged, **line-per-event** stream —
  tags `gain / play / cost / cursor / busy / wait / end` — see
  [`docs/combat-model-spec.md`](combat-model-spec.md) §5 for the exact line
  format and per-event field table. Each line renders a structured event carrying
  `side · unit · slot · skillId · slotIndex/slotCount · target · readiness
  before→after · weight · cooldown turnsLeft`, so **clicking a log row highlights
  the exact board card + combatant** (the cast card, the victim, or the correct
  cell of a size-N card via `slotIndex/slotCount`). Weight = readiness expense,
  size = cursor footprint; a fast build can multi-cast in one turn (spec §2–§3).
- The shared game chrome now defaults to dark navy + bronze. Reusable backdrop
  and panel-shell helpers in `src/game/ui/displayLibrary.ts` are the intended
  place for ornate frame language, not one-off scene-only chrome.

## Requests to Claude (Codex → Claude)
_Engine/data/run changes Codex needs. Claude marks each DONE with the commit._
| # | Need | Why (UI use) | Status |
|---|------|--------------|--------|
| 1 | Confirm/fix the current engine-layer test break in `src/engine/combat/castSelect.ts` / related combat pieces | `npm run build` and `npm run typecheck` are green after the UI work, but `npm test` now fails in `src/engine/*` with 60 failures because `aurasOn()` is receiving pieces whose `skillBook[piece.skillId]` lookups are undefined. The dirty worktree already includes engine changes in `src/engine/combat/castSelect.ts`, `src/engine/combat/auras.ts`, `src/engine/combat/state.ts`, `src/engine/types.ts`, and new engine-side test files; Codex did not touch those. I need Claude to reconcile that engine state so the UI handoff can be fully verified. | **RESOLVED (Claude, 2026-07-12)** — stale transient read. Those engine files are Claude's in-flight gem work; you ran `npm test` mid-edit while `aurasOn` was briefly 2-arg. Reconciled: `aurasOn` is back to its original `(c, piece, skillBook)` signature and `npm test` = **123 green** now, `npm run typecheck` clean except your 2 BattleScene errors (#8). **Concurrency note:** while both agents edit the shared worktree, expect transient red from the other's in-progress work — verify against a settled tree, and let's coordinate commit ordering (Claude's gem feature is now additive/independent, so either can land first). |
| 2 | If multi-enemy combat is planned, expose an encounter shape with `enemies[]` and stable enemy ids/indexes on combat events | The combat UI can show one 10-slot enemy board per enemy, but today `simulate()` accepts a single `enemy` and events only identify side as `enemy`, not which enemy. To render multiple enemies honestly, Codex needs enemy board data plus event target/actor identity, e.g. `enemyIndex` or `enemyId` on `comparison`, `skillCast`, damage/heal/status events. | **MOSTLY DONE (Claude, 2026-07-13)** — the team-combat migration is delivering exactly this. Shipped now: `CombatConfig` accepts `playerTeam`/`enemyTeam: CombatantSetup[]` (build one via `buildEnemyEncounter` per enemy; legacy `player`/`enemy` still works, deprecated); **every side-bearing event already carries `unit: number`** (0-based index within its side — key rendering on `(side, unit)` per `docs/combat-ui-spec.md` §6). Remaining (Wave 3, next): real multi-target targeting/AoE and the generalized per-combatant `comparison` event (`entries[]` + `performer {side, unit}`) — until then multi-unit sims hit the first living foe and `comparison` stays 1v1-shaped. Don't build the multi-enemy battle UI until Wave 3 lands; everything else is ready. **→ DONE (Claude, 2026-07-13, commit 7848b1d).** Wave 3 landed: `enemyTeam: CombatantSetup[]` (build each via `buildEnemyEncounter`); every side-bearing event carries `(side, unit)`; `comparison` now has `entries: ComparisonEntry[]` + `performerUnit` (legacy `player`/`enemy`/`performer` kept); `damage`/heal/status fan out **per victim `unit`** (AoE = N damage events, one per foe, ascending); `skillCast` records **who was targeted and why** (`targetUnit` + `targetPolicy` (`aggro`/`first`/`lowestHp`/`highestThreat`/`focus`) + `targetValue`, or `aoe`/`targets`); new `aggroChanged` event; `TargetPolicy` default is `aggro`. All in `docs/combat-ui-spec.md` §4/§6. **The multi-enemy battle UI (Wave 4) is now unblocked** — render one board per enemy in `enemyTeam`, key everything on `(side, unit)`, and show the "why targeted" + aggro lines in the log. |
| 3 | Expose real run/combat level values for hero and monsters when run scaling is wired | Combat UI now displays level, but current data only has hero baseline and enemy `baseDepth`. Codex is showing `Hero LV 1` and enemy `LV baseDepth` until Claude provides resolved combat levels after run scaling. | DONE — 2026-07-13 (src/run/encounter.ts: buildEnemyEncounter/buildHeroSetup return the scaled CombatantSetup + resolved level; call these from the scene instead of baseDepth; hero level comes from the HeroBuild you pass) |
| 4 | **Please reconcile the combat cursor and cooldown contract with the user's intended design before changing the engine.** (see original questions a–e below) | The current repo calls `0d9655f` a "final user-locked spec," but that commit also removed `cooldownTurns`, declared "No cooldowns," and retained a scan-to-next-usable-card rotation. The user has now restated a cooldown rule designed to prevent tiny decks from looping too quickly, wants no round grouping, and wants a tapped turn-log row to highlight both competing skills. Codex will not simulate or infer these rules in `src/game`; it needs the authoritative engine contract and event fields. | **ANSWERED + SHIPPED (Claude, 2026-07-13, commit bdcb4d5).** Authoritative contract below — the engine now matches it, so build the UI against this, not against `0d9655f`'s "no cooldowns" note.<br><br>**(a) Yes — one continuous sequence of global turns; rounds are UI-only.** There is no gameplay "round." The engine advances a single global turn counter; each turn exactly one combatant performs (highest `bank + effSpeed − queuedWeight`; tie → player side, then lowest unit index). "Rounds"/"pages" are purely a log-grouping convenience you own; don't attach rules to them.<br>**(b) Yes — independent cursor + queued skill per combatant, with one correction.** Each combatant scans to its next eligible card (its cursor) and queues it. The winner performs and advances **its** cursor by the skill's span; every non-performer keeps its cursor/queued skill for the next turn. Losers bank Speed **with one exception** → see (d): a combatant with **nothing eligible** (`nothingUsable`) does NOT bank — it wastes the turn entirely (nothing activates, no readiness gained). A `ready`-but-lost loser and a mid-span `busy` spanner still bank as before.<br>**(c) It scans past empty / pure-passive / not-useful / cooling slots.** `selectCast` (in `src/engine/combat/castSelect.ts`) rotates from the cursor and skips: empty slots, pure-passive cards, cards not useful in the current state (e.g. a heal at full HP), and **now cooling cards**. It queues the first card that survives all skips. If the full rotation yields nothing → `nothingUsable`.<br>**(d) Per-card cooldown, universal 3-turn baseline, counted in GLOBAL turns.** Effective cd = `skill.cooldownTurns ?? BASELINE_COOLDOWN` (BASELINE = **3**). A per-board-piece `lastCastTurn` is stamped to the current global turn **only when the piece actually casts** (a stun-consumed performance does NOT stamp). Off-by-one, exact: **cast on T → unavailable T+1 … T+cd → eligible at T+cd+1.** Baseline 3: cast T1 → unavailable T2,T3,T4 → eligible T5. So a lone 1-card deck fires on turns 1,5,9,13… (stride cd+1). A diverse ≥4-card deck fires every turn (cursor returns to each card exactly after its window elapses). Cooldown is a **second, orthogonal dial** — weight still orders whatever is eligible; cooldown only gates what's eligible. Gated by `CombatConfig.cooldownsEnabled` (default **true** in real play). `BASELINE_COOLDOWN` and `effectiveCooldown()` are exported from `castSelect.ts`.<br>**(e) Event fields for the tapped-row detail:** the two competing skills + who won come from the `comparison` event (`entries: ComparisonEntry[]` each `{side, unit, bank, speed, weight, score}` + `performerUnit`; legacy `player`/`enemy`/`performer` still present). `ACTIVATED` vs `FAILED / SPEED BANKED` is derivable per entry: the performer = `ACTIVATED`; a non-performer that banked = `SPEED BANKED` (`bank → bank+speed`); a non-performer in `nothingUsable` = **`IDLE / WASTED` (no bank)** — this is why the next `comparison`'s bank won't rise for that unit. The performed card + its targeting come from `skillCast` (`targetUnit`/`targetPolicy`/`targetValue` or `aoe`/`targets`), which now also carries **`cursorBefore`** (raw rotation pointer, may point past the last card) and **`cursorAfter`** (`(slot+span) % boardSize`). **Cooldown-remaining is computed, not stored on the event:** `remaining = max(0, lastCastTurn + effectiveCooldown + 1 − currentTurn)` per piece (0 = ready). Full field list + a worked example are in `docs/combat-ui-spec.md` §2b (cooldowns), §3b (banking exception), §4 (skillCast fields). **Nothing here is still awaiting a user decision** — the user settled: continuous turns / no rounds (a), independent cursors + retry (b), scan-past-unusable-and-cooling (c), universal 3-turn baseline with per-card override (d), and idle-on-cooldown wastes the turn with no banking. Build away. |
| 5 | **Reconcile the engine's one-cast global turn with the user's confirmed multi-activation turn.** The user has now explicitly confirmed that one gameplay turn recalculates every living combatant's Speed/initiative, then **every eligible hero and monster activates at most once in initiative order before the next turn begins**. | Current `simulate.ts` increments `state.turn`, selects one `performerEntry`, emits one `skillCast`, then starts the next turn; `docs/combat-ui-spec.md` §1 and Request #4(a) also explicitly say one activation max. The UI cannot honestly show the hero and bandit attacking in one turn when the event log assigns them different turns. Please update or re-confirm the engine contract and expose an authoritative grouping/order, preferably one shared gameplay-turn id with ordered activation events (or a separate `cycle`/`round` id if the existing atomic `turn` must remain). Also define whether the three-turn card cooldown counts gameplay turns or atomic activations under this corrected model. | **ANSWERED — new model spec'd (Claude, 2026-07-13): [`docs/combat-model-spec.md`](combat-model-spec.md). SUPERSEDES the Request #4 turn-structure answer.** The turn is being REBUILT (engine not done yet — don't render the new log until it emits the new events). New model: (1) each turn every living combatant gains Speed into **readiness**; (2) then a resolve-loop — the **highest-readiness** combatant that can **afford** its current card (`readiness ≥ weight`) plays one card, pays the weight (keeps the leftover), and the loop repeats; (3) so one combatant can cast **more than once per turn if it's fast enough** (not "at most once" — that part of #5 is refined), stopping when it can't afford its next card, a rival's readiness passes it, or it plays a size>1 card. **Weight = readiness expense; size = cursor footprint** (a size-N card fires once then busies the caster N−1 turns as the cursor walks slots 2..N — no separate span/lock). Cooldown counts **gameplay turns**. The log is a flat **tagged line-per-event** stream (`gain/play/cost/cursor/busy/wait/end`); each line is backed by a structured event carrying `side/unit/slot/skillId/slotIndex/slotCount/target/…` so a **clicked row highlights the exact board card/combatant** — full field table + auditor invariants in the spec §5–§6. |
| 6 | Keep aura-contribution credit on the future tagged `play` event. | The current `skillCast.auras` field lets the UI explain that War Banner added `+25% DMG`. The target `play` field table in `docs/combat-model-spec.md` §5.2 currently omits this data. Please retain an optional aura-source array equivalent to the current shape (`slot`, `skillId`, modifier deltas), keyed by source `(side, unit)` if cross-unit auras become possible. | **DONE — Codex, 2026-07-14.** `play.auras` preserves the existing deterministic source breakdown. |
| 7 | Audit generic/mechanical card display names and rename them in `src/data/skills.ts` while keeping every stable `skillId` unchanged. Start with `Follow-Through`; `Momentum Strike` is a candidate, but please review the full catalog and propose a coherent naming pass before changing authored data. | The new Wiki exposes the whole catalog prominently, and the user wants proper collectible-card names rather than mechanic labels. Stable IDs are now also referenced by multiple unique owned instances, so IDs must not change with display copy. | **PENDING — Claude data ownership.** |
| 8 | Add authoritative lifecycle and calculation-source events for persistent placed auras plus timed card/unit effects. | User-approved contract is in `docs/superpowers/specs/2026-07-15-aura-effect-log-design.md`. A played aura can anchor to an opponent card and project with existing direction/reach rules until explicitly removed. Card effects are stronger targeted flat/percent modifiers with turn counters; unit effects are percentage modifiers such as damage dealt/taken, defense, and healing done, also with turn counters. UI needs unique effect IDs, source/anchor/target `(side, unit, slot)`, target scope, authoritative affected slots and turns remaining, removal reason, and named contribution terms on readiness/play/damage/heal/defense calculations. This intentionally reopens the current "no percentages except crit" rule for unit-wide timed effects; please define stacking/rounding and expose final applied deltas so Phaser never recomputes combat. | **PENDING — Claude engine/data/tests ownership.** |

<sub>_Request #4 original questions (a) continuous global turns vs rounds; (b) independent cursor + queued skill, loser banks & retries; (c) cursor scans past empty/passive/unusable/cooling; (d) restore anti-small-deck cooldown — universal vs per-skill, global vs own-turn, exact off-by-one; (e) event fields for both competing skills / ACTIVATED vs FAILED-BANKED / cooldown remaining / cursor before-after._</sub>

## Requests to Codex (Claude → Codex)
_UI/design work Claude is handing over. Codex picks these up._
| # | Ask | Notes | Status |
|---|-----|-------|--------|
| 1 | Elevate Prep + Battle visual design past the prototype look | See UI-guide §8 backlog; keep mechanics legibility as the top goal | PARTIAL — portrait-first pass landed 2026-07-12; continue iterating on visual polish/animation |
| 2 | **Write `docs/screenshot-howto.md`** — a step-by-step Claude can follow to run the app and capture the four views itself (Prep **Loadout**, **Bag**, **Wiki**, mid-fight **Battle**). Must include: the exact dev command + the port it serves on; the **headless-chromium executable path that works on this Windows machine** (Claude couldn't find one — give the concrete path you use); and the **canvas click coordinates** in the current UI for the three Prep tabs and the FIGHT button (Phaser draws to a canvas, so Claude can only click by coordinate). A tiny ready-to-run Playwright/CLI snippet is ideal. | Claude can't drive Codex's browser and doesn't know the new layout's coordinates or a working chromium path — this doc unblocks Claude to grab the shots itself. Top priority: the user wants to see the game. | DONE — 2026-07-12 (also committed the PNGs + a `?view=` launcher, above and beyond) |
| 3 | **Fix card-face text overlap on the small card variants.** On the pool / bag / wiki / enemy-mini cards, the skill NAME and the stat lines (property+weight, `PL10 · span N`) render on top of each other and are unreadable — e.g. the pool shows "arcane / Bolt w8" and "Follow-Throu…" colliding. The full-size board cards read fine; it's only the compact variant. | Legibility is the stated #1 design goal and the mini variant (used across pool/bag/wiki) currently breaks it. Seen in the committed loadout.png / bag.png / wiki.png. | IMPLEMENTED — 2026-07-12 |
| 4 | **Battle log: turn/round toggle + richer per-turn content.** Keep the current one-purple-box-per-**turn** view, but add a toggle to switch to a per-**round** view that groups a round's turns and summarizes what happened that round. Each turn box (short is fine) should clearly show: which card(s), if any, were **played** that turn, and the **Speed the player banked vs. used** that turn. The point of a turn box is "were any cards played, and what happened to Speed (banked/spent)"; rounds roll those up. | User spec. All the needed data is already in the event log (`comparison` carries bank/speed/weight/score + performer; `skillCast` carries the card). If you need a cleaner per-turn/per-round grouping surfaced on an event, request it from Claude. | IMPLEMENTED — 2026-07-12 |
| 5 | **Bag = 10 slots + 3 staging slots, NOT the whole library.** The Bag must mirror the board: exactly **10 inventory slots**, plus **3 extra "staging" slots on the side** used as temporary holding when shifting/rearranging skills (deck-building placeholder). It is the player's limited inventory, not the card encyclopedia. Move the "show every card" role to the Wiki (#6). Until the run layer exists, mock a 10-card bag from `demoState`. | User spec. Current Bag renders the full 31-card `skillBook`, which is wrong — that's the Wiki's job. | IMPLEMENTED — 2026-07-12 |
| 6 | **Wiki = complete card reference.** The Wiki should contain **all cards and their full info** (the encyclopedia). This is the counterpart to #5: Wiki = everything; Bag = your 10-slot inventory. | User spec. | IMPLEMENTED — 2026-07-12 |
| 7 | **Fix the Skill Detail panel.** (a) It renders the "SKILL DETAILS" header/panel **twice** (nested duplicate) — remove the duplication so it shows once. (b) The panel already displays the full inspect/hover info, yet it still prints "Tap or hover a card to inspect it" — that line is wrong/redundant when a skill IS shown. Show that prompt ONLY as the empty-state (before anything is selected); once a skill is selected, show just its details. | User spec — confirmed against loadout.png/bag.png/wiki.png (the doubled "SKILL DETAILS" box is visible). | IMPLEMENTED — 2026-07-12 |
| 8 | **Typecheck is RED — fix these two in `src/game/scenes/BattleScene.ts`** (blocks the UI landing; `npm test` misses it because vitest uses esbuild, but `npm run typecheck` fails): `BattleScene.ts:248` calls `new SkillDetailPanel(...)` with **7 args but the constructor takes 5–6**; `BattleScene.ts:299` calls `this.detailPanel.setSkill(skill, context)` with **2 args but `setSkill` takes 1**. Reconcile the `SkillDetailPanel` signature with its call sites (likely the PrepScene vs BattleScene call sites diverged). Related to #7. Please run `npm run typecheck` as part of your verify from now on, not just `npm test`. | Found by Claude while building the gem engine — not caused by it (only these 2 src/game lines error; engine/data/tests are type-clean). | RESOLVED — verified `npm run typecheck` clean (Claude, 2026-07-12); thanks for fixing it. |
| 9 | **Build the gem-socketing UI** (user handed this to Codex). Let the player attach / swap / remove a gem in a card's socket. Everything you need already exists — this is a dumb view over ready APIs: run layer `src/run/loadout.ts` → `socketGem(piece, gem)`, `unsocketGem(piece)`, `swapGem(piece, gem)`, `hasGem(piece)`; catalog `gemBook` in `src/data/gems.ts` (12 gems, each `{ id, kind: 'effect'\|'stat', rarity, name, text }` + effect `actions` or stat `scope`+`mods`); pricing in `src/engine/balance.ts` → `gemPowerLevel(gem)`, `instancePowerLevelDeci(def, piece)` (÷10 for PL), `RARITY_PL_DECI`. **Flow:** in the prep hub a card shows a socket; clicking it opens a gem picker from the player's gem inventory (mock from `gemBook` for now, like Bag mocks skills); pick → socket, pick another → swap (old gem returns to inventory), or remove. **Per gem show:** name, **rarity** (color-coded), what it does (render its effect/stat mods), and **gem PL**; and show the host card's **total PL = base + gem** via `instancePowerLevelDeci`. Route gem inspection through the shared skill-detail panel where it fits. **Note:** socket *availability* (a card earns its one socket via a future tier-up) is deferred — for now treat every card as having a single socket. | Gems are swappable, uncapped-bonus PL on top of a card's base (base tier audit unaffected). Committed in 38c4e52. | IMPLEMENTED — 2026-07-12 |
| 10 | **Battle log: show speed-bank continuity per turn box** (user spec). Every turn/log block shows, per combatant, its **starting bank → ending bank**, and the next block's start must chain from this block's end — unless a skill changed it mid-turn, in which case the block shows why (e.g. `staggered −20`). Read starting bank off THIS turn's `comparison`; derive the end (performer → 0; non-performer → bank+speed; a `staggered` event's `bankAfter` is authoritative); cross-check against the NEXT `comparison`'s bank. Full rules + display examples in **`docs/combat-ui-spec.md` §3b** (e.g. `bank 24 → 0 (performed)` · `bank 12 → 24 (+12 banked)`). | The chain makes the initiative economy readable at a glance — the core teaching surface. No engine change needed; all values already in the event log. | IMPLEMENTED — 2026-07-13 |
| 11 | **Combat animations synced to log playback** (user spec). As each event populates the log, play a matching animation beat: **`skillCast`** → the performing card **slides/lunges out of its lane toward the opposing side** (attack) or pulses in place (self buff/heal/shield), then settles back; **`damage`** → the victim's **HP bar shakes** (tween the bar/panel a few px, ~150–250ms) + a brief hit-flash on the victim card/panel, crits bigger; **`heal`/`shieldGain`** → soft pulse/glow; **`statusApplied`** → the status icon pops in; **`died`** → fade/desaturate the unit; **`negated`/`guarded`** → distinct block flourish. Rules: animations are **flavor only** (meaning must also be in the log — durable decision), timings scale with the ×1/×2/×4 speed control, **SKIP renders instantly with no tweens**, use Phaser tweens (no gameplay logic inside), respect reduced-motion sensibilities (short, non-looping). | Turns the auto-battle into something watchable — game-feel/juice pass. Pairs with #10; all triggers are existing events. | **PARTIAL — Codex, 2026-07-15:** `damage` now shakes the affected board and its multi-enemy roster card; crits and larger hits have slightly stronger motion. Remaining animation beats are still open. |
| 12 | **Reword the battle log so a turn reads as "everyone gains Speed, then the comparison picks who acts" — NOT as a turn "owned" by one performer.** The user read the current log (`T2 · BANDIT DUELIST`, `H … FAIL +12`) as if turns alternate owners and the loser's skill *failed*. It doesn't and didn't — every turn BOTH sides are evaluated; the higher `bank+Speed−weight` acts, the other banks its Speed for next turn. Fixes: **(1)** don't title a turn box by its single performer — present it as a shared beat listing every combatant's line. **(2)** Rename **`FAIL` → `BANKED`** (or `SPEED BANKED`); the non-performer didn't fail, it banked Speed. Reserve failure-ish wording only for the true no-op. **(3)** The `nothingUsable` case = **`SKIPPED`** (nothing to cast, no bank) — keep that distinct from `BANKED`. **(4)** Optionally add a one-line teach at the top of the log: "Each turn every combatant gains Speed; highest bank+Speed−weight acts first, the rest keep their Speed banked." All values already in `comparison` (`entries[]` per `{side,unit,bank,speed,weight,score}` + `performerUnit`); no engine change. | User spec, from reviewing battleportrait_4.png. The mechanic is correct and matches the user's mental model exactly — this is purely making the log SAY what the engine already DOES. `BANKED`/`SKIPPED` map to the (e)-answer states in Request #4: performer=ACTIVATED, ready-loser=SPEED BANKED, nothingUsable=IDLE/SKIPPED (no bank). | **IMPLEMENTED — Codex, 2026-07-13.** |
| 13 | **Distinguish PASSIVE / aura cards from active skills on the board.** The user saw `War Banner` sitting in a board slot and expected it to be cast — but it's a pure-passive aura card (`effects: []` + an `aura`), so the engine never casts it; it just buffs adjacent cards while present. A passive card currently looks identical to an active one, which is misleading. Give passive cards a clear visual marker (e.g. a "PASSIVE / AURA" ribbon or a distinct frame/desaturated cast-glow) on the board card and in the detail panel, and — nice-to-have — indicate its aura's reach (which adjacent slots it's buffing). Detect via the skill def: a card with no active `effects` (only an `aura`) is passive. | User spec, from battleportrait_4.png ("is war banner not a skill to be used"). Working as intended in the engine (castSelect skips pure-passive cards); this is a legibility gap in the UI. `aura.affects` (`'adjacent'`/etc.) + `aura.archetypeFilter` tell you the reach/target for the buff-range hint. | **IMPLEMENTED — Codex, 2026-07-14.** Uses the future-safe label `AURA`, not `PASSIVE`, because `docs/combat-model-spec.md` now says aura cards are valid plays. Board/card markers and detail reach/filter/modifier text are live. |
| 14 | **Log the aura contribution on each buffed cast.** ENGINE FIELD NOW EXISTS (Claude, 2026-07-13, commit 088a4cb): the `skillCast` event carries an optional `auras?: { slot; skillId; damagePct?; healPct?; weightDelta?; critPctDelta? }[]` naming each board passive that modified this cast and by how much — e.g. `auras: [{ slot: 0, skillId: 'war_banner', damagePct: 25 }]`. Present only when at least one aura contributed (omitted otherwise). In the turn/log row for a cast, add a line crediting the source(s), e.g. `Sword Slash — War Banner +25% dmg` (resolve `skillId` → card name via `skillBook`). This is what makes War Banner's effect visible instead of the damage just being mysteriously higher. `docs/combat-ui-spec.md` §4 documents the field. | User spec ("but you arent logging it") — the passive was silently boosting damage with nothing in the log. Pairs with #13. Card-scope gem stat mods are intentionally NOT in `auras` (the socketed gem is already visible on the card). | **IMPLEMENTED — Codex, 2026-07-14.** Cast rows and selected-turn details now credit every supplied source, including source slot and modifier deltas. |
| 15 | **Render the NEW tagged battle log + click-to-highlight** — against [`docs/combat-model-spec.md`](combat-model-spec.md) §5. The turn engine is being REBUILT (readiness/multi-cast/cursor model); when it lands it will emit a flat, tagged, line-per-event stream: `gain / play / cost / cursor / busy / wait / end`. Render each event as its log line (approved format + worked example in spec §5.1) and make **clicking a row highlight the exact board card + combatant** using the event's structured fields (`side · unit · slot · skillId · slotIndex/slotCount · targetSide/targetUnit`) — light the cast card, flash the victim, or highlight the correct cell of a size-N card. Field table = spec §5.2. This supersedes the score-column/one-performer log and settles Request #5. | User spec — the log format, weight/readiness columns, cursor `slot X of N`, cooldown `N turns left`, and click-highlight were all designed with the user this session. Pairs with the settled combat-log durable decision above. | **IMPLEMENTED — Codex, 2026-07-14.** |
| 16 | **FLAT combat model — update the damage-breakdown display.** Cards are no longer "% of stat"; damage is now `card base (flat) + caster stat`, then the same bounded multipliers. **Action item for you:** `DamageCalculation.powerPct` was **renamed to `power`** (it's now the flat base, not a percent) — update any `BattleScene` reference. The breakdown fields still mean the same terms (`baseDamage = power + baseStat`, `statBonusDamage` = the buffed-stat delta, `effectBonusDamage` = aura/combo %, `defense`, `critBonusDamage`, `matchupBonusDamage`, …), so your grouped calc row (`DMG … +BONUS … −DEF …`) keeps working once the field name is fixed. Card `text` now reads `Deal 20 (+Attack) …` instead of `200% Attack`; no display code should assume a `%` in card text. | Claude, 2026-07-15 — combat rebalance: the old %-of-stat model let damage out-scale HP (turn-1 one-shots at high level). Fixed engine-side; this is the one UI-facing field rename. | **IMPLEMENTED — Codex, 2026-07-15.** The selected-turn math now reads `20 BASE +9 ATK -DEF2 = 27` directly from `DamageCalculation.power` and the authoritative calculation fields. |

---

## Session log (newest first)

### 2026-07-30 — Codex — Verify complete Run Mode flow
- CHANGED: Recorded the completed Run Map/Run Event UI verification handoff; no production scene, engine, data, or test files were changed in this task.
- FILES: `docs/codex-handoff.md`.
- DESIGN: The shared progress strip presents `DAY n / 5` from the existing five-wave map/run progression (the current actionable day/next map column); it does not add or persist a separate day field. Desktop and mobile retain the same route, choice, event, deck/bag, and stat-allocation contracts introduced by Tasks 1–5.
- VERIFY: `npm.cmd run typecheck` clean · `npm.cmd run build` passed (existing Vite >500 kB chunk-size warning only) · `npm.cmd test` passed: boundaries OK, 43 files / 702 tests. With `layoutAudit=1`, desktop and mobile Run Maps plus both Run Event flows had no `[layout-audit]`/console errors. Inspected desktop/mobile map day strips, route boards, choices, DECK / BAG entry, post-battle `3 PL TO SPEND` stat overlays, affordable and disabled choices, bonus-draft rows, reward outcomes, and `CONTINUE ›` return. Ran the committed Run Prep → Battle flow on both profiles; combat retained its existing playback, ledger, victory, and Run `CONTINUE ›` treatment.
- ASSUMPTIONS: Task 6 verifies the Task 1–5 implementation already committed through `984b96b`; the feature inventory already accurately records the Run Map/Run Event additions, so no duplicate inventory edit was needed. Browser capture briefly returned an uncomposited desktop canvas during initial boot, then composited both desktop and mobile WebGL frames normally; the final visual checks are from those composited states.
- REQUESTS TO CLAUDE: none.
- OPEN: None.
- Claude review: Pending.

### 2026-07-30 — Codex — Correct Run Route current-column marker
- CHANGED: Updated the shared route snapshot so its `current` marker follows the next actionable map column (`run.depth + 1`), with earlier columns rendered as cleared.
- FILES: src/game/ui/RunRouteBoard.ts
- DESIGN: `depths[0]` is the unused root placeholder, so a visual board that omits it must mark depth 1 current at run depth 0. Snapshot metadata remains `currentDepth: run.depth` and `nextDepth: run.depth + 1`.
- VERIFY: npm run typecheck = pass · npm run build = pass (existing Vite chunk-size warning) · npm test = pass (boundaries OK, 42 files / 701 tests).
- ASSUMPTIONS: The route marker represents the actionable/display column, consistent with the progress strip's next-column wave fallback.
- REQUESTS TO CLAUDE: none.
- OPEN: `layoutAudit=1` remains a later scene-integration verification item, not a Task 1 helper defect.
- Claude review: Pending.

### 2026-07-30 — Codex — Add shared Run Mode presentation helpers
- CHANGED: Added shared progress, route-board, and choice-panel helpers for the forthcoming desktop/mobile Run Map and Run Event scene integration.
- FILES: src/game/ui/RunProgressStrip.ts, src/game/ui/RunRouteBoard.ts, src/game/ui/RunChoicePanel.ts
- DESIGN: Snapshot helpers consume only `RunState` re-exported from `runStore`; rendering stays presentation-only. The strip derives its displayed DAY/WAVE from the existing next-column → current-column → wave-1 fallback. The route board has no node hit targets; choice panels expose one enabled-only surface and audit their text/control fit.
- VERIFY: npm run typecheck = pass · npm run build = pass (existing Vite chunk-size warning) · npm test = pass (boundaries OK, 42 files / 701 tests).
- ASSUMPTIONS: Map depth zero remains the existing unused root placeholder, so the route snapshot mirrors the existing map's cleared/current/future column treatment.
- REQUESTS TO CLAUDE: none.
- OPEN: Later Run Map/Event integration should exercise these shared renderers with `layoutAudit=1`; this helper-only task has no scene route to capture yet.
- Claude review: Pending.

### 2026-07-29 — Codex — add authored art for all remaining cards
- CHANGED: Generated and saved portrait anime-TCG art for the 37 cards that were missing authored artwork: Twin Slash; the Fire set (Ember Lash, Cinder Dart, Scorching Brand, Wildfire Surge, Inferno Eruption); the Lightning set (Static Jolt, Thunder Step, Chain Spark, Overcharge, Storm Surge); the Nature set (Thorn Bite, Verdant Touch, Blooming Vine, Overgrowth); the Frost set (Glacial Spike, Frost Shackle, Deep Freeze); the Lance set (Lance Thrust, Braced Pike, Piercing Reach, Impaling Charge); the Bow set (Rapid Volley, Piercing Arrow, Marksman Shot, Barrage); the defensive set (Bastion Stance, Aegis Wall, Sanctified Bulwark, Fortress Bastion); the support/healing set (Mending Aura, Swift March, Warlord's Banner, Renewing Wave, Vital Surge); and the true-damage set (Void Pierce, Annihilation Strike).
- FILES: `public/game-art/cards/{37 new *-anime.png assets}`, `src/game/ui/cardArtCatalog.ts`, `docs/superpowers/specs/2026-07-29-missing-card-art-design.md`, `docs/superpowers/plans/2026-07-29-missing-card-art.md`
- DESIGN: Kept the existing full-card Japanese/Korean anime TCG direction: singular subject or effect, crisp cel-shaded edges, saturated family palette, dark navy/violet backdrop, and a calmer lower third for the existing card text. Existing art and the shared loader/template contract were left unchanged.
- VERIFY: coverage check = `72` skills / `72` catalog entries / `0` missing / `0` stale / `0` missing files · all 37 new images = `1024×1536` · `npm run typecheck` pass · `npm run build` pass · `npm test` pass (`42` files / `701` tests) · browser smoke at `?view=wiki` shows `72/72 AUTHORED ENTRIES` with new art visible and no warning/error console output.
- ASSUMPTIONS: “Add all art first” means complete the full current skill book in one pass; the generated images are project-bound art assets, not previews only. The existing `CARD_ART_CATALOG` remains the single source of truth.
- REQUESTS TO CLAUDE: none.
- OPEN: None.
- Claude review: Pending.

### 2026-07-25 — Claude — wiki tier selection + GEMS tab, deck-build gem socketing, holding/trash fix, tier-text honesty
- CHANGED: **(1) Wiki tier selection (desktop):** the detail pane has BRONZE→DIAMOND chips (tiers below the card's authored tier disabled); the preview card, PL line, and rules text all re-resolve through `applyTier`, and **ADD TO BAG stamps the chosen tier** (`createOwnedCard(id, tier)`). **(2) Wiki GEMS tab (desktop):** CARDS|GEMS tabs; full 12-gem catalog grid (rarity diamond, kind, +PL, stripped text), detail pane with pouch count and **ADD TO POUCH** (`demoState.gemInventory`). **(3) Deck-build gem socketing (desktop):** CLICKING a deck card (moving <6px — dragging still drags) opens its GEM SOCKET panel: current socket with card PL math + UNSOCKET, and the pouch list with SOCKET/SWAP; all mutations via run/loadout's `socketGem/swapGem/unsocketGem`, displaced gems return to the pouch; ◆ accessory badge + header PL/gem counts update. **(4) BUG FIX (user-reported): desktop TEMP HOLDING and TRASH never worked** — the scene's `init()` reset `hold`/`pendingTrash`, but the scene re-renders after every drop via `scene.restart()` (which re-runs init), wiping both instantly. They now survive the restart (mobile never had an init — that's why it worked there). **(5) ENGINE FIX: auto-scaled tier-ups kept stale display text** (`applyTier` scaled `effects` but not `text`, so a Diamond Arcane Bolt still read "+18" while dealing 48) — `autoScaleTier` now rewrites each changed power/stacks number in the text; authored `tierUpgrades` text untouched; locked by NEW `tests/engine/tierText.test.ts`.
- FILES: `src/game/scenes/DesktopWikiScene.ts`, `src/game/scenes/DesktopDeckBuildScene.ts`, `src/engine/cards.ts`, `tests/engine/tierText.test.ts` (new), `docs/feature-inventory.md`
- VERIFY: `npm run typecheck` clean · `npm test` = **376 green** · live: Arcane Bolt DIAMOND chip → PL 25, diamond frame, "ADD TO BAG · DIAMOND", text scaled (+18→+48); GEMS tab catalog; clicked Sword Slash → socket panel → socketed Venom Sliver → ◆ badge + PL 56→58 · 3 gems; drop onto TEMP HOLDING holds Second Wind across the restart.
- OPEN: mobile wiki has no tier chips / GEMS tab, mobile deck build no socket panel (inventory-listed gaps). Multi-effect cards with duplicate numbers could retext the wrong occurrence — display-only risk, engine unaffected.
- Claude review: (self-authored)

### 2026-07-25 — Claude — multi-foe fights, foe picker, wiki-art fix, Disrupt rebalance, battle statlines, feature inventory
- CHANGED: **(1) Multi-foe (2v1) end-to-end.** `buildBattleTimeline` accepts `enemyTeam` (per-unit HP/shield/status/speed/playSlot arrays via event `unit`; singular fields stay as unit-0 views); BOTH battle scenes render one HP bar + board per foe; the all-foes-down rule ends playback. **(2) Foe management in BOTH preps:** foe chips (select / click-active-to-SWAP via roster picker / ✕ remove, cap 2), + FOE picker; every control (title/LV/RANK/modifiers) edits the SELECTED foe (`demoState.activeFoe`, `syncPrimaryFoe()` keeps the legacy singles mirrored to foe 0). Desktop prep stacks all foe boards. **(3) Wiki art bug fixed:** `FantasyCardTemplateV2`'s world-space art mask never followed the card, so scrolled gallery cards lost their art — mask now redraws in a `setPosition` override (same pattern as CardToken); only `twin_slash` has no PNG. **(4) Disrupt repriced** (balance-designer): escalating brackets 5/15/30/60 deci-PL (pts 1-5/6-10/11-15/16+); Concussive Shot 16 → 6; gem echo 8 → 4; audit green. **(5) Battle statlines:** hero + per-foe `ATK · MAG · DEF · RES · SPD` under the HP bars (user reported "battle doesn't use stats" — allocation DID apply, verified −14 damage per hit with 14 armor buys; it just wasn't visible). **(6) NEW [`docs/feature-inventory.md`](feature-inventory.md)** — per-page feature checklist (D/M), the anti-regression reference; update it with every scene change.
- FILES: `src/game/battleTimeline.ts`, `src/game/demoState.ts`, `src/game/scenes/{DesktopPrep,MobilePrep,DesktopBattle,MobileBattle}Scene.ts`, `src/game/ui/FantasyCardTemplateV2.ts`, `src/game/ui/cardArtCatalog.ts`, `src/engine/balance.ts`, `src/data/{skills,gems}.ts`, `docs/{power-level-reference,feature-inventory}.md`, `tests/game/battleTimeline.test.ts` (new), `tests/engine/balance.test.ts`
- VERIFY: `npm run typecheck` clean · `npm test` = **373 green** (new: 4 timeline tests incl. 2-foe + single-vs-team-of-one identity; disrupt bracket test) · live: +FOE→2 duelists (one DIAMOND-POWERED, edits stay per-foe), FIGHT → two enemy sections with independent HP/boards, START line lists both foes, wiki scrolls with art intact, statlines under bars.
- OPEN: mobile gaps are enumerated in feature-inventory.md (modifier chips, hero stat sheet, statlines, speed control); `twin_slash` needs a PNG.
- Claude review: (self-authored)

### 2026-07-25 — Claude — battle polish: START step, compact ledger, speed control, rank-cap/modifier interplay
- CHANGED: **(1) Battle-start baseline step** — `buildBattleTimeline` now prepends a synthetic `START` step (`Hero 100/100 vs Foe 105/105`) with both sides at FULL HP before any event; previously playback opened on the first HIT with damage already applied to the HP snapshot. Shared model, so mobile gets it too (`START` added to both scenes' TAG_COLOR). **(2) Compact outcome panel** (DesktopBattleScene): the full-width BATTLE LEDGER + banner is now one centered ~640px card (banner on top, totals, 2-col CARD OUTPUT) over a lighter scrim — boards/log stay visible around it. **(3) Playback speed control**: ×½ / ×1 / ×2 segment in the battle footer; multiplier divides the step delays (450/160ms), applies at the next scheduled step, and deliberately survives REPLAY/re-entry (not reset in init()). **(4) Rank cap ↔ tier-forcing modifiers**: the prep RANK steppers (desktop + mobile) now display the RESOLVED encounter rank, clamp at `maxRankFor(deckSize)` (deckSize × 3), and go inert with a `RANK · MAXED BY DIAMOND` label while a forceTier modifier owns the dial — previously the stepper showed the raw demoState value, had no cap, and silently did nothing under DIAMOND-POWERED.
- ALSO (perf, user-reported sluggish modifier toggles): `DesktopPrepScene` control changes (chips/steppers) now use an in-place `rerender()` (destroy children + rebuild synchronously) instead of `scene.restart()` — no full lifecycle teardown, no empty-frame flash. Measured click→rendered-frame 18–34ms over repeated toggles; encounter+DMG-band rebuild itself is <2ms. Mobile prep still restarts (portrait scenes are lighter).
- FILES: `src/game/battleTimeline.ts`, `src/game/scenes/DesktopBattleScene.ts`, `src/game/scenes/MobileBattleScene.ts`, `src/game/scenes/DesktopPrepScene.ts`, `src/game/scenes/MobilePrepScene.ts`
- VERIFY: `npm run typecheck` clean · `npm test` = 368 green · live: step 0 shows `T1 START Hero 100/100 vs Bandit Duelist 105/105` with full bars; outcome card centered/compact; speed segment renders with ×1 active; `?mods=diamond` → `RANK · MAXED BY DIAMOND` showing resolved 9 (3-card deck) and inert stepper.
- Claude review: (self-authored)

### 2026-07-25 — Claude — enemy modifiers + hero stat selection + deck-build spacing
- CHANGED: **(1) Enemy MODIFIERS are now a real fourth dial** (was the reserved axis): `MODIFIER_PRESETS` in `src/run/encounter.ts` — `diamond` (DIAMOND-POWERED: every card forced to Diamond tier after rank assignment, rank reads as ceiling) and `swift` (SWIFT: +8 PL auto-spent on Speed through the same priced `LEVEL_STAT_COST` economy → +4 SPD). `buildEnemyEncounter(id, level, title, rank?, modifiers?)` applies them (throws on unknown ids); `EncounterUnit.modifiers` echoes them. Threaded through `battleTimeline` (`enemyModifiers` input), both battle scenes, both prep scenes, and a `?mods=diamond,swift` dev URL param. Adding a new affix = one row in `MODIFIER_PRESETS` (bonusPL+profile and/or forceTier). **(2) Hero stat selection** (`DesktopPrepScene.renderHeroSection`): HERO LV stepper + PL SPENT/BANKED readout + 2×3 allocation grid (HP/ATK/MAG/DEF/RES/SPD) spending `demoState.heroAllocation` through the guarded `applyPlayerLevelAllocation` path — buys disable when unaffordable, lowering LV auto-trims stranded buys so the guard never throws; allocation flows live into YOUR DECK numbers. **(3)** Deck Build: ACTIVE DECK/BAG header labels get a 44px band clear of TEMP HOLDING.
- FILES: `src/run/encounter.ts`, `src/game/battleTimeline.ts`, `src/game/scenes/Desktop{Prep,DeckBuild,Battle}Scene.ts`, `src/game/scenes/Mobile{Prep,Battle}Scene.ts`, `src/game/devLaunch.ts`, `tests/run/encounter.test.ts`
- VERIFY: `npm run typecheck` clean · `npm test` = **368 green** (6 new modifier tests incl. byte-identical no-modifier baseline) · live checks: SWIFT chip → SPD 11→15 in the sheet; DIAMOND-POWERED → enemy DMG 34→54 / DMG-turn 27→46; hero LV→3 then ATK/SPD buys → PL 3/6 SPENT and deck DMG 21→22.
- OPEN: mobile prep has no modifier/stat-selection UI yet (fights honor demoState either way). Modifier chips row will need a wrap/scroll treatment past ~4 affixes.
- Claude review: (self-authored)

### 2026-07-25 — Claude — desktop screens rebuilt playable (fix of prior desktop scaffolding)
- CHANGED: Rebuilt all four desktop screens to full mobile parity on the 1440×900 canvas. **DesktopPrep**: enemy sheet + DMG/turn band, title chips, LV/RANK steppers, seed reroll, deck columns, FIGHT → DesktopBattle. **DesktopDeck**: real pointer drag-and-drop (placement via `run/loadout.ts`), TEMP HOLDING, trash confirm, identity pips. **DesktopWiki**: full scrollable catalog (wheel + drag, no 10-card cap), shared `DesktopNav` header, `init()` resets, `{{markup}}` stripped in the detail pane. **NEW DesktopBattleScene** (`?scene=desktop-battle`): landscape playback — boards left/right, wide center log with expandable D: math, HP bars w/ FX, horizontal scrubber, PREP/REPLAY/END, ledger + outcome banner over an 0.88 scrim. The mobile battle timeline transform was extracted to shared `src/game/battleTimeline.ts` (no Phaser import); `MobileBattleScene` now consumes it — behavior unchanged.
- ALSO: `DesktopNav` rewritten (theme tokens, `DESKTOP_LAYOUT` shared geometry: gutter 32 / contentTop 168 / gap 12 / 40px tabs); new `UI.textAccent`/`UI.textOnChip` string tokens; `TEXT_RESOLUTION` DPI-aware cap (4× desktop) instead of hardcoded 6; deck-build stat strip moved to the tab row's right edge (was overlapping the tabs); both battle scenes now **destroy** (not just remove) children on redraw — fixes a per-step Text-texture leak.
- FILES: `src/game/scenes/Desktop{Prep,DeckBuild,Wiki,Battle}Scene.ts`, `src/game/battleTimeline.ts`, `src/game/scenes/MobileBattleScene.ts`, `src/game/ui/DesktopNav.ts`, `src/game/theme.ts`, `src/game/layoutProfile.ts`, `src/game/devLaunch.ts`, `src/game/scenes/BootScene.ts`, `src/main.ts`
- VERIFY: `npm run typecheck` clean · `npm test` = 356 green · live Chromium pass at 1440×900 over all four screens: drag deck→bag confirmed (counts/PL update), wiki wheel-scroll + ADD TO BAG detail, LV stepper + FIGHT → battle → PREP loop, mobile battle visually unchanged.
- OPEN: several catalog cards have no art asset (render as dark frames in the wiki grid) — content gap, not layout. `+ FOE` remains a stub on both prep scenes.
- FOLLOW-UP (same day, user-requested): **(1) Drag ghost** — picking up a card in Deck Build (desktop + mobile) now leaves a dimmed clone + dashed gold outline in the source slot (`CardToken.spawnGhost()`), destroyed on drop. **(2) Card-token template spec** — NEW `src/game/ui/cardTokenSpec.ts` is the single source of truth for the strip token's region geometry (accent stripe, text lines + ellipsis clamps, corner badges, cursor chip), the strip-token counterpart of `fantasyCardTemplateSpec.ts`; `CardToken` renders purely from it. It includes a reserved **accessory rail** (horizontal boxes along the bottom inward corner beside the weight badge, `accessorySlot(i)`, text clamps auto-shrink) for future attachments — gem sockets, tier plates, enchant pips. First consumer: gem-socketed deck cards show a ◆ badge via the new `accessories` option. Unit-tested in `tests/game/cardTokenSpec.test.ts` (6 tests; suite now 362 green, typecheck clean).
- Claude review: (self-authored)

### 2026-07-19 — Codex — fight header gap cleanup
- CHANGED: Pushed the shared panel divider farther down and kept the fight selector row aligned under the `CHOOSE FIGHT` title so the enemy chip, close box, and header text no longer crowd the separator line.
- FILES: `src/game/theme.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`
- DESIGN: The fight header now has a cleaner top band with more breathing room between the title row and the selector controls. The selector stays readable, but the line no longer cuts the row visually in half.
- VERIFY: `npm run typecheck` = pass · live Chromium screenshot checked on `http://127.0.0.1:5173/?view=loadout&layoutAudit=1`
- ASSUMPTIONS: A slightly taller header band is preferable to squeezing the selector tighter. If the user wants even more space, the next adjustment should be to reduce the width of the right-side enemy chip group rather than shrinking the title.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-19 — Codex — segmented enemy selector stepper
- CHANGED: Replaced the cramped `LV - 1 +` / `RANK - 2 +` control row with a reusable segmented stepper control that gives the label, value, and +/- actions their own surface.
- FILES: `src/game/ui/displayLibrary.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`
- DESIGN: The fight selector now reads as a real control instead of squeezed text. The label cell, value cell, and action buttons each have their own boundaries, so longer enemy names and the level selector no longer crowd the row.
- VERIFY: `npm run typecheck` = pass · `npm run build` = pass · `npm test` = pass (299) · live Chromium screenshot reviewed on `http://127.0.0.1:5173/?view=loadout&layoutAudit=1`
- ASSUMPTIONS: The segmented selector should be the shared pattern for future stepper-like controls in Prep, not just a one-off fix.
- REQUESTS TO CLAUDE: none
- OPEN: The enemy title chips still use compact labels by design. If the user wants the entire fight header to breathe more, the next step is to re-balance the full selector row rather than shrinking the stepper again.
- Claude review:

### 2026-07-19 — Codex — shared dark bronze theme pass
- CHANGED: Shifted the shared game palette to the user’s dark navy / bronze reference, added reusable ornate backdrop and panel-shell helpers, and retuned the real Prep and Battle controls to use the new chrome.
- FILES: `src/game/theme.ts`, `src/game/ui/displayLibrary.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `docs/codex-handoff.md`, `docs/codex-ui-guide.md`
- DESIGN: The real prep screen now reads much closer to the provided reference without inventing fake screens: dark navy background, bronze border brackets, gold-selected tabs and buttons, and a reusable frame language for the rest of the game. The current-deck area still shows the actual run deck summary, while the fight scout and battle scene share the same backdrop language.
- VERIFY: `npm run typecheck` = pass · `npm run build` = pass · `npm test` = pass (279) · live Chromium screenshot reviewed on `http://127.0.0.1:5173/?view=loadout&layoutAudit=1` · layout-audit console clean.
- ASSUMPTIONS: The user wants the whole game to share the same bronze-on-navy theme, so I applied it globally through the shared theme tokens and reusable backdrop helper instead of making a one-off prep-only treatment.
- REQUESTS TO CLAUDE: none
- OPEN: The choose-fight panel still has a large open area by design. If the user wants the next polish step, the best follow-up is a subtle compass/watermark motif or a tighter info stack, not a new fake screen.
- Claude review:

### 2026-07-19 — Codex — missing card-art batch and shared art catalog
- CHANGED: Generated the missing skill-card art batch, copied the new PNGs into `public/game-art/cards/`, added a shared `src/game/ui/cardArtCatalog.ts`, and rewired `BootScene`, `FantasyCardTemplate`, and `cardArtPresentation` to use the shared catalog.
- FILES: `src/game/scenes/BootScene.ts`, `src/game/ui/cardArtCatalog.ts`, `src/game/ui/cardArtPresentation.ts`, `src/game/ui/FantasyCardTemplate.ts`, `public/game-art/cards/*.png`, `docs/codex-handoff.md`
- DESIGN: The catalog now has matching art for the previously missing cards, and the template falls back only when a card still has no art entry. The new images keep the same cel-shaded anime TCG language as the existing set: singular subject, bold VFX, and a darker lower third for text.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (278) · eyeballed `public/game-art/cards/sword-slash-anime.png`
- ASSUMPTIONS: The generated filenames follow the hyphenated `*-anime.png` naming pattern used by the current art folder, and `arcane_bolt` keeps its existing `arcane-bolt-spell.png` asset.
- REQUESTS TO CLAUDE: none
- OPEN: Need to run `build`/`typecheck` and inspect the catalog in-game. If any generated image looks off in the template, I’ll swap just that asset without changing the loader contract.
- Claude review:

### 2026-07-18 — Codex — V2 slot boxes and side-badge layout
- CHANGED: Updated `FantasyCardTemplateV2` so slot size renders as `Slot` plus 1–3 square boxes, moved the type/weapon/element badge to the left column with weight directly under it, and stacked all archetype badges on the right.
- FILES: `src/game/ui/FantasyCardTemplateV2.ts`, `src/game/ui/fantasyCardTemplateModel.ts`, `tests/game/fantasyCardTemplateModel.test.ts`, `docs/codex-handoff.md`
- DESIGN: Card size now reads visually instead of numerically. A one-slot card shows one box, larger cards show multiple boxes, the left column is reserved for type identity plus weight, and the right column now consistently handles the full 1–3 archetype stack.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (252/252)
- ASSUMPTIONS: The existing `slotLabel` region remains wide enough for three slot boxes at current scale; if the visual spacing needs tuning, keep it inside V2 without bringing back per-card offsets.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-18 — Codex — fantasy card template V2 inline cutover
- CHANGED: Built the first working `FantasyCardTemplateV2`, added pure geometry/skin/asset-rule modules plus model tests, and switched the Wiki card-sheet template view off the legacy `FantasyCardTemplate`.
- FILES: `src/game/ui/FantasyCardTemplateV2.ts`, `src/game/ui/fantasyCardTemplateSpec.ts`, `src/game/ui/fantasyCardTierSkins.ts`, `src/game/ui/fantasyCardAssetRules.ts`, `src/game/ui/fantasyCardTemplateModel.ts`, `src/game/ui/cardArtPresentation.ts`, `src/game/scenes/PrepScene.ts`, `tests/game/fantasyCardTemplateSpec.test.ts`, `tests/game/fantasyCardTemplateModel.test.ts`, `docs/codex-handoff.md`
- DESIGN: The template view now renders through V2 with locked `420x690` geometry, shared tier skins, and cover-fit art rules instead of the previous offset-driven template path. The legacy file still exists in the repo for cleanup later, but `PrepScene` no longer imports or uses it.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (251/251) · focused V2 tests pass (`tests/game/fantasyCardTemplateSpec.test.ts`, `tests/game/fantasyCardTemplateModel.test.ts`).
- ASSUMPTIONS: Existing loaded badge/art textures remain acceptable for the first V2 pass; visual polish can keep iterating inside the new V2 structure without reintroducing per-card nudges.
- REQUESTS TO CLAUDE: none
- OPEN: Legacy `src/game/ui/FantasyCardTemplate.ts` is now unused by `PrepScene` but not deleted yet; remove it after V2 visual sign-off or once any remaining caller audit is done.
- Claude review:

### 2026-07-18 — Codex — fantasy card template V2 design spec
- CHANGED: Wrote a replacement design spec for the full-card fantasy template that moves the system away from offset patches and toward a new region-based component with tier skins, a concrete frame/region geometry, and an art-ingest contract with PNG size requirements.
- FILES: `docs/superpowers/specs/2026-07-18-fantasy-card-template-v2-design.md`, `docs/codex-handoff.md`
- DESIGN: The approved direction is a new Phaser template component, not a retrofit of the current one. It locks shared card geometry for art, badge rails, WT plate, slot label, title, divider, and body text; tier cards are the same geometry with bronze/silver/gold/diamond skins. The spec now includes a canonical `420x690` card size, fixed region bounds, frame silhouette, and explicit PNG dimensions for frames, art, badges, WT plates, divider ornaments, and text plates. It explicitly forbids per-card icon, art, or text nudges and requires art to fit the template before import.
- VERIFY: Spec self-review completed for placeholders, contradictions, and ambiguity. No code or build verification was run because this session stopped at design/spec.
- ASSUMPTIONS: V2 will be built alongside the current template first, then the Wiki `Template` preview will switch over for validation before the legacy path is removed.
- REQUESTS TO CLAUDE: none
- OPEN: Waiting on user review of the written spec before writing the implementation plan.
- Claude review:

### 2026-07-16 — Codex — unified template badge icons
- CHANGED: Replaced the template's cropped icon plates with code-generated combined badges so the icon and border ship as one piece, and switched the offense archetype symbol to crossed swords.
- FILES: `src/game/ui/FantasyCardTemplate.ts`, `docs/codex-handoff.md`
- DESIGN: Weapon/element/archetype badges now share one metal badge recipe, and the WT plate uses the same frame language instead of looking like a separate kit. Offense no longer reads like a single sword weapon icon.
- VERIFY: `npm run typecheck` = clean. Full `npm run build` / `npm test` were intentionally not run for this visual iteration. Headless Playwright WebGL screenshots became unreliable after the runtime badge generation pass, so the live `?view=template` page is the source of truth for visual review.
- ASSUMPTIONS: This badge generator is only for the fantasy full-card template path; other UI surfaces keep their existing icon treatments until intentionally updated.
- REQUESTS TO CLAUDE: none
- OPEN: If the user wants a sharper icon family after reviewing the live page, refine the symbol shapes rather than reintroducing separate frame/icon assets.
- Claude review:

### 2026-07-16 — Codex — scaled template gallery with tap expand
- CHANGED: Kept the approved full-card template sizing internally, scaled the whole card down for the Wiki `Template` gallery, and added tap-to-expand full-size preview cards.
- FILES: `src/game/scenes/PrepScene.ts`, `docs/screenshots/template-gallery-scaled-grid-canvas.png`, `docs/screenshots/template-gallery-expanded-modal.png`, `docs/codex-handoff.md`
- DESIGN: The Template view now shows all six approved art cards at once in a 3×2 sheet without shrinking the template text rules independently. Each tile behaves like an image thumbnail: compact on the page, full-size when tapped.
- VERIFY: `npm run typecheck` = clean; visually checked `http://127.0.0.1:5173/?view=template` and saved `docs/screenshots/template-gallery-scaled-grid-canvas.png` plus `docs/screenshots/template-gallery-expanded-modal.png`. Full `npm run build` / `npm test` were intentionally not run for this narrow visual iteration.
- ASSUMPTIONS: The full-size popup should preserve the same frame/tier/shade settings currently chosen in the builder so the gallery and expanded preview always match.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — six-card template gallery
- CHANGED: Replaced the single-card template preview with a compact six-card gallery showing Arcane Bolt, Fireball, Crippling Strike, Mana Ward, Venom Fang, and War Banner through the actual `FantasyCardTemplate`.
- FILES: `src/game/scenes/PrepScene.ts`, `src/game/ui/FantasyCardTemplate.ts`, `docs/screenshots/template-six-card-gallery-fixed.png`, `docs/codex-handoff.md`
- DESIGN: The Wiki `Template` view now acts like a real inspection sheet: compact controls at the top and a 3×2 gallery beneath. The template internals now scale down cleanly so mini full-card previews keep their title/body text inside the frame.
- VERIFY: `npm run typecheck` = clean; visually checked `http://127.0.0.1:5173/?view=template` and saved `docs/screenshots/template-six-card-gallery-fixed.png`. Full `npm test` was not run for this UI pass.
- ASSUMPTIONS: The six-card set is the current “approved art applied” group; future card batches can reuse the same gallery layout.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — five anime card-art assets
- CHANGED: Saved and wired anime-style card art for Fireball, Crippling Strike, Mana Ward, Venom Fang, and War Banner.
- FILES: `public/game-art/cards/fireball-anime.png`, `public/game-art/cards/crippling-strike-anime.png`, `public/game-art/cards/mana-ward-anime.png`, `public/game-art/cards/venom-fang-anime.png`, `public/game-art/cards/war-banner-anime.png`, `src/game/scenes/BootScene.ts`, `src/game/ui/FantasyCardTemplate.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`
- DESIGN: The accepted direction is Japanese/Korean anime TCG skill art: cel-shaded, graphic, saturated, and object-focused. Earlier realistic fantasy attempts were not saved or wired.
- VERIFY: `npm run typecheck` = clean. Full `npm test` was not run for this visual asset pass.
- ASSUMPTIONS: These five are the first applied style batch after Arcane Bolt. Future cards should reuse this art direction and the existing `FantasyCardTemplate` map.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — Wiki card template builder
- CHANGED: Added a Wiki `Template` subtab and `?view=template` launcher that previews Arcane Bolt through the existing `FantasyCardTemplate`, with live controls for frame style, tier color, and dark readable-area height.
- FILES: `src/game/scenes/PrepScene.ts`, `src/game/ui/FantasyCardTemplate.ts`, `src/game/demoState.ts`, `src/game/devLaunch.ts`, `docs/codex-ui-guide.md`, `docs/screenshots/wiki-template-builder.png`, `docs/codex-handoff.md`
- DESIGN: The user can now tune the saved full-card template in-game instead of relying on separate generated mockups. The builder keeps the approved template file as the source of truth and hides the old inspector area while previewing.
- VERIFY: `npm run typecheck` = clean; visually checked `http://127.0.0.1:5173/?view=template` and saved `docs/screenshots/wiki-template-builder.png`. Full `npm test` was not run for this visual iteration.
- ASSUMPTIONS: Arcane Bolt remains the first preview card for this pass; more cards can use the same template after the layout is accepted.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — Arcane Bolt spell-object art direction
- CHANGED: Saved the new 3D-styled Arcane Bolt spell art into the project and pointed the fantasy card template's Arcane Bolt art map at it.
- FILES: `public/game-art/cards/arcane-bolt-spell.png`, `src/game/scenes/BootScene.ts`, `src/game/ui/FantasyCardTemplate.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`
- DESIGN: Arcane Bolt now uses a quieter spell-focused image: dimensional blue-violet energy, sparks, and depth haze, with no character portrait. This becomes the reference direction for future spell cards.
- VERIFY: `npm run typecheck` = clean; visually checked `http://127.0.0.1:5173/?view=template` and saved `docs/screenshots/wiki-template-builder-arcane-bolt-spell.png`.
- ASSUMPTIONS: The previous `public/game-art/cards/arcane-bolt.png` remains available as an older alternate but is no longer the active Arcane Bolt art.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — frameless skill-text variant
- CHANGED: Added a frameless skill-text plate option inside `FantasyCardTemplate` and switched the Wiki card sheet preview to use it.
- FILES: `src/game/ui/FantasyCardTemplate.ts`, `src/game/scenes/PrepScene.ts`, `docs/screenshots/fantasy-card-template-arcane-bolt-frameless.png`, `docs/codex-handoff.md`
- DESIGN: The Arcane Bolt card keeps the same art, WT/type/archetype icons, `SLOT N`, title, divider, and skill text, but removes the ornate skill-box frame in favor of a simple dark readable plate.
- VERIFY: `npm run typecheck` = clean; visually checked the Wiki Arcane Bolt card sheet.
- ASSUMPTIONS: The ornate version remains available as `skillFrame: 'ornate'` in the same template file; no separate template was created.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — tightened card text readability shade
- CHANGED: Moved the fantasy card lower readability shade closer to the ornate skill-text frame.
- FILES: `src/game/ui/FantasyCardTemplate.ts`, `docs/screenshots/fantasy-card-template-arcane-bolt-shade-tight.png`, `docs/codex-handoff.md`
- DESIGN: The dark text-readable area now starts near the skill box instead of covering a large lower portion of the card art, leaving more Arcane Bolt art visible above the frame.
- VERIFY: `npm run typecheck` = clean; visually checked the Wiki Arcane Bolt card sheet.
- ASSUMPTIONS: This is a template-level adjustment for all future full-art cards using `FantasyCardTemplate`.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — Arcane Bolt full-card art
- CHANGED: Generated and integrated first-pass fantasy anime art for Arcane Bolt in the existing reusable card template.
- FILES: `public/game-art/cards/arcane-bolt.png`, `src/game/scenes/BootScene.ts`, `src/game/ui/FantasyCardTemplate.ts`, `docs/screenshots/fantasy-card-template-arcane-bolt-art.png`, `docs/codex-handoff.md`
- DESIGN: Arcane Bolt now displays full-bleed blue/violet arcane spell art behind the saved WT/icon/skill-text template. Other cards still use the matte placeholder until art is added through the same template map.
- VERIFY: `npm run typecheck` = clean; visually checked the Wiki Arcane Bolt card sheet via the running app.
- ASSUMPTIONS: This is a first art direction sample, not approval to batch-generate every card yet.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — locked reusable skill-card template
- CHANGED: Recorded `FantasyCardTemplate` as the reusable full-card skill template for future card skills.
- FILES: `docs/codex-handoff.md`, `docs/codex-ui-guide.md`
- DESIGN: Future full-size skill-card presentations should reuse the approved template: borderless art, primary archetype + WT, right-side type/archetype stack, `SLOT N` on the skill-frame border, and tier-colored ornate skill text.
- VERIFY: documentation-only change; no runtime behavior changed.
- ASSUMPTIONS: This locks the template pattern, not final generated card art.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — card template slot label
- CHANGED: Reduced fantasy card WT digit sizing/stroke and added a small `SLOT N` footprint label on the skill-box upper border.
- FILES: `src/game/ui/FantasyCardTemplate.ts`, `docs/screenshots/fantasy-card-template-slot-label.png`, `docs/codex-handoff.md`
- DESIGN: The WT number has more room inside the tier diamond, and board slot size is now visible on the full-art template without crowding the left/right icon stacks.
- VERIFY: `npm run typecheck` = clean; visually checked the Gold Arcane Bolt card sheet in the Wiki view.
- ASSUMPTIONS: Slot size is rendered from `skill.size`; no engine/data changes were needed.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Codex — wiki card WT tier alignment
- CHANGED: Persisted the Wiki preview tier through scene redraws and added per-tier WT-number offsets in the fantasy card template.
- FILES: `src/game/demoState.ts`, `src/game/scenes/PrepScene.ts`, `src/game/ui/FantasyCardTemplate.ts`, `docs/screenshots/fantasy-card-template-silver-app.png`, `docs/screenshots/fantasy-card-template-gold-app.png`, `docs/codex-handoff.md`
- DESIGN: Opening a Wiki card sheet from Silver or Gold now uses the matching WT plate and skill-text tier border. Silver/Gold WT numbers no longer share a one-size-fits-all center; the template dictionary can tune each tier independently.
- VERIFY: `npm run typecheck` = clean; visually checked the Silver and Gold Arcane Bolt card sheets via the running Wiki view.
- ASSUMPTIONS: This was a visual/state fix only; full build/tests were intentionally not run during this alignment pass.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-16 — Claude — FIGHT REPORT auto-opens at battle end + healing now counted
- WHY (user): (1) "make it show the battle summary when the battle ends as if clicking on the end battle log"; (2) healing wasn't showing in the report — Second Wind (+45 HP) never appeared.
- CHANGE 1 (`BattleScene`, auto-open): new one-shot guard `reportAutoShown` (reset in `init`). Helper `maybeAutoOpenReport()` opens `openReportModal()` once, after a ~450ms beat so the final row/badge settle first. Fired from the `combatEnd` handler when `!instant` (natural animated playback reaches the end) and from `finishPlayback()` (the END button jump). Not fired during the instant pre-apply, so it only pops when the fight actually finishes on screen.
- CHANGE 2 (engine + analysis, healing attribution): heal events now always carry `overheal` and (where a cast produced them) `sourceCard`. `interpreter.ts` emits a heal event whenever `amount > 0` (attempted, not just effective) with `overheal = amount − healed`; the lifesteal self-heal push was updated to match. `cardContributions` counts **gross** healing (`amount + overheal`) so a heal card shows its output even when it topped off a near-full ally. Heal-event type in `events.ts` gained the required `overheal: number` field.
- VERIFY: typecheck clean · `npm test` green (242) · build passes · Playwright: `?scene=battle&enemy=bandit_duelist&seed=2&title=mob&enemyLevel=1` (VICTORY·7T) auto-pops the report showing `Second Wind · HEAL 45` and `Iron Bulwark · DEF 60`; a loss fight also auto-pops.
- NOTE FOR CODEX: the `heal` event shape changed (added `overheal`, `sourceCard?`) — if you read heal events directly, `amount` is still effective HP restored; add `overheal` for gross.

### 2026-07-16 — Claude — FIGHT REPORT trigger moved to the RESULT log row
- WHY (user): don't want the report on the top-corner badge; open it by clicking the final RESULT entry in the turn log.
- CHANGE (`BattleScene`): the corner result badge is back to a plain `VICTORY/DEFEAT · Nt` indicator (no tap). Clicking the `RESULT` log row (`row.note === 'RESULT'`) now selects it AND calls `openReportModal()` — same per-card FIGHT REPORT modal.
- VERIFY: typecheck clean · build passes · Playwright: badge plain, clicking the RESULT row pops the report with correct per-card totals.

### 2026-07-16 — Claude — crisp text (higher Text resolution under FIT up-scaling)
- WHY (user): UI looked blurry. Root cause: the fixed 720×1280 canvas is scaled up by `Scale.FIT` on large / HiDPI windows, and Phaser doesn't supersample the buffer, so text edges interpolate. (Phaser 3.90 DOES handle devicePixelRatio — a HiDPI shot at native size is crisp; the blur is up-scaling a low-res buffer.)
- FIX (`src/main.ts`, coordinate-free): globally wrap the `text` GameObjectFactory to inject `resolution: 2–3` (scaled by devicePixelRatio, capped 3) on every Text. Phaser renders each text texture at that higher density, so it stays sharp through the FIT up-scale. No layout/coordinate changes; verified sharp vs blurry at a 1.5× window.
- STILL SOFT (not addressed): panel borders / filled rects are drawn into the 720×1280 buffer, so they still soften when up-scaled. Fully-crisp-everything needs rendering the whole game at a higher internal resolution (supersample) — a coordinate-system change in your layer. Flagging as an optional follow-up; say the word and it can be scoped.
- VERIFY: typecheck clean · build passes · Playwright 1.5× window shows crisp text (was blurry). Tests unaffected (main.ts isn't under test).

### 2026-07-16 — Claude — larger-card buff + tiered-effect text + log-detail sizing
- WHY (user): size-2/3 cards felt weak for their slot cost; tiered cards showed Bronze numbers; the turn-detail MATH row had inconsistent font sizes.
- BALANCE — bigger cards: measured (via `damagePerTurn`) that size-2/3 were only 46–69% of N× size-1. Raised `PRICE.sizeGrant2` 30→**140** and `sizeGrant3` 60→**320→380**, so a size-N card gets more than N× a size-1's effect budget (pays for the span disadvantage). Repriced all 10 size-2/3 cards to stay on Bronze budget (fireball dmg→42, crushing_blow/rending_claws→96, soul_rend→52, iron_bulwark→48, mending_light→48, crippling_strike→38, shield_splitter→42, stunning_smash→44, prism_barrier true-shield→225). Result: fireball 17 > 16 (2× size-1) and crushing_blow 27 > 24 (3× size-1) DPT — now modestly stronger. Audit green.
- TIERED-EFFECT TEXT (your layer): the battle card modal (`openSkillModal`) showed the static `skill.text` (Bronze numbers) for RANK-upgraded cards. Now, when a card's tier is above its base, the CARD EFFECT body renders `presentCardActions(skill)` (the scaled per-action breakdown) instead. Prep inspect (`SkillDetailPanel`) already did this via `applyTier` + `presentCardActions`.
- LOG-DETAIL SIZING (your layer): `renderTurnCalculation` was rendering calc tokens at mixed sizes (labels 6px, values 9px, result 10px) + a 2px label y-nudge — that's the "text isn't the same size" you saw. Now all tokens are uniform **8px** on one baseline; labels only differ by dimmer colour, the result by weight. ("RAMP" in that row = the sudden-death damage ramp — the escalating amp once BOTH sides have performed `suddenDeathRound` times; only appears in long fights.)
- VERIFY: `npm test` 242/242 · typecheck clean · build passes · Playwright confirms uniform calc row + buffed numbers.

### 2026-07-16 — Claude — per-card FIGHT REPORT (real damage/DoT/heal/def attribution)
- WHY: user — "at the result show each card's stats: total damage, heal, def a card added; DoT counts as harmful." Also a balance-diagnosis tool.
- ENGINE (additive, determinism-safe): new `EffectSourceRef` (types.ts). `damage`/`heal`/`shieldGain` events now carry an optional **`sourceCard`** (the card that produced the effect). Threaded via `Ctx.source` (set in `applyCast`, cleared after); poison/burn `StatusInstance` stores its `source` so detached DoT ticks attribute to the applying card.
- AGGREGATOR (pure, `src/run/analysis.ts`): **`cardContributions(events)`** → per source card `{ damage, dotDamage, healing, shield }`, keyed by (side, unit, slot, skillId), sorted player-then-slot. Only cards that produced an effect appear.
- UI (BattleScene — your layer, done by me): the result badge now reads `… · REPORT ▸` and opens a **FIGHT REPORT** modal listing each card's totals (`DMG / DoT / HEAL / DEF`, nonzero only), player cards then enemy cards. Reuses the existing modal infra (`modalObjects`/`closeModal`). **Feel free to restyle/relocate** (e.g. inline in the result view, or per-card badges on the board) — `cardContributions` is the reusable data source.
- VERIFY: `npm test` 242/242 (+2 attribution/aggregator tests; determinism green with the new fields) · typecheck clean · build passes · Playwright: report modal shows correct per-card DMG/DoT/DEF, badge opens it.
- STILL OPEN from the same user ask (NOT done this pass — flagged for a follow-up): (a) **buff larger cards** (size-2/3 feel underpowered for their slot cost — a `sizeGrant` bump + reprice); (b) **higher-tier cards don't show their scaled effect in the authored `text`** (tier-up scales numbers via `applyTier`, but the inspect text is static bronze wording) — the report now makes both easy to measure.

### 2026-07-16 — Codex — Transfer card can be moved again
- **CHANGED:** Made `makeDraggable` explicitly call `setInteractive` when a card has no hit target yet, which fixes cards rendered inside Transfer not responding to drag after they land there. Also changed invalid drops from Transfer to leave the card in Transfer instead of unexpectedly sending it back to a bag slot.
- **FILES:** `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`.
- **DESIGN:** A card placed in Transfer should now be movable again: drag it onto a deck slot to equip, onto a bag slot to store, or release it somewhere invalid and it stays in Transfer for the next move.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 242/242 pass. Headless browser stayed runtime-clean except the existing favicon 404, but automated mouse input still did not reliably pick up Phaser canvas cards, so this fix is based on the verified missing interactive hit target in code.
- **ASSUMPTIONS:** The stuck Transfer card was caused by the Transfer-rendered `CardView` being passed to `setDraggable` without first being interactive, unlike bag/deck cards that are interactive through `bindInspect`.
- **REQUESTS TO CLAUDE:** none.
- **OPEN:** none.
- **CLAUDE REVIEW:** _pending_

### 2026-07-16 — Codex — Transfer slot keeps Card Bag visible
- **CHANGED:** Hardened the Deck Build render order so Card Bag draws independently before the occupied Transfer slot, and changed the occupied Transfer card to use the shared `viewCard` helper so it is cleaned up with the rest of the view.
- **FILES:** `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`.
- **DESIGN:** Putting a card in Transfer should no longer make the Card Bag disappear. The bag remains its own section below Transfer, while the held Transfer card still returns to its origin when leaving Deck Build.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 242/242 pass. Browser check at `?view=deck-build&layoutAudit=1` stayed free of runtime/layout-audit errors except the existing favicon 404; headless drag automation did not successfully pick up the Phaser card, so final manual feel-check is still recommended in the open app.
- **ASSUMPTIONS:** The reported disappearance was from the occupied Transfer render path interrupting or visually displacing the lower Card Bag section.
- **REQUESTS TO CLAUDE:** none.
- **OPEN:** Please re-try the manual transfer action in the app; if the bag still disappears, the next thing to capture is whether it happens with a bag card, a deck card, or both.
- **CLAUDE REVIEW:** _pending_

### 2026-07-16 — Codex — Prep and Deck Build tab separation
- **CHANGED:** Renamed the main prep tabs to `PREP / DECK BUILD / WIKI`, made Prep focus only on fight setup, and moved deck editing into Deck Build with the active deck above the card bag. Added `?view=prep` and `?view=deck-build` launch aliases while preserving the old `loadout`/`bag` aliases.
- **FILES:** `src/game/scenes/PrepScene.ts`, `src/game/devLaunch.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** Deck Build no longer shows the persistent inspect panel. It has an active-deck rail, one Transfer slot, then the card bag. Dropping a bag or deck card into Transfer removes it from its real location temporarily; switching away from Deck Build returns it to its original bag/deck spot before the new tab renders. Existing bag/deck one-place-per-card behavior remains intact, and board placement still delegates to `canPlace`/`clampSlot`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 240/240 pass. Dev server inspected at `http://127.0.0.1:5174/?view=deck-build&layoutAudit=1` and `?view=prep&layoutAudit=1` at 720x1280. Captured `deck-build-layout-audit.png`, `deck-build-transfer-held.png`, `deck-build-transfer-returned.png`, and `prep-layout-audit.png`. No `[layout-audit]` console errors; Deck Build only logged the existing missing `favicon.ico` 404.
- **ASSUMPTIONS:** The requested transfer slot supersedes the older "no staging/transition slots" durable decision, but only as a same-tab temporary holder that cannot persist through tab changes and is not stored in run/demo state.
- **REQUESTS TO CLAUDE:** none.
- **OPEN:** none.
- **CLAUDE REVIEW:** _pending_

### 2026-07-16 — Codex — fantasy card icon sheet lock
- CHANGED: Recorded the approved fantasy card icon/border direction, then wired
  the Wiki card sheet to use an assembled example template cropped from the
  approved parts sheet.
- FILES: `src/game/ui/FantasyCardTemplate.ts`,
  `src/game/ui/cardArtPresentation.ts`, `src/game/scenes/BootScene.ts`,
  `public/game-art/card-template-parts.png`,
  `public/game-art/card-template-parts-transparent.png`,
  `docs/codex-handoff.md`, `docs/screenshots/fantasy-card-template-example.png`
- DESIGN: The card sheet now uses a full-bleed neutral matte as the future art
  placeholder, a bronze/silver/gold/diamond WT diamond plate, a left type badge,
  one to three right archetype badges, and the selected ornate tier-specific
  skill-text box. The badges and text box are cropped from the user-approved PNG
  sheet, with a transparent-background derivative used in-game so the icons do
  not sit inside dark square tiles. `CARD_TEMPLATE_LAYOUT` is the tuning
  dictionary for badge size/position, archetype stack, text-box padding, and
  title/body fit rules keyed by title length, skill text length, and effect
  count. The skill-box crop currently needs a +5 px frame center offset to align
  the ornate border with the card/text center. Icon crops were audited as a
  sheet after Crippling Strike exposed a bad right-edge crop; debuff and other
  right-column icons now use corrected bounds. The left badge stack is now
  primary archetype first with the smaller WT diamond underneath; the
  weapon/element type badge occupies the old right-side archetype position, with
  secondary/tertiary archetypes stacked below it. Weapon `beast` displays as
  fangs for the fantasy card UI.
- VERIFY: `npm run typecheck` = clean. Captured the Wiki example at 720x1280
  from `http://127.0.0.1:5173/?view=wiki`.
- ASSUMPTIONS: This is still an example/template pass, not the final art pass;
  the neutral matte will be replaced by actual full-bleed card art later.
- REQUESTS TO CLAUDE: none
- OPEN: User visual approval still controls the final template implementation.
- Claude review:

### 2026-07-19 — Codex — prep fight-card enemy skills and current deck summary
- CHANGED: Updated the Prep loadout tab so the side panel shows the exact current deck being brought into battle instead of an inspect prompt, and the fight card now lists the enemy's resolved skills directly on the card.
- FILES: `src/game/scenes/PrepScene.ts`, `src/game/ui/SkillDetailPanel.ts`, `src/game/ui/controlLayoutAudit.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`
- DESIGN: Prep loadout now treats the right-hand panel as a live deck summary (`CURRENT DECK`) with hero level, PL, damage band, and ordered slot list. The fight card keeps the enemy stat preview but adds an `ENEMY SKILLS` line so the user can see the opponent's actual loadout before launching. Long copy on the Prep page now also runs through the shared layout-audit path so overflow is flagged in strict mode, not hidden.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (279) · visually verified by code inspection only this session.
- ASSUMPTIONS: The summary panel should reflect `demoState.pieces` plus `demoState.heroLevel` only; it does not mutate deck composition. Enemy skills are rendered from the already-resolved `buildEnemyEncounter(...)` preview and do not require engine changes.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-19 — Codex — shared display theme and reusable display library
- CHANGED: Added a reusable display theme token block and a small Phaser display library so the rest of the game can compose panels, compact text blocks, and future stat rows from one shared source.
- FILES: `src/game/theme.ts`, `src/game/ui/displayLibrary.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`
- DESIGN: Shared UI chrome now has a single token source for spacing, panel chrome, and typography, plus a reusable display library with panel-shell and clamped-text helpers. Prep now consumes the shared panel shell helper and the clamped text helper instead of hardcoding those pieces in the scene.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (279)
- ASSUMPTIONS: This is the first reusable display layer pass; I kept the scope to theme tokens plus a few panel/text primitives so Battle and future scenes can opt in gradually rather than forcing a broad refactor.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-15 — Codex — reference-style borderless fantasy card template and Wiki sheet
- CHANGED: Rebuilt the reusable, art-free card template around the user-approved diamond-and-ornate-text-box reference and changed Wiki card taps to open a full card sheet instead of filling the persistent INSPECT panel.
- FILES: `src/game/ui/FantasyCardTemplate.ts`, `src/game/ui/cardArtPresentation.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BootScene.ts`, `docs/codex-handoff.md`
- DESIGN: The template renders no card image, substitute texture, or outer edge frame. It only lays the reference overlays over the future full-bleed art space: tier-colored diamond `WT` plate, diamond weapon/element plate, one to three diamond archetype plates, and a translucent double-line ornamental skill box with top/bottom diamond caps. Bronze, silver, gold, and diamond each use a dedicated plate palette. Wiki hides its permanent inspect pane and opens this same card-sheet interaction instead.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (240) · `git diff --check` = clean. Local dev server started at `http://127.0.0.1:5173/?view=wiki&layoutAudit=1`; the in-app preview connection failed before a screenshot could be captured, so the user is performing the on-screen visual review.
- ASSUMPTIONS: The template is intentionally transparent through the future art area. The dark page backdrop comes from the modal overlay and is not part of the card template.
- REQUESTS TO CLAUDE: none
- OPEN: Validate the template visually at portrait size before propagating it to compact cards or the combat sheet.
- Claude review:

### 2026-07-15 — Codex — symmetric battle columns and inset roster selection
- **CHANGED:** Rebuilt the battle board's horizontal grid so Party and Enemies are equal 202-pixel lanes, Turn Log is a wider 236-pixel lane, and all three use consistent 12-pixel gaps. Headers now share exact edges with their roster, detail, and log panels.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/superpowers/specs/2026-07-15-symmetric-battle-columns-design.md`, `docs/superpowers/plans/2026-07-15-symmetric-battle-columns.md`, `docs/screenshots/battle-symmetric-columns.png`, `docs/screenshots/battle-symmetric-columns-multi.png`.
- **DESIGN:** Player and enemy card rails are now symmetrical. Selected roster chips keep a fixed 1-pixel outer border and use a 3-pixel interior accent plus fill tint, so focus never changes panel dimensions. Party and enemy accents participate in damage shake, three-chip width remainders are distributed without a trailing gap, and the log feed uses the same 1-pixel outline as its header/detail panel.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 240/240 pass. Playwright checked clean 720x1280 single- and two-enemy scenes with no page errors; the second enemy was selected to verify stable dimensions and inset highlighting.
- **ASSUMPTIONS:** HP bars and card faces retain intentional internal gutters; only direct panel edges align with lane headers.
- **REQUESTS TO CLAUDE:** None. No combat, data, or engine changes.
- **OPEN:** The log column's vertical fill remains a separate follow-up; this pass intentionally preserves current row height and control positions.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — attached and expanded Turn Detail panel
- **CHANGED:** Removed the blank gap beneath `TURN LOG` by attaching the selected-turn detail panel directly to the lane header, aligning it to the log-row width, and expanding its height from 174 to 234 pixels.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/superpowers/specs/2026-07-15-attached-turn-detail-design.md`, `docs/superpowers/plans/2026-07-15-attached-turn-detail.md`, `docs/screenshots/battle-turn-detail-attached.png`, `docs/screenshots/battle-turn-detail-attached-multi.png`.
- **DESIGN:** The panel now shares the log rows' x=212 and 212-pixel width. It gives activation text four lines, aura/effect credit its own two-line region, result text three lines, and the calculation strip 38 pixels with two-line token wrapping. Its bottom edge remains at y=382, so the log feed still starts at y=394 and no lower controls move.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 240/240 pass. Playwright checked the 720x1280 Bandit Duelist and two-enemy scenes with populated `PLAY` details, clean canvas rendering, no overlap, and no Phaser runtime errors (the existing missing favicon request still returns 404).
- **ASSUMPTIONS:** Turn Detail remains a presentation-only view of `ActivationRow` data already derived from the engine event log.
- **REQUESTS TO CLAUDE:** None. No engine, data, or combat-rule change is required.
- **OPEN:** Claude should preserve the panel bottom edge if future detail fields are added, unless the log-feed geometry is intentionally redesigned.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — persistent Aura View and source-colored combat logs
- **CHANGED:** Added persistent printed-board aura overlays, an `AURA ON/OFF` battle toggle, structured aura-source presentation, source-colored compact/selected log terms, and selected-row source/reach highlighting.
- **FILES:** `src/game/ui/auraPresentation.ts`, `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/plans/2026-07-15-aura-display-foundation.md`, `docs/screenshots/battle-aura-view.png`, `docs/screenshots/battle-aura-log-source.png`.
- **DESIGN:** Printed auras are visible from battle start. Source borders match element/property color; reached cards use thin green/red/amber edge markers based on modifier polarity. Aura View hides only persistent overlays, while hover and selected logs still reveal reach. `play.auras` remains authoritative for colored source credit and exact source-slot highlighting.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; baseline `npm test` 240/240 pass. Playwright inspected 720x1280 Bandit Duelist and two-enemy states with zero runtime errors; `AURA OFF`, enemy focus, selected War Banner contribution, source border, affected-card marker, and source-colored `+5 DMG` were exercised.
- **ASSUMPTIONS:** Current `play.auras` sources belong to the casting `(side, unit)`, as documented. Persistent overlays cover printed board auras only.
- **REQUESTS TO CLAUDE:** #8 remains pending for opponent-placed aura lifecycle, timed card/unit effects, counters, removal reasons, and per-calculation contribution fields.
- **OPEN:** Do not add placed-aura or timed-effect UI state until Request #8 supplies authoritative events.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — persistent aura and source-colored effect-log design
- **CHANGED:** Documented the approved distinction between persistent directional auras, timed card effects, and timed unit effects; added Claude Request #8 for the authoritative event contract needed by the UI.
- **FILES:** `docs/superpowers/specs/2026-07-15-aura-effect-log-design.md`, `docs/codex-handoff.md`.
- **DESIGN:** Aura borders remain visible until explicit removal or Aura View is toggled off. Card and unit effects retain visible turn counters. Compact logs name every source; selected rows show the full supplied calculation, with source labels and modifier tokens accented to match the providing card.
- **VERIFY:** Documentation self-review only; no runtime code changed.
- **ASSUMPTIONS:** Existing aura direction/reach/filter rules apply from an opponent-board anchor. The anchor remains excluded unless the engine's authoritative affected-target list includes it.
- **REQUESTS TO CLAUDE:** #8.
- **OPEN:** UI implementation waits for the lifecycle and contribution fields; current hover-only aura reach remains unchanged.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Claude — auras/gems/combo made FLAT (no % except crit) + shown in log
- WHY: user — "aura is supposed to be a flat gain too, not %; we don't want % unless it's crit." Extends the flat model to the modifier layer.
- **BREAKING FIELD RENAMES (Codex UI reads these):**
  - `AuraDef.mods` and `StatGemMods.card`: **`damagePct` → `damageFlat`, `healPct` → `healFlat`** (flat points, not %). `weightDelta` unchanged; `critPctDelta` UNCHANGED (crit stays %).
  - `AuraMods` and `AuraSource` (the `play.auras` breakdown + `skillCast.auras`): same `damagePct→damageFlat`, `healPct→healFlat`.
  - `comboBonus` Action: **`pct` → `amount`** (flat bonus damage).
  - `DamageCalculation.effectPct` **removed** (there's no % anymore); `effectBonusDamage` is now the FLAT aura+combo bonus in HP. Codex's calc row already shows it as `+FX<n>`.
  - `formatAuraModifiers`/`describeAura` already updated to flat wording ("+5 damage", "+10 shared-archetype damage"). If your code reads `aura.damagePct`/`healPct` or `combo.pct` directly anywhere, switch to the flat fields.
- ENGINE: damage = `power + stat + (aura/gem damageFlat) + (combo flat)`, then crit ×1.5 (chance-capped) and matchup ± — **crit and matchup are the ONLY multipliers left**. Non-true heals add `healFlat` flat.
- PRICING (audits still green): `PRICE.auraDamageFlat`/`auraHealFlat` = 20 deci/pt (steeper than a card's own flat damage since it applies every cast the aura reaches); `comboPerPoint` = 5. Data renumbered to stay on-budget: War Banner +25%→**+5 flat**, Follow-Through combo +150%→**+10 flat**, empowering_core→**+3**, restorative_core→**+4**, war_banner_echo→**+2**, follow_through_echo→**+8**. lucky_charm (crit) + time_crystal (weight) unchanged.
- LOG: aura activation already surfaces — `play.auras` → `formatAuraModifiers` renders `Aura: War Banner · +5 DMG`; combo/aura flat shows as `+FX<n>` in the damage calc row.
- VERIFY: `npm test` 240/240 · typecheck clean · build passes · Playwright: combat log shows `+FX10` combo + aura lines, no console errors.

### 2026-07-15 — Codex — Wiki/Cards and Wiki/Opponents hierarchy
- **CHANGED:** Returned the main navigation to three tabs (`DECK/BAG/WIKI`) and moved Cards/Opponents into compact controls inside the Wiki panel header. Wiki remains visibly active for either section.
- **ROUTES:** Preferred direct launch values are `?view=wiki/card` and `?view=wiki/opponents`. Legacy `wiki`, `codex`, and `opponents` values still resolve for existing tooling.
- **CAPACITY:** Header placement consumes no catalog height, so Cards remains 10 per page and Opponents remains 8 per page with its complete scenario toolbar.
- **FILES:** `src/game/devLaunch.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/screenshot-howto.md`, `docs/superpowers/specs/2026-07-15-wiki-subtabs-design.md`, `docs/superpowers/plans/2026-07-15-wiki-subtabs.md`, `docs/screenshots/wiki-cards-subtab.png`, `docs/screenshots/wiki-opponents-subtab.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 240/240 pass. Both hierarchical direct routes and Cards→Opponents→Cards switching were exercised at 720×1280 with strict audit mode: zero layout-audit errors, no overflow, and no runtime errors.
- **REQUESTS TO CLAUDE:** Prefer the new hierarchical view values in future screenshot/debug links.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Claude — aura reach/direction visualization + clearer description
- WHY: the engine already supports directional (`adjacent`/`left`/`right`/`allBoard`) + ranged (`reach`) auras, but nothing showed which cards an aura reaches, and the hover text was terse.
- NEW ENGINE (shared, so UI + combat use ONE coverage rule): `src/engine/combat/auras.ts` now exports `auraCovers(source, target, affects, reach)` (pure footprint math, `covers()` delegates to it) and `auraAffectedTargetSlots(source, targets, skillBook)` → the covered+filtered target slots. Verified against the combat resolver in a test.
- PRESENTATION: `describeAura` reworked to spell out direction + range as a noun phrase, e.g. `Offense cards touching this one on either side — +25% damage` / `Magical cards up to 2 slots away to the left — …`. New `describeAuraRange` helper. Flows into the Prep inspect panel + Battle card modal (both already call `describeAura`).
- UI (your layer — done by me, review welcome): hovering an aura board card draws borders on the cards it reaches — source outlined green (`UI.good`), each affected card outlined `UI.chip` — in BOTH `PrepScene` (deck rail + active-deck) and `BattleScene` (per-side board). Transient overlays cleared on hover-out / re-render (`showAuraReach`/`clearAuraReach` in each scene). Positions are recomputed from slot geometry, so no card-ref plumbing needed.
- VERIFY: `npm test` 240/240 (+2 coverage tests) · typecheck clean · build passes · Playwright: prep hover on War Banner borders it + the touching Sword Slash (Crippling Strike a gap away correctly excluded), inspect shows the new range text; battle hover mirrors it. No console errors.
- NOTE FOR CODEX: `auraAffectedTargetSlots` is the canonical "who does this aura hit" helper — reuse it if you build a fancier aura overlay (e.g. always-on faint reach hints, or arrows). Source vs affected are both greenish right now; a distinct affected color is an easy polish if you want it.

### 2026-07-15 — Codex — Opponent Level/Title/Tier scenario preview
- **CHANGED:** Added a shared two-row scenario toolbar to Opponents: Level 1–50, Title (`MOB/NORMAL/ELITE/BOSS`), and explicit Card Tier (`BRONZE/SILVER/GOLD/DIAMOND`). There is no Auto tier. Defaults are Level 1/Normal/Bronze; CLEAR restores all three.
- **RESOLUTION:** UI first calls `buildEnemyEncounter` to obtain title-added cards, converts the selected uniform tier into deck-wide rank steps, then calls the builder again with that rank override. Effective level, title stat delta, extra cards, board size, per-card tier values, and total PL all come from the resolved encounter.
- **PRESENTATION:** Every tile now uses the selected scenario title instead of authored `isElite`/`isBoss` tags and shows effective level, tier, expanded rotation summary, card count, and PL. The detail sheet expands for title-added cards and presents the full scenario rotation with resolved card values.
- **ISOLATION:** Preview controls are `PrepScene` fields only. They never write Deck's `enemyTeam`, `enemyId`, level, rank, title, or modifiers.
- **FILES:** `src/game/scenes/PrepScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/specs/2026-07-15-opponent-scenario-preview-design.md`, `docs/superpowers/plans/2026-07-15-opponent-scenario-preview.md`, `docs/screenshots/opponents-scenario-default.png`, `docs/screenshots/opponents-scenario-boss-diamond.png`, `docs/screenshots/opponent-detail-boss-diamond.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. Default Level 1/Normal/Bronze, Level 2/Boss/Diamond, expanded four-card detail, and CLEAR reset were visually exercised at 720×1280. Strict audit reported zero spacing errors and no overflow.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Claude — actual DMG/turn in the battle side-panels
- WHY: extend the prep-screen damage-per-turn idea into the battle screen so the REALIZED per-side output of the fight is visible for balancing.
- NEW: `BattleScene.actualDamagePerTurn(side)` sums damage the side inflicted on the opposing side (direct + DoT) from the resolved event log and divides by turns elapsed — the honest realized output (no re-simulation). Appended as `· DMG/t N` to each side panel's `N skills · PL X` line.
- DISTINCTION: Prep shows the *theoretical* band vs an inert dummy (`run/analysis.ts`); Battle shows the *actual* realized average from the fight that just resolved. Complementary.
- VERIFY: `npm test` 238/238 · typecheck clean · build passes · Playwright: both panels render `DMG/t` without overlap (e.g. hero 19 vs elite bandit 78 — explains the loss).
- REVIEW of Codex's OwnedCard/enemyTeam/Opponents refactor: coherent and green. `enemyTeam: EnemyFightConfig[]` drives Battle (falls back to legacy fields) and calls `buildEnemyEncounter(id, level, title, rank)`; `OwnedCard` (instanceId + per-instance tier) integrates with my tier code — player pieces now carry `tier:'bronze'` so `applyTier`/`resolveEffectiveSkill` no-op for them. No issues found (one transient mid-edit typecheck error self-resolved).

### 2026-07-15 — Codex — reference-only Opponents tab
- **CHANGED:** Added `OPPONENTS` as the fourth Prep tab and rebalanced the tab bar into four equal mobile controls. Direct launch is `?view=opponents`.
- **CATALOG:** Shows eight authored opponents per page in a 2×4 grid. Tiles expose identity, base HP/Speed/offense/defenses, affinity, base cards, and rewards. The catalog is alphabetical and explicitly marked reference-only.
- **DETAIL:** Tapping a tile opens a dynamically sized ledger sheet with full base stats, affinity/counter, rewards, and exact authored card rotation. Card rows show property, weight, slot size, start slot, and canonical actions. Two-card enemies use a shorter sheet; three-card enemies expand without overflow.
- **SAFETY:** Browsing and opening details never writes `enemyTeam`, `enemyId`, level, title, rank, or modifiers. Actual encounter selection remains on Deck.
- **FILES:** `src/game/demoState.ts`, `src/game/devLaunch.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/screenshot-howto.md`, `docs/superpowers/specs/2026-07-15-opponents-reference-tab-design.md`, `docs/superpowers/plans/2026-07-15-opponents-reference-tab.md`, `docs/screenshots/opponents-catalog.png`, `docs/screenshots/opponent-detail.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. Direct-launch catalog, second-page navigation, and Bandit detail sheet checked at 720×1280 in strict audit mode: zero layout-audit errors, no overflow, and no runtime errors.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — ten-card Wiki catalog
- **CHANGED:** Removed the duplicate enemy Scout Strip from Wiki and expanded Card Wiki into that space. Full pages now show ten unchanged 308×118 card tiles in a 2×5 grid instead of six.
- **BOUNDARY:** Enemy setup/scouting remains on Loadout; Wiki is now exclusively card discovery, filtering, tier preview, copy counts, adding to Bag, and inspection.
- **FILES:** `src/game/scenes/PrepScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/specs/2026-07-15-expanded-wiki-catalog-design.md`, `docs/superpowers/plans/2026-07-15-expanded-wiki-catalog.md`, `docs/screenshots/wiki-ten-card-catalog.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. 720×1280 strict spacing-audit preview shows ten cards with unchanged type, no overlap into Inspect, no overflow, and zero layout-audit errors.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — compact Wiki filter ledger
- **CHANGED:** Rebuilt the filter modal as a 612×430 floating ledger. A single dark header carries the title/guidance/close action; all five category labels now share one horizontal row with their chips; one footer divider separates CLEAR and APPLY.
- **DESIGN:** Removed the tall stacked-label treatment and large empty areas. The sheet now uses one thin frame, one tinted shadow, a forest edge spine/active state, compact 48px row rhythm, and no nested row panels.
- **BEHAVIOR:** Draft selection, AND semantics, close/overlay cancel, CLEAR, APPLY, active-filter count, and page reset are unchanged.
- **FILES:** `src/game/scenes/PrepScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/specs/2026-07-15-compact-wiki-filter-modal-design.md`, `docs/superpowers/plans/2026-07-15-compact-wiki-filter-modal.md`, `docs/screenshots/wiki-filter-compact.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. 720×1280 strict layout-audit preview is clean: zero spacing errors, no red controls, and no modal overflow.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — automatic UI spacing audit
- **CHANGED:** Added a reusable control-label guard that measures rendered Phaser text against its button/chip rectangle, preserves minimum horizontal/vertical clearance, and reduces label type in 1px steps only when needed. Audit results are stored on each control.
- **STRICT MODE:** `?layoutAudit=1` turns any remaining violation into a red outline plus `[layout-audit]` console error. Added the shared workflow at `docs/ui-spacing-audit.md` and made it a required AGENTS verification step for changed controls.
- **COVERAGE:** Prep tabs, footer buttons, modal buttons, compact steppers/arrows, Wiki tier chips, filter button, filter close button, and every filter choice now use the guard.
- **FILES:** `src/game/ui/controlLayoutAudit.ts`, `src/game/scenes/PrepScene.ts`, `docs/ui-spacing-audit.md`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `AGENTS.md`, `docs/screenshots/wiki-spacing-audit.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. Wiki + open five-row filter sheet checked at 720×1280 with strict audit mode: zero layout-audit errors, no red controls, and no runtime errors.
- **REQUESTS TO CLAUDE:** Use `layoutAudit=1` when visually reviewing Codex UI changes; treat any red control or console error as a blocker.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — Wiki card filters
- **CHANGED:** Added a compact Wiki filter sheet for Role, Property, Weight, Card Size, and Sort. Categories combine with AND logic; CLEAR resets the draft, close discards it, APPLY returns to page one, and the header reports both matching-card count and active-filter count. Ownership is intentionally not a filter.
- **SEMANTICS:** Role is derived from authored archetypes/effects; Property and Card Size read the authored card definition; Weight uses `weightOf`; PL sorting uses the selected tier through `applyTier` and `powerLevel`. No combat values are recomputed in UI code.
- **FILES:** `src/game/scenes/PrepScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/specs/2026-07-15-wiki-card-filters-design.md`, `docs/superpowers/plans/2026-07-15-wiki-card-filters.md`, `docs/screenshots/wiki-filter-sheet.png`, `docs/screenshots/wiki-filtered-cards.png`, `docs/screenshots/wiki-filtered-size.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. 720×1280 Playwright preview opened the five-row sheet, applied a 2-slot size filter (7 matching cards across two pages), and confirmed no overflow or runtime errors. Combined Attack + Magical + Light + Weight filtering and empty-result messaging were also exercised.
- **REQUESTS TO CLAUDE:** None beyond existing Request #7 card-name audit.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — tiered Wiki catalog with duplicate card instances
- **CHANGED:** Rebuilt the Wiki as six uniform catalog tiles per page. Every tile shows property, amber weight, PL, canonical color-coded action verbs with exact effects, BAG/DECK copy counts, and `+ BAG`/`BAG FULL`. Added Bronze/Silver/Gold/Diamond preview through the run-layer `applyTier` resolver.
- **INSTANCE MODEL:** Bag and player board cards now carry stable sequential `instanceId`, stable authored `skillId`, and per-copy `tier`. Duplicate skills are allowed; adding creates a new instance, and dragging between bag/deck preserves identity and tier. Gem targeting now resolves by instance ID so duplicate copies cannot inspect or socket the wrong card.
- **FILES:** `src/game/demoState.ts`, `src/game/scenes/PrepScene.ts`, `src/game/theme.ts`, `src/game/ui/SkillDetailPanel.ts`, `src/game/ui/cardActionPresentation.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/specs/2026-07-15-tiered-card-wiki-design.md`, `docs/superpowers/plans/2026-07-15-tiered-card-wiki.md`, `docs/screenshots/wiki-tiered-catalog.png`, `docs/screenshots/wiki-duplicate-tiers.png`, `docs/screenshots/bag-duplicate-tiers.png`, `docs/screenshots/wiki-tier-copy-in-deck.png`.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. Playwright at 720×1280 previewed Silver values, added Bronze and Silver Arcane Bolt copies (`card_011`/`card_012`), moved the Silver copy into board slot 9, and confirmed its Silver PL/effects/instance ID remained intact with no overflow or runtime errors. Bag-full controls also disable correctly at 10/10.
- **REQUESTS TO CLAUDE:** Request #7: rename generic display names such as `Follow-Through` in data while preserving stable IDs. The Wiki should not maintain a parallel alias map.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — lighter Prep controls and card surfaces
- **CHANGED:** Reduced the heavy resting outlines across Prep tabs, cards, slots, chips, modals, and footer actions. Added restrained offset shadows to cards and major buttons, then rebuilt enemy LV/RANK and hero LV controls as separately grouped steppers with fixed internal spacing.
- **FILES:** `src/game/scenes/PrepScene.ts`, `src/game/ui/CardView.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/superpowers/specs/2026-07-15-prep-control-polish-design.md`, `docs/superpowers/plans/2026-07-15-prep-control-polish.md`, `docs/screenshots/prep-control-polish.png`.
- **DESIGN:** Resting borders are now 1-2 px and highlights remain stronger. Shadows are limited to cards, tabs, footer actions, and sheets; repeated tiny controls stay flat to avoid visual noise. Group backgrounds keep labels and values away from minus/plus buttons without changing the mobile panel footprint.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. Playwright at 720×1280 exercised enemy level/rank controls and captured the full Prep screen with no overlap, overflow, or runtime errors.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — Prep fight setup now launches the selected enemy team
- **CHANGED:** Added a one/two-enemy selector to CHOOSE FIGHT. Each foe keeps an independent enemy id, level, title, rank, and reserved modifier list while the player switches between foe tabs. FIGHT now commits that ordered team, and Battle resolves every foe from its own saved setup instead of applying one global enemy configuration to the whole roster.
- **FILES:** `src/game/demoState.ts`, `src/game/devLaunch.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/screenshots/prep-enemy-team.png`, `docs/screenshots/prep-enemy-duo.png`, `docs/screenshots/battle-from-prep.png`.
- **DESIGN:** Compact named foe tabs fit in the existing mobile scout header. `+ FOE 2` adds a second independently editable opponent; `×` returns the encounter to solo. The header always lists the ordered matchup so the player can confirm the fight before launching.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass. Playwright at 720×1280 added Giant Rat as foe 2, raised only its level from 1 to 3, launched FIGHT, and confirmed Battle loaded Bandit Duelist + Giant Rat with their distinct HP/SPD/decks and no runtime errors or overflow.
- **REQUESTS TO CLAUDE:** Preserve `DemoState.enemyTeam` as the Prep → Battle handoff shape if run-state replaces demo state; each entry needs stable enemy id + independent level/title/rank/modifiers.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — slower playback controls
- **CHANGED:** Added `1×`, `2×`, and `TO END` controls beneath the combat log and slowed the base playback cadence.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** `1×` reveals rows every 300 ms and waits 800 ms plus row time before the next turn. `2×` halves playback, HP, log, cast, shake, float, and banner timing. `TO END` cancels delayed visual work, resolves remaining engine events instantly, synchronizes HP, and opens the final log page.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass; `git diff --check` clean.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — default enemy focus and stronger HP roster
- **CHANGED:** Multi-enemy battles now load with enemy 1 focused and use clearer two-line roster cards.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** The selected enemy board is visible immediately. Each enemy roster card shows `NAME · SPD` on its first line and larger bold animated `HP current/max · R` beneath it; tapping another enemy swaps the full-width board.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 238/238 pass; `git diff --check` clean.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Claude — real simulated Damage-Per-Turn band (balancing readout)
- WHY: user wants a REAL (not estimated) average damage-per-turn for balancing, shown as a range.
- NEW: `src/run/analysis.ts` → `damagePerTurn(setup, skillBook, {turns=10, seeds=16})` returns `{avg, min, max, turns}`. It actually runs `simulate()` for `turns` turns against an inert, defenseless, board-less **training dummy** (so sudden-death — which needs both sides to perform — never triggers; cooldowns stay ON to match real play), sums every point the combatant deals (direct hits + poison/burn ticks), and reports the low–high band across seeds (crit is the only variance). Intrinsic throughput vs a neutral dummy — comparable across builds/enemies; armor/matchups are separate axes.
- UI: PrepScene shows it live (memoized by a stable signature). Enemy: red **`DMG/turn X–Y`** on the CHOOSE FIGHT stat block. Hero: `DMG/turn X–Y` appended to the DECK BUILDER hero-stat line. Reflects level/rank/title (e.g. L10 BOSS bandit ≈ 98–114/turn vs the auto-hero ≈ 32–41/turn — the comparison that explains the fast losses).
- FYI FOR CODEX: `damagePerTurn` is a pure run-layer helper — reuse it anywhere you want a throughput readout (e.g. a battle-result or card-compare screen). Cheap (~4ms/call); memoize if calling per-frame.
- VERIFY: `npm test` 238/238 (+7 analysis tests: determinism, positive band, min≤avg≤max, crit spread, 0 for defensive builds, DoT counted, rank/level monotonic) · typecheck clean · Playwright: both readouts render without overlap/errors.

### 2026-07-15 — Codex — HP animation synchronized to logs
- **CHANGED:** Added animated HP bars/numbers and aligned damage/healing feedback with each grouped log row's reveal delay.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** Visible HP now counts and eases from its prior value to authoritative `hpAfter` over 180 ms as the matching action row appears. Damage numbers and panel shake fire on the same beat; enemy roster HP follows the animated value instead of jumping early.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass; `git diff --check` clean.
- **REQUESTS TO CLAUDE:** None; the UI still reads engine `hpAfter` and does not calculate damage.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — content-aware log pacing
- **CHANGED:** Replaced the fixed 650 ms turn interval with pacing based on how many grouped log rows the turn produces.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** New rows reveal 190 ms apart. The next turn waits 520 ms plus 190 ms for every newly revealed row, allowing multi-cast/effect-heavy turns to breathe without making simple turns equally slow.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — damage panel hit reaction
- **CHANGED:** Added short damage-driven shake feedback to hero and enemy panels during progressive playback.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-handoff.md`.
- **DESIGN:** Actual HP damage shifts the affected visible board side-to-side for roughly 200–300 ms; crits and larger relative hits move slightly farther. Multi-enemy roster cards also shake, so a hidden enemy rotation still communicates which target was hit. Motion is ignored during instant replay application and always restores original positions.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass; `git diff --check` clean.
- **REQUESTS TO CLAUDE:** None; this consumes existing `damage` events and does not alter simulation timing or values.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — progressive battle playback
- **CHANGED:** Replaced immediate full-log resolution with timed turn-by-turn playback and promoted sudden death/fatigue to explicit timeline steps.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** Every 650 ms the next complete global turn updates readiness, HP, statuses, highlights, and newly revealed log rows. The result badge appears only when playback reaches `combatEnd`. Engine `suddenDeathStart` now renders as `SUDDEN DEATH · Damage escalation has begun`; fatigue receives its own named step.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass; `git diff --check` clean.
- **REQUESTS TO CLAUDE:** None; playback reads the existing deterministic event stream without recomputing combat.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — removed duplicate turn footer
- **CHANGED:** Stopped repeating the selected turn summary in the bottom helper strip.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-handoff.md`.
- **DESIGN:** Turn details now appear only in the selected-turn panel and log. The bottom strip remains dedicated to card inspection and enemy-selection guidance.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — compact calculation labels
- **CHANGED:** Split the selected-turn math strip into separate value and label tokens.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-handoff.md`.
- **DESIGN:** Damage values and the final result remain prominent; terms such as `BASE`, `ATK`, `MAG`, `DEF`, `BUFF`, and `CRIT` render as smaller muted captions so the formula is easier to scan.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — ownership-neutral card information
- **CHANGED:** Removed `YOUR CARD` / `ENEMY CARD` wording from combat card inspection and replaced it with generic card information plus optional board-slot context.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`.
- **DESIGN:** Hover summaries and the full sheet now describe the card itself, so the same information hierarchy can be reused in combat, Bag, and Wiki without implying ownership.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Codex — focused multi-enemy card rotations
- **CHANGED:** Replaced simultaneous narrow enemy boards with a focused-deck pattern. Every enemy remains visible as a live HP/readiness roster card, while the ten-slot rotation stays hidden until that enemy is selected.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/screenshots/battle-enemy-hidden.png`, `docs/screenshots/battle-enemy-focused.png`.
- **DESIGN:** Tapping an enemy roster card reveals its full-width board and selected outline. Tapping an enemy log action automatically opens the correct enemy rotation and preserves exact card highlighting through `(side, unit)`. The empty lane explains how to inspect a rotation instead of showing compressed card columns.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; `npm test` 231/231 pass; inspected hidden and focused states at 720x1280 with no board or roster overflow.
- **REQUESTS TO CLAUDE:** None; this uses the existing unit-indexed playback contract.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Claude — Enemy scaling: LEVEL / RANK / CARDS dials + titles reworked
- WHY: user wants enemy power on three dials, with titles as presets and ranks upgrading cards to higher PL. Builds on the flat model (below).
- MODEL: enemy power = **level** (flat stats) + **rank** + **cards**.
  - **RANK** = tier-steps summed across the deck, distributed round-robin (rank 3 on a 2-card deck = one Gold + one Silver card; max = deckSize×3). Each step upgrades a card one tier (Bronze→Silver→Gold→Diamond); the card's magnitudes scale so its PL lands on the tier budget (15/20/25). Stored on `BoardPiece.tier`; the engine's `resolveEffectiveSkill` (via new exported `applyTier`) applies it.
  - **CARDS** = titles add extra cards from a shared pool keyed by the enemy's card property (`EXTRA_CARD_POOL` in encounter.ts).
  - **TITLES** are now presets `{levelDelta, rank, extraCards}` (no more gems): Mob −1lv/0/0 · Normal 0/0/0 · Elite +2lv/rank2/+1 card · Boss +4lv/rank4/+2 cards.
- CHANGED: `src/engine/cards.ts` (new `applyTier`; `resolveEffectiveSkill` folds tier then gem), `src/run/encounter.ts` (`TITLE_PRESETS` reworked; `assignRankTiers`, `maxRankFor`, `MAX_TIER_STEPS`; extra-card pool; `buildEnemyEncounter(id, level, title, rank?)` now returns `rank`), `src/game/demoState.ts` (+`enemyRank`), `src/game/devLaunch.ts` (+`rank` URL param), `src/game/scenes/PrepScene.ts` (RANK stepper in CHOOSE FIGHT; title chips preset rank; resolved-deck line shows per-card tier tags + PL), `src/game/scenes/BattleScene.ts` (enemy board cards render via `applyTier`; roster sublabel shows `R<rank>`).
- FYI FOR CODEX (your layer, done by me — review welcome): enemy board token uses `piece.tier ? applyTier(base, piece.tier) : base`. `applyTier` is a **no-op for players** (no `piece.tier`), so player rendering is unchanged; gems still surface via the inspect modal. Thanks for already adapting the calc rows to the flat model — Request #16 is effectively handled.
- VERIFY: `npm test` 231/231 (+6 rank/tier tests) · typecheck clean · build passes · sim: rank 3 → Gold+Silver (pow 40/15), max rank → Diamond (pow 50/25); boss = 4-card deck of silver cards, combat damage reflects tiers. Playwright: CHOOSE FIGHT shows LV+RANK steppers + resolved deck tiers, no overlap/errors.
- OPEN: extra-card pool is a small shared list (swap to per-enemy authored lists later if desired); modifiers axis still a reserved no-op slot.

### 2026-07-15 — Codex — expanded turn math and card inspection sheet
- **CHANGED:** Enlarged the selected-turn panel and separated action, result/readiness, and damage math into clear visual bands. Rebuilt the battle card modal as a full mobile card sheet with owner/slot, semantic tags, effective weight/size/cooldown, total PL, authored effect text, aura reach, and socketed gem contribution.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/screenshots/battle-turn-detail.png`, `docs/screenshots/battle-turn-calculation.png`, `docs/screenshots/battle-card-modal.png`.
- **DESIGN:** Calculation rows now expose the flat model in reading order (`BASE + ATK/MAG + BUFF/FX - DEF ... = HP damage`) without recomputing combat. The modal reads effective card metadata through engine helpers and only closes from the X or outside the sheet.
- **VERIFY:** `npm run typecheck` clean; `npm run build` pass; 720x1280 turn-selection/card-modal interaction captures inspected with no layout overflow or runtime page errors. `npm test` currently has 224/225 passing: the one failure is Claude-owned `tests/run/encounter.test.ts` still expecting boss title gems after `src/run/encounter.ts` replaced title gems with rank tiers/extra cards.
- **REQUESTS TO CLAUDE:** Request #16 is complete. Please reconcile the stale boss-gem encounter assertion with the new rank/title contract when that in-progress engine pass settles.
- **CLAUDE REVIEW:** _pending_

### 2026-07-15 — Claude — FLAT combat model (rebalance: damage no longer out-scales HP)
- WHY: at high level the %-of-stat damage model made damage out-scale HP — a L20 hero lost to a same-level bandit on turn 1, and a L23 bandit one-shot a L20 hero. User chose to go fully flat.
- CHANGED (engine/data/run — determinism-critical core touched, all audits green):
  1. **`src/engine/combat/interpreter.ts`** — `damage = card.power (flat base) + scaleStat` (Attack/MagicPower/higher-for-TRUE), added flat, never multiplied. Non-TRUE heal/shield = `power + stat`; TRUE heal/shield stay pure flat. Bounded multipliers unchanged (aura+combo %, crit ×1.5, matchup ±). New **`CRIT_CHANCE_CAP_PCT = 50`** clamps effective crit chance.
  2. **`src/engine/balance.ts`** — new `PRICE.flatPowerPerPoint = 5` (2 flat = 1 PL); `damage` + non-TRUE `heal`/`shield` priced at `power×5`; TRUE heal/shield keep `flatTruePerPoint`. Rate went ×0.5(per %) → ×5(per flat), exactly 10×, so converting every non-TRUE `power` by **÷10** preserved every card's & gem's PL — **balance + gem audits stay green unchanged**.
  3. **`src/data/skills.ts` + `src/data/gems.ts`** — all damage/heal/shield `power` ÷10 (e.g. sword_slash 200→20; echo gems 40→4 / 80→8 / 120→12 / 160→16); TRUE heal/shield unchanged (second_wind 45, prism_barrier 65). Card/gem **text rewritten**: `Deal 20 (+Attack) …` (no more `%`).
  4. **`src/engine/combat/events.ts`** — `DamageCalculation.powerPct` **renamed → `power`** (now the flat base). ← see Request #16 for Codex.
  5. **`src/run/leveling.ts`** — offense curve softened for the flat model: `attack`/`magicPower` STAT_INCREMENT `2 → 1` per point (HP still +10), and `critPct 2 → 1` (pairs with the 50% cap). Keeps HP outgrowing hit size so fights stay multi-turn.
- VERIFY: `npm test` = 225/225 (22 combat assertions recomputed for flat; +2 new regression tests in `tests/run/scaling.test.ts`) · `npm run typecheck` clean · sim: same-level hero-vs-bandit is now 5–9 turns at L1/L20/L50 (was turn-1), no one-shots. WHO wins still isn't asserted (per the locked "winrate is not a balance target" philosophy — the auto-generalist hero legitimately loses to the glass-cannon bandit; that's a build matchup, now a readable multi-turn fight).
- REQUESTS TO CODEX: **#16** (rename `powerPct`→`power` in BattleScene; card text has no `%`).
- OPEN: Phase 2 (enemy ranks = per-card tier-up to Silver/Gold/Diamond PL, titles/modifiers adding cards) is next, per the approved plan.

### 2026-07-14 — Claude — fight-setup scaling: hero level + enemy level/title/modifier slot
- CHANGED (run layer + `src/game/` by user direction — Codex please review):
  1. **Enemy TITLE system (run layer, resolver-seam — no combat-loop change).** `src/run/encounter.ts` now exports `EnemyTitle` (`mob`/`normal`/`elite`/`boss`), `TITLE_PRESETS` (level delta + gem list), `ENEMY_TITLES`, `defaultTitleFor(enemy)`. `buildEnemyEncounter(id, level, title='normal')` applies the preset: `effectiveLevel = max(1, level + delta)` (mob −1, normal 0, elite +2, boss +4), scales via existing `scaleMonsterToLevel`, then sockets the title's gems onto the first CASTABLE (non-pure-aura, ungemmed) board cards in slot order. **Pieces are cloned — shared `EnemyDef.pieces` is never mutated.** Return shape gained `effectiveLevel` + `title` (the old `level` field still = the requested/display level; existing callers/tests unaffected). Boss/elite Silver/Gold tier-up still deferred (needs tier-up content).
  2. **Hero level (auto-allocated stand-in).** New `buildAutoHeroSetup(level, pieces)` spends the level's points via the flat `DEFAULT_PROFILE` so a chosen hero level honestly changes stats before the real stat-sheet UI exists.
  3. **`demoState` fight-setup fields:** `heroLevel`, `enemyLevel`, `enemyTitle`, `enemyModifiers` (reserved), all cloned in reset + wired through `devLaunch.ts` (new URL params `heroLevel`, `enemyLevel`, `title`; `enemyModifiers` reserved). Cycling the enemy resets level→`baseDepth` and title→`defaultTitleFor`.
  4. **PrepScene CHOOSE FIGHT** now has: title chips (MOB/NORMAL/ELITE/BOSS), an enemy **LV** −/+ stepper, a disabled **`MODIFIERS · soon`** placeholder slot, live scaled enemy stat preview + gemmed-card count, and a **readable enemy card-name list** (replacing the old illegible 0.54-scale mini-card preview — `renderEnemyPreview` deleted). **DECK BUILDER** gained a hero **LV** −/+ stepper with a live scaled hero-stat preview. `BattleScene` consumes `demoState.heroLevel/enemyLevel/enemyTitle` via `buildAutoHeroSetup` + `buildEnemyEncounter`, and the enemy roster sublabel shows `LV n ELITE/BOSS`.
- FILES: `src/run/encounter.ts`, `src/game/demoState.ts`, `src/game/devLaunch.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `tests/run/encounter.test.ts` (+7 tests), `docs/codex-handoff.md`, `docs/codex-ui-guide.md`.
- VERIFY: `npm test` = 223/223 (7 new) · `npm run typecheck` clean · Playwright 720×1280: controls render without overlap; interactively selecting BOSS + LV steppers updates the live stat preview and gemmed count; launching fights a LV-scaled boss (e.g. hero LV6 vs Giant Rat LV4 BOSS → HP 190, ATK 29, 2 gemmed cards, hero loses in 9T); Battle → PREP round-trip preserves the selection with zero console errors.
- REQUESTS TO CODEX: none blocking. When you polish CHOOSE FIGHT, keep the title→preset resolver as the single source of scaling (don't scale stats in the scene). The `MODIFIERS` slot is the hook for the future affix axis.
- OPEN: hero-level stats are auto-allocated (flat profile) until the real stat-sheet UI lands; enemy modifiers are a reserved no-op; Silver/Gold boss tier bumps wait on tier-up content.

### 2026-07-14 — Claude — prep-screen fixes from user review (bag semantics, staging removed, re-entry crash, card legibility)
- CHANGED (in `src/game/` by user direction — Codex please review, this touches your layer):
  1. **Prep re-entry crash fixed (was making the game unplayable).** `Battle → PREP` threw `Cannot read properties of null (reading 'glTexture')` in `refreshTabs` because Phaser reuses the scene instance and `PrepScene`'s object arrays (`tabButtons`, `viewObjects`, …) were only initialized at construction — `create()` touched destroyed Texts on the second entry, killing the scene. The user experienced this as "changing enemies always fights the bandit duelist" (dead screen → page reload → state reset). Fix: added `init()` that resets all display-object state, mirroring `BattleScene.init()`. **Pattern to keep: any scene field holding display objects must be reset in `init()`.**
  2. **Bag semantics corrected (user spec):** a card lives in ONE place. Equipping moves it bag → board (`bagSlots[i] = null`); dragging a deck card off the rail returns it to the bag (preferring the drop-target slot), and its socketed gem returns to `gemInventory`. CLEAR returns all cards + gems. The bag no longer renders board cards, and the dim/`LIVE`-badge treatment is gone. `demoState.DEFAULT_BAG_SLOTS` now holds only the 4 unequipped cards; new `EMPTY_BOARD_OVERRIDES` keeps `?board=empty` consistent (all 10 cards bagged, all 12 gems loose).
  3. **Staging/transition slots removed entirely (user spec: they should not exist).** `demoState.stagingSlots` is deleted; the Bag tab is now `CARD BAG` (10 slots, drag to reorder) + `ACTIVE DECK` (read-only board with gem sockets).
  4. **Card-face legibility:** bag cells now render cards near full mini size (scale ~1.0 instead of 0.58); narrow cards abbreviate tier to one letter and tighten the stat line; the redundant property label was dropped from the full-card meta line (accent strip + kind tag already carry it) — that label was the main overflow; hyphenated names ("Follow-Through") get an explicit break; the `AURA · BOARD EFFECT` footer compacts to `AURA` on size-1 cards; new `CardView` opt `badgeInset` reserves the top-right corner where PrepScene overlays the (now smaller, r=9) socket badge.
- FILES: `src/game/scenes/PrepScene.ts`, `src/game/ui/CardView.ts`, `src/game/demoState.ts`, `src/game/devLaunch.ts`, `docs/codex-ui-guide.md` (§2 rows for PrepScene/demoState updated).
- VERIFY: `npm test` = 216/216 · `npm run typecheck` clean · Playwright at 720×1280: loadout/bag screenshots clean; drag bag→board moves the card out of the bag; full round trip Prep → FIGHT → PREP → cycle enemy ×2 → FIGHT now correctly fights Seraph with zero console errors.
- REQUESTS TO CODEX: none blocking — but please keep the one-place-per-card invariant and the no-staging decision in future Prep work, and adopt the `init()` reset pattern in any new scene.
- OPEN: enemy-preview cards in the scout strip are still tiny/unreadable at 0.54 scale (they are inspectable, so tolerable); consider a name-only strip later.

### 2026-07-14 — Codex — playable two-enemy combat sample
- **CHANGED:** Added a true two-enemy sample at `?scene=multi` using Giant Rat + Ember Imp. The deterministic simulation now receives both enemy setups, and the right lane renders two separate ten-slot boards aligned by placement row.
- **FILES:** `src/game/demoState.ts`, `src/game/devLaunch.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/screenshot-howto.md`, `docs/codex-handoff.md`, `docs/screenshots/battle-multi-enemy.png`, `docs/screenshots/battle-defense-stats.png`, `docs/screenshots/battle-readiness.png`.
- **DESIGN:** Multi-enemy cards use a compact face but retain name, archetype, weapon/element, weight, and slot span. Every combatant has independent HP/readiness/status text, log events and highlights resolve by `(side, unit)`, and tapping any enemy name/stat/card opens that enemy's details.
- **VERIFY:** `npm test` = 216/216; `npm run typecheck` clean; `npm run build` pass; `git diff --check` clean. Inspected 720x1280 single- and two-enemy captures with no panel/card overflow.
- **REQUESTS TO CLAUDE:** None; this uses the shipped `enemyTeam` and unit-indexed event contract.
- **CLAUDE REVIEW:** _pending_

### 2026-07-14 — Codex — visible defensive combat stats
- **CHANGED:** Added `DEF`, `RES`, and `CRIT` to both combatant summaries above the ten-slot boards. The full stat modal remains available by tapping either stat line.
- **FILES:** `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `docs/screenshots/battle-defense-stats.png`, `docs/screenshots/battle-readiness.png`.
- **DESIGN:** `DEF` maps to engine `armor`; `RES` maps to `magicResist`. The second line is compact, bold, and width-clamped so the narrower hero lane cannot overflow.
- **VERIFY:** `npm test` = 216/216; `npm run typecheck` clean; `npm run build` pass. Captured the 720x1280 battle screen and confirmed both lines fit inside the hero and enemy summaries without overlap.
- **REQUESTS TO CLAUDE:** None.
- **CLAUDE REVIEW:** _pending_

### 2026-07-14 — Codex — detailed combat card faces
- CHANGED: Added visible weight, slot span, color-coded archetype badges, and color-coded weapon/element labels to every combat board card.
- FILES: `src/game/theme.ts`, `src/game/scenes/BattleScene.ts`, `docs/{codex-ui-guide,codex-handoff}.md`, `docs/screenshots/{battle-detailed-cards,battle-readiness}.png`
- DESIGN: Card faces now show up to two archetypes as colored badges (`OFFENSE`, `DEBUFF`, etc.), a weapon/element identity such as sword/lightning/lance with a dedicated color, and a full `WEIGHT 10 · 1 SLOT` footer. Aura/true cards receive corresponding labels while retaining the property edge strip.
- VERIFY: `npm test` = pass (216) · `npm run typecheck` = clean · `npm run build` = pass · inspected the 720×1280 screenshot; all one-slot and multi-slot card metadata fits without overlap.
- ASSUMPTIONS: Only the first two archetypes render on the compact combat face; the click detail view remains authoritative for any future card with more.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — full-height board slots
- CHANGED: Increased all ten combat board positions from 68 px to 84 px, enlarged card names/metadata/slot numbers, and strengthened the visible stat line.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/{codex-ui-guide,codex-handoff}.md`, `docs/screenshots/{battle-tall-slots,battle-readiness}.png`
- DESIGN: Hero and enemy boards now use the previously empty lower lane space through slot 10. Card names are 11 px bold display text, card type/span is 9 px bold, and slot numbers are 11 px with stronger contrast.
- VERIFY: `npm test` = pass (216) · `npm run typecheck` = clean · `npm run build` = pass · refreshed and inspected the 720×1280 screenshot; slot 10 and the bottom inspector line remain inside the frame with no overlap.
- ASSUMPTIONS: The board remains fixed at ten positions; 84 px is the portrait density target rather than a responsive calculation.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — compact combat result badge
- CHANGED: Removed the large centered victory/defeat banner from above the lane headers and replaced it with a compact persistent result badge in the top-right page header.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/codex-handoff.md`, `docs/screenshots/battle-result-badge.png`
- DESIGN: Results now read `VICTORY · 8T` in a small pale green badge (or corresponding defeat/draw palette) aligned opposite the WORLD1 title. Temporary sudden-death messaging remains centered but is smaller and fades.
- VERIFY: `npm test` = pass (216) · `npm run typecheck` = clean · `npm run build` = pass · refreshed and inspected at 720×1280 with no header overlap.
- ASSUMPTIONS: The result remains visible for replay review but no longer competes with the combat lanes.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — softer combat panels and thin outlines
- CHANGED: Recolored the combat shell, lane headers, roster strips, board slots, cards, selected-turn panel, timeline, controls, and modals; reduced BattleScene outlines from 3–4 px to 1–2 px.
- FILES: `src/game/theme.ts`, `src/game/scenes/BattleScene.ts`, `docs/{codex-ui-guide,codex-handoff}.md`, `docs/screenshots/{battle-soft-panels,battle-readiness}.png`
- DESIGN: Party uses sage/honey, enemies clay/coral, the log warm parchment, and the central header charcoal. Empty hero/enemy slots now have distinct low-contrast tints. Card property strips and semantic log verbs retain the stronger colors, while borders recede.
- VERIFY: `npm test` = pass (216) · `npm run typecheck` = clean · `npm run build` = pass · refreshed and inspected the 720×1280 battle screenshot with no overflow.
- ASSUMPTIONS: This palette change is scoped to the combat scene; Prep/Bag/Wiki keep their existing design until deliberately brought into the same visual system.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — animated semantic log verbs
- CHANGED: Replaced side-tinted timeline boxes with neutral alternating rows, split timeline copy into semantic verb/title/result/calculation fields, and added a short staggered reveal on initial load and page changes.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/{codex-ui-guide,codex-handoff}.md`, `docs/screenshots/{battle-verb-colors,battle-readiness}.png`
- DESIGN: `GAIN` is blue, player `PLAY` green, enemy `PLAY` and `HIT` red, `WAIT` amber, healing green, and boundaries dark. A grouped activation can show two independently colored verbs (`PLAY` plus `HIT`) while its container remains neutral. Twelve visible messages enter over roughly 600 ms with a 6 px rise and fade.
- VERIFY: `npm test` = pass (216) · `npm run typecheck` = clean · `npm run build` = pass · refreshed and inspected the 720×1280 battle screenshot with no overflow or clipped feed controls.
- ASSUMPTIONS: Motion is intentionally short and non-looping; log content remains fully understandable in a static frame.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — buff calculations and compact activation groups
- CHANGED: Added authoritative direct-damage calculation stages and stat-effect magnitudes to engine events, printed them in the CLI/UI logs, and grouped each play with its hit/effect, calculation, readiness cost, and cursor movement.
- FILES: `src/engine/combat/{events,interpreter}.ts`, `tests/engine/readiness.test.ts`, `scripts/fight.ts`, `src/game/scenes/BattleScene.ts`, `docs/{combat-model-spec,codex-ui-guide,codex-handoff}.md`, `docs/screenshots/battle-grouped-calculations.png`
- DESIGN: Compact rows now read like `H PLAY · Sword Slash · W10`, `HIT · -42 HP`, `DMG 24 +BONUS6 -DEF2 +CRIT14 = 42 · ATK 12→12 · BONUS +25%`. Selecting the row exposes aura source credit plus up to four grouped result/cost/cursor lines. Buff cards state their exact stat and percentage/flat change.
- VERIFY: `npm test` = pass (216) · `npm run typecheck` = clean · `npm run build` = pass · CLI prints the same calculation stages · refreshed 720×1280 screenshot shows 1/4 pages instead of 1/8 with no horizontal overflow.
- ASSUMPTIONS: `effectPct/effectBonusDamage` intentionally combines board aura, card gem, and cast-rider percentages because that is the exact modifier bundle consumed by damage math; named board-aura sources remain separately available on `play.auras`.
- REQUESTS TO CLAUDE: Review the calculation field names before treating them as a long-term save/replay schema.
- OPEN: Healing/shield formulas can receive the same optional calculation object if their buff contributions need equivalent audit detail later.
- Claude review:

### 2026-07-14 — Codex — pre-turn effects and Speed modifiers
- CHANGED: Added authoritative base/effect/effective Speed fields to readiness gain events, surfaced temporary Speed changes in the gain summary and actor HUD, and labeled poison/burn ticks as `PRE-TURN` rows before readiness gain.
- FILES: `src/engine/combat/{events,simulate}.ts`, `tests/engine/readiness.test.ts`, `scripts/fight.ts`, `src/game/scenes/BattleScene.ts`, `docs/{combat-model-spec,codex-ui-guide,codex-handoff}.md`
- DESIGN: Turn order now reads as pre-turn DoT/status consequences, then one grouped readiness gain card, then activations. A modified gain reads `+15 Speed · effect +5`, making buffs/debuffs visible without UI math.
- VERIFY: `npm test` = pass (215) · `npm run typecheck` = clean · `npm run build` = pass · focused readiness test covers a +50% Speed buff producing `baseSpeed: 10`, `speedModifier: 5`, `speed: 15`.
- ASSUMPTIONS: Current board auras modify card damage/healing/weight/crit, not the combatant Speed stat. Speed buffs/debuffs are fully shown; naming a future Speed-aura source would require that source id on `gain`.
- REQUESTS TO CLAUDE: If Speed-projecting board auras are added, include their source slot/skill ids on `gain` so the UI can name them instead of only showing the signed effect.
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — grouped turn readiness gain
- CHANGED: Combined every combatant's start-of-turn readiness gain into one `TURN N · GAIN` timeline row, with the individual readiness changes stacked directly beneath the heading before that turn's plays and results.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/codex-handoff.md`
- DESIGN: A turn now starts with one neutral readiness summary instead of separate player/enemy gain cards. Action rows remain chronological and side-colored, and the grouped gain row is still selectable for inspection.
- VERIFY: `npm test` = pass (214) · `npm run typecheck` = clean · `npm run build` = pass.
- ASSUMPTIONS: The compact row is optimized for the current 1v1 view; team combat may need an expandable gain summary when more than two combatants are visible.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-14 — Codex — readiness engine and tagged battle playback
- CHANGED: Rebuilt `simulate()` around gameplay-turn readiness gain, highest-readiness multi-cast resolution, weight payment with leftovers, size-based cursor traversal, gameplay-turn cooldowns, and tagged `gain/play/cost/cursor/busy/wait/end` events. Aura cards now play, and `play` retains target, aura, damage, and HP summary fields.
- FILES: `src/engine/combat/{events,state,castSelect,simulate,interpreter}.ts`, `src/engine/types.ts`, `tests/engine/{readiness,comparison,cooldowns,auras,effects,elements,riders,targeting,defensiveKeywords}.test.ts`, `scripts/fight.ts`, `src/game/scenes/BattleScene.ts`, `docs/{combat-model-spec,codex-ui-guide,codex-handoff}.md`
- DESIGN: Every living combatant gains effective Speed once, including while busy or cooling. The resolve loop repeatedly chooses highest readiness, then effective Speed, then canonical player/unit order. One board piece cannot replay twice in the same gameplay turn even when cooldowns are disabled. The portrait log renders each tagged event as a selectable, side-colored line and highlights referenced cards.
- VERIFY: `npm test` = pass (214) · `npm run typecheck` = clean · `npm run build` = pass · `npm run fight -- bandit_duelist 1` produces same-turn hero/enemy plays and a three-play Hero chain on T10 · 720×1280 production screenshot inspected with no horizontal overflow (`docs/screenshots/battle-readiness.png`).
- ASSUMPTIONS: Legacy `comparison` and `skillCast` event types remain temporarily for source compatibility, but `simulate()` no longer emits `comparison`; `skillCast` is emitted only as a compatibility detail event and the UI ignores it in favor of `play`.
- REQUESTS TO CLAUDE: Review the readiness implementation and retire stale one-cast wording in `docs/combat-ui-spec.md` after merge.
- OPEN: Multi-combatant board presentation and combat animation task #11 remain separate UI work.
- Claude review:

### 2026-07-14 — Codex — aura cards and contribution credit
- CHANGED: Added a shared aura presentation formatter, marked aura cards across combat/deck card faces and inspectors, exposed aura reach/filter/modifier details, and credited `skillCast.auras` sources in compact and selected turn-log views.
- FILES: `src/game/ui/skillPresentation.ts`, `src/game/ui/CardView.ts`, `src/game/ui/SkillDetailPanel.ts`, `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`
- DESIGN: Uses `AURA`, not `PASSIVE`, because the target readiness model says these cards become valid plays. Battle tokens retain the compact 10-slot layout; War Banner reads as an aura at a glance, its modal explains touching-card reach and `+25% damage`, and affected Sword Slash rows show `AURA · War Banner S1 +25% DMG` before the damage result.
- VERIFY: `npm run build` = pass · `npm test` = pass (209) · `npm run typecheck` = clean · direct UI simulation confirmed two seed-1 Sword Slash casts carry the expected War Banner aura payload · dev server returned HTTP 200. Browser screenshot/eyeball was blocked by the in-app browser's local-network policy, so no refreshed screenshot is claimed.
- ASSUMPTIONS: The live engine remains the old one-performer-per-global-turn contract. Request #15 stays blocked until Claude ships the tagged readiness event stream.
- REQUESTS TO CLAUDE: #6 — retain aura-source contribution data on the future tagged `play` event.
- OPEN: Request #11 animations remains open; Request #15 remains engine-blocked. Remote branch `origin/claude/skills-tree-expansion-dkwbg0` is a separate large rewrite that deletes the current AGENTS/UI/handoff docs, so it was inspected but not merged into this working branch.
- Claude review:

### 2026-07-13 — Codex — escalated multi-activation turn mismatch
- CHANGED: Compared the user's confirmed turn model against the live engine and documented Request #5 for Claude; no UI or engine code changed for this rule.
- FILES: `docs/codex-handoff.md`
- DESIGN: The intended log must group all ordered hero/monster activations under one gameplay turn. Codex will not fake that grouping while `simulate()` emits one performer per `turn`.
- VERIFY: Contract audit only: `src/engine/combat/simulate.ts` currently selects one `performerEntry` and emits at most one cast per global turn; `docs/combat-ui-spec.md` §1 says the same.
- ASSUMPTIONS: The user's latest confirmation supersedes Request #4(a)'s one-activation interpretation.
- REQUESTS TO CLAUDE: #5
- OPEN: Wait for Claude's corrected event grouping and cooldown clock before finalizing the clearer log design.
- Claude review:

### 2026-07-13 — Codex — restored cast-first log labels
- CHANGED: Removed the repetitive `ALL ADD SPEED` row heading and restored the caster, skill name, and performer color coding without removing either combatant's Speed calculation.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Rows now lead with `T1 · HERO CAST · Sword Slash`; player casts use the player fill/green accent and enemy casts use the enemy fill/red accent. The next two lines still show both initiative calculations and bank outcomes.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass (existing Phaser chunk-size warning only) · `npm test` = pass (205) · refreshed and inspected the 720×1280 production-preview screenshot with no overflow.
- ASSUMPTIONS: Row color identifies the caster only; the turn remains a shared initiative comparison.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — shared-turn Speed wording
- CHANGED: Reframed every battle-log row as a shared initiative beat instead of a turn owned by the performer, and replaced failure wording with explicit wait/bank outcomes.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The selected turn now teaches the actual sequence: every combatant adds effective Speed, subtracts the queued card cost, and the highest score activates. The performer reads `ACT · bank->0`; a ready non-performer reads `WAIT · BANK +Speed`; a cooldown-idle unit reads `SKIP · bank stays`.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass (existing Phaser chunk-size warning only) · `npm test` = pass (205) · refreshed and inspected the 720×1280 production-preview screenshot with no overflow.
- ASSUMPTIONS: The UI continues to render `comparison.entries` exactly. It does not recalculate initiative or alter Claude's cooldown-idle exception.
- REQUESTS TO CLAUDE: none; this implements Request #12.
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — playable continuous battle log
- CHANGED: Replaced the derived round selector with a continuous 10-turn paged log, made every turn row selectable, and synchronized row selection with both compared board cards.
- FILES: `src/game/scenes/BattleScene.ts`, `src/game/theme.ts`, `docs/codex-ui-guide.md`, `docs/screenshots/battle-portrait.png`, `docs/superpowers/plans/2026-07-13-battle-log-paging-highlight.md`, `docs/codex-handoff.md`
- DESIGN: The existing `Prep -> FIGHT -> Battle` flow now shows the selected deck's real `simulate()` result. Each compact row includes both speed formulas and bank outcomes. Selecting a row expands its activation/result above the log, outlines the activated card green, and outlines every ready loser amber. `nothingUsable` displays `IDLE` with no bank gain, matching Request #4.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass (existing Phaser chunk-size warning only) · `npm test` = pass (203) · browser console = no errors/warnings · verified Prep FIGHT navigation, turn selection, and page 1/2 navigation at 720×1280 · refreshed and inspected `docs/screenshots/battle-portrait.png` with no overflow.
- ASSUMPTIONS: Ten turns per page is presentation-only and does not affect combat. The battle result remains predetermined and is rendered immediately for inspection.
- REQUESTS TO CLAUDE: none
- OPEN: The board currently renders one focused hero and enemy board; team-shaped log entries remain supported, while full multi-board party/enemy layout is a later UI pass.
- Claude review:

### 2026-07-13 — Codex — combat contract clarification for Claude
- CHANGED: Added Request #4 asking Claude to reconcile the user's intended continuous turn log, independent cursors, failed-skill retry, slot scanning, and anti-small-deck cooldown with the current engine.
- FILES: `docs/codex-handoff.md`
- DESIGN: The proposed UI removes gameplay-round grouping, pages the chronological log, and highlights both competing skills when a turn is tapped. It cannot label failures or cooldown state beyond what the deterministic event log reports.
- VERIFY: Documentation-only change; no build or test commands run.
- ASSUMPTIONS: Ten turns per log page remains a proposal. Cooldown length, clock source, off-by-one behavior, and whether cursors scan past unavailable slots require an explicit answer.
- REQUESTS TO CLAUDE: #4
- OPEN: Wait for Claude's engine-contract response before changing `BattleScene` around these rules.
- Claude review:

### 2026-07-13 — Codex — team-aware combat log rows
- CHANGED: Updated the battle scene to use Claude's encounter builders and canonical team-shaped combat events. Selected-round turn boxes now show speed math, bank start→end continuity, activation/targeting, and same-turn results in one colored box.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The center `PLAYS` lane remains top-down and mobile-first, but each turn now reads as a complete deterministic playback step: `H 0+16-10=6 | bank 0->0 act`, `E 0+12-10=2 | bank 0->12 +12`, then the card cast, target reason, damage/status/aggro lines. Rows key actor/target labels by `(side, unit)` so the log is ready for party and multi-enemy events.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (181) · refreshed and inspected `docs/screenshots/battle-portrait.png` from `http://127.0.0.1:4174/?scene=battle&enemy=bandit_duelist&seed=1`.
- ASSUMPTIONS: `demoState` still has no real hero level, enemy level, or player stat allocation, so Battle uses `buildHeroSetup({ level: 1, allocation: {}, pieces })` and `buildEnemyEncounter(enemyId, enemy.baseDepth)` as the current demo inputs, then displays the resolver-returned levels/stats.
- REQUESTS TO CLAUDE: none
- OPEN: Request #11 animations remain open. The side boards still render one focused hero board and one focused enemy board; roster chips/log labels are team-aware, but full multiple-board rendering can be a later Wave-4 UI pass when a real multi-unit encounter is wired into demo/run state.
- Claude review:

### 2026-07-13 — Codex — speed math in turn boxes
- CHANGED: Added the per-turn speed comparison math into each selected-round turn box in the battle log.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Each turn box now shows both sides' speed formula using existing `comparison` events, e.g. `Hero SPD: bank+speed-weight=score` and `Foe SPD: bank+speed-weight=score`, followed by the activated card and slot. This makes it clear that speed is banked each turn, card weight reduces the score, and the higher score determines who activates.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: The UI uses `comparison.bank`, `comparison.speed`, `comparison.weight`, and `comparison.score` directly; it does not recompute combat.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — selectable round combat log
- CHANGED: Replaced the long all-turn activation feed with a round selector rail and selected-round turn boxes.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The center `PLAYS` lane now works top-down as intended: `R1`, `R2`, etc. are selectable buttons on the left, and the right side shows only that round's turn boxes. Each turn box shows turn number, actor, activated card, and slot/status, with player/enemy color coding preserved.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Round grouping is inferred from existing deterministic event order using each side's `performStart.performs` count. If Claude later exposes an explicit `round` on combat events, Codex should switch to that field.
- REQUESTS TO CLAUDE: Optional future field: explicit `round` on combat events for UI grouping.
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — horizontal battle board headers
- CHANGED: Removed the diagonal combatant stat text above the battle skill slots and replaced it with compact horizontal board headers.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Each side board now shows name/level, skill count, PL, core stats, HP, score, and statuses as normal horizontal text above the 10-slot board. The party/enemy roster chips remain above that, and the skill slots no longer have diagonal text crossing the board area.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Horizontal headers are the default until a better multi-combatant board focus treatment exists.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — color-coded combat action log
- CHANGED: Color-coded the battle activation feed by actor and rewrote each row to show the combatant name, card/action, and slot note.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Hero rows now use the player card color with a green accent; mob rows use the enemy card color with a red accent; combat-end rows stay green. The log now reads as `T01 HERO / Sword Slash -> slot 2` and `T02 BANDIT DUELIST / Sword Slash -> slot 1`, making it clearer who did what on each turn.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Actor names currently come from the single hero/enemy views. When Claude exposes multi-combatant ids, this formatting should use the event actor identity instead of the side-level fallback.
- REQUESTS TO CLAUDE: #2 remains relevant for true multi-enemy/multi-party actor names
- OPEN: Later, add target names to rows once damage/heal/status events expose target combatant identity in multi-combatant fights.
- Claude review:

### 2026-07-13 — Codex — party and enemy roster rails
- CHANGED: Added compact roster rails to the battle screen: `PARTY 1` and `ENEMIES 1` headers now sit above the side boards, with clickable member chips underneath.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: This creates a clearer visual model for future party combat and multiple enemies without pretending the current engine supports them. The active board still renders the single hero and single enemy from `simulate()`, while the roster rail gives us the UI slot where additional heroes/enemies can appear later.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Current combat events still only identify `player` and `enemy`; true multi-enemy/multi-party targeting still needs Claude's encounter/event identity work in Request #2.
- REQUESTS TO CLAUDE: #2 remains relevant
- OPEN: When Claude exposes multi-combatant data, populate these rails from real party/enemy arrays and let tapping a chip focus that combatant's board/stats.
- Claude review:

### 2026-07-13 — Codex — deckbuilder palette and readable fonts
- CHANGED: Shifted the shared UI theme from prototype blue/mono styling to a warmer card-table palette with parchment panels, green action tabs, golden player cards, coral enemy cards, and readable serif/sans font pairing.
- FILES: `src/game/theme.ts`, `docs/screenshots/loadout-portrait.png`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The deck screen now reads more like a card deckbuilding game: green table controls, parchment card zones, stronger dark borders, and less terminal-like text. The battle screen inherits the same theme so the visual language stays consistent.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/loadout-portrait.png` and `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: This is a theme-only pass; no card data, combat logic, run state, or placement behavior changed.
- REQUESTS TO CLAUDE: none
- OPEN: If we want stronger card-game identity next, add card back art/patterns and clearer rarity frames per card tier.
- Claude review:

### 2026-07-13 — Codex — dedicated deck builder prep screen
- CHANGED: Reframed the `Loadout` tab as a `DECK` screen with fight selection first, a 10-slot deck builder rail second, and the card bag below it.
- FILES: `src/game/scenes/PrepScene.ts`, `docs/screenshots/loadout-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The out-of-combat flow now reads as `choose fight -> build deck -> inspect/tune -> fight`. The deck summary shows card count, occupied slots, total PL, and gem count. Enemy arrows remain in the top fight selector, and the bottom `FIGHT` button launches the selected enemy.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/loadout-portrait.png`.
- ASSUMPTIONS: `demoState.enemyId`, `demoState.pieces`, `demoState.bagSlots`, and `demoState.gemInventory` remain the temporary run-state shape until Claude wires real run data.
- REQUESTS TO CLAUDE: none
- OPEN: If the user wants this as a separate route later, split `Deck` from `Prep` after the run-map flow exists.
- Claude review:

### 2026-07-13 — Codex — diagonal combatant stat strips
- CHANGED: Reworked the battle board headers so combatant identity, level, skill count, total PL, core stats, HP, score, and statuses live in 45-degree strips above each 10-slot board.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The side columns now reserve their horizontal width for slot placement and card rows. Combatant information is angled to match the intended multi-hero/multi-monster board-label direction while keeping the 10 slots aligned.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Diagonal labels remain text-only metadata; click/tap on the diagonal identity or HP still opens the stats modal.
- REQUESTS TO CLAUDE: none
- OPEN: If more simultaneous heroes/monsters are added, this diagonal stat strip should repeat per board column.
- Claude review:

### 2026-07-13 — Codex — deterministic battle timeline controls
- CHANGED: Removed battle speed and skip controls. The battle scene now applies the full precomputed event log on load and shows the activation order from turn 1 through the combat result.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/codex-ui-guide.md`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Since battle outcome is deterministic, the default combat view now prioritizes reading the complete top-down sequence. Bottom controls are limited to `PREP`, `REPLAY`, and `NEW SEED`; card/stat inspection still happens by tapping board elements.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: The current 13-turn demo fits in the visible activation feed. Longer fights may need a scroll/page treatment later if they exceed the visible rows.
- REQUESTS TO CLAUDE: none
- OPEN: Add timeline paging/scrolling only when longer combat logs make it necessary.
- Claude review:

### 2026-07-13 — Codex — angled combatant board names
- CHANGED: Moved combatant names into angled board labels and made both side boards use a shared slot-row origin so same slot placements line up horizontally across player and monster boards.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The battle layout is now more compatible with future multiple heroes/monsters: diagonal labels conserve horizontal space, while slot 1-10 rows remain aligned across boards.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Current engine still supports one player board and one enemy board; this change prepares the visual pattern for multiple boards without changing combat logic.
- REQUESTS TO CLAUDE: none
- OPEN: When multi-combatant data exists, duplicate the aligned board column per hero/monster rather than changing slot-row math.
- Claude review:

### 2026-07-13 — Codex — combat level and stats display
- CHANGED: Added level and compact stat readouts to player/enemy combat board headers. Clicking the name, HP, or stat line opens a stats modal with HP, Attack, Magic, Armor, Resist, Speed, and Crit.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The board now shows identity at a glance (`Hero · LV 1`, `Bandit Duelist · LV 1`) plus compact stats (`ATK`, `MAG`, `SPD`) without crowding the 10-slot board map.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Hero level is currently displayed as `1`; monster level uses `baseDepth`. This should be replaced by real resolved run/combat levels when Claude exposes them.
- REQUESTS TO CLAUDE: #3
- OPEN: none for current baseline combat.
- Claude review:

### 2026-07-13 — Codex — combat total PL readout
- CHANGED: Added total board PL to the combat board headers for both player and enemy lanes.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Each side now shows `<skill count> · total PL <value>` under its HP/name line, keeping the PL comparison visible without adding a new panel. The value uses `instancePowerLevelDeci()` so socketed gems on player pieces are included.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Total PL is a board-level display value, not a combat calculation; it is derived from the placed pieces and skill definitions.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — activation order feed
- CHANGED: Reworked the center `PLAYS` lane to prefill activation order from the deterministic `simulate()` event log. Rows now show turn number, actor (`YOU`/`FOE`/`END`), activated card, and slot/result note, with the current turn highlighted during playback.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The middle column now explains what activates and in what order instead of acting like a generic log area. It stays a read-only projection of the engine event log.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Current combat still has exactly one enemy board. Multi-enemy layout should become one compact enemy board per enemy once Claude exposes multi-enemy state/events.
- REQUESTS TO CLAUDE: #2
- OPEN: none for current single-enemy combat.
- Claude review:

### 2026-07-13 — Codex — clarified enemy skill count
- CHANGED: Removed misleading `enemy 1` / `enemy 2` labels from the single-enemy combat board and added a placed-skill count under each board owner.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: `Bandit Duelist` now clearly reads as one enemy board with `2 skills placed`, showing `Sword Slash` and `Follow-Through` in slots 1 and 2.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Enemy data was already correct; this was UI labeling clarity only.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-13 — Codex — combat cards mapped to 10 slots
- CHANGED: Replaced full combat card widgets with compact board tokens positioned in explicit 1-10 slot rows. Each token shows only name, property, and slot span; clicking opens a modal with the full skill text and metadata.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Combat now prioritizes board placement over card-detail density. The player and enemy lanes both show ten slots so the user can read where cards sit and how multi-slot skills span the board. Detailed skill information is now on-demand through a modal instead of always visible.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: The enemy lane also uses ten visible slots for layout consistency, even if an enemy definition has fewer logical board slots today.
- REQUESTS TO CLAUDE: none
- OPEN: If future enemies can have multiple independent boards, replace the current single enemy 10-slot map with one map per enemy column.
- Claude review:

### 2026-07-13 — Codex — combat simplified to top-down layout
- CHANGED: Removed the persistent bottom skill-detail panel from combat and kept the screen focused on the top-down lane layout. Card inspection now updates a single compact hint line inside the combat frame instead of opening a dashboard-like detail area.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Combat now reads as a layout-first top-down board: player cards left, play feed center, enemy cards right, controls below. The center feed extends farther down the board and the bottom area is no longer a separate information panel.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png`.
- ASSUMPTIONS: Full skill details should be handled later as a tap overlay/modal if needed, not as a persistent combat-screen panel.
- REQUESTS TO CLAUDE: none
- OPEN: Apply the same "layout first, details on demand" rule to future combat overlays.
- Claude review:

### 2026-07-13 — Codex — combat feed and card stack tightening
- CHANGED: Kept the sample's combat layout structure while changing the center information display from separate round/card boxes into one continuous play feed. Tightened vertical card spacing in the left and right lanes so cards stack down the screen without large gaps.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: Combat remains a three-column mobile board: player skills left, plays center, enemies right. The center feed is now a single bordered list with subtle row separators; the turn/round toggle is removed from the default combat view. Player and enemy cards are visually stacked with only minimal separation.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed `docs/screenshots/battle-portrait.png` from `http://127.0.0.1:4174/?scene=battle&enemy=bandit_duelist&seed=1`.
- ASSUMPTIONS: The feed still uses existing deterministic event-log summaries; no new engine event fields were required.
- REQUESTS TO CLAUDE: none
- OPEN: The play feed starts sparse until events tick in. If the user wants the feed prefilled with upcoming card order, Claude would need to expose that as deterministic preview data.
- Claude review:

### 2026-07-13 — Codex — combat layout restored to sample structure
- CHANGED: Reworked `BattleScene` away from stacked horizontal bands and back to the user's sample combat composition: player skills down the left, play/turn cards in the center, enemy card columns on the right, with a compact bottom inspector.
- FILES: `src/game/scenes/BattleScene.ts`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The combat default view now matches the intended mobile wireframe more closely. The main board is a bordered three-column combat frame; empty play boxes stay visible like the sample; card click/hover still drives the shared inspector without changing combat logic.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/battle-portrait.png` from `http://127.0.0.1:4174/?scene=battle&enemy=bandit_duelist&seed=1`.
- ASSUMPTIONS: The sample's `enemy 1` / `enemy 2` columns are represented by splitting the current single enemy board across two visual columns until Claude adds any real multi-enemy model.
- REQUESTS TO CLAUDE: none
- OPEN: Enemy cards are intentionally compact to preserve the right-side two-column structure. If the engine later supports multiple enemies, this lane should map one enemy per column instead of splitting one enemy's board.
- Claude review:

### 2026-07-13 — Codex — flattened mobile section chrome
- CHANGED: Removed the heavy nested panel treatment from the portrait Loadout and Battle screens. Section containers now read as flat full-width bands with a small accent rule instead of bordered boxes inside bordered boxes.
- FILES: `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `src/game/ui/SkillDetailPanel.ts`, `docs/screenshots/loadout-portrait.png`, `docs/screenshots/battle-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The UI keeps the phone-first vertical stack, but reduces visual noise: board, enemy scout, bag, inspector, combat log, and battle board areas no longer have duplicated chrome. Card slots remain bordered because they are direct manipulation targets.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed and inspected `docs/screenshots/loadout-portrait.png` and `docs/screenshots/battle-portrait.png` from `http://127.0.0.1:4174`.
- ASSUMPTIONS: This is a visual-only pass; no engine/data/run behavior changed.
- REQUESTS TO CLAUDE: none
- OPEN: The next polish pass should focus on making the card/slot grid feel less spreadsheet-like without hiding the 10-slot inventory structure.
- Claude review:

### 2026-07-13 — Codex — loadout bag overflow fix
- CHANGED: Fixed the portrait Loadout bag grid so the second row stays inside the bag panel and no longer collides with the inspector. Slot labels now render inside each slot cell instead of on row boundaries.
- FILES: `src/game/scenes/PrepScene.ts`, `docs/screenshots/loadout-portrait.png`, `docs/codex-handoff.md`
- DESIGN: The main Loadout screen now keeps the board, scout, bag, inspector, and action bar in separate vertical bands with no visible overlap in the refreshed 720×1280 screenshot.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · refreshed `docs/screenshots/loadout-portrait.png` from `http://127.0.0.1:4174/?view=loadout`.
- ASSUMPTIONS: This was a layout-only correction; no engine/data/run behavior changed.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

### 2026-07-12 — Codex — portrait mobile UI, gem sockets, and design skills
- CHANGED: Reworked the game canvas from landscape to 720×1280 portrait, rebuilt Prep and Battle around phone-first vertical bands, added board-card gem socketing, refreshed portrait screenshots, and installed the requested `stop-slop`, `taste-skill`, and `emilkowalski/skills` design skill packs.
- FILES: `src/main.ts`, `src/game/theme.ts`, `src/game/demoState.ts`, `src/game/ui/CardView.ts`, `src/game/ui/SkillDetailPanel.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `docs/screenshots/loadout-portrait.png`, `docs/screenshots/bag-portrait.png`, `docs/screenshots/wiki-portrait.png`, `docs/screenshots/battle-portrait.png`, `docs/screenshots/README.md`, `docs/screenshot-howto.md`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `.agents/skills/stop-slop/**`, `.agents/skills/emil-design-eng/**`, `.agents/skills/apple-design/**`, `.agents/skills/animation-vocabulary/**`, `.agents/skills/improve-animations/**`, `.agents/skills/review-animations/**`, `.agents/skills/gpt-taste/**`, `.agents/skills/design-taste-frontend/**`, `.agents/skills/high-end-visual-design/**`, `.agents/skills/imagegen-frontend-mobile/**`, `.agents/skills/redesign-existing-projects/**`
- DESIGN: Prep now reads as a mobile game screen instead of a wide dashboard: tab row, board plan, enemy scout, 10-card bag, staging, wiki pages, and a persistent inspector are stacked for portrait. Board cards show socket badges; tapping a socket opens a gem picker backed by `demoState.gemInventory`, with attach/swap/remove routed through `src/run/loadout.ts`. Battle is now enemy-top / turn-flow / inspector / log / hero-bottom, preserving the event-log playback and turn/round toggle without side columns.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = pass (154) · captured fresh 720×1280 Chromium screenshots for loadout/bag/wiki/battle via `http://127.0.0.1:4174`.
- ASSUMPTIONS: Every board piece has one visible socket for now, matching Claude's deferred socket-availability note. `demoState.gemInventory` is mock run inventory until Claude wires real run-state gems. Portrait is now the primary UI target; tablet/landscape should be a separate later breakpoint.
- REQUESTS TO CLAUDE: none
- OPEN: The UI is playable and no longer overflowing in the captured portrait states, but the battle log starts empty until events tick in, and richer animation/juice remains a polish pass. Real run-state gem inventory is still future Claude work.
- Claude review:

### 2026-07-19 — Codex — prep fight header/footer spacing cleanup
- CHANGED: Tightened the prep fight card header spacing and lifted the lower copy blocks so the enemy selector chips, close box, and footer text stop crowding the fight panel edges.
- FILES: `src/game/theme.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`
- DESIGN: The shared panel shell now uses a slightly calmer accent mark and a bit more title breathing room, while the prep fight header chips sit lower and their labels sit a touch lower inside the chips. The shared divider moved up so the enemy details below it have more room, and the enemy skills block plus fight footer now sit higher inside the card so the bottom border reads cleanly in the live canvas.
- VERIFY: `npm run build` = pass · `npm test` = pass (302) · `npm run typecheck` = clean · checked live via Chromium screenshot on `http://127.0.0.1:4174/?view=prep` (`prep-top-check-4.png`)
- ASSUMPTIONS: None. This was a pure UI spacing pass; no engine or demo-state shape changed.
- REQUESTS TO CLAUDE: none
- OPEN: The prep fight card now reads cleaner, but the larger pass on reusable UI panels can still continue if Claude wants more consistent spacing across other tabs.
- Claude review:

### 2026-07-12 — Codex — prep hub rebuild, battle log toggle, and repo-local gamedev skills
- CHANGED: Rebuilt `PrepScene` around a true 10-slot bag + 3 staging slots, tightened the compact card face, rewired the shared skill-detail panel, and replaced the battle feed with turn/round summary cards. Also installed a repo-local subset of `awesome-gamedev-agent-skills` into `.agents/skills/` so this project now has a Phaser/game-UI/game-feel/card-game/roguelike router pack available.
- FILES: `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `src/game/ui/CardView.ts`, `src/game/ui/SkillDetailPanel.ts`, `src/game/demoState.ts`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`, `.agents/skills/router/**`, `.agents/skills/phaser-core/**`, `.agents/skills/game-ui-ux/**`, `.agents/skills/game-feel/**`, `.agents/skills/card-game/**`, `.agents/skills/roguelike/**`
- DESIGN: `Loadout` now draws from the mocked 10-card bag instead of the whole library; `Bag` is a real inventory screen with 10 slots and a 3-slot staging column; `Wiki` is the full encyclopedia. The detail panel now behaves like a single shared inspector instead of a nested duplicate. Battle now has a `TURN` / `ROUND` toggle and each feed card surfaces the player's banked-vs-used speed plus what was actually played.
- VERIFY: `npm run typecheck` = clean · `npm run build` = pass · `npm test` = FAIL, but only in dirty engine-layer files outside `src/game` (60 failures rooted at `src/engine/combat/auras.ts`/`castSelect.ts` after shared engine changes; details in Request #1 above)
- ASSUMPTIONS: `demoState.bagSlots` stays the temporary source of truth until Claude lands real run-state inventory. Bag inventory skill ids remain unique, so loadout equips from the bag by id and board repositioning still happens by dragging the equipped card itself. Battle round grouping is inferred from the existing `performStart.performs` counts in the event log (`round = min(playerPerforms, enemyPerforms) + 1` at turn start), so no new engine field was required.
- REQUESTS TO CLAUDE: #1
- OPEN: Visual polish (#1 in Claude's request list) is stronger than before but not "finished"; the bigger blocker is the current dirty engine state breaking `npm test`, which prevents the usual green verification pass.
- Claude review:

### 2026-07-12 — Codex — dev launcher, screenshot docs, and committed PNGs
- CHANGED: Added a boot-time launcher for direct screen URLs, saved the four requested UI screenshots into the repo, and documented exactly how Claude can reopen or recapture them.
- FILES: `src/main.ts`, `src/game/scenes/BootScene.ts`, `src/game/devLaunch.ts`, `src/game/demoState.ts`, `docs/screenshots/loadout.png`, `docs/screenshots/bag.png`, `docs/screenshots/wiki.png`, `docs/screenshots/battle.png`, `docs/screenshots/README.md`, `docs/screenshot-howto.md`, `docs/codex-ui-guide.md`, `docs/codex-game-brief.md`, `docs/codex-handoff.md`
- DESIGN: No new visual changes. Workflow is the gain here: `/?view=loadout`, `/?view=bag`, `/?view=wiki`, and `/?scene=battle&enemy=bandit_duelist&seed=1` now land directly on the needed screen. `?board=empty` clears the board for layout work.
- VERIFY: `npm run build` = pass · `npm test` = pass (109) · `npm run typecheck` = clean · committed screenshots under `docs/screenshots/` and verified they were written to disk.
- ASSUMPTIONS: The launcher is strictly a UI/dev convenience layer over mocked `demoState`, not real run-state routing. External `view=wiki` maps to the internal `codex` tab name.
- REQUESTS TO CLAUDE: none
- OPEN: If Claude needs more deterministic UI states next, the clean extension is named board presets in the launcher, not manual clicking.
- Claude review: **VERIFIED — npm test 109 green, build pass, typecheck clean, boundaries OK (only src/game touched).** The `?view=`/`?scene=` launcher is genuinely useful — I used the committed PNGs directly and relayed all four views to the user. Nice work going past the ask. Named board presets: yes, do that when convenient.

### 2026-07-12 — Codex — combat shell + out-of-combat hub
- CHANGED: Rebuilt the UI around a lighter outlined visual system, a shared skill-inspector panel, a three-lane combat screen, and a tabbed prep hub with `Loadout`, `Bag`, and `Wiki` views.
- FILES: `src/game/theme.ts`, `src/game/ui/CardView.ts`, `src/game/ui/SkillDetailPanel.ts`, `src/game/scenes/PrepScene.ts`, `src/game/scenes/BattleScene.ts`, `src/game/demoState.ts`, `src/main.ts`, `docs/codex-game-brief.md`, `docs/codex-ui-guide.md`, `docs/codex-handoff.md`
- DESIGN: Combat now follows the mobile reference's lane structure: hero cards left, play/comparison stack center, enemy cards right. Out of combat, Prep is now a hub: `Loadout` preserves drag/drop board building, `Bag` shows current build plus collection, and `Wiki` exposes the full card set plus an enemy dossier. Skills are inspectable from prep, bag, wiki, enemy preview, and combat.
- VERIFY: `npm run build` = pass · `npm test` = pass (109) · `npm run typecheck` = clean · looked at it via local Chromium screenshots of loadout, bag, wiki, and combat.
- ASSUMPTIONS: `demoState` is still the temporary source of truth, so `Bag` currently treats the whole `skillBook` as the player's collection and `Wiki` is read-only over `skillBook` + current enemy defs. `prepView` lives in `demoState` only to preserve the selected tab across scene restarts.
- REQUESTS TO CLAUDE: none
- OPEN: Once the run layer exists, Claude should replace the mocked bag/wiki data flow with real inventory/run-state shapes. Card density in the wiki may want pagination or filters once the library grows past the current 31 skills.
- Claude review: **VERIFIED GREEN** (109 tests, build, typecheck, boundary check all pass; engine/data/tests untouched — clean layering). Strong structure: the 3-lane combat matches the reference and the per-turn comparison math is front-and-center, which is exactly the #1 legibility goal. **One real bug (→ Request #3): the compact card variant has overlapping text** (name collides with the property/weight/PL lines) across the pool/bag/wiki grids — unreadable at that size. Full-size board cards are fine. Fix that and this is ready to land. Wiki pagination: agreed, defer until the library grows.

### 2026-07-12 — Codex — repo orientation and working brief
- CHANGED: Reviewed the repo, local guidance, and current Phaser scenes; added a Codex-side summary doc for future Claude handoffs.
- FILES: `docs/codex-game-brief.md`, `docs/codex-handoff.md`
- DESIGN: No UI visuals changed. Added a concise brief covering the current combat-demo loop, ownership boundaries, core combat rules that matter to UI, and where each visible behavior lives.
- VERIFY: superseded by the UI implementation entry above
- ASSUMPTIONS: Later in the same session, `PrepScene` became a tabbed hub and `demoState.ts` gained `prepView`.
- REQUESTS TO CLAUDE: none
- OPEN: none
- Claude review:

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

### 2026-07-20 — Codex — Add breathing room to Battle side panels
- CHANGED: Added shared Battle side-panel geometry and used it to inset hero/enemy names and space the HP readout farther below the bar.
- FILES: src/game/theme.ts, src/game/scenes/BattleScene.ts
- DESIGN: The side-panel identity, stats, HP, score, and status positions now use named layout values. Names no longer sit against the panel edge; the card rail position and combat behavior are unchanged.
- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.
- ASSUMPTIONS: “More space at the HP bottom” means additional vertical breathing room in the HP readout/status block before the unchanged card rail.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball the Battle screen at 720x1280 and confirm the HP block has the intended amount of breathing room.
- Claude review: Pending.

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
\n\n## Session entry — 2026-07-20\n\n### Codex changes\n- Added simple, Fireball-inspired generated art for the three previously unillustrated cards: Hamstring, Rupturing Strike, and Ruinous Hex.\n- Added the three PNGs under public/game-art/cards/ and wired them through src/game/ui/cardArtCatalog.ts.\n- Direction: one bold focal shape, flatter cel shading, limited background detail, saturated VFX, and a quiet lower third for the existing fantasy card template.\n\n### Verification\n- Catalog comparison confirms every skill id has an art entry.\n- Generated files exist in the workspace.\n- npm typecheck/build could not be launched in this session because the local Windows sandbox helper returned spawn EINVAL; please run the normal project commands in a working shell.\n\n### Requests to Claude\n- Please review the three new assets after the next UI build. No engine/data changes requested.\n\n### Claude review\n_Pending._\n\n### 2026-07-20 — Codex — Move Wiki card pagination to gallery edges\n- CHANGED: Moved Wiki Cards previous/next paging from the crowded top toolbar to the left/right edges of the card gallery.\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: The page counter and grid/tier/filter controls remain in the toolbar. Previous/next arrows are vertically centered beside the gallery, with disabled states preserved at the first and last page. The grid reserves side insets so arrows do not collide with cards. Other Wiki tabs are unchanged.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean · dev screenshot not captured.\n- ASSUMPTIONS: The requested paging relocation applies to the Wiki Cards gallery only, as shown in the supplied reference.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Clear Wiki frame lines from paging controls\n- CHANGED: Moved the Wiki Cards paging hit areas inward from the panel edges into the reserved gallery gutters.\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: Paging buttons no longer cover the outer ornamental frame lines; card spacing and paging behavior remain unchanged.\n- VERIFY: npm run build = pass · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please eyeball the updated gutter placement in the running app.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Move deck gem sockets above cards\n- CHANGED: Moved deck-build gem socket controls from below each card to above the card rail and changed the circular control to a rotated-square diamond.\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: Socket controls remain clickable and continue opening the existing gem picker. Empty sockets show +; socketed gems retain rarity color and ◆ marker. Slot numbers remain below the deck rail.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please eyeball the top socket placement against narrow and multi-slot cards.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Raise deck gem sockets clear of card borders\n- CHANGED: Raised the diamond socket control from 10px above the card to 20px above it.\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: The diamond now clears the card top border and decorative line instead of touching it.\n- VERIFY: npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please eyeball the new vertical gap in Deck Build.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Center deck gem sockets in header/card gap\n- CHANGED: Repositioned the diamond socket controls into the vertical center of the open band between the deck header controls and the active card row.\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: Socket diamonds are no longer attached to or touching the card border.\n- VERIFY: npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please eyeball the gap placement in Deck Build.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Fix double-centered Phaser canvas\n- CHANGED: Removed Flexbox centering from the HTML app wrapper and kept Phaser Scale.FIT + CENTER_BOTH as the only canvas centering system.\n- FILES: index.html\n- DESIGN: The game canvas should now occupy the centered portrait region instead of being pushed into the right half of the viewport. Body overflow is hidden to prevent scrollbars from affecting centering.\n- VERIFY: npm run build = pass · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please reload the dev page and confirm the blue canvas is centered.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Calculate deck socket midpoint from real anchors\n- CHANGED: Replaced the guessed socket Y offset with the exact midpoint between panelToolbarRowY(bounds) and the active card top (railY - CARD_H / 2).\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: Diamonds now sit in the actual visual gap between the hero controls/text row and the card boxes shown in the reference.\n- VERIFY: npm run build = pass · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please reload Deck Build and confirm the diamond is centered in that gap.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Centralize Deck Build layout constants\n- CHANGED: Added shared DECK_BUILD_LAYOUT constants to src/game/theme.ts and replaced Deck Build panel, rail, and socket geometry literals in PrepScene.ts.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: Board/transfer/bag dimensions, rail offsets, socket size, rotation, stroke alpha, and label size now have one named source of truth.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Future Deck Build spacing changes should update DECK_BUILD_LAYOUT rather than scene-local literals.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Clean up transfer panel title and vertical centering\n- CHANGED: Removed the TRASH / TRANSFER title and centered the existing side-by-side drop zones using the panel midpoint.\n- FILES: src/game/scenes/PrepScene.ts\n- DESIGN: The two boxes remain side by side, but now have equal top and bottom spacing inside the transfer panel. Existing labels and drop behavior remain unchanged.\n- VERIFY: npm run build = pass · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Match active-deck and card-bag slot number spacing\n- CHANGED: Added DECK_BUILD_LAYOUT.rail.slotNumberGap and reused it for both active-deck and card-bag slot labels.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: The active deck numbers now sit at the same distance from their skill boxes as the card-bag numbers.\n- VERIFY: npm run build = pass · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Add read-only card previews to Choose Fight\n- CHANGED: Replaced the Choose Fight static description/enemy-skill text with reusable enemy skill cards and a read-only active-deck card rail.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: Enemy skill cards render in the empty fight-panel area with swap arrows enabled only when multiple configured enemies exist. Active deck cards are inspectable but cannot be dragged, moved, socketed, or otherwise edited here. Clicking either rail populates the existing bottom Skill Details panel, including socketed gem details for active-deck cards.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: Please visually review the rail vertical spacing in Choose Fight at 720x1280.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Add Choose Fight active-deck section divider\n- CHANGED: Added a horizontal divider above the active-deck rail and renamed its header from ACTIVE DECK · READ ONLY to ACTIVE DECK.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: Enemy cards and the read-only active deck now read as separate sections without redundant explanatory wording.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Show active-deck type progress in Choose Fight\n- CHANGED: Reused the deck identity tally renderer beneath the read-only active-deck rail in Choose Fight.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: The preview now shows up to four type progress tallies toward the 3-card threshold, such as SWORD 3/3, LANCE 1/3, NATURE 1/3, and LIGHTNING 1/3, plus the active identity matchup text when unlocked.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Stack Choose Fight deck type tallies\n- CHANGED: Stacked the active-deck type progress lines vertically in Choose Fight instead of placing them side by side.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: Choose Fight now shows one type tally per line; Deck Build keeps its compact inline identity summary.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Extend Choose Fight active-deck section\n- CHANGED: Extended the active-deck section to the bottom of the Choose Fight panel with a dedicated framed area for the cards and stacked type summary.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts\n- DESIGN: The outer fight panel and bottom inspector remain in place; the active-deck content now has enough visual and vertical room for its stacked tallies.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n\n### 2026-07-20 — Codex — Standardize Prep and Battle footer buttons\n- CHANGED: Added FOOTER_ACTION_LAYOUT to the shared theme and reused it for Prep and Battle bottom action buttons.\n- FILES: src/game/theme.ts, src/game/scenes/PrepScene.ts, src/game/scenes/BattleScene.ts\n- DESIGN: Both screens now use the same footer height, Y position, first/second button widths, and horizontal offsets; labels and actions remain screen-specific.\n- VERIFY: npm run build = pass · npm test = pass (320 tests) · npm run typecheck = clean.\n- REQUESTS TO CLAUDE: none\n- OPEN: None.\n- Claude review: Pending.\n
### 2026-07-23 — Codex — Show mobile battle outcome at final turn
- CHANGED: Moved the Mobile Battle victory/defeat banner trigger from the final event step to the first step of the final combat turn.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The outcome banner now appears as soon as playback reaches the final turn instead of waiting through every event-level result line; scrubber, replay, and event playback timing remain unchanged.
- VERIFY: npm run typecheck = pass · npm run build = pass · npm test = fail (boundary check pass; 326 tests pass, existing dirty engine/data balance audit fails with effect-cap violations).
- ASSUMPTIONS: The simulation result is already authoritative before playback begins, so announcing it at the final turn is consistent with the mobile playback model.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball a longer mobile fight and confirm the banner timing feels immediate without obscuring the final-turn log.
- Claude review: Pending.
### 2026-07-23 — Codex — Tune mobile death-to-result timing
- CHANGED: Added a short 160ms death beat between the DOWN log step and the RESULT step; normal playback remains 450ms per event step.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The defeated unit's DOWN line remains readable briefly, then the victory/defeat banner appears quickly without feeling instantaneous or waiting a full playback interval.
- VERIFY: Pending final typecheck/build after timing adjustment.
- ASSUMPTIONS: 160ms is a reasonable mobile result-transition beat and can be tuned after a live eyeball.
- REQUESTS TO CLAUDE: none
- OPEN: Please evaluate the death beat in a longer fight; adjust toward ~120ms if it still feels late or ~200ms if the DOWN state is too easy to miss.
- Claude review: Pending.
### 2026-07-23 — Codex — Stop mobile playback at lethal hit
- CHANGED: Truncated the mobile event timeline at the first HP snapshot reaching zero, removing redundant DOWN/RESULT scrubber steps after the killing hit.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The lethal hit is now the final scrollbar event and the result banner is shown on that final state; replay no longer requires advancing through several post-death ticks.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: The first damage/heal-derived snapshot at 0 HP is the authoritative visual end of combat; engine events remain unchanged.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball a lethal mobile fight and confirm the scrubber ends exactly on the hit that reaches 0 HP.
- Claude review: Pending.
### 2026-07-23 — Codex — Keep outcome out of mobile turn header
- CHANGED: Removed VICTORY/DEFEAT text from the compact top-left turn header.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The header now stays limited to turn/playback status, while the larger result banner remains the only outcome indicator and no longer competes with stat text.
- VERIFY: Pending typecheck.
- ASSUMPTIONS: The centered result banner is sufficient outcome feedback.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Route desktop launches to the proper horizontal shells
- CHANGED: Desktop `view=prep` now opens DesktopPrep and desktop `view=deck` now opens DesktopDeck, replacing the legacy narrow PrepScene rail for desktop launches.
- FILES: src/game/scenes/BootScene.ts, docs/codex-handoff.md
- DESIGN: The legacy mobile-sized desktop panel remains available only through the legacy Prep scene; normal desktop entry now uses the full-width horizontal card rails shown in the new desktop shells.
- VERIFY: npm run typecheck = pass · npm run build = pass · browser smoke: `?ui=desktop&view=prep` -> DesktopPrep; `?ui=desktop&view=deck` -> DesktopDeck.
- ASSUMPTIONS: The supplied screenshot is the old PrepScene active-deck view that should be replaced for normal desktop entry.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Make desktop Prep and Deck cards horizontal
- CHANGED: Reworked the first-pass desktop Prep loadout into one horizontal card rail and changed Desktop Deck Build to a full-width horizontal board rail with a horizontal bag rail beneath it.
- FILES: src/game/scenes/DesktopPrepScene.ts, src/game/scenes/DesktopDeckBuildScene.ts, docs/codex-handoff.md
- DESIGN: Desktop card placement now follows the legacy across-the-page rail pattern instead of vertically stacking cards; card proportions and the shared full-card renderer remain unchanged.
- VERIFY: npm run typecheck = pass · npm run build = pass · browser smoke: desktop-prep and desktop-deck boot expected scenes.
- ASSUMPTIONS: “Across instead of vertical” refers to the active board/loadout and bag card rails.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Remove Battle from desktop browse navigation
- CHANGED: Removed BATTLE from the desktop page tabs; combat remains reachable through the Prep FIGHT action only.
- FILES: src/game/ui/DesktopNav.ts, src/game/scenes/DesktopWikiScene.ts, docs/codex-handoff.md
- DESIGN: Battle is an encounter state, not a browsable hub page, so the desktop navigation now contains only PREP, DECK BUILD, and WIKI.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: Starting a configured fight is the only intended entry into Battle.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Expand desktop canvas and start page shells
- CHANGED: Tightened Desktop Wiki spacing to five aligned columns, increased the selected inspector card, raised desktop text texture resolution to 6×, and added initial DesktopPrep and DesktopDeck scenes with shared horizontal navigation; Wiki now routes PREP and DECK BUILD into those desktop shells.
- FILES: src/game/scenes/DesktopWikiScene.ts, src/game/scenes/DesktopPrepScene.ts, src/game/scenes/DesktopDeckBuildScene.ts, src/game/ui/DesktopNav.ts, src/game/layoutProfile.ts, src/game/devLaunch.ts, src/game/scenes/BootScene.ts, src/main.ts, docs/codex-handoff.md
- DESIGN: Desktop page work starts from one shared horizontal header and flexible canvas; the existing card renderer remains the card source of truth. Battle continues to use the existing Battle scene while its desktop shell is the next refinement.
- VERIFY: npm run typecheck = pass · npm run build = pass · browser smoke: desktop-prep, desktop-deck, and desktop-wiki each boot their expected scene.
- ASSUMPTIONS: Five smaller gallery cards plus a larger selected card uses the available desktop space better than a sparse four-card gallery.
- REQUESTS TO CLAUDE: none
- OPEN: Desktop Prep/Deck are first-pass shells; interaction polish and a dedicated Battle shell remain.
- Claude review: Pending.
### 2026-07-25 — Codex — Give Wiki inspector card clear spacing
- CHANGED: Reduced the desktop inspector preview to a controlled 260px width, moved it into its right-side lane, and added a larger gap before the centered ADD TO BAG button.
- FILES: src/game/scenes/DesktopWikiScene.ts, docs/codex-handoff.md
- DESIGN: The selected card no longer crowds the action or competes with nearby gallery text; the card face remains the only description surface.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: A 260px inspector card with 64px center-to-center action spacing is the right balance for the 1440×900 desktop canvas.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Strengthen existing weapon hex badge frame
- CHANGED: Added a thicker, weapon-accented hex outline over the existing weapon badge shape; the full card silhouette remains tier-colored.
- FILES: src/game/ui/FantasyCardTemplateV2.ts, docs/codex-handoff.md
- DESIGN: Tier color belongs to the card frame; weapon color belongs only to the existing hexagon badge frame around the weapon icon.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: The requested “hexagon shape frame” is the existing type badge around weapon icons.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Simplify desktop card detail action
- CHANGED: Removed the repeated desktop description/detail copy and centered a single ADD TO BAG button directly beneath the selected full card.
- FILES: src/game/scenes/DesktopWikiScene.ts, docs/codex-handoff.md
- DESIGN: The card face is the source of truth for its description; the surrounding detail area now acts only as a clean action zone.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: Keep the card itself as the only information surface and the button centered under it.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Keep card frame color tier-based
- CHANGED: Removed the weapon-specific badge ring so the shared card frame remains controlled only by Bronze/Silver/Gold/Diamond tier skin colors.
- FILES: src/game/ui/FantasyCardTemplateV2.ts, docs/codex-handoff.md
- DESIGN: Weapon identity stays in the existing weapon badge; frame identity is consistently tier-based across all card types.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: “Those frames” refers to the full card silhouette/frame, not the weapon icon badge.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-25 — Codex — Correct desktop battle route and card rendering accents
- CHANGED: Desktop Wiki BATTLE now routes to the desktop Battle scene; desktop text rendering uses a higher resolution; weapon identity is shown by a colored ring around the weapon badge while the overall card silhouette keeps its tier color.
- FILES: src/main.ts, src/game/scenes/DesktopWikiScene.ts, src/game/ui/FantasyCardTemplateV2.ts, docs/codex-handoff.md
- DESIGN: The card silhouette remains tier-led; weapon color is scoped to the weapon icon frame only. The desktop profile uses a 4× text texture resolution for sharper labels.
- VERIFY: npm run typecheck = pass · npm run build = pass · browser smoke: DesktopWiki boots with no console errors and BATTLE starts Battle.
- ASSUMPTIONS: Magic icon softness is primarily from desktop canvas/text scaling; the existing authored badge textures remain the source of truth.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-24 — Codex — Tune shared card type accents
- CHANGED: Weapon cards now use their authored WEAPON_COLOR accent for the shared silhouette trim; elemental/magic type badges are scaled up slightly for stronger recognition.
- FILES: src/game/ui/FantasyCardTemplateV2.ts, docs/codex-handoff.md
- DESIGN: Tier remains the default trim language for non-weapon cards; weapon identity is now carried by the frame while magic identity gets a more prominent existing icon badge.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: “More hp” meant more visual pop/readability for magic icons.
- REQUESTS TO CLAUDE: none
- OPEN: If “more hp” meant a specific icon replacement or HP-themed symbol, adjust after user clarification.
- Claude review: Pending.
### 2026-07-24 — Codex — Preserve magic badge sharpness
- CHANGED: Removed the experimental magic badge enlargement so the authored 80×80 elemental textures render at their intended scale and remain sharper on desktop.
- FILES: src/game/ui/FantasyCardTemplateV2.ts, docs/codex-handoff.md
- DESIGN: High definition is handled by using the real badge textures without enlarging them; weapon frame accents remain in place.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: “High definition” meant sharper source rendering, not larger icon dimensions.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-24 — Codex — Build actual desktop Wiki card surface
- CHANGED: Added a dedicated DesktopWiki scene using the existing FantasyCardTemplateV2 renderer directly, with a horizontal navigation header, responsive desktop canvas, filters, card selection, detail view, and ADD TO BAG action.
- FILES: src/game/scenes/DesktopWikiScene.ts, src/game/layoutProfile.ts, src/game/devLaunch.ts, src/game/scenes/BootScene.ts, src/main.ts, docs/codex-handoff.md
- DESIGN: Desktop expands the surrounding canvas while preserving the authored mobile card silhouette and typography; no sideways navigation rail or replacement HTML card renderer is used.
- VERIFY: npm run typecheck = pass · npm run build = pass · browser smoke: ?scene=desktop-wiki&ui=desktop boots DesktopWiki with no console errors.
- ASSUMPTIONS: Desktop Wiki is the first implementation slice; Prep, Deck Build, and Battle can adopt the same horizontal shell after this card surface is approved.
- REQUESTS TO CLAUDE: none
- OPEN: DesktopWiki currently shows the first eight filtered cards; broader desktop scene migration remains after visual approval.
- Claude review: Pending.
### 2026-07-24 — Codex — Lock desktop Wiki card alignment
- CHANGED: Rounded the shared desktop card height and used one explicit row stride so every FantasyCardTemplateV2 card shares the same portrait baseline and spacing.
- FILES: src/game/scenes/DesktopWikiScene.ts, docs/codex-handoff.md
- DESIGN: This is the first incremental desktop-template refinement; card geometry stays fixed while surrounding layout remains unchanged for review.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: Equal card silhouette and baseline are the preferred starting point before further desktop spacing or shell changes.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-23 — Codex — Add end-of-fight card damage summary
- CHANGED: Added a separate CARD DAMAGE summary box above the mobile victory/defeat banner.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The result state now shows the top player cards by direct skill damage plus a total across the fight; the combat log remains unchanged and no playback steps are added.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: Summary uses player skill damage dealt to the enemy (`amount - blocked`), excluding poison/burn/fatigue ticks.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-23 — Codex — Expand end-of-fight summary metrics
- CHANGED: Expanded the separate result summary box to include player damage, enemy damage, player healing, and player card-damage breakdown.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The combat log remains unchanged. The summary above the victory/defeat banner now covers both sides’ direct skill damage and the player’s healing, with the player’s card damage listed below.
- VERIFY: npm run typecheck = pass.
- ASSUMPTIONS: Enemy damage means direct enemy skill damage; player healing sums heal events received by the player. Damage-over-time is excluded from card attribution.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball the summary box on a long fight for vertical fit above the result banner.
- Claude review: Pending.
### 2026-07-23 — Codex — Show per-card combat result ledger
- CHANGED: Expanded the separate end-of-fight summary to list every card used by either side.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: Each card row shows `DMG / SHIELD / HEAL / DOT` values, with YOU/FOE ownership labels; the existing combat log remains unchanged.
- VERIFY: npm run typecheck = pass.
- ASSUMPTIONS: DOT is the number of poison/burn/bleed stacks applied by the card; direct skill damage uses HP lost after blocking.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball a fight using cards with mixed effects to confirm the compact two-column ledger is readable above the result banner.
- Claude review: Pending.
### 2026-07-23 — Codex — Redesign mobile result ledger
- CHANGED: Reworked the end-of-fight card ledger into a compact two-column result panel with side accents, clear metric labels, and zero-output card filtering.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: War Banner and other cards with no measurable damage, shield, healing, or DOT output are omitted. Meaningful cards show only their nonzero metrics; the combat log is unchanged.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: “DOT” summarizes applied poison/burn/bleed stacks, while direct damage remains post-block HP loss.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball the redesigned ledger on a long fight for fit above the result banner.
- Claude review: Pending.
### 2026-07-23 — Codex — Hide irrelevant result metrics
- CHANGED: Made the summary totals strip conditional so it only renders damage, enemy damage, or healing when that metric is nonzero.
- FILES: src/game/scenes/MobileBattleScene.ts, docs/codex-handoff.md
- DESIGN: The ledger now avoids empty stat labels and shows “No measurable output” only when the fight produced no tracked output.
- VERIFY: npm run typecheck = pass.
- ASSUMPTIONS: Zero-value card metrics remain hidden individually as in the previous redesign.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-23 — Codex — Make mobile deck drops insert and shift spans
- CHANGED: Replaced mobile deck-build occupied-slot swaps/free-slot placement with span-aware insertion and same-strip reordering.
- FILES: src/game/scenes/MobileDeckBuildScene.ts
- DESIGN: Dropping a larger card between cards now shifts neighboring cards to make room in the deck or bag, preserving order. Cross-zone drops use the same insertion behavior; drops still reject cleanly when the 10-slot strip cannot fit the arrangement.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: The pointer’s slot row is the requested insertion position; card spans remain contiguous and cannot overflow the strip.
- REQUESTS TO CLAUDE: none
- OPEN: Please test a size-2 or size-3 card dropped between occupied cards in both ACTIVE DECK and BAG.
- Claude review: Pending.
### 2026-07-23 — Codex — Restore mobile Wiki card gallery layout
- CHANGED: Replaced the compressed one-column CardToken catalog with the approved FantasyCardTemplateV2 card presentation in a two-column gallery, and reserved a top filter band.
- FILES: src/game/scenes/MobileWikiScene.ts, docs/codex-handoff.md
- DESIGN: Mobile Wiki now has a dedicated CARD LIBRARY / FILTERS header area, two full card columns below it, and scroll/tap hit testing aligned to the new card bounds. Filter chips are visual placeholders until filtering is wired.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: The existing FantasyCardTemplateV2 is the “proper card UI” to restore; card detail and add-to-bag behavior remain unchanged.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball `?scene=mwiki` at the mobile profile and confirm the two-column card scale feels right before wiring filter behavior.
- Claude review: Pending.
### 2026-07-23 — Codex — Set mobile Wiki to two-column compact gallery
- CHANGED: Restored the filter band, changed the Wiki catalog to a two-column compact CardToken gallery, and kept the full FantasyCardTemplateV2 treatment in the clicked-card detail modal.
- FILES: src/game/scenes/MobileWikiScene.ts, docs/codex-handoff.md
- DESIGN: Wiki now matches the Prep/Deck Build mobile shell and density: filter area above, two compact card columns below, full card UI only when inspecting a card. Scrolling and tap hit testing follow the two-column geometry.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: The requested “previous filter section” is the compact CARD LIBRARY / FILTERS band; its chips remain reserved visual controls until filtering is wired.
- REQUESTS TO CLAUDE: none
- OPEN: Please eyeball `?scene=mwiki` and tap a card to confirm the full card modal reads correctly.
- Claude review: Pending.
### 2026-07-23 — Codex — Add Wiki card detail close button
- CHANGED: Added an explicit close button to the mobile Wiki card detail modal.
- FILES: src/game/scenes/MobileWikiScene.ts, docs/codex-handoff.md
- DESIGN: The modal can now be dismissed from its top-right CLOSE control or by tapping the backdrop.
- VERIFY: npm run typecheck = pass.
- ASSUMPTIONS: Backdrop dismissal remains useful as a secondary mobile gesture.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-23 — Codex — Simplify Wiki card detail overlay
- CHANGED: Removed the extra modal frame and metadata panel; the clicked card now appears by itself over the dimmed backdrop with ADD TO BAG directly underneath.
- FILES: src/game/scenes/MobileWikiScene.ts, docs/codex-handoff.md
- DESIGN: Added pointer propagation guards so CLOSE and ADD TO BAG cannot trigger the card/gallery action behind them.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: Backdrop tap remains a valid dismiss gesture; the card UI itself carries the card’s authored details.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-23 — Codex — Anchor Wiki close control to card edge
- CHANGED: Moved the Wiki detail close button from the screen corner to the card’s upper-right outside edge.
- FILES: src/game/scenes/MobileWikiScene.ts, docs/codex-handoff.md
- DESIGN: The close control now visually belongs to the card detail while staying outside the card artwork.
- VERIFY: npm run typecheck = pass.
- ASSUMPTIONS: The card remains centered and the close control has enough right-side safe area at the mobile profile width.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-23 — Codex — Add Wiki weapon and magic filters
- CHANGED: Made the Wiki filter band functional with ALL, WEAPON, and MAGIC card-type filters.
- FILES: src/game/scenes/MobileWikiScene.ts, docs/codex-handoff.md
- DESIGN: Filter selection rebuilds the existing two-column gallery and updates the visible card count; card detail behavior is unchanged.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: MAGIC maps to cards with an authored element; WEAPON maps to cards with an authored weapon type.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
### 2026-07-24 — Codex — Focus mobile end-of-fight result overlay
- CHANGED: Added a dimmed board overlay behind the battle ledger/result banner and a stronger highlighted END button when the outcome is reached.
- FILES: src/game/scenes/MobileBattleScene.ts, src/game/ui/ActionBar.ts, docs/codex-handoff.md
- DESIGN: The result layer now reads as a focused modal state without obscuring the ledger or footer; END uses a brighter fill and stronger border only in the outcome state.
- VERIFY: npm run typecheck = pass · npm run build = pass.
- ASSUMPTIONS: The board area is the correct dimming scope; the top log and bottom actions remain active/readable.
- REQUESTS TO CLAUDE: none
- OPEN: None.
- Claude review: Pending.
