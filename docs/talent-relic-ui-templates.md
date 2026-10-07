# Talent and relic UI templates

These are design templates and a standalone interaction prototype, not a production talent/relic picker. [skill-tree-plan.md](skill-tree-plan.md) owns talent acquisition/target behavior; [relics-plan.md](relics-plan.md) owns relic acquisition/target behavior; [battle-passives-plan.md](battle-passives-plan.md) owns implemented engine contracts. [game-copy-guide.md](game-copy-guide.md) owns player-facing wording.

## Acquisition preview

The prototype is [`mockups/talent-relic-targeting.html`](mockups/talent-relic-targeting.html). Open it in a browser or through the development server at `/docs/mockups/talent-relic-targeting.html`. Its three views demonstrate:

- Unlock [talent] Quick Preparation: choose an attack card; preview **WT −3**, then confirm or cancel.
- Acquire [relic] Windbound Charm: choose a slot; eligible attack cards in that slot receive **WT −3**, with separate relic icon/motion.
- Effects: inspect saved targets, source icons, activation/inactive state, and the resulting change; there is no repeated pre-battle picker.

These magnitudes are illustrative. [talent] Fortified Position (shield power +5) and [relic] Guardian's Seal (automatic starting physical shield +8) are optional template examples, not new production sources. The prototype does not modify run saves, owned cards, the authoritative battle API, or the playable example catalog. [battle-passives-examples.md](battle-passives-examples.md) separately owns executable engine/API demonstrations.

## Copyable JSON

[`templates/passive-presentation.v1.template.json`](templates/passive-presentation.v1.template.json) is a **draft presentation manifest**. A separate `mechanicalExamples` envelope uses supported recipe fields; presentation entries are keyed by source kind/id/version and reference reserved source icons, semantic effect icons, attach/activation motion IDs, inactive treatment, tap-details behavior, and reduced-motion fallback. The entire document is not an accepted engine/API payload.

[`templates/passive-target-bindings.v1.template.json`](templates/passive-target-bindings.v1.template.json) is a **draft saved-selection format**. It illustrates confirmed choices recorded at `talentUnlock` or `relicAcquisition`, a stable owned card reference or zero-based slot, and a future adapter's existing `preBattle` reference/binding output. Only the current engine envelope is compatible; saved-state metadata requires future acquisition/persistence/ownership adapters.

Source `displayName` belongs to the trusted definition, not the request. The future adapter validates pinned source/effect references and ownership, maps an owned card reference to a portable battle `pieceRef`, and supplies the trusted anchor/reference mapping. Selected-slot examples explicitly use `match: 'occupies'`: any eligible card covering that cell qualifies, including a multi-cell card, once. The engine still consumes saved selections through its current recipe/binding contract. No automatic retargeting or selection before every battle is implied by these templates.

Draft picker policy: a slot choice may name **any valid board coordinate**, including an empty slot or a slot occupied by a currently ineligible card. Save the coordinate; check the occupant's effect eligibility during battle preparation and show an inactive reason until it qualifies. A card picker instead requires an eligible owned instance. This prototype policy is separate from production source-specific targeting restrictions and does not permit out-of-board coordinates.

## Per-source visuals

| Sample source | Reserved visual | Motion style |
|---|---|---|
| [talent] Quick Preparation | Cyan wings | Wing sweep toward the chosen card |
| [relic] Windbound Charm | Orange wind spiral | Spiral toward the chosen slot |
| [talent] Fortified Position | Blue bastion | Emblem settles, then pulses on activation |
| [relic] Guardian's Seal | Gold seal | Emblem settles, then pulses beside shield gain |

The shared WT/shield icons describe the mechanic; the source icon identifies the individual talent or relic. Sources sharing WT reduction can have different visuals and motion. Presentation lookup is data-driven by source identity and never adds item-ID branches to engine behavior. Missing custom motion uses a family fallback; reduced motion uses static source/target/change indicators. Inactive treatment dims the source icon and adds an inactive overlay while retaining the source's identity. All IDs are reserved registry references, not claims that matching art files exist.

Attach motion accompanies confirmed acquisition/target selection; activation motion accompanies an actual engine receipt. Replay/scrubbing must preserve receipt state without consuming or resetting benefits. Desktop and mobile show the same saved target and rule, with tap details providing mobile parity with hover. This document does not finalize talent budgets, relic limits, respec policy, production assets, or animation timing.

Verification for these artifacts is JSON parsing and source/effect/presentation-reference alignment. The standalone prototype's screenshots are visual evidence, separate from production UI implementation and user acceptance.
