import { describe, expect, it } from 'vitest';
import {
  applyDraftResult,
  createRun,
  fightTableEntryForNode,
  rollEncounter,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { ensureWavesThrough } from '../../src/run/runMap';
import { enemies } from '../../src/data/enemies';
import { computeEnemyDepthBands, inDepthBand } from '../../src/run/enemyDepth';

/**
 * ENEMY DEPTH GATING — `rollEncounter` integration (Task #33). Proves the
 * run-layer rule actually reaches the drawn encounter, not just the pure
 * band-model helpers (see `tests/run/enemyDepth.test.ts` for those). Mirrors
 * `tests/run/packFights.test.ts`'s `combatNodesThrough`/`WIDE_SEEDS` idiom.
 *
 * NOTE ON MAP DRIFT: gating enemy-id draws by depth legitimately changes
 * WHICH enemy id a given node resolves to versus before this feature existed
 * (same number of Rng calls, different draw pools) — no test here (or
 * elsewhere in the suite) pins a literal enemy id to a fixed seed, only
 * band-membership invariants, so this drift is safe by construction.
 */

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

function combatNodesThrough(seed: number, throughWave: number): { state: RunState; nodeIds: string[] } {
  const base = startedRun(seed);
  const state = { ...base, map: ensureWavesThrough(base.map, throughWave) };
  const nodeIds: string[] = [];
  for (const column of state.map.depths) {
    for (const node of column) {
      if (node.kind === 'fight' || node.kind === 'boss') nodeIds.push(node.id);
    }
  }
  return { state, nodeIds };
}

const WIDE_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

const FIGHT_POOL_ENEMIES = Object.values(enemies).filter((e) => !e.isBoss);
const FIGHT_BANDS = computeEnemyDepthBands(FIGHT_POOL_ENEMIES);
const sortedByGold = [...FIGHT_POOL_ENEMIES].sort(
  (a, b) => a.goldReward - b.goldReward || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
);
const WEAKEST_ID = sortedByGold[0]!.id;
const STRONGEST_ID = sortedByGold[sortedByGold.length - 1]!.id;

describe('run/runState: enemy depth gating (rollEncounter)', () => {
  it('a depth-1 (fightNumber 1) node never fields the roster\'s strongest enemy as its anchor', () => {
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 1);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightNumber !== 1) continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.units[0]!.enemyId).not.toBe(STRONGEST_ID);
        expect(inDepthBand(FIGHT_BANDS[pack.units[0]!.enemyId], 1)).toBe(true);
      }
    }
  });

  it("a deep node's anchor matches its depth band across many seeds/fight numbers", () => {
    let sawDeepFight = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 40);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' && node.kind !== 'boss') continue;
        if ((node.fightNumber ?? 0) < 20) continue;
        sawDeepFight = true;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        const anchorId = pack.units[0]!.enemyId;
        if (node.kind === 'fight') {
          expect(inDepthBand(FIGHT_BANDS[anchorId], node.fightNumber!), `seed ${seed} node ${nodeId}`).toBe(true);
        }
      }
    }
    expect(sawDeepFight).toBe(true);
  });

  it('pack filler may dip below the anchor\'s own tier (the weakest enemy shows up as filler on a deep pack)', () => {
    let sawWeakestFiller = false;
    outer: for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 150);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || (node.fightNumber ?? 0) < 20) continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.units.length < 2) continue;
        const fillerIds = pack.units.slice(1).map((u) => u.enemyId);
        if (fillerIds.includes(WEAKEST_ID)) {
          sawWeakestFiller = true;
          break outer;
        }
      }
    }
    expect(sawWeakestFiller).toBe(true);
  });

  it('the fallback-to-solo rule (PL-budget floor) still holds unchanged alongside depth gating', () => {
    // fight 1 is always solo regardless of gating (unrelated mechanism, still intact).
    for (const seed of WIDE_SEEDS.slice(0, 10)) {
      const { state, nodeIds } = combatNodesThrough(seed, 1);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightNumber !== 1) continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.variant).toBe('solo');
        expect(pack.units).toHaveLength(1);
      }
    }
  });

  it('the whole non-boss roster is reachable as an anchor somewhere across the ladder (no enemy orphaned)', () => {
    const seenAsAnchor = new Set<string>();
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 200);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        seenAsAnchor.add(pack.units[0]!.enemyId);
      }
    }
    for (const enemy of FIGHT_POOL_ENEMIES) {
      expect(seenAsAnchor.has(enemy.id), `${enemy.id} never anchored a fight across the sampled ladder`).toBe(true);
    }
  });

  it('boss nodes are ungated (single-boss pool, always solo, always the boss id)', () => {
    for (const seed of WIDE_SEEDS.slice(0, 10)) {
      const { state, nodeIds } = combatNodesThrough(seed, 5);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'boss') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.variant).toBe('solo');
        expect(pack.units).toHaveLength(1);
      }
    }
  });

  it('easy/standard/hard fight-column siblings share the SAME anchor eligibility (gating keys off fightNumber, not the risk dial)', () => {
    for (const seed of WIDE_SEEDS.slice(0, 10)) {
      const { state, nodeIds } = combatNodesThrough(seed, 6);
      const byFightNumber = new Map<number, string[]>();
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const list = byFightNumber.get(node.fightNumber!) ?? [];
        list.push(nodeId);
        byFightNumber.set(node.fightNumber!, list);
      }
      for (const [, siblingIds] of byFightNumber) {
        if (siblingIds.length < 2) continue;
        for (const nodeId of siblingIds) {
          const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
          const pack = rollEncounter({ ...state, currentNodeId: nodeId });
          const entry = fightTableEntryForNode(node);
          expect(entry.level).toBeGreaterThan(0); // sanity: entry actually resolved
          expect(inDepthBand(FIGHT_BANDS[pack.units[0]!.enemyId], node.fightNumber!)).toBe(true);
        }
      }
    }
  });
});
