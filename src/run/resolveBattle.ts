import { simulate } from '../engine/combat/simulate';
import { skillBook } from '../data/skills';
import type { CombatEvent } from '../engine/combat/events';
import type { BoardPiece, CombatOutcome } from '../engine/types';
import { buildAutoHeroSetup, buildEnemyEncounter, type EnemyTitle, type FoeDeckCard } from './encounter';
import type { Allocation } from './leveling';

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
}

/** The prep information a battle is resolved from — the request payload. */
export interface BattleRequest {
  pieces: readonly BoardPiece[];
  heroLevel: number;
  heroAllocation: Allocation;
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
}

/** Resolves setups from the request, simulates, and returns the log. */
export function resolveBattle(request: BattleRequest): BattleLog {
  const hero = buildAutoHeroSetup(
    request.heroLevel,
    request.pieces.map((p) => ({ ...p })),
    request.heroAllocation,
  ).setup;
  const foeSetups = request.foes.map(
    (f) => buildEnemyEncounter(f.enemyId, f.level, f.title, f.rank, f.modifiers ?? [], f.affix ?? null, undefined, f.deck ?? null).setup,
  );
  const { result, turns, events } = simulate(
    { playerTeam: [hero], enemyTeam: foeSetups, skillBook },
    request.seed,
  );
  return { events, result, turns };
}
