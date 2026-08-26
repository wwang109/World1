# Design reference — how roguelites structure a run

> **Scope:** REFERENCE (external patterns), not an owner doc. It owns no fact
> about this project. Where it describes World1, code and the doc named in
> [`INDEX.md`](INDEX.md) win. It is a lookup table you open while authoring a
> band, a boss, a title rung or an event — not an essay to read once.
> Nothing here is implemented; §7 says what to adopt and in what order.
>
> Companion: [`biome-paths-proposal.md`](biome-paths-proposal.md) (PROPOSAL) is
> the concrete plan. §6 of this doc says where the research backs that plan and
> where it points somewhere else. This doc does not edit it.
>
> **If this doc ships as anything more than research, it needs a row in
> [`INDEX.md`](INDEX.md).** That row is not added here.

---

## 0. The rule this document is written under

**Patterns only. Never content.**

Everything below is a *structural* idea, restated in this project's vocabulary
(bands, waves, titles, leans, affinity, stalls). Where a game is cited, it is
cited as *a place a pattern is visible*, never as a thing to copy.

Do not, from this doc or from playing its sources, bring in:

- a named character, creature, region or boss;
- a stat block, a numeric table, a curve, or a tuned value;
- a distinctively named mechanic or any trademarked term;
- any art, text, icon or asset.

If a recommendation here could only be implemented by reproducing something
identifiable, it has already been dropped. If one survived, drop it. Our names
come from our own fiction; our numbers come from `src/engine/balance.ts`.

**How to read an entry:** every pattern has an ID (`P1`…), the *player-experience
problem it solves*, its shape, and a verdict for World1 —
**ADOPT** / **ADOPT LATER** / **ADAPT** / **DO NOT**.

---

## 1. Region / band structure — what a branch tells you before you commit

The whole subject in one line: **a fork is only a decision if the player can
price both sides of it before choosing.**

### P1 — Whole-region-at-a-glance
**Problem it solves:** a player who can see one step ahead is not routing, they
are just walking. Planning needs a horizon longer than the next action.
**Shape:** on entering a region, the entire region's node graph is visible at
once — every node's *kind*, every connection, the exit. Route planning happens
before the first fight of the region, not after it.
**Seen in:** deck-building roguelites with an abstract act map (Slay the Spire
and its lineage; a documented convention, not one game's invention).
**World1 verdict:** **ADAPT.** The ladder is endless, so "the whole region" is
"the current band" — 5 waves. The map already lazily generates that far.
`RunRouteBoard` already walks future columns and knows each one's wave; it
knows nothing about their contents. The band, not the run, is the readable unit.
**Careful:** this is a *legibility* pattern, not a *reveal-everything* pattern.
See P3.

### P2 — Named region with a declared character
**Problem it solves:** "the next five waves" is not a thing a player can hold in
their head or plan against. A *name* with two or three promises attached is.
**Shape:** a region has a name and a short, fixed set of things it is *about* —
who lives there, what it sells, what ends it. Individual contents are still
rolled inside those promises. Because the promise is a category, one word can
carry a whole plan.
**Seen in:** side-scrolling roguelites with named biomes chosen at exits;
space roguelites where the next sector is picked from 2–3 named sector types.
**World1 verdict:** **ADOPT.** This is precisely `biome-paths-proposal.md` §2.1's
band model, and the project's type system (5 weapons, 6 elements) is an unusually
strong source of promises because every enemy, stall and card is already typed.
**Careful:** the promises must be ones the generator can actually keep — see P4.

### P3 — Disclose the kind, hide the instance
**Problem it solves:** two opposite failures. Hide everything and there is
nothing to route toward; reveal everything and there is no reason to walk the
map at all.
**Shape:** the map states each node's **category** — fight / shop / event /
harder-fight — and never its **instance**. Which enemies, which stock, which
event text stays unknown until arrival. The player routes on categories and is
surprised by particulars.
**Seen in:** essentially every act-map deckbuilder; the door-icon convention in
action roguelites (P14) is the same rule applied to rewards.
**World1 verdict:** **ADOPT — and state it as a contract.**
`biome-paths-proposal.md` already phrases it well: *predictable in kind,
surprising in detail.* That sentence is the one line from the whole feature that
belongs in [`run-structure.md`](run-structure.md) when anything ships.
**Note:** the project already half-does this — an event node previews its
*theme* before you take it. The half that is missing is that a theme predicts a
reward's flavour but not its type (proposal §1.7).

### P4 — A label that over-promises is worse than no label
**Problem it solves:** a legibility feature that lies once teaches the player to
stop reading it, and then the whole feature is dead weight.
**Shape:** whatever the region banner claims must be either *guaranteed* or
*explicitly stated as a lean*. Do not let a colour, a chip or an icon imply a
guarantee the generator can break.
**Seen in:** the widely-repeated player advice, on a space roguelite with
colour-coded sector types, that the colour code is *misleading* and should be
ignored in favour of knowing the specific sector — a label that under-delivered
until the community discarded it. That is the failure mode, documented in the
wild.
**World1 verdict:** **ADOPT, and it is the sharpest correction this research
makes to the current plan.** The proposal's binding rule is *prefer, never silo*
(§2.3) — the biome's stall is drawn *when one is still in the bag*, otherwise
today's behaviour. That is the right mechanism (P23) but it means the promise is
statistical, not absolute. So the panel must separate its tiers:
- **guaranteed** — the band's boss; the band's name and lean chip;
- **leaning** — stalls and events (say so: "mostly", "favours"); state the
  measured density if it is known, never imply certainty;
- **family, not list** — mobs. Do not print three named mobs as if promised
  when the fallback can serve something else. Print the *family* ("fire-aligned
  packs"), which the fallback still satisfies.

### P5 — Fog buys nothing on an abstract map
**Problem it solves:** the temptation to add "discovery" to a map that is not a
place.
**Shape:** progressive reveal, fog, and search costs pay off in games where the
map is a *space* the character occupies and exploring costs a real resource.
On an abstract node map, the same mechanisms only remove planning, because there
is no exploration verb to reward.
**Seen in:** the split in the literature — spatial-roguelike level-design writing
treats exploration cost as a core tuning dial, while writing about abstract
deckbuilder maps notes they are explicitly *not* exploration games.
**World1 verdict:** **DO NOT.** No fog, no progressive band reveal, no
"scout the next band" mechanic. The map is a decision surface.

### P6 — Roll before the decision, not after it
**Problem it solves:** the feeling that a good decision was overturned by a die.
**Shape:** randomness that *sets up* a choice (which three options are offered,
which stalls the band contains) is read as fair and interesting; randomness that
resolves *after* a committed choice is read as arbitrary. Both kinds are used;
the first is the one you spend liberally.
**Seen in:** the input-vs-output randomness distinction, standard in board and
video game design writing, and cited repeatedly in analyses of why act-map
deckbuilders feel fair despite being extremely random.
**Sources disagree:** one camp holds output randomness is always the weaker
tool; another holds it is fine *when the player opted into it knowingly*. Both
camps agree a roll shown before the decision beats the same roll shown after.
**World1 verdict:** **ADOPT as an authoring test.** Any new randomness added to
the run layer should be answerable to: *does the player see this before or after
they commit?* The proposal's whole design passes this — the biome is chosen from
visible candidates, and the filtering happens under a name the player already read.

---

## 2. Boss telegraphing

### P7 — Name the boss on entry to the region
**Problem it solves:** without a known final exam, every reward decision in the
region is generic. With one, every card pick is *for* something.
**Shape:** the region's boss identity is displayed from the first step inside
the region — a portrait, a name — and does not change. The player's shopping
between the reveal and the fight is the point of the reveal.
**Seen in:** the act-map convention of showing the act's boss portrait at the top
of the map from the moment the act begins; the ante convention in the card
roguelite where the round-ending challenge and its rule are shown before you play
the two ordinary rounds preceding it.
**World1 verdict:** **ADOPT FIRST.** `renderRunBossCountdownPanel`
(`src/game/ui/RunStatsPanel.ts`) already says "boss in N waves" and already has
the pure machinery to say *which* (`previewEncounter` over a future boss node).
This is the cheapest change in the entire feature and the one that tests the
premise. It is also proposal Phase 0, so research and plan agree.

### P8 — The boss slot is fixed; its occupant is drawn from a small named set
**Problem it solves:** a permanently fixed boss stops being information after
three runs. A fully random boss cannot be prepared for. The middle is a *known
short list* per slot.
**Shape:** the region's boss slot is filled per run from a handful of candidates.
Knowing which one you drew is real information *because* it could have been
another; knowing the whole candidate list is what makes preparation possible
before the reveal.
**Seen in:** the multiple-bosses-per-act convention in act-map deckbuilders.
**World1 verdict:** **ADOPT — as a data shape, now, even before the content
exists.** This is the second substantive correction to the plan.
`biome-paths-proposal.md` §2.2 declares `boss: string` — exactly one boss per
biome, forever. That reproduces today's single-boss problem one level up: after a
few runs, "the Emberwaste" and its boss are the same sentence and the countdown
panel stops carrying news. Declare `bosses: readonly string[]` (id-sorted, per
`tests/run/contentPoolOrder.test.ts`) and draw the band's boss from it with a
band-scoped Rng. Ship it with one entry per biome if that is all the roster can
staff; the field costs nothing now and is a migration later.

### P9 — A boss is a *rule*, not a bigger enemy
**Problem it solves:** the recurring failure where the "boss" is the previous
enemy with a longer health bar, so the fight is longer without being different.
**Shape:** boss identity comes from a stated constraint on how you may play —
one clear, nameable thing the fight does that ordinary fights do not — carried
by a fixed deck or moveset. The number is scenery; the rule is the fight.
**Seen in:** the card roguelite whose round-ending challenges are each a single
declared rule change announced before the round; boss-design writing generally,
where "teaches its own pattern through clear telegraphs" is the stated bar.
**World1 verdict:** **ADAPT — carefully, and not through a new mechanism.** The
project's honest version of "a stated rule" already exists and is already priced:
`MODIFIER_PRESETS` (`src/data/modifiers.ts`, resolved in
`src/run/encounter.ts`), which are PL-budgeted affixes, plus the enemy's own
authored deck and affinity. A boss should be legible as *this affinity, this
deck, this affix* — all three of which the run layer can already state ahead of
time because `rollEncounter` is pure. Do **not** invent an out-of-PL "boss rule"
dial; that is the same objection as proposal §6.5.

### P10 — The telegraph is only worth something if there is a counter to buy
**Problem it solves:** advance knowledge with nothing to do about it is
decoration. The reveal must open a purchasing decision.
**Shape:** between reveal and fight there is a shop, a draft or a reward choice,
and the revealed threat has a *readable* answer that those choices can supply.
The player converts information into preparation. This is the entire economic
purpose of P7.
**Seen in:** the shop-before-the-boss rhythm in act-map deckbuilders; the advice
literature around the card roguelite's pre-announced round rules, which is
overwhelmingly about *what to buy in the shop given the announced rule*.
**World1 verdict:** **ADOPT, and it changes what the boss panel prints.** World1
has an unusually clean counter mechanism — the element wheel and weapon triangle
— and it is already authored on all 22 enemies. So the boss panel should not stop
at name and level: it should state the boss's **affinity**, which is the same
thing as stating what beats it. That single extra chip is what turns P7 from a
nameplate into a shopping instruction, and it is what makes the proposal's
DECISION 1(a) coherent rather than a gotcha — the proposal already reaches this
conclusion for *mobs* (§2.4(d)'s "Frost hits these mobs for +50%" line); extend
the same line to the boss.

### P11 — Phase change as a second, mid-fight telegraph
**Problem it solves:** a fight whose whole shape is known at turn one has no
second act.
**Shape:** partway through, the fight restates its rule — a new behaviour, a
different threat — announced clearly enough to react to.
**World1 verdict:** **DO NOT (for now).** The engine has no phase concept, and
adding one is a core-loop change, which the resolver-seam principle in
`CLAUDE.md` exists to avoid. A boss's deck already changes character as tiers and
extra cards land, and `MODIFIER_PRESETS` can layer threat without touching
`simulate`. Revisit only if boss fights are measured to be flat, and then as a
combat-engine proposal of its own, not as a rider on run structure.

### P12 — Fixed patterns make cross-run knowledge the progression
**Problem it solves:** in a run-based game, the durable thing the player takes
between runs should be understanding, not unlocks.
**Shape:** bosses behave the same way every time, so learning them is real
progress; the game gets easier because the player got better.
**Sources disagree — and this is the live tension.** Boss-design writing argues
learnable patterns are what make a boss fair and satisfying; the same writing
notes that once mastered, a fixed pattern stops challenging experienced players.
The mitigations offered differ: draw the boss from a set (P8), layer affixes on
it (P14), or escalate elsewhere.
**World1 verdict:** **ADOPT the principle; mitigate with P8 + affixes, not with
hidden information.** The endless ladder already escalates level, title cadence
and modifiers forever (`fightSpecFor`), so the same boss identity re-met at wave
40 is a genuinely different fight without anything being concealed.

### P13 — An escape hatch that is itself a routing decision
**Problem it solves:** a telegraphed fight the current build simply cannot beat
is a dead run with five waves of walking left in it.
**Shape:** the player may decline a lesser encounter in exchange for a stated
reward, converting "I can't win this" into a priced choice rather than a loss.
**Seen in:** the skip-for-a-reward mechanic in the card roguelite.
**Important design history, and it is the useful part:** that mechanic's first
version gave a *random chance* at a reward and was, by the developer's own
account of the redesign, so unpopular that players had no reason to use it; it
was changed to a **guaranteed** reward. See P22 — this is the strongest evidence
in the whole research file for "guarantee the category".
**World1 verdict:** **DO NOT adopt the skip; DO adopt its lesson.** The fight
column's EASY rung already is the escape hatch (`capTitleAtNormal`, level −1),
and it is honest because it pays less. The lesson that transfers is P22.

---

## 3. Elite / title systems

This is the section most directly about machinery World1 already ships:
`TITLE_PRESETS` (`src/run/encounter.ts`) — `elite` = +2 levels, +2 deck rank,
+1 extra card; `boss` = +4 / +4 / +2 — applied on a cadence by `fightSpecFor`
(positions 1–2 normal, 3–4 elite, 5 boss within each `BOSS_EVERY` block).

### P14 — An affix should change the *priority order*, not the time-to-kill
**Problem it solves:** the difference between "this fight is harder" and "this
fight is longer".
**Shape:** the modifier applied to an ordinary enemy makes the player *do
something different first* — kill this one before the others, don't leave it
alone, don't rely on your usual answer. Variety comes from the changed decision,
not from the changed number.
**Seen in:** the affix system in a real-time action roguelite whose elite
variants are analysed precisely on this axis — the ones held up as good are the
ones that alter target priority or timing (something that recovers if ignored,
something that punishes standing still, something that shuts off a category of
answer), not the ones that only inflate durability.
**World1 verdict:** **ADOPT — and this is the third substantive finding, one the
current proposal does not touch at all.** As authored, the `elite` title is
*purely* a numeric rung: more levels, a higher deck tier, one more card from a
flavour-matched pool (`EXTRA_CARD_POOL`). Nothing about it changes what the
player must do — the fight is the same fight, larger. That is the exact shape
P17 warns about.
The fix does **not** need new machinery and must not touch `TITLE_PRESETS`:
- keep the **title** as the numeric rung (it is the PL-honest scaler and
  `soloThreatDeci` prices it correctly);
- require every `elite`-titled fight to also carry **at least one behavioural
  modifier** from `MODIFIER_PRESETS`, which the fight table already layers and
  which is already inside the PL economy;
- surface it on the node preview (P16).
An elite then reads as *"the ordinary thing, but it does this"* rather than
*"the ordinary thing, but more"*.

### P15 — A small affix set multiplies the whole roster
**Problem it solves:** roster variety is expensive; combinations are cheap.
**Shape:** N enemies × M affixes yields N×M encounter characters for the cost of
M. This is the highest content-leverage move available to a small roster.
**World1 verdict:** **ADOPT — already true, under-used.** 22 enemies against the
modifier list is a large space, and `docs/enemy-design.md` explicitly puts
scaling in the run layer so that the roster stays bronze-floor. That is exactly
the architecture this pattern wants. The gap is not the mechanism; it is that
the elite rung does not currently reach for it.

### P16 — The affix is visible before you commit
**Problem it solves:** an affix the player discovers on turn three is a
surprise, not a decision. Priority changes have to be routable.
**Shape:** the modifier is visible on the enemy (a tell, a colour, a chip) and,
where the encounter is chosen from a map, on the choice itself.
**World1 verdict:** **ADOPT.** `previewEncounter` is pure and already feeds the
map choice panels, so the modifier is available without any new plumbing.
Combined with P14 this makes the fight column's three options a real read.
**Both platforms, same commit** (`CLAUDE.md`).

### P17 — The stat-sponge failure, and its two tests
**Problem it solves:** naming the failure so authoring can avoid it.
**Shape:** an enemy qualifies as a sponge when it has a large health pool *and*
is not interesting to defeat — the two conditions must both hold. The standard
critique adds two questions worth using as a checklist:
1. Is there a *reason* — fictional or mechanical — this thing takes so much?
2. Is the reward proportional to the time the fight actually consumed?
**World1 verdict:** **ADOPT as an authoring checklist for the elite rung.**
Test 1 is currently answered by "the title says so", which is thin. Test 2 is
answered by `battleGoldReward`'s difficulty score — honestly, but in the *same
currency* as everything else, which is what P18 pushes on.

### P18 — An elite should pay a reward *category* nothing else pays
**Problem it solves:** if the harder option pays more of the same currency, it
is a difficulty slider with a multiplier, and routing to it is arithmetic rather
than a decision.
**Shape:** the harder encounter is the *only* source of a kind of reward, so the
player routes into it because of what they need, not because of the exchange
rate.
**Seen in:** the act-map convention where the harder optional fight is the
primary source of a whole item category, which is exactly why players take it.
**World1 verdict:** **ADAPT, and it needs a balance-designer pass before anyone
builds it.** Today EASY/MEDIUM/HARD differ on *one axis*: risk → gold (P20).
The natural World1 version — HARD guarantees a card offer of the band's lean
type — would tie the risk dial directly to the affinity supply problem the
biome feature exists to solve. **But** it moves reward value out of the gold
economy and into the card economy, and `docs/design-locked.md` makes PL the
balance unit, so this is not a run-layer decision to take alone. Flagged, not
recommended.

---

## 4. Reward routing

### P19 — Put the reward on the door
**Problem it solves:** "choose your path" without "choose your rewards" is a
coin flip with extra steps.
**Shape:** before committing to a branch, the player sees the *type* of reward
it pays — an icon or chip that says which category, never which item. Choosing a
path is choosing a resource. The specific instance stays rolled (P3).
**Seen in:** the door-icon system in an action roguelite, where every doorway
carries a symbol for the reward class behind it, and where the icons are the
primary strategic layer of the run.
**World1 verdict:** **ADOPT — this is the single most transferable pattern in
this file.** World1's map already labels an event node with its *theme* and a
shop node with its *stall*; what it does not do is say what those pay in terms
the deck cares about. Proposal §1.7 measured the gap exactly: of 21 event
choices that put a card in the deck, four carry any type filter and none is
single-type. Closing that is a **content pass over `src/data/events.ts` using
`CardFilterClause`'s existing `elements`/`weapons` fields** — no new outcome
kind, no engine change. Cheapest large win available.

### P20 — A fork must differ on two axes, or it is a slider
**Problem it solves:** three options that vary only in difficulty are one option
with a dial on it; the player picks by how brave they feel, which is not a
build decision.
**Shape:** each branch differs in *risk* **and** in *what it supplies*. That is
what makes "which do I need?" a different question from "which can I survive?".
**World1 verdict:** **ADOPT as the test for every new fork.** The band fork
passes it natively (different lean = different supply; the counter-matchup
tension supplies the risk axis). The existing fight column currently fails it
(one axis — see P18). Apply the test before adding any further fork.

### P21 — Let the player declare the archetype, then narrow the pool to it
**Problem it solves:** synergy payoffs are unreachable when the pool is wide and
undirected — the player cannot *decide* to build a thing, they can only notice
one happening.
**Shape:** the player names their intent early, and the offer pool narrows to
serve it. The narrowing is the mechanism that makes a synergy card worth
holding.
**Seen in:** the deckbuilder whose run begins by picking two card-pool factions,
which fixes what the whole run will offer.
**World1 verdict:** **ADOPT — and note it is the load-bearing argument for the
whole biome feature.** World1 has a synergy payoff (`affinity`, gated at
`IDENTITY_THRESHOLD` = 3 same-type cards, `src/engine/combat/typeIdentity.ts`)
and, per proposal §1.5, a *chosen* type is offered ≥3 times in ten waves only
27–47% of the time — and the start draft reaches 3 of a *named* type as rarely
as 3%. A payoff keyword the player cannot deliberately build toward is a payoff
keyword that happens *to* them. The band lean is the declaration mechanism.
**Adaptation:** the cited pattern narrows at run start; the proposal narrows per
band and refuses a fork before band 0 (§6.7). That is the right call for a
different reason than the proposal gives — a declaration is only meaningful when
the player has enough board to know what they are declaring.

### P22 — Guarantee the category, roll the instance
**Problem it solves:** a reward the player cannot evaluate in advance is a
reward they will not route for, so the routing feature does nothing.
**Shape:** what you steered toward is *certain*; which particular one you get is
not. The certainty is what makes it worth a detour.
**Seen in:** the design history in P13 — a skip reward changed from *chance of*
to *guaranteed* precisely because the chance version gave players no reason to
engage. That is a documented before/after on this exact question.
**World1 verdict:** **ADOPT, and reconcile it with the prefer-not-silo rule.**
The proposal's mechanism (§2.3) is a preference with fallback, which yields a
*high probability*, not a guarantee — the right engineering trade (P23), but it
means the *promise wording* has to carry the difference (P4). Where a guarantee
is cheap, take it: the **band's boss** is deterministic and should be stated as
certain; a **lean-typed event reward** (P19) can be authored as a hard filter and
therefore guaranteed; the **stall bag** stays a lean and should be worded as one.

### P23 — Steer the supply; never remove the constraint
**Problem it solves:** routing that hands the player exactly what they asked for
deletes the tension the routing existed to create.
**Shape:** the branch changes *what is offered*, not what is affordable, not how
many stops there are, and not whether other things remain reachable. The cost of
routing toward one reward is the reward you did not route toward.
**World1 verdict:** **ADOPT — and it is already the proposal's §6.2 and §2.3.**
Independent support: a hard silo also breaks
`tests/run/contentReachability.test.ts` and `affinityReachability.test.ts`,
thins an anchor pool that is already down to 5 enemies at deep fights
(proposal §1.6), and makes a wrong fork unrecoverable. Preference-with-fallback
is both the safer engineering and the better design.

---

## 5. Mid-event combat — an event that leads to an optional fight

Thinnest evidence base in this file. The pattern is well attested as *behaviour*
in act-map deckbuilders (events that end in a forced or optional fight, and an
event that stages repeated fights for escalating reward) but poorly attested as
*documented design rationale*. Treat §5 as lower-confidence than §§1–4.

### P24 — The optional fight is a priced gamble, stated before acceptance
**Problem it solves:** an optional fight whose stake or payout is unclear is
either always taken (free reward) or never taken (unevaluable risk). Neither is
a decision.
**Shape:** the event states, before you accept: what you are fighting (in kind),
what it costs if you lose, what it pays if you win. The walk-away option stays.
**World1 verdict:** **ADOPT the disclosure rule.** It is also what
`tests/run/events.test.ts` already half-enforces by requiring a cost-0 safe exit
per event — the proposal correctly notes a battle choice is not a safe exit
(§3.3). Combined with P22: the payout must be *stated and certain*, or the choice
degrades into the pattern P13's design history shows players ignore.

### P25 — A side fight must not pay the ladder's own currency
**Problem it solves:** an optional encounter that grants the resource the
difficulty curve is measured in silently rewrites the curve.
**Shape:** side content pays in *convertible* resources (money, a reward
choice), never in the progression axis the encounter table is priced against.
**World1 verdict:** **ADOPT — independent confirmation of proposal §3.3/§6.4.**
World1's spine is `heroLevel == fightNumber` lockstep, asserted by name in
`tests/run/runState.test.ts` and consumed by `fightSpecFor`. Gold is safe; a
hero level is not; `wins`/`losses`/`bossesCleared` are the ladder's score and
should stay untouched. The research agrees with the proposal's recommendation
without qualification, which is worth recording because it was the one place the
user's original phrasing ("gold **or levels**") and the plan diverge.

### P26 — Commit → fight → resolve is a three-stage event, and the middle stage is the cost
**Problem it solves:** where the "cost" of an event choice comes from when you
don't want to charge gold or HP.
**Shape:** the fight *is* the price — it consumes the run's real scarce
resources (position on the ladder, risk of a life) rather than a listed number.
**World1 verdict:** **ADOPT the framing; it clarifies DECISION 3.** The proposal
offers (a) one life, (b) nothing, (c) an upfront gold stake, and recommends (a).
The research points slightly differently: under P24+P22 a *life* is a very
expensive, very hard-to-price stake to weigh against a gold number, and the one
documented data point in this area (P13) is about players declining rewards they
cannot evaluate. **Suggested reading of the evidence:** (c) — the already-supported
`EventChoiceDef.cost` — as the default, with (a) reserved for a battle choice
whose payout is a *category* reward (a lean-typed card offer, P19/P22) rather
than a gold figure, because a card that finishes an affinity board is something
a player can price against a life. This is a suggestion the research supports,
not one it proves; DECISION 3 remains the user's.

---

## 6. Against `biome-paths-proposal.md` — agreements and divergences

Read this section beside that document; it does not restate it.

### 6.1 Where the research supports the proposal

| Proposal | Backed by | Note |
|---|---|---|
| Band = one boss block as the unit of choice (§2.1) | P1, P2 | The band is this project's "region". The endless ladder has no acts, so the boss block is the only natural region boundary. |
| *Predictable in kind, surprising in detail* (§2.4) | P3 | Strongest single sentence in the proposal. It is the genre's actual contract. |
| Phase 0 = name the boss first (§5) | P7, P10 | Research agrees this should be first, and for the reason the proposal gives: it tests whether forward information changes play, cheaply. |
| Prefer, never silo (§2.3, §6.2) | P23 | Independently the better *design*, not just the safer code. |
| No ambient biome combat rule (§6.5) | P9 | A region's danger should come from its roster and its priced affixes, not a world multiplier. |
| No mystery biome (§6.9) | P3, P4 | Hiding the *instance* is the genre norm; hiding the *category* deletes the feature. |
| No hero level from an event battle (§3.3, §6.4) | P25 | Confirmed without qualification. |
| No fork before band 0 (§6.7) | P21 | Correct, and for a second reason: a declaration is meaningless before the player has a board to declare about. |
| Fork capped at 3 options | P20 | Three differing on two axes is ample; more options is not more decision. |
| Exploiting the type system as the biome's identity (§2.0) | P21 | The type system is a ready-made archetype-declaration mechanism. This is the feature's best argument. |

### 6.2 Where the research points somewhere else

**(a) One boss per biome is too few — change the field now.** (P8, P12)
`BiomeDef.boss: string` (§2.2) fixes the biome-to-boss mapping permanently.
After a few runs the boss line stops being news, which is the same failure the
proposal itself diagnoses at §1.6 for `wolf_king`, relocated one level up.
Declare `bosses: readonly string[]` (id-sorted) and draw per band from a
band-scoped Rng. Ship with one entry each if content allows nothing more. The
cost today is a field; the cost later is a migration plus a doc.

**(b) The boss panel should print the boss's affinity, not just its name.** (P10)
A telegraph with no purchasable counter is decoration. World1's counter is the
element wheel / weapon triangle and it is already authored on all 22 enemies, so
this is one chip on a panel that is already being changed in Phase 0. It also
resolves the proposal's own worry that DECISION 1(a) "reads as a gotcha" —
§2.4(d) already prints the matchup line for mobs; the boss deserves the same line
and needs it more, because the boss is the thing you shopped for.

**(c) The fork panel must separate guaranteed from leaning.** (P4, P22)
§2.4(d)'s mock-up lists three named mobs and three named stalls under a biome
name. Under prefer-not-silo none of those six is guaranteed. A player who takes
the branch for a listed stall and never sees it has been told a small lie, and
after two of those they stop reading the panel. Print the boss as certain, the
lean as certain, the stalls as a lean in lean wording, and mobs as a *family*
rather than a roster.

**(d) The title system is a stat rung with no behaviour, and the proposal does
not address it.** (P14, P15, P17)
Out of scope for a biome document, so this is not a criticism of it — but it is
the finding with the best effort-to-payoff ratio in this whole research task, and
it is **independent of biomes entirely**. `TITLE_PRESETS.elite` adds levels, deck
tier and a card; nothing changes what the player must *do*. Require a
behavioural `MODIFIER_PRESETS` affix on every elite-titled fight and surface it
in the preview. All the machinery exists; it is in the PL economy already; it
does not touch `src/engine`; and it makes the fight column's middle rung mean
something on its own.

**(e) The fight column is a one-axis fork.** (P20, P18)
EASY/MEDIUM/HARD vary risk and gold and nothing else. The research's answer is a
differing reward *category* — most naturally a lean-typed card offer on HARD,
which would tie the risk dial to the affinity supply problem. **Flagged only.**
It moves value between the gold and card economies and `docs/design-locked.md`
makes PL the balance unit, so it needs balance-designer ownership before anyone
writes it down as a plan.

**(f) DECISION 3 leans differently under the evidence.** (P24, P22, P26)
See §5/P26. Not a contradiction — the proposal's (a) is defensible — but the one
documented data point on rewards-you-cannot-evaluate points at pairing a life
stake with a *category* payout, or defaulting to the gold stake that
`EventChoiceDef.cost` already supports.

**(g) Event reward type-filters are the cheapest win and should probably be
first, not folded into Phase 1.** (P19)
The proposal treats type-filtered event rewards as content work inside the biome
binding (§2.3, "Events"). But `CardFilterClause` already has `elements`/`weapons`,
32 events and 74 choices already exist, and the measured gap is stark — 4 of 21
deck-touching choices carry any filter, none single-type. A pure content pass
over `src/data/events.ts` needs **no biome, no new system, no `RunState`
change**, and it makes the event layer able to feed an identity at all. It is a
prerequisite for the biome event binding being worth anything, so doing it first
de-risks Phase 1 rather than competing with it.

---

## 7. Adoption order for World1

Ordered by (value delivered) ÷ (machinery disturbed). Each step stands alone and
is shippable green.

1. **Name the boss, and its affinity.** (P7, P10) — extend
   `renderRunBossCountdownPanel` via `previewEncounter`. Both platforms.
   *Tests the premise of the entire feature for an afternoon of UI work.*
   Matches proposal Phase 0, plus the affinity chip.
2. **Make the elite rung behavioural.** (P14, P16, P17) — require a
   `MODIFIER_PRESETS` affix on elite-titled fights; show it in the node preview.
   *Independent of biomes. Uses only machinery that already exists and is already
   priced.*
3. **Type-filter the event rewards.** (P19, P22) — content pass over
   `src/data/events.ts` using the existing `CardFilterClause`.
   *No system change at all. Makes the largest existing surface able to feed a
   deck identity.*
4. **Named bands with a declared lean, dealt not chosen.** (P2, P21, P23) —
   proposal Phase 1, with `bosses: readonly string[]` (§6.2a) in the data shape
   from day one and the panel wording of §6.2c.
5. **Mobs and the boss bound to the band.** (P8) — proposal Phase 2. Gated on
   boss content; the boss *set* per biome may legitimately start at one entry.
6. **The fork.** (P19, P20, P21) — proposal Phase 3. Honest guaranteed/leaning
   panel; two axes; capped at 3.
7. **The optional event battle.** (P24, P25, P26) — proposal Phase 4, last, and
   with DECISION 3 settled first.

**Do not** reorder 1 and 2 behind 4. Both are cheap, both are independent of the
biome system, and both make the existing run better whether or not biomes ship.

---

## 8. Patterns this project should NOT adopt

| Pattern | Why not, here |
|---|---|
| Fog / progressive map reveal / "scout the next band" (P5) | The map is an abstract decision surface, not a place. Fog removes planning and returns nothing, because there is no exploration verb to reward. |
| Mid-fight boss phase changes (P11) | No phase concept in the engine; adding one is a core-loop change, which the resolver seam exists to prevent. Revisit as a combat-engine proposal if boss fights measure flat. |
| Ambient region combat rules ("+X% Fire damage in this band") | Outside the PL economy, which `docs/design-locked.md` makes the balance unit, and it would drag the frozen combat baseline into a run-layer feature. Use `MODIFIER_PRESETS` instead. Agrees with proposal §6.5. |
| Region-exclusive content (a stall or enemy only reachable in one biome) (P23) | Breaks `contentReachability` / `affinityReachability`, thins already-thin deep anchor pools, and makes a wrong fork unrecoverable. |
| More HP / higher tier as the *only* elite dial (P17) | Longer, not harder. Already partly the current state; see §6.2d. |
| A skip-the-fight-for-a-reward mechanic (P13) | The EASY rung already fills this role honestly. Keep the design *lesson* (guarantee the category), discard the mechanic. |
| Any named region, boss, affix or event lifted from a source game | §0. Names come from our own fiction; numbers from `src/engine/balance.ts`. |

---

## 9. Open questions the research could not settle

1. **No developer rationale was recoverable for the whole-map / boss-portrait
   convention.** The *behaviour* is thoroughly documented across wikis and guides;
   the *reasoning* is not, in anything reachable. The primary sources most likely
   to contain it — a GDC design/balance talk deck, a genre developer postmortem
   article, and an academic paper measuring map uncertainty — were all blocked by
   this environment's network egress (see §10). Someone with unrestricted access
   should read them before this doc is treated as settled.
2. **Does naming the boss five waves ahead change play in an *endless* ladder?**
   Every source is about a run with a finish line, where the act boss is the exam
   the act was studying for. An endless ladder has a boss every five waves
   forever; forward information may matter less, or may matter more because it is
   the only structure the run has. **Step 1 of §7 is the experiment that answers
   this.** Instrument it.
3. **How many named bands before they blur?** The proposal says 5–6 and not 11.
   Nothing found supports or refutes any particular count. It is a playtest
   question.
4. **Does "supplies its own type, is countered by its counter" read as tension or
   as a trap?** (DECISION 1.) No source addresses a region that sells the type its
   own inhabitants are weak to. Uniquely World1's problem, because of the wheel.
   Untestable without play.
5. **How much does a boss need to differ between meetings before it stops being
   the same fight?** P12's sources disagree on whether a mastered fixed pattern is
   a feature or a decay, and the endless ladder meets each boss repeatedly at
   rising levels. Unresolved.
6. **Optional-combat events are thinly documented.** §5 rests on observed genre
   behaviour rather than stated design intent. If DECISION 3 becomes contentious,
   the honest answer is a prototype, not more reading.
7. **Whether a differing reward *category* per fight-column rung (P18/§6.2e) is
   affordable in the PL economy.** Out of scope for run-layer research; needs
   balance-designer ownership.

---

## 10. Sources

Cited as places a **pattern** is observable. Nothing was copied from any of them.
Where a source is a wiki or guide, it documents *structure*; where it is analysis
or developer material, it documents *reasoning*. Retrieved 2026-08-26.

**Map legibility and information**
- Slay the Spire 2 map navigation and pathing guide — <https://slaythespire-2.com/guides/map-navigation-guide>
- Map generation and branching, Slay the Spire guide — <https://www.ludo.guide/guide/slay-the-spire/pathing-risk-assessment/map-generation-and-branching>
- Map generation in Slay the Spire (community technical guide) — <https://steamcommunity.com/sharedfiles/filedetails/?id=2830078257>
- "Slay the Spire and Into the Breach's greatest trick is that they hide nothing from you", PCGamesN — <https://www.pcgamesn.com/slay-the-spire/slay-the-spire-vs-into-the-breach>
- "Perfect Information: The Killer Feature of Slay the Spire and Into the Breach" — <https://jeremiahgames.com/2019/03/04/perfect-information-the-killer-feature-of-slay-the-spire-and-into-the-breach/>
- "Analysis of Uncertainty in Procedural Maps in Slay the Spire" (arXiv 2504.03918) — <https://arxiv.org/abs/2504.03918> *(blocked in this environment; not read)*
- Roguelike level design / procedural layouts, Grid Sage Games — <https://www.gridsagegames.com/blog/2019/03/roguelike-level-design-addendum-procedural-layouts/>

**Randomness and fairness**
- "Randomness and Game Design", Game Developer — <https://www.gamedeveloper.com/design/randomness-and-game-design> *(blocked; summary via search)*
- "Game Design Discourse: Randomness", Goonhammer — <https://www.goonhammer.com/game-design-discourse-randomness/>
- "Slay the Spire and Randomness Tolerance", The Thoughtful Gamer — <https://thethoughtfulgamer.com/2021/01/28/slay-the-spire-and-randomness-tolerance/>

**Bosses and telegraphing**
- Bosses, Slay the Spire wiki — <https://slaythespire.wiki.gg/wiki/Bosses>
- Bosses, Slay the Spire 2 wiki — <https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Bosses>
- Blinds and Antes, Balatro wiki — <https://balatrowiki.org/w/Blinds_and_Antes>
- Skip, Balatro wiki (design history of the skip reward) — <https://balatrowiki.org/w/Skip>
- "Into the Breach Design Postmortem", GDC Vault — <https://gdcvault.com/play/1026333/-Into-the-Breach-Design> *(blocked; summary via search)*
- "How to Design a Boss That Teaches Its Own Pattern" — <https://bugnet.io/blog/how-to-design-a-boss-that-teaches-its-own-pattern>
- "How Boss Design Has Evolved", Josh Bycer / SUPERJUMP — <https://medium.com/super-jump/how-boss-design-has-evolved-50929f22af89>

**Elites and affixes**
- Elites, Slay the Spire wiki — <https://slaythespire.wiki.gg/wiki/Elites>
- Shared Design (elite affixes), Risk of Rain 2 wiki — <https://riskofrain2.wiki.gg/wiki/Shared_Design>
- "The Elites of Risk of Rain 2: Efficient Design and the Fundamentals of Real Time Combat" — <https://parryeverything.com/2021/08/13/the-elites-of-risk-of-rain-2-efficient-design-and-the-fundamentals-of-real-time-combat/> *(blocked; summary via search)*
- "What Is a Damage Sponge in Gaming?", MakeUseOf — <https://www.makeuseof.com/what-is-damage-sponge-gaming/>
- "There Are Too Many Bullet Sponges In Action Games", Den of Geek — <https://www.denofgeek.com/games/bullet-sponges-v/>

**Reward routing and archetype commitment**
- Hades door symbol guides (reward-class icons on doors) — <https://www.gamespew.com/2021/08/hades-door-guide-what-does-each-door-symbol-mean-in-hades/> · <https://gamerant.com/hades-door-symbol-guide/>
- Tags, Balatro wiki (guaranteed skip rewards) — <https://balatrowiki.org/w/Tags>
- Rings, Monster Train wiki (region → boss → spoils structure) — <https://monster-train.fandom.com/wiki/Rings>
- Monster Train beginner's guide (two-faction pool commitment) — <https://www.bluestacks.com/blog/game-guides/monster-train/mstn-beginners-guide-en.html>
- Biomes, Dead Cells wiki (named biomes, level tiers, one-per-tier routing) — <https://deadcells.wiki.gg/wiki/Biomes>
- Sectors, FTL wiki (named sector types; the misleading colour code) — <https://ftl.fandom.com/wiki/Sectors>
- "Tackling deckbuilding and roguelite design in Abrakam's Roguebook", Game Developer — <https://www.gamedeveloper.com/design/tackling-deckbuilding-design-in-abrakam-s-roguebook> *(blocked; summary via search)*

**Note on access:** seven of the above — including all three primary
developer/academic sources — returned `EGRESS_BLOCKED` from this environment and
are cited from search-result summaries only. They are marked. Anything resting
solely on a blocked source is flagged as unsettled in §9.
