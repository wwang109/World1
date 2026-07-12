# Build Themes — card combination guide

Every card sits on the same PL budget for its tier, so raw stats never make a
build. Power comes from four levers the budget can't see:

1. **Board order** — left→right IS your rotation, so it's your combo script.
2. **Adjacency** — aura passives only touch neighbors; placement is a puzzle.
3. **Initiative math** — light cards bank tempo, heavy cards spend it.
4. **Matchups & marks** — element/weapon advantage and targeting enchants are
   free multipliers the enemy picked for you.

Seven themes the current 35-card set already supports. Layouts use the
10-slot hero board; `·` = empty slot.

---

## ⚔ 1. Blade Dancer — combo tempo (sword)

**Identity:** chain Offense casts so Follow-Through always combos, quickened
so the chain outpaces the enemy.

**Board:** `[War Banner][Windstep Jab][Flurry of Knives][Follow-Through][Lucky Charm][Sword Slash] · · · ·`

- Windstep Jab casts, quickens the NEXT card by 12 → Flurry (w8) comes out
  at effective w1–2, banking almost nothing for the enemy.
- Follow-Through lands third: the previous cast was Offense → +75%,
  amplified by momentum (+25%/chain link) since the rotation never repeats.
- War Banner touches Jab (+25% damage); Lucky Charm gives Follow-Through and
  Sword Slash +20% crit — each hit of a crit-heavy Flurry rolls separately.

**Tier priority:** Follow-Through first (its damage knob scales the combo
payoff), then Flurry. **Enchant:** none — this build wants single-target
focus. **Weak to:** armor stacks (Flurry's per-hit mitigation) and Stone
Beetle-style walls; bring Armor Break.

## ☠ 2. Venom Attrition — DoTs through shields

**Identity:** poison bypasses shields entirely; stack clocks and outlast.

**Board:** `[Venom Fang][Fireball··][Slowing Hex][Hex of Frailty][Soothing Spores][Second Wind] · ·`

- Venom Fang (w12, light) + Fireball's burn = two clocks by turn 3; Slowing
  Hex keeps the enemy's Speed down so your rotation laps theirs.
- Hex of Frailty (−35% Magic Resist) makes Fireball hit ~harder than any
  same-budget nuke; Spores' regen out-drips their damage.

**Tier priority:** Fireball (magnitude branch), Hex of Frailty. **Enchant:**
Assassin's Mark on Venom Fang in party fights — poison the healer hiding in
back. **Weak to:** Purify/cleanse enemies and burst that ends the fight
before the clocks pay.

## 🛡 3. Bramble Turtle — thorns fortress

**Identity:** make hitting you the enemy's mistake; sudden death favors you
(+10%/turn vs their +30% never matters if they're dead to payback).

**Board:** `[Bramble Coat][Iron Bulwark·][Mana Ward][Prism Barrier··][Second Wind][Purify] ·`

- Typed shields absorb; thorns pays 25% of every skill hit back as TRUE
  damage that ignores their armor.
- Purify strips stuns/poisons but KEEPS your thorns and regen (positive
  statuses survive cleanse).

**Tier priority:** Bramble Coat (thorns knob), Prism Barrier. **Enchant:**
none needed. **Weak to:** Shield Splitter-style shieldBreak, poison (bypasses
the pools), and Concussive Shot draining the bank you build while turtling.

## ⏱ 4. Tempo Thief — initiative denial

**Identity:** win the comparison every turn; the enemy simply acts less.

**Board:** `[Time Crystal][Arcane Bolt][Hamstring][Concussive Shot][Windstep Jab][Sword Slash] · · ·`

- Time Crystal makes Arcane Bolt (already w8) a w3 machine-gun.
- Hamstring (+16 weight to their next) and Concussive Shot (drain 32 bank)
  attack the two halves of THEIR initiative score; Windstep Jab boosts yours.
- Slows don't stack — alternate Hamstring with damage instead of spamming.

**Tier priority:** Arcane Bolt, Concussive Shot. **Enchant:** Executioner's
Mark on Arcane Bolt — the fast card cleans up wounded stragglers. **Weak
to:** size-3 spans (a busy caster can't be slowed) and Stone Beetle (bolt vs
armor... use the magic side).

**The one rule of tempo theft:** a victim can be staggered at most ONCE
between its own actions (extra staggers fizzle as "resisted"). Full
initiative lock-out is impossible by design — the same principle that keeps
stun a delay, not a lock. MIX your verbs instead: stagger once per enemy
action cycle, and cover the rest with Slow Next (Hamstring), Speed debuffs
(Slowing Hex) and Weaken. Two-stagger boards waste half their riders.

**Dodge (Sidestep) — the timing sidegrade:** each DODGE charge makes one
whole single-target PHYSICAL card against you miss — its damage, every
multi-hit AND its riders (a dodged Concussive Shot steals no tempo; the
caster's own self effects still resolve). Unspent charges vanish when you
next act, so the card is only worth its weight if you're FIRST (weight 8,
plus a Quicken 5 rider: dodging feeds +5 into your next speed check).
Priced at stun parity (4 PL per charge, 2 charges). Magic, AoE (Storm
Mark) and DoTs go straight through, purge strips it, and a pure dodge
wall has no clock — sudden death eats it. Prime use: bosses and elites
that swing big single-target physical hits (the Wolf King's entire kit).

**Guard (Brace / Parry) — the physical damage stance:** guard reduces
incoming PHYSICAL strike damage multiplicatively (after armor), and
stacking stances cap at 75%. Brace is the steady version (−25% for 2
turns); Parry is the timing version (−50% for 1 turn — raise it BEFORE
the blow). Magic, true damage and DoT ticks ignore guard, purge strips
it, and like every pure wall it has no clock. Dodge says "that card
missed"; guard says "everything physical hits softer" — the wall vs the
sidestep.

**Speed-conditional effects (onlyIf faster/slower):** any effect can be
gated on the speed check — it resolves only if your effective Speed is
strictly higher ('faster') or lower ('slower') than the target's at cast
time, and it reads EFFECTIVE speed, so Slowing Hex flips the check on.
Priced at a 20% discount (build-selected conditions stay conservative).
Shipped pair: Swift Strike (120% + 100% more while faster — the fast
build's payoff) and Underdog Crush (80% + 150% more while slower — the
heavy build's answer to fast elites).

## ⚰ 5. Executioner Burst — kill-window snowball

**Identity:** get the enemy under 50%, then everything hits like a truck.

**Board:** `[War Banner][Crushing Blow··][Executioner's Chop][Soul Rend··][Stunning Smash··] ·`

- Crushing Blow opens (400%), Chop follows: past half HP it's 120%+60%.
- Soul Rend's TRUE damage ignores the armor that walls the others; Stunning
  Smash eats the enemy's comeback performance.
- All-heavy board = you bank huge Speed during spans — the smash arrives
  loaded.

**Tier priority:** Executioner's Chop (its execute window pays double per
tier), Soul Rend. **Enchant:** Executioner's Mark in parties — always swing
at the almost-dead one. **Weak to:** burst-heal (Mending Light undoes the
window), being out-tempoed early.

## 🌀 6. Storm Sweeper — AoE vs parties

**Identity:** 1v3+ fights make 60%-to-everyone strictly better than
100%-to-one (180% total value at 3 targets).

**Board:** `[War Banner][Fireball🌀··][Flurry of Knives🌀][Time Crystal][Mending Light··] · ·`

- Storm Mark on Fireball: every enemy takes the hit; the burn rider still
  lands single-target (on the default aggro pick).
- Storm-marked Flurry: 3 hits × every living foe — a shredder against
  swarms of Giant Rats, garbage in 1v1 (60% penalty). Swap marks per fight
  on the Cards page; they're per-piece, not per-card.

**Tier priority:** Fireball, War Banner. **Weak to:** any 1v1 (unmark
first!), high-armor groups (per-target mitigation applies to every 60% hit).

## 🎯 7. Backline Assassin — party sniper

**Identity:** in party fights the dangerous enemy hides behind the tank;
ignore the wall, delete the threat.

**Board:** `[Hunter's Shot🎯][Venom Fang🎯][Lucky Charm][Concussive Shot][Iron Bulwark·] · · ·`

- Assassin's Mark sends Hunter's Shot and the poison past the high-aggro
  front-liner to whoever is hiding (lowest aggro).
- Bow beats Beast: this doubles as the monster-party build.
- Once taunt/lure cards exist (see party-battles plan), this theme fights
  the aggro war directly.

**Weak to:** 1v1 (marks do nothing), uniform parties with no priority target.

## 💚 8. Thorn Warden — healing tank (sim-validated)

**Identity:** a magic-power sustain core (shields, heals, regen, thorns all
scale MP or care only about surviving) wrapped around a poison clock. The
skip-aware rotation is the engine of the build: heals are SKIPPED at full
HP, so the rotation auto-plays — coat and fangs while healthy, healing
exactly when hurt — and Bramble Coat's re-casts keep thorns at near-100%
uptime.

**Board:** `[Bramble Coat][Time Crystal][Soothing Spores][Mending Light··][Venom Fang][Purify][Leeching Fang] · ·`

- Time Crystal touches Coat AND Spores (both magical → −5 weight each).
- Venom Fang is the clock: poison bypasses shields and ticks every global
  turn — the longer the fight (and this build makes fights long), the more
  total damage each application buys. Re-casts stack fresh instances.
- Leeching Fang turns your filler attack into another heal.
- Purify clears stuns/poisons but KEEPS your thorns and regen.

**Sim results** (combat is deterministic — metered crits, one outcome per
matchup; run these yourself with `npm run battle -- --hero ... --enemy all`):

| Version | Rat | Beetle | Imp | Bandit (elite) | Wolf King (boss) |
|---|---|---|---|---|---|
| Pure sustain, no offense | L | W | L | L | L |
| + venom/leech clock (Common) | W | W | W | L | L |
| Rare core (coat/spores/mending/fangs) | W (42 hp) | W (150 hp) | W (98 hp) | **L** | W (0 hp — tie, player wins) |

The first row is the design lesson: **sudden death exists to kill turtles**
— with zero offense the enemy's +30%/turn ramp always outgrows heal
throughput, and thorns alone (25% of incoming) can't race it. A heal-tank
NEEDS a clock; poison is the right one because it loves exactly the long
fights this build creates. The Wolf King win is a literal simultaneous
wipe decided by the player-wins-ties rule — zero margin — while the
size-grant rebalance (big cards +5 PL/extra slot) buffed the elite
Bandit's Crippling Strike into a wall this build can't yet out-sustain:
its next tier-up or a weapon-matchup swap is the answer.

**Tier priority:** Venom Fang first (the clock decides elite/boss fights),
then Bramble Coat. Note the generated Coat tiers grow the SHIELD knob —
a hand-authored "identity branch" that grows the thorns % instead is the
kind of upgrade the card-tier plan reserves for authored paths.

**Enchant:** Assassin's Mark on Venom Fang in party fights — the tank holds
the front while the poison finds the healer. **Party role:** this is the
build's true home once taunt cards land — a taunting Thorn Warden holds
aggro (thorns punishing every hit) while allies bring the damage, and the
pure-sustain version becomes viable because the CLOCK is your teammates.

**Weak to:** purge (strips thorns AND regen in one cast), burst windows
that outpace Mending Light's size-2 span, and anything that shortens the
fight.

### Thorns stacking — measured, and a design fork

Thorns instances DO stack (the reflect sums every active instance), but
each expires after its `turns`, so under current rules the stack plateaus.
Sim: triple-Bramble-Coat spam board vs never-expiring thorns (same card,
999-turn duration), base Common stats:

| Rules | Peak stacks | Rat | Beetle | Imp | Bandit | Wolf King |
|---|---|---|---|---|---|---|
| Current (3-turn instances) | 2–3 (50–75%) | L | W | W | L | L |
| Never-expiring (purge = only counter) | 4–13 (100–325%) | W | W | W | W | W |

Permanent stacking is spectacular — past ~4 stacks (100%) the enemy kills
itself, and sudden death's +30%/turn enemy ramp flips into the TURTLE'S
win condition (bigger hits = bigger reflects). That inversion is elegant,
but as a spammable Common mechanic it's degenerate: a clean sweep of every
preset including elite and boss with zero offense, zero tier investment,
and no enemy in the roster carries purge to answer it.

Recommendation: keep baseline thorns timed, and ship permanence as SCARCE:
- a Legendary/legendary authored card ("Living Armor" — thorns you apply
  never expire), priced far above the pct×turns table entry, and/or
- a total-reflect cap (~100%) if stacking cards multiply, and
- purge in elite/boss enemy kits BEFORE any permanent thorns ships — the
  counterplay must exist in the world first.

---

## Resolve — the effect-resistance check

Every combatant has a **Resolve** stat (default 0). When a hostile lingering
effect lands, it passes the resolve check: `effectiveness = 100 − target's
Resolve` percent (clamped 0–150). Poison/burn ticks, debuff strengths, slow
weights and stagger drains all scale by it; stun DURATIONS round down with
it, so 1-turn stuns are fully shrugged off past ~50 Resolve. Fully-resisted
effects show a "RESISTED" line in the log.

- **Iron Will** (+40 Resolve, 2 turns) is the defensive tech card — slot it
  into any build that folds to Venom/hex enemies.
- **Expose Weakness** (−25 enemy Resolve, 3 turns) is the potency lever:
  pushing Resolve below 0 makes YOUR effects land up to 150% — the natural
  opener for Venom Attrition and Tempo Thief.
- Enemy presets: Stone Beetle carries 25 Resolve, the Wolf King 15 — DoT
  and control builds now feel the check in the wild.

## Multi-play chains — Speed converts into extra casts

The initiative rule grew one clause (shipped, sim-validated): the
performer's winning score, minus each card's weight, is a **budget** —
while that budget still strictly beats every other ready contender, the
performer keeps the stage and casts again. There is NO hard cap; the whole
cost rule fits in one breath: **an extra play costs DOUBLE the card's
weight — and doubles again each time (2×, 4×, 8×…)**. A weight-8 card's
second play costs 16 initiative, its third 32. That's the number to build
against, and it's why the Prep screen shows your board's average weight
next to its total PL. (Data rule backing it: no card may weigh less than
5, so the doubling always bites.)

What this rewards and what keeps it honest:

- **Chains are a speed-BUILD payoff, not a freebie.** At normal speeds
  (10–14) the first extra play (~20 initiative for a light card) is
  already out of reach — ordinary fights keep their classic rhythm. Speed
  30 with weight-8 cards double-casts; every deeper link doubles the ask,
  so triple-plays demand pure Speed stacking (buffs, light boards, Time
  Crystal, Quicken).
- **Tempo comes in two durations.** Sidestep's Quicken is the burst
  (+5, next action only, size 1); **Haste** is the commitment (+40%
  Speed for 3 turns, size 2 — two board slots and a 2-turn span for a
  buff that wins comparisons all fight). Sim-verified: a Haste board at
  base speed 12 produces real double-play turns mid-fight.
- **The weight floor bounds everything.** Cards weigh at least 5, so the
  doubling cost always grows — no build can loop the stage forever.
- **Heavy never chains.** A weight-20+ card eats the whole budget (and
  size-2/3 spans end the stage outright), so big-hit boards keep their
  once-a-cycle rhythm.
- **Equal builds never chain.** The budget must STRICTLY beat the
  runner-up; parity hands the stage over, preserving the classic 2:1
  rhythm at double Speed.
- **No free chains.** With no ready opponent (busy or passive), there is
  no runner-up to outscore and no chain — you already act every turn.
- **Effective Speed floors at 5.** No amount of slow-stacking parks a
  combatant at zero initiative gain — the slowest enemy still banks 5 a
  turn and eventually plays its card. Slows cripple tempo; they never
  freeze it.
- **Banked initiative is chain fuel** — which is why stagger is guarded
  (one per victim action cycle, see Tempo Thief), and why Dodge exists:
  a chain of physical strikes walks into Sidestep charge by charge.
- **Rest limits chain depth too**: every cast in a chain rests afterward,
  so a triple play needs three distinct ready cards.

## Guided builds — unique anchors

Six UNIQUE cards (one copy, fixed rank, never upgrade) each anchor a
build: find the unique, and the rest of the board plans itself around
it. All of them are pure recombinations of existing engine pieces.

| Unique | What it warps | The guided build around it |
|---|---|---|
| **War Drums** (passive) | whole board +12% damage | any damage board — the generalist anchor |
| **Chronolith** (passive + cast) | whole board 2 lighter; casting quickens 8 | the SPEED build: light cards, Haste, chains |
| **Blood Altar** | pay 15 HP → next card +130% | the NOVA build: altar into Meteor Shard / Crushing Blow; lifesteal refunds the price |
| **Executioner's Sigil** (passive) | whole board +10% crit | the CRIT build: multi-hits (Flurry, Pinning Volley) fill meters fastest |
| **Mender's Heart** (passive) | all heals +12% | the SUSTAIN build: heal-tank with a DoT clock |
| **Living Armor** | thorns 25% for 4 turns | the THORN build: reflect engine + Spiked Bulwark; purge tears it off |

Sim notes (base stats, common cards around each anchor): the Nova build
is the scariest — it deletes slow enemies (Ember Imp turn 3, Runewall
crushed) but loses to fast elites and edges Bandit by 4 HP; Sigil crit
gives a brand-new Feral Alpha answer; sustain still has no clock and
loses long (as designed). One copy each: an anchor is a run-defining
FIND, not a list you complete.

## Rest — cards need two turns off

Sims showed a 2–3 card board of light attackers performs nearly as well
as a full 10-slot board: act rate is pure speed/weight, so fielding less
PL barely cost anything. The counter is ONE engine-native sentence:

**After a card casts, it rests for 2 turns.**

That's the whole rule. It rides the same clock as every other duration
(buffs, DoTs), each COPY rests on its own, and a resting card simply
isn't offered by the rotation — no new math anywhere.

What it does to each board shape:

- **3+ castable cards: the rule is invisible.** By the time your rotation
  returns to a card, its rest is over. Normal decks never notice.
- **Two cards (or two copies of one card): cast, cast, stall.** One idle
  turn out of every three — the side banks initiative while it waits, so
  the stall is a delay, not a loss.
- **One card: cast, stall, stall.** A third of the actions, with big
  banked bursts between.
- **Duplicates just work.** Two copies of Sword Slash = a 2-card rotation
  (each copy rests separately) — meaningfully better than one copy,
  meaningfully worse than two different cards once staleness (bonus
  fade for repeating the same MOVE) is counted.
- **Chains respect it**: a chained cast rests like any other, so a triple
  chain needs three distinct ready cards — deep chains demand deep
  boards as well as deep Speed.
- Display is free: a resting card shows a "resting" chip in battle, and
  at build time the entire check is *"do I have 3+ castable cards?"* —
  shown right on the Prep board line.

## Momentum & staleness — the variety axis

BASE damage is sacred: no rotation pattern ever changes a card's printed
numbers. What flexes is BONUS effectiveness (aura boosts, combo/execute
riders), in both directions:

- **Staleness** — re-casting the SAME skill fades its bonuses −25% per
  repeat, gone by the 4th (a War Banner'd slash spam runs
  25 → 23 → 22 → 21 → 20, settling at base).
- **Momentum** — chaining DIFFERENT skills amplifies bonuses +25% per
  link, capped at +75%. A Blade Dancer rotation RAMPS: by the fourth
  distinct cast, Follow-Through's +75% combo reads as +131%.

Simple attacks and simple enemies keep their full bite either way;
synergy payoffs — the reason to build a themed board — are what variety
buys, and they climb the longer the chain runs.

Pacing levers for higher-level fights (design intent: longer, not
burstier): staleness kills same-attack spam; the utility premium keeps
raw-damage stat-checks from being the efficient buy; and when the run
layer lands, depth should scale enemy HP pools faster than enemy damage
and push `suddenDeathRound` later — both already config knobs on
`simulate()` — so late fights breathe instead of ending in one alpha
strike.

## Enchantments — free-flow mechanics, not themed families

Design principle (Yi Xian comparison, resolved): mechanics ship as
ENCHANTMENTS any placed card can carry — never as sect/theme-locked card
families. Themes emerge from what players compose, not from what the
catalog prescribes. The marks so far:

- 🌀 **Storm** — AoE: damage hits every foe at 60%.
- 🎯 **Assassin** — hit the lowest-aggro foe.
- ⚰ **Executioner** — hit the weakest foe.
- 🏃 **Chase** — after this card resolves, immediately perform your next
  card; this card's damage is 40% weaker. Tempo bought with power — a
  chase-marked opener turns any rotation into a Yi Xian-style flurry, and
  the follow-up arrives with momentum already flowing.
- 💥 **Overload** — this card's damage is 50% STRONGER, but it can be cast
  only ONCE per battle (exhaust). One perfect swing; the rotation skips
  the spent piece afterwards.

Every mark is a SIDEGRADE (it trades, never adds raw power), swappable
per-piece between fights on the Cards page. Authored cards can also carry
`uses` natively — limited casts REFUND budget (1 use = +4 PL of kit).
Future candidates in the same mold: charge/spend stacks, cycle timing
(every 2nd loop), HP-cost casting.

### Card-targeted debuffs — traps on THEIR skills

Debuffs can now land on a specific enemy CARD instead of the enemy's
stats: `curseCard` traps the enemy's QUEUED card, and when they next cast
that piece the trap detonates (damage baked at application from the
curser's stat, matchup and the victim's resolve — fully deterministic).
Showcase: **Hex Trap** (dark, Common 10) — 100% damage now, 125%
detonation when their trapped card activates. Counterplay is rotation
knowledge: the victim "walks into" the trap on schedule, so heavy
must-cast cards (Rending Claws, Fireball) are the juiciest marks.

## The card ladder — one axis, Bazaar-style

Design law: there is ONE ladder, not separate tier and rarity axes.

- **Common → Rare → Epic → Legendary** is the ladder: the PL budget a
  card's kit sums to (10 / 15 / 20 / 25), upgraded in place. A card's
  rank IS its power — nothing else grades cards.
- **Unique** sits outside the ladder: a different kind of skill —
  one-of-a-kind (at most one copy held) and FIXED RANK: it never
  upgrades; its printed form is its final form. Uniques audit at the
  Common budget — their edge is the effect design, not raw PL. First
  unique: **War Drums** (the one battle standard — whole-board +12%
  damage). Future build-arounds like the permanent-thorns Living Armor
  land here.

## Possession cap — 10 board + 10 backpack

A player holds at most 20 SLOTS of cards: the 10-slot board they fight
with, plus a 10-slot backpack — and cards occupy their SIZE in both (a
size-3 Crushing Blow eats 3 backpack slots in reserve exactly as it would
on the board). This is the roguelite's inventory pressure: drafting a new
card past the cap means dropping or selling something, and hoarding
answers for every check is impossible — you commit to a strategy. The
Cards page enforces it today.

## General placement rules

- **Combo routing:** Follow-Through checks the PREVIOUS cast's archetype —
  never lead the rotation with it, never put a heal directly before it.
- **Aura economics:** a size-2 card touching an aura gets the same bonus as
  a size-1 — big cards are efficient aura receivers. Corner passives
  (slot 0/9) waste half their reach.
- **Skip-aware rotations:** useless casts are skipped (full-HP heal, capped
  shield), so a heal placed mid-chain is FREE damage-smoothing — it only
  interrupts the combo when you actually needed it.
- **Span banking:** a size-3 card leaves you busy 2 turns — you bank Speed
  the whole time, so follow a span with your heaviest hitter, not your
  lightest.
- **Against affinities:** every enemy preset telegraphs its weakness in
  Prep (e.g. Wolf King 🐾 → bows; Ember Imp 🔥 → frost). One matchup swap
  is worth ~1.75× on that card — more than a tier-up.

## Future theme hooks (planned, not built)

- **Taunt/lure/aggroSwap actions** → true tank-and-spank party builds and
  aggro-war mirrors (see party-battles plan).
- **'party' aura reach** → banner builds that buff the whole formation, the
  natural home for a sixth "party" archetype.
- **Meta skills tree loadouts** (deferred phase) → theme-boosting perks
  (e.g. Legacy's affinity picks locking in matchup advantage per run).

## Enemy curriculum — checks, not stat walls

Low floor, high ceiling: elites and bosses demand PROPER TACTICS and deck
planning, but always through kits made of existing player-facing rules —
a boss is a question, your deck is the answer, and no check ever
introduces a mechanic the player hasn't seen on their own cards.

Sim-validated — each check gates the DECK STYLE it's aimed at (naive
all-damage loses to the first three; mage boards bounce off the Wraith;
single-typed shield walls die to the Marauder) and every tailored answer
wins:

| Elite | The question | Answers that work |
|---|---|---|
| **Runewall Sentinel** | shields cycling behind armor 6 + resolve 25 | poison (bypasses shields), Shield Splitter, true damage — or patient tempo+sustain |
| **Feral Alpha** | Battle Howl into hard, varied beast attacks at speed 14 | Dispelling Arrow (purge the howl) + bows (beast matchup) + Concussive Shot + Hamstring — purge, matchup and BOTH tempo verbs together |
| **Grave Chanter** | 45-point heals behind hexes and slows | Stunning Smash to EAT the heal cast + Crushing Blow to punish the window — burst or stun alone is not enough |
| **Spellward Wraith** | Magic Resist 9, armor 0 — gates MAGE boards (a hex deck bounces off) | physical decks, true damage |
| **Twinblade Marauder** | mixed physical AND magical damage — gates single-typed WALLS (a double-Bulwark turtle dies) | true shields, layered defense, or the lance matchup vs his sword affinity |

Checks gate THOUGHTLESS decks, not demand one true answer — a genuinely
well-built deck of another flavor may grind one out (the hunter deck beats
the Sentinel in 39 patient turns). Depth scaling from the run layer will
raise elite STATS later; the tactic requirement comes from kits, and that
ships now.

Chain-patch aftermath (sim-validated): under the exponential chain cost,
normal-speed fights match the pre-chain baseline exactly, so NO elite stat
retunes were needed. What did shift is the answer decks: the stagger guard
killed every double-stagger answer, so tempo answers now mix verbs (see
rows above), and the **Wolf King** — an all-physical, single-target kit —
is now cleanly answered by Sidestep tech: `sidestep, hunter_shot,
dispelling_arrow, concussive_shot, second_wind` wins with 74 HP standing.
A pure dodge-tank does NOT trivialize physical elites (no clock — sudden
death wins the argument).

## Complexity budget — keep the floor low

Design law (2026-07): the game must stay ONE sentence to learn — "put cards
in a row; they cast left to right; lighter cards act sooner." Everything
else is optional depth. Rules that protect this:

1. **Depth is invisible; the floor is visible.** Staleness, momentum, the
   crit meter, resolve, aggro, PL budgets — none of these require player
   knowledge to play well enough. They reward natural play (variety, tanks
   up front) without being readable prerequisites. Keep it that way: a new
   mechanic that a beginner MUST understand to win fight one is rejected.
2. **The card is the only required reading.** Every card self-describes in
   one sentence on its face. If a card needs a glossary, rewrite the card.
3. **Verb freeze.** The action DSL (~20 verbs) is enough for years of
   content — new cards RECOMBINE existing verbs; adding a verb needs a
   reason recombination can't serve. Enchant marks cap at a handful.
4. **Progressive disclosure via the tier cadence.** Common cards early in a
   run use core verbs (damage/heal/shield/poison); richer verbs arrive on
   upgrades and later drops — the ability-every-2nd-tier cadence IS the
   tutorial pacing.
5. **Show, don't formula.** The battle banner's raw math (bank+speed−weight)
   is developer UI. Player-facing: a "next to act" indicator, with the math
   in a tooltip for the curious. Stats on the card face cap at the few that
   matter for placement; the rest lives in an inspect panel.
