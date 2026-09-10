# Event catalog

> This developer wiki is generated from current live `src/data/content/events.v3.json` and `src/data/content/event-discoveries.v1.json`. Live runtime selection uses the validated current `src/data/content/events.v3.json` aggregate. Frozen `src/data/content/events.v2.json` remains the schema-2 compatibility artifact. Do not hand-edit.

Presentation copy is shown for authoring context only. Runtime behavior dispatches on the structured requirement, choice, outcome, mutation, callback, and binding data shown below. Generated Markdown is never loaded at runtime.

## Discovery metadata

These are stable, account-ready labels only. `accountStatus: future` means no run or browser-global progression is written yet.

| Discovery ID | Label | Owning ambient event | Account status |
| --- | --- | --- | --- |
| `far_sighted` | Far-Sighted | `feathered_cairn` | `future` |
| `the_grave_answers` | The Grave Answers | `names_under_stone` | `future` |
| `tempered_by_fire` | Tempered by Fire | `cinderheart_crucible` | `future` |
| `white_road_walker` | White Road Walker | `whiteout_pilgrim` | `future` |
| `hunted_the_hunter` | Hunted the Hunter | `moon_scented_trail` | `future` |
| `under_the_red_standard` | Under the Red Standard | `red_standard` | `future` |
| `hold_the_line` | Hold the Line | `last_hedge` | `future` |
| `storm_in_hand` | Storm in Hand | `thunder_in_a_bottle` | `future` |
| `venom_crown` | Venom Crown | `bloom_behind_the_teeth` | `future` |
| `heavy_purse` | Heavy Purse | `gilded_detour` | `future` |
| `proven_fivefold` | Proven Fivefold | `victors_table` | `future` |
| `settled_score` | Settled Score | `bitter_rematch` | `future` |
| `last_light` | Last Light | `last_light_at_roads_end` | `future` |
| `one_purpose` | One Purpose | `mirror_of_the_board` | `future` |
| `signature_skill` | Signature Skill | `card_that_remembered` | `future` |
| `off_the_map` | Off the Map | `cartographers_missing_road` | `future` |

## Closed schema-v3 fact registry

| Fact | Structured arguments | Persisted/derived dependency |
| --- | --- | --- |
| `wallet.current` | `{ op: eq \| gte \| lte; value: integer }` | `RunState.gold` |
| `lives.current` | `{ op: eq \| gte \| lte; value: integer }` | `RunState.lives` |
| `node.depth` | `{ op: eq \| gte \| lte; value: integer }` | `RunState.map + current event node` |
| `node.wave` | `{ op: eq \| gte \| lte; value: integer }` | `RunState.map + current event node` |
| `run.tally` | `{ stat; op: eq \| gte \| lte; value: integer }` | `RunState wins/losses/bossesCleared/stats` |
| `event.choice` | `{ eventId; choiceIds? }` | `RunState.eventResolutions` |
| `story.flag` | `{ key; op; value }` | `RunState.storyStateV3` |
| `chain.completed` | `{ storyId }` | `RunState.completedStoryIds` |
| `biome.current` | `{ ids }` | `RunState.map + current event node` |
| `board.affinity` | `{ affinityId }` | `RunState.pieces` |
| `board.isMonoType` | `{ typeKind: weapon \| element }` | `RunState.pieces` |
| `owned.card.count` | `{ where; count; match; tierAtLeast? }` | `RunState.pieces/bagSlots/held` |
| `owned.gem.count` | `{ where; count; match }` | `RunState.gemInventory + socketed pieces` |
| `combat.enemyDefeated` | `{ enemyId \| weaponAffinity; atLeast }` | `RunState.combatFactLedger` |
| `combat.biomeBossDefeated` | `{ biomeId }` | `RunState.combatFactLedger` |
| `combat.affinityWin` | `{ affinityId; atLeast; biomeId? }` | `RunState.combatFactLedger` |
| `combat.statusUsed` | `{ status; result; biomeId? }` | `RunState.combatFactLedger` |
| `combat.actionKindUsed` | `{ actionKind; result; biomeId? }` | `RunState.combatFactLedger` |
| `combat.fastWin` | `{ maxTurns; element? }` | `RunState.combatFactLedger` |
| `combat.recentLoss` | `{ withinDepth }` | `RunState.combatFactLedger + current event node` |
| `combat.noLossesInBiome` | `{ biomeId }` | `RunState.combatFactLedger` |
| `combat.revengeReady` | `{}` | `RunState.revengeFactLedger` |
| `combat.signatureReady` | `{ winsAtLeast; bossFinisher: true }` | `RunState.signatureFactLedger` |
| `journey.visitedBiomes` | `{ op: gte; value }` | `RunState.journeyFactLedger.visitedBiomeIds` |
| `journey.completedChains` | `{ op: gte; value }` | `RunState.completedStoryIds` |
| `callback.queued` | `{ callbackId }` | `RunState.eventCallbackQueue` |

## Graph edges

| Kind | From | To |
| --- | --- | --- |
| callback | `card_that_remembered/awaken_capstone` | `signature_card_capstone@v1` |
| callback | `cartographers_missing_road/mark_missing_road` | `missing_road_destination@v1` |
| callback | `feathered_cairn/read_feathers` | `feathered_cairn_far_sight@v2` |
| callback | `last_light_at_roads_end/risk_last_road` | `last_light_secret_route@v1` |
| callback | `mirror_of_the_board/enter_mirror` | `mirror_transformation@v1` |
| callback | `moon_scented_trail/follow_hunt` | `moon_scented_hunt@v1` |
| callback | `names_under_stone/take_grave_silver` | `names_under_stone_answer@v1` |
| legacy choice | `the_bell_unbound` | `bell_beneath_ice` |
| legacy choice | `the_bell_unbound` | `the_second_toll` |
| legacy choice | `the_reckoning` | `crossroads_shrine` |
| legacy choice | `the_reckoning/sun_road` | `crossroads_shrine` |
| legacy choice | `the_reckoning/moon_road` | `crossroads_shrine` |
| legacy choice | `the_second_toll` | `bell_beneath_ice` |
| legacy choice | `tutors_return` | `wandering_tutor` |
| callback | `whiteout_pilgrim/share_white_road` | `whiteout_guidance@v1` |

## Materialized definitions

## `abandoned_cache` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `abandoned_cache@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Abandoned Cache"
- Presentation body: "The trail dips into the Silt Hollows, and there, half-swallowed by mud, a supply crate juts from the muck, its lock long rusted through. Someone left here in a hurry — or never came back at all. Pry it open and it could hold anything worth carrying, or nothing at all but the reason it was abandoned."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `open`

- Presentation label: "Pry it open"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `search_thoroughly`

- Presentation label: "Search it thoroughly (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave`

- Presentation label: "Leave it be"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `banner_scribe` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `banner_scribe@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Banner-Scribe"
- Presentation body: "A banner-scribe has set her table among the Muster Road's camps, reading fighters' colors off their gear the way other scribes read letters. One look over your board and she is already mixing paint: if you march under a device, she knows a supplier for it — and if you march under none, she will still pay a copper for the sketch."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `recruit` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `blazon`

- Presentation label: "Commission gear in your colors (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filterFrom": "boardIdentity",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `sketch_fee`

- Presentation label: "Let her sketch your kit for a copper"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `keep_marching`

- Presentation label: "March on unblazoned"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `beast_nest` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `beast_nest@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Beast Nest"
- Presentation body: "A trampled nest sits half-sunk in the Silt Hollows' mud, littered with the shed claws and feathers of something large. Everything worth carrying out of it is beast-work — fang, claw and hide, nothing else — if whatever built it doesn't come back and cost you a coin purse for the trouble."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `raid_it`

- Presentation label: "Raid the nest"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `raid_prepared`

- Presentation label: "Take a beast trophy (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "weapons": [
        "beast"
      ]
    }
  ],
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave_it`

- Presentation label: "Leave the nest be"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `bell_beneath_ice` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `bell_beneath_ice@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Bell Beneath the Ice"
- Presentation body: "Beneath blue ice, a silver bell waits with its mouth turned toward the road. Its rim is warm. The metal seems to remember every hand that has tried to free it."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `bell_beneath_ice` · rarity `uncommon` · biome `frostmarch`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `rarity`:

```json
"uncommon"
```

- `biomeIds`:

```json
[
  "frostmarch"
]
```


### Fixed choices (authored order)

#### Fixed choice 1: `prise_it_free`

- Presentation label: "Prise the frost bell free"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "elements": [
        "frost"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `ring_it_here`

- Presentation label: "Ring it beneath the ice"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCard"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave_it_sleeping`

- Presentation label: "Leave it sleeping"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `bitter_rematch` · current version `1`

- Source pack: `src/data/content/event-packs/100-global-payoffs.json`
- Identity: `bitter_rematch@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Bitter Rematch"
- Presentation body: "Word of your answered defeat reaches a scarred training yard. Your old rival's mark hangs beside the card that ended the rematch."
- Discovery: `settled_score` · Settled Score · account `future`

- Story: `bitter_rematch` · stage `payoff` · role `payoff`
- Theme `training` · art `theme fallback` · rarity `rare` · biome `any`

### Eligibility

- Readable requirement: `combat.revengeReady({})`
- Typed requirement AST:

```json
{
  "fact": "combat.revengeReady",
  "args": {}
}
```

### Persisted fact dependencies

- `combat.revengeReady` → `RunState.revengeFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

```json
{
  "bindings": [
    {
      "as": "enemy_id",
      "source": "revenge.enemyId"
    },
    {
      "as": "revenge_finisher_card_id",
      "source": "revenge.finisherCardId",
      "optional": true
    }
  ]
}
```

- Binding source dependencies:
  - `revenge.enemyId` → `RunState.revengeFactLedger`
  - `revenge.finisherCardId` → `RunState.revengeFactLedger`

### Fixed choices (always materialized)

#### Fixed choice 1: `spare_rival`

- Presentation label: "Spare the rival's name"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "set",
    "key": "rival_spared",
    "value": true
  }
]
```

- Callback: none

### Seeded choice pool (draw `1`)

#### Pool choice 1: `honor_finisher`

- Presentation label: "Honor the finishing card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "boundSubject": {
      "slot": "revenge_finisher_card_id"
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none

#### Pool choice 2: `claim_rematch_purse`

- Presentation label: "Claim the rematch purse"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 4
}
```

- Typed mutations: none

- Callback: none


## `bloom_behind_the_teeth` · current version `1`

- Source pack: `src/data/content/event-packs/90-thornwild.json`
- Identity: `bloom_behind_the_teeth@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Bloom Behind the Teeth"
- Presentation body: "Past Thornwild's poisoned crown, a flower opens inside the jaw of a stone beast. It knows the nature-bound hand that carried venom through a ruler's fall."
- Discovery: `venom_crown` · Venom Crown · account `future`

- Story: `bloom_behind_the_teeth` · stage `capstone` · role `capstone`
- Theme `cache` · art `theme fallback` · rarity `secret` · biome `thornwild`

### Eligibility

- Readable requirement: `ALL(combat.statusUsed({"status":"poison","result":"bossWin","biomeId":"thornwild"}), board.affinity({"affinityId":"nature"}))`
- Typed requirement AST:

```json
{
  "all": [
    {
      "fact": "combat.statusUsed",
      "args": {
        "status": "poison",
        "result": "bossWin",
        "biomeId": "thornwild"
      }
    },
    {
      "fact": "board.affinity",
      "args": {
        "affinityId": "nature"
      }
    }
  ]
}
```

### Persisted fact dependencies

- `combat.statusUsed` → `RunState.combatFactLedger`
- `board.affinity` → `RunState.pieces`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `400` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `harvest_venom`

- Presentation label: "Harvest the venom"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "poison"
      ]
    },
    {
      "ids": [
        "festering_sliver"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `cultivate_bloom`

- Presentation label: "Cultivate the bloom"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "filter": {
      "where": "any",
      "match": {
        "elements": [
          "nature"
        ]
      }
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations:

```json
[
  {
    "op": "set",
    "key": "venom_bloom",
    "value": "cultivated"
  }
]
```

- Callback: none

#### Fixed choice 3: `leave`

- Presentation label: "Leave the bloom sleeping"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `broken_axle` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `broken_axle@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Broken Axle"
- Presentation body: "A cart lies overturned on the Tolling Road, axle snapped clean through, goods scattered across the ruts. The driver begs anyone passing for a shoulder to right it, promising whatever thanks the wreck still holds — or, if you'd rather not strain yourself, just leave him to sort it out alone."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `help_haul`

- Presentation label: "Help haul the cart upright"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `salvage_properly`

- Presentation label: "Stay and salvage the wreckage properly (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave_him`

- Presentation label: "Leave him to it"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `card_that_remembered` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `card_that_remembered@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Card That Remembered"
- Presentation body: "One skill has followed your victories and struck the final blow against a great foe. At a roadside shrine, the card begins to remember more than ink."
- Discovery: `signature_skill` · Signature Skill · account `future`

- Story: `card_that_remembered` · stage `capstone` · role `capstone`
- Theme `omen` · art `theme fallback` · rarity `secret` · biome `any`

### Eligibility

- Readable requirement: `combat.signatureReady({"winsAtLeast":3,"bossFinisher":true})`
- Typed requirement AST:

```json
{
  "fact": "combat.signatureReady",
  "args": {
    "winsAtLeast": 3,
    "bossFinisher": true
  }
}
```

### Persisted fact dependencies

- `combat.signatureReady` → `RunState.signatureFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `400` · once `run` · cooldown `0` nodes

### Ambient bindings

```json
{
  "bindings": [
    {
      "as": "signature_card_id",
      "source": "signature.cardId"
    }
  ]
}
```

- Binding source dependencies:
  - `signature.cardId` → `RunState.signatureFactLedger`

### Fixed choices (always materialized)

#### Fixed choice 1: `awaken_capstone`

- Presentation label: "Awaken the remembered art"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback edge: `card_that_remembered/awaken_capstone` → `signature_card_capstone@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "signature_card_capstone",
  "eventId": "signature_card_capstone",
  "contentVersion": 1,
  "minDepthDelay": 2,
  "destinationThemes": [
    "forge"
  ],
  "priority": 700,
  "bind": [
    {
      "as": "signature_card_id",
      "source": "signature.cardId"
    }
  ],
  "expiry": {
    "expiresAfterNodes": 20,
    "fallback": {
      "outcome": {
        "kind": "grantGold",
        "amount": 1
      }
    }
  }
}
```

#### Fixed choice 2: `upgrade_signature`

- Presentation label: "Upgrade the signature card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "boundSubject": {
      "slot": "signature_card_id"
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `take_signature_gem`

- Presentation label: "Take a gem that answers"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "all": true
    }
  ]
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `cartographers_missing_road` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `cartographers_missing_road@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Cartographer's Missing Road"
- Presentation body: "A cartographer compares your traveled lands to a map with one deliberate blank. The absent road points toward a biome you have not yet crossed."
- Discovery: `off_the_map` · Off the Map · account `future`

- Story: `cartographers_missing_road` · stage `setup` · role `setup`
- Theme `market` · art `theme fallback` · rarity `rare` · biome `any`

### Eligibility

- Readable requirement: `ALL(journey.visitedBiomes gte 3, journey.completedChains gte 2)`
- Typed requirement AST:

```json
{
  "all": [
    {
      "fact": "journey.visitedBiomes",
      "args": {
        "op": "gte",
        "value": 3
      }
    },
    {
      "fact": "journey.completedChains",
      "args": {
        "op": "gte",
        "value": 2
      }
    }
  ]
}
```

### Persisted fact dependencies

- `journey.visitedBiomes` → `RunState.journeyFactLedger.visitedBiomeIds`
- `journey.completedChains` → `RunState.completedStoryIds`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

```json
{
  "bindings": [
    {
      "as": "destination_biome",
      "source": "journey.futureBiome",
      "candidates": "unvisited_catalog"
    }
  ]
}
```

- Binding source dependencies:
  - `journey.futureBiome` → `RunState.journeyFactLedger.visitedBiomeIds + RunState.map.seed + current node wave/biomeId + RunState.eventInstances[node.id].instanceId`

### Fixed choices (always materialized)

#### Fixed choice 1: `mark_missing_road`

- Presentation label: "Mark the missing road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback edge: `cartographers_missing_road/mark_missing_road` → `missing_road_destination@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "missing_road_destination",
  "eventId": "missing_road_destination",
  "contentVersion": 1,
  "minDepthDelay": 2,
  "destinationThemes": [
    "cache"
  ],
  "priority": 700,
  "bind": [
    {
      "as": "destination_biome",
      "source": "journey.futureBiome",
      "candidates": "unvisited_catalog"
    }
  ],
  "expiry": {
    "expiresAfterNodes": 20,
    "fallback": "discard"
  }
}
```

#### Fixed choice 2: `study_map`

- Presentation label: "Study the map"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `sell_map`

- Presentation label: "Sell the map"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 5
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `cinderheart_crucible` · current version `1`

- Source pack: `src/data/content/event-packs/30-emberwaste.json`
- Identity: `cinderheart_crucible@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Cinderheart Crucible"
- Presentation body: "A smith tends the last furnace between Emberwaste and the road beyond. It wakes only for flame proven in gold or carried through a fallen tyrant."
- Discovery: `tempered_by_fire` · Tempered by Fire · account `future`

- Story: `cinderheart_crucible` · stage `payoff` · role `payoff`
- Theme `forge` · art `theme fallback` · rarity `rare` · biome `emberwaste`

### Eligibility

- Readable requirement: `ANY(owned.card.count({"where":"any","count":1,"tierAtLeast":"gold","match":{"elements":["fire"]}}), combat.statusUsed({"status":"burn","result":"bossWin","biomeId":"emberwaste"}))`
- Typed requirement AST:

```json
{
  "any": [
    {
      "fact": "owned.card.count",
      "args": {
        "where": "any",
        "count": 1,
        "tierAtLeast": "gold",
        "match": {
          "elements": [
            "fire"
          ]
        }
      }
    },
    {
      "fact": "combat.statusUsed",
      "args": {
        "status": "burn",
        "result": "bossWin",
        "biomeId": "emberwaste"
      }
    }
  ]
}
```

### Persisted fact dependencies

- `owned.card.count` → `RunState.pieces/bagSlots/held`
- `combat.statusUsed` → `RunState.combatFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `bank_cinders`

- Presentation label: "Bank the cinders"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool (draw `1`)

#### Pool choice 1: `temper_fire_card`

- Presentation label: "Temper a Fire card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "filter": {
      "where": "any",
      "match": {
        "elements": [
          "fire"
        ]
      }
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none

#### Pool choice 2: `choose_fire_gem`

- Presentation label: "Choose a fire-working gem"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "burn"
      ]
    },
    {
      "ids": [
        "empowering_core",
        "mana_ward_echo"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none


## `cinderworks_regrind` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `cinderworks_regrind@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Regrinding Wheel"
- Presentation body: "Deep in the Cinderworks a bent-backed smith works a stone wheel taller than she is, sparks arcing in long white ribbons. \"Five gold,\" she says without looking up, \"and I'll regrind your gear into something properly better.\" Watch instead, and she won't even blink."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `regrind`

- Presentation label: "Pay 5 gold to regrind your gear"
- Cost: `5` gold
- Typed outcome:

```json
{
  "kind": "upgradeCard"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `watch`

- Presentation label: "Just watch, and walk on"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `circle_of_adepts` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `circle_of_adepts@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Circle of Adepts"
- Presentation body: "Camped along the Muster Road, a circle of robed scholars debates arcane theory beneath a floating lattice of light. Two of their books are single-discipline and copied clean — one fire-work cover to cover, one lightning-work — and the third is the working grimoire, every discipline they practise jammed in together in no order at all. Copy from whichever you like; they're too deep in the argument to care."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `recruit` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `copy_fire`

- Presentation label: "Copy from the fire book"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "fire"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `copy_lightning`

- Presentation label: "Copy from the lightning book"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "lightning"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leaf_through`

- Presentation label: "Leaf through the mixed grimoire"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "properties": [
        "magical"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none


## `collapsed_barrow` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `collapsed_barrow@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Collapsed Barrow"
- Presentation body: "A grave-mound in the Silt Hollows has slumped in on itself, exposing a narrow gap into the dark, silt-choked space below. Old barrows like this sometimes hold a forgotten trinket among the bones — and sometimes hold nothing but the bones themselves."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `crawl_in`

- Presentation label: "Crawl inside"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `dig_further`

- Presentation label: "Dig further for a real find (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `seal_it`

- Presentation label: "Seal it back up and move on"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `crossroads_shrine` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `crossroads_shrine@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Crossroads Shrine"
- Presentation body: "At the heart of the Crossroads Unquiet stands a weathered shrine, carvings split evenly between a rising sun and a crescent moon, and the two faces answer separately: tithe at the sun and what comes back is holy work, every time; scratch the moon-mark instead and it is dark work, every time. Others, less devout, simply pry the shrine apart for scrap."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `tithe`

- Presentation label: "Leave a holy tithe (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "elements": [
        "holy"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `moon_rite`

- Presentation label: "Scratch the moon-mark for dark work (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "elements": [
        "dark"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `deface`

- Presentation label: "Deface it for scrap"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none


## `ember_pit` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `ember_pit@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Ember Pit"
- Presentation body: "A pit of banked coals glows at the edge of the Cinderworks, deep enough to swallow a blade whole and hand it back changed — or hand back nothing, should the fire's mood sour. Thrust your gear in free and chance it, or pay the tender two gold for a safer cinder-gem instead. Three pieces of one grade, fed together, come back out as a single piece of the grade above — the tender lays out three the coals will take, and you choose."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `reach_in`

- Presentation label: "Thrust your gear into the coals"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `pay_tender`

- Presentation label: "Pay 2 gold to steady the coals first"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `feed_the_coals`

- Presentation label: "Feed three matched pieces to the coals"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "mergeCards"
}
```

- Typed mutations: none

- Callback: none


## `factors_ledger` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `factors_ledger@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Factor's Ledger"
- Presentation body: "A trade factor steps into the road with a ledger already open to your page. \"Twelve gold and change, through the stalls and tolls of this road, by my count,\" she says, turning the book so you can see the tally — and it is your tally, coin for coin. \"The road pays its regulars. One credit, one time. Spend it or tear the page.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `requiresTally`:

```json
{
  "stat": "goldSpent",
  "atLeast": 12
}
```


### Fixed choices (authored order)

#### Fixed choice 1: `standing_credit`

- Presentation label: "Take your standing credit"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `bulk_order`

- Presentation label: "Place a bulk order (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `tear_the_page`

- Presentation label: "Tear your page out"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `feathered_cairn` · current version `2`

- Source pack: `src/data/content/event-packs/10-arrowfell.json`
- Identity: `feathered_cairn@v2`
- Retained versions: v1 (schema 2), v2 (schema 3)
- Presentation title: "Feathered Cairn"
- Presentation body: "A low cairn of arrow-marked stones stands beside the road. Black feathers turn in the wind around a set of deliberate cuts, each one pointing toward a fork you cannot yet see."
- Discovery: `far_sighted` · Far-Sighted · account `future`

- Story: `feathered_cairn` · stage `setup` · role `setup`
- Theme `cache` · art `theme fallback` · rarity `uncommon` · biome `arrowfell`

### Eligibility

- Readable requirement: `ANY(board.affinity({"affinityId":"bow"}), owned.card.count({"where":"any","count":3,"match":{"weapons":["bow"]}}))`
- Typed requirement AST:

```json
{
  "any": [
    {
      "fact": "board.affinity",
      "args": {
        "affinityId": "bow"
      }
    },
    {
      "fact": "owned.card.count",
      "args": {
        "where": "any",
        "count": 3,
        "match": {
          "weapons": [
            "bow"
          ]
        }
      }
    }
  ]
}
```

### Persisted fact dependencies

- `board.affinity` → `RunState.pieces`
- `owned.card.count` → `RunState.pieces/bagSlots/held`

### Delivery and selection

- Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `read_feathers`

- Presentation label: "Read the marks"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantMapInfo",
  "bandsAhead": 2
}
```

- Typed mutations: none

- Callback edge: `feathered_cairn/read_feathers` → `feathered_cairn_far_sight@v2`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "feathered_cairn_far_sight",
  "eventId": "feathered_cairn_far_sight",
  "contentVersion": 2,
  "minDepthDelay": 2,
  "destinationThemes": [
    "omen"
  ],
  "destinationBiomeIds": [
    "arrowfell"
  ],
  "priority": 700,
  "bind": [],
  "expiry": {
    "expiresAfterNodes": 20,
    "fallback": "discard"
  }
}
```

#### Fixed choice 2: `take_fletchers_gift`

- Presentation label: "Take a Bow card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "weapons": [
        "bow"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave`

- Presentation label: "Leave"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `feathered_cairn_far_sight` · current version `2`

- Source pack: `src/data/content/event-packs/10-arrowfell.json`
- Identity: `feathered_cairn_far_sight@v2`
- Retained versions: v1 (schema 2), v2 (schema 3)
- Presentation title: "Far Sight"
- Presentation body: "At the next omen-stone, the cairn's cuts return in the dust. They trace a safer fork ahead, with one loose mark pointing toward a small hidden cache."
- Discovery: none

- Story: `feathered_cairn` · stage `callback` · role `callback`
- Theme `omen` · art `theme fallback` · rarity `uncommon` · biome `arrowfell`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"feathered_cairn_far_sight"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "feathered_cairn_far_sight"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `follow_mark`

- Presentation label: "Follow the marked road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantMapInfo",
  "bandsAhead": 3
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "feathered_cairn"
  }
]
```

- Callback: none

#### Fixed choice 2: `take_cache`

- Presentation label: "Take the hidden cache"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "ids": [
        "concussive_shot_echo",
        "rending_sliver",
        "weak_point_sliver"
      ]
    }
  ]
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "feathered_cairn"
  }
]
```

- Callback: none

#### Fixed choice 3: `ignore_mark`

- Presentation label: "Keep your own course"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "feathered_cairn"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `fences_offer` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `fences_offer@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Fence's Offer"
- Presentation body: "A fence works a folding table at the shadowed edge of the Tolling Road, goods of dubious origin spread out under a stained cloth. \"Coin, or a stone — your pick, no questions asked either way.\" She taps the table, already bored with the transaction."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `take_coin`

- Presentation label: "Take the coin"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 2
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_stone`

- Presentation label: "Take the stone instead (1 gold)"
- Cost: `1` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none


## `field_medic` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `field_medic@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Field Medic"
- Presentation body: "A field medic has set up a triage tent at the roadside among the Muster Road's camps. Her herb satchel is sorted and green to the last cutting — nature work, all of it — while the rest of the tent is whatever keeps people upright: salves, wraps, mending songs, half-taught steadying tricks. Or, if none of it is what you need, she'll simply spare a little coin instead."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `recruit` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `herb_satchel`

- Presentation label: "Take from her nature satchel"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "nature"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `learn_remedies`

- Presentation label: "Learn her mending remedies"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "archetypes": [
        "healing",
        "support"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `take_coin`

- Presentation label: "Take the coin instead"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 2
}
```

- Typed mutations: none

- Callback: none


## `flaw_finder` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `flaw_finder@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Flaw-Finder"
- Presentation body: "A jeweler's loupe glints from a stall no wider than its own strongbox on the Tolling Road. \"Every stone has a flaw,\" its owner says, not as an apology — her whole tray is cut to FIND them, facets ground to open a weakness and hold it open. She buys as readily as she sells, if you are carrying a stone you are done with."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `expose_tray`

- Presentation label: "Buy from the flaw-cut tray (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "expose"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `sell_flawed`

- Presentation label: "Sell her a stone of your own"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "sellGem"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `walk_on`

- Presentation label: "Keep your flaws to yourself"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `fortune_teller` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `fortune_teller@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Fortune-Teller"
- Presentation body: "A veiled fortune-teller crouches at the crossroads shrine, cards fanned across a cracked marble slab, and offers a free reading of what's coming — the shrine only asks you trust what it shows. Cross her palm with silver instead, and she presses a smooth luck-stone into your hand."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `free_reading`

- Presentation label: "Take the free reading"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `cross_palm`

- Presentation label: "Cross her palm with 2 gold"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none


## `gambler` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `gambler@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Gambler"
- Presentation body: "In the shadow of the crossroads shrine, a hooded figure shuffles cards at a folding table, coins stacked at her elbow, never once looking up as travelers pass. \"Stake two gold on a safe cut,\" she says, \"or five on a bold one — walk off with more than you sat down with, either way. Or don't play at all — some prefer to keep what little they have.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `stake_small`

- Presentation label: "Stake 2 gold on a safe cut"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `stake_big`

- Presentation label: "Stake 5 gold on a bold cut"
- Cost: `5` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 9
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `walk_away`

- Presentation label: "Walk away"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `gemsellers_mishap` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `gemsellers_mishap@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Gemseller's Mishap"
- Presentation body: "A peddler's cart hits a sinking rut at the edge of the Silt Hollows and her satchel bursts, scattering uncut gems across the mud. She scrambles after them, cursing — there's more here than she can gather alone, and more than a few have already rolled to rest against your boots."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `help`

- Presentation label: "Help her gather them"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `rifle`

- Presentation label: "Rifle through the spill (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none


## `gilded_detour` · current version `1`

- Source pack: `src/data/content/event-packs/100-global-payoffs.json`
- Identity: `gilded_detour@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Gilded Detour"
- Presentation body: "A broker's bright pavilion blocks the road. The richest travelers are invited to turn a little fortune into something rarer."
- Discovery: `heavy_purse` · Heavy Purse · account `future`

- Story: `gilded_detour` · stage `payoff` · role `payoff`
- Theme `market` · art `theme fallback` · rarity `uncommon` · biome `any`

### Eligibility

- Readable requirement: `ALL(wallet.current gte 15, run.tally.goldSpent gte 10)`
- Typed requirement AST:

```json
{
  "all": [
    {
      "fact": "wallet.current",
      "args": {
        "op": "gte",
        "value": 15
      }
    },
    {
      "fact": "run.tally",
      "args": {
        "stat": "goldSpent",
        "op": "gte",
        "value": 10
      }
    }
  ]
}
```

### Persisted fact dependencies

- `wallet.current` → `RunState.gold`
- `run.tally` → `RunState.stats.goldSpent`

### Delivery and selection

- Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `keep_fortune`

- Presentation label: "Keep your fortune"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool (draw `1`)

#### Pool choice 1: `buy_gold_upgrade`

- Presentation label: "Commission an upgrade"
- Cost: `8` gold
- Typed outcome:

```json
{
  "kind": "upgradeCard"
}
```

- Typed mutations: none

- Callback: none

#### Pool choice 2: `buy_premium_gem`

- Presentation label: "Choose a premium gem"
- Cost: `6` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "all": true
    }
  ]
}
```

- Typed mutations: none

- Callback: none


## `hermits_riddle` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `hermits_riddle@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Hermit's Riddle"
- Presentation body: "On a mossy boulder overlooking the Hollow Yard, a hermit sits cross-legged, riddle already half-spoken before you've even stopped walking. Answer it right, she says, and you'll understand something about yourself no sparring ring could teach. Answer wrong, and you'll simply keep walking, no worse for it."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `training` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `answer`

- Presentation label: "Answer the riddle"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `press_further`

- Presentation label: "Press her for a deeper truth (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `walk_away`

- Presentation label: "Walk away"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `last_hedge` · current version `1`

- Source pack: `src/data/content/event-packs/70-pikewold.json`
- Identity: `last_hedge@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Last Hedge"
- Presentation body: "At Pikewold's far boundary, a veteran holds the last living hedge with one weathered lance and a lesson in refusing the road's advance."
- Discovery: `hold_the_line` · Hold the Line · account `future`

- Story: `last_hedge` · stage `setup` · role `setup`
- Theme `training` · art `theme fallback` · rarity `uncommon` · biome `pikewold`

### Eligibility

- Readable requirement: `ALL(owned.card.count({"where":"any","count":1,"match":{"weapons":["lance"]}}), owned.card.count({"where":"any","count":1,"match":{"archetypes":["defensive"]}}))`
- Typed requirement AST:

```json
{
  "all": [
    {
      "fact": "owned.card.count",
      "args": {
        "where": "any",
        "count": 1,
        "match": {
          "weapons": [
            "lance"
          ]
        }
      }
    },
    {
      "fact": "owned.card.count",
      "args": {
        "where": "any",
        "count": 1,
        "match": {
          "archetypes": [
            "defensive"
          ]
        }
      }
    }
  ]
}
```

### Persisted fact dependencies

- `owned.card.count` → `RunState.pieces/bagSlots/held`

### Delivery and selection

- Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `take_lance_lesson`

- Presentation label: "Take the Lance lesson"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "weapons": [
        "lance"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_hedge_ward`

- Presentation label: "Take the hedge ward"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "shield",
        "guard",
        "ward"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `drill_then_leave`

- Presentation label: "Drill, then leave"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `last_light_at_roads_end` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `last_light_at_roads_end@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Last Light at Road's End"
- Presentation body: "After the last defeat, a lone lantern burns where the road divides. Its keeper offers strength for the safer path—or a spark for the unlit one."
- Discovery: `last_light` · Last Light · account `future`

- Story: `last_light_at_roads_end` · stage `setup` · role `setup`
- Theme `omen` · art `theme fallback` · rarity `rare` · biome `any`

### Eligibility

- Readable requirement: `ALL(lives.current eq 1, combat.recentLoss({"withinDepth":3}), NOT(owned.card.count({"where":"any","count":1,"match":{"archetypes":["healing"]}})))`
- Typed requirement AST:

```json
{
  "all": [
    {
      "fact": "lives.current",
      "args": {
        "op": "eq",
        "value": 1
      }
    },
    {
      "fact": "combat.recentLoss",
      "args": {
        "withinDepth": 3
      }
    },
    {
      "not": {
        "fact": "owned.card.count",
        "args": {
          "where": "any",
          "count": 1,
          "match": {
            "archetypes": [
              "healing"
            ]
          }
        }
      }
    }
  ]
}
```

### Persisted fact dependencies

- `lives.current` → `RunState.lives`
- `combat.recentLoss` → `RunState.combatFactLedger + current event node`
- `owned.card.count` → `RunState.pieces/bagSlots/held`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `take_healing_card`

- Presentation label: "Carry a healer's lesson"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "healing"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_recovery_gold`

- Presentation label: "Take the keeper's road money"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `risk_last_road`

- Presentation label: "Risk the unlit road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback edge: `last_light_at_roads_end/risk_last_road` → `last_light_secret_route@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "last_light_secret_route",
  "eventId": "last_light_secret_route",
  "contentVersion": 1,
  "minDepthDelay": 2,
  "destinationThemes": [
    "omen"
  ],
  "priority": 700,
  "bind": [],
  "expiry": {
    "expiresAfterNodes": 12,
    "fallback": "discard"
  }
}
```

### Seeded choice pool

- None.

## `last_light_secret_route` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `last_light_secret_route@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Unlit Road"
- Presentation body: "The lantern's spark reveals a hidden mile between the known roads. It offers one last cache before the darkness closes again."
- Discovery: none

- Story: `last_light_at_roads_end` · stage `callback` · role `callback`
- Theme `omen` · art `theme fallback` · rarity `secret` · biome `any`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"last_light_secret_route"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "last_light_secret_route"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `take_last_cache`

- Presentation label: "Take the last cache"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "healing"
      ]
    }
  ],
  "maxTier": "diamond"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "last_light_at_roads_end"
  }
]
```

- Callback: none

#### Fixed choice 2: `walk_for_strength`

- Presentation label: "Walk it for strength"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "last_light_at_roads_end"
  }
]
```

- Callback: none

#### Fixed choice 3: `turn_back`

- Presentation label: "Turn back alive"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "last_light_at_roads_end"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `mirror_of_the_board` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `mirror_of_the_board@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Mirror of the Board"
- Presentation body: "A road-forge holds a mirror wide enough for your whole formation. It reflects a single shared purpose more clearly than any face."
- Discovery: `one_purpose` · One Purpose · account `future`

- Story: `mirror_of_the_board` · stage `setup` · role `setup`
- Theme `forge` · art `theme fallback` · rarity `secret` · biome `any`

### Eligibility

- Readable requirement: `ALL(ANY(board.isMonoType({"typeKind":"weapon"}), board.isMonoType({"typeKind":"element"})), owned.card.count({"where":"board","count":1,"tierAtLeast":"gold","match":{"archetypes":["offense","defensive","healing","support","debuff"]}}), run.tally.bossesCleared gte 1)`
- Typed requirement AST:

```json
{
  "all": [
    {
      "any": [
        {
          "fact": "board.isMonoType",
          "args": {
            "typeKind": "weapon"
          }
        },
        {
          "fact": "board.isMonoType",
          "args": {
            "typeKind": "element"
          }
        }
      ]
    },
    {
      "fact": "owned.card.count",
      "args": {
        "where": "board",
        "count": 1,
        "tierAtLeast": "gold",
        "match": {
          "archetypes": [
            "offense",
            "defensive",
            "healing",
            "support",
            "debuff"
          ]
        }
      }
    },
    {
      "fact": "run.tally",
      "args": {
        "stat": "bossesCleared",
        "op": "gte",
        "value": 1
      }
    }
  ]
}
```

### Persisted fact dependencies

- `board.isMonoType` → `RunState.pieces`
- `owned.card.count` → `RunState.pieces/bagSlots/held`
- `run.tally` → `RunState.bossesCleared`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `400` · once `run` · cooldown `0` nodes

### Ambient bindings

```json
{
  "bindings": [
    {
      "as": "mono_type",
      "source": "board.monoType"
    }
  ]
}
```

- Binding source dependencies:
  - `board.monoType` → `RunState.pieces`

### Fixed choices (always materialized)

#### Fixed choice 1: `perfect_reflection`

- Presentation label: "Perfect the reflection"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "boundSubject": {
      "slot": "mono_type"
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_affinity_gem`

- Presentation label: "Take an affinity gem"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "boundSubject": {
    "slot": "mono_type",
    "cases": [
      {
        "when": {
          "typeKind": "weapon",
          "type": "sword"
        },
        "filter": [
          {
            "ids": [
              "follow_through_echo",
              "bramble_sliver",
              "iron_bulwark_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "axe"
        },
        "filter": [
          {
            "ids": [
              "armor_break_echo",
              "shield_splitter_echo",
              "rending_sliver"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "lance"
        },
        "filter": [
          {
            "ids": [
              "ward_of_silence_echo",
              "millstone_sliver",
              "crippling_strike_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "bow"
        },
        "filter": [
          {
            "ids": [
              "concussive_shot_echo",
              "weak_point_sliver",
              "swift_charm"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "beast"
        },
        "filter": [
          {
            "ids": [
              "venom_fang_echo",
              "leeching_fang_echo",
              "battle_howl_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "fire"
        },
        "filter": [
          {
            "ids": [
              "fireball_echo",
              "empowering_core",
              "mana_ward_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "frost"
        },
        "filter": [
          {
            "ids": [
              "frost_ward_echo",
              "mana_ward_echo",
              "time_crystal_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "lightning"
        },
        "filter": [
          {
            "ids": [
              "time_crystal_echo",
              "battle_howl_echo",
              "quickening_sliver"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "nature"
        },
        "filter": [
          {
            "ids": [
              "bramble_sliver",
              "second_wind_echo",
              "time_crystal_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "holy"
        },
        "filter": [
          {
            "ids": [
              "mending_light_echo",
              "purify_echo",
              "ward_of_silence_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "dark"
        },
        "filter": [
          {
            "ids": [
              "hex_of_frailty_echo",
              "blunting_sliver",
              "slow_hex_echo"
            ]
          }
        ]
      }
    ]
  }
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `enter_mirror`

- Presentation label: "Enter the mirror road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback edge: `mirror_of_the_board/enter_mirror` → `mirror_transformation@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "mirror_transformation",
  "eventId": "mirror_transformation",
  "contentVersion": 1,
  "minDepthDelay": 3,
  "destinationThemes": [
    "forge"
  ],
  "priority": 700,
  "bind": [
    {
      "as": "mono_type",
      "source": "board.monoType"
    }
  ],
  "expiry": {
    "expiresAfterNodes": 20,
    "fallback": "discard"
  }
}
```

### Seeded choice pool

- None.

## `mirror_transformation` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `mirror_transformation@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Beyond the Board's Mirror"
- Presentation body: "The reflection returns at another forge, still holding the affinity it witnessed. One final transformation waits behind the silvered road."
- Discovery: none

- Story: `mirror_of_the_board` · stage `callback` · role `callback`
- Theme `forge` · art `theme fallback` · rarity `secret` · biome `any`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"mirror_transformation"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "mirror_transformation"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

```json
{
  "acceptsBindings": [
    "mono_type"
  ]
}
```

### Fixed choices (always materialized)

#### Fixed choice 1: `transform_card`

- Presentation label: "Transform the reflection"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "boundSubject": {
      "slot": "mono_type"
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "mirror_of_the_board"
  }
]
```

- Callback: none

#### Fixed choice 2: `take_mirror_gem`

- Presentation label: "Take the reflected gem"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "boundSubject": {
    "slot": "mono_type",
    "cases": [
      {
        "when": {
          "typeKind": "weapon",
          "type": "sword"
        },
        "filter": [
          {
            "ids": [
              "follow_through_echo",
              "bramble_sliver",
              "iron_bulwark_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "axe"
        },
        "filter": [
          {
            "ids": [
              "armor_break_echo",
              "shield_splitter_echo",
              "rending_sliver"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "lance"
        },
        "filter": [
          {
            "ids": [
              "ward_of_silence_echo",
              "millstone_sliver",
              "crippling_strike_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "bow"
        },
        "filter": [
          {
            "ids": [
              "concussive_shot_echo",
              "weak_point_sliver",
              "swift_charm"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "weapon",
          "type": "beast"
        },
        "filter": [
          {
            "ids": [
              "venom_fang_echo",
              "leeching_fang_echo",
              "battle_howl_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "fire"
        },
        "filter": [
          {
            "ids": [
              "fireball_echo",
              "empowering_core",
              "mana_ward_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "frost"
        },
        "filter": [
          {
            "ids": [
              "frost_ward_echo",
              "mana_ward_echo",
              "time_crystal_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "lightning"
        },
        "filter": [
          {
            "ids": [
              "time_crystal_echo",
              "battle_howl_echo",
              "quickening_sliver"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "nature"
        },
        "filter": [
          {
            "ids": [
              "bramble_sliver",
              "second_wind_echo",
              "time_crystal_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "holy"
        },
        "filter": [
          {
            "ids": [
              "mending_light_echo",
              "purify_echo",
              "ward_of_silence_echo"
            ]
          }
        ]
      },
      {
        "when": {
          "typeKind": "element",
          "type": "dark"
        },
        "filter": [
          {
            "ids": [
              "hex_of_frailty_echo",
              "blunting_sliver",
              "slow_hex_echo"
            ]
          }
        ]
      }
    ]
  }
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "mirror_of_the_board"
  }
]
```

- Callback: none

#### Fixed choice 3: `break_mirror`

- Presentation label: "Break the mirror"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "mirror_of_the_board"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `missing_road_destination` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `missing_road_destination@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Missing Road"
- Presentation body: "The cartographer's mark appears beneath your feet in the biome it named. For a moment, the road opens onto a cache hidden outside every common map."
- Discovery: none

- Story: `cartographers_missing_road` · stage `callback` · role `callback`
- Theme `cache` · art `theme fallback` · rarity `rare` · biome bound persisted `destination_biome` singleton

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"missing_road_destination"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "missing_road_destination"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

```json
{
  "acceptsBindings": [
    "destination_biome"
  ]
}
```

### Fixed choices (always materialized)

#### Fixed choice 1: `open_hidden_map`

- Presentation label: "Open the hidden route"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantMapInfo",
  "bandsAhead": 3
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "cartographers_missing_road"
  }
]
```

- Callback: none

#### Fixed choice 2: `claim_road_cache`

- Presentation label: "Claim the road cache"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "offense",
        "defensive",
        "healing",
        "support",
        "debuff"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "cartographers_missing_road"
  }
]
```

- Callback: none

#### Fixed choice 3: `leave_road_missing`

- Presentation label: "Leave it missing"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "cartographers_missing_road"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `moon_scented_hunt` · current version `1`

- Source pack: `src/data/content/event-packs/50-howlmoor.json`
- Identity: `moon_scented_hunt@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Moon Hunt"
- Presentation body: "The silver trail reaches its quarry beneath a low moon. Hunter and hunted wait for you to decide how the chase ends."
- Discovery: none

- Story: `moon_scented_trail` · stage `callback` · role `callback`
- Theme `recruit` · art `theme fallback` · rarity `rare` · biome `howlmoor`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"moon_scented_hunt"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "moon_scented_hunt"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `finish_hunt`

- Presentation label: "Finish the moon hunt"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "filter": {
      "where": "any",
      "match": {
        "weapons": [
          "beast"
        ]
      }
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "moon_scented_trail"
  }
]
```

- Callback: none

#### Fixed choice 2: `share_quarry`

- Presentation label: "Share the quarry"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "ids": [
        "battle_howl_echo",
        "leeching_fang_echo",
        "bloodscent_sliver"
      ]
    }
  ]
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "moon_scented_trail"
  }
]
```

- Callback: none

#### Fixed choice 3: `release_quarry`

- Presentation label: "Release the quarry"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "set",
    "key": "moon_quarry_released",
    "value": true
  },
  {
    "op": "completeStory",
    "storyId": "moon_scented_trail"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `moon_scented_trail` · current version `1`

- Source pack: `src/data/content/event-packs/50-howlmoor.json`
- Identity: `moon_scented_trail@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Moon-Scented Trail"
- Presentation body: "Silver tracks cross the Howlmoor road and vanish into heather. The trail bends for a hunter who runs with beasts—or has already broken a pack."
- Discovery: `hunted_the_hunter` · Hunted the Hunter · account `future`

- Story: `moon_scented_trail` · stage `setup` · role `setup`
- Theme `recruit` · art `theme fallback` · rarity `uncommon` · biome `howlmoor`

### Eligibility

- Readable requirement: `ANY(board.affinity({"affinityId":"beast"}), combat.enemyDefeated({"weaponAffinity":"beast","atLeast":3}))`
- Typed requirement AST:

```json
{
  "any": [
    {
      "fact": "board.affinity",
      "args": {
        "affinityId": "beast"
      }
    },
    {
      "fact": "combat.enemyDefeated",
      "args": {
        "weaponAffinity": "beast",
        "atLeast": 3
      }
    }
  ]
}
```

### Persisted fact dependencies

- `board.affinity` → `RunState.pieces`
- `combat.enemyDefeated` → `RunState.combatFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `follow_hunt`

- Presentation label: "Follow the hunt"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "weapons": [
        "beast"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations: none

- Callback edge: `moon_scented_trail/follow_hunt` → `moon_scented_hunt@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "moon_scented_hunt",
  "eventId": "moon_scented_hunt",
  "contentVersion": 1,
  "minDepthDelay": 3,
  "destinationThemes": [
    "recruit"
  ],
  "destinationBiomeIds": [
    "howlmoor"
  ],
  "priority": 700,
  "bind": [],
  "expiry": {
    "expiresAfterNodes": 15,
    "fallback": "discard"
  }
}
```

#### Fixed choice 2: `take_trophy`

- Presentation label: "Take a hunter's trophy"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "ids": [
        "battle_howl_echo",
        "leeching_fang_echo",
        "bloodscent_sliver"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave`

- Presentation label: "Let the trail fade"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `names_under_stone` · current version `1`

- Source pack: `src/data/content/event-packs/20-duskbarrow.json`
- Identity: `names_under_stone@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Names Under Stone"
- Presentation body: "Beyond Duskbarrow's fallen lord, a mile of grave markers leans toward the road. One stone speaks a name that only a bearer of dark craft could answer."
- Discovery: `the_grave_answers` · The Grave Answers · account `future`

- Story: `names_under_stone` · stage `setup` · role `setup`
- Theme `omen` · art `theme fallback` · rarity `rare` · biome `duskbarrow`

### Eligibility

- Readable requirement: `ALL(combat.biomeBossDefeated({"biomeId":"duskbarrow"}), owned.card.count({"where":"any","count":1,"match":{"elements":["dark"]}}))`
- Typed requirement AST:

```json
{
  "all": [
    {
      "fact": "combat.biomeBossDefeated",
      "args": {
        "biomeId": "duskbarrow"
      }
    },
    {
      "fact": "owned.card.count",
      "args": {
        "where": "any",
        "count": 1,
        "match": {
          "elements": [
            "dark"
          ]
        }
      }
    }
  ]
}
```

### Persisted fact dependencies

- `combat.biomeBossDefeated` → `RunState.combatFactLedger`
- `owned.card.count` → `RunState.pieces/bagSlots/held`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `raise_dark_name`

- Presentation label: "Raise the dark name"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "filter": {
      "where": "any",
      "match": {
        "elements": [
          "dark"
        ]
      }
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_grave_silver`

- Presentation label: "Take the grave silver"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 4
}
```

- Typed mutations:

```json
[
  {
    "op": "set",
    "key": "grave_path",
    "value": "opened"
  }
]
```

- Callback edge: `names_under_stone/take_grave_silver` → `names_under_stone_answer@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "names_under_stone_answer",
  "eventId": "names_under_stone_answer",
  "contentVersion": 1,
  "minDepthDelay": 3,
  "destinationThemes": [
    "omen"
  ],
  "priority": 700,
  "bind": [],
  "expiry": {
    "expiresAfterNodes": 20,
    "fallback": "discard"
  }
}
```

#### Fixed choice 3: `leave`

- Presentation label: "Leave the names buried"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.

## `names_under_stone_answer` · current version `1`

- Source pack: `src/data/content/event-packs/20-duskbarrow.json`
- Identity: `names_under_stone_answer@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Grave Answers"
- Presentation body: "Three roads later, the stolen silver rings against a nameless marker. The earth answers in a voice that has followed beneath every mile."
- Discovery: none

- Story: `names_under_stone` · stage `callback` · role `callback`
- Theme `omen` · art `theme fallback` · rarity `rare` · biome `any`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"names_under_stone_answer"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "names_under_stone_answer"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `answer_name`

- Presentation label: "Answer the buried name"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "elements": [
        "dark"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations:

```json
[
  {
    "op": "set",
    "key": "grave_path",
    "value": "answered"
  },
  {
    "op": "completeStory",
    "storyId": "names_under_stone"
  }
]
```

- Callback: none

#### Fixed choice 2: `take_silver`

- Presentation label: "Take the last grave silver"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "names_under_stone"
  }
]
```

- Callback: none

#### Fixed choice 3: `close_stone`

- Presentation label: "Close the stone"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "names_under_stone"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `overloaded_caravan` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `overloaded_caravan@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Overloaded Caravan"
- Presentation body: "A merchant caravan sits axle-deep in the mud of the Tolling Road, its driver frantic as the sun sinks lower. A bundle of bowstaves is lashed to the tailgate where anyone can see it; the trunks behind it are packed with no order at all and could hold anything. Push, and she'll let you take from either — or just toss you a coin for a shoulder at the wheel."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `bow_staves`

- Presentation label: "Take a bow off the tailgate (1 gold)"
- Cost: `1` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "bow"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `rummage`

- Presentation label: "Push, then rummage the trunks (1 gold)"
- Cost: `1` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `push`

- Presentation label: "Just push for a coin"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none


## `pyre_watch` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `pyre_watch@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Pyre-Watch"
- Presentation body: "A watch-fire burns at the crossroads for the road's dead, tended by a hooded keeper who does not ask whose name you are carrying. The fire already knows: you left a life on a field behind you, and the pyre-watch keeps the old custom for anyone who limps past it — alms for the mourner, or arms for the living."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `requiresTally`:

```json
{
  "stat": "livesLost",
  "atLeast": 1
}
```


### Fixed choices (authored order)

#### Fixed choice 1: `alms`

- Presentation label: "Accept the mourner's alms"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 2
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `arm_the_living`

- Presentation label: "Buy arms for the living (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "defensive"
      ]
    }
  ],
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `let_it_burn`

- Presentation label: "Let it burn, and walk on"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `quartermasters_error` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `quartermasters_error@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Quartermaster's Error"
- Presentation body: "A tired quartermaster at the edge of the Silt Hollows shoves a requisition ledger across the counter, muttering about a shipment that was never meant to reach you. \"Take the armor plating — it's all defensive issue, wards and guards and nothing that hits back,\" he says, \"or the loose gemstone in the corner. Don't care which — just take it and go before someone notices.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `take_armor`

- Presentation label: "Take the armor plating"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "defensive"
      ]
    }
  ],
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_gem`

- Presentation label: "Take the loose gemstone (1 gold)"
- Cost: `1` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none


## `recruiter` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `recruiter@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Recruiter"
- Presentation body: "A weapons broker flags you down from beneath a striped awning at the roadside edge of the Muster Road, arms full of blades and bowstrings still warm from the last camp. \"Swords are racked on their own — anything else, you take your chances with what's in the cart,\" he grins, laying out a row of five either way. \"Or take the coin instead. I won't haggle.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `recruit` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `pick_sword`

- Presentation label: "Browse the sword rack"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "sword"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `pick_weapon`

- Presentation label: "Dig through the mixed cart"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "sword",
        "axe",
        "lance",
        "bow",
        "beast"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `take_coin`

- Presentation label: "Take the coin instead"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 2
}
```

- Typed mutations: none

- Callback: none


## `red_standard` · current version `1`

- Source pack: `src/data/content/event-packs/60-ironmoot.json`
- Identity: `red_standard@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Red Standard"
- Presentation body: "An old Ironmoot standard hangs above a silent drill yard. Three victories won beneath the axe are stitched into its ragged edge."
- Discovery: `under_the_red_standard` · Under the Red Standard · account `future`

- Story: `red_standard` · stage `payoff` · role `payoff`
- Theme `training` · art `theme fallback` · rarity `rare` · biome `ironmoot`

### Eligibility

- Readable requirement: `combat.affinityWin({"affinityId":"axe","atLeast":3,"biomeId":"ironmoot"})`
- Typed requirement AST:

```json
{
  "fact": "combat.affinityWin",
  "args": {
    "affinityId": "axe",
    "atLeast": 3,
    "biomeId": "ironmoot"
  }
}
```

### Persisted fact dependencies

- `combat.affinityWin` → `RunState.combatFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `sell_standard`

- Presentation label: "Sell the standard"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool (draw `1`)

#### Pool choice 1: `claim_axe_draft`

- Presentation label: "Claim the Axe draft"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "axe"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Pool choice 2: `hone_axe`

- Presentation label: "Hone an Axe card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "filter": {
      "where": "any",
      "match": {
        "weapons": [
          "axe"
        ]
      }
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none


## `retiring_smith` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `retiring_smith@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Smith's Last Commission"
- Presentation body: "At the Cinderworks' last working forge, an old smith banks her fire for good, hammer half-wrapped in oilcloth already. \"Six gold,\" she offers, \"for one more piece done right before I go.\" Decline, and she'll finish wrapping her tools and vanish into the dusk without you."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `commission`

- Presentation label: "Pay 6 gold for one last commission"
- Cost: `6` gold
- Typed outcome:

```json
{
  "kind": "upgradeCard"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `let_her_go`

- Presentation label: "Let her go"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `ruined_anvil` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `ruined_anvil@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Ruined Anvil"
- Presentation body: "One of the Cinderworks' many forges stands half-collapsed and long abandoned, its anvil cracked but still serviceable. A rough blade sits cooling on the workbench, yours for the taking — or, for three gold toward proper tools, you could retemper it into something sturdier before you go. The anvil will still take a heavier job for nothing: lay three pieces of the SAME grade across it and they beat down into one piece of the next grade up, and the scrap left over decides which three you get to pick from."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `take_rough`

- Presentation label: "Take the rough blade as-is"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantCard",
  "cardId": "sword_slash",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `retemper`

- Presentation label: "Pay 3 gold to retemper it"
- Cost: `3` gold
- Typed outcome:

```json
{
  "kind": "grantCard",
  "cardId": "sword_slash",
  "tier": "silver"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `beat_together`

- Presentation label: "Beat three matched pieces into one"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "mergeCards"
}
```

- Typed mutations: none

- Callback: none


## `sellsword_camp` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `sellsword_camp@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Sellsword Camp"
- Presentation body: "A ring of tents and cookfires along the Muster Road marks a sellsword company between contracts. Their captain sizes you up and waves at the camp: the axes stand in their own rack by the mess tent, company-issue and nothing but axes, while the armory tent behind it is steel of every make thrown in together. Or, if you'd rather not linger, a coin for the road."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `recruit` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `browse_axes`

- Presentation label: "Borrow from the axe rack"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "axe"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `browse_armory`

- Presentation label: "Browse the mixed armory tent"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "sword",
        "axe",
        "lance",
        "bow",
        "beast"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `take_coin`

- Presentation label: "Take a coin for the road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 2
}
```

- Typed mutations: none

- Callback: none


## `signature_card_capstone` · current version `1`

- Source pack: `src/data/content/event-packs/110-global-chains.json`
- Identity: `signature_card_capstone@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Remembered Art"
- Presentation body: "At the next forge, the bound card names the victories that shaped it. Its answer is a final refinement—or permission to rest."
- Discovery: none

- Story: `card_that_remembered` · stage `callback` · role `callback`
- Theme `forge` · art `theme fallback` · rarity `secret` · biome `any`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"signature_card_capstone"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "signature_card_capstone"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

```json
{
  "acceptsBindings": [
    "signature_card_id"
  ]
}
```

### Fixed choices (always materialized)

#### Fixed choice 1: `perfect_signature`

- Presentation label: "Perfect the remembered card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "boundSubject": {
      "slot": "signature_card_id"
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "card_that_remembered"
  }
]
```

- Callback: none

#### Fixed choice 2: `take_answering_gem`

- Presentation label: "Take its answering gem"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "all": true
    }
  ]
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "card_that_remembered"
  }
]
```

- Callback: none

#### Fixed choice 3: `let_memory_rest`

- Presentation label: "Let the memory rest"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "card_that_remembered"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `sparring_circle` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `sparring_circle@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Sparring Circle"
- Presentation body: "A ring of packed dirt marks the heart of the Hollow Yard, worn smooth by years of practice bouts. A scarred instructor waves you over: \"Two gold buys you a real lesson. Or help yourself to the practice rack — it's every kind of gear anyone ever left here, all of it meant for hitting things, and no two pieces alike.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `training` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `lesson`

- Presentation label: "Pay 2 gold for a real lesson"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `spare_blade`

- Presentation label: "Help yourself to the mixed rack"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "offense"
      ]
    }
  ],
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none


## `sweep_drill` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `sweep_drill@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Sweep Drill"
- Presentation body: "A grizzled instructor has cordoned off a stretch of the Hollow Yard for wide, sweeping cuts alone — the kind that catch whatever's standing next to your actual target, whether you meant it to or not. \"Newer recruits call it splash,\" she snorts, resting a training axe on her shoulder. \"I call it not missing twice. Two gold, and I'll teach you the sweep itself.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `training` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `proper_stance`

- Presentation label: "Pay 2 gold to learn the sweep"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "grantCard",
  "cardId": "shockwave_slam",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `scavenge`

- Presentation label: "Scavenge the practice yard for scraps"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `skip`

- Presentation label: "Skip the drill"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `the_bell_unbound` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `the_bell_unbound@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Bell Unbound"
- Presentation body: "In the Emberwaste the Frostmarch bell finally thaws. Steam curls from its silver throat, and it speaks the name you once gave it."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `bell_unbound` · rarity `secret` · biome `emberwaste`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `rarity`:

```json
"secret"
```

- `biomeIds`:

```json
[
  "emberwaste"
]
```

- `requiresAll`:

```json
[
  {
    "kind": "resolution",
    "eventId": "bell_beneath_ice",
    "choiceIds": [
      "prise_it_free"
    ]
  },
  {
    "kind": "resolution",
    "eventId": "the_second_toll",
    "choiceIds": [
      "answer_the_bell"
    ]
  }
]
```


### Fixed choices (authored order)

#### Fixed choice 1: `temper_the_voice`

- Presentation label: "Temper its Frost voice in the coals"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "frost"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `sell_the_silver`

- Presentation label: "Sell the silver tongue"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 5
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `let_it_ring_free`

- Presentation label: "Let it ring and walk away"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `the_lands_measure` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `the_lands_measure@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Land's Measure"
- Presentation body: "A surveyor's drop-box juts from the mud of the Silt Hollows, stenciled with the mark of whatever country you are crossing. The locals cache what the land makes, and any land worth naming only makes one thing well — the box is local work to the last piece. Lashed underneath it rides a hunter's kit, picked to hurt what lives here. When anything can."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `local_make`

- Presentation label: "Take the local make (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filterFrom": "biomeLean",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `hunters_edge`

- Presentation label: "Take the hunter's kit (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filterFrom": "biomeCounter",
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `gather_stones`

- Presentation label: "Pocket the loose stones"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none


## `the_lapidary` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `the_lapidary@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Lapidary"
- Presentation body: "A lapidary has set up her wheel at the quiet end of the Cinderworks, trays of uncut facets sorted by what they promise rather than what they cost: a warding cut here, a cleansing cut there, a taunting cut that seems to want attention paid to it just for existing. \"Reject bin's free to pick through,\" she says, without looking up, \"and if you've got a stone you're done carrying, I'll take it off your hands too — fair price, no haggling.\" The good tray, though, isn't free."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `reject_bin`

- Presentation label: "Pick through the reject bin"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `warding_cut`

- Presentation label: "Pay 2 gold for a warding cut"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "ward",
        "cleanse",
        "taunt"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `sell_facet`

- Presentation label: "Sell her a facet you're not using"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "sellGem"
}
```

- Typed mutations: none

- Callback: none


## `the_reckoning` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `the_reckoning@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Reckoning"
- Presentation body: "The shrine finds you, this time. A cairn of crossroads stone stands where no cairn stood yesterday, sun-mark and moon-mark cut fresh into its face — and beneath them, in scratches you never made, a tally of everything you ever left at the Crossroads Unquiet. Whatever keeps the shrine's accounts has ruled your devotion paid up, and tonight it settles its side of the ledger."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `requires`:

```json
{
  "eventId": "crossroads_shrine",
  "choiceIds": [
    "tithe",
    "moon_rite"
  ]
}
```


### Fixed choices (authored order)

#### Fixed choice 1: `sun_road`

- Presentation label: "Take the sun's settlement in holy work"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "holy"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `moon_road`

- Presentation label: "Take the moon's settlement in dark work"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "dark"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `keep_walking`

- Presentation label: "Leave the account open"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `the_second_toll` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `the_second_toll@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Second Toll"
- Presentation body: "The bell you cut from the ice sounds once inside your pack, though nothing has touched it. Across the white distance, a cairn answers."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `second_toll` · rarity `rare` · biome `frostmarch`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `rarity`:

```json
"rare"
```

- `biomeIds`:

```json
[
  "frostmarch"
]
```

- `requires`:

```json
{
  "eventId": "bell_beneath_ice",
  "choiceIds": [
    "prise_it_free"
  ]
}
```


### Fixed choices (authored order)

#### Fixed choice 1: `answer_the_bell`

- Presentation label: "Answer with your own name"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `bind_the_clapper`

- Presentation label: "Bind the clapper shut"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `abandon_it`

- Presentation label: "Leave the bell at the cairn"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `thorn_garden_shrine` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `thorn_garden_shrine@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Thorn Garden Shrine"
- Presentation body: "Deep in the Silt Hollows, a shrine has vanished beneath a decade of bramble growth, thorned vines lashed so thick across the stone that whatever it once honored is anyone's guess. What the tangle has swallowed is all armor-work — wards, guards, thorn-mail, nothing that hits back — worth the scratches, if you're willing to push through for it."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `cache` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `gather_thorns`

- Presentation label: "Gather the fallen thorns at the edge"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `push_through`

- Presentation label: "Push through the brambles (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "defensive"
      ]
    }
  ],
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave_it`

- Presentation label: "Leave the shrine to the thorns"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `thunder_in_a_bottle` · current version `1`

- Source pack: `src/data/content/event-packs/80-stormreach.json`
- Identity: `thunder_in_a_bottle@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Thunder in a Bottle"
- Presentation body: "A Stormreach tinker has trapped the echo of your swiftest lightning victory. The bottle shakes whenever the road turns toward another fight."
- Discovery: `storm_in_hand` · Storm in Hand · account `future`

- Story: `thunder_in_a_bottle` · stage `payoff` · role `payoff`
- Theme `cache` · art `theme fallback` · rarity `rare` · biome `stormreach`

### Eligibility

- Readable requirement: `combat.fastWin({"maxTurns":8,"element":"lightning"})`
- Typed requirement AST:

```json
{
  "fact": "combat.fastWin",
  "args": {
    "maxTurns": 8,
    "element": "lightning"
  }
}
```

### Persisted fact dependencies

- `combat.fastWin` → `RunState.combatFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `hidden_until_eligible` · priority `300` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `sell_storm`

- Presentation label: "Sell the storm"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 4
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool (draw `1`)

#### Pool choice 1: `socket_thunder`

- Presentation label: "Socket the thunder"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "slow"
      ]
    },
    {
      "ids": [
        "time_crystal_echo"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Pool choice 2: `teach_the_card`

- Presentation label: "Teach a Lightning card"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "upgradeCardTargeted",
  "target": {
    "filter": {
      "where": "any",
      "match": {
        "elements": [
          "lightning"
        ]
      }
    }
  },
  "fallback": {
    "kind": "grantGold",
    "amount": 2
  }
}
```

- Typed mutations: none

- Callback: none


## `toll_bridge` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `toll_bridge@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Toll Bridge"
- Presentation body: "A rickety toll bridge spans the worst of the Tolling Road's ravines, where the spray off the melt below freezes onto the ropes before it lands. Its keeper wants coin before he'll lower the gate, and he has two crates behind him: one is frost-work to the last piece, taken off the traders coming down from the pass, and the other is a jumble of whatever else he has confiscated, all of it made for hitting things. Refuse, and there's a longer, drier road around."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `frost_crate`

- Presentation label: "Pay the toll, take the frost crate (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "elements": [
        "frost"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `pay_toll`

- Presentation label: "Pay the toll, take the mixed crate (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "archetypes": [
        "offense"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `go_around`

- Presentation label: "Take the long way around"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `toll_collectors_ledger` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `toll_collectors_ledger@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Toll Collector's Ledger"
- Presentation body: "A toll collector flags you down on the Tolling Road, ledger open, insisting a road tax is overdue for the wear you've caused passing through. Pay it and he waves you past with a stone from his confiscated crate — refuse, and he shrugs, scrawls something illegible, and lets you walk on regardless."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `market` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `pay_tax`

- Presentation label: "Pay the 2-gold road tax"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `refuse`

- Presentation label: "Refuse to pay"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `tutors_return` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `tutors_return@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Tutor's Return"
- Presentation body: "You know the gnarled staff before you know the face: the old sellsword from the Hollow Yard, planted at the edge of the practice ring as if the two of you had set an appointment. \"You paid for a lesson,\" she says. \"You got half of one. I don't leave debts standing — mine or anybody's.\" The second half won't cost you a coin. Her sparring circle, though, still charges for the privilege."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `training` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Typed legacy selection fields

- `requires`:

```json
{
  "eventId": "wandering_tutor",
  "choiceIds": [
    "pay"
  ]
}
```


### Fixed choices (authored order)

#### Fixed choice 1: `finish_lesson`

- Presentation label: "Take the second half of the lesson"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `spar_the_yard`

- Presentation label: "Spar with her circle (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `part_ways`

- Presentation label: "Tell her the debt is settled"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `two_ravens` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `two_ravens@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Two Ravens"
- Presentation body: "Two ravens perch unnervingly still on the crossroads shrine's arms, and old omen-readers swear feeding them buys good fortune while ignoring them buys nothing at all. Toss them your scraps for a coin's trouble, or walk the long way around and let them watch you go."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `feed_them`

- Presentation label: "Toss them your scraps (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "gemChoice"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `walk_around`

- Presentation label: "Walk the long way around, coin still in your pocket"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `venomers_den` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `venomers_den@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Venomer's Den"
- Presentation body: "Off the Muster Road, half-hidden behind a curtain of hanging roots, a venomer keeps her still and her jars in careful rows, breath sharp with something that isn't quite smoke. \"The weak batch is yours for nothing,\" she says, nodding at a dull green vial, \"or two gold buys off the real shelf. Every jar on it does the one job — leaves whatever you use it on worse off than it started. Past that I make no promises about what's in the glass.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `recruit` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `weak_batch`

- Presentation label: "Take the weak batch for free"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `true_batch`

- Presentation label: "Pay 2 gold for what she actually sells"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "debuff"
      ]
    }
  ],
  "tier": "bronze"
}
```

- Typed mutations: none

- Callback: none


## `veterans_last_lesson` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `veterans_last_lesson@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Veteran's Last Lesson"
- Presentation body: "At the far end of the Hollow Yard, a retiring blade-master sets down her practice cane and offers you her signature weapon, still humming faintly with old battles. \"Take it, and carry what I built,\" she says, \"or take my years instead — I've more use for rest now than for steel.\""
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `training` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `take_blade`

- Presentation label: "Take the veteran's blade"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantCard",
  "cardId": "crushing_blow",
  "tier": "silver"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `take_years`

- Presentation label: "Take her years of experience instead"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none


## `victors_table` · current version `1`

- Source pack: `src/data/content/event-packs/100-global-payoffs.json`
- Identity: `victors_table@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Victor's Table"
- Presentation body: "Veterans from many roads raise their cups as you pass. Five victories earn a place beside them and first choice of the spoils."
- Discovery: `proven_fivefold` · Proven Fivefold · account `future`

- Story: `victors_table` · stage `payoff` · role `payoff`
- Theme `recruit` · art `theme fallback` · rarity `uncommon` · biome `any`

### Eligibility

- Readable requirement: `run.tally.wins gte 5`
- Typed requirement AST:

```json
{
  "fact": "run.tally",
  "args": {
    "stat": "wins",
    "op": "gte",
    "value": 5
  }
}
```

### Persisted fact dependencies

- `run.tally` → `RunState.wins`

### Delivery and selection

- Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `take_purse`

- Presentation label: "Take the road purse"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 3
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool (draw `1`)

#### Pool choice 1: `toast_growth`

- Presentation label: "Toast to hard-won growth"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Pool choice 2: `choose_spoils`

- Presentation label: "Choose from the spoils"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "archetypes": [
        "offense",
        "defensive",
        "healing",
        "support",
        "debuff"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations: none

- Callback: none


## `wandering_smith` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `wandering_smith@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "Wandering Smith"
- Presentation body: "Deep in the Cinderworks, a traveling smith works an anvil under a lean-to, hammer still ringing from the last commission. \"Four gold,\" she grunts, \"and I'll temper a blade proper — not the bronze rubbish you find lying about.\" Two gold, and you can have your pick of the pike-blanks stacked against the lean-to instead; she forges nothing else on spec, so lance-work is all that stack has ever been. Anything less, and she won't bother lighting the forge."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `forge` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `commission`

- Presentation label: "Pay 4 gold for a properly tempered blade"
- Cost: `4` gold
- Typed outcome:

```json
{
  "kind": "grantCard",
  "cardId": "armor_break",
  "tier": "silver"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `pike_blanks`

- Presentation label: "Pick a lance-blank from the stack (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft",
  "filter": [
    {
      "weapons": [
        "lance"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `decline`

- Presentation label: "Walk on"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `wandering_tutor` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `wandering_tutor@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Wandering Tutor"
- Presentation body: "The dust of the Hollow Yard has barely settled from the last duel when an old sellsword rises to meet you, gnarled staff in hand. \"Two gold,\" she says, \"and I'll show you where you're wasting your strength.\" Her lesson won't be free — but it won't be forgotten, either."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `training` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `pay`

- Presentation label: "Pay 2 gold for the lesson"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "grantLevel"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `decline`

- Presentation label: "Keep walking"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `weighing_stone` · current version `1`

- Source pack: `src/data/content/event-packs/00-core.json`
- Identity: `weighing_stone@v1`
- Retained versions: v1 (schema 1)
- Presentation title: "The Weighing Stone"
- Presentation body: "A black basalt stone squats at the crossroads' heart, said to weigh a traveler's resolve at a glance. Press your palm to it and it may show a glimpse of arms you'll carry — or leave your hand simply cold. Others just skirt around it, unwilling to let a stone judge them."
- Discovery: none

- Story: legacy compatibility definition (no schema-v3 story role).
- Theme `omen` · art `theme fallback` · rarity `common (implicit legacy default)` · biome `any`
- Delivery/selectability: legacy live-compatible selection fields.

### Fixed choices (authored order)

#### Fixed choice 1: `press_palm`

- Presentation label: "Press your palm to the stone"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantGold",
  "amount": 1
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 2: `press_harder`

- Presentation label: "Press harder and hold (2 gold)"
- Cost: `2` gold
- Typed outcome:

```json
{
  "kind": "bonusDraft"
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `skirt_around`

- Presentation label: "Skirt around it"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none


## `whiteout_guidance` · current version `1`

- Source pack: `src/data/content/event-packs/40-frostmarch.json`
- Identity: `whiteout_guidance@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "The Pilgrim's Marker"
- Presentation body: "A white-road marker rises where the storm should have erased every trail. The pilgrim's sign points through the safest break in the gale."
- Discovery: none

- Story: `whiteout_pilgrim` · stage `callback` · role `callback`
- Theme `training` · art `theme fallback` · rarity `uncommon` · biome `frostmarch`

### Eligibility

- Readable requirement: `callback.queued({"callbackId":"whiteout_guidance"})`
- Typed requirement AST:

```json
{
  "fact": "callback.queued",
  "args": {
    "callbackId": "whiteout_guidance"
  }
}
```

### Persisted fact dependencies

- `callback.queued` → `RunState.eventCallbackQueue`

### Delivery and selection

- Delivery `queued_callback` · visibility `teased_when_due` · priority `700` · once `run` · cooldown `0` nodes

### Accepted callback bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `take_guidance`

- Presentation label: "Follow the safe line"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "grantMapInfo",
  "bandsAhead": 2
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "whiteout_pilgrim"
  }
]
```

- Callback: none

#### Fixed choice 2: `take_ward`

- Presentation label: "Claim the cached ward"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "shield",
        "guard",
        "ward"
      ]
    }
  ]
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "whiteout_pilgrim"
  }
]
```

- Callback: none

#### Fixed choice 3: `walk_unaided`

- Presentation label: "Walk unaided"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations:

```json
[
  {
    "op": "completeStory",
    "storyId": "whiteout_pilgrim"
  }
]
```

- Callback: none

### Seeded choice pool

- None.

## `whiteout_pilgrim` · current version `1`

- Source pack: `src/data/content/event-packs/40-frostmarch.json`
- Identity: `whiteout_pilgrim@v1`
- Retained versions: v1 (schema 3)
- Presentation title: "Whiteout Pilgrim"
- Presentation body: "A pilgrim steps out of the Frostmarch white, following a road visible only to those who have won beneath frost's banner."
- Discovery: `white_road_walker` · White Road Walker · account `future`

- Story: `whiteout_pilgrim` · stage `setup` · role `setup`
- Theme `training` · art `theme fallback` · rarity `uncommon` · biome `frostmarch`

### Eligibility

- Readable requirement: `combat.affinityWin({"affinityId":"frost","atLeast":1,"biomeId":"frostmarch"})`
- Typed requirement AST:

```json
{
  "fact": "combat.affinityWin",
  "args": {
    "affinityId": "frost",
    "atLeast": 1,
    "biomeId": "frostmarch"
  }
}
```

### Persisted fact dependencies

- `combat.affinityWin` → `RunState.combatFactLedger`

### Delivery and selection

- Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes

### Ambient bindings

- None.

### Fixed choices (always materialized)

#### Fixed choice 1: `share_white_road`

- Presentation label: "Share the white road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "cardChoice",
  "filter": [
    {
      "elements": [
        "frost"
      ]
    }
  ],
  "maxTier": "bronze"
}
```

- Typed mutations: none

- Callback edge: `whiteout_pilgrim/share_white_road` → `whiteout_guidance@v1`
- Typed callback (including bindings and expiry/fallback):

```json
{
  "callbackId": "whiteout_guidance",
  "eventId": "whiteout_guidance",
  "contentVersion": 1,
  "minDepthDelay": 2,
  "destinationThemes": [
    "training"
  ],
  "destinationBiomeIds": [
    "frostmarch"
  ],
  "priority": 700,
  "bind": [],
  "expiry": {
    "expiresAfterNodes": 12,
    "fallback": "discard"
  }
}
```

#### Fixed choice 2: `take_ward`

- Presentation label: "Take the pilgrim's ward"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "gemChoice",
  "filter": [
    {
      "actionKinds": [
        "shield",
        "guard",
        "ward"
      ]
    }
  ]
}
```

- Typed mutations: none

- Callback: none

#### Fixed choice 3: `leave`

- Presentation label: "Return to the road"
- Cost: `0` gold
- Typed outcome:

```json
{
  "kind": "nothing"
}
```

- Typed mutations: none

- Callback: none

### Seeded choice pool

- None.
