# Relics Implementation Plan

Scope: proposed run-scoped relic rules for combat, loot chances, event card rewards, economy, and exploration. No relic catalog, runtime effects, acquisition, or screens are implemented by this document. Equipment remains owned by [equipment-system.md](equipment-system.md); equipment acquisition remains owned by [enemy-equipment-drops-plan.md](enemy-equipment-drops-plan.md).

[Battle passive preparation and runtime plan](battle-passives-plan.md) owns the proposed shared battle pipeline, preparation/runtime condition split, modifier order, and logged startup hooks. This document owns relic content/acquisition proposals and points to that pipeline rather than defining a second order.

**Goal:** Give players passive rule choices that shape a run beyond card builds and equipment stats.

**Architecture:** Versioned relic JSON and planned talent-node JSON use the same typed behavior registry for validation, generated descriptions, effect order, stacking, and trigger-use rules. Relic acquisition and talent selection remain separate; combat receives combined generic modifiers, while run transactions apply economy/event effects through shared preview-and-commit functions.

**Tech stack:** TypeScript, JSON content, existing `Rng`/`hashSeed`, run/save modules, battle-service twins, paired Phaser presentation.

**Spec:** This proposal, [design-locked.md](design-locked.md), [run-structure.md](run-structure.md), [event-chains-proposal.md](event-chains-proposal.md), and the user's request for combat/event/general-gameplay relics. Item names and example magnitudes below are illustrative, not approved content or prices.

## Proposed player rules

- Relics are run-scoped passives in a separate collection; they consume none of the Armor, Accessory, or Charm slots.
- Recommend acquired relics remain active for the run. Start with unique relic IDs, no duplicate stacks, ranks, sockets, or equip swapping. Whether there is an active-relic limit is still a user decision; do not implement an arbitrary cap.
- Recommend combat relics first arrive through a small guaranteed choice offer at milestone boss rewards. Event rules can improve eligible card rewards as well as event/run economy. Offer size, boss cadence, starting relics, rarity, and enemy relic drops are undecided. Reuse persisted offers; refreshing never rerolls them.
- Relics change explicit rules, rather than inventing attacks or replacing card weapon/magic identity. Requirements can reward a card family or a player decision, but never count bag cards or equipment as active board cards.
- Relics may modify the equipment drop chance, but an eligible battle still makes exactly one equipment chance roll and grants at most one equipment item. Relics cannot add a reroll, extra roll, or second equipment award. Base chance and modifier magnitudes remain undecided.

## Illustrative directions

| Proposed relic | Category | Rule direction | First delivery |
|---|---|---|---|
| [relic] Opening Ward | Combat | Begin each battle with a small typed shield. | A generic setup modifier, with a real battle-log event; no relic-specific loop branch. |
| [relic] Mender's Seal | Combat | Amplify direct card healing when a healing-card requirement is met. | Shared healing-modifier seam, preserving anti-heal and HP clamping. |
| [relic] Fortune Compass | Loot | Increase equipment drop chance by an authored basis-point amount. | Modify the one battle gate; still at most one equipment item. |
| [relic] Archivist's Lens | Event rewards | Add one eligible card candidate to an existing event card offer; the player still chooses one. | Recommended first card-bonus rule, with all candidates persisted together. |
| [relic] Patient Coin | Economy | Gain a small additional gold amount on a won encounter. | One persisted victory settlement; never income for losing. |
| [relic] Salvager's Lens | Events | Turn an authored equipment/card offer's unavailable-pool fallback into a small gold reward. | Only a validated existing fallback point, once per event transaction. |
| [relic] Pilgrim's Token | Events | Reduce one positive event gold toll per region by a small flat amount. | Shared effective-cost preview/commit, with a persisted region-use key. |
| [relic] Trail Compass | Exploration | Show a spoiler-safe next-fight threat forecast sooner. | Existing forecast facts, with no extra encounter roll or map-choice change. |

These directions are not claims about current behavior. Shield type, magnitudes, requirements, one-use reset unit, and pool eligibility must be authored and validated before implementation. For [relic] Salvager's Lens, equipment offers do not yet exist in the live event schema; first implementation can support only explicitly authored current card fallbacks. Future per-cast/low-HP retaliation relics are a separate phase because they need dynamic generic trigger support and loop-order evidence.

## Registry and JSON contract

**Create:** `src/data/content/relics.v1.json`, `src/engine/relics/types.ts`, `src/engine/relics/registry.ts`, `src/engine/relics/text.ts`, `src/engine/relics/resolve.ts`, `src/data/validateRelicContent.ts`, `src/data/relicsContent.ts`.

Talents are chosen progression with points, prerequisites, and branch choices; relics are acquired run passives. They may grant the same rule, so implement that rule once. Proposed shared pure behavior types, validation/text metadata, and combat modifier combination live under `src/engine/passives/`; pure event/economy/usage transaction helpers live in `src/run/passiveTransactions.ts`. The engine helpers cannot import run state. Relic/talent registry and resolver modules are source-specific adapters over these shared contracts, not competing behavior implementations. Neither the combat loop nor run transactions branch on relic or talent IDs.

Every contribution carries its source kind, pinned ID/version, instance/node reference, and effect index. The shared behavior contract decides trigger order, additive/exclusive stacking, requirements, authoring bounds, and use scope. Usage keys also include source identity and transaction/reset scope so a talent and relic cannot consume each other's uses or fire the same persisted contribution twice. Identical effects from different sources combine only as their one shared contract specifies.

Use the existing `{ schemaVersion, relics: [{ id, versions: [{ version, def }] }] }` envelope convention. A definition carries `name`, optional authoring `notes`, offer eligibility, and typed effects. Owned references pin `{ instanceId, relicId, relicVersion }`; historical definitions remain loadable. Names are authored; rule descriptions are generated, never duplicated on card faces, event rewards, inventory, and hover surfaces.

Illustrative authoring fragment for [relic] Patient Coin; the amount is provisional:

```json
{
  "id": "patient_coin",
  "versions": [{
    "version": 1,
    "def": {
      "name": "Patient Coin",
      "offerEligibility": { "sourceKinds": ["bossChoice"] },
      "effects": [{ "trigger": "battleVictory", "kind": "grantGold", "amount": 1, "oncePer": "encounter" }]
    }
  }]
}
```

Initial trigger vocabulary should remain closed: `battleSetup`, `directCardHeal`, `equipmentLootChance`, `battleVictory`, `eventCardReward`, `eventCost`, `eventFallback`, and `travelPreview`. Each typed effect has its own allowed trigger, integer parameters, optional requirement, scope, and optional `oncePer` contract. Never add stringly typed hooks that silently skip unknown effects.

Registry entries supply:

- Parameter/requirement validation and legal trigger/scope combinations.
- One compact clause and one rule description generated from parameters.
- Pure modifier or transaction contribution; no registry function imports Phaser, storage, network, or `src/game`.
- Authoring bounds and pricing status. Combat contributions need a relic PL budget/pricer based on existing named rates; economy/forecast contributions need separate pacing limits, not a fabricated PL conversion. Unpriced definitions cannot be called balanced.

**Proposed interfaces:** `resolveRelics(refs, context, catalog): RelicResolution` produces typed stat/heal/setup contributions, event/economy adjustments, and provenance for descriptions. `describeRelic(def): RelicDescription` uses only the registry. `effectiveRelicEventCost(baseCost, adjustments): number` is used by both affordability preview and commit. `applyRelicTransaction(state, transaction): RunState` records each eligible once-use and grant atomically with its source receipt.

## Ordering, stacking, and limits

- Pin active references before committing a battle/event. Later relic acquisition affects subsequent transactions, never a result already materialized.
- Iterate each relic catalog in canonical `(relicId, relicVersion, instanceId)` order; combine talent/relic contributions in the shared registry's canonical trigger and source order. Sum compatible flat bonuses and percentage modifiers before flooring once at the named seam. A shared behavior entry must state whether its percentages are additive or multiplicative; start additive, with no implicit compounding.
- Stat contributions from allocations, purchased stats, talents, equipment, relics, and gems fold through the single preparation calculation in [battle-passives-plan.md](battle-passives-plan.md). Apply no modifier twice between preview and service.
- For direct healing, collect compatible equipment/talent/relic outgoing contributions, sum them, and apply the outgoing modifier exactly once on the resolved direct-heal amount, then retain existing receiver anti-heal and HP clamping. The talent/relic adapters must not separately call a healing amplifier after the combined amount has been modified. Do not extend the bonus to lifesteal/drain/regeneration unless explicitly authored and priced. TRUE healing keeps the locked anti-heal exception.
- Static board-family/slot conditions resolve during preparation. Startup contributions execute once through the shared logged initialization seam before turn progression. Dynamic conditions such as low HP or first eligible cast use compiled generic hooks at explicit runtime seams, not per-turn scans of every relic/talent. Preserve first-to-fall: no post-killing-blow retaliation, repeated proc cascade, or recursive trigger activation. Loot chance and event reward conditions remain pure run-layer transaction rules rather than battle-loop hooks.
- Relic authoring bounds and trigger-use limits do not clamp existing card/gem/status runtime stacking. Preserve the locked authored-effect ordering, attrition, affinity thresholds, readiness/cooldown rules, and loss/lives rules.
- Prices remain integers and never negative. A paid event toll adjustment cannot change life costs, hide requirements, fabricate affordability, or turn a locked choice into an eligible one. Shop depth scaling, fixed sell-back, and base daily income remain as built; any future discount is an explicit resolved-price adjustment, never an edit to those constants.

## Proposed card changes and slot conditions

Relics and talents may share typed `appendCardAction`, `transformCardAction`, and `effectiveCardTier` behaviors, gated by card-family/slot predicates. These are exploratory mechanics requiring an approved effect/price contract. Recommend **while-active derived changes** first: moving the card, losing the condition, or removing the passive restores its original resolved skill. Do not mutate `skills.v1.json`, owned card definitions, or persistent tier to implement them.

Illustrative directions: [relic] Ember Script appends a priced [keyword] Burn action to a qualifying card anchored at the first slot; [relic] Runic Lens changes an existing base direct-heal action's authored magnitude; [relic] Vanguard Seal temporarily resolves a qualifying card at its next supported authored tier; [relic] Kinship Knot adds an effect only when the host touches another qualifying card's footprint. Magnitudes, exact actions, target predicates, and whether a permanent variant is desired remain undecided. A condition gates the new passive effect, not whether the underlying card can be placed or cast.

The board is linear: `BoardPiece.slot` in `src/engine/types.ts` is the zero-based leftmost anchor; a size-N card occupies `[slot, slot + size)`, validated by `src/engine/combat/state.ts`. Display SLOT 1 means index 0. Define distinct typed `anchorSlot`, `occupiesSlot`, and `touchingCardFamily` predicates; never infer grid rows or a front/back row. Default exact-slot rules test the anchor. An occupies-slot rule is explicit and counts a qualifying card once even if it covers several selected cells. Adjacency means occupied ranges touch at one edge, with no wrap from last slot to first; empty gaps break adjacency. The same pure predicate result supplies active/inactive text and the exact numbered slot in preview, details, and battle setup.

**Proposed shared interface:** `resolvePassiveCardEffects(def, piece, boardContext, sources): PassiveCardTransformPlan` in `src/engine/passives/` returns source-pinned tier/action contributions plus condition results. The board context is pure input describing anchors, immutable footprints, and existing family fields; evaluate predicates on that original context to avoid recursive eligibility changes. Relic/talent adapters only produce contributions. No per-ID combat branches or separate UI-only calculations.

**Pipeline owner:** [battle-passives-plan.md](battle-passives-plan.md) defines the proposed preparation sequence around `applyTier`/`resolveEffectiveSkill` in `src/engine/cards.ts`, including exactly one gem fold, whole-kit rider/splash validation, and the prepared-form boundary. Its order remains subject to effect/pricing approval. Only supported authored tiers may be selected, respecting tier locks and unchanged card-tier PL budgets; price the incremental passive transformation separately. Initial transforms do not retype cards or change their footprint, card size, weight, or cooldown. Preserve the three-card affinity threshold and canonical keyword descriptions. Empty-passive inputs retain existing output.

Appended passive actions need distinct pinned talent/relic provenance, not counterfeit `fromGem` flags. Define their hit/stat-bonus sharing semantics and price before activation; existing gem provenance, cast-phase placement, and splash suppression remain intact. Generate face/hover/detail/live text from the same derived definition used by combat, retaining each source in the details. Permanent upgrade/replacement is a separate proposed event transaction: show and confirm one target/result, validate existing tier/capacity rules, and persist the chosen mutation once. It is not an automatic reward mutation or another delivered card. The approved card-offer bonus still provides more candidates and awards exactly one card.

### Player-selected card or slot

User decision: choose a relic's card/slot target when the relic is acquired, then save that choice. Do not ask again before every battle. Card targets follow the owned instance when moved; slot targets retain their coordinate. Acquisition UI/persistence are still planned; relic limits, pricing, and lifecycle rules remain separate.

Each effect definition declares a typed `targetBinding` mode: `automatic` applies its authored predicate without a picker; `playerCard` requires the player to choose one eligible owned card instance; `playerSlot` requires choosing one valid board coordinate. Default eligible targets are existing active-board cards only, filtered by the definition's family/property/action-compatibility rules. [relic] Runic Lens could use `playerCard`; [relic] Vanguard Seal could use `playerSlot`. These modes are proposed contracts, not implemented defaults. A picker highlights eligible targets and previews the exact derived skill/slot condition; **Confirm** saves the binding and **Cancel** leaves it unchanged. Never silently auto-select a target. A required but unassigned/invalid binding makes that effect inactive with a reason and selection prompt, not the whole battle unavailable unless a separately approved contract requires that.

Card bindings use `RunCard.instanceId` from `src/run/runState.ts`, not `skillId`: two copies are independent choices. The selected instance follows movement between board coordinates, but a move can disable other slot predicates. Moving it to the bag makes an active-board-only effect inactive; selling/removing it invalidates the reference and prompts reselection. Slot bindings stay at their zero-based coordinate and apply to a future eligible occupant; an empty/ineligible slot is inactive. Each slot definition explicitly chooses anchor matching or the single card occupying that cell, plus whether binding an initially empty coordinate is permitted; do not infer that permission globally. Use the multisize/count-once rules above. Out-of-bounds coordinates and unsupported partial/multiple selections are rejected, never filled automatically.

Retarget only between battles and outside unresolved event transactions. Changing a target must never reset source-based once-use counters or farm a consumed benefit. Persist the source definition/version, effect index, selected instance/coordinate, and binding revision alongside the existing source-use record. Pin that recipe when a battle/event commits; later target edits cannot change a pending result. This selects an existing target, grants no card, and is separate from the event reward's expanded candidate selection and exactly-one-card claim.

`BoardPiece` in `src/engine/types.ts` currently has no instance ID. The future request protocol needs an opaque `pieceRef` mapping from validated owned run instances to submitted battle pieces before a `playerCard` binding can be resolved reliably. The service validates that each selected reference maps to exactly one submitted piece, plus eligible filters and action compatibility against the canonical recipe; never trust a client-authored resolved target/effect payload or substitute a catalog ID for ownership. Structural mapping alone does not prove ownership under the current client-owned run trust boundary. Ghost/share serialization must preserve the binding through explicit instance/token remapping, or reject an unsupported build. Preparation/runtime ordering and binding validation before compilation remain owned by [battle-passives-plan.md](battle-passives-plan.md).

## Loot chance and event card bonuses

For [relic] Fortune Compass, a proposed effect fragment is `{"trigger":"equipmentLootChance","kind":"addEquipmentChanceBps","amountBps":500,"scope":"eligibleBattle","oncePer":"encounter"}`. The example increase is provisional, not a default. At the shared loot transaction, sum eligible talent/relic basis-point contributions once and compute `effectiveChanceBps = min(10000, max(0, baseChanceBps + sum))`. Validate all terms as safe integers; 100 basis points mean one percentage point. Clamp only this probability, never existing card/gem/status stacks. At both 0 and 10000, consume the one gate draw and keep the same result boundary. If the gate succeeds and the eligible merged pool is nonempty, perform one weighted pick; an empty pool returns no equipment, with no retry or substitute award. Pack participants share one receipt and the existing union/deduplication policy. Its loot RNG remains independent of combat, event, map, and shop streams; persist effective chance, source recipe, and result so refresh cannot reroll or spend uses twice. The base chance remains a required future balance decision.

For [relic] Archivist's Lens, use typed `eventCardReward/addCardCandidates` contributions scoped to explicitly eligible authored card-offer rewards. Combine compatible talent/relic contributions before materialization, apply a validated offer-width limit, and generate the exact adjusted offer/description from the same model. Adding a card candidate does not add an event decision: events still have 2–3 choices; the selected reward's separate card picker can show more candidates with paired scrolling/layout. Current `eventCardChoiceV3`/`settleEventCardChoiceV3` in `src/run/eventV3Rewards.ts`, pending/settled `EventDeferredOfferV3` tuples in `src/run/eventV3Materialization.ts`, and `isEventDeferredOffer` in `src/meta/runSave.ts` require three candidates. Update the complete materializer/settlement/save/UI contract together, preserving historical triples during migration. Additional candidates are distinct eligible instances drawn in a dedicated event-reward substream, obey the original filter, seeded/clamped tier policy, offerable tiers, and capstone authorization, and remain pinned in the persisted offer. Do not invent new event sources, automatically upgrade a tier, change card PL budgets, or introduce a new reward-amount/quality lottery. The guaranteed category remains cards; preserve the existing tier policy rather than pretending current card tiers are fixed.

**Selected card-reward contract:** expand the candidate selection; the player still chooses and receives exactly one card. Keep the existing one-card insertion/capacity/fallback path. Persist the expanded offer and its single selected result together so reloading neither rerolls the candidates nor grants another card. Record pinned source kind/version/effect index and event receipt/reset keys in the shared talent/relic usage contract; previews show the exact committed selection bonus without consuming uses.

Keep the existing first three card candidates and their tier decisions byte-identical. Draw only bonus candidates from the separate substream, excluding IDs already selected, and apply the existing seeded/clamped tier policy to those additions. If too few eligible distinct candidates remain, add only those available and show the exact count; never duplicate a card candidate, widen its filter, or reroll the base offer to fill space.

The card-offer bonus never promotes reward tiers. A separately approved while-active `effectiveCardTier` effect changes the chosen card's combat resolution only while its own condition holds; it does not alter reward generation or permanently upgrade ownership.

## Events, previews, and determinism

`src/run/eventPreview.ts` currently selects via `rollEventForNode` and discards returned state. `src/run/eventsV3.ts` consumes persisted materializations from `src/run/eventV3Materialization.ts`. Relics must preserve that separation: previews neither consume uses, pay costs, mutate story state, grant items, nor consume reward RNG.

Apply the same effective-cost/eligibility logic to event preview, offer materialization, and commit. Once a choice set is materialized, record its relic versions, effective costs, and use reservations so reopening cannot change its terms. Spend the once-use only when the eligible transaction commits; abandoning a preview spends nothing. A later failed validation must roll back both cost and use reservation.

Preserve event requirements, subject binding, callbacks, bag selection, and rejection rules. Relics cannot force a story chain, disclose hidden callbacks or future story outcomes, add a fourth event choice, remove the ungated safe exit, or bypass gate/availability checks. Keep authored 2–3-choice events and the spoiler-safe signals from [event-chains-proposal.md](event-chains-proposal.md).

The rejected-design register prohibits event RNG reward tables: guarantee a category and roll only its instance. Relic offers must not randomize reward amounts or quality. That register also rejects ad hoc event combat blessings as an unpriced separate feature. Combat relics are the user's newly requested priced resolver feature; keep their first acquisition at boss selection. Letting an event grant a combat relic requires an explicit new priced-feature decision and service integration, not quietly adding a combat buff outcome. Existing event prose mentioning relics does not establish a true relic inventory.

Relic offers use their own `hashSeed('relicOffer:v1', runSeed, sourceReceiptId)`/`Rng` stream over canonical eligible ID/version order. They do not consume simulation, map, shop, equipment, or event-selection streams. Persist candidate IDs/versions and the selected reference before granting; use stable receipt-derived instance IDs and claim-once settlement. Event weighted branch results and existing materializations remain unchanged when no relic applies.

## Authority and saves

`src/run/resolveBattle.ts`, `src/run/battleRequestValidation.ts`, `server/battleApi.ts`, and `functions/battle.ts` are the real dev/production combat seams. Requests carry versioned relic references and necessary once-use facts, never arbitrary effect payloads or resolved stats. Both services resolve the same catalog and validate trigger scope before simulation. `src/game` only presents returned logs.

The existing battle endpoints are stateless/unauthenticated and active runs are client-owned. Validating catalog references prevents arbitrary stat payloads but does not prove ownership or legitimate acquisition. Do not call progression authoritative without a validated/signed run/encounter receipt or server-owned run boundary and replay rejection. Keep dev/prod behavior paired; a server-storage overhaul is not implied by this proposal.

Combat-enabled relic builds must survive ghosts and share codes with the same pinned recipe, requirements, and resolved effects. Extend `src/run/ghost.ts`, `src/run/ghostValidate.ts`, `src/run/ghostFoeSetup.ts`, and `src/run/shareCode.ts` together when combat relics become active. A format/mode that cannot preserve the build must explicitly reject it; never export or reconstruct a silently weaker build. Historical builds without relic references retain their previous behavior.

`src/run/runState.ts` owns the run collection and usage receipts; `src/game/runStore.ts` persists atomic transitions; `src/meta/runSave.ts` owns schema/migration/refusal semantics. Historical saves migrate to empty relic collections, no offers, and no usage records. Validate unique instance IDs, pinned definitions, pending-offer references, scope/reset keys, and receipt consistency. Missing historical content must produce an explicit refusal/repair path, not silently substitute the current relic version. Preserve corruption backup, cleared-save precedence, and refusal to overwrite newer schemas.

## Phased implementation

### 1. Catalog, registry, and balance proposal

- [ ] Create the catalog/types/loader/registry files named above and the shared passive behavior contracts; add relic validation to `scripts/validateContent.ts`. Coordinate their shared interfaces with the talent implementation before writing a second effect handler. Author only the approved first subset of the illustrative directions.
- [ ] Publish generated descriptions and a pricing/pacing audit. Reject unknown triggers, malformed requirements, floats, invalid bounds, duplicate versions, and mixed incompatible effects before loading.
- [ ] Create `scripts/relic-audit.ts` for exported-function evidence, not `*.test.ts`. Prove version pinning, integer accumulation/order, requirements on/off, and empty-input compatibility. Add mixed talent/relic contribution probes for shared wording/stacking, independent use keys, and equipment+talent+relic healing applied once.
- [ ] Before enabling card transforms, probe anchor versus occupies-slot on size-1/2/3 cards, edge-touch adjacency and gaps, movement/removal reverting effects, and original-card cast availability when inactive. Prove one gem fold, distinct appended-action provenance, original phase/splash behavior, derived text parity, ghost/share pinned reconstruction, on/off fight logs, and same-seed output equality. Permanent variants require a separately approved confirmed transaction and reload evidence.
- [ ] Probe automatic/card/slot binding modes, two copies of the same card, unassigned/invalid targets, confirm/cancel, card-follow versus slot-stays movement, bag/sale/removal, multisize occupancy, and out-of-range slots. Prove retargeting preserves uses, pending recipes cannot change, reload preserves bindings, service rejects invented `pieceRef` payloads, and ghost/share remapping preserves the exact chosen effect.
- [ ] Probe combined loot chance at 0/10000, oversized modifiers, empty pools, repeated pack members, and receipt reloads: one gate and at most one equipment award. Probe eligible/ineligible card rewards, adjusted offer width versus event choice count, insufficient candidate pools, tier/capstone preservation, exactly one selected/granted card, and unchanged one-card capacity/fallback behavior on reload.

### 2. Run acquisition and durable transactions

- [ ] Create `src/run/relicRewards.ts` and `src/run/relicTransactions.ts`; modify `src/run/runState.ts`, `src/game/runStore.ts`, and `src/meta/runSave.ts` for owned references, offers, and once-use receipts.
- [ ] Implement `materializeRelicOffer(state, sourceReceipt): RelicOffer` and `claimRelicOffer(state, offerId, relicId): RunState`. The validated eligible offer is persisted before the player chooses, and duplicate claims are no-ops or explicit rejections.
- [ ] Add only approved acquisition sources. Begin combat relic acquisition with milestone boss selection. For event/run-economy relic rewards, extend `src/data/eventContentV3.ts`, `src/data/validateEventContent.ts`, `src/run/eventV3Rewards.ts`, `src/run/eventV3Materialization.ts`, and authored `src/data/content/event-packs/*.json`; regenerate `events.v3.json` through its compiler, leaving frozen legacy documents unchanged. Event-granted combat relics stay deferred until explicitly approved as a priced feature.
- [ ] Prove reload before/after choice, claim once, duplicate relic refusal, invalid ownership/versions, old-save migration, newer-save protection, and untouched equipment roll/award counts.

### 3. Combat and run hooks

- [ ] Connect generic relic resolution at the existing card/combatant setup seam in `src/engine/cards.ts` and the battle request/service paths above. Add a generic logged setup-effect hook only if an approved relic requires it; never branch the core loop on relic IDs.
- [ ] If card/slot mechanics are approved, connect the shared transform plan at that same resolver seam and price its incremental contributions; preview, service, logs, ghosts, and share codes must resolve the same pinned recipe.
- [ ] Add per-effect target binding storage, eligible-target preview, confirm/cancel, and validated run-instance-to-battle `pieceRef` mapping before activating player-selected effects; show inactive reasons consistently on both platforms.
- [ ] Extend ghost/share schemas and reconstruction with pinned relic recipes, or explicitly reject unsupported modes. Prove round-trip battle parity and historical empty-relic compatibility before activating combat relics.
- [ ] Add preview-and-commit event adjustments in `src/run/eventsV3.ts`; use the same cost function in affordability, materialization, and settlement. Add gold bonuses only through the existing `recordBattleResult` settlement, maintaining its one encounter result.
- [ ] Fold the approved chance effect into the planned equipment loot resolver once per receipt. Implement candidate expansion through `src/run/eventV3Rewards.ts`, `src/run/eventV3Materialization.ts`, and save validation; use the shared materialized reward for adjusted previews and single-card settlement.
- [ ] Add spoiler-safe exploration projection through existing travel view models; no reroll of encounters or route choices. Empty relic inputs must preserve existing output bytes and RNG draw counts.
- [ ] Prove combat on/off and requirement on/off with actual `npm run fight` logs. Verify two same-seed equipped/relic inputs are byte-identical; check anti-heal, setup ordering, killing blows, and no recursive procs. Use the run audit for costs, once-use scope, losses, packs, event preview immutability, and reward replay.

### 4. Paired player-facing delivery

- [ ] Create `src/game/ui/relicViewModel.ts` and `src/game/ui/RelicPanel.ts`; integrate acquisition/details into existing run UI/reward presenters and both platform scenes. Show generated rule text, availability, used/ready state, and source; avoid an arbitrary permanent overlay on the stats-only battle HUD.
- [ ] Add deterministic fixtures to `src/game/devLaunch.ts` for relic offer, collection/details, event discount active/used, and forecast. Capture desktop 1440x900 and mobile 412x892, including long names and locked choices.
- [ ] Use actual registered routes (`desktop-runevent`/`mrunevent`, `desktop-runmap`/`mrunmap`, `desktop-battle`/`mbattle`) with `layoutAudit=1` and newly registered fixtures. Run `npm run audit:hud -- tmp/relic-hud` and relevant card-face audit if card offers are changed. Visual user acceptance is separate from audit success.

## Verification and open choices

Available gates: `npm test`, `npm run content:validate`, `npm run content:events`, `npm run output`, `npm run fight -- bandit_duelist 5`, and `node scripts/check-skill-parity.mjs`. Start/reuse `npm run dev` plus `npm run api` for paired screenshots. Proposed new probe after Phase 1: `node node_modules/tsx/dist/cli.mjs scripts/relic-audit.ts`. No commit, push, or deployment without the user's word.

Decisions needed before implementation: approved initial relic subset; acquisition sources and offer size; all-owned-active versus a relic selection cap; removal/replacement rules; combat PL budget and effect magnitudes; equipment base chance and basis-point increases; event card-offer width/eligible rewards; event-use reset unit; approved card/slot transform vocabulary and ordering; while-active versus a separately confirmed permanent variant; and trusted progression requirements. Event-granted combat relics require an explicit priced-feature decision. Recommended first delivery is a small subset using setup, settlement, one loot gate, and expanded event card candidates, then approved card transforms and dynamic combat triggers in later phases.
