# docs/INDEX.md — what lives where

One owner per fact. **If two docs disagree, the owner named here wins. If a
doc disagrees with code, code wins.** Three classes:

- **LOCKED** — user decisions; change only by the user's say-so.
- **LIVING** — must match code; update in the same commit as the code change.
- **HISTORY** — append-only snapshots; accurate as of their date, never cite
  as current.

| Doc | Class | Owns |
|---|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | LIVING | Charter: stack, commands, boundary summary, agent orchestration. Mechanics/pricing live in the docs below, never restated there. |
| [`design-locked.md`](design-locked.md) | LOCKED | The dated register of every user-locked design decision, each pointing at its implementing code/spec. |
| [`architecture.md`](architecture.md) | LIVING | Layer boundaries (both rules), battle-service topology (server/ + functions/), dev workflow (dev + api), determinism invariants, resolver seam, scene-rebuild idiom. |
| [`combat-model-spec.md`](combat-model-spec.md) | LIVING | The combat turn loop: readiness, weight, multi-cast, cursor, event log, attrition. |
| [`power-level-reference.md`](power-level-reference.md) | LIVING | PL pricing *rationale*. Numbers live in `src/engine/balance.ts` (`PRICE`, `EFFECT_CAPS_DECI`, `RARITY_PL_DECI`, `TIER_BUDGET_DECI`) — the doc points, never copies. |
| [`run-structure.md`](run-structure.md) | LIVING | The endless run as built: ladder, lives, bosses, gold, shops, events, draft, leveling, `src/run` module map. |
| [`feature-inventory.md`](feature-inventory.md) | LIVING | Per-screen feature checklist, desktop + mobile — the both-platforms-rule ledger. |
| [`ui-workbook.md`](ui-workbook.md) | LIVING | UI verification practice: canvases/profiles, `?scene=` routes, layout audits, screenshot capture. |
| [`audio-design.md`](audio-design.md) | LIVING | Audio buses, the `SfxKey` event vocabulary, placeholder-synthesis → real-asset swap path, asset wishlist. |
| [`card-template-spec.md`](card-template-spec.md) | LIVING | Fantasy card template V2 geometry/assets/typography (mirrors the TS spec modules). |
| [`card-text-style-guide.md`](card-text-style-guide.md) | LIVING | Canonical card-text vocabulary and phrasing. |
| [`enemy-design.md`](enemy-design.md) | LIVING | Bronze-floor enemy authoring rule (scaling belongs to the run layer). |
| [`board-type-identity.md`](board-type-identity.md) | LIVING | Deck affinity: 3-of-a-type matchup attunement. |
| [`run-tutorial-design.md`](run-tutorial-design.md) | LIVING (planned feature) | Skippable in-fight tutorial design — not yet built. |
| [`icon-generation-prompts.md`](icon-generation-prompts.md) | LIVING (reference) | Image-generation prompt blocks for icons/card art. |
| [`art-prompt-pack.md`](art-prompt-pack.md) | LIVING (reference) | Run-layer UI asset pack: one prompt block + final file path per placeholder in `public/game-art/placeholders/` (event areas, choice icons, coin, heart, boss, storefront). |
| [`history/`](history/) | HISTORY | Everything superseded: Codex-era docs, pre-rebuild combat-ui spec, executed plans/proposals (superpowers/), pl-changelog. Each file's banner names its successor. |

Adding a doc? Give it a scope line at the top, add a row here, and make sure
no fact it states already has a different owner.
