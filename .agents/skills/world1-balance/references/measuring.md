# Measuring — tools that produce evidence

`npm run scaffold:card` proves a single card's own solve. These tools measure
a BOARD in motion. All are manual exploration (LOCKED: never a balance
target — see `SKILL.md`). `npm run` needs a `node_modules/.bin` the clone may
or may not have, so every `npm run` invocation below has a direct `node`
equivalent that runs either way; prefer it.

## `scripts/balance.ts` — `npm run sim`

Headless N-fight harness (`simulate1v1`, seeded). Confirmed present on this
checkout at `scripts/balance.ts`.

```bash
npm run sim                        # hero board vs every demo enemy, 300 seeds each
npm run sim -- 1000                # 1000 seeds per matchup
npm run sim -- 500 wolf_king       # focus one enemy, print damage-by-source breakdown
npm run sim -- build <buildId> <enemyId> [n]   # a named board vs a named enemy
npm run sim -- demo [n]            # PL-vs-PL demonstration board

# direct form:
node node_modules/tsx/dist/cli.mjs scripts/balance.ts 50 wolf_king
```

Real run, `50 wolf_king`, this checkout:

```
Hero board total PL: 50.0 (war_banner, sword_slash, crushing_blow, iron_bulwark, second_wind)

enemy             enemyPL    hp   atk  winrate  draws  avgTurns  minT  maxT  avgPHpLeft notes
---------------------------------------------------------------------------------------------
wolf_king            30.0   100     1   100.0%      0       5.0     5     5        53.0 lopsided (player)

Damage-by-source breakdown vs wolf_king (50 seeds, total damage dealt to enemy):
  skill          6300 (100.0%)
  poison            0 (0.0%)
  ...
```

Reads this straightforwardly: `enemyPL` is the sum of board-card PL only
(independent of HP/stats — a separate axis, deliberately not folded in), so
it is the thing to compare against the hero's own board PL when asking
"is this matchup PL-fair", never the winrate column.

## `scripts/enemyOutput.ts` — `npm run output`

Per-turn damage/heal/shield output for a CONFIGURED enemy, resolved through
the REAL production path (`resolveEncounterForEnemy`, `src/run/encounter.ts`)
so growth/rank/title/level stat scaling all apply exactly as in a real fight.
Confirmed present at `scripts/enemyOutput.ts`.

```bash
npm run output -- giant_rat        # enemy at level 1, its default title
npm run output -- cleric 5         # Cleric at level 5

# direct form:
node node_modules/tsx/dist/cli.mjs scripts/enemyOutput.ts cleric 5
```

Real run, `cleric 5`, this checkout:

```
cleric  L5
  dmg/turn
    spec 0
    range 0-0
  heal/turn
    spec 17
    range 0-33
  shield/turn
    spec 3
    range 0-3
  pieces
    silver mending_light
    bronze sanctified_bulwark
    bronze penitent_mending
    bronze sanctuary_overflow
  stats
    atk   1
    mag   1
    arm   1
    mres  1
```

Per the script's own header comment: **the stats are not the story** — base
enemy stats sit at 1/1/1/1 for nearly every roster entry until deep into the
level curve, and `scaleMonsterToLevel` spends a level's PL budget on the
BOARD (more pieces, tier-ups) rather than stats. The piece list is the
primary read; the stat block is secondary context.

Two more modes exist on this checkout, for boards that produce no direct
damage/heal/shield to measure in isolation (combo riders, pure buffs):

```bash
npm run output -- --board sworn_edge,void_pierce,twin_slash
npm run output -- --board sworn_edge@silver,cinder_dart#resonant_echo
npm run output -- --vs <withBoard> <withoutBoard>   # A/B delta, same window/dummy
npm run output -- --dummy hp:10,armor:5,...          # override the measuring dummy
npm run output -- --stats k:v,...                    # override the probe rig's own stats
```

## `scripts/boardSpec.ts` — NOT a script, a shared parser

Confirmed present at `scripts/boardSpec.ts`, but `package.json` has no script
entry for it (checked directly — no `boardSpec` key). It is a shared module
(`parsePiece`/`parsePieceList`/`withStatOverrides`) both `scripts/fight.ts`
and `scripts/enemyOutput.ts` import, so the `skill_id`/`skill_id@tier`/
`skill_id#gem_id` board-spec syntax and the `k:v,...` stat-override syntax
exist in exactly one place. There is nothing to invoke here directly — it is
read, not run.

## Also evidence-producing: `npm run scaffold:card`

Every `scaffold:card` invocation prints the real audit table at every tier
(`pricing-a-card.md`), which is itself measured evidence that a
card's magnitudes actually solve — not just a description of the rule.
