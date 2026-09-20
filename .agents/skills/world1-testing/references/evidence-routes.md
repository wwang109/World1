# Evidence routes — per surface, the command and its real output

Every command below was run on this checkout on 2026-09-15, on a LIVE
shared tree (`world1-handoff` §1), and the output is pasted, not
reconstructed. Each uses the direct-entrypoint form, which runs whether or
not the clone has `node_modules/.bin`; where the clone has one, the `npm run`
form in the heading does the same thing. Script names come from
`package.json`.

No `*.test.ts` file exists in this repo, and none may (`CLAUDE.md`
§ "Verification is by evidence — no test files"). These routes ARE the
verification.

## 1. Combat rule → an ON/OFF `fight` pair (`npm run fight`)

Format rules, mobile-first layout, and the recipe catalog belong to
**`world1-combat-log`** (`../../world1-combat-log/SKILL.md`,
`../../world1-combat-log/references/fight-recipes.md`). This is one worked
pair, not a second copy. The whole board comes from env
(`FIGHT_HERO_BOARD`, `FIGHT_FOE_BOARD`, `FIGHT_FOE_STATS`, `FIGHT_HERO_STATS`,
`FIGHT_NARROW`, and more — `grep -o "FIGHT_[A-Z_]*" scripts/fight.ts
scripts/boardSpec.ts | sort -u` lists them all).

**ON** — a 3-sword board earns `sworn_edge`'s affinity second hit:

```bash
FIGHT_NARROW=1 \
FIGHT_HERO_BOARD=sworn_edge,void_pierce,twin_slash \
FIGHT_FOE_BOARD=sword_slash \
FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
node node_modules/tsx/dist/cli.mjs scripts/fight.ts bandit_duelist 5
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
t2 cost Hero
```

**OFF** — same seed, same dummy, `sworn_edge` alone:

```bash
FIGHT_NARROW=1 \
FIGHT_HERO_BOARD=sworn_edge \
FIGHT_FOE_BOARD=sword_slash \
FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
node node_modules/tsx/dist/cli.mjs scripts/fight.ts bandit_duelist 5
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
t2 cost Hero
   readiness 20
   -> 0
   paid 20
t2 cursor Hero
   -> sworn_edge
   slot 2
```

Read together: ON's turn carries a second `takes 28 physical … affinity
sword` block; OFF's turn ends at the single 35 hit and goes straight to
`cost`/`cursor`. Only the surrounding board differs, so the pair proves what
gates the effect — that is a settled claim.

## 2. Determinism → same board, same seed, twice, `diff`

Required whenever `src/engine/combat/*`, `rng.ts`, `cards.ts` or
`balance.ts` changed. Run the ON command above twice into two files:

```bash
FIGHT_NARROW=1 FIGHT_HERO_BOARD=sworn_edge,void_pierce,twin_slash \
FIGHT_FOE_BOARD=sword_slash FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
node node_modules/tsx/dist/cli.mjs scripts/fight.ts bandit_duelist 5 > tmp/on-1.log
# ...the identical command again...                                       > tmp/on-2.log
diff tmp/on-1.log tmp/on-2.log; echo "diff exit $?"
cmp  tmp/on-1.log tmp/on-2.log && echo "cmp: byte-identical"
wc -c tmp/on-1.log tmp/on-2.log
```

```
diff exit 0
cmp: byte-identical
 9693 on-1.log
 9693 on-2.log
```

A silent `diff` and a `cmp` that prints nothing but the confirmation IS the
determinism evidence. Any line of `diff` output on an unchanged input is a
broken invariant, not noise. (`tmp/` is gitignored scratch — never the repo
root.)

## 3. Card / gem / enemy / event data → `npm run content:validate`

```bash
node node_modules/tsx/dist/cli.mjs scripts/validateContent.ts
```

```
ok  src/data/content/event-packs — 12 packs, 66 events, generated aggregate current
ok  src/data/content/skills.v1.json — 183 documents, no problems
ok  src/data/content/gems.v1.json — 53 documents, no problems
ok  src/data/content/enemies.v1.json — 59 documents, no problems
ok  src/data/content/modifiers.v1.json — 6 documents, no problems
ok  src/data/content/events.v2.json — 44 documents, no problems
ok  src/data/content/events.v3.json — 66 documents, no problems
ok  src/data/content/event-discoveries.v1.json — 16 discoveries, no problems
content validation passed
exit 0    (real 0m0.517s)
```

It also runs first inside `npm run build`, and it performs a raw-bytes
duplicate-key check no loader can (`JSON.parse` silently keeps the last
duplicate). Pair it with a fight log that shows the new card firing (route 1).

## 4. A price → `npm run scaffold:card`

The solver grows a kit onto its tier budget and audits it through the real
`src/engine/balance.ts` gates at every tier. Which constants and why:
**`world1-balance`**. Flags: `--id --name --property --archetypes --keywords`
required; `--tier` (bronze default), `--size` (1), and exactly one of
`--element` / `--weapon` as the property demands.

```bash
node node_modules/tsx/dist/cli.mjs scripts/scaffoldCard.ts \
  --id skill_demo_probe --name "Demo Probe" --tier bronze --size 1 \
  --property physical --weapon sword --archetypes offense --keywords damage
```

```
=== GENERATED FACE (via renderSkillText — the real generator) ===
  bronze   Deal 20 (+ATK) Sword damage.
  silver   Deal 30 (+ATK) Sword damage.
  gold     Deal 40 (+ATK) Sword damage.
  diamond  Deal 50 (+ATK) Sword damage.
=== AUDIT (via src/engine/balance.ts — the real gates) ===
  bronze   PL  10.0 / 10  caps clean  OK
  silver   PL  15.0 / 15  caps clean  OK
  gold     PL  20.0 / 20  caps clean  OK
  diamond  PL  25.0 / 25  caps clean  OK
  isOnBudget: true
  content validator: clean

=== PASTE INTO src/data/content/skills.v1.json (cards[]) ===
{ ... }
exit 0
```

A kit that cannot land on budget exits 1 with `REFUSED — the card does not
pass its own gates:` and the failing tier lines — that output is the
evidence that the price is wrong; paste it too.

## 5. Run logic → `npm run output`, `shop:smoke`, or a `tsx -e` probe

- **Enemy / encounter resolution** (`src/run/encounter.ts`,
  `src/run/leveling.ts`, `src/run/analysis.ts`): `npm run output -- <enemyId>
  [level]` (`scripts/enemyOutput.ts`) resolves the enemy through the real
  production path and prints its per-turn damage/heal/shield plus the
  resolved board.
- **Shop economy** reached through the real screen: `npm run shop:smoke`
  (route 6 — it needs both servers).
- **Anything else in `src/run` / `src/meta`**: call the exported function
  and paste what it returns. `tsx -e` works on this checkout:

```bash
node node_modules/tsx/dist/cli.mjs -e "import('./src/run/leveling.ts').then(m => console.log(Object.keys(m).join(' ')))"
```

```
DEFAULT_PROFILE LEVEL_STAT_COST MONSTER_PROFILES PL_PER_LEVEL allocateMonsterPL applyLevelAllocation applyPlayerLevelAllocation bankedPL canAfford monsterLevelPL profileFor scaleMonsterToLevel spentPL totalLevelPL
exit 0
```

The probe is throwaway — it lives in the report, never in the tree.

## 6. A screen → audit scripts + screenshots on BOTH platforms

Routes, viewports, servers, and the screenshot discipline belong to
**`world1-screens`** (`../../world1-screens/SKILL.md`,
`../../world1-screens/references/verifying-a-screen.md`). All three scripts
need `npm run dev` (:5173); `audit:hud` and `shop:smoke` also need `npm run
api` (:8787). Each takes an output directory as its first argument — point
it at scratch (`tmp/`), never the repo root — and honours `WORLD1_DEV_URL`.

**`npm run audit:cardface`** — real run, both servers already up (another
agent's; `world1-handoff` §1 before starting or killing either):

```bash
node node_modules/tsx/dist/cli.mjs scripts/card-face-truncation-audit.ts tmp/cardface-out
```

```
  card-title 307w (RunRewardPanel:241 scale, mobile reward slot 360x504): silent=0, cut=0 <= 0
  card-body 307w (RunRewardPanel:241 scale, mobile reward slot 360x504): silent=0, overflowing=0 <= 0
  card-title 336w (RunRewardPanel:241 scale, desktop reward slot 493x552): silent=0, cut=0 <= 0
  card-body 336w (RunRewardPanel:241 scale, desktop reward slot 493x552): silent=0, overflowing=0 <= 0
  card-title 420w (base size — synthetic control, no call site): silent=0, cut=0 <= 0
  card-body 420w (base size — synthetic control, no call site): silent=0, overflowing=0 <= 0

Totals: passed=24 hardFailures=0
exit 0    (real 0m18.290s)
```

**`npm run shop:smoke`** — same session, same servers, honest result:

```bash
node node_modules/tsx/dist/cli.mjs scripts/shop-smoke.ts tmp/shop-smoke-out
```

```
=== HARD FAILURES (4) ===
  [desktop] step "map-start -> loader finished": no text matching START RUN/RESUME RUN appeared within 30000ms
  [desktop] step "draft": loader never finished
  [mobile] step "map-start -> loader finished": no text matching START RUN/RESUME RUN appeared within 30000ms
  [mobile] step "draft": loader never finished

Totals: passed=0 hardFailures=4
exit 1    (real 1m4.819s)
```

**Do not read that as a verdict on the game.** A walkthrough stuck at the
title screen on a tree where several agents are mid-edit is the classic
shape of someone else's half-saved scene, not a proven regression. A hard-
failure total from `audit:hud` or `shop:smoke` is trustworthy ONLY on a tree
you know is quiet, or when you started `dev`/`api` yourself from a clean
checkout — say which. What the paste DOES prove: the script is real, runs,
needs both servers, and reports per platform. The `Totals:` line is what a
report quotes.

Screenshots: state the route, the viewport (desktop 1440×900 / mobile
412×892, real CSS px) and what the image must prove BEFORE capturing —
`world1-screens` §4.

## 7. A doc or a shared skill → parity gate + cited-path check

```bash
node scripts/check-skill-parity.mjs
```

```
skill parity OK
exit 0    (real 0m0.878s)
```

Then prove every path and command the text cites exists — `ls` the paths,
run the commands — and for a skill sweep for stale routes:

```bash
grep -rn -E "tests/|vitest|\.test\.ts|describe\(" .claude/skills/<n> .agents/skills/<n>
```

Anything that comes back must be an explicit statement that tests do not
exist, never a pointer to one.
