> **Scope:** PROPOSAL. Gate mechanism + 7 events + lints: BUILT (77cb57b); legibility rungs 1-3: BUILT (4dcae89).
> Still open: interactivity rung 4 (authored two-steps — recommended NOT built), and the rejected-designs register below stays binding.

# Event content design — chains, biome-aware doors, interactivity

> **Scope:** DESIGN SPEC only — no repo files were touched. Everything below is
> grounded in the shipped code as of 2026-09-02; every mechanism cites the
> file:line it relies on. Where a design needs a seam that does not exist yet,
> the seam is named explicitly and justified (per the brief's rule: prefer
> composing the 12 existing outcome kinds; new kinds/fields must be declared).
>
> Context absorbed: `src/data/events.ts` (full header: the P19/P22 door pass,
> doors ADDED BESIDE broad pools at lines 70–99, pool-width rule 100–107,
> honesty rule 109–115, safe-exit invariant 14–15, gamble removal 10–14, max-3
> reservation math 231–253) · `src/run/events.ts` (resolver: `firstEligibleIndex`
> :374, theme bags :378–504, `isEventChoiceUsable` :350, once-per-node memos
> :8–14/:1220–1229) · `src/run/runState.ts` (`EventResolution` :153,
> `eventResolutions` :306, `eventInstances` :288, `RunStats` :96–141) ·
> `docs/biome-paths-proposal.md` (Phase 1 SHIPPED; fork is Phase 3, NOT built) ·
> `src/run/biome.ts` + `src/data/biomes.ts` (11 biomes, per-band deal,
> `eventThemes` per biome) · `src/run/biomeForecast.ts` :19–24 ("predictable in
> KIND, surprising in DETAIL").

---

## 1. The gate mechanism — one shape, two seams, zero new save fields

### 1.1 What the run already remembers (the memory a chain reads)

- `RunState.eventResolutions?: Record<nodeId, EventResolution>` —
  `src/run/runState.ts:306`, shape `{ eventId, choiceId, pending? }` at
  `runState.ts:153–170`. Written by `resolveEventChoice`
  (`src/run/events.ts:1199`, record at the return via `recordEventResolution`
  :240). It exists for idempotency (one rung per node, forever — the re-entry/
  reload double-charge bug its doc comment describes), and it is EXACTLY a
  per-run ledger of `(eventId, choiceId)` pairs. **A gate is a scan of this
  ledger. No new field.**
- `RunState.eventInstances: Record<nodeId, eventId>` — `runState.ts:288`,
  written on first draw (`rollEventForNode`, `events.ts:414`). This is the
  once-per-run ledger for DRAWN events. **"Has this chained event already
  fired this run" is a scan of this. No new field.**
- `RunState.stats` (`RunStats`, `runState.ts:96–141`) plus `wins`/`losses`
  (:310–311), `bossesCleared` (:212), `livesLost` (:119, written by
  `recordBattleResult` :1027) — the tally counters battle/shop chains read.

A `pending` resolution counts as a committed choice for gating purposes: the
cost is paid and the choice is recorded the moment `resolveEventChoice` returns
(`events.ts:1244–1250`); `pending` only means the deferred picker has not been
answered yet (`runState.ts:157–166`). Gates ignore the flag.

### 1.2 The gate shape (in `src/data/events.ts`)

```ts
/** "This unlocks only after the player resolved that." Pure read of
 * RunState.eventResolutions — no Rng, no new save field. */
export interface EventGate {
  /** Catalog event whose past resolution unlocks this. */
  eventId: string;
  /** Which choice ids on that event count; absent = any choice of eventId. */
  choiceIds?: readonly string[];
}

/** "This unlocks only once a run counter reaches a bar." Pure read of the
 * fields RunState already maintains. */
export interface EventTallyGate {
  stat: 'goldSpent' | 'cardsBought' | 'gemsBought' | 'livesLost'
      | 'wins' | 'losses' | 'bossesCleared';
  atLeast: number;
}
```

Both are added, optionally, in two places:

- `EventChoiceDef.requires?: EventGate` / `requiresTally?: EventTallyGate` — a
  **gated rung** on an otherwise ordinary event.
- `EventDef.requires?: EventGate` / `requiresTally?: EventTallyGate` — a
  **chained event** that cannot be drawn at all before the gate opens.

One predicate implements both, exported from `src/run/events.ts` beside
`isEventChoiceUsable`:

```ts
export function eventGateMet(state: RunState, gate: EventGate): boolean {
  const rs = state.eventResolutions ?? {};
  for (const nodeId of Object.keys(rs)) {
    const r = rs[nodeId]!;
    if (r.eventId !== gate.eventId) continue;
    if (!gate.choiceIds || gate.choiceIds.includes(r.choiceId)) return true;
  }
  return false; // order-independent: a boolean "some", so key order is moot
}
```

Tally gates read the named field directly (`stat` resolved against
`state.stats` or the three top-level counters). Both are pure reads of
persisted state — no Rng call, no save-shape change, reload-stable.

### 1.3 Seam A — the gated CHOICE (3-line change)

`isEventChoiceUsable` (`src/run/events.ts:350–363`) is already the single
predicate authority for "may this rung be offered", with two outcome-specific
preconditions (`sellGem`'s empty-pouch gate :352, `mergeCards`' no-plan gate
:361). Gates become the third precondition, and — decisively — an
**outcome-agnostic** one:

```ts
if (choice.requires && !eventGateMet(state, choice.requires)) return false;
if (choice.requiresTally && !tallyMet(state, choice.requiresTally)) return false;
```

Everything downstream is free, because everything already routes through this
predicate:

- **UI dimming** — both event scenes call it per button
  (`src/game/scenes/MobileRunEventScene.ts:478`,
  `DesktopRunEventScene.ts:425`).
- **Event eligibility** — `hasAffordableChoice` (`events.ts:369–371`) uses it,
  so an event whose only live rung is gate-locked is not drawn.
- **Resolver posture** — `resolveEventChoice` does NOT re-check usability
  today (the documented KNOWN GAP at `tests/run/events.test.ts:666`: an
  unaffordable priced choice still resolves, gold floored at 0). Gates take
  the identical posture: the UI predicate is the guard; the once-per-node
  throw (`events.ts:1220–1229`) already kills the dangerous replay class.
  Nothing about a gate makes bypassing it an exploit (the locked rung's
  outcome is an ordinary priced outcome), so symmetry is safe and cheap.

### 1.4 Seam B — the gated EVENT, and the theme-bag starvation trap

The naive design — put the chained event in its theme bag like any other and
let `hasAffordableChoice` filter it — has a **provable starvation failure**:

1. Bag entries the draw skips STAY in the bag (`events.ts:392–396`: "entries
   the draw skips stay in the bag (order otherwise preserved) so they remain
   available to later nodes once affordable again").
2. A bag refills only at `bag.length === 0` (`events.ts:469`).
3. So a permanently-locked resident pins its theme's bag at length ≥ 1
   forever: the theme NEVER refills, and once every other id is consumed,
   every subsequent draw of that theme takes the widen-to-catalog path
   (`events.ts:475–491`), which returns the FIRST eligible id in fixed catalog
   order (`firstEligibleIndex(eventCatalogIds, state)` :481). For `training`
   that is `wandering_tutor` (catalog position 1, `data/events.ts:258`) —
   **every training node, the same event, for the rest of the run.** Theme
   rotation is dead.

**The fix: gated events never enter a bag at all.** Three changes in
`src/run/events.ts`, no changes anywhere else:

1. **Bag pools exclude gated ids.** `idsForTheme` (`events.ts:405–407`) gains
   `.filter((id) => eventCatalog[id]!.requires === undefined && eventCatalog[id]!.requiresTally === undefined)`;
   the defensive all-catalog bag's refill pool (`events.ts:432–434`) and the
   widen-to-catalog scan (:481) get the same treatment (the widen scan may
   include a gated id only when its gate is met and it has not fired — see
   below). Because gated ids never join a pool, **every existing seeded event
   sequence is byte-identical until a gate opens** — the same
   zero-perturbation discipline `ruined_anvil/beat_together` documented for
   the merge door (`data/events.ts:650–659`). (Ungated new events DO reshuffle
   their theme's bag, like any content batch — see §3.6.)

2. **A priority scan runs before the bag scan** in `rollEventForNode`
   (`events.ts:414`), immediately after the `eventInstances` memo check
   (:418–423, which stays authoritative — a reload never re-draws):

   ```ts
   // Chained events: never bagged, drawn by priority the first time their
   // gate is open at a node of their theme. Fixed catalog order; pure read.
   const ready = gatedIdsForTheme(theme).find((id) => {
     const ev = eventCatalog[id]!;
     return gatesMet(state, ev)                                    // 1.2
       && !Object.values(state.eventInstances).includes(id)        // once/run
       && hasAffordableChoice(state, ev);                          // :369
   });
   if (ready) { /* memoize eventInstances[node.id] = ready; BAG UNTOUCHED */ }
   ```

   - **Once per run** comes free from `eventInstances` (`runState.ts:288`) —
     the run already records every draw, and the map deliberately never
     pre-draws events for unvisited nodes (`runMap.ts:79–83`: labeling uses
     `node.eventTheme` precisely so drawing doesn't consume the bag), so
     "in `eventInstances`" ⇔ "actually shown to the player".
   - **The bag is untouched** when a priority draw fires — no reshuffle-seed
     bookkeeping, no persisted-bag mutation, no new Rng call anywhere. The
     whole draw remains a pure function of `state`, and determinism tests
     hold: same state ⇒ same draw.
   - **Two unlocked chains in one theme**: fixed catalog order decides; the
     second fires at the following node of that theme. Deterministic, and
     never a loss — both remain "ready" until drawn.
   - **Why priority, not bag-insertion-on-unlock**: the run's own measurement.
     One merge door in the 6-deep forge bag reached 64.2% of runs; a bag
     resident that must ALSO outlive its unlock reaches strictly fewer — "an
     event a third of runs never see is a mechanic that was not built"
     (`data/events.ts:742–749`). Priority makes the payoff land at the NEXT
     node of its theme, which is the best delivery the path-dependent map can
     honestly promise.

3. **Theme honesty is preserved.** A chained event carries a normal `theme`
   and fires only at nodes labeled with it (`RunNode.eventTheme`,
   `runMap.ts:84`), so the map's "EVENT · TRAINING" door never lies — exactly
   `biomeForecast.ts:19–24`'s principle: the KIND was readable, the DETAIL
   (that this training stop is the tutor come back) is the surprise.

### 1.5 What the catalog lint tests must newly enforce

Additions to `tests/run/events.test.ts` (existing lints at :85–316 all still
apply to new content unchanged — 2–3 choices :116, vocabulary :131, pool
widths :140–249):

- **L1 — gates resolve.** Every `requires.eventId` is a real catalog id and
  every member of `choiceIds` a real choice id on it. A dangling gate is a
  chain that can never fire: dead content, build-time loud.
- **L2 — depth-1 chains.** The TARGET of any gate must itself be ungated (and
  no event may require itself). This forbids cycles and unreachable ladders in
  one rule; multi-hop chains are a deliberate later pass, not a v1 accident.
- **L3 — bag health.** Every theme retains **≥ 2 UNGATED events** (upgrades
  the existing "every theme has at least 2 events" lint at :98): the bag pool
  is now `idsForTheme` minus gated ids and must never be empty.
- **L4 — gate-independent eligibility for bag residents.** For every UNGATED
  event, its UNGATED choices alone must satisfy the gold-0 eligibility bar the
  suite already walks (:447). Otherwise a bag-resident event could be
  invisible-until-gate — the starvation trap of §1.4 sneaking back in at the
  choice level.
- **L5 — the safe exit is ungated.** The cost-0 safe-exit choice the :124 lint
  demands must carry no `requires`/`requiresTally` (a locked exit is no exit).
- **L6 — an unlocked chain is deliverable.** For an event-level-gated event:
  for EVERY single way its gate can be met (each `choiceIds` member alone; the
  tally bar alone), construct that minimal state and assert
  `hasAffordableChoice` at gold 0. This is what guarantees "gate opens ⇒ fires
  at the next theme node" instead of "fires if the player is also rich".
- **L7 — census updates.** The exact-count lints (:86 "exactly 32 events",
  :251 outcome census) move with the batch (§3.6 lists the new numbers).
- **L8 — derived-filter width (only if §3.1/§3.5's `filterFrom` seam ships).**
  For each `filterFrom` source, assert the WORST-CASE pool over all 11 types
  is ≥ `EVENT_CHOICE_SIZE` (and ≥ `BONUS_DRAFT_SIZE` if any bonusDraft ever
  carries one) — the generalization of the pool-width rule at
  `data/events.ts:100–107`. Today's floor: bow/frost at 10 cards.
- **Determinism/perturbation tests**: (a) seeded reproducibility with gates in
  play; (b) the zero-perturbation assertion — a walked run that never
  satisfies any gate produces the byte-identical event sequence the current
  catalog produces (gated ids never entered any pool).

### 1.6 P22 — how the player learns the past mattered (per design, stated below)

Every design in §2–3 answers the door question in three layers: (i) the SETUP
event's body promises memory in fiction, (ii) the PAYOFF's body names the past
act explicitly, (iii) the locked/lit rung is visible via `isEventChoiceUsable`
dimming today and the §4 ladder's lock-reason line tomorrow. A chain that
fails (i)–(ii) is unshippable content by this spec's own rule.

---

## 2. The two chains, fully specified

### 2.1 `tutors_return` — "The Tutor's Return" (recognition chain)

Setup: `wandering_tutor/pay` — 2 gold, `grantLevel` (`data/events.ts:264`).
The hook is ALREADY PLANTED in the shipped body (:262): *"Her lesson won't be
free — but it won't be forgotten, either."* The setup event changes by zero
bytes.

Safe-shape audit: **recognition** — the setup was full value at spot price
(2g → level is the catalog rate: `sparring_circle/lesson` :425,
`hermits_riddle/press_further` :454). If the return never draws (player never
hits another training node), nothing was borrowed and nothing is owed.

```ts
{
  id: 'tutors_return',
  title: "The Tutor's Return",
  theme: 'training',
  requires: { eventId: 'wandering_tutor', choiceIds: ['pay'] },
  body: 'You know the gnarled staff before you know the face: the old '
    + 'sellsword from the Hollow Yard, planted at the edge of the practice '
    + 'ring as if the two of you had set an appointment. "You paid for a '
    + 'lesson," she says. "You got half of one. I don\'t leave debts '
    + 'standing — mine or anybody\'s." The second half won\'t cost you a '
    + 'coin. Her sparring circle, though, still charges for the privilege.',
  choices: [
    // The recognition payoff: free where the catalog charges 2, bounded by
    // once-per-run (priority draw + eventInstances) and by the 2g already
    // paid at the setup. Cost-0 and non-nothing, so the event is eligible at
    // ANY gold the moment the gate opens (lint L6) — it fires at the very
    // next training node.
    { id: 'finish_lesson', label: 'Take the second half of the lesson',
      outcome: { kind: 'grantLevel' } },
    // Catalog-rate paid sibling: 2g bonusDraft, the exact price/width of
    // weighing_stone/press_harder (data/events.ts:787–794). No undercut.
    { id: 'spar_the_yard', label: 'Spar with her circle (2 gold)', cost: 2,
      outcome: { kind: 'bonusDraft' } },
    { id: 'part_ways', label: 'Tell her the debt is settled',
      outcome: { kind: 'nothing' } },
  ],
}
```

- **Gate, precisely**: drawable at a `training`-themed event node once any
  `eventResolutions` value equals `{eventId:'wandering_tutor',
  choiceId:'pay'}` (pending or not), and `'tutors_return' ∉
  Object.values(eventInstances)`.
- **P22 telegraph**: (i) setup body's "won't be forgotten" (shipped); (ii) the
  return's body names the paid lesson; (iii) §4 rung 2 renders "You paid for
  her lesson in the Hollow Yard." above the body.
- **Reach**: `training` is preferred by hallowfield/pikewold/swornhold
  (`data/biomes.ts:244,307,345`) and appears in every band's theme rotation;
  `wandering_tutor` is training's catalog-first event, so the setup itself is
  common.

### 2.2 `the_reckoning` — "The Reckoning" (tally chain)

Reads the holy-vs-dark record at `crossroads_shrine` (`data/events.ts:323–357`
— `tithe` = the 100% holy door :336–341, `moon_rite` = the 100% dark door
:349–354). The shrine sits in the `omen` bag and can recur across bag refills,
so a long run can hold multiple shrine resolutions — the ledger scan
(`eventGateMet`, §1.2) is a genuine tally read.

Safe-shape audit: **tally** — the payoff reads accumulated history and always
has an answer: the event cannot draw until at least one face was honored
(event gate), and whichever faces were honored are exactly the rungs that are
lit. Nothing is taken early; a run that never revisits omen loses only upside.

```ts
{
  id: 'the_reckoning',
  title: 'The Reckoning',
  theme: 'omen',
  // Fires only for a player who honored at least one face. Defacing the
  // shrine (deface, :355) deliberately does NOT summon it — scrap is scrap.
  requires: { eventId: 'crossroads_shrine', choiceIds: ['tithe', 'moon_rite'] },
  body: 'The shrine finds you, this time. A cairn of crossroads stone stands '
    + 'where no cairn stood yesterday, sun-mark and moon-mark cut fresh into '
    + 'its face — and beneath them, in scratches you never made, a tally of '
    + 'everything you ever left at the Crossroads Unquiet. Whatever keeps '
    + 'the shrine\'s accounts has ruled your devotion paid up, and tonight '
    + 'it settles its side of the ledger.',
  choices: [
    // THE SUN'S SETTLEMENT — lit only for a player who has tithed. The
    // shrine's own paid 3-wide holy door, upgraded to a FREE 5-wide one:
    // same 100%-type discipline (P19), bigger because it is the payoff of a
    // 2-gold investment made at the setup. Free single-type bonusDrafts are
    // an established shape (recruiter/pick_sword, data/events.ts:297–301).
    { id: 'sun_road', label: "Take the sun's settlement",
      requires: { eventId: 'crossroads_shrine', choiceIds: ['tithe'] },
      outcome: { kind: 'bonusDraft', filter: [{ elements: ['holy'] }] } },
    // THE MOON'S SETTLEMENT — the dark mirror, lit only after a moon rite.
    { id: 'moon_road', label: "Take the moon's settlement",
      requires: { eventId: 'crossroads_shrine', choiceIds: ['moon_rite'] },
      outcome: { kind: 'bonusDraft', filter: [{ elements: ['dark'] }] } },
    { id: 'keep_walking', label: 'Leave the account open',
      outcome: { kind: 'nothing' } },
  ],
}
```

- **Tally condition, precisely**: `sun_road` usable ⇔ some resolution is
  `(crossroads_shrine, tithe)`; `moon_road` ⇔ some `(crossroads_shrine,
  moon_rite)`. A both-faces run sees BOTH rungs lit and must CHOOSE which
  devotion pays — the tally rendered as agency rather than as a computed
  reward. Lint L6 holds: for each way the event gate can be met, the matching
  cost-0 non-nothing rung is unlocked.
- **Pool widths**: holy and dark single-type pools are ≥ 10 (the catalog's
  thinnest single-type pools are bow and frost at 10 — `data/events.ts:104–105`),
  comfortably over `BONUS_DRAFT_SIZE` 5 (`run/events.ts:42`); the existing
  bonusDraft lint (:167) and `tests/run/eventRewardDoors.test.ts` width pins
  cover it.
- **What v1 deliberately does NOT do**: scale the reward by COUNT (three
  tithes ⇒ a bigger draft). That needs outcome parameters computed from state
  at resolve time — resolver + UI-headline work with no existing seam. Parked
  in §5.7.
- **P22 telegraph**: (i) the shrine's body already promises the faces "answer
  … every time" (:327); (ii) the reckoning's body says the shrine kept the
  account; (iii) an unlit face reads "LOCKED · the moon owes you nothing" via
  the §4 rung-1 lock line, which is itself a door: it teaches that moon rites
  are remembered.
- **Reach**: `omen` is the most biome-preferred theme (duskbarrow, emberwaste,
  frostmarch, hallowfield, stormreach — `data/biomes.ts:181,206,224,244,323`).

---

## 3. Five more designs on unused, already-recorded state

Each entry: full EventDef-shaped spec + the exact state it reads + why it is
implementable today. Two of the five (§3.1, §3.5) share ONE small resolver
seam, declared here once:

> **The `filterFrom` seam (needed by §3.1 and §3.5; NOT a new outcome kind).**
> `cardChoice`/`bonusDraft` specs gain an optional
> `filterFrom?: 'biomeLean' | 'biomeCounter' | 'boardIdentity'`. In
> `applySpec` (`src/run/events.ts:1125`) those two branches first resolve the
> spec through a pure `resolveFilterFrom(state, spec)` that substitutes a
> concrete `CardFilter`:
> - `biomeLean` → the active node's band lean as `[{elements:[t]}]` or
>   `[{weapons:[t]}]`, from `biomeFor(state.seed, node.wave, node.biomeId)`
>   (`src/run/biome.ts:108`; `RunNode.biomeId` `runMap.ts:102`, stamped on
>   every node at map-gen, with the un-stamped-save fallback built in).
> - `biomeCounter` → `counterTypeFor(lean)` (`biome.ts:190`).
> - `boardIdentity` → `boardTypeIdentity(state.pieces.map(p ⇒ skillBook[p.skillId]))`
>   (`src/engine/combat/typeIdentity.ts:56`, threshold
>   `IDENTITY_THRESHOLD = 3` :32; board only — matching the combat fold's own
>   read, typeIdentity.ts:8–13).
> Then the EXISTING `cardChoiceOutcome`/`bonusDraftOutcome` run unchanged, so
> the deferred shape stays `{kind:'bonusDraft', cards}` — **zero UI change,
> zero save change, zero new Rng calls** (the substitution is a pure read; the
> outcome spends its same draws over a different array). Two sources can
> resolve to nothing (`biomeCounter` on a bow band — nothing counters bow,
> `biome.ts:190–199` and `data/biomes.ts:150–157`; `boardIdentity` on an
> uncommitted board): a choice whose `filterFrom` source is unresolvable is
> gated dark by `isEventChoiceUsable` (the same dark-rung idiom as
> `mergeCards`, `events.ts:353–362`). If the known-gap resolve path is taken
> anyway, `resolveFilterFrom` falls back to no filter — the module's standing
> "never throw over a narrow filter" posture (`events.ts:678–688`).
> One `reopenEventChoice` note (`events.ts:1258–1272`): `boardIdentity`
> re-derives against the board AS IT STANDS on re-entry, joining the two
> state-reading kinds the doc already places in that class; `biomeLean`/
> `biomeCounter` are node-fixed and perfectly stable.

### 3.1 `the_lands_measure` — "The Land's Measure" (biome-aware; theme `cache`)

The event that makes the shipped biome layer legible INSIDE an event: one door
matched to the band's lean (build WITH the land), one to its counter (build
AGAINST what lives here — `biome.ts:184–189`: "the counter farms it"). Cache
is preferred by arrowfell/frostmarch/howlmoor/thornwild
(`data/biomes.ts:165,224,266,374`), so this event concentrates where bands
most want to speak.

```ts
{
  id: 'the_lands_measure',
  title: "The Land's Measure",
  theme: 'cache',   // UNGATED — an ordinary cache-bag resident
  body: 'A surveyor\'s drop-box juts from the mud of the Silt Hollows, '
    + 'stenciled with the mark of whatever country you are crossing. The '
    + 'locals cache what the land makes, and any land worth naming only '
    + 'makes one thing well — the box is local work to the last piece. '
    + 'Lashed underneath it rides a hunter\'s kit, picked to hurt what '
    + 'lives here. When anything can.',
  choices: [
    // THE LOCAL DOOR — 100% the band's lean type, at the shrine-door rate
    // (2g cardChoice, data/events.ts:336–341).
    { id: 'local_make', label: 'Take the local make (2 gold)', cost: 2,
      outcome: { kind: 'cardChoice', filterFrom: 'biomeLean', tier: 'bronze' } },
    // THE HUNTER'S DOOR — 100% the lean's counter. DARK on the one band with
    // no counter (the Arrowfell — bow; biomes.ts:150–157 states it in data,
    // the forecast prints it, and this rung now teaches it a third way).
    { id: 'hunters_edge', label: "Take the hunter's kit (2 gold)", cost: 2,
      outcome: { kind: 'cardChoice', filterFrom: 'biomeCounter', tier: 'bronze' } },
    // Safe exit (cost-0; the lint at tests/run/events.test.ts:124 accepts a
    // cost-0 grant — gemsellers_mishap precedent).
    { id: 'gather_stones', label: 'Pocket the loose stones',
      outcome: { kind: 'grantGold', amount: 1 } },
  ],
}
```

- **Implementable today because**: `RunNode.biomeId` is stamped on every node
  (`runMap.ts:89–102`), `RunNode.wave` :51 and `biomeFor`'s fallback
  (`biome.ts:108–113`) cover pre-biome saves; the resolver already holds the
  node (`currentEventNode`, used at `events.ts:1204`). Needs only the
  `filterFrom` seam above.
- **Width safety**: every single-type pool ≥ 10 (`data/events.ts:104–105`) ≥
  `EVENT_CHOICE_SIZE` 3; the `cardChoice` width throw (`events.ts:705–709`)
  and lint L8 both stand guard.
- **P22 / honesty rule** (`data/events.ts:109–115`): a static label cannot
  name a per-band type, so the telegraph is (i) the band banner already on
  screen naming the lean (`leanLabel`, `biome.ts:176`; the forecast surfaces),
  (ii) body copy that promises "the land's one make" — a category the pool
  delivers at 100%, (iii) §4 rung 3 upgrades the label to name the type
  outright ("Take the local make — FROST"). Until rung 3 ships, the label
  promises exactly what it can prove: locality.

### 3.2 `factors_ledger` — "The Factor's Ledger" (shop-seeded chain; theme `market`)

**What the run actually records about shopping** (checked): NOT provenance —
`shopShelves` (`runState.ts:70–79`) keeps each node's remaining offers +
`rerollCount` only; bought offers are removed, not remembered. What IS
recorded: `stats.cardsBought` (`runState.ts:111`, bumped at
:1267/:1325/:1486 — a shop merge counts as a purchase, :1290),
`stats.gemsBought` (:113, bumped at :1347), and `stats.goldSpent` (:109 —
"card/gem buys, shop rerolls, event costs/losses"). So the chain is a TALLY on
spend, not a memory of a named purchase (the named-purchase version is listed
under "needs new state", §5.9).

```ts
{
  id: 'factors_ledger',
  title: "The Factor's Ledger",
  theme: 'market',
  // Tally gate: total coin OUT this run — shop buys, rerolls, event tolls.
  // 12g ≈ two waves of income (run/events.ts:63–66: 4–7g per winning wave),
  // so it opens mid-run for a spender and never for a hoarder.
  requiresTally: { stat: 'goldSpent', atLeast: 12 },
  body: 'A trade factor steps into the road with a ledger already open to '
    + 'your page. "Twelve gold and change, through the stalls and tolls of '
    + 'this road, by my count," she says, turning the book so you can see '
    + 'the tally — and it is your tally, coin for coin. "The road pays its '
    + 'regulars. One credit, one time. Spend it or tear the page."',
  choices: [
    // THE LOYALTY CREDIT — a free gemChoice where the catalog rate is 2g
    // (two_ravens' own pricing note, data/events.ts:803–810). Deliberate,
    // bounded generosity: once per run (priority draw + eventInstances),
    // gated behind 12g of REAL prior spend — a ~17% rebate a hoarder never
    // sees. This is the pricing-arithmetic tension the 2026-08-18 reprice
    // policed (run/events.ts:57–77) resolved the other way ON PURPOSE, and
    // the justification is the gate: the free tier cannot be farmed and
    // cannot be reached without out-spending every paid sibling first.
    { id: 'standing_credit', label: 'Take your standing credit',
      outcome: { kind: 'gemChoice' } },
    // Catalog-rate paid sibling (abandoned_cache/search_thoroughly, :278–283).
    { id: 'bulk_order', label: 'Place a bulk order (2 gold)', cost: 2,
      outcome: { kind: 'cardChoice', tier: 'bronze' } },
    { id: 'tear_the_page', label: 'Tear your page out',
      outcome: { kind: 'nothing' } },
  ],
}
```

- **Implementable today because**: `state.stats.goldSpent` exists and is
  maintained by every spend site (`runState.ts:109`; event costs bump it too,
  `events.ts:1235–1240`). Needs only §1.2's `EventTallyGate` + the §1.4
  priority draw.
- **P22 telegraph**: the body SHOWS the tally ("your tally, coin for coin");
  §4 rung 2 renders the live number ("You have spent 14 gold on this road.").
  The fiction says "stalls and tolls" because `goldSpent` genuinely includes
  event tolls and rerolls — the honesty rule applied to a counter.

### 3.3 `pyre_watch` — "The Pyre-Watch" (battle-outcome chain; theme `omen`)

Reads the battle ledger: `recordBattleResult` (`runState.ts:998–1029`) records
`wins`/`losses` (:1018–1019), decrements `lives` and accumulates
`stats.livesLost` (:1027). This event exists only in a run that has LOST a
fight — the run's first defeat becomes a place on the road.

```ts
{
  id: 'pyre_watch',
  title: 'The Pyre-Watch',
  theme: 'omen',
  requiresTally: { stat: 'livesLost', atLeast: 1 },
  body: 'A watch-fire burns at the crossroads for the road\'s dead, tended '
    + 'by a hooded keeper who does not ask whose name you are carrying. The '
    + 'fire already knows: you left a life on a field behind you, and the '
    + 'pyre-watch keeps the old custom for anyone who limps past it — alms '
    + 'for the mourner, or arms for the living.',
  choices: [
    // Condolence at the standing free-coin rate x2 (recruiter/take_coin
    // grants 2, data/events.ts:307) — cost-0 and non-nothing, so the event
    // fires at the next omen node regardless of wallet (lint L6).
    { id: 'alms', label: "Accept the mourner's alms",
      outcome: { kind: 'grantGold', amount: 2 } },
    // THE ARMOR DOOR at the 2g rate — same pool/price as thorn_garden_shrine/
    // push_through (:876–884); defensive pool = 33 cards (:857–860) >= 3.
    { id: 'arm_the_living', label: 'Buy arms for the living (2 gold)', cost: 2,
      outcome: { kind: 'cardChoice', filter: [{ archetypes: ['defensive'] }], tier: 'bronze' } },
    { id: 'let_it_burn', label: 'Let it burn, and walk on',
      outcome: { kind: 'nothing' } },
  ],
}
```

- **Implementable today because**: `stats.livesLost` (`runState.ts:119`) is
  written by the exact transition that resolves every fight (:1027). Needs
  only `EventTallyGate` + the priority draw.
- **P22 telegraph**: the gate IS the telegraph — the player just watched the
  life counter drop; the body names the loss; §4 rung 2 can render "Lives
  lost: 1." Losing a fight now visibly changes what the road offers, which is
  the cheapest "choices matter later" the game can buy.

### 3.4 `flaw_finder` — "The Flaw-Finder" (gem system; theme `market`)

**Zero new machinery — pure catalog content, shippable this afternoon.** Two
measured gaps in the gem surface, one event:

1. The EXPOSE gem ladder (4 gems: `vulnerability_sliver`/`weak_point_sliver`/
   `exposed_nerve_sliver`/`raw_nerve_sliver` — 4 × `"kind": "expose"` in
   `src/data/content/gems.v1.json`) lost its event door when `the_lapidary`'s
   `cutting_cut` was traded for `sellGem` under the 3-choice bound
   (`data/events.ts:915–926`) — shop-only ever since.
2. `sellGem` itself has exactly ONE catalog surface (census lint,
   `tests/run/events.test.ts:251`), and the project's own measurement says a
   single door is a coin flip: one merge door = 64.2% of runs, two = 83.3%
   (`data/events.ts:742–749`).

```ts
{
  id: 'flaw_finder',
  title: 'The Flaw-Finder',
  theme: 'market',   // UNGATED — the lapidary is forge; this is her market twin
  body: 'A jeweler\'s loupe glints from a stall no wider than its own '
    + 'strongbox on the Tolling Road. "Every stone has a flaw," its owner '
    + 'says, not as an apology — her whole tray is cut to FIND them, facets '
    + 'ground to open a weakness and hold it open. She buys as readily as '
    + 'she sells, if you are carrying a stone you are done with.',
  choices: [
    // THE EXPOSE DOOR — gemChoice over actionKinds:['expose']
    // (GemFilterClause.actionKinds, src/data/shopTypes.ts:37). Pool = 4 >=
    // EVENT_CHOICE_SIZE 3 (lint :221), and = the >=4 slack bar :243 sets for
    // warding_cut; at wave 1 the Legendary top rung is depth-gated out
    // leaving exactly 3 — clears the floor, same note as data/events.ts:862–866.
    { id: 'expose_tray', label: 'Buy from the flaw-cut tray (2 gold)', cost: 2,
      outcome: { kind: 'gemChoice', filter: [{ actionKinds: ['expose'] }] } },
    // THE SECOND sellGem SURFACE — priced/gated by machinery that already
    // exists end-to-end: sellPriceOfGem pricing, the empty-pouch dark-rung
    // gate at run/events.ts:352, picker + finalizer all shipped.
    { id: 'sell_flawed', label: 'Sell her a stone of your own',
      outcome: { kind: 'sellGem' } },
    { id: 'walk_on', label: 'Keep your flaws to yourself',
      outcome: { kind: 'nothing' } },
  ],
}
```

- **Implementable today because**: every kind, filter axis, gate and picker it
  touches is live (`gemChoice` resolver `events.ts:740–754`; `sellGem`
  :776–786 with its usability gate :352 reading `state.gemInventory`,
  `runState.ts:261`). At gold < 2 with an empty pouch it is simply skipped by
  `hasAffordableChoice` and stays in the bag (`events.ts:392–396`) — the
  normal affordability dance.

### 3.5 `banner_scribe` — "The Banner-Scribe" (board composition; theme `recruit`)

The direct P19 extension: a door that is the player's OWN committed type,
every time it appears. The doors pass measured label-readers at 2.91 same-type
cards vs 1.67 for label-ignorers (`data/events.ts:91–99`); a door that follows
the player's identity compounds exactly that number, and
`tests/run/eventRewardDoors.test.ts`'s supply walk is the harness that must
re-run to prove it.

```ts
{
  id: 'banner_scribe',
  title: 'The Banner-Scribe',
  theme: 'recruit',   // UNGATED
  body: 'A banner-scribe has set her table among the Muster Road\'s camps, '
    + 'reading fighters\' colors off their gear the way other scribes read '
    + 'letters. One look over your board and she is already mixing paint: '
    + 'if you march under a device, she knows a supplier for it — and if '
    + 'you march under none, she will still pay a copper for the sketch.',
  choices: [
    // THE BLAZON DOOR — cardChoice matched to the board's identity
    // (boardTypeIdentity, src/engine/combat/typeIdentity.ts:56; threshold
    // IDENTITY_THRESHOLD=3 :32; board `pieces` only, runState.ts:215 —
    // matching the combat fold's read). DARK until the board has an
    // identity: the mergeCards dark-rung idiom (run/events.ts:353–362).
    { id: 'blazon', label: 'Commission gear in your colors (2 gold)', cost: 2,
      outcome: { kind: 'cardChoice', filterFrom: 'boardIdentity', tier: 'bronze' } },
    // She pays for the sketch — the standard free-coin rung, and the choice
    // that keeps the event eligible at gold 0 with no identity (lint L4).
    { id: 'sketch_fee', label: 'Let her sketch your kit for a copper',
      outcome: { kind: 'grantGold', amount: 1 } },
    { id: 'keep_marching', label: 'March on unblazoned',
      outcome: { kind: 'nothing' } },
  ],
}
```

- **Implementable today because**: `state.pieces` (`runState.ts:215`) +
  `skillBook` + the exported, pure `boardTypeIdentity` are all reachable from
  `src/run` (the run layer already imports engine modules —
  `runState.ts:10–11`). Needs the `filterFrom` seam (shared with §3.1) and
  nothing else; the deferred outcome is plain `bonusDraft` shape, so the
  scenes and `eventOutcomeText.ts` compile untouched.
- **P22 telegraph**: the identity is the player's own three-card commitment —
  they know their color; the body says the door pays it; the dark rung on an
  uncommitted board TEACHES the threshold ("she reads no device under 3 of a
  kind" as the §4 rung-1 lock line); §4 rung 3 names the type on the label.
- **`reopenEventChoice` caveat** (stated, accepted): a Deck/Bag detour between
  resolve and pick can change the identity and thus the re-derived 3 cards —
  the same "re-derives against the run as it stands NOW" class the resolver
  already documents for `upgradeCard`/`mergeCards` (`events.ts:1264–1272`).

### 3.6 Catalog bookkeeping for the whole batch (lints that must move)

- Events: 32 → **39** (`tests/run/events.test.ts:86`).
- Bag perturbation: `tutors_return`, `the_reckoning`, `factors_ledger`,
  `pyre_watch` are GATED — never enter a bag; **zero seeded-sequence movement
  until a gate opens**. `the_lands_measure` (cache 6→7), `flaw_finder`
  (market 5→6), `banner_scribe` (recruit 5→6) are ordinary content additions
  and reshuffle those three theme bags, the same class of movement as the
  2026-07-29 +12 batch.
- Outcome census (:251): cardChoice 8 → **13** (+2 lands_measure, +1
  pyre_watch, +1 banner_scribe, +1 factors_ledger), gemChoice 10 → **12**
  (+flaw_finder, +factors_ledger), sellGem 1 → **2**, bonusDraft +3
  (reckoning ×2, tutors_return ×1), grantLevel +1, grantGold +3, nothing +6.
- Theme floor (L3): training 5, cache 7, recruit 6, forge 6, market 6, omen 5
  ungated events after the batch — every theme ≥ 2 ungated with slack.

---

## 4. Interactivity, honestly assessed — four rungs, ascending cost

Today's loop: read `body`, tap 1 of 2–3 buttons (`MobileRunEventScene` /
`DesktopRunEventScene`), with `isEventChoiceUsable` dimming and
`choiceOutcomeHint` (`src/game/ui/eventOutcomeText.ts:14`) printing the
reward's WIDTH, never its category.

**Rung 1 — lock-reason line on gated/dark rungs.** The scenes already dim via
the one predicate (`Mobile...:474–491`, `Desktop...:421–438`); today a dark
rung is silent about WHY. Add a pure
`choiceLockReason(state, choice): string | undefined` exported from
`src/run/events.ts` (beside the predicate it explains — the "one predicate
authority" rule, `events.ts:335–349`), rendered into the button's existing
`detail` string: "LOCKED · needs the tutor's lesson", "LOCKED · nothing in
your pouch", "LOCKED · no device under three of a kind". Owners:
`src/run/events.ts` (helper), `eventOutcomeText.ts` + both scenes (one line of
wiring each). Save shape: none. This rung is also P22 infrastructure for every
gate in §2–3.

**Rung 2 — "your past choice" recap line.** When a drawn event (or any of its
rungs) carries a met gate, prepend ONE line to the body text at render time —
"You paid for her lesson in the Hollow Yard." / "You have spent 14 gold on
this road." — sourced from `eventResolutions`/`stats` by a pure formatter.
Rendering it INSIDE the existing body box means `runEventStoryLayout.ts`'s
reservation math is untouched (the body box is already height-capped with a
70px mobile floor — the N=3 budget documented at `data/events.ts:239–247`
holds because no new block is added). Owners: a formatter beside
`eventThemeBlurb.ts`/`eventOutcomeText.ts`, both scenes' body composition.
Save shape: none.

**Rung 3 — dynamic door labels for state-read doors.** "Take the local make —
FROST" / "Commission gear in your colors — SWORD". Needs `src/run` to export
the derived filter (e.g. `derivedChoiceFilter(state, choice)` wrapping
`resolveFilterFrom`) so the UI NEVER re-derives it a second way (thin client +
one-authority); `eventOutcomeText.ts` gains a state-aware sibling of
`choiceOutcomeHint` (the existing one stays pure-of-spec for the catalog
lints). This closes §3.1/§3.5's honesty gap — the label can finally NAME the
type, the full P22 standard the static doors already meet. Owners:
`src/run/events.ts`, `eventOutcomeText.ts`, both scenes. Save shape: none.

**Rung 4 — two-step authored events (first tap reveals the second question).**
The expensive one, and it collides with two systems — both resolvable, neither
free:

- **Max-3 reservation math** (`data/events.ts:231–253`): step 2's options must
  REPLACE step 1's block in place — ≤ 3 buttons on canvas at any moment —
  which is exactly how the five shipped deferred pickers already behave in the
  scenes. The bound is per-visible-block, so authoring each step ≤ 3 keeps
  both platforms inside the proven budget; a step-2 with 4 options is the
  same regression the comment exists to prevent.
- **`eventResolutions` idempotency** (`runState.ts:153–170`;
  `events.ts:1220–1229`): the memo records ONE `{eventId, choiceId, pending?}`
  per node, and `reopenEventChoice` (:1275) can only re-ask the picker of THAT
  choice. A committed step-1 must survive reload, so `EventResolution` grows
  an optional stage field (absent = legacy — the established no-schema-bump
  idiom, `runState.ts:294–305`), `reopenEventChoice` learns to re-derive the
  CURRENT step, and every step-2 finalizer must still exit through
  `delivered()` (:1300). That is a real save-shape implication plus resolver +
  both-scenes work.

**Recommendation**: do not build generic two-steps. The deferred-picker
vocabulary IS the two-tap interaction (bonusDraft / upgradeCardPick /
gemChoicePick / sellGemPick / mergeCardsPick), and the sanctioned growth path
is a SIXTH picker kind — the `EventOutcome` union's own `never`-guard exists
precisely so one "cannot ship half-wired" (`events.ts:188–215`). Rungs 1–3
deliver most of the felt interactivity at a fraction of the bill.

---

## 5. What NOT to build (the constraints already killed these)

1. **The loan / the collector** ("take 5 gold now; a Collector event takes 8
   later"). Banned twice over: the payoff event may never draw (path-dependent
   map — `docs/biome-paths-proposal.md` §1.1; per-run no-repeat bags,
   `events.ts:378–402`), so the debt is free money whenever the road forgets;
   and even when it fires, `loseGold` floors at 0 (`events.ts:1145–1151`) — a
   broke debtor pays nothing, the exact trap the gambler's own redesign note
   records (`data/events.ts:373–384`). No gate mechanism fixes a shape whose
   value transfer happens BEFORE its cost; only recognition / investment /
   tally are legal.
2. **RNG reward tables.** The `gamble` kind was deliberately removed
   (`data/events.ts:10–14`) and ~10 events carry "No RNG on rewards
   (USER-LOCKED)" stamps. Any "mystery box, mostly good" pitch is this in a
   coat. "Guarantee the category, roll the instance" (the header's P22 line)
   is the only sanctioned randomness.
3. **4+ choice events** — including "just this once, the tally has four
   answers". Mobile's reservation math fails at N=4 (286px→384px squeezes the
   body budget to 34px, floor-clamped — `data/events.ts:243–247`); the bound
   is the min across platforms and is test-pinned
   (`tests/game/runEventStoryLayout.test.ts`). The Reckoning wanting a
   deface-keyed third payoff rung is exactly how this temptation arrives; it
   was cut to 3.
4. **Chains that REQUIRE the follow-up to draw** ("the tutor borrows your
   sword and returns it improved next time"). The inverse loan — the PLAYER is
   the creditor and the map may default. §1.4's priority draw maximizes
   delivery; nothing can guarantee it (the player routes around event nodes,
   or never hits the theme again). Any design whose setup takes player value
   redeemable only at a later event is unshippable.
5. **Events with combat effects** ("the shrine blesses your next fight,
   +10%"). Violates the biome layer's locked rule verbatim ("NO COMBAT EFFECT,
   EVER" — `src/run/biome.ts:26–27`), the PL-is-the-balance-unit lock
   (`docs/design-locked.md`), and the thin client (a run-state buff must fold
   into the engine resolver and ship through the battle service — a different,
   priced feature, not an event outcome).
6. **"An extra battle for gold" as an outcome.** The proposal already scoped
   it: "No outcome starts a fight. There is no machinery"
   (`docs/biome-paths-proposal.md` §1.7). It needs a node-kind/battle-service
   seam, not an outcome kind; parked where the proposal parked it.
7. **Count-scaled tally rewards** ("three tithes ⇒ a 7-wide draft").
   Outcome specs are declarative data (`EventOutcomeSpec`,
   `data/events.ts:129–213`); a reward whose SIZE is computed from state at
   resolve time needs resolver parameters, new headline text, and a fairness
   story — real work with no seam. v1 tallies gate WHICH doors are lit
   (§2.2), never how big they are.
8. **State-computed COSTS** ("the factor charges less the more you bought").
   `cost` is authored data the button prints (`data/events.ts:215–222` — the
   "cost/known-reward inline" contract), and `isEventChoiceAffordable`'s
   contract is deliberately "cost ≤ gold, nothing else"
   (`events.ts:326–333`). Dynamic rewards ride behind `filterFrom` because the
   reward is rolled at resolve anyway; a dynamic cost forks the affordability
   authority and the UI promise at once.
9. **Chains keyed to a SPECIFIC named purchase** ("the fence recognizes the
   stone you bought from her"). The run does not record purchase provenance —
   `shopShelves` (`runState.ts:70–79`) keeps remaining offers + rerollCount
   only, and owned cards/gems carry no origin field. NEEDS NEW STATE
   (a provenance ledger) — redesigned as the spend tally instead (§3.2).
10. **Gem-merge / gem-upgrade outcomes** ("feed her three Commons, take a
    Rare"). A genuinely new DESTRUCTIVE kind: the full 2026-08-26 `mergeCards`
    bill again — plan/offer/finalizer authority, dark-rung gate, picker UI,
    reach measurement (`data/events.ts:182–212`, `events.ts:788–848`). Not
    composable from the 12 kinds; if wanted, it is its own approved pass, not
    a rider on this batch.
11. **Cross-run memory** ("the tutor remembers you from your LAST run").
    `eventResolutions` is per-run; `src/meta` persistence is not built
    (CLAUDE.md layer table). Out of scope until it is.

---

## 6. Implementation order (if the whole spec is accepted)

1. `flaw_finder` — catalog-only, no new machinery; census lints move.
2. Gate mechanism (§1: `EventGate`/`EventTallyGate`, `eventGateMet`,
   `isEventChoiceUsable` line, bag exclusion + priority draw) + lints L1–L7 +
   the zero-perturbation test.
3. The four gated events (§2.1, §2.2, §3.2, §3.3) — content on the new seam.
4. `filterFrom` seam + lint L8, then §3.1 and §3.5; re-run the
   `eventRewardDoors` supply walk and record the deltas in the events header,
   as the P19 pass did.
5. Interactivity rungs 1–2 (pure UI, no save shape), then rung 3 alongside
   step 4's helper. Rung 4 stays parked.
