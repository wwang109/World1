# Equipment system

Scope: LIVING — stage 1: equipment content, owned inventory, three equip slots, set resolution, saves, combat, portable builds, and paired equipment screens. Fight/event acquisition is live (USER RULING 2026-10-06: only talents and relics are parked; there is no acquisition switch). Talent and relic work is parked separately.

## Delivery stages

1. **Items and equipment (current):** JSON items/sets, generated descriptions, inventory, equip/swap/unequip, active set requirements, saved references, combat effects and native desktop/mobile equipment UI. Review with `?scene=desktop-equipment&equipmentFixture=1` and `?scene=mequipment&equipmentFixture=1`.
2. **Acquisition (live):** enemy/event drop delivery, drop-rate tuning and reward presentation, always on. Settlement grants equipment and shows the equipment-drop notice. Production new runs do not receive sample equipment; the review fixture supplies sample owned items only.
3. **Talents and relics (parked):** progression, acquisition and gameplay UI.

Goal: maintain the equipment library through shared typed registries and one authored catalog. The library now contains 34 items and 11 sets.

Architecture: `src/engine/equipment/` owns types, modifier and requirement registries, deterministic resolution, and text. `src/data/equipmentContent.ts` loads pinned versions from validated JSON. `src/data/content/equipment.v1.json` is canonical; `docs/templates/equipment.v1.template.json` is its generated mirror.

## Implementation checklist

- [x] Add strict catalog validation and pinned item/set loaders. Reject unknown fields, duplicate ids/versions, invalid references, and unsupported keys.
- [x] Implement fixed Armor/Accessory/Charm slot resolution, per-set progress, AND requirements, and additive thresholds. Count active card instances once, regardless of size.
- [x] Generate compact item/set clauses and parameter-free rule descriptions from the same registries used by resolution.
- [x] Provide immutable stat folding and a direct-heal amount helper. Heal amplification applies once to the fully resolved direct-heal amount; it cannot be implemented correctly by scaling authored power alone because combat adds dynamic terms.
- [x] Generate the template mirror and add equipment audits to the gate/content validation.
- [x] Verify with the equipment audit, template byte check, content validation, gate chain, and unchanged-equipment same-seed fight comparison where execution permits.

## Contracts

Slots are `armor`, `accessory`, `charm`. Equipped refs identify an item instance and pin item and set definition versions. Missing/invalid references and duplicate slots or instance ids are rejected. Item bonuses always apply; set bonuses require the authored matching-card count (currently three) of active board card instances and enough distinct equipped slots. A three-piece set grants both thresholds. `archetypesIncludes` is array membership; selector clauses combine with AND.

Stat modifiers use `maxHp`, `attack`, `magicPower`, `armor`, `magicResist`, `speed`. Battle setup starts at full resolved HP. Restorer uses separate `outgoingHealPct`: direct healing alone is boosted once before anti-heal and HP clamping, excluding drain, lifesteal and regeneration. `heroEquipment` carries pinned refs; the battle service resolves bonuses against its reconstructed active board and emits an `equipmentSetup` receipt.

Descriptions are generated, never duplicated authored bonus strings. Equipment PL pricing is unresolved; current numbers are illustrative. No equipment shop exists.

## Extending the library

Add items or sets to canonical JSON using existing registry keys, then regenerate the template with `npm run content:equipment-template`. Add a new modifier/selector to the typed registry and validator with its behavior, formatting, and rule description; extend `scripts/equipment-audit.ts` with evidence for the new path. Resolve pinned historical versions instead of silently substituting the latest definition. Run `npm run audit:equipment`, `npm run content:validate`, and `npm test`.

## Loot source library and shared details

Acquisition is live. The delivery rules are [enemy-equipment-drops-plan.md](enemy-equipment-drops-plan.md).

`equipmentLootSourcesFromJson()` indexes current enemy JSON pools, actual biome membership and the same event-pool configuration used by acquisition. Combat retains the existing enemy roster; reward metadata loads separately from JSON. Locations are preferred, never exclusive. Version pins remain isolated.

`equipmentDetailsModel()` supplies generated bonuses and **Loot From** metadata. Bag's Equipment tab displays item stats, set requirements and the equip preview. Each selected item's Loot From button opens a paginated panel listing locations, enemies and events from the canonical source index. Sources are per item, so pieces of one set can differ. Empty source lists display "No named sources assigned yet." Event-less items display "No event sources." The panel does not change acquisition or drop configuration.

`src/run/equipmentInventory.ts` owns equip transitions and ownership validation. Run saves use schema 6; older run saves are discarded under the save owner's major-feature policy. Ghost/share gear uses the versioned codec while gear-free codes retain their old bytes. Previously owned items remain usable while new drop delivery is disabled.

## Equipment bag layout

The user's selected reference is `docs/mockups/equipment-approved-reference.png`. It supersedes the interim Deck/BAG row layout: three horizontal equipped panels above a flat bag, with a persistent selected-item detail panel on the desktop right and below the mobile bag. The grid begins 12 pixels inside the bag panel; four desktop columns and three mobile columns divide its available width equally, with consistent gaps and equal tile dimensions. Image areas stay square: 112 pixels on desktop and 48 pixels on mobile. Names, equipped indicators, set requirement icons, two/three-piece bonuses and canonical stat previews follow the reference. Paging keeps all 25 items reachable without grouping by set.

The selected-item typography revision groups item stats beside compact artwork on desktop, uses full-width two/three-piece effect rows with active/inactive states, and aligns current-to-next stat changes below a divider. Mobile retains inline details, uses larger effect text and a shorter bag panel; paging controls move into the bag header. Bonus effects come from `equipmentModifierClauses` and previews continue to use canonical resolution. The three-piece bonus adds to the two-piece bonus; the panel states that bonuses stack. No equipment stats or set mechanics changed.

Stat labels and amounts use separate fixed columns; multi-stat set effects use one line per modifier. The development-only `equipmentFixture=all` route supplies the entire catalog without changing saved inventory. Desktop shows eight items per page and mobile shows six; the 34-item library spans five desktop pages and six mobile pages.

The run map opens Bag on both platforms. Bag has Cards and Equipment tabs with the selected tab highlighted; the equipment view preserves its approved layout. Map returns to the run map, while Done returns to the Cards tab. Bag paging uses arrow buttons with the current/total page count between them; controls disappear when all items fit on one page.

## Library expansion

Each new set contains an Armor, Accessory and Charm. All require three matching active board card instances. Two-piece and three-piece bonuses stack when both requirements are met.

| Set | Matching cards | Two pieces | Three pieces, additional |
| --- | --- | --- | --- |
| Huntsman | Bow | ATK +2 | SPD +2 |
| Tactician | Support | SPD +2 | HEAL +10% |
| Hexweaver | Debuff | MATK +2 | MDEF +2 |

These use existing registry modifiers and illustrative values; equipment PL approval remains unresolved. No new triggered passive behavior is added. All three sets drop from enemies whose boards match them (see [enemy-equipment-drops-plan.md](enemy-equipment-drops-plan.md)); the source audit requires at least three enemy sources for every item. Temporary art aliases reuse current textures without generating or replacing assets. The canonical JSON and generated template contain the same additions.

The current equipment artwork was rejected by the user and remains temporary. Further art generation is paused pending a style direction. Complete silhouettes, centered images and transparent edge clearance remain required regardless of the future style. See `docs/equipment-art.md` for the temporary asset pipeline and `design-qa.md` for current evidence. Talents and relics remain parked.

Equipment is integrated; production balance approval and equipment artwork remain separate work. Verify inventory/save behavior with `scripts/equipment-run-audit.ts`, plus equipment, battle and share audits. `scripts/equipment-screen-audit.ts` checks both native equipment screens; `scripts/equipment-reward-screen-audit.ts` proves real battle/event settlement grants one item with a receipt and the equipment-drop notice. Fixtures are ephemeral and do not overwrite saved runs.

## Source tracking and set pieces

Loot From provides independent **Track enemies** and **Track events** checkboxes. Preferences pin item, item version and set version, collapse duplicate owned instances into one goal, and live outside run saves under `world1:equipment-tracking:v1`. The pure metadata module accepts a storage driver; the browser adapter retains session changes when storage reads or writes fail. Malformed or stale goals are ignored. Tracked Items manages goals even when the piece is absent from the current inventory.

The selected set shows Armor, Accessory and Charm pieces with equipped, owned or missing labels. Tapping any piece opens its own canonical Loot From panel, including missing pieces. The original card-type requirement badges remain separate. Desktop uses the spare area beside item art; mobile keeps six bag tiles per page and scrolls bag/details inside a masked viewport above the fixed footer.

Revealed map encounters and events display a separate tracking icon/label and item chance, preserving difficulty colors. Multiple goals show a bounded first-item summary plus a count; tapping opens paginated item details. No hidden event identity is revealed and tracking changes no encounter/event rolls. Prep shows a bounded loot-icon row; the Loot control opens all possible items with chances, and each item leads to source tracking without requiring ownership.

Enemy-source percentages describe solo victories. Actual encounter previews use the complete enemy pack's effective pool: duplicate pinned entries merge by maximum weight, and the item percentage is the configured award-roll chance multiplied by its share of total weight. Event previews share the same unowned-first pool helper as event settlement and name the qualifying choice. An owned item can show 0% while unowned alternatives remain; once every pool item is owned, previews use the full pool. No reward configuration, weights, balance values or RNG calls changed for this feature.

Evidence: `scripts/equipment-tracking-audit.ts` checks probabilities, version pins, pack pooling, event eligibility, unowned/all-owned behavior, identical rewards across 30 seeds and preference validation. `scripts/equipment-tracking-screen-audit.ts` captures both platforms at 1440×900 and 412×892, proving reload, independent toggles, failed-write fallback, matched/unmatched map choices, event 0%, possible loot and missing-piece tracking. DEV-only `equipmentTrackingFixture=fight|event` creates ephemeral source-preview fixtures. Screenshots live in `tmp/equipment-tracking/`; the required gate log is `tmp/equipment-tracking-gate.log`.
