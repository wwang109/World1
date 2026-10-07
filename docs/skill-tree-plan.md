# Talent Tree feature plan

Scope: PROPOSAL — planning only. No talent content, progression, purchase flow, UI, or combat integration has been implemented or selected by this document.

Goal: give the player connected choices that change fights, exploration, and events, with stat bonuses as one supported effect rather than the feature's limit. Call it **Talent Tree** to distinguish it from skill cards.

Architecture: versioned JSON describes branches, prerequisites, ranks, exclusions, and typed effects. Talents and relics use shared generic passive-effect contracts and generated descriptions, with separate purchase/acquisition adapters. Pure engine effects govern fights; pure run transactions govern exploration/events. Run purchases share the existing hero level PL budget; presentation uses one model with separate desktop/mobile layouts.

[Battle passive preparation and runtime plan](battle-passives-plan.md) owns the proposed shared battle pipeline, preparation/runtime condition split, modifier order, and startup event hooks. This document owns talent progression/purchase/content proposals; it does not define a separate combat pipeline.

## Progression decision still open

Recommended provisional direction: a **hybrid Talent Tree** with permanent horizontal unlocks and purchases within each run. Build the run-purchase slice first; permanent discovery later opens new choices and grants no free equipped power, banked PL, or starting stats. A new run resets purchases.

Alternatives remain available:

- Run-only: every player sees the same tree and purchases reset each run. Smallest first release, no account progression schema.
- Permanent-only: purchases persist across runs. This needs a separate approved starting-power/PL accounting design and account progression storage; it must not be introduced as free stats on top of today's level budget.
- Both: permanent unlocks expand the catalog, while run purchases activate effects using the current run's PL. This is the recommended later extension, not an approved decision.

The user must choose the persistence direction before implementation. The plan below assumes run purchases for its first slice; permanent unlocks are conditional later work.

## Current constraints and seams

- `src/run/leveling.ts` owns `PL_PER_LEVEL`, `totalLevelPL`, `LEVEL_STAT_COST`, `spentPL`, and stat-allocation folding. Keep the locked 3 PL per level; do not grant a second talent-point power budget.
- `src/run/runState.ts#setHeroAllocation` supports scratch add/subtract and confirmation between fights. Talent planning must preserve free stat respec and the existing committed allocation's meaning.
- `src/game/ui/RunStatPanel.ts` already supplies a scratch allocation panel. `src/game/runStore.ts` is the run bridge; game scenes cannot simulate combat.
- `src/run/encounter.ts#buildAutoHeroSetup` and `src/run/battleRequestValidation.ts` reconstruct the hero from validated recipes. Talent purchases must be validated here, not supplied as client-calculated stat totals.
- `src/meta/runSave.ts` owns the current save contract and schema version (currently 4). `src/meta/lifetimeStats.ts` records aggregate history; `src/meta/account.ts` supplies account identity/authentication, not a talent progression store.
- `src/run/ghost.ts`, `src/run/shareCode.ts`, and `src/run/ghostFoeSetup.ts` need talent recipes if talents are enabled in gameplay. Older codes/saves should mean no talents, never silently receive current defaults.
- `docs/design-locked.md` owns PL-first balance and paired desktop/mobile delivery. New rules must be explicitly priced, not tuned to a fixed board's win rate.

## Purchase and respec contract

Proposed shared accounting: `levelStatsSpentPL + talentSpentPL <= totalLevelPL(heroLevel)`. All PL arithmetic uses integers; use deci-PL internally for effect pricing where needed and define exact conversion before non-stat effects are admitted. Purchased market stats, equipment, and relics retain their own source identity and do not become level-stat buys.

The first feature delivery must contain both fight-rule and exploration/event-rule choices. A stat-only helper is groundwork and does not satisfy this scope. Optional `statBuy` effects derive price/gain from `LEVEL_STAT_COST`; combat passives need approved permanent-effect PL pricing, and information/event modifiers need an explicit talent purchase-cost policy plus pacing/use limits. Do not invent a PL conversion for gold or information, treat a gated effect as free, or publish an unpriced talent as balanced. All active node purchase costs still share the existing PL bank.

The player edits one joint scratch build containing stat allocation and talent ranks. Preview includes banked/spent PL, resulting stats, prerequisites, and pending removals. **Confirm** atomically validates and saves both; **Cancel** discards the whole preview. No mid-battle changes.

Proposed talent commitment: choose a talent recipe at region entry and keep it through that region's fights/events. Apply node refunds/specialization switches at the next region boundary before its first committed stop; this prevents taking an event benefit then immediately refunding its PL into combat talents. Record the committed recipe/version and region key in save/transaction receipts. No switching while an event or fight is unresolved. An alternative is locking only nodes whose irreversible benefits were consumed, but that needs a clear use ledger and remains undecided. New mid-region talent purchases versus queued next-region investment also need a selected rule.

Existing **stat allocation remains freely adjustable between fights**; do not apply the proposed talent commitment to it. Talent refunds remove dependent nodes in the same preview and return only spent talent PL, never gold, revealed information, permanent unlocks, or past rewards. Show all removals before confirmation. Joint confirmation prevents negative ranks, overspend, illegal exclusions, unmet prerequisites, and duplicate references; every stat-only entry point must also enforce the joint budget.

## Illustrative branches and nodes

These are proposed `[talent]` names, connections, and rule directions, not live behavior or balance approval. Magnitudes, thresholds, and purchase prices remain undecided; branch access imposes no hero class.

| Branch | Root node | Connected choice | Rule direction |
|---|---|---|---|
| Guardian | [talent] Wardcraft | [talent] Emergency Ward after Wardcraft | Setup typed shield; later once-per-battle shield at a safe living-unit low-HP seam |
| Martial | [talent] Opening Technique | [talent] Iron Ward OR [talent] Spell Ward | First eligible physical card cast gains a registered damage contribution; connected exclusive typed-shield specialization |
| Recovery | [talent] Healing Practice | [talent] Reserve after Healing Practice | Direct-healing specialization; connected optional HP investment |
| Exploration | [talent] Trail Reading | [talent] Negotiator after Trail Reading | Early spoiler-safe future-band forecast; connected eligible event gold-toll discount |

Iron Ward and Spell Ward are proposed exclusive siblings requiring Opening Technique. Switch at the proposed talent commitment boundary, not after consuming a benefit. Ranks, minimum levels, and prerequisite ranks remain authored choices.

Concrete contracts for the requested rules:

- Wardcraft: generic `battleSetup` shield contribution, emitted once with talent provenance in the real event log. It is not silently applied as an invisible combat stat.
- Opening Technique: future generic `onCardCast` contribution on the first eligible active physical card instance per battle. Define eligible authored damage actions and exclude appended gem/rider/passive actions unless explicitly priced. Consume once-use only when that eligible cast resolves; include source and use receipt in the log.
- Emergency Ward: future generic low-HP contribution checked at a defined safe seam for a still-living combatant, at most once per battle. Never activate after a killing blow or recursively trigger its own proc; threshold/shield parameters and prices require approval.
- Healing Practice: registered direct-heal amplification. Combine equipment, talent, and relic percentages once, floor once on the resolved amount, then preserve receiver anti-heal/HP clamp rules. Exclude drain, lifesteal, regeneration, and other healing sources. Equipment's existing library helper is unwired, so correct live integration remains required.
- Trail Reading: extend lookahead to a later unvisited biome-band summary using map-intel snapshots. Preserve all baseline band forecasts/biome-pick readability; do not gate existing information behind a talent. `runTravelChoiceViewModel` already exposes the visible fight's name/level/title, pack count, and victory gold; repeating those is not a benefit. Reuse `src/run/biomeForecast.ts` and the snapshot pattern in `src/run/eventMapInfo.ts`, with a talent source receipt rather than a fabricated event id. Reveal no specific future nodes, event outcomes, shelves, risk-tier choices, hidden story callback, or extra reward RNG result.
- Negotiator: reduce a positive gold toll only for explicitly eligible event choices, with a bounded region-use receipt. One effective-cost function governs preview, affordability, and actual charge. Preserve story requirements and safe exits; do not discount life costs, bypass gates, grant retroactive refunds, change the locked three travel choices, or add an equipment chance/award. Equipment remains at most one award per battle.

## Content and registry design

### Proposed card changes and slot conditions

The latest direction adds proposed talent effects that upgrade/change individual card skills or depend on their board positions. These are possibilities to design and price, not approved mechanical defaults. Recommend **temporary effective-card changes while the talent and its condition are active**; permanent chosen upgrades/replacements are a separate confirmation-and-save transaction, not an automatic side effect of owning a talent.

Spatial truth: `BoardPiece.slot` is the zero-based leftmost occupied anchor. `src/run/loadout.ts#slotsOf` expands a size-N card across `[slot, slot + N)` on a linear board; the hero currently has ten slots. Player **Slot 1** means internal index 0. An `anchorSlot` condition and an `occupiesSlot` condition are distinct. A card occupying several cells counts once, not once per cell. Define adjacency by touching nonwrapping card footprints, excluding the same card's interior cells; rendered mobile/desktop rows are not gameplay rows.

Illustrative connected directions, all with unresolved price/magnitude:

- [talent] Opening Inscription → [talent] Formation Craft: the card anchored at Slot 1 gains an approved existing-keyword action; the child requires another matching adjacent card instance before its added contribution activates. Use a registered typed action recipe, not authored keyword prose.
- [talent] Physical Station: a physical card anchored in an authored slot/range receives a scoped effective-card modifier. This gates the extra effect, not card placement or the card's ordinary cast eligibility.
- [talent] Quick Station (illustrative content direction): qualifying cards in an authored slot range receive **WT −X**, using the now-supported generic `cardWeightReduction` capability in [battle-passives-plan.md](battle-passives-plan.md). This example is not a shipped talent. Explicit anchor/occupancy matching counts each card once; signed prepared deltas combine with gems and taxes before the final minimum cast WT of 1, without mutating printed/base weight. Magnitude and PL price remain unapproved; temporary combat buffs require a separate duration/consumption contract.
- [talent] Practiced Technique: temporarily promote a qualified card by one authored tier, capped at that card's validated available maximum. Use `applyTier`/authorable-tier validation; never merely change the tier label, stack unbounded promotions, invent effects for a missing tier, or silently promote an ineligible card. Exact qualifying catalog/tier policy still requires approval.
- [talent] Alternate Technique: use a pinned, explicitly authored replacement recipe for a selected eligible card's effective skill. Keep identity/size/type changes outside the first transform slice. A permanent replacement later requires owned-instance selection, preview, source receipt, and atomic confirmation; never rewrite the global card catalog.

Talent prerequisites/ranks/exclusions gate **purchase**; board/property/adjacency predicates gate **effect activation**. Moving a card invalidates the condition and shows the talent contribution inactive, while preserving the purchased node, base card, and any consumed use receipt. Movement/refund cannot reset a first-cast proc, repeat a paid upgrade, or farm irreversible rewards.

Shared proposal with relics: `resolvePassiveCardEffects(def, piece, boardContext, sources)` returns scoped contributions and provenance alongside `resolveEffectiveSkill`/`applyTier`, never switches on talent/relic ids. Pin source definitions, card definition versions, and replacement/action recipes. Evaluate slot predicates from a defined base-board snapshot; reject transform cycles, illegal parameters, unsupported keywords, or invalid target versions. Preserve affinity thresholds, readiness/cast ordering, and slot layout.

Transform order is an explicit pre-implementation decision owned by [battle-passives-plan.md](battle-passives-plan.md), including temporary authored tiers/base-card transforms, exactly one gem fold, and canonical rider ordering. Approve and price which authored actions transformations may change, whether appended gem actions are excluded, and how promotions/replacements compose before implementing it; do not guess a different order in each source adapter. No-passive resolution must remain unchanged. Canonical `renderSkillText`, card-detail/preview models, and the service must read the same final effective form; generated keyword definitions stay in `src/engine/keywords/text.ts`.

Static slot/card-family predicates are evaluated during shared preparation from the pinned board snapshot. Dynamic low-HP/first-cast rules are compiled into guarded generic runtime hooks, with source/use receipts; do not rescan all talents/relics every turn or pre-evaluate future HP/cast state. Battle startup effects require the shared logged initialization seam. Loot/event reward conditions and irreversible use accounting stay in pure run-layer transactions, not the combat loop.

Validate the complete combined effective kit for target/scope compatibility, Splash interactions, action ordering, and its incremental PL. Talent/relic actions need distinct passive source provenance; do not mark them `fromGem` to reuse gem-specific math. Scaling, multi-hit sharing, rider eligibility, and price semantics for those origins must be explicitly defined before enabling them. Slot conditions use unchanged base geometry; size/type transforms are excluded initially.

Proposed slot/action metadata fragment, deliberately without invented Ward magnitude or price:

```json
{
  "trigger": "effectiveCardSetup",
  "kind": "appendRegisteredAction",
  "target": { "anchorSlot": 0, "source": "activeBoardCardInstances" },
  "actionKind": "ward",
  "parametersFrom": "pendingApprovedNodeBalanceProfile",
  "duration": "whileActive"
}
```

`ward` is an existing Action kind; this fragment references metadata only and is not an executable Action until approved numeric parameters and a registered contract exist.

### Proposed player-selected card/slot targets

User decision: choose a talent's card/slot target when the talent is unlocked, then save that choice. Do not ask again before every battle. Card targets follow the owned instance when moved; slot targets retain their coordinate. Acquisition UI/persistence are still planned; balance and progression lifecycle choices remain separate.

Each relevant effect definition declares `targetBinding`: `automatic`, `playerCard`, or `playerSlot`, with a closed scope, min/max target count, and registered eligibility predicates. Automatic effects need no selection. First interactive slice recommends one target on the active board; bag/held cards are ineligible. Keep binding records keyed by pinned talent source plus stable `effectId`/`bindingId`, not a single target shared by every effect. Effects may share a selection only through an explicitly authored binding group.

`playerCard` binds an **owned card instance id**, never a skill id, array position, or current slot. It follows that instance when moved; putting it in the bag or selling/removing it makes the contribution inactive. Preserve the target/use history and show the reason; do not silently select another copy. `playerSlot` binds an exact zero-based board coordinate and continues to affect a future eligible occupant there. Its definition must specify anchor-at-coordinate versus card-occupying-coordinate; a multi-size card is still one instance. Reject coordinates outside the actual board width rather than clamping them.

Selection is required before that effect activates. Recommended UI: block confirming a new purchase/retarget operation until its mandatory selection is supplied, but show an unassigned or later-invalid existing effect as inactive without automatically rejecting the entire battle. Whether a particular effect must block battle readiness remains a separately approved definition rule, not a global default. An inactive/unassigned effect consumes no use.

On both platforms, **Select card/Select slot** highlights eligible targets, previews the resulting effect and condition, then **Confirm** saves the binding or **Cancel** discards scratch changes. Retarget only at the allowed talent commitment boundary between battles; no changes during a pending fight/event. Moving cards follows ordinary deck rules but cannot reset once-use receipts. A target switch or respec cannot refund consumed benefits, repeat a permanent upgrade, or farm proc uses.

Bindings persist with the pinned recipe. Service preparation validates target ownership/eligibility first, then slot/static conditions. Existing run cards have `instanceId`; engine `BoardPiece` does not. Add a future opaque battle `pieceRef` mapped from owned instances and preserved through validation; do not pretend a skill id/slot currently provides this identity. Ghost/share exports need stable recipe-local piece tokens and an explicit import remapping to new instance ids. Unsupported/unmappable bindings must be reported or refused, never attached to an arbitrary same-skill card. The shared engine contract is detailed in [battle-passives-plan.md](battle-passives-plan.md).

Proposed canonical file: `src/data/content/talents.v1.json`, using the familiar `schemaVersion` and outer `nodes: [{ id, versions: [{ version, def }] }]` envelope. Each definition carries `name`, `branchId`, `maxRank`, optional `minHeroLevel`, typed `effects`, `requiresAll: [{ nodeId, nodeVersion, rank }]`, and optional `exclusiveGroup`. Branch metadata and layout hints are separate from effect semantics. Purchased references pin `nodeId`, `nodeVersion`, and `rank`.

Illustrative JSON node (not a runtime schema yet):

```json
{
  "id": "trail_reading",
  "versions": [{
    "version": 1,
    "def": {
      "name": "Trail Reading",
      "branchId": "exploration",
      "maxRank": 1,
      "requiresAll": [],
      "effects": [{ "trigger": "travelPreview", "kind": "forecastBand", "scope": "laterUnvisitedBandSummary", "spoilerPolicy": "knownFactsOnly" }]
    }
  }]
}
```

The fragment omits unresolved price policy and cannot be published until that policy is approved. Validate ids/versions, legal ranks, prerequisite cycles, satisfiable exclusions, typed trigger/scope/use combinations, pricing status, and pinned references. Never substitute latest definitions into purchased nodes. A tree manifest pins purchasable versions; old runs retain their manifest and commitment recipe. Missing/malformed definitions refuse affected saves/requests using existing backup/version-protection semantics.

Proposed modules:

- `src/engine/talents/types.ts`: effects, pinned purchases, manifest, and resolution types.
- `src/engine/passives/`: proposed shared typed behavior/trigger registry, text, combiner, and provenance for talents/relics; `src/run/passiveTransactions.ts` supplies pure event/exploration/use transactions. No per-talent or per-relic id switches.
- `src/engine/talents/resolve.ts`: source adapter from purchased node/rank refs into shared effect contributions. Reuse canonical stat rules from `src/engine/keywords/text.ts`; talent graph pricing/prerequisites remain separate from relic acquisition.
- `src/data/talentsContent.ts` and `src/data/validateTalentContent.ts`: strict versioned loading and authored graph validation.
- `src/run/talents.ts`: prerequisite/exclusion checks, joint scratch validation, dependent refunds, and pure purchase transitions.
- `src/game/ui/talentTreeModel.ts`: owned/available/locked node state, exact lock reasons, generated descriptions, and shared preview totals.

Every renderer reads the same generated description/rule model. Adding a supported node is a JSON change; a new effect requires shared behavior, text, validation, pricing, and evidence. Contributions keep source kind/id/version/rank/receipt; combine compatible sources once in canonical order. Forecast/event previews never consume uses or write state. Commit materializes the chosen talent/relic recipe and settles cost/use atomically so reload cannot repeat a benefit. Relics differ by acquisition/ownership; talents differ by purchase/prerequisite/exclusion/commitment, not duplicated behavior code.

## Implementation phases and evidence

- [ ] **1. Select design:** confirm run/permanent/both, branch connections/exclusions, talent commitment cadence, and prices/use limits for combat and exploration/event rules. First delivery includes both domains; stat-only groundwork is not completion. Approve paired mockups with PL, requirements, rule descriptions, and refund/commitment preview.
- [ ] **2. Shared rule/content library:** build generic passive contracts with relics, talent graph adapters, JSON, and duplicate-key validation. Interfaces: `loadTalentContent(input)`, `resolveTalentPurchases(purchases, context, catalog)`, generated text, and source-tagged contributions. `scripts/talent-audit.ts` proves pinned versions, cycles/exclusions, trigger/scope/use validation, joint pricing, same-source deduplication, and one combined healing floor; no `*.test.ts` files.
- [ ] **3. Run transactions:** extend the versioned `RunState` and save predicates/migration without changing historical frozen interfaces; add `validateHeroInvestment(level, allocation, talents, catalog)` and `commitHeroInvestment(state, scratch)` as the one joint-budget validation path. Replace the independent budget guards in both `setHeroAllocation` and `battleRequestValidation.ts#requestAllocation` for hero investment, preserving stat-only calls. Checking stats and talents separately against the full level budget would permit double spending. Evidence: pure probes for purchase/negative and excessive ranks/prerequisites/exclusions/combined overspend, dependent refunds, cancel/confirm, reload, old-save defaults, corruption backups, and newer-save overwrite refusal.
- [ ] **4. Fight rules and build identity:** implement setup ward and direct-healing specialization through approved generic seams; stage Opening Technique/Emergency Ward only after safe trigger ordering and pricing are established. Update requests, dev/production service twins, ghosts, and share codes together. Evidence: real `npm run fight` on/off logs, source provenance, first eligible cast/use limits, no post-lethal or recursive proc, mixed equipment/talent/relic healing floor, byte-identical same-seed logs, and unchanged no-talent baseline.
- [ ] **4b. Exploration/event rules:** deliver extended band-summary lookahead and eligible toll resolution through pure run seams. Interfaces: shared passive forecast model, effective event-cost function, and atomic cost/use settlement. Evidence: additional forecast value without removal of baseline information/spoilers, unchanged travel choices/gates/RNG, preview reads without writes, correct affordability/charge, zero-cost/ineligible controls, saved commitment/reservations, reload/retry award-once, and no extra equipment roll/award.
- [ ] **4c. Card/slot extension:** select temporary versus permanent behavior, qualified recipes, transform/gem order, and PL prices before enabling it. Prove anchor-versus-occupied-cell controls, multi-size instance counts, edge/nonwrap adjacency, moving targets active/inactive, capped authored tiers, gem/action ordering, once-use receipts, canonical face/detail/service agreement, no-passive compatibility, and ghost/share round trips with real fight on/off/move logs where behavior changes. Permanent upgrades need separate reload/idempotent owned-instance transaction evidence; a temporary transform must not mutate saved card ownership.
- [ ] **4d. Selection bindings:** add typed per-effect bindings and recipe-local piece tokens; validate ownership, scope, counts, eligibility, and coordinate bounds before compiling effects. Prove duplicate-skill instance isolation, card-following versus slot-following movement, bag/sale invalidation, no silent retarget/use reset, confirm/cancel, locked pending transactions, service agreement, reload, and ghost/share token remapping. Capture eligible/ineligible selection highlights on desktop and mobile when UI is implemented.
- [ ] **5. Paired UI:** integrate a Talent Tree action through run chrome/stat access on `DesktopRunMapScene.ts`/`MobileRunMapScene.ts` and `DesktopRunPrepScene.ts`/`MobileRunPrepScene.ts`; choose a shared panel or separate scene pair after mockup approval. Rebuild via `rebuildScene`. Evidence: actual `desktop-runmap`/`mrunmap` and `desktop-runprep`/`mrunprep` routes at 1440×900 and 412×892, locked/purchased/refund states readable, no overlaps, required HUD/cardface audits and user visual confirmation.
- [ ] **6. Optional permanent unlocks:** only after persistence selection, add separate account progression storage, migration, sync/ownership handling, and discovery rules. Do not store permanent unlocks solely in lifetime aggregates or infer them from current run purchases. Verify guest/account/reload cases and that unlocking grants no active stats or extra PL.

Every implementation phase runs the existing `npm test` gate and relevant `npm run content:validate` evidence. These are proposed future checks, not claims of implemented talent behavior. No mandatory ownership record, independent review, commit, or push is part of this plan.

## Decisions needed

Progression persistence, branch topology, effect prices/use bounds, talent commitment/respec cadence, temporary/permanent card changes, qualified recipes, and transform/gem ordering remain open. Keep direct free stat allocation; recommend provisional hybrid progression with run purchases and temporary effective-card changes. Combat and exploration/event rules are required scope; card/slot extensions are the latest proposed possibilities. No automatic permanent catalog/owned-card mutation is selected.
