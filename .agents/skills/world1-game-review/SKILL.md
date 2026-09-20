---
name: world1-game-review
description: Use when reviewing the World1 game, assessing its current quality or change readiness, planning game changes, finding missing or placeholder visual assets, or generating and integrating World1 artwork.
---

# World1 Game Review

Review the game from current evidence, turn findings into change-ready work,
and complete requested art gaps without violating World1's architecture or
asset pipeline.

## Core rule

Treat code and a freshly running build as the current game. Use the owner map
in `docs/INDEX.md` to interpret intent. Never infer the current experience from
historical documents or old screenshots.

This skill supports review and preparation by default. Do not change code or
generate assets unless the user asks for those actions. A request to review is
not authorization to implement every finding.

Check `git status` before working. Preserve unrelated user changes and do not
rewrite or clean the worktree as part of a review.

## When to use this

- Assessing current quality, change readiness, or "what does X actually do"
  for any surface (combat, run flow, UI, content).
- Planning a game change before implementation starts.
- Hunting for missing, broken, or still-placeholder visual assets.
- Generating or integrating new World1 artwork end to end.

Any claim about a card, keyword, status, or combat rule still leads with a
real `npm run fight` log, per `CLAUDE.md` — this skill does not relax that.
This checkout may have no `node_modules/.bin`, in which case `npm run fight`
fails to resolve; `world1-combat-log`'s `references/fight-recipes.md` gives
the direct `node node_modules/tsx/dist/cli.mjs scripts/fight.ts <enemySpec>
[seed]` form verified against this checkout.

## References

| File | What it has |
|---|---|
| `references/review-procedure.md` | Establishing current context, choosing review depth (focused/flow/game), building an evidence set for mechanics, UI/play flow, and technical health, and turning a finding into a preparable change slice |
| `references/findings.md` | The four finding categories, the required fields per finding, and the completion bar for a review |
| `references/art-pipeline.md` | The master/derivative art pipeline, the missing-image classification categories, and the generate-and-integrate workflow, verified against `docs/card-template-spec.md` §4.1 and the real `art-src/` / `public/game-art/` layout |

Owner docs the references point into rather than fork: `docs/INDEX.md`
(ownership map), `docs/ui-workbook.md` (routes and capture recipe),
`docs/card-template-spec.md` (art pipeline and geometry authority),
`docs/icon-generation-prompts.md` / `docs/art-prompt-pack.md` (prompt
contracts). When a doc and the code disagree, the code wins.
