import { simulate } from '../engine/combat/simulate';
import { skillBook } from '../data/skills';
import type { CombatEvent } from '../engine/combat/events';
import type { BoardPiece, CombatantSetup, CombatOutcome, Element, WeaponType } from '../engine/types';
import { buildEnemyEncounter, type EnemyTitle, type FoeDeckCard } from './encounter';
import { buildRequestHeroSetup } from './battleRequestValidation';
import type { Allocation } from './leveling';
import { assertKnownGhostEnemyId, buildGhostFoeSetup, type BattleGhostConfig } from './ghostFoeSetup';

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

/** Resolves setups from the request, simulates, and returns the log. */
export function resolveBattle(request: BattleRequest): BattleLog {
  const hero = buildRequestHeroSetup(request);
  const foeSetups = request.foes.map(buildFoeSetup);
  const { result, turns, events, finalState } = simulate(
    { playerTeam: [hero], enemyTeam: foeSetups, skillBook },
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
