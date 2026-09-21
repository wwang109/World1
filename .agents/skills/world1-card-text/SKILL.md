---
name: world1-card-text
description: Use before authoring or renaming any player-facing card, gem, status or enemy text in World1, before adding a keyword, and before changing combat-log wording. Says where every string actually lives so you do not grep seven directories to rename one word - the keyword registry is the single source of truth, and the references name every renderer that reads it, which steps the compiler catches, and which fail silently.
---

# World1 card text — read this before you grep

## The 60-second version

**`src/engine/keywords/text.ts` is the single source of truth** for card, gem
and status keyword wording. One row per `Action['kind']`.

**To rename a keyword's player-facing text, edit that row and nothing else.**
Every card face, badge, glossary, hover, drawer and overlay re-reads it. The
2026-09-14 Shield Spend → **Shield Burst** rename was four fields in two rows
in one file; most surfaces followed with no further edits — see
`references/surfaces.md` for which ones did not.

The fields on a row, and the split that matters:

- `faceClause` — **this card's own numbers.** Never a mechanism.
- `ruleSentence` — **the one mechanism definition.** Never printed on a face;
  reached only by tap/hover. Parameter-free by design: no digit, no `%`, no
  markup — and **nothing enforces that**: the field is typed `string`, so a
  digit compiles. Read the row before you ship it.
- `ruleTitle` — the glossary heading for that sentence.
- `faceToken` — the compact badge, plus the colour id it tints with. That
  colour id is **not always** `displayToken`; they are two independent lookups.
- `displayToken` — the colour/glossary id the face clause wraps in `{{…}}`.
  `undefined` means "this kind names no keyword".
- `composeGroup` — which ordered bucket the clause prints in. The buckets
  are `GROUP_ORDER` in `compose.ts`; the aura clause is appended outside it.
  Do not quote a bucket count — `text.ts`'s own comment already states a
  stale one (owner doc §12.6).

**Naming an entity in chat, a report or a brief is a card-text surface too**
(`CLAUDE.md`, "Tag every game entity by kind", USER-LOCKED 2026-09-16): first
mention carries the kind tag and the display `name` — `[card] Hibernation`,
`[gem] Ember Sliver`, `[enemy] Bandit Duelist`, `[status] Poison`,
`[keyword] Negate`, `[event] Abandoned Cache` — never the bare snake_case id,
which looks the same for every kind. Where each kind's registry lives: cards
`src/data/content/skills.v1.json`, gems `gems.v1.json`, enemies
`enemies.v1.json`, events `events*.json` (display field `title`), statuses
and keywords the `ruleTitle` rows in `src/engine/keywords/text.ts`.

## Routing — which function renders each card-text surface

**A full answer about a card has FOUR parts: the authored config, plus three
renders of it.** "What does [card] X show?" is answered by running code,
never by a screenshot and never by hand-writing the sentence. Every render
surface below is a pure, Phaser-free function of a `SkillDef` — printable
under `npx tsx` in seconds (`CLAUDE.md`, "What a card shows — read the model,
never screenshot it"). A screenshot proves layout (overlap, truncation,
spacing, art loading, theming); it does not prove text.

| Surface | Function | File |
|---|---|---|
| **Authored config** — the editable truth every row below is derived from: `id`, `name`, `archetypes`, `property`, `weapon`/`element`, `size`, `rarity`, `tier`, `effects`, `tierUpgrades` | direct field access, no render function — this IS `def` | `src/data/content/skills.v1.json`, loaded via `skillBook` (`src/data/skills.ts`) |
| Face body (one line, the generated description) | `renderSkillText(skill)` | `src/engine/keywords/compose.ts` — no authored `text` field exists; it is generated from `effects` |
| Face clauses (the same, unjoined) | `renderSkillClauses(skill)` | same file |
| Full card face (shop, wiki, reward, detail preview): `title`, `body`, type badge, `archetypes`, `weight`, `slotLabel`, `slotBoxCount`, `tier`, `skin`, `titleRule`, `bodyRule` | `buildFantasyCardTemplateModel(skill, {width, height, tier})` | `src/game/ui/fantasyCardTemplateModel.ts` — region geometry `fantasyCardTemplateSpec.ts` (`FANTASY_CARD_TEMPLATE_SPEC.regions`, base 420×690); rendered by `FantasyCardTemplateV2.ts` |
| Board token face (deck-build, draft, board column — name / effect segments / affinity `TYPE n/3`) | `summarizeEffectSegments(skill, stats, mode, affinityOpen)` | `src/game/ui/skillPresentation.ts` — layout `cardTokenSpec.ts`, rendered by `CardToken.ts` |
| Details drawer (the ⓘ panel with keyword rule sentences) | `buildCardDetailsContent(skill, {gem})` | `src/game/ui/cardDetailsContent.ts` — layout `cardDetailsLayout.ts`, host `cardDetailsDrawer.ts` / `cardDetailOverlay.ts` |
| Keyword rule title + sentence (what a keyword MEANS) | `ruleTitleOf` / `ruleSentenceOf` / `faceClauseOf` / `faceTokenOf` | `src/engine/keywords/text.ts` |

**Desktop and mobile show the same strings.** Both platforms instantiate the
same `FantasyCardTemplateV2` and the same `CardToken`; only `width`/`height`
differ. The one content-visible consequence of the narrower mobile width is
`CardToken`'s `segmentedLine` ellipsising or dropping a trailing effects
segment — the invariant `npm run audit:cardface` guards. So "what does it
show on mobile" is answered from the model plus that one width
consideration, not a screenshot.

**`notes` is excluded from the config by default.** It is the one sanctioned
home for authored design rationale (`CLAUDE.md`, "Comments: code says WHAT,
the task summary says WHY") and routinely runs 20–40 lines — say it exists,
quote it only on request. Report the MECHANICAL config (the field list
above) by default.

**`tierUpgrades` is part of the config, not an extra.** Report the full tier
ladder (per/cap/power per tier) as a compact table — a card's Bronze numbers
alone mislead about what it becomes at Silver/Gold/Diamond.

Throwaway recipe (`tmp/` or the scratchpad only — delete after; never
`scripts/` or `src/`), all four parts for one card id in one run. A heredoc
into a `tmp/` file, not a multi-line `npx tsx -e` string — the latter gets
mangled crossing the Windows `npx.cmd` shim:

```bash
cat > tmp/report-card.ts <<'EOF'
import { skillBook } from "../src/data/skills";
import { buildFantasyCardTemplateModel } from "../src/game/ui/fantasyCardTemplateModel";
import { summarizeEffectSegments } from "../src/game/ui/skillPresentation";
import { buildCardDetailsContent } from "../src/game/ui/cardDetailsContent";
const def = skillBook["deadweight_toll"];
const { notes, ...config } = def as any;
console.log("1 CONFIG", JSON.stringify(config, null, 2));
console.log("2 FACE body", buildFantasyCardTemplateModel(def, { width: 420, height: 690, tier: "bronze" }).body);
console.log("3 TOKEN", JSON.stringify(summarizeEffectSegments(def, undefined, "board", false)));
console.log("4 DRAWER", JSON.stringify(buildCardDetailsContent(def, {}), null, 2));
EOF
npx tsx tmp/report-card.ts
rm tmp/report-card.ts
```

[card] Deadweight Toll's tier ladder, read straight off `effects` (Bronze)
and `tierUpgrades` (Silver/Gold/Diamond) — verified against
`src/data/content/skills.v1.json`:

| Tier | per | cap | damage |
|---|---|---|---|
| Bronze | 4 | 16 | 12 |
| Silver | 5 | 20 | 20 |
| Gold | 6 | 24 | 28 |
| Diamond | 7 | 28 | 36 |

## What the compiler catches, and what nothing catches

There are no test files in this repo (`CLAUDE.md`, "Verification is by
evidence — no test files", USER-LOCKED 2026-09-15). The reachability suite that
used to catch a missing colour, a digit in a `ruleSentence` or a mechanism word
on a face is gone, so those are now **silent**. Honest split:

**Caught by `tsc`:** a missing or extra registry row — `KeywordTextTable` is
`{ [K in Action['kind']]: KeywordTextDef<K> }` (`src/engine/keywords/text.ts`)
— and a missing price row — `KeywordPricingTable` is the same mapped type
(`src/engine/keywords/pricing.ts`), built into `KEYWORD_PRICING` in
`src/engine/balance.ts`. The engine-side and UI-side `STAT_TOKEN` cannot
drift either: `src/game/ui/statLabels.ts` re-exports the registry's object.

**Caught by nothing — ship broken with no error:** a `displayToken` with no
`KEYWORD_TEXT_COLOR` entry (`Record<string, string>`,
`src/game/ui/cardTextMarkup.ts` — the lookup returns `undefined` and the word
renders untinted); a `ruleSentence` carrying a digit, `%` or `{{…}}`; a
`faceClause` smuggling a mechanism word; clause order (`GROUP_ORDER`,
`HEADLINE_ORDER`); gem text differing standalone vs socketed; plus the
pre-existing silent surfaces — `cardDetailsContent.ts`'s hand-written switch
with no `assertNever`, the battle-log status chips' hand-written glyph table,
and the ASCII `npm run fight` log's own vocabulary, which imports nothing from
the registry. Which surface is which, and the owner-doc section carrying its
file cites and its fix: `references/surfaces.md`.

**The evidence that replaces the test:** render the card with the game's own
functions and read what comes out — the `tsx` one-liner in
`references/add-a-keyword.md` (owner doc §4.1) — and show log wording with
`npm run fight` (`world1-combat-log`).

## References

| File | What it has |
|---|---|
| `references/keyword-registry.md` | Every `Action['kind']` row's `faceToken`, `displayToken` and `composeGroup`, pre-gripped from `text.ts` — answers "what does kind X render as" without opening the file |
| `references/surfaces.md` | Routes you from what you are changing to the owner-doc section that answers it, and names the surfaces that fail silently so you can grep them |
| `references/add-a-keyword.md` | How to read the owner doc's checklist: which steps the compiler covers, which ship broken in silence, the render one-liner that stands in for the retired reachability test, and the locks that bind before you author |
| [`docs/card-text-surfaces.md`](../../../docs/card-text-surfaces.md) | **Owner doc.** Full authoring rules with the reason behind each, the worked rename example, and every recorded failure mode. The references above route into it rather than restating it — when a reference disagrees with this doc, this doc wins; when it disagrees with the code, the code wins |

Typography and card geometry are owned separately by
`docs/card-template-spec.md`. `docs/card-text-style-guide.md` is HISTORY — do
not author against it. When a doc and the code disagree, the code wins.
