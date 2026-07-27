import { gemBook } from '../data/gems';
import type { BoardPiece, Gem, SkillTier } from '../engine/types';
import type { EnemyTitle } from '../run/encounter';
import type { Allocation } from '../run/leveling';

export type PrepView = 'loadout' | 'bag' | 'codex' | 'opponents' | 'balance';
export type GemInventorySlot = string;

export interface OwnedCard {
  instanceId: string;
  skillId: string;
  tier: SkillTier;
}

export type OwnedBoardPiece = Omit<BoardPiece, 'tier'> & OwnedCard;

export type InventorySlot = OwnedCard | null;

/** Hard cap on enemyTeam size — the prep foe pickers stop offering + FOE here. */
export const MAX_FOES = 5;

export interface EnemyFightConfig {
  enemyId: string;
  level: number;
  title: EnemyTitle;
  rank: number;
  modifiers: string[];
}

export interface DemoState {
  pieces: OwnedBoardPiece[];
  enemyId: string;
  enemyIds: string[];
  /** The exact per-enemy setup handed from Prep to Battle, in roster order. */
  enemyTeam: EnemyFightConfig[];
  /** Which enemyTeam entry the prep controls (title/LV/RANK/modifiers) edit. */
  activeFoe: number;
  seed: number;
  prepView: PrepView;
  wikiTier: SkillTier;
  /** Wiki cards catalog density: large 3×3 grid or dense 4×4 grid. */
  wikiGrid: 'large' | 'dense';
  bagSlots: InventorySlot[];
  nextCardInstanceId: number;
  gemInventory: GemInventorySlot[];
  /** Hero level; stats come from the auto-balanced allocation until the stat-sheet UI exists. */
  heroLevel: number;
  /**
   * Player PL-budget stat-sheet spend: buy counts per stat (see
   * `LEVEL_STAT_COST` in run/leveling.ts). Unspent PL simply isn't reflected
   * here and stays banked. Defaults to zero buys (fully banked) until a
   * stat-sheet UI exists to let the player spend it.
   */
  heroAllocation: Allocation;
  /** Requested enemy level (title deltas apply on top in the encounter resolver). */
  enemyLevel: number;
  enemyTitle: EnemyTitle;
  /** Enemy rank = tier-steps distributed across the deck (0..deckSize×3). */
  enemyRank: number;
  /** Rogue-like affixes on the PRIMARY enemy (mirror of enemyTeam[0].modifiers). */
  enemyModifiers: string[];
}

/**
 * Re-mirror the legacy single-enemy fields from enemyTeam[0]. Call after ANY
 * enemyTeam mutation — 1v1 surfaces (mobile scenes, legacy Prep/Battle) read
 * the singular fields, multi-foe surfaces read the team array.
 */
export function syncPrimaryFoe(): void {
  const primary = demoState.enemyTeam[0];
  if (!primary) return;
  demoState.enemyId = primary.enemyId;
  demoState.enemyLevel = primary.level;
  demoState.enemyTitle = primary.title;
  demoState.enemyRank = primary.rank;
  demoState.enemyModifiers = [...primary.modifiers];
  demoState.enemyIds = demoState.enemyTeam.map((f) => f.enemyId);
  demoState.activeFoe = Math.max(0, Math.min(demoState.activeFoe, demoState.enemyTeam.length - 1));
}

const DEFAULT_PIECES: OwnedBoardPiece[] = [
  { instanceId: 'card_002', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
  { instanceId: 'card_001', skillId: 'war_banner', tier: 'bronze', slot: 1, gem: gemBook.swift_charm },
  { instanceId: 'card_011', skillId: 'sword_slash', tier: 'bronze', slot: 2, gem: gemBook.war_banner_echo },
  { instanceId: 'card_005', skillId: 'second_wind', tier: 'bronze', slot: 3 },
  { instanceId: 'card_004', skillId: 'iron_bulwark', tier: 'bronze', slot: 4 },
];

// The bag holds only cards NOT currently slotted on the board — a card lives in
// exactly one place. Board pieces + bag cards together are the carried cards.
// The bag works exactly like the hero deck rail: 10 slots, and a size-N card
// occupies N consecutive slots. The card is stored at its FIRST slot; the
// covered slots stay null.
const DEFAULT_BAG_SLOTS: InventorySlot[] = [
  { instanceId: 'card_007', skillId: 'fireball', tier: 'bronze' }, // size 2 — covers the next slot
  null,
  { instanceId: 'card_008', skillId: 'mana_ward', tier: 'bronze' },
  { instanceId: 'card_009', skillId: 'follow_through', tier: 'bronze' },
  { instanceId: 'card_010', skillId: 'armor_break', tier: 'bronze' },
  { instanceId: 'card_003', skillId: 'crippling_strike', tier: 'bronze' }, // size 2 — covers the next slot
  null,
  { instanceId: 'card_006', skillId: 'arcane_bolt', tier: 'bronze' },
  null,
  null,
];
const DEFAULT_GEM_INVENTORY: GemInventorySlot[] = [
  'venom_sliver',
  'stunning_shard',
  'lightweight_core',
  'brawlers_core',
  'enfeebling_shard',
  'empowering_core',
  'bulwark_core',
  'concussive_shard',
  'restorative_core',
  'archmages_core',
];

export const DEFAULT_DEMO_STATE: DemoState = {
  pieces: DEFAULT_PIECES,
  enemyId: 'bandit_duelist',
  enemyIds: ['bandit_duelist'],
  activeFoe: 0,
  enemyTeam: [
    {
      enemyId: 'bandit_duelist',
      level: 1,
      title: 'elite',
      rank: 2,
      modifiers: [],
    },
  ],
  seed: 1,
  prepView: 'loadout',
  wikiTier: 'bronze',
  wikiGrid: 'large',
  bagSlots: DEFAULT_BAG_SLOTS,
  nextCardInstanceId: 12,
  gemInventory: DEFAULT_GEM_INVENTORY,
  heroLevel: 1,
  heroAllocation: {},
  enemyLevel: 1,
  // bandit_duelist is tagged isElite in data, so its natural title is elite
  // (which presets rank 2 — one tier-up card + one card gem-less bump).
  enemyTitle: 'elite',
  enemyRank: 2,
  enemyModifiers: [],
};

/**
 * Overrides for a fully unequipped demo (`?board=empty`): every gem loose and
 * as many carried cards as the 10-slot bag holds. The full demo collection
 * needs 13 slots (three size-2 cards), so the three overflow size-1 cards are
 * omitted from this preset — bag capacity is exact, matching the deck rail.
 */
export const EMPTY_BOARD_OVERRIDES: Partial<DemoState> = {
  pieces: [],
  // Packed contiguously; size-2 cards cover the null slot after them.
  bagSlots: [
    { instanceId: 'card_007', skillId: 'fireball', tier: 'bronze' }, // size 2
    null,
    { instanceId: 'card_003', skillId: 'crippling_strike', tier: 'bronze' }, // size 2
    null,
    { instanceId: 'card_001', skillId: 'war_banner', tier: 'bronze' },
    { instanceId: 'card_004', skillId: 'iron_bulwark', tier: 'bronze' }, // size 2
    null,
    { instanceId: 'card_002', skillId: 'sword_slash', tier: 'bronze' },
    { instanceId: 'card_006', skillId: 'arcane_bolt', tier: 'bronze' },
    { instanceId: 'card_008', skillId: 'mana_ward', tier: 'bronze' },
  ],
  gemInventory: [...DEFAULT_GEM_INVENTORY, 'swift_charm', 'war_banner_echo'],
};

function cloneGem(gem: Gem | null | undefined): Gem | null | undefined {
  if (gem == null) return gem;
  if (gem.kind === 'effect') {
    return {
      ...gem,
      actions: gem.actions.map((action) => ({ ...action })),
    };
  }
  return {
    ...gem,
    mods: {
      hero: gem.mods.hero ? { ...gem.mods.hero } : undefined,
      card: gem.mods.card ? { ...gem.mods.card } : undefined,
    },
  };
}

function clonePieces(pieces: OwnedBoardPiece[]): OwnedBoardPiece[] {
  return pieces.map((piece) => ({
    ...piece,
    gem: cloneGem(piece.gem),
  }));
}

function cloneSlots(slots: InventorySlot[]): InventorySlot[] {
  return slots.map((slot) => slot ? { ...slot } : null);
}

function cloneGemInventory(gems: GemInventorySlot[]): GemInventorySlot[] {
  return [...gems];
}

function cloneEnemyTeam(team: EnemyFightConfig[]): EnemyFightConfig[] {
  return team.map((enemy) => ({ ...enemy, modifiers: [...enemy.modifiers] }));
}

function cloneAllocation(alloc: Allocation): Allocation {
  return { ...alloc };
}

/** Mutable demo session state shared between Prep and Battle scenes. */
export const demoState: DemoState = {
  pieces: clonePieces(DEFAULT_DEMO_STATE.pieces),
  enemyId: DEFAULT_DEMO_STATE.enemyId,
  enemyIds: [...DEFAULT_DEMO_STATE.enemyIds],
  enemyTeam: cloneEnemyTeam(DEFAULT_DEMO_STATE.enemyTeam),
  activeFoe: DEFAULT_DEMO_STATE.activeFoe,
  seed: DEFAULT_DEMO_STATE.seed,
  prepView: DEFAULT_DEMO_STATE.prepView,
  wikiTier: DEFAULT_DEMO_STATE.wikiTier,
  wikiGrid: DEFAULT_DEMO_STATE.wikiGrid,
  bagSlots: cloneSlots(DEFAULT_DEMO_STATE.bagSlots),
  nextCardInstanceId: DEFAULT_DEMO_STATE.nextCardInstanceId,
  gemInventory: cloneGemInventory(DEFAULT_DEMO_STATE.gemInventory),
  heroLevel: DEFAULT_DEMO_STATE.heroLevel,
  heroAllocation: cloneAllocation(DEFAULT_DEMO_STATE.heroAllocation),
  enemyLevel: DEFAULT_DEMO_STATE.enemyLevel,
  enemyTitle: DEFAULT_DEMO_STATE.enemyTitle,
  enemyRank: DEFAULT_DEMO_STATE.enemyRank,
  enemyModifiers: [...DEFAULT_DEMO_STATE.enemyModifiers],
};

export function resetDemoState(overrides: Partial<DemoState> = {}): void {
  const enemyTeam = overrides.enemyTeam ?? (
    overrides.enemyId !== undefined
    || overrides.enemyIds !== undefined
    || overrides.enemyLevel !== undefined
    || overrides.enemyTitle !== undefined
    || overrides.enemyRank !== undefined
      ? (overrides.enemyIds ?? [overrides.enemyId ?? DEFAULT_DEMO_STATE.enemyId]).map((enemyId) => ({
          enemyId,
          level: overrides.enemyLevel ?? DEFAULT_DEMO_STATE.enemyLevel,
          title: overrides.enemyTitle ?? DEFAULT_DEMO_STATE.enemyTitle,
          rank: overrides.enemyRank ?? DEFAULT_DEMO_STATE.enemyRank,
          modifiers: [...(overrides.enemyModifiers ?? DEFAULT_DEMO_STATE.enemyModifiers)],
        }))
      : DEFAULT_DEMO_STATE.enemyTeam
  );
  const activeEnemy = enemyTeam[0] ?? DEFAULT_DEMO_STATE.enemyTeam[0]!;
  demoState.pieces = clonePieces(overrides.pieces ?? DEFAULT_DEMO_STATE.pieces);
  demoState.enemyTeam = cloneEnemyTeam(enemyTeam);
  demoState.activeFoe = Math.max(0, Math.min(overrides.activeFoe ?? 0, enemyTeam.length - 1));
  demoState.enemyId = activeEnemy.enemyId;
  demoState.enemyIds = enemyTeam.map((enemy) => enemy.enemyId);
  demoState.seed = overrides.seed ?? DEFAULT_DEMO_STATE.seed;
  demoState.prepView = overrides.prepView ?? DEFAULT_DEMO_STATE.prepView;
  demoState.wikiTier = overrides.wikiTier ?? DEFAULT_DEMO_STATE.wikiTier;
  demoState.wikiGrid = overrides.wikiGrid ?? DEFAULT_DEMO_STATE.wikiGrid;
  demoState.bagSlots = cloneSlots(overrides.bagSlots ?? DEFAULT_DEMO_STATE.bagSlots);
  demoState.nextCardInstanceId = overrides.nextCardInstanceId ?? DEFAULT_DEMO_STATE.nextCardInstanceId;
  demoState.gemInventory = cloneGemInventory(overrides.gemInventory ?? DEFAULT_DEMO_STATE.gemInventory);
  demoState.heroLevel = overrides.heroLevel ?? DEFAULT_DEMO_STATE.heroLevel;
  demoState.heroAllocation = cloneAllocation(overrides.heroAllocation ?? DEFAULT_DEMO_STATE.heroAllocation);
  demoState.enemyLevel = activeEnemy.level;
  demoState.enemyTitle = activeEnemy.title;
  demoState.enemyRank = activeEnemy.rank;
  demoState.enemyModifiers = [...activeEnemy.modifiers];
}

export function createOwnedCard(skillId: string, tier: SkillTier): OwnedCard {
  const instanceId = `card_${String(demoState.nextCardInstanceId).padStart(3, '0')}`;
  demoState.nextCardInstanceId += 1;
  return { instanceId, skillId, tier };
}
