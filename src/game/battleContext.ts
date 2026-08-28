import { demoState } from './demoState';
import { currentNode, getActiveRun } from './runStore';
import { rollEncounter } from '../run/runState';
import type { BattleTimelineInput } from './battleTimeline';

/**
 * Battle context — the "source discriminator" the battle scenes read from
 * instead of hardcoding `demoState`. `'demo'` (default) is the Sandbox path
 * (unchanged); `'run'` is Run Mode, where the fight resolves from the active
 * run's current combat node instead. Scenes are still dumb playback heads —
 * this module only decides WHICH prep info to hand them, never how combat
 * resolves. Set explicitly by whichever screen launches the battle scene
 * (RunPrep -> 'run', the sandbox Prep scenes -> 'demo') so a stale value from
 * an earlier visit never leaks into the wrong flow.
 */
export type BattleContextSource = 'demo' | 'run';

let source: BattleContextSource = 'demo';

export function setBattleContext(next: BattleContextSource): void {
  source = next;
}

export function getBattleContext(): BattleContextSource {
  return source;
}

function demoBattleInput(): BattleTimelineInput {
  return {
    pieces: demoState.pieces,
    heroLevel: demoState.heroLevel,
    heroAllocation: demoState.heroAllocation,
    enemyId: demoState.enemyId,
    enemyLevel: demoState.enemyLevel,
    enemyTitle: demoState.enemyTitle,
    enemyRank: demoState.enemyRank,
    enemyModifiers: demoState.enemyModifiers,
    enemyTeam: demoState.enemyTeam,
    seed: demoState.seed,
  };
}

/**
 * Builds the active run's CURRENT combat node into the same request shape the
 * sandbox reads off `demoState` — the node's encounter, resolved fresh.
 * `rollEncounter` is a pure function of the node's `encounterSeed`, so calling
 * it again here reproduces the IDENTICAL pack RunPrepScene already previewed.
 * `null` if there's no active run or the current node isn't a combat node
 * (falls back to the demo input, which should never actually get exercised
 * in that case since only RunPrep's FIGHT button sets the 'run' context).
 *
 * PACK FIGHTS: `rollEncounter` returns 1-3 units (`EncounterPack`); the
 * singular `enemyId`/`enemyLevel`/… fields mirror `units[0]` (the "primary"
 * foe — same convention as `demoState.enemyTeam[0]`) while `enemyTeam` always
 * carries the FULL roster (length 1 for a solo fight), so every downstream
 * consumer (`buildBattleTimeline`, `battleRequestOf`, `resolveRunBattleResult`)
 * reads the real pack instead of just the first member.
 */
function runBattleInput(): BattleTimelineInput | null {
  const run = getActiveRun();
  const node = currentNode();
  if (!run || !node || (node.kind !== 'fight' && node.kind !== 'boss')) return null;
  const pack = rollEncounter(run);
  const primary = pack.units[0]!;
  return {
    pieces: run.pieces,
    heroLevel: run.heroLevel,
    heroAllocation: run.heroAllocation,
    enemyId: primary.enemyId,
    enemyLevel: primary.level,
    enemyTitle: primary.title,
    enemyRank: primary.rank,
    enemyModifiers: primary.modifiers,
    enemyAffix: primary.affix,
    // `u.affix` travels with the unit: the FIGHT button must resolve the same
    // affix RunPrep previewed off this identical `rollEncounter` call.
    enemyTeam: pack.units.map((u) => ({
      enemyId: u.enemyId, level: u.level, title: u.title, rank: u.rank, modifiers: [...u.modifiers], affix: u.affix,
    })),
    seed: node.encounterSeed!,
  };
}

/** The prep info the active battle scene resolves from — demoState in
 * Sandbox, the active run's current combat node in Run Mode. */
export function getBattleTimelineInput(): BattleTimelineInput {
  if (source === 'run') {
    const input = runBattleInput();
    if (input) return input;
  }
  return demoBattleInput();
}
