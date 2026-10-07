# Equipment acquisition

Scope: LIVE (USER RULING 2026-10-06: acquisition was never meant to be parked; only talents and relics are). Fights and events grant equipment as described below. Catalog, set rules, generated descriptions and equipment screens are owned by [equipment-system.md](equipment-system.md). Talent and relic work is also parked.

## Acquisition behavior

Every won run battle drops exactly one item; a lost battle drops nothing (USER RULING 2026-10-06: the drop is guaranteed on a win; only which item is random). This applies to map fights, event challenge fights and the extra ghost fight. This is `fightChanceBps: 10000` in `src/data/content/equipment-loot.v1.json`. Sandbox battles do not grant run equipment.

All 59 current enemy JSON definitions have overlapping equipment pools. Entries pin `itemId`, `itemVersion`, and a `setVersion` for set items. Positive integer selection weights are separate from the encounter chance.

An enemy drops the sets its own board would activate. Each set scores the number of the enemy's board cards matching its requirement; Ironwall counts only physical defensive cards and Spellguard only magical ones, and the broad Arcanist and Bastion sets score one less. The top three sets (ties go to the set with fewer sources so far) enter the pool as complete sets, weighted by score (1–3). Enemies with fewer than three scoring sets also drop [equipment] Wind Charm. Every one of the 11 sets has at least five enemy sources.

An encounter merges the participating enemies' pools, deduplicates pinned references, and retains the maximum weight for each reference. Repeated enemies and larger packs cannot multiply chance or duplicate an item's weight. Ghost/custom encounters without authored pools use fight-eligible catalog items once each at equal weight.

The dedicated stream is `new Rng(hashSeed('equipmentLoot:v1', runSeed, receiptId))`. It does not consume combat, map, shop or event-choice RNG. The sorted pool determines one weighted selection after the single chance gate. A durable receipt records source identity, chance, roll and selected item or no-drop result. Repeated settlement returns that receipt without another grant.

Items are added to owned inventory and are not automatically equipped. Armor, Accessory and Charm each accept one owned instance. Equipping replaces the same slot; unequipping retains the item in inventory. Catalog definitions supply stats and set effects; inventory references do not contain authored stat overrides.

## Events and Loot From

The same JSON acquisition configuration contains explicit pools keyed to actual event IDs and versions:

- [event] Abandoned Cache, version 2, opening or searching: [equipment] Duelist Coat or [equipment] Wind Charm.
- [event] Drill-Sergeant's Chest, version 2, opening the chest: [equipment] Arcanist Pendant or [equipment] Restorer Seal.
- `event-packs/170-equipment.json`: one find event per set, drawn when two board cards match that set's requirement, granting a piece of that set; Sets are grouped (Warrior: Duelist/Huntsman/Ravager; Arcane: Arcanist/Stormcaller/Hexweaver; Guardian: Bastion/Ironwall/Spellguard; Support: Restorer/Tactician/Wind Charm). [event] The Arms Dealer, The Hedge Mage, The Quartermaster and The Trinket Trader each take a sacrificed card for a random piece of their group, drawn when two board cards fit one of the group's sets; the forge events use the same groups. Event grants skip pieces the player already owns while any remain.
- Broken pieces: any spare (unequipped) item in the equipment bag can be salvaged for 1 broken piece (`RunState.brokenEquipment`); salvaged instance ids join `spentEquipment`. Forge events ([event] The Weaponsmith, The Arcane Forge, The Armorer, The Tinker) each cover a group of sets: forging spends 3 broken pieces for an item the player picks from those sets, and upgrading an owned item from those sets adds a level (+1 to its non-HP stat, or +5 max HP for HP-only items) at a cost of the next level's number in pieces (1, 2, 3, ...), up to +5 (`EQUIPMENT_MAX_LEVEL`). Both stay open at the node while the player can afford them. Levels ride on owned/equipped refs (`level`), fold in `resolveEquipment`, and travel in battle requests, saves, ghosts and share codes (codec v3, written only when a level is present).
- [event] The Collector and [event] The Fortune Teller take an equipped piece (`equipmentCost`) for a Silver card, a gem, or a card upgrade. Traded pieces are recorded in `spentEquipment` so their receipts stay valid.

These pools currently grant one item at 100% when the eligible chosen outcome completes. Leaving a cache/chest grants no equipment. Pending card/gem pickers and challenge fights delay the event award until completion. Event instance identity prevents repeated grants.

`src/data/equipmentLootSources.ts` builds Loot From from these event pools and current enemy JSON pools. Enemy names come from the catalog; preferred locations come from biome membership. Locations say **Often found in** because enemies can appear elsewhere. Both equipment screens use the same generated item/set/source model.

The combat roster still comes from `src/data/enemies.ts`. Equipment acquisition separately reads `enemyBookFromJson`; a full roster migration is unnecessary for drops. The exporter refuses to overwrite JSON containing authored pools or historical versions.

## Saves and authority

Run saves use schema 6 and validate owned references, slots, pinned definitions and receipt consistency. Per the save owner's user-locked policy, older run schemas are discarded and start fresh; newer schemas retain the existing refusal behavior. Equipment, receipts and battle/event settlement are saved together.

Progression remains client-owned. Strict catalog references and idempotent receipts prevent ordinary invalid loadouts and replayed grants, but the current stateless battle service does not provide server-authoritative or cheat-proof progression. Server-owned encounter validation/signing is future work if that guarantee is needed.

## Evidence

`npm test` includes equipment library, source coverage, battle, portable-build and run acquisition/save audits, alongside repository gates. `npm run content:validate` validates all 59 enemy pools. `npm run fight` evidence covers equipment on/off, inactive set requirements, direct healing and same-seed determinism. Equipment screens are checked at desktop 1440x900 and mobile 412x892, including equip, swap, unequip, set thresholds, source details and save reload.

UI evidence is under `tmp/equipment-ui/`; combat evidence is under `tmp/equipment-battle-evidence/`. Visual acceptance is separate from technical verification. No commit, push or deployment is implied.

## Deferred work

- Equipment balance budgets and acquisition pacing: current magnitudes, weights and chance values remain illustrative and editable in JSON.
- Full enemy roster JSON cutover: first prove stats, growth ordering, encounter ordering and same-seed combat parity, then replace the TS roster facade without overwriting history.
- Dedicated equipment choices inside event content: current acquisition uses the central explicit pool table; no new event outcome schema is required.
- Talent/relic loot modifiers: parked. A future registered modifier may change the existing chance once, clamped to 0..10000 basis points, with pinned provenance and atomic consumption. It must not create a second roll or extra item. No item-weight modifier policy is selected.
