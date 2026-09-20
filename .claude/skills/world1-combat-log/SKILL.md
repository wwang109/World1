---
name: world1-combat-log
description: Use before making, repeating, or defending any claim about what a World1 card, keyword, or status does in combat - before writing prose about a rider's behavior, before answering "does this effect fire" or "what gates it", and before settling a disagreement about combat behavior. States the USER-LOCKED rule that the log comes first and must come from npm run fight, never a hand-written renderer, and gives the on/off-pair and mobile-format conventions that make a log readable and trustworthy.
---

# World1 combat log — show it, then explain it

## Show the log FIRST, then explain

Any claim about what a card or keyword does **leads with a real combat log**
— not prose, not a table of derived numbers, not a green gate. The
explanation comes after, as a caption to something the reader has already
seen. In the user's own words: *"if you can prove it using the combat log it
makes more sense for everything."*

**Tag the kind on first mention when you caption a log** (`CLAUDE.md`, "Tag
every game entity by kind", USER-LOCKED 2026-09-16). Unedited lines from
`npm run fight -- bandit_duelist 5` — two adjacent turn-1 lines, then turn 3:

```
  1  cursor  Hero             -> sword_slash (slot 2)
  1  play    Bandit Duelist   sword_slash (slot 1) · weight 10 · target Hero (aggro 0) -> -20 [80 hp]
```
```
  3 │  Bandit Duelist   gains thorns for 5t
```

The log prints COMBATANTS (hero, enemies) by display name on every event
line — `Bandit Duelist` on 32 lines of that run — and CARDS and STATUSES by
id (`sword_slash`, `war_banner`, `thorns`); the enemy id appears once, in
the seed header `seed 5 · bandit_duelist`. So the caption bridges the two
forms: tag and `name` first — `[card] Sword Slash`, `[enemy] Bandit Duelist`,
`[status] Thorns` — and the id in backticks after it where a `FIGHT_*`
variable needs it (`sword_slash`). A bare snake_case word does not say
whether it is a card, a gem or a status.

## NEVER hand-write a log renderer (USER-LOCKED)

Every log shown comes from `npm run fight` (`scripts/fight.ts` +
`scripts/logFormat.ts`). A second renderer is a duplicate that **drifts, and
it already did**: a hand-written demo invented the phrase "plating spent"
when the real log says "blocked", and it omitted remaining shield entirely
— so the demo was neither the game's wording nor the game's information.
This is the same class of bug already closed for `fmtDamage`, `OFFENSIVE_KINDS`
and the tier scaler's "fourth mirror" — a second copy of something the engine
already knows how to say.

## Two runs beat one

The shape that carries meaning is on/off, before/after, matching/non-matching
— **one run proves the effect exists, the pair proves what gates it.** If the
claim is "X only happens when Y", show a run where Y holds and a run where it
does not, from the identical setup otherwise. `scripts/fight.ts` and
`scripts/logFormat.ts`'s `calc` line already print the derivation per hit —
use them; never hand-compute a number the log already shows.

## Mobile-first layout

The reader is on a phone. `FIGHT_NARROW=1` reflows the same renderer's own
output — it is not a second format string, so it can never disagree with the
wide form. **One fact per line**, nothing past ~28 characters: the cast on
its own line, the hit on its own line, the derivation on its own line beneath
it. Never pack a cast+hit+derivation onto one row, and never put two runs
side by side in columns — stack them as separate labelled blocks. The same
rule applies to comparison TABLES: a short labelled list beats a wide table.

## Determinism is proved the same way — the log, twice

There are no test files in this repo (`CLAUDE.md`, "Verification is by
evidence — no test files", USER-LOCKED 2026-09-15), so the same-seed log is the
project's **only** determinism proof: same board, same seed, run twice, `diff`
the two outputs. A silent diff is the evidence; a single differing line is a
determinism break in the engine (`Date.now()`, `Math.random()`, or
`Map`/`Set` iteration order — `CLAUDE.md` "Determinism invariants"). The
worked recipe with its real silent diff is in `references/fight-recipes.md`
("Recipe: determinism"); `world1-testing` points here rather than restating it.

## It applies to disagreements too

When a claim about behaviour is challenged, the log settles it — run it
again, on/off if the dispute is about a gate, and read the `calc` line rather
than re-deriving by hand.

## References

| File | What it has |
|---|---|
| `references/fight-recipes.md` | Every `FIGHT_*` env var, verified against `scripts/fight.ts` (not trusted from prose); copy-pasteable recipes actually run on this checkout, including a worked on/off pair in mobile format and the same-seed determinism diff |
| `references/reading-a-log.md` | What each line means — cast, hit, `calc` derivation, status lines, the shield ledger, and the stalemate breakers (attrition/sudden death/fatigue) an agent will otherwise misread as a bug |

Load **`world1-handoff`** before your first edit — another agent may be
mid-pass on `scripts/fight.ts` or `scripts/logFormat.ts`.
