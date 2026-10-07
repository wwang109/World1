import { simulate } from '../engine/combat/simulate';
import { skillBook } from '../data/skills';
import type { CombatEvent } from '../engine/combat/events';
import type { BoardPiece, CombatConfig, CombatantSetup, CombatOutcome, Element, WeaponType } from '../engine/types';
import { buildEnemyEncounter, type EnemyTitle, type FoeDeckCard } from './encounter';
import { buildRequestHeroSetup } from './battleRequestValidation';
import type { Allocation } from './leveling';
import { assertKnownGhostEnemyId, buildGhostFoeSetup, type BattleGhostConfig } from './ghostFoeSetup';
import { resolvePassiveRequest } from '../engine/passives/validate';
import { applyBattleEquipment } from './battleEquipment';

export { buildGhostFoeSetup } from './ghostFoeSetup';

/**
 * The battle boundary: prep information in, event log out.
 *
 * This is the ONLY place combat is resolved, and it is deliberately free of any
 * presentation concern — no log lines, no formatting, no animation model. That
 * split is what lets combat move behind an HTTP service later without the
 * client keeping a copy of the rules: the client sends a `BattleRequest` and
 * renders the returned `BattleLog`.
 *
 * Pure TS (no Phaser, no DOM), so it runs unchanged in the browser, in Node
 * (`scripts/fight.ts` already does), or in a Worker.
 */

/** One foe in the request — structural twin of the UI's `EnemyFightConfig`. */
export interface BattleFoeConfig {
  enemyId: string;
  level: number;
  title: EnemyTitle;
  /** Base/request rank, before growth and forced-tier display echoes. */
  rank: number;
  /** Modifier ids from MODIFIER_PRESETS; omitted/[] = none. */
  modifiers?: readonly string[];
  /**
   * The ELITE AFFIX this foe carries (`EncounterUnit.affix`), or omitted/null
   * for none — the ONE behavioural affix `eliteAffixIdFor` deals to an elite
   * fight (see the ELITE AFFIXES block in `encounter.ts`).
   *
   * WHY IT IS ON THE REQUEST. The client never ships a resolved board: it
   * ships the DIALS and the service re-resolves them (`buildEnemyEncounter`
   * below). Every other dial — level, title, rank, modifiers — was already
   * here; the affix was not, so an elite the prep screen previewed as BRACED
   * was re-resolved WITHOUT its affix card and fought as a plain elite. Both
   * halves of that (preview and fight) now read the same field, which is the
   * only thing that makes the prep chip honest.
   */
  affix?: string | null;
  /**
   * Player-built deck replacing the authored board entirely (sandbox custom
   * foe decks / share-code FIGHT IT), or omitted/null for the normal
   * authored+title+rank pipeline. Structural twin of `EnemyFightConfig.deck`
   * (src/game/demoState.ts), the same additive rule `affix` followed: the
   * client ships the deck RECIPE (ids, not resolved boards) and the service
   * re-resolves it through the SAME `buildEnemyEncounter` the preview uses.
   */
  deck?: readonly FoeDeckCard[] | null;
  /** Growth schedule level; packs carry their clamped effective member level.
   * Omitted sandbox values default to the foe's combat level. The service
   * reconstructs the recipe once, exactly like the display resolver. */
  growthLevel?: number;
  /** Run ladder rung for depth-ramped elite/boss title packages. */
  fightNumber?: number;
  /** `'boss'`-title bump vs milestone — see `EncounterUnit.bumped`
   * (encounter.ts) and `BUMPED_BOSS_PRESET`. Omitted/false = milestone. */
  bumped?: boolean;
  /** A saved player build fought on the hero chassis; `enemyId` still keys art/name, its chassis is ignored. */
  ghost?: BattleGhostConfig | null;
}

export type { BattleGhostConfig };

function buildFoeSetup(f: BattleFoeConfig): CombatantSetup {
  if (f.ghost == null) {
    return buildEnemyEncounter(
      f.enemyId, f.level, f.title, f.rank, f.modifiers ?? [], f.affix ?? null, f.fightNumber, f.deck ?? null, f.growthLevel, f.bumped ?? false,
    ).setup;
  }
  assertKnownGhostEnemyId(f.enemyId);
  if (f.deck != null || f.affix != null) throw new Error('ghost foe: a ghost owns its board (deck and affix are not allowed)');
  return buildGhostFoeSetup(f.ghost);
}

/** The prep information a battle is resolved from — the request payload. */
export interface BattleRequest {
  heroEquipment?: readonly import('../engine/equipment/types').EquippedItemRef[];
  preBattle?: import('../engine/passives/types').PassiveRequest;
  pieces: readonly BoardPiece[];
  heroLevel: number;
  heroAllocation: Allocation;
  /** Permanent gold-market/free-boon stat buys (`RunState.purchasedStats`),
   * folded in AFTER `heroAllocation` via `buildAutoHeroSetup`'s unguarded
   * allocation. Omitted is byte-identical to no purchases ever made. */
  heroPurchasedStats?: Allocation;
  /** One entry per foe, in event `unit` order. */
  foes: readonly BattleFoeConfig[];
  seed: number;
}

/**
 * The response payload: what happened, plus the numbers behind each step.
 *
 * Deliberately omits `CombatResult.finalState` — playback derives every HP and
 * shield value from the events themselves, so shipping the terminal state would
 * bloat the response for nothing. The events keep their `calculation` details,
 * which is what lets the client show damage math it never computed.
 */
export interface BattleLog {
  events: readonly CombatEvent[];
  result: CombatOutcome;
  turns: number;
  /** Player-side affinity resolved by combat setup; omitted when none exists. */
  playerAffinityId?: Element | WeaponType;
}

/** Trusted internal context; never reconstructed from an HTTP battle payload. */
export interface BattlePreparation {
  heroPassives?: import('../engine/passives/types').PassiveRecipe;
  sourceCatalog?: import('../engine/passives/types').PassiveRecipe['sources'];
  heroPieceRefs?: readonly { slot: number; pieceRef: string }[];
}

/** Shared request reconstruction for API resolution and evidence tooling. */
export function prepareBattleConfig(request: BattleRequest, preparation?: BattlePreparation): CombatConfig {
  const baseHero = buildRequestHeroSetup(request);
  const hero = request.heroEquipment === undefined ? baseHero : applyBattleEquipment(baseHero, request.heroEquipment);
  const refs = new Set<string>(), slots = new Set<number>();
  for (const entry of preparation?.heroPieceRefs ?? []) {
    if (!entry || Object.keys(entry).some(key => key !== 'slot' && key !== 'pieceRef')
      || !Number.isSafeInteger(entry.slot) || typeof entry.pieceRef !== 'string' || !entry.pieceRef.trim()
      || refs.has(entry.pieceRef) || slots.has(entry.slot)) throw new Error('Invalid trusted card reference mapping');
    const piece = hero.pieces.find(candidate => candidate.slot === entry.slot);
    if (!piece) throw new Error('Trusted card reference must name an occupied anchor');
    refs.add(entry.pieceRef); slots.add(entry.slot); piece.pieceRef = entry.pieceRef;
  }
  if (request.preBattle !== undefined) {
    if (preparation?.heroPassives) throw new Error('Ambiguous passive preparation');
    hero.passives = resolvePassiveRequest(request.preBattle, preparation?.sourceCatalog);
  } else if (preparation?.heroPassives) hero.passives = preparation.heroPassives;
  const foeSetups = request.foes.map(buildFoeSetup);
  return { playerTeam: [hero], enemyTeam: foeSetups, skillBook };
}

/** Resolves setups from the request and optional trusted preparation, then returns the log. */
export function resolveBattle(request: BattleRequest, preparation?: BattlePreparation): BattleLog {
  const { result, turns, events, finalState } = simulate(
    prepareBattleConfig(request, preparation),
    request.seed,
  );
  const playerAffinityId = finalState.player.elementAffinity ?? finalState.player.weaponAffinity;
  return {
    events,
    result,
    turns,
    ...(playerAffinityId === undefined ? {} : { playerAffinityId }),
  };
}
