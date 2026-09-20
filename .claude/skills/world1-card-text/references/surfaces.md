# Surfaces — which renderer, and where the detail lives

The per-renderer detail — who draws each string, which `KeywordTextDef` facet
it reads, the file cite and the constraint on it — is the owner doc's surface
index, and is **not** copied here:
[`docs/card-text-surfaces.md`](../../../../docs/card-text-surfaces.md) §1.

## Route by what you are about to change

| You are changing | Read |
|---|---|
| A keyword's player-facing wording | §5, then §4 for the surfaces a rename still has to chase |
| A new keyword | §4, §4.1 |
| A status name | §8.4 — and note that §8.2 lists several separate status vocabularies, only the first of which is registry-driven |
| Gem wording | §7, plus surfaces 7–9 in §1 |
| The in-game battle log | §8.1, §10.1 |
| The ASCII `npm run fight` log | §10.2, §10.6 |
| An enemy name | §9 |
| Stat names (HP, ATK, …) | §8.5, plus surface 10 in §1 |
| Why a rule exists, before you undo it | §3, §11 |
| Which renderer draws the string you are staring at | §1 |
| How the text is *drawn* (typography, geometry, glossary zones) | `docs/card-template-spec.md` — a different owner |

## The surfaces that fail silently — the short list

These are what `SKILL.md` warns about. Named here so you can grep for them;
the file cites, the verbatim code and the fix live in the owner doc.

- **`specificRule`** — `src/game/ui/cardDetailsContent.ts`. The card detail
  drawer's switch has no `assertNever`, so a kind nobody binds can render an
  **empty body**. The same file also hand-writes prose that *overrides* the
  registry for several statuses, so those have two definitions and the drawer
  shows the local one. Owner §11.7.
- **`CHIP_GLYPH`** — `src/game/battleTimeline.ts`. The battle-log status chip
  words are hand-written and do not read the registry, so a registry rename
  does not move them. Owner §8.3 for which entries disagree today.
- **The battle-log row name** — the raw engine enum capitalised inline, at
  more than one call site, plus a hand-written exception. Grep the
  `charAt(0).toUpperCase()` idiom rather than trusting a line list. Owner
  §8.2 vocabulary 2, §12.9.
- **`scripts/fight.ts` / `scripts/logFormat.ts`** — the CLI log imports
  nothing from `src/engine/keywords/`, so nothing propagates a rename into it
  and nothing checks it — only an `npm run fight` log read against the
  registry row. This is a **sanctioned** second vocabulary, not a
  violation of the no-second-renderer rule, which forbids a *new throwaway*
  log renderer. Owner §10.2; the live Shield Burst / Ward Burst drift at
  §10.4.
- **`renderGemDetailsDrawer`** — `src/game/ui/gemDetailsDrawer.ts` drops
  glossary entries by a hand-written filter regex, not a registry fact, so an
  entry can vanish from that one drawer and nowhere else. Owner §1 surface 9.

## Two detail paths, not one

Surfaces 5 and 6 in §1 — the detail **drawer** (Shop, DeckBuild) and the
detail **overlay** (Draft, RunReward, Wiki) — are independent implementations
with disjoint import graphs. The same card can read differently on each.
Check both when you change a definition.

## When a cite goes stale

Line numbers drift; grep the named symbol, not the number. Doc against doc,
the `docs/INDEX.md` owner wins. Doc against code, **the code wins** — and the
fix belongs in the owner doc, not in a correction recorded only in this skill.
