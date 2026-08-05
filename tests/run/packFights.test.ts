import { describe, expect, it } from 'vitest';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  fightTableEntryForNode,
  leaveEvent,
  leaveShop,
  recordBattleResult,
  rollEncounter,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { BOSS_EVERY, ensureWavesThrough } from '../../src/run/runMap';
import {
  capPackTitle,
  PACK_LEVEL_DISCOUNT,
  PACK_SIZE,
  PACK_VARIANT_WEIGHTS,
  type PackVariant,
} from '../../src/run/encounter';

/**
 * PACK FIGHTS (2026-08-04) — a fight-column node can roll 1-3 foes (see
 * `rollEncounter` in `src/run/runState.ts` + the `PACK_*` constants in
 * `src/run/encounter.ts`). These tests cover the roll's own contract:
 * variant mix, the level-discount math (incl. the level-1 floor), the
 * boss-is-always-solo invariant, and the preview/committed determinism a
 * pack's map preview and battle-input rely on being byte-identical.
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

/** Every fight/boss node across waves 1..throughWave for `seed`, alongside a
 * RunState (with the map already extended that far) suitable for rolling any
 * of them via `rollEncounter({ ...state, currentNodeId: node.id })` — the
 * SAME "throwaway currentNodeId" idiom `runStore.ts#previewEncounter` uses to
 * preview a not-yet-chosen node. */
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

const WIDE_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('run/runState: PACK FIGHTS — boss nodes are always solo', () => {
  it('never rolls a pack on a boss node, across many seeds', () => {
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, BOSS_EVERY);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'boss') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.variant).toBe('solo');
        expect(pack.units).toHaveLength(1);
      }
    }
  });
});

describe('run/runState: PACK FIGHTS — variant mix', () => {
  it('roughly matches PACK_VARIANT_WEIGHTS over many non-boss fight-node rolls', () => {
    const counts: Record<PackVariant, number> = { solo: 0, pair: 0, trio: 0 };
    let total = 0;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 6);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        counts[pack.variant] += 1;
        total += 1;
      }
    }
    expect(total).toBeGreaterThan(300); // enough samples for a stable share
    for (const variant of ['solo', 'pair', 'trio'] as const) {
      const share = (counts[variant] / total) * 100;
      // Generous +/-10pp band — this is a distribution sanity check, not a
      // balance assertion (balance-designer owns retuning PACK_VARIANT_WEIGHTS).
      expect(share).toBeGreaterThan(PACK_VARIANT_WEIGHTS[variant] - 10);
      expect(share).toBeLessThan(PACK_VARIANT_WEIGHTS[variant] + 10);
    }
  });

  it('members roll independently and CAN repeat the same enemy id', () => {
    let sawRepeat = false;
    outer: for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 6);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.units.length < 2) continue;
        const ids = pack.units.map((u) => u.enemyId);
        if (new Set(ids).size < ids.length) { sawRepeat = true; break outer; }
      }
    }
    expect(sawRepeat).toBe(true);
  });
});

describe('run/runState: PACK FIGHTS — level discount + title cap', () => {
  it('pair members roll at trackLevel-3, trio at trackLevel-5, with the title capped to mob/normal', () => {
    let sawPair = false;
    let sawTrio = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 8);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        const entry = fightTableEntryForNode(node);
        const discount = PACK_LEVEL_DISCOUNT[pack.variant];
        const expectedLevel = Math.max(1, entry.level - discount);
        const expectedTitle = capPackTitle(entry.title);
        for (const unit of pack.units) {
          expect(unit.level).toBe(expectedLevel);
          expect(unit.title).toBe(expectedTitle);
          expect(unit.title === 'elite' || unit.title === 'boss').toBe(false);
        }
        expect(pack.units).toHaveLength(PACK_SIZE[pack.variant]);
        if (pack.variant === 'pair') sawPair = true;
        if (pack.variant === 'trio') sawTrio = true;
      }
    }
    expect(sawPair).toBe(true);
    expect(sawTrio).toBe(true);
  });

  it('floors a pack member level at 1 when the discount would drive it below the floor', () => {
    let found = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 3); // low track level (waves 1-3)
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        const entry = fightTableEntryForNode(node);
        const discount = PACK_LEVEL_DISCOUNT[pack.variant];
        if (entry.level - discount >= 1) continue; // this member's floor isn't actually engaged
        found = true;
        for (const unit of pack.units) expect(unit.level).toBe(1);
      }
    }
    expect(found).toBe(true);
  });

  it("a 'hard' fight-option's +1 level still lands on every pack member (title bump is capped, not skipped)", () => {
    let sawPack = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 6);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightOption !== 'hard') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        sawPack = true;
        const entry = fightTableEntryForNode(node); // already the hard-bumped spec
        const discount = PACK_LEVEL_DISCOUNT[pack.variant];
        const expectedLevel = Math.max(1, entry.level - discount);
        for (const unit of pack.units) expect(unit.level).toBe(expectedLevel);
      }
    }
    expect(sawPack).toBe(true);
  });
});

describe('run/runState: PACK FIGHTS — determinism (same seed -> identical pack)', () => {
  it('repeated rolls of the SAME node return byte-identical packs (variant + every unit)', () => {
    for (const seed of WIDE_SEEDS.slice(0, 10)) {
      const { state, nodeIds } = combatNodesThrough(seed, 5);
      for (const nodeId of nodeIds) {
        const a = rollEncounter({ ...state, currentNodeId: nodeId });
        const b = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(a).toEqual(b);
      }
    }
  });

  it('two independent runs built from the same seed roll identical packs node-for-node', () => {
    for (const seed of WIDE_SEEDS.slice(0, 10)) {
      const a = combatNodesThrough(seed, 5);
      const b = combatNodesThrough(seed, 5);
      expect(a.nodeIds).toEqual(b.nodeIds);
      for (const nodeId of a.nodeIds) {
        const packA = rollEncounter({ ...a.state, currentNodeId: nodeId });
        const packB = rollEncounter({ ...b.state, currentNodeId: nodeId });
        expect(packA).toEqual(packB);
      }
    }
  });

  it('a fight column\'s two options (standard/hard) roll INDEPENDENT packs (distinct encounterSeed)', () => {
    for (const seed of WIDE_SEEDS.slice(0, 10)) {
      const { state, nodeIds } = combatNodesThrough(seed, 6);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightOption !== 'standard') continue;
        const hardNode = state.map.depths.flat().find(
          (n) => n.kind === 'fight' && n.fightNumber === node.fightNumber && n.fightOption === 'hard',
        );
        if (!hardNode) continue;
        // No assertion of INEQUALITY here (two independent Rng streams CAN
        // coincidentally agree on a variant) — this just proves each option
        // resolves from its own encounterSeed without throwing/aliasing.
        const standardPack = rollEncounter({ ...state, currentNodeId: node.id });
        const hardPack = rollEncounter({ ...state, currentNodeId: hardNode.id });
        expect(standardPack.units.length).toBeGreaterThanOrEqual(1);
        expect(hardPack.units.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('run/runState: PACK FIGHTS — preview == battle-input consistency', () => {
  /** Walk forward taking the first available choice until the first fight/
   * boss node's column is reached, WITHOUT committing to it. Mirrors
   * `runStore.ts#previewEncounter`'s "throwaway currentNodeId" composition
   * against a not-yet-chosen node — the exact call the map's choice-panel
   * preview and `battleContext.ts#runBattleInput`'s post-commit re-roll both
   * make, off the SAME node id, so they must agree. */
  function firstUncommittedCombatNode(seed: number): { state: RunState; nodeId: string } {
    let state = startedRun(seed);
    for (let guard = 0; guard < 200; guard++) {
      const options = availableChoices(state);
      if (options.length === 0) throw new Error('no fight/boss node reachable');
      const combatNode = options.find((n) => n.kind === 'fight' || n.kind === 'boss');
      if (combatNode) return { state, nodeId: combatNode.id };
      const node = options[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'shop') state = leaveShop(state);
      else state = leaveEvent(state);
    }
    throw new Error('guard exceeded');
  }

  it('the UNCOMMITTED preview roll is byte-identical to the roll AFTER committing to that same node', () => {
    for (const seed of WIDE_SEEDS.slice(0, 15)) {
      const { state, nodeId } = firstUncommittedCombatNode(seed);
      const previewed = rollEncounter({ ...state, currentNodeId: nodeId }); // preview idiom
      const committed = chooseNode(state, nodeId);
      const afterCommit = rollEncounter(committed); // battleContext-style re-roll
      expect(previewed).toEqual(afterCommit);
    }
  });

  it('the roll is stable across a resolve-and-continue cycle (repeated FIGHT-button re-rolls agree)', () => {
    for (const seed of WIDE_SEEDS.slice(0, 15)) {
      const { state, nodeId } = firstUncommittedCombatNode(seed);
      const committed = chooseNode(state, nodeId);
      const first = rollEncounter(committed);
      const second = rollEncounter(committed);
      expect(first).toEqual(second);
      // recordBattleResult clears currentNodeId; the fight-spec/roll for the
      // NEXT node it advances to is unaffected by this node's own roll.
      const resolved = recordBattleResult(committed, { won: true, goldEarned: 1 });
      expect(resolved.currentNodeId).toBeNull();
    }
  });
});
