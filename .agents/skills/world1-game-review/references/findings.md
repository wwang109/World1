# Reporting a review

## Report the review

Lead with the highest-impact evidence. Separate:

- **Observed defect**: reproducible current failure
- **Design gap**: current behavior conflicts with a locked or owner document
- **Quality opportunity**: improvement with no violated requirement
- **Unknown**: insufficient evidence; name the check that would resolve it

For each actionable finding include:

1. affected surface and platform
2. concrete evidence or reproduction route
3. user impact
4. likely owner file or subsystem
5. recommended change and verification bar
6. confidence and remaining uncertainty

Do not turn preferences into defects. Rank findings by player impact, breadth,
and change risk rather than by how easy they are to fix.

Follow the three status buckets and compact closing summary required by
`CLAUDE.md`.

## Completion bar for a review

A review is complete when every conclusion is traceable to current evidence
and the scope is explicit.

See `references/review-procedure.md` for when a prepared change is complete,
and `references/art-pipeline.md` for when an art task is complete.
