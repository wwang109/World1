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
- Follow-Through lands third: the previous cast was Offense → +75%.
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
| + venom/leech clock (Bronze) | W | W | W | L | L |
| Silver core (coat/spores/mending/fangs) | W (42 hp) | W (150 hp) | W (98 hp) | **L** | W (0 hp — tie, player wins) |

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
999-turn duration), base Bronze stats:

| Rules | Peak stacks | Rat | Beetle | Imp | Bandit | Wolf King |
|---|---|---|---|---|---|---|
| Current (3-turn instances) | 2–3 (50–75%) | L | W | W | L | L |
| Never-expiring (purge = only counter) | 4–13 (100–325%) | W | W | W | W | W |

Permanent stacking is spectacular — past ~4 stacks (100%) the enemy kills
itself, and sudden death's +30%/turn enemy ramp flips into the TURTLE'S
win condition (bigger hits = bigger reflects). That inversion is elegant,
but as a spammable Bronze mechanic it's degenerate: a clean sweep of every
preset including elite and boss with zero offense, zero tier investment,
and no enemy in the roster carries purge to answer it.

Recommendation: keep baseline thorns timed, and ship permanence as SCARCE:
- a Diamond/legendary authored card ("Living Armor" — thorns you apply
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

## Staleness — the anti-spam rule

Spamming the SAME skill never touches its BASE damage — a plain Sword
Slash deals its full 200% forever. What decays is BONUS effectiveness:
aura boosts and combo/execute riders fade −25% of the bonus per
consecutive re-cast, gone by the 4th (a War Banner'd slash spam runs
25 → 23 → 22 → 21 → 20). Casting anything else resets it. So simple
attacks and simple enemies keep their full bite, while synergy payoffs —
the whole reason to build a themed board — demand variety.

Pacing levers for higher-level fights (design intent: longer, not
burstier): staleness kills same-attack spam; the utility premium keeps
raw-damage stat-checks from being the efficient buy; and when the run
layer lands, depth should scale enemy HP pools faster than enemy damage
and push `suddenDeathRound` later — both already config knobs on
`simulate()` — so late fights breathe instead of ending in one alpha
strike.

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
