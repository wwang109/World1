# Playable battle passive examples

These four development examples demonstrate the shared engine → API → combat-log/presentation contract. They are sample definitions, not shipped talents/relics or approved balance content. Names and magnitudes are illustrative.

| Example ID | Sample source | Condition and effect |
|---|---|---|
| `quick_preparation` | [talent] Quick Preparation | Chosen attack card: [card] Sword Slash in Slot 3, WT 10 → 7. |
| `guardians_seal` | [relic] Guardian's Seal | Requires a defensive card on board; starting physical shield 0 → 8. |
| `fortified_position` | [talent] Fortified Position | Defensive card in the chosen slot: [card] Iron Bulwark in Slot 5, shield power 48 → 53. |
| `guardians_seal_inactive` | [relic] Guardian's Seal | No defensive card on board; no opening shield grant. |

The normal sample board is [card] Sword Slash (Slot 1), [card] War Banner (Slot 2), [card] Sword Slash (Slot 3), [card] Second Wind (Slot 4), and [card] Iron Bulwark (Slots 5–6). The inactive example replaces [card] Iron Bulwark with [card] Sword Slash. Every example uses hero level 1, no allocated stats, [enemy] Bandit Duelist level 1/normal/rank 0, and seed 5 by default.

## Open the examples

The current local example UI is at `http://127.0.0.1:5174`, with `VITE_BATTLE_API=http://localhost:8788` pointing to its development API. Responsive launch uses `?battleExample=ID`; explicit paired scene links are below. These links require the local development processes to be running.

| Example | Desktop | Mobile |
|---|---|---|
| [talent] Quick Preparation | [Open](http://127.0.0.1:5174/?scene=desktop-battle&battleExample=quick_preparation) | [Open](http://127.0.0.1:5174/?scene=mbattle&battleExample=quick_preparation) |
| [relic] Guardian's Seal | [Open](http://127.0.0.1:5174/?scene=desktop-battle&battleExample=guardians_seal) | [Open](http://127.0.0.1:5174/?scene=mbattle&battleExample=guardians_seal) |
| [talent] Fortified Position | [Open](http://127.0.0.1:5174/?scene=desktop-battle&battleExample=fortified_position) | [Open](http://127.0.0.1:5174/?scene=mbattle&battleExample=fortified_position) |
| [relic] Guardian's Seal — inactive | [Open](http://127.0.0.1:5174/?scene=desktop-battle&battleExample=guardians_seal_inactive) | [Open](http://127.0.0.1:5174/?scene=mbattle&battleExample=guardians_seal_inactive) |

## Canonical data and API

`src/data/content/examples/battle-passives.examples.v1.json` owns the versioned sample source catalog, source names, board descriptors, selected bindings, and trusted card-reference mappings. `src/data/battlePassiveExamples.ts` exports immutable UI-safe descriptors and `buildBattlePassiveExample(id, seed?)`. It has no runtime battle-resolver/simulator dependency. Both development UI launch and the server derive their setup from this same data.

The local development server exposes **POST `/battle-example`**, accepting only:

```json
{ "exampleId": "quick_preparation", "seed": 5 }
```

The server resolves a registered ID through the canonical descriptor and calls the normal `resolveBattle(request, preparation)` with its trusted source catalog and card-reference map. Responses are ordinary `BattleLog` objects containing generated `preBattleEffect` receipts and real combat events. Unknown IDs, extra fields/effect payloads, and invalid seeds are rejected. The endpoint is disabled when `NODE_ENV=production`; production `functions/battle.ts` remains unchanged.

Full request/response snapshots for all four examples are in [`examples/battle-passives/`](examples/battle-passives/), generated at seed 5 by the real resolver. Each response was resolved twice and compared for determinism. Generated source labels use trusted catalog `displayName`; clients cannot inject display names through source references.

## Player-facing contract

The opening notice presents a named source, its condition or chosen card/slot, and the actual change. Compact combat-log rows use the canonical before/after formatter; expanded details retain full requirements and structured receipts. The unit-only opening shield has no card targets/highlights. Inactive Guardian's Seal explicitly says **“No defensive card on board.”**

Structured IDs/coordinates remain available for API consumers, while visible slots are one-based and target names come from the resolved card definitions. Runtime animation reads these receipts; it does not reevaluate conditions, mutate the board, or infer effect amounts from prose.

Verified evidence: the focused passive audit passed 19 checks; all four real resolver responses were compared twice at seed 5; all four examples have real `npm run fight` on/off logs and byte-identical repeated on logs under `tmp/battle-passives-examples-evidence/`. Normal fight output remains byte-identical to `tmp/battle-passives-evidence/before-1.log`. The shared `prepareBattleConfig` reconstruction is used by both API and CLI examples.

CLI reproduction: set `FIGHT_PASSIVE_EXAMPLE=quick_preparation` and `FIGHT_NARROW=1`, then run `npm run fight -- bandit_duelist 5`. Set `FIGHT_PASSIVE_EXAMPLE_EFFECTS=off` for the same-board control; substitute another registered example ID as needed. Actual log evidence includes selected [card] Sword Slash payment **weight 7**, opening **+8 physical shield**, and [card] Iron Bulwark authored shield power **48→53**; the inactive example logs its missing defensive-card requirement and no opening grant.

Desktop/mobile captures and live HTTP checks are reproduced by `npx tsx scripts/battle-passive-examples-screen-audit.ts`, using the actual development endpoint without browser interception. UI visual acceptance remains separate from technical checks.
