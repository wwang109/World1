# Game copy guide

**Scope: player-facing wording and visual explanation.** This guide owns plain-language style for descriptions, choices, requirements, rewards, and effect notices. It does not define mechanics, balance, or layouts. [Card text surfaces](card-text-surfaces.md) owns string sources and generated card text; [design locks](design-locked.md) take precedence. Examples below illustrate wording, not approved content or implemented acquisition flows.

## Write the rule the player needs

Use familiar words and concrete actions. State the target, the change, and the timing. Include a requirement only when it changes whether the effect applies.

- Target: a card, a slot, your shield, or a reward choice.
- Change: reduce WT, gain shield, increase healing, or add an option.
- Timing: when acquired, at battle start, when played, or until battle ends.

Use one short sentence per rule. Use a second sentence for a necessary exception. Prefer “Choose a card. It gets WT −3 in combat.” over a sentence that combines selection, eligibility, persistence, and engine processing.

Use the game's existing stat labels and keyword definitions. Do not invent a new synonym for a familiar mechanic. Do not replace a precise rule with a vague promise such as “improves combat.”

## Show the effect before explaining it

The main display should contain:

1. The talent, relic, or equipment icon and name.
2. The target card image or highlighted board slot.
3. The stat/effect icon and a short value: `WT −3`, `Shield +5`, or `10 → 7`.
4. A short requirement or failure reason, when needed.

Use existing game icons. An unfamiliar icon needs a short label or tap/hover explanation. Do not rely on color alone. On mobile, tapping must reveal the same explanation as desktop hover.

Show an actual value change only when it is known. A proposed bonus is `WT −3`; an applied result can be `WT 10 → 7`. An inactive effect must not look like a granted reward. Dim its icon and show the reason.

Keep longer rules in details or tooltips. Icons support meaning; they do not replace important timing, requirements, or numbers.

## Talent and relic targeting

**Player decision: choose the target when the talent is unlocked or the relic is acquired.** Save that choice. Do not describe this as a choice before every battle.

| Moment | Short copy | Visual |
|---|---|---|
| Acquire an effect targeting a card | Choose an attack card | Eligible card images; selected card highlighted |
| Acquire an effect targeting a slot | Choose a slot | Board with eligible slots highlighted |
| Show a saved card target | Chosen card | Card image and name |
| Show a saved slot target | Slot 5 | Highlighted slot |
| Explain a card target | This effect follows the chosen card when you move it. | Card image with selection mark |
| Explain a slot target | This effect applies to eligible cards in the chosen slot. | Slot highlight |

At battle start, explain the result of the saved choice. Do not ask the player to choose again. If the chosen card is unavailable, say “Chosen card is not on the board.” Do not silently assign a different target.

Acquisition targeting and its saved state are intended feature behavior. The existing development battles use predefined choices; this guide does not claim a live acquisition picker exists.

## Wording examples

These are sample descriptions, separate from the game's generated keyword definitions.

| Avoid | Use |
|---|---|
| Selected active card; anchor Slot 3 | Chosen card · Slot 3 |
| Defensive card starting in selected Slot 5 | Defensive cards in Slot 5 gain +5 shield power. |
| Board: 1+ defensive cards | Requires a defensive card on your board. |
| Conditions unmet | No defensive card on your board. |
| Target unavailable | Chosen card is not on the board. |
| Authored action power 48→53 | Shield power 48 → 53 |
| Grants an extra card | Adds 1 option to card rewards. Choose 1 card. |
| Enemy provides armor | Armor drop chance. |

The shorter slot wording is valid only if any eligible card occupying that slot qualifies. If the rule checks the card's starting slot, say “Defensive cards starting in Slot 5 gain +5 shield power.” Never hide that distinction to shorten the copy.

## Compact text and details

| Surface | What belongs there |
|---|---|
| Card face or effect badge | Existing keyword/stat token and value; follow the canonical generator |
| Acquisition choice | Selection prompt and effect; highlight eligible targets |
| Talent/relic details | Target, effect, timing, requirement, and saved choice |
| Battle notice | Source icon, target image/slot, applied change or failure reason |
| Combat log | What actually happened, with source and target available in details |
| Loot source panel | “Drops from” with enemy/location/event images and names; chance wording, never a guarantee |

Use exact amounts when they are part of the rule. Distinguish “shield” from “shield power,” and “reward options” from “cards received.” Say “until battle ends” for a temporary effect; do not imply a permanent card upgrade.

Player-facing text must not contain internal IDs, fixture names, API fields, engine terms such as “anchor,” or implementation explanations. Technical reports still use kind tags and display names as required by `CLAUDE.md`.

## Before publishing a description

- Can the player tell what changes, which target it affects, and when?
- Does the wording match the actual rule, including starting-slot versus occupied-slot checks?
- Does the acquisition prompt happen at the correct time?
- Is a saved card choice clearly different from a saved slot choice?
- Do icons, highlights, numbers, and text describe the same result?
- Does an inactive effect explain why, without suggesting it was granted?
- Are desktop and mobile explanations consistent?
- Is text generated from the canonical definition rather than duplicated in a scene?
- Is proposed wording clearly separated from verified behavior?

Use the existing card-text, combat-log, and screen evidence workflows when changing the game. This document alone does not verify behavior or visual acceptance.
