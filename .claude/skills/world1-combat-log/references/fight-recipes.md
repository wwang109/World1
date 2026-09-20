# Fight recipes — the real `FIGHT_*` surface

`npm run fight` resolves only where the clone has a **`node_modules/.bin`**;
without one it fails with `'tsx' is not recognized`. Every recipe below gives
the `npm run` form AND the direct form, which ran on this checkout and works
either way:

```bash
npm run fight -- <enemySpec> [seed]
# equivalent:
node node_modules/tsx/dist/cli.mjs scripts/fight.ts <enemySpec> [seed]
```

## Every `FIGHT_*` variable, read from `scripts/fight.ts` itself

Verified against the source, not carried from any doc. `argv[2]` is the
enemy spec (`bandit_duelist`, `giant_rat*3`, `giant_rat*2,knight` — comma
list, `*N` repeats, capped at `MAX_FOES`, `scripts/fight.ts`) and `argv[3]`
is the seed.

| Variable | Takes | Verified real example |
|---|---|---|
| `FIGHT_NARROW` | `1` to reflow the wide log into one-fact-per-line mobile format | `FIGHT_NARROW=1 npm run fight -- bandit_duelist 5` |
| `FIGHT_HERO_BOARD` | comma list of `skill_id` / `skill_id@tier` / `skill_id#gem_id` (`scripts/boardSpec.ts` syntax), left-to-right from slot 0 | `FIGHT_HERO_BOARD=sword_slash npm run fight -- bandit_duelist 5` |
| `FIGHT_FOE_BOARD` | same syntax, replaces the named enemy's pieces | `FIGHT_FOE_BOARD=sword_slash npm run fight -- bandit_duelist 5` |
| `FIGHT_HERO_STATS` | `k:v,...` against `CombatantStats`; refuses an unrecognized key | `FIGHT_HERO_STATS=maxHp:30000,hp:30000,attack:1,armor:0 npm run fight` |
| `FIGHT_FOE_STATS` | same, for the foe side — the standard way to build a passive dummy | `FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 npm run fight -- bandit_duelist 5` |
| `FIGHT_FOE_SLOTS` | positive integer — raises the foe's board size past its catalog value, for showing an elite/boss-grown board `FIGHT_FOE_BOARD` needs more room for | `FIGHT_FOE_SLOTS=4 FIGHT_FOE_BOARD=sword_slash,follow_through,bramble_ward,sword_slash npm run fight -- bandit_duelist 5` |
| `FIGHT_HERO_HP` | integer — overrides STARTING hp only (maxHp untouched); "what does this look like at half health" | `FIGHT_HERO_HP=40 npm run fight -- bandit_duelist 5` |
| `FIGHT_ENEMY_LEVEL` | positive integer — routes the foe through the real growth resolver (`resolveEncounterForEnemy`) at a flat `'normal'` title | `FIGHT_ENEMY_LEVEL=5 npm run fight -- cleric 42` |
| `FIGHT_EXTRA_ENEMY` | path to an enemies-document JSON (same shape/validator as `enemies.v1.json`) — a synthetic `EnemyDef` for a proof with no shipped fixture | `FIGHT_EXTRA_ENEMY=/tmp/probe-enemy.json npm run fight -- probe_dummy 5` |
| `FIGHT_EXTRA_CARDS` | path to a skills-document JSON (same shape/validator as `skills.v1.json`) — a synthetic `SkillDef` not (yet) shipped | `FIGHT_EXTRA_CARDS=/tmp/probe-cards.json FIGHT_HERO_BOARD=ember_dart npm run fight` |

**Codemap cross-check**: `world1-codemap`'s command table lists exactly these
ten names for `npm run fight`. Re-verified against `scripts/fight.ts` for
this task — no variable is missing and none is misnamed.

## Recipe: one card against a high-HP dummy

```bash
FIGHT_NARROW=1 \
FIGHT_HERO_BOARD=sword_slash \
FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
npm run fight -- bandit_duelist 5
```

Real output (first hit):

```
t1 play Hero
   sword_slash
   slot 1
   weight 10
   target Bandit Duelist
   aggro 0
   -> -21
   29979 hp
t1 Bandit Duelist
   takes 21 physical
   -> 29979 hp
t1 calc
   21 = 21 HP
   attack 1->1
   +0 aura/combo
```

## Recipe: an on/off pair proving a condition gates an effect

`sworn_edge`'s second damage line is `affinity: true` — it only fires when
the caster's board carries a `sword`-identity (`IDENTITY_THRESHOLD`+ sword
cards, `src/engine/combat/typeIdentity.ts`). Same seed, same dummy, same
card; only the SURROUNDING board changes.

**ON** — a 3-sword board (`sworn_edge, void_pierce, twin_slash`):

```bash
FIGHT_NARROW=1 \
FIGHT_HERO_BOARD=sworn_edge,void_pierce,twin_slash \
FIGHT_FOE_BOARD=sword_slash \
FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
npm run fight -- bandit_duelist 5
```

```
t2 play Hero
   sworn_edge
   slot 1
   1 of 2
   weight 20
   target Bandit Duelist
   aggro 0
   -> -35
   29965 hp
t2 Bandit Duelist
   takes 35 physical
   -> 29965 hp
t2 calc
   35 = 35 HP
   attack 1->1
   +0 aura/combo
t2 Bandit Duelist
   takes 28 physical
   -> 29937 hp
   affinity sword
t2 calc
   28 = 28 HP
   attack 0->0
   +0 aura/combo
```

**OFF** — the identical card, alone (no sword identity):

```bash
FIGHT_NARROW=1 \
FIGHT_HERO_BOARD=sworn_edge \
FIGHT_FOE_BOARD=sword_slash \
FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
npm run fight -- bandit_duelist 5
```

```
t2 play Hero
   sworn_edge
   slot 1
   1 of 2
   weight 20
   target Bandit Duelist
   aggro 0
   -> -35
   29965 hp
t2 Bandit Duelist
   takes 35 physical
   -> 29965 hp
t2 calc
   35 = 35 HP
   attack 1->1
   +0 aura/combo
```

**The pair, read together**: ON lands TWO hits (35, then 28 tagged
`affinity sword`); OFF lands only the first (35) — the same base hit fires
either way, and the gated second hit fires only when the board earns the
identity. Neither run alone proves the gate; the pair does.

## Recipe: determinism — the same log twice

Same board, same seed, run twice, `diff`. This is the project's only
determinism proof (`CLAUDE.md`, "Verification is by evidence — no test
files"); there is no vitest case behind it. Scratch goes to `tmp/`
(gitignored), never the repo root.

```bash
node node_modules/tsx/dist/cli.mjs scripts/fight.ts bandit_duelist 5 > tmp/run1.txt
node node_modules/tsx/dist/cli.mjs scripts/fight.ts bandit_duelist 5 > tmp/run2.txt
diff tmp/run1.txt tmp/run2.txt; echo "diff exit $?"
```

Real output on this checkout — the diff prints nothing, which is the proof:

```
diff exit 0
```

Read it as: every line of a 73-line log, identical across two processes.
Any printed line means `simulate(config, seed)` is no longer a pure function
— look for `Date.now()`, `Math.random()`, or a `Map`/`Set` iterated
where order can vary (`CLAUDE.md` "Determinism invariants"). Widen the pair
(`FIGHT_HERO_BOARD`, a multi-enemy spec, a different seed) to cover the
mechanic you changed; the shape of the proof does not change.

## Recipe: a multi-enemy board

```bash
npm run fight -- "giant_rat*3" 42
```

Real output (header + opening exchange):

```
seed 42 · giant_rat*3
  you unit 0  Hero             100 hp
  foe unit 0  Giant Rat #1     100 hp
  foe unit 1  Giant Rat #2     100 hp
  foe unit 2  Giant Rat #3     100 hp

  1  play    Giant Rat #1     savage_bite (slot 1) · weight 10 · target Hero (aggro 0) -> -20 [80 hp]
  1 │  Hero             takes 20 physical -> 80 hp
```

Every combatant is individually named (`#1`/`#2`/`#3`), never collapsed to
"the foe side" — team-aware naming (2026-08-19).

## Recipe: a levelled enemy

```bash
FIGHT_ENEMY_LEVEL=5 npm run fight -- cleric 42
```

Diffed against the unlevelled run (`npm run fight -- cleric 42`) on this
checkout — two real differences, not a guess:

```
< t2 calc  48 +MRES1 -OVERHEAL49 = 0 HP        (level 1)
> t2 calc  64 +MRES1 -OVERHEAL65 = 0 HP        (level 5, bigger heal)

< t4 cursor Cleric -> mending_light (wrap)      (level 1: 3-card board)
> t4 cursor Cleric -> sanctuary_overflow         (level 5: a 4th piece exists)
```

Confirms `scripts/enemyOutput.ts`'s own header note: growth spends PL mostly
on the BOARD (an extra piece here), not on stats — HP stayed unchanged in
the header at both levels.
