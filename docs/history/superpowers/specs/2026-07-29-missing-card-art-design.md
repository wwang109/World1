> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Missing Card Art Design

**Date:** 2026-07-29
**Status:** Approved for implementation by the user

## Goal

Give every current card a full-card art asset while preserving the existing
Phaser card renderer, card IDs, card text, gameplay data, and the 35 existing
art mappings.

## Scope

The current skill book has 72 cards. The existing catalog covers 35, leaving 37
cards without authored art:

`twin_slash`, `ember_lash`, `cinder_dart`, `scorching_brand`,
`wildfire_surge`, `inferno_eruption`, `static_jolt`, `thunder_step`,
`chain_spark`, `overcharge`, `storm_surge`, `thorn_bite`, `verdant_touch`,
`blooming_vine`, `overgrowth`, `glacial_spike`, `frost_shackle`, `deep_freeze`,
`lance_thrust`, `braced_pike`, `piercing_reach`, `impaling_charge`,
`rapid_volley`, `piercing_arrow`, `marksman_shot`, `barrage`, `bastion_stance`,
`aegis_wall`, `sanctified_bulwark`, `fortress_bastion`, `mending_aura`,
`swift_march`, `warlord_banner`, `renewing_wave`, `vital_surge`, `void_pierce`,
`annihilation_strike`.

## Visual direction

Generate one portrait PNG per missing `skillId`, using the established Japanese/
Korean anime TCG direction: cel-shaded spell, weapon, or relic subjects; crisp
linework; saturated elemental color; bold graphic VFX; dark navy/violet
backgrounds; and a calmer darker lower third so the existing card text remains
legible. Images contain no card frame, title, labels, logos, watermark, or
rendered UI text. The subject stays readable at card-token scale, with the
primary focal element in the upper two thirds.

Family prompts keep fire, lightning, nature, frost, lance, bow, defense,
support, true-damage, and sword/beast identities coherent while the individual
card mechanics determine the focal action. Existing assets are style references
only; no existing art is overwritten.

## Integration

Save final assets under `public/game-art/cards/` using the existing kebab-case
`<skill-name>-anime.png` convention. Add one `CardArtEntry` to
`src/game/ui/cardArtCatalog.ts` per missing card. `BootScene` already loads every
catalog entry and `fantasyTemplateCardArtKey()` already resolves art by stable
skill ID, so no scene or template changes are required.

## Verification

Verify that every skill ID has exactly one catalog entry and an existing PNG,
that each new PNG is at least 840×1040 and preferably 1024×1536, and that no
existing asset was modified. Run `npm run typecheck`, `npm run build`, and
`npm test`. Record the generated file list and verification results in
`docs/codex-handoff.md`.
