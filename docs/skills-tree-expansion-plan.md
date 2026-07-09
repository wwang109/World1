# Skills Tree Plan — pre-run meta-progression & loadout builds

The skills tree is SEPARATE from the in-run card system. It lives on the
profile, before a roguelite run starts: players spend a persistent currency to
unlock nodes, then *equip* a subset of unlocked nodes as a **loadout build**
for the next run — extra stats, higher event rates, better coin collection,
draft perks, and so on. (Card tier-ups are a different track, see
`docs/card-tier-upgrade-plan.md`.)

## What the codebase gives us to build on

- `src/data/heroes.ts` — a single `BASE_HERO_STATS` (no classes) and
  `HERO_BOARD_SLOTS = 10`: the natural application point for stat and
  board-slot nodes at run start.
- `src/data/enemies.ts` — every enemy already carries `goldReward` /
  `xpReward`, so coin-gain multipliers have something real to multiply.
- The engine is pure and deterministic; meta effects must resolve **before**
  `simulate()` is called (baked into `CombatantSetup`), never inside it.
- There is **no run layer yet** (no map, events, shop, draft). The tree should
  ship its data model + combat/economy nodes now, and declare the modifier
  hooks that the run layer will consume when it lands.

## Core loop

1. Finish a run → earn **Renown** (meta currency) scaled by depth reached,
   elites/bosses killed.
2. On the profile screen, spend Renown to permanently **unlock** tree nodes.
3. Before a run, **equip** unlocked nodes into a loadout limited by a
   **Focus** budget — unlocking everything doesn't mean running everything;
   builds are a choice (glass-cannon build vs. greed build vs. explorer build).
4. Saved **presets**: name and store multiple builds, one-tap swap pre-run.

The Focus cap is what makes it a *build system* rather than a linear power
faucet, and it keeps late-profile balance sane: total equipped power is
bounded even when the whole tree is unlocked.

## Data model (`src/meta/`)

New pure-TS layer, same boundary rules as `src/engine` (no Phaser imports —
extend `scripts/check-boundaries.mjs`).

```ts
// src/meta/types.ts
export type BranchId = 'warpath' | 'fortune' | 'wayfarer' | 'legacy';

/** Closed effect DSL, mirroring the engine's Action union philosophy. */
export type MetaEffect =
  // -- combat (applies to hero stats at run start) --
  | { kind: 'stat'; stat: BuffableStat | 'maxHp'; amount: number }      // flat, per rank
  // -- economy --
  | { kind: 'goldPct'; pct: number }            // fight gold rewards
  | { kind: 'xpPct'; pct: number }              // fight xp rewards
  | { kind: 'startingGold'; amount: number }
  | { kind: 'shopDiscountPct'; pct: number }    // consumed by future shop
  // -- events / map (consumed by future run layer) --
  | { kind: 'eventRatePct'; event: 'treasure' | 'campfire' | 'elite' | 'mystery'; pct: number }
  | { kind: 'campfireHealPct'; pct: number }
  // -- draft / loadout --
  | { kind: 'draftChoices'; extra: number }     // see N+extra cards per draft
  | { kind: 'draftRerolls'; extra: number }
  | { kind: 'startingCardPick'; tier: 'bronze' } // choose a known card at run start
  | { kind: 'boardSlots'; extra: number }        // HERO_BOARD_SLOTS + extra
  | { kind: 'affinity'; slot: 'element' | 'weapon' } // unlock choosing a run affinity
  | { kind: 'revive'; charges: number };         // once per run, survive at 30% HP

export interface TreeNodeDef {
  id: string;
  name: string;
  branch: BranchId;
  /** Parent node ids — the tree edges. Empty = branch root. */
  requires: string[];
  /** Multi-rank nodes (e.g. Vitality I–V). */
  ranks: number;
  /** Renown price per rank (monotonically increasing). */
  costPerRank: number[];
  /** Loadout budget consumed when equipped (whole node, any rank). */
  focusCost: number;
  /** Granted PER RANK when the node is equipped. */
  effects: MetaEffect[];
  text: string;
}
```

Profile state + aggregation:

```ts
// src/meta/profile.ts  — versioned, serializable, localStorage-persisted
export interface MetaProfile {
  version: 1;
  renown: number;
  unlocked: Record<string, number>;   // nodeId -> rank purchased
  presets: LoadoutPreset[];           // { name, equipped: string[] }
  activePreset: number;
}

// src/meta/modifiers.ts — the single output the rest of the game reads
export interface RunModifiers {
  statMods: Partial<CombatantStats>;
  goldPct: number; xpPct: number; startingGold: number; shopDiscountPct: number;
  eventRatePct: Partial<Record<EventKind, number>>;
  campfireHealPct: number;
  draftChoices: number; draftRerolls: number;
  startingCardPick: boolean; extraBoardSlots: number;
  affinityUnlocks: { element: boolean; weapon: boolean };
  reviveCharges: number;
}
export function aggregate(profile: MetaProfile, book: TreeBook): RunModifiers;
```

`aggregate()` is the one seam everything consumes: hero setup applies
`statMods` + `extraBoardSlots`, fight rewards apply `goldPct`/`xpPct` today;
the future run layer reads event/shop/draft fields when it exists. The engine
itself never changes — determinism untouched.

## The four branches (~32 nodes at launch)

### ⚔️ Warpath — combat stats (works TODAY)
| Node | Ranks | Per-rank effect | Focus |
|---|---|---|---|
| Vitality | 5 | +10 maxHp | 1 |
| Honed Edge | 5 | +1 attack | 1 |
| Attuned Mind | 5 | +1 magicPower | 1 |
| Thick Hide | 3 | +1 armor | 1 |
| Warded Soul | 3 | +1 magicResist | 1 |
| Fleet Foot | 3 | +1 speed | 2 |
| Killer Instinct | 3 | +3% crit | 2 |
| **Undying** (capstone) | 1 | 1 revive charge @30% HP | 4 |

Requires-chains: Vitality is the root; Hide/Soul hang off it; Edge/Mind fork;
Undying requires maxed Vitality. Speed is priced high in Focus — the
initiative-comparison engine makes speed the strongest stat.

### 💰 Fortune — coin collection & economy (gold/xp work TODAY)
| Node | Ranks | Per-rank effect | Focus |
|---|---|---|---|
| Keen Eye | 5 | +10% fight gold | 1 |
| Scholar | 3 | +10% fight xp | 1 |
| Seed Money | 3 | +15 starting gold | 1 |
| Haggler | 3 | −5% shop prices *(future shop)* | 1 |
| Treasure Sense | 3 | +15% treasure-event rate *(future)* | 2 |
| **Golden Touch** (capstone) | 1 | flawless win (no HP lost) pays double gold | 3 |

### 🧭 Wayfarer — events & map shaping (activates WITH the run layer)
| Node | Ranks | Per-rank effect | Focus |
|---|---|---|---|
| Pathfinder | 3 | +10% mystery-event rate | 1 |
| Rest Easy | 3 | +10% campfire healing | 1 |
| Firekeeper | 2 | +15% campfire-node rate | 1 |
| Thrill Seeker | 3 | +15% elite rate (elites pay 2×) | 2 |
| **Cartographer** (capstone) | 1 | see one extra layer of the map ahead | 3 |

Ships as data + audits from day one, greyed "requires expedition update" in
the UI until the run layer consumes it — the aggregation seam already carries
the numbers.

### 🃏 Legacy — draft & loadout perks (works with PrepScene TODAY where noted)
| Node | Ranks | Per-rank effect | Focus |
|---|---|---|---|
| Broad Options | 2 | +1 card choice per draft *(future draft)* | 1 |
| Second Look | 2 | +1 draft reroll *(future draft)* | 1 |
| Heirloom | 1 | pick your starting Bronze card *(today: seeds demo board)* | 2 |
| Elemental Rite | 1 | choose a run element affinity *(today: `CombatantSetup.elementAffinity`)* | 2 |
| Weapon Oath | 1 | choose a run weapon affinity | 2 |
| **Expanded Arsenal** (capstone) | 1 | +1 board slot (10 → 11) | 4 |

Affinity nodes plug into fields the engine already supports on
`CombatantSetup` but that "the hero is neutral until gear/enchantments grant
one" — this is that grant.

## Numbers to start (tune later)

- **Renown income**: ~10 per depth cleared, +15/elite, +40/boss → a full
  depth-1 demo clear ≈ 55. Full tree ≈ 1,400 Renown (~25 good runs).
- **Focus budget**: start at 8, +1 per profile milestone (first boss kill,
  depth records) up to 16. Full-rank node totals ≈ 40 Focus, so a build
  equips roughly a third of a maxed tree.
- **Respec**: free unequip anytime (it's a loadout, not a commitment);
  refunding *Renown* not needed.
- Balance guardrails as audits, not vibes: total equippable flat stats under
  any 16-Focus build must stay below ~35% of `BASE_HERO_STATS` power (keeps
  Bronze enemies meaningful); event-rate stacks cap at +45%.

## UI (`src/game/scenes/LoadoutScene.ts`)

New scene in the flow **Loadout → Prep → Battle**:

- Four branch tabs with the node graph drawn as columns (requires-edges as
  connectors); node states: locked / affordable / unlocked / equipped.
- Renown wallet + Focus meter (equipped total vs. cap) always visible.
- Click to buy ranks, toggle to equip; preset strip along the bottom
  (rename, duplicate, delete).
- Tooltip reuses the card-tooltip styling from `CardView.ts`/`theme.ts`.

## Phasing

- **P0 — meta core (no UI)**: `src/meta/` types, tree data
  (`src/data/skillTree.ts`), `aggregate()`, localStorage save with version
  field, boundary-checker coverage. Audit tests: unique ids, `requires`
  resolve + acyclic, cost arrays match `ranks`, per-branch Focus totals,
  balance guardrails. Wire the four "works today" surfaces: hero stats,
  board slots, gold/xp multipliers, affinity picks.
- **P1 — LoadoutScene**: tree rendering, buy/equip/presets, dev cheat to
  grant Renown for playtesting.
- **P2 — run-layer hookup**: as the roguelite map/draft/shop lands, consume
  `eventRatePct`, `draftChoices/Rerolls`, `shopDiscountPct`,
  `campfireHealPct`, `startingCardPick` from `RunModifiers` (the seam already
  exists, so this is consumption, not redesign).
- **P3 — depth**: milestone-based Focus growth, capstone specials (Golden
  Touch, Cartographer), a fifth prestige branch once win-rates justify it.

Estimated new tests: ~30 (tree audits, aggregation math incl. stacking caps,
save/load roundtrip + version migration, focus-cap enforcement, hero-setup
application).
