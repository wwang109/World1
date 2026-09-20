# Adding (or renaming) a keyword — how to read the checklist

The ordered checklist is **not** reproduced here. It lives in the owner doc,
[`docs/card-text-surfaces.md`](../../../../docs/card-text-surfaces.md), and a
second copy would drift the moment a step's file moves:

| You want | Read |
|---|---|
| The ordered steps, file by file, each marked compiler-enforced or silent | §4 |
| What the retired reachability test used to enforce, and the by-hand check for each row | §4.1 |
| A worked rename, with the real diff | §5 |
| The authoring rules, each with the reason that stops it being undone | §3 |
| Gem wording rules | §3 rule 5, §7 |

## What this skill adds to §4

**Where the danger is.** Only the early steps cannot ship broken — a missing
kind, a missing price term or a missing registry row all fail `tsc` (both
`KeywordTextTable` and `KeywordPricingTable` are mapped over
`Action['kind']`). Everything after that is silent. A missing colour used to
fail a reachability test; that test is gone with the rest of the suite
(`CLAUDE.md`, "Verification is by evidence — no test files", 2026-09-15), so
a missing `KEYWORD_TEXT_COLOR` id, a digit in a `ruleSentence`, a mechanism
word on a face, clause ordering, the detail drawer's parameter binding, the
battle-log chip glyph and the CLI log all have no compile error and nothing
else either. That is the entire reason the owner doc exists, and the reason to
read §4 to the bottom rather than stopping when `tsc` goes green.

## Render it — the check that replaces the test

Call the game's own renderers on the real card and read the output. This is
the same route a prior task used to prove the `desperation` face change on
`cornered_beast@bronze`; the owner doc §4.1 carries it as the check for each
row the retired test used to assert. Run on this checkout:

```bash
node node_modules/tsx/dist/cli.mjs -e '
import { skillBook } from "./src/data/skills";
import { gemBook } from "./src/data/gems";
import { applyTier } from "./src/engine/cards";
import { renderSkillText, renderCtxOf } from "./src/engine/keywords/compose";
import { renderGemText } from "./src/engine/keywords/gemText";
import { faceTokenOf, displayTokenOf, ruleTitleOf, ruleSentenceOf } from "./src/engine/keywords/text";
import { KEYWORD_TEXT_COLOR } from "./src/game/ui/cardTextMarkup";
import { summarizeEffects } from "./src/game/ui/skillPresentation";
const def = applyTier(skillBook["cornered_beast"]!, "bronze");
console.log("face  :", renderSkillText(def));
console.log("badges:", summarizeEffects(def));
const ctx = renderCtxOf(def);
for (const a of def.effects) {
  const tok = displayTokenOf(a);
  console.log("kind  :", a.kind, "| badge", JSON.stringify(faceTokenOf(a, ctx)), "| colour", tok ?? "(exempt)", "->", tok ? KEYWORD_TEXT_COLOR[tok] ?? "MISSING" : "-", "| rule", ruleTitleOf(a) || "(none)", "|", ruleSentenceOf(a) || "(none)", "| digit/%/markup in rule:", /\d|%|\{\{/.test(ruleSentenceOf(a)));
}
console.log("gem   :", renderGemText(gemBook["armor_break_echo"]!));
'
```

Real output:

```
face  : Deal 14 (+ATK) Axe damage · Desperation 12.
badges: DMG 14 · DESPERATION 12
kind  : desperation | badge {"text":"DESPERATION 12","keyword":"bleed"} | colour (exempt) -> - | rule Desperation | Deal X more damage while at or below half HP. | digit/%/markup in rule: false
kind  : damage | badge {"text":"DMG 14"} | colour (exempt) -> - | rule (none) | (none) | digit/%/markup in rule: false
gem   : -10% enemy DEF (2t).
```

Swap the card id, tier and gem id for the ones you touched. What each column
proves: `face` is surface 2's text (`renderSkillText`, `compose.ts`);
`badges` is the board/list badge line (`summarizeEffects`,
`src/game/ui/skillPresentation.ts` — importable from `tsx` because it does
not touch Phaser); `colour ... -> MISSING` is the silent missing-colour bug
the retired test caught; `digit/%/markup in rule: true` is a `ruleSentence`
breaking rule 2; `gem` must read byte-identical to the socketed card's clause
(`resolveDisplaySkill`, `src/engine/cards.ts`). `src/game/ui/cardTextMarkup.ts`
has no imports at all, so `KEYWORD_TEXT_COLOR` loads outside a browser.
Log wording is a separate surface: prove it with `npm run fight`.

**The worst one.** `specificRule` in `src/game/ui/cardDetailsContent.ts` is a
hand-written switch with no `assertNever`. A kind nobody binds there does not
throw — it can render an **empty body** in the card detail drawer. Owner
§11.7 quotes the default arm verbatim.

**A rename is not exempt.** The keys (`Action['kind']` values such as
`shieldBurst`) are code; only the strings inside a row are data, so a pure
text rename stays inside `text.ts`. But every surface that hand-writes its own
copy of the wording still needs the same downstream check as a brand-new
keyword. The 2026-09-14 Shield Burst rename is the worked case: owner §5, and
the part of it that never reached the CLI log at §10.4.

## Before you author — the locks

- A gem is not a special case: gems reuse the same registry rows via
  `host: 'gem'`. One gem, one sentence, byte-identical standalone and
  socketed. Never write gem-specific prose (**user-locked 2026-09-06**).
- Hover and definition bodies never restate the card's own numbers
  (**user-locked 2026-09-06**).
- Enemy names live in `src/data/enemies.ts`. `src/data/content/enemies.v1.json`
  is generated by `npm run content:export` and is not hand-edited; owner §9.
- Any claim about what the new keyword *does* leads with an `npm run fight`
  log, never a hand-written rendering (`CLAUDE.md`, and the `world1-combat-log`
  skill).

## When a cite goes stale

Line numbers in the owner doc drift. Grep the named symbol, never the number.
When the doc and the code disagree, **the code wins** — fix the doc in the
same pass rather than recording the correction only here — a correction
that lives only in a skill leaves the owner doc wrong for everyone who reads
it instead, which is exactly how the chip-glyph table stayed stale.
