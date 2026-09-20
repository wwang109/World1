# Card text surfaces — where every player-facing string comes from

> **CLASS: LIVING.** Owns the *surface index*: which renderer draws which
> string, which registry field it reads, and what may be authored where.
> It does **not** own typography (that is
> [`card-template-spec.md`](card-template-spec.md)) or the registry's design
> rationale (that is the keyword-registry spec — see §12.3, it is untracked).
>
> Cites are `file:line` verified **2026-09-14**. Line numbers drift; the
> symbol name beside each is the durable anchor — grep that, not the number.

## 0. The one-paragraph answer

**`src/engine/keywords/text.ts` is the single source of truth for card, gem
and status keyword wording.** One row per `Action['kind']`, six fields, 36
rows. To rename a keyword's player-facing text you edit **that row and nothing
else** — every card face, badge, glossary, hover, drawer and overlay in the
game re-reads it. You do *not* need to grep `src docs scripts server
functions`.

Three places legitimately spell things their own way, and each is a place
drift has actually happened: the ASCII `npm run fight` log (§10.2), the
battle-log status chips (§8.3), and `cardDetailsContent.ts`'s hand-written
prose (§11.7). Everything else follows the registry.

---

## 1. Surface index

Twelve renderers. "Fields" are the `KeywordTextDef` facets each consumes.

| # | Player sees | Renderer | Fields | Cite | Constraints |
|---|---|---|---|---|---|
| 1 | Compact card strip (board, deck, draft, shop shelf) | `summarizeEffectSegments` → `faceTokenOf` | `faceToken` | `skillPresentation.ts:310-493`; `faceTokenOf` at `text.ts:938`, called from `skillPresentation.ts:429`; drawn by `CardToken.ts:162` (`effectFaceSegments`) | One line. **Pixel-width** truncation, not a char budget — §1.1. Hero and enemy share it (`side?: 'left'\|'right'`, `CardToken.ts:28`). Desktop/mobile differ *only* by `faceMode` (`CardToken.ts:134-136`) |
| 2 | Full illustrated card body | `renderSkillText` / `renderSkillClauses` | `faceClause` (+ `composeGroup` for order) | `compose.ts:295` / `compose.ts:189`; model `fantasyCardTemplateModel.ts:41-82` (calls at `:56`, `:62`); drawn by `FantasyCardTemplateV2.ts:690-815` (`makeBody`), markup re-parsed at `:720` | Word-wrapped, clause-aware, size-laddered per `card-template-spec.md:183-201` |
| 3 | Tapping a coloured word *on* the card | `skillKeywordEntries` + siblings | `ruleTitle`, `ruleSentence` | wired `FantasyCardTemplateV2.ts:128-177` (`addGlossaryZones`), defined in `cardGlossary.ts`; via `ruleEntriesOf` (`text.ts:977`) | Entries: `skillKeywordEntries`, `typeBadgeEntries`, `weightEntry`, `slotEntry`, `tierEntry`, `archetypeEntry`, `targetingEntry`, `propertyEntry`. Titles uppercased at draw time (§11.8) |
| 4 | Desktop whole-card hover tip | `cardHoverEntries` | `ruleTitle`, `ruleSentence` | `cardHoverEntries.ts:60-78` via `hoverTip.ts` | **USER-LOCKED 2026-09-06** (`cardHoverEntries.ts:42`): never restates the card's own numbers |
| 5 | Card detail **drawer** (Shop, DeckBuild) | `buildCardDetailsContent` | `faceClause`, `ruleTitle`, `ruleSentence` | `cardDetailsContent.ts:104-112`; `specificRule` `:28-60`; drawer `cardDetailsDrawer.ts`, tier tabs re-derive at `:157-163`, `mobile-shop` early return at `:146` | **Not compiler-exhaustive — §11.7.** Also hand-writes prose for 5 kinds |
| 6 | Card detail **overlay** (Draft, RunReward, Wiki) | `renderCardInfoBox` → `cardGlossaryEntries` | `faceClause` (whole body), `ruleTitle`, `ruleSentence` | `cardInfoBox.ts:54`, glossary loop `:158`; `cardGlossaryEntries` at `cardHoverEntries.ts:22`; overlay `cardDetailOverlay.ts:25-107` | A **second, independent** detail implementation — import graphs of 5 and 6 are disjoint. The same card can read differently on each |
| 7 | Gem chip (3 lines) | `gemChipLines` | none from `KEYWORD_TEXT`; uses `renderGemText` | `gemPresentation.ts:65-71`; `renderGemText` at `gemText.ts:171` | §7 |
| 8 | Gem hover / `GEM EFFECT` block | `gemHoverEntries` | `ruleTitle`, `ruleSentence` via `gemRuleEntries` | `gemPresentation.ts:43-49`; embedded when socketed at `cardInfoBox.ts:143-157` | **USER-LOCKED 2026-09-06** (`gemPresentation.ts:7-25`): no gem-specific prose, one reference |
| 9 | Gem details drawer | `renderGemDetailsDrawer` | same as 8, then **filtered** | `gemDetailsDrawer.ts:21`; filter regex at **`:47`** | Drops any entry matching `/\b\d*X\b\|\bPL\b\|power level\|example/i` — a hand-written filter, not a registry fact |
| 10 | Stat label hover (HP, ATK, …) | `statHoverEntry` → `statRuleByToken` → `STAT_RULE` | `STAT_RULE` (`text.ts:191`) | `statLabels.ts:74-76`; wired `RunStatPanel.ts:193`, both battle scenes **and both RunPrep scenes** | Not a per-keyword facet |
| 11 | Battle log row (main line + tap/hover detail) | `explainStatus` → `ruleEntryByKind` | `ruleSentence` **body only, no title** | `src/game/battleTimeline.ts:557-572` (note: **not** `src/game/ui/`); consumed `DesktopBattleScene.ts:624-640`, `MobileBattleScene.ts:474` | §8.1 |
| 12 | ASCII `npm run fight` log | its own renderer | **none — imports nothing from the registry** | `scripts/fight.ts:496-706`; `scripts/logFormat.ts` | **A sanctioned second vocabulary.** §10.2 |

### 1.1 Surface 1 truncation — there is no character budget

A common mistake. `segmentedLine` (`CardToken.ts:448-541`) measures **rendered
pixel width** against `entry.maxWidth`, itself computed per token from
`cardTokenSpec.ts:228-231` (token width minus padding, accessory inset and
inspect reserve). So the budget varies per card. The algorithm trims the
*tail* segment one character at a time appending `…` (`ellipsisOf`, `:470`);
if one character plus `…` still will not fit it drops the whole segment and
retries; if a segment was dropped and the survivor carries no `…` of its own,
one is appended anyway (`:511-523`) so a silent drop cannot read as "this card
has no CLEANSE". **There is no named constant to tune.**

---

## 2. The registry contract

`KeywordTextDef<K>` — `src/engine/keywords/text.ts:314-372`. One row per
`Action['kind']` through the mapped type `KeywordTextTable` (`text.ts:374`),
so a missing kind is a **`tsc` error**, not a blank card.

**36 kinds** (`KEYWORD_TEXT`, `text.ts:484-914`): setup 1, headline 5,
payload 12, selfGrant 7, conditional 11.

| Field | Cite | What it is | Consumed by |
|---|---|---|---|
| `composeGroup` | `:315`, type at `:43-53` | Which of five ordered buckets the clause lands in | 2 (ordering) |
| `displayToken` | `:328` | The `KEYWORD_TEXT_COLOR` id the **face clause** wraps in `{{…}}`. May be a *function* of the action (`exploit`, `stackBonus` key off `action.status`). `undefined` = **exemption list** (6 kinds): this kind names no keyword | 2, and the colour of every `{{…}}` |
| `faceClause` | `:336` | **This card's own numbers, nothing else.** No mechanism, ever | 2, 5, 6 |
| `ruleTitle` | `:338` | Glossary heading. `''` when there is no entry | 3, 4, 5, 6, 8 |
| `ruleSentence` | `:361` | **The one mechanism definition.** Never printed on a face; reached only by tap/hover. `''` for exactly two kinds (`damage`, `heal`) | 3, 4, 5, 6, 8, 11 |
| `faceToken` | `:371` | The compact badge (`PSN 5`, `THORN 5`) plus the colour id it tints with | 1 |

**All six are required.** There is no `?` anywhere in the interface.

### 2.1 The split this table exists for

USER-LOCKED 2026-09-06, quoted at `text.ts:15-18`:

> *"i dont think you need to state that poison happen at the end of the turn
> on card description if anything that should be said in the poison
> description"*

Parameters and mechanism are **two separate fields that are never
concatenated**. The card carries the amount (`{{Poison}} 8`); the definition
explains what the keyword does and reads identically on every card carrying it.

### 2.2 `faceToken.keyword` is NOT always `displayToken`

Two independent lookups. Authors get this wrong. The conditional riders borrow
the colour of the *resource they read* (`text.ts:363-370`):

| Kind | `displayToken` | `faceToken.keyword` | Cite |
|---|---|---|---|
| `desperation` | `undefined` | `'bleed'` | `text.ts:888-897` |
| `exploit` | `(a) => a.status === 'debuff' ? undefined : a.status` | `a.status` | `text.ts:842` |

The inverse also exists — `attunedShield`, `guard`, `negate`, `empowerNext`
and `stackBonus` carry a `displayToken` but emit **no** badge colour.

And note the **kind key is not the display word**: kind `shieldBreak` displays
as *Shatter* (`text.ts:486-497`).

### 2.3 Clause ordering

`GROUP_ORDER = ['setup','headline','payload','selfGrant','conditional']`
(`compose.ts:53`), then the aura clause (`compose.ts:283`), then cooldown and
flavor appended by `renderSkillText` (`compose.ts:295`). Within `headline`,
`HEADLINE_ORDER` (`compose.ts:59`) = damage → heal → shield → attunedShield →
statStrike, **ungated before gated** — a two-pass loop at `compose.ts:258`.

### 2.4 Markup

`src/game/ui/cardTextMarkup.ts`. Two forms:

- `{{Word}}` — display text **is** the lookup id, lowercased.
- `{{Display|id}}` — explicit id, added 2026-09-12, for when the displayed
  word and the colour/glossary id must differ, e.g. Attuned Shield's
  `{{Shield|attuned}}` (`cardTextMarkup.ts:11-18`; the fix note at
  `text.ts:586`).

Pattern `:26`, parser `:45`, consumers `stripCardTextMarkup` `:64` and
`markedKeywords` `:69`. Colours: `KEYWORD_TEXT_COLOR` `:116` (25 ids).

> **GOTCHA — the lookup id is the lowercased display word.**
> `splitMarkupToken` (`cardTextMarkup.ts:34-42`) returns
> `{ display: trimmed, id: trimmed.toLowerCase() }` for the bare form. So
> renaming a **displayed** keyword silently changes its colour/glossary id:
> `{{Poison}}` → `{{Venom}}` starts looking up `venom`, which has no
> `KEYWORD_TEXT_COLOR` entry. Either add the new id, or keep the old one with
> the pipe form — `{{Venom|poison}}`. Nothing catches the missing colour any
> more — `KEYWORD_TEXT_COLOR` is `Record<string, string>`, so the lookup
> returns `undefined` and the word renders untinted with no error (the
> reachability test that used to fail here was retired 2026-09-15). Render the
> card and read the `colour` column (§4.1).

---

## 3. Authoring rules

Each with its reason, because the reason is what stops the rule being undone.

1. **`faceClause` wraps its `displayToken` in `{{…}}`, and only that.**
   `text.ts:329-336`. *Why:* with the rule prose gone, that coloured word is
   the only thing left on the face inviting the tap that teaches the rule.
2. **`ruleSentence` is parameter-free** — no digit, no `%`, no `{{…}}`.
   `text.ts:339-361`; rationale at `:345-360`. **Nothing enforces it** since
   the test suite was retired (2026-09-15) — the field is typed `string`, so a
   digit compiles; §4.1's one-liner prints a per-row check. *Why* (user-locked
   2026-09-06):
   *"I dont think you should be explaining the amount of x debuff like poison
   8 or thorn 5 as other cards that have other amounts."* Typing it `string`
   rather than a function makes a parameterised helper a compile error.
3. **A gated clause drops the type word it would repeat.** `text.ts:70-77`.
   *Why:* `{{Affinity}} Axe — Deal 48 (+ATK) Axe damage` says "Axe" twice.
   Only `damage` and `attunedShield` print a type word; no number or stat
   suffix is ever dropped.
4. **A repeated same-kind headline says "again"/"more"** — it never invents a
   second hit. `text.ts:79-97`. *Why:* 20 authored faces used exactly those
   words; without the flag the card reads as an unrelated second attack rather
   than the same attack landing twice. Set by `compose.ts` from the card's own
   effect list, never by content.
5. **`host: 'gem'` drops exactly three host-owned terms** — the type word, the
   `(+ATK)`/`(+MDEF)` suffix, and the `physical`/`magical` property word —
   and nothing else. **Never a number, never a keyword token.**
   `text.ts:99-114`. *Why:* a gem has no property of its own. One gem, one
   sentence: standalone and socketed are byte-identical (`text.ts:111`).
   Unenforced since 2026-09-15 — compare `renderGemText(gem)`
   (`src/engine/keywords/gemText.ts`) with the socketed card's clause by hand
   (§4.1).
6. **Mergeable piles sum into ONE clause.** `poison`, `burn`, `bleed`,
   `thorns` (`MERGEABLE`, `compose.ts:69`; comment `:61-68`; merge pass
   `:94-109`). *Why:* the engine merges them into one status, so four `thorns`
   lines on `rimebarb_vigil` would print four clauses for a single pile of 14 —
   describing something the engine never does. **Ungated piles only**: a gated
   pile is a different clause that only exists on the right board.
7. **No tempo/weight clause in prose.** `compose.ts:148-161`. *Why:* the
   number is already on the face — a weight plate in `FantasyCardTemplateV2`
   and a `W{n}` badge in `CardToken`, on both platforms, on every card.
   Restating it cost 8 cards a whole text bucket when measured.
8. **Cooldown gets one sentence, only when it deviates** from
   `BASELINE_COOLDOWN`. `compose.ts:166-169`. *Why:* unlike weight there is no
   plate, badge or glossary entry for it anywhere, so this is the only place
   it can be read.
9. **Affinity is wrapped exactly once**, as a shared template.
   `compose.ts:177-180`. *Why:* affinity is not a family of keywords but a
   single modifier any action may carry — 39 raw occurrences collapse to one
   template, and it wraps the action's own bare face clause, never a rule
   sentence.
10. **Aura mod words come from `CARD_MOD_TEXT`**, never spelled locally.
    `compose.ts:126-145`.
11. **`KEYWORD_TEXT_COLOR` should clear WCAG AA 4.5:1** against both
    battle-card fills, and **keyword hue is identity** — only lightness and
    saturation may move (`cardTextMarkup.ts:99-105`, `:106-109`; the
    luminance physics at `:110-114`). Palette floor measured 2026-09-02 was
    4.50. **This is a recorded convention, not an enforced gate** — nothing
    computes a contrast ratio for these values, and since 2026-09-15 nothing
    budgets the hex count either. Re-measure by hand when you touch them.
12. **Hover and definition bodies never restate the card's own numbers.**
    `cardHoverEntries.ts:42`.

---

## 4. How to add a new keyword

Ordered. **C** = compiler-enforced (you cannot ship it broken). **S** =
silently fails (nothing will tell you).

| # | Step | File | |
|---|---|---|---|
| 1 | Add the kind to the `Action` union | `src/engine/types.ts` | **C** |
| 2 | Implement it in the sim | `src/engine/combat/` | **C** |
| 3 | Price it | `src/engine/keywords/pricing.ts` — add the term to `buildKeywordPricing`, whose return type `KeywordPricingTable` is the same mapped type. The **built** table is `KEYWORD_PRICING`, exported from `src/engine/balance.ts`, not from `pricing.ts` | **C** |
| 4 | **Add the registry row** (all six fields) | `src/engine/keywords/text.ts` → `KEYWORD_TEXT` | **C** — a missing row fails `tsc` |
| 5 | Add its colour if `displayToken` is set | `cardTextMarkup.ts` → `KEYWORD_TEXT_COLOR` | **S** since 2026-09-15 — the table is `Record<string, string>`, a missing id renders untinted; check via §4.1 |
| 6 | Decide `composeGroup`; add to `HEADLINE_ORDER` if it is a headline | `compose.ts:53,59` | **S** — it renders, just in the wrong place |
| 7 | **Bind its parameters in the detail drawer** | `cardDetailsContent.ts` `specificRule` `:28-60` | **S — THE DANGEROUS ONE, §11.7** |
| 8 | If it is a status the battle log chips, add its glyph | `battleTimeline.ts:526-529` `CHIP_GLYPH` | **S** — and already drifted, §8.3 |
| 9 | If the CLI log should name it, add a case | `scripts/fight.ts:496-706` | **S** — nothing reaches it, §10.3 |
| 10 | Render the card and read it — the step that replaced the invariant tests | §4.1's one-liner, plus `npm run fight` for the CLI log | **S** — nothing runs it for you |

Steps 1-4 cannot be skipped. **Steps 5-10 are the reason this document
exists**: nothing fails, and the defect ships.

### 4.1 What the retired reachability test used to enforce — and the check by hand

No `*.test.ts` file may exist in this repo (`CLAUDE.md`, "Verification is by
evidence — no test files", USER-LOCKED 2026-09-15). The reachability suite that
pinned the registry both ways is gone, so each of its assertions is now either
still caught by `tsc` or **silent**. Row by row:

| It asserted | Now | Check it by |
|---|---|---|
| a row for every `Action` kind and no extras, in both the text and the price table | **C** — `KeywordTextTable` (`text.ts`) and `KeywordPricingTable` (`pricing.ts`) are both `{ [K in Action['kind']]: … }` | `npm run typecheck` |
| every **non-exempt** kind wraps its own name, and that token resolves to a real colour | **S** — `KEYWORD_TEXT_COLOR` is `Record<string, string>` (`cardTextMarkup.ts`); a missing id is `undefined` and the word renders untinted | the one-liner below: `colour … -> MISSING` |
| every **exempt** kind marks up nothing, and the exempt list is closed | **S** — `MARKUP_EXEMPT_KINDS` is derived from the table; nothing pins its members | render the card; an exempt clause must carry no `{{` |
| no `faceClause` smuggles a mechanism word onto the face | **S** | read the rendered face against rule 1 (§3) |
| every `ruleSentence` has no digit, `%` or markup | **S** — the field is typed `string` | the one-liner's `digit/%/markup in rule:` column |
| the same keyword yields the same helper text on every card | **S** | render two cards carrying the kind; compare `rule` |
| engine-side `STAT_TOKEN` byte-identical to the UI-side one | **C** by construction — `src/game/ui/statLabels.ts` re-exports the registry's own object (`STAT_TOKEN = REGISTRY_STAT_TOKEN`), there is no second table | — |

Clause *order* was never covered and still is not: nothing names `GROUP_ORDER`
or `HEADLINE_ORDER`; read the rendered face.

**The check.** Call the game's own renderers on the real card. Run on this
checkout (swap the card id, tier and gem id for the ones you touched):

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

```
face  : Deal 14 (+ATK) Axe damage · Desperation 12.
badges: DMG 14 · DESPERATION 12
kind  : desperation | badge {"text":"DESPERATION 12","keyword":"bleed"} | colour (exempt) -> - | rule Desperation | Deal X more damage while at or below half HP. | digit/%/markup in rule: false
kind  : damage | badge {"text":"DMG 14"} | colour (exempt) -> - | rule (none) | (none) | digit/%/markup in rule: false
gem   : -10% enemy DEF (2t).
```

`face` is surface 2 (`renderSkillText`, `compose.ts`); `badges` is the
board/list badge line (`summarizeEffects`, `skillPresentation.ts` — loads
under `tsx` because it does not touch Phaser; `cardTextMarkup.ts` has no
imports at all). The CLI log is a separate surface (§10): prove it with
`npm run fight`.

---

## 5. How to RENAME player-facing text (worked example)

The change that prompted this document, landed 2026-09-14: **Shield Spend →
Shield Burst**, **Ward Spend → Ward Burst**.

It touched **four fields in two rows in one file** —
`src/engine/keywords/text.ts`, and nothing else in that file was dirty:

```diff
   shieldBurst: {                                     // text.ts:872
     composeGroup: 'conditional',
     displayToken: 'shield',
-    faceClause: (a) => `{{Shield}} spend (cap ${a.cap})`,
-    ruleTitle: 'Shield Spend',
-    ruleSentence: 'Spends Shield to add the same amount ...',
-    faceToken: (a) => ({ text: `SPEND SHLD ${a.cap}`, keyword: 'shield' }),
+    faceClause: (a) => `{{Shield}} burst (cap ${a.cap})`,
+    ruleTitle: 'Shield Burst',
+    ruleSentence: 'Bursts your Shield to add that much damage, up to the maximum shown.',
+    faceToken: (a) => ({ text: `SHIELD BURST ${a.cap}`, keyword: 'shield' }),
   },
```

`wardRelease` (`text.ts:880`) changed identically: `ruleTitle: 'Ward Burst'`,
face token `WARD BURST +${a.per}/CHG (cap ${a.cap})`.

**The code keys did not change.** `shieldBurst` and `wardRelease` are still
the `Action` kinds; `composeGroup`, `displayToken` and `faceToken.keyword` are
untouched. That is the intended shape of a rename: **keys are code, text is
data.**

Nothing pins it since 2026-09-15 — the golden-face and badge cases went with
the test suite. The proof is the rendered face and badge line: §4.1's
one-liner on a `shieldBurst` card must print the row's `ruleTitle` and
`faceToken` and no segment matching `SPEND`.

Surfaces 1-8, 10 and 11 picked the new wording up with **no further edits**.
**Surface 12 did not** — §10.4, a live defect at the time of writing and the
sharpest illustration of why this document exists.

**Why this rename needed no colour work.** The *displayed* markup words stayed
`{{Shield}}` and `{{Ward}}`; only the surrounding prose changed `spend` →
`burst`. Had the displayed word itself changed, §2.4's gotcha would apply and
the `KEYWORD_TEXT_COLOR` id would have moved with it.

---

## 6. Where things are NOT

To save the next grep:

- **Not** in `src/data/content/skills.v1.json` — `SkillDef.text` was deleted
  2026-09-06. Card bodies are generated from `effects`.
- **Not** in `docs/card-text-style-guide.md` — HISTORY since 2026-09-06.
- **Not** duplicated per screen. Shop, Wiki, Draft, DeckBuild and Prep are
  *call sites*, not renderers.
- **Not** in the battle playback floaters — they carry numbers and FX colour
  only, no keyword text.

---

## 7. Gem text

Gems have their own composer, `src/engine/keywords/gemText.ts`, which reuses
the **same keyword rows** through `RenderCtx.host = 'gem'` (`gemText.ts:105`).

| What | Function | Cite |
|---|---|---|
| Full gem sentence | `renderGemText` | `gemText.ts:171` |
| Clause list | `renderGemClauses` | `gemText.ts:135` |
| Definitions | `gemRuleEntries` | `gemText.ts:188` |
| Chip (3 lines) | `gemChipLines` | `gemPresentation.ts:65` |
| Hover / `GEM EFFECT` | `gemHoverEntries` | `gemPresentation.ts:43` |
| Wiki list form | `gemDefinitionsText` | `gemPresentation.ts:119` |

**The rule (USER-LOCKED 2026-09-06, `gemPresentation.ts:7-25`):** there is no
gem-specific prose. A gem reads identically standalone and socketed — the same
`'gem'` host in both cases — and its definitions are the *same* keyword
definitions the card uses. Authoring a separate sentence for a gem is the
defect, not the feature.

**Caveat:** the gem details drawer (surface 9) then *filters* those entries
with a hand-written regex (`gemDetailsDrawer.ts:47`) that drops anything
containing an unbound `X`, `PL`, "power level" or "example". A new gem
definition phrased with an `X` will silently vanish from that drawer.

---

## 8. Status text

### 8.1 The definition — registry-driven, correct

The battle log's expandable detail reads the keyword's `ruleSentence`
**body only, with no title**, through `explainStatus` → `ruleEntryByKind`
(`src/game/battleTimeline.ts:557-572`, pushed at `:2022`). Consumed by
`DesktopBattleScene.ts:624-640` and `MobileBattleScene.ts:474`. Rename the
`ruleSentence` and the battle log follows.

`explainStatus`'s switch **is compiler-exhaustive**: `kind` is
definite-assignment-checked against the 11-member `StatusName` union
(`src/engine/combat/events.ts:8`), so a 12th status fails `tsc` here.

Note `StatusName` is **not** the same set as the keyword kinds. `taunt`,
`shield`, `cleanse`, `burden`, `curse`, `slow` and `disrupt` are not statuses:
they have no chip, no `statusApplied` event and no expandable detail. Their
only battle-log text is hand-written one-off strings in `battleTimeline.ts`.

### 8.2 Status display names — FOUR vocabularies

Only the first is registry-driven. The other three are hand-written and drift
independently.

| # | Vocabulary | Source | Registry-driven? |
|---|---|---|---|
| 1 | Card face / glossary name | `ruleTitle` + the `{{…}}` token in `faceClause` (`text.ts`) | **Yes** |
| 2 | Battle-log row name | `e.status.charAt(0).toUpperCase() + slice(1)` — the raw engine enum capitalised, with a hand-written `'Stunned'` exception. **Two duplicated copies**: `battleTimeline.ts:1990` (applied) and `:2172` (wore off) | No |
| 3 | Status chip glyph | `CHIP_GLYPH`, `battleTimeline.ts:526-529` | No |
| 4 | ASCII CLI log | raw **lowercase** enum, `fight.ts:619, 624, 628` | No |

### 8.3 The chip glyphs — hand-written, and currently drifted

`CHIP_GLYPH` (`src/game/battleTimeline.ts:526-529`) is a hand-written table.
It does **not** read the registry, and three entries disagree with it today:

| Status | Chip (`battleTimeline.ts:526-529`) | Registry `STATUS_TOKEN` (`text.ts:415-426`) |
|---|---|---|
| stun | `STN` | `STUN` |
| expose | `EXP` | `EXPOSE` |
| thorns | `THR` | `THORNS` |

Two spellings of one status, chip against registry — **not** three. The card
badge is not a third vocabulary: every status `faceToken` interpolates
`STATUS_TOKEN` rather than spelling the word itself (`stun` `text.ts:721`,
`expose` `:741`, `thorns` `:799`), so the badge can only ever agree with the
registry. `poison`, `burn` and `bleed` agree everywhere — the chip spells all
three out in full, exactly as the registry does. If you find prose claiming
the chip abbreviates them (`PSN`/`BRN`/`BLD`), or that the registry spells
thorns `THORN` singular, that prose is stale: re-read both tables.
**Renaming a status in the registry will not move the chip.** Two further
hand-built tokens live beside it: `guardToken` / `negateToken`
(`battleTimeline.ts:585-600`) re-derive the `P.GUARD` / `P.NEGATE` property
prefix that `KEYWORD_TEXT.guard.faceToken` already computes.

Burden and curse are not chips at all — they land **on the card**: the curse
marker at `CardToken.ts:297`, burden folded into the weight badge at `:369`.

### 8.4 Renaming a status — the real recipe

| # | File | Enforcement |
|---|---|---|
| 1 | `text.ts` — the row's `ruleTitle` | **C** that the row exists; the string itself unchecked |
| 2 | `text.ts` — the `{{…}}` token in `faceClause`, plus any *other* row's `ruleSentence` that names the status in prose (e.g. `ward` names "poison, burn, bleed" at `text.ts:782`) | **S** for the prose |
| 3 | `cardTextMarkup.ts:116` — the colour id, if the displayed word changed (§2.4) | **S** since 2026-09-15 (was **T**) — §4.1 |
| 4 | `battleStatusPalette.ts:24`/`:57` — chip/HP-bar tint keys, in lockstep | **S** since 2026-09-15 (was **T**) |
| 5 | `battleTimeline.ts:1990` **and `:2172`** — the log row name, two copies | **S** |
| 6 | `battleTimeline.ts:526-529` — the chip glyph | **S** — the partial literal pins that once covered some glyphs went with the test suite |
| 7 | `scripts/fight.ts:619, 624, 628` — the CLI log | **S** |

**C** compiler · **S** silent · **T** (pinned by a test) retired 2026-09-15
with the suite — every former **T** is now **S**. Do **not** look for
`CHIP_KIND_ORDER` — it is named in five comments but defined nowhere; chip
order is the statement sequence inside `buildChips`
(`battleTimeline.ts:1120-1146`).

### 8.5 Stat names

`STAT_TOKEN` / `STAT_LONG_NAME` / `STAT_RULE` (`text.ts:146`, `:158`, `:191`),
ordered by `STAT_KEYS` (`text.ts:131`). The UI-side table is the registry's
own object re-exported (`src/game/ui/statLabels.ts`,
`STAT_TOKEN = REGISTRY_STAT_TOKEN`), so the two cannot differ. Buff and
debuff chips are the one chip family that *is* registry-driven — they read
`STAT_TOKEN` (`battleTimeline.ts:1092`).

---

## 9. Enemy text

| What | Authored in | Notes |
|---|---|---|
| Enemy names, stats, boards | **`src/data/enemies.ts`** (`export const enemies`, `:50`) | **The live source of truth.** `EnemyDef.name` at `src/engine/types.ts:1609` |
| `src/data/content/enemies.v1.json` | **GENERATED, and not even loaded** | Written by `npm run content:export` (`package.json:19`). The loader `enemyBookFromJson` exists but is deliberately unwired (`src/data/enemiesContent.ts:23`, "NOT WIRED UP YET, on purpose"). Parity is re-established by re-running `npm run content:export`; nothing enforces it since 2026-09-15 — `npm run content:validate` checks the JSON's shape, not its parity with `enemies.ts` |
| Enemy descriptions / flavour | **none exist** | `EnemyDef` has no description field. The JSON's `notes` is dev-facing rationale, never rendered |
| Enemy card text | — | **No enemy-specific path.** Enemy cards are surface 1 (`CardToken`) **only** — `side: 'right'` is layout-only (mirrors x, flips the art gradient and the NEXT badge), with no text branch. They never reach `FantasyCardTemplateV2` or either detail path, because enemy cards carry no inspect affordance |
| Enemy "title" | `ENEMY_TITLES` (`src/run/encounter.ts:95`) | The 4-value difficulty enum `mob/normal/elite/boss`, not a name. It reaches the screen as `.toUpperCase()` with two hand-written exceptions: `standard` renders **MEDIUM** and `boss` renders **MINIBOSS** in the roster chip (`runTravelChoiceViewModel.ts:55-58`, `:107`) |
| Elite affix chips | `src/data/modifiers.ts` — `name` (e.g. `BRACED`) and `answer` (the counterplay sentence) | Player-facing. Rendered via `affixPresentation.ts`; the old hand-written `blurb` was deliberately deleted in favour of the granted card's generated face (`affixPresentation.ts:38`) |
| Growth / threat / tier labels | hand-written in `src/game/ui/runTravelChoiceViewModel.ts`, `RunBossArrivalPanel.ts`, `demoState.ts:141-148` | No registry; no enemy-label table |

**To rename an enemy:** edit `src/data/enemies.ts`, re-run
`npm run content:export`, commit **both**. There is no third file — every UI
surface reads `enemies[id].name` at render time. A longer name is silently
**truncated** by `boundedText`, not rejected.

---

## 10. Combat log wording

### 10.1 The in-game battle log — registry-driven

Surface 11, covered in §8.1. This one follows the registry.

### 10.2 The ASCII `npm run fight` log — a sanctioned second vocabulary

`scripts/fight.ts` and `scripts/logFormat.ts` **import nothing from
`src/engine/keywords/`** (verified 2026-09-14). They have their own vocabulary:

- The event-row switch, `scripts/fight.ts:496-706`.
- The damage ledger, `scripts/logFormat.ts:61-77` — labels `STAT`, `BONUS`,
  `DEF`, `MIN`, `AFFINITY`, `RAMP`, `GUARD`, `EXPOSE`, `BLOCK`.
- The affinity tag, `fmtAffinity` (`logFormat.ts:44`).

This is **allowed**. `CLAUDE.md`'s no-second-renderer rule forbids
hand-writing a *new* log renderer for a demo; it does not forbid the CLI's
established vocabulary. `FIGHT_NARROW=1` is likewise safe: it is a **reflow of
this renderer's own output** (`fight.ts:441-447`, implemented by
monkey-patching `console.log` at `:449-481`), not a parallel set of format
strings — so every line a future keyword adds is narrow-formatted for free.

**What is NOT allowed** is inventing a third rendering in a throwaway script.
Show logs with `npm run fight`.

### 10.3 The coupling is a comment, and nothing enforces it

`logFormat.ts:37` asserts in prose:

> `VOCABULARY MATCHES THE CARD FACE.`

**Nothing enforces it.** Before 2026-09-15 the closest cases checked only that
`fmtAffinity` contained the literal word `"affinity"` and that the damage
ledger's arithmetic closed — never the wording. Those cases went with the
test suite; the ledger's closure is now proved by reading the `calc` line and
diffing two same-seed runs (`world1-combat-log`).

So: **changing registry wording does not propagate to the CLI log, and nothing
will tell you** — run `npm run fight` and read the line against the registry
row.

### 10.4 Live proof — the Shield Burst rename, right now

The rename in §5 landed in the registry. The CLI log was not updated:

| Surface | Says |
|---|---|
| Registry `ruleTitle` (`text.ts:876`) | **Shield Burst** |
| Registry `faceToken` (`text.ts:878`) | **`SHLD BURST 12`** (rendered by §4.1's one-liner on `aegis_charge`) |
| CLI log (`fight.ts:677`) | `spends its own shield −N -> M (burst into the hit)` |
| CLI log (`fight.ts:560`) | `N shield spent` |
| CLI log (`fight.ts:687`) | `releases N ward charge(s) into the hit` — registry now says **Ward Burst** |

This drift opened during the very session this document was written. It is
listed rather than fixed because `scripts/fight.ts` is owned by another task;
see §12.2.

### 10.5 A second uncovered ledger

The **heal** ledger is still inline in the CLI (`scripts/fight.ts:585-599`,
labels `ARMOR`/`MRES`, `AURA`, `RIDER`, `ANTIHEAL`, `OVERHEAL`). The damage
ledger was extracted to `logFormat.ts` precisely so it could be reached
outside the CLI (originally by a test, retired 2026-09-15)
(`logFormat.ts:4-14`); the heal ledger never moved, so it retains the exact
import-time-CLI unreachability that let the 2026-08-21 bug survive.

### 10.6 Useful invocation

`scripts/fight.ts` takes the whole board from env, so any matchup is a real
invocation (`FIGHT_NARROW=1` is the mobile format):

```
FIGHT_NARROW=1 \
FIGHT_HERO_BOARD=aegis_charge@bronze \
FIGHT_FOE_BOARD=sword_slash \
FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 \
npm run fight -- bandit_duelist 5
```

Accepted env vars: `FIGHT_EXTRA_CARDS` (`:53`), `FIGHT_EXTRA_ENEMY` (`:93`),
`FIGHT_ENEMY_LEVEL` (`:137`), `FIGHT_HERO_BOARD` (`:246`), `FIGHT_FOE_SLOTS`
(`:277`), `FIGHT_FOE_BOARD` (`:297`), `FIGHT_HERO_HP` (`:344`),
`FIGHT_HERO_STATS` / `FIGHT_FOE_STATS` (via `withStatOverrides`, `:321-340` —
it **exits 1 on an unknown stat name**, so a typo is refused), `FIGHT_NARROW`
(`:449`). Board entries accept `id`, `id@tier` and `id#gem`.

---

## 11. Failure modes — why every rule above exists

1. **`attunedShield` printed an EMPTY clause on every card face for ~5 days**
   (introduced 2026-08-25, fixed 2026-08-30 — `text.ts:8-11` records the
   episode). A non-exhaustive switch in `summarizeEffectSegments` had no
   `case` for it, and no compile error. *This is the defect the mapped type
   now makes impossible.* (A related but **distinct** defect, often conflated
   with it, was `plainKeywordEntry`'s `default: return undefined` in
   `cardGlossary.ts` — two switches, two files.)
2. **12 of 36 kinds shipped with no phrase at all** (`text.ts:10`); `guard`
   (30 authored actions), `negate` (10) and `shield` (57) had colours **no
   card ever wrapped**, and `taunt`'s badge was never tinted
   (found by the reachability audit, since retired). Same root cause.
3. **Token collision, 2026-09-12.** Moving Attuned Shield's `displayToken` to
   `'shield'` collided with three other kinds, so tapping it would have opened
   *plain* Shield's glossary. Fixed by the explicit-id markup
   `{{Shield|attuned}}` (`text.ts:573-593`; the fix sentence at `:586`).
4. **`attunedShieldLabel` was hand-synced across two files** until a
   2026-09-12 audit consolidated it (`text.ts:466-482`,
   `skillPresentation.ts:404-419`).
5. **Aura mod wording drifted** — the face said `deal +6` while the gem chip
   and badge said `+6 damage` for the identical mod — until both were routed
   through `CARD_MOD_TEXT` (`compose.ts:126-145`).
6. **`fmtDamage` summed to LESS than its printed total on 206 of 2208 audited
   hits**, missing `exposeBonus` (`logFormat.ts:16-20`). The game-side strip
   had a test and was fixed; this renderer had none and stayed wrong. That
   asymmetry is why `logFormat.ts` exists as a separate module.
7. **`cardDetailsContent.ts` is NOT compiler-exhaustive.** `specificRule`
   (`:28-60`) is a hand-written switch over ~25 kinds with **no
   `assertNever`**. Its default branch, verbatim at **`:52`**:

   ```ts
   default: return /\bX\b|2X/.test(rule) ? '' : rule;
   ```

   **Keyword #37 will silently render an EMPTY body in the card detail drawer
   instead of failing the build.** Two more silent-drop paths sit in the same
   file: `:57` (`slots.length !== parameters.length` → `''`) and `:91` (the
   consumer re-runs the same regex). The file also hand-writes prose that
   *overrides* the registry for `shield` (`:35`), `poison`, `burn`, `bleed`
   and `thorns` (`:40-43`) — so those five statuses have two definitions, and
   the drawer shows the local one.
8. **Glossary titles are uppercased at draw time in seven independent places**
   (`FantasyCardTemplateV2.ts:192`, `hoverTip.ts:127`, `cardInfoBox.ts:149`/
   `:154`/`:161`, `cardDetailsDrawer.ts:98`, `gemDetailsDrawer.ts:52`,
   `gemPresentation.ts:122`, `cardDetailOverlay.ts:60`). The casing you write
   in `ruleTitle` is never what a player sees.

---

## 12. Known open issues (flagged, not fixed)

1. **The CHIP_GLYPH drift** (§8.3) — `stun`, `expose` and `thorns` are
   abbreviated on the battle-log chip and spelled out in the registry.
2. **The Shield Burst / Ward Burst CLI drift** (§10.4) — live in the tree.
3. **Seven `docs/INDEX.md` rows point at files nobody can clone.**
   `docs/INDEX.md:29, 33, 34, 35, 36, 37, 38, 39` name `docs/superpowers/**`
   docs as LIVING owners, but `/docs/superpowers/` is gitignored and **zero of
   those files are tracked** (`git ls-files docs/superpowers/` → empty). This
   includes the keyword-registry design spec, which `docs/INDEX.md:34` names
   as the owner of the registry's rationale — the "why" doc this document
   defers to. On a fresh clone it does not exist.
4. **`/docs/superpowers/` is duplicated in `.gitignore`** (two identical rules).
5. **`card-text-style-guide.md:24-32` still reads as live authoring
   instruction** despite its own HISTORY banner at line 3.
6. **Two stale counts in `text.ts` comments**: `:38` says "six ordered
   buckets" but `ComposeGroup` has five (aura is appended outside
   `GROUP_ORDER`); `:917` says "eight kinds" but `MARKUP_EXEMPT_KINDS` derives
   to seven. Do not quote either number.
7. **`CHIP_KIND_ORDER` does not exist.** It is referenced only in comments
   (`battleTimeline.ts:299`, `:1097`, `battleHpBlockLayout.ts:154`) but is
   defined nowhere.
8. **Stale comment at `battleTimeline.ts:550`** claims poison/burn/bleed
   return `undefined` from `explainStatus`; the code at `:559-561` maps them
   to real kinds with non-empty bodies, so DoTs *do* get an expandable detail.
9. **The battle-log row name is duplicated** — the same
   `charAt(0).toUpperCase()` idiom at `battleTimeline.ts:1990` and `:2172`.

---

## 13. See also

- [`card-template-spec.md`](card-template-spec.md) — **LIVING.** Typography
  ladder, geometry, glossary-zone layout, `{{keyword}}` markup rendering for
  `FantasyCardTemplateV2`. Owns *how text is drawn*; this doc owns *where text
  comes from*. (It already reaches `renderCardInfoBox` at `:263` and
  `KEYWORD_TEXT_COLOR` at `:280-284`; it never mentions `CardToken`, either
  detail path, gem surfaces, or either log.)
- [`card-text-style-guide.md`](card-text-style-guide.md) — **HISTORY.** The
  retired authored-card-text vocabulary. **Not superseded by this doc**: it
  records a different axis — wording choices and the drift that retired them,
  kept for the rationale. Do not author against it.
- `docs/superpowers/specs/2026-09-06-keyword-registry-design.md` — the
  registry's design rationale. **Untracked; see §12.3.**
- `src/engine/keywords/text.ts` — when this doc and the code disagree, the
  code wins.
