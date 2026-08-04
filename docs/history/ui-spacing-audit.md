> **HISTORICAL** — accurate as of its date; superseded by `docs/ui-workbook.md`. Never cite as current. The 720×1280 / `?view=` capture profile it assumes is gone.

# UI Spacing Audit

Run this check after changing any button, chip, tab, modal, or compact control.

## Automatic control guard

Reusable Prep controls call `auditControlLabel`. It guarantees at least 8px
horizontal and 5px vertical label clearance by default, reducing the label by
1px steps when needed. Each result is stored on the control as
`controlLayoutAudit`.

Open an affected view with `layoutAudit=1`, for example:

```text
http://127.0.0.1:4174/?view=wiki&layoutAudit=1
```

A remaining violation receives a red outline and emits a `[layout-audit]`
console error. Treat either as a failed UI check.

## Visual review

Capture every changed state at 720x1280, including open sheets and populated
states. Check all of the following before handoff:

- No label touches or visually crowds a border.
- Adjacent controls have at least 8px of visible separation.
- Button labels remain readable; do not solve crowding below 8px type.
- Text does not overlap icons, values, cards, or neighboring controls.
- Long labels work in both inactive and selected states.
- Touch targets remain clear even when their visible control is compact.

Prefer widening the control or shortening its label over shrinking type. Record
the audited screenshots and console result in `docs/codex-handoff.md`.
