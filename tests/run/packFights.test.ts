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
  MIN_PACK_FIGHT_NUMBER,
  MODIFIER_PRESETS,
  PACK_ACTION_ECONOMY_TAX_PCT,
  PACK_SIZE,
  PACK_VARIANT_WEIGHTS,
  packBudgetDeci,
  resolvePackMemberLevel,
  soloThreatDeci,
  type PackVariant,
} from '../../src/run/encounter';
import { Rng } from '../../src/engine/rng';
import { TIER_BUDGET_DECI } from '../../src/engine/balance';
import { monsterLevelPL } from '../../src/run/leveling';

/**
 * PACK FIGHTS (2026-08-04, re-priced onto PL budgets 2026-08-04) — a
 * fight-column node can roll 1-3 foes (see `rollEncounter` in
 * `src/run/runState.ts` + the `PACK_*`/budget helpers in
 * `src/run/encounter.ts`). These tests cover the roll's own contract:
 * variant mix (at levels where the budget solve can't distort it), the
 * BUDGET math (pack total PL vs the taxed solo-equivalent budget, across a
 * level sweep), the early-game gate (fight 1 is always solo), the
 * floor-fallback-to-solo invariant, the boss-is-always-solo invariant, and
 * the preview/committed determinism a pack's map preview and battle-input
 * rely on being byte-identical.
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

/** Reproduce the RAW `rollPackVariant` draw (`runState.ts`, not exported) off
 * a node's own `encounterSeed` — the SAME single `rng.int(100)` draw
 * `rollEncounter` spends on "how many foes" whenever the early-game gate is
 * open. Lets tests distinguish "the roll wanted a pack but the budget solve
 * floored it back to solo" from "the roll wanted solo in the first place". */
function rawPackVariant(encounterSeed: number): PackVariant {
  const rng = new Rng(encounterSeed);
  const roll = rng.int(100);
  if (roll < PACK_VARIANT_WEIGHTS.solo) return 'solo';
  if (roll < PACK_VARIANT_WEIGHTS.solo + PACK_VARIANT_WEIGHTS.pair) return 'pair';
  return 'trio';
}

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

describe('run/runState: PACK FIGHTS — early-game gate (MIN_PACK_FIGHT_NUMBER)', () => {
  it('the very first fight (fightNumber 1 / wave 1) is ALWAYS solo, standard or hard, across many seeds', () => {
    expect(MIN_PACK_FIGHT_NUMBER).toBeGreaterThan(1);
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 1);
      let sawFightOne = false;
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightNumber !== 1) continue;
        sawFightOne = true;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.variant).toBe('solo');
        expect(pack.units).toHaveLength(1);
      }
      expect(sawFightOne).toBe(true);
    }
  });

  it('fight nodes below MIN_PACK_FIGHT_NUMBER never spend the pack-variant Rng draw (gate short-circuits before rollPackVariant)', () => {
    // Every fightNumber < MIN_PACK_FIGHT_NUMBER must resolve solo regardless
    // of what the raw roll off its encounterSeed would have produced.
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, MIN_PACK_FIGHT_NUMBER);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightNumber! >= MIN_PACK_FIGHT_NUMBER) continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.variant).toBe('solo');
      }
    }
  });
});

describe('run/runState: PACK FIGHTS — variant mix (deep enough that the budget solve never floors it)', () => {
  it('roughly matches PACK_VARIANT_WEIGHTS once every level is comfortably above the pair/trio budget floor', () => {
    // Pull the sample from a high wave band: by here `resolvePackMemberLevel`
    // affords level 1+ for BOTH pair and trio at every title this ladder ever
    // assigns a non-boss fight node, so the raw roll and the final `pack.variant`
    // coincide and this is a clean sanity check of PACK_VARIANT_WEIGHTS itself.
    // Filtering by BUDGET VIABILITY (not a hand-picked wave floor) is required
    // here because viability isn't monotonic in wave alone — normal-titled
    // entries need a much higher level than elite-titled ones, AND deep-run
    // MODIFIER_PRESETS (`'diamond'`, forcing every card to Diamond tier) can
    // push the viability floor for a given title BACK UP once they unlock
    // past MAX_LEVEL — see `fightSpecFor`'s modifier-escalation doc comment.
    const counts: Record<PackVariant, number> = { solo: 0, pair: 0, trio: 0 };
    let total = 0;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 150);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const entry = fightTableEntryForNode(node);
        const pairViable = resolvePackMemberLevel(entry.level, entry.title, 2, entry.modifiers) !== null;
        const trioViable = resolvePackMemberLevel(entry.level, entry.title, 3, entry.modifiers) !== null;
        if (!pairViable || !trioViable) continue; // budget would floor one of these — skip
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
      const { state, nodeIds } = combatNodesThrough(seed, 150);
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

describe('run/runState: PACK FIGHTS — BUDGET math (resolvePackMemberLevel + packBudgetDeci)', () => {
  /** Independently recompute a resolved unit's threat PL (deci) from its
   * ACTUAL scaled setup — stat PL via `monsterLevelPL` (title delta is 0 for
   * both mob/normal, the only pack-member titles, so `unit.level ===
   * unit.effectiveLevel`) plus its board's tier budget summed from the
   * ACTUAL resolved `pieces[].tier` — rather than re-deriving through the
   * same production helper twice, so this checks the real output, not just
   * that two calls to the same function agree. */
  function unitThreatDeci(level: number, pieces: readonly { tier?: string }[], modifiers: readonly string[]): number {
    const modifierBonus = modifiers.reduce((sum, id) => sum + (MODIFIER_PRESETS[id]?.bonusPL ?? 0) * 10, 0);
    const statDeci = Math.max(0, monsterLevelPL(level)) * 10 + modifierBonus;
    const deckDeci = pieces.reduce((sum, p) => sum + TIER_BUDGET_DECI[(p.tier ?? 'bronze') as keyof typeof TIER_BUDGET_DECI], 0);
    return statDeci + deckDeci;
  }

  it('a pack roll never ships over its taxed solo-equivalent budget, across a level sweep (waves 1..70)', () => {
    let sawPair = false;
    let sawTrio = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        const entry = fightTableEntryForNode(node);
        const size = PACK_SIZE[pack.variant];
        const budgetDeci = packBudgetDeci(soloThreatDeci(entry.level, entry.title, entry.modifiers), size);

        expect(pack.units).toHaveLength(size);
        // Every member is homogeneous (same solved level, capped title).
        const expectedLevel = resolvePackMemberLevel(entry.level, entry.title, size, entry.modifiers);
        expect(expectedLevel).not.toBeNull();
        const expectedTitle = capPackTitle(entry.title);
        let totalDeci = 0;
        for (const unit of pack.units) {
          expect(unit.level).toBe(expectedLevel);
          expect(unit.title).toBe(expectedTitle);
          totalDeci += unitThreatDeci(unit.level, unit.setup.pieces, unit.modifiers);
        }
        // The ONE hard invariant: never ship a pack over its taxed budget.
        // (No tight lower bound here on purpose — `REFERENCE_ENEMY_DECK_SIZE`
        // conservatively prices every member's deck cost off the WORST CASE
        // base card count in the roster, so a pack of actually-smaller-decked
        // enemies can land well under budget; that slack is intentional, see
        // `REFERENCE_ENEMY_DECK_SIZE`'s rationale in encounter.ts.)
        expect(totalDeci).toBeLessThanOrEqual(budgetDeci);

        if (pack.variant === 'pair') sawPair = true;
        if (pack.variant === 'trio') sawTrio = true;
      }
    }
    expect(sawPair).toBe(true);
    expect(sawTrio).toBe(true);
  });

  it('worked examples: normal-titled fight track LV2/LV6/LV12 all floor to solo (a 2-3 card Bronze board is already most of an early solo\'s whole budget); pairs/trios only engage much deeper (LV18/LV40)', () => {
    expect(PACK_ACTION_ECONOMY_TAX_PCT).toBe(30);
    expect(soloThreatDeci(2, 'normal')).toBe(330);
    expect(resolvePackMemberLevel(2, 'normal', 2)).toBeNull();
    expect(resolvePackMemberLevel(2, 'normal', 3)).toBeNull();

    expect(soloThreatDeci(6, 'normal')).toBe(450);
    expect(resolvePackMemberLevel(6, 'normal', 2)).toBeNull();
    expect(resolvePackMemberLevel(6, 'normal', 3)).toBeNull();

    expect(soloThreatDeci(12, 'normal')).toBe(630);
    expect(resolvePackMemberLevel(12, 'normal', 2)).toBeNull();
    expect(resolvePackMemberLevel(12, 'normal', 3)).toBeNull();

    // Pairs first become viable at LV18 (member LV1); trios not until LV40.
    expect(resolvePackMemberLevel(18, 'normal', 2)).toBe(1);
    expect(resolvePackMemberLevel(40, 'normal', 3)).toBe(1);
  });

  it("a 'hard' fight-option's +1 level (and any title bump) still feeds the budget solve for every pack member", () => {
    let sawPack = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightOption !== 'hard') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        sawPack = true;
        const entry = fightTableEntryForNode(node); // already the hard-bumped spec
        const expectedLevel = resolvePackMemberLevel(entry.level, entry.title, PACK_SIZE[pack.variant], entry.modifiers);
        for (const unit of pack.units) expect(unit.level).toBe(expectedLevel);
      }
    }
    expect(sawPack).toBe(true);
  });

  it("an 'easy' fight-option's -1 level (and title cap) still feeds the budget solve for every pack member — THREE-TIER fight choices (USER-DIRECTED 2026-08-04): an easy pack solves its budget from the EASY solo cost, falling out of the SAME fightTableEntryForNode composition as solo/hard, no per-tier branch in the roll flow", () => {
    let sawPack = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightOption !== 'easy') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        sawPack = true;
        const entry = fightTableEntryForNode(node); // already the easy-shrunk spec (-1 level, title capped at normal)
        const expectedLevel = resolvePackMemberLevel(entry.level, entry.title, PACK_SIZE[pack.variant], entry.modifiers);
        for (const unit of pack.units) {
          expect(unit.level).toBe(expectedLevel);
          expect(unit.title).toBe('normal'); // capPackTitle('normal') === 'normal'; easy's own cap already forces normal
        }
      }
    }
    expect(sawPack).toBe(true);
  });

  it("an easy pack's taxed budget never exceeds the EASY solo-equivalent cost, and is <= the standard/hard node's own budget at the same wave (the tier gradient survives the pack solve)", () => {
    for (const seed of WIDE_SEEDS.slice(0, 15)) {
      const { state, nodeIds } = combatNodesThrough(seed, 40);
      const byWave = new Map<number, { easy?: string; standard?: string; hard?: string }>();
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || !node.fightOption) continue;
        const entry = byWave.get(node.fightNumber!) ?? {};
        entry[node.fightOption] = nodeId;
        byWave.set(node.fightNumber!, entry);
      }
      for (const [, tiers] of byWave) {
        if (!tiers.easy || !tiers.standard || !tiers.hard) continue;
        const easyNode = state.map.depths.flat().find((n) => n.id === tiers.easy)!;
        const standardNode = state.map.depths.flat().find((n) => n.id === tiers.standard)!;
        const hardNode = state.map.depths.flat().find((n) => n.id === tiers.hard)!;
        const easyEntry = fightTableEntryForNode(easyNode);
        const standardEntry = fightTableEntryForNode(standardNode);
        const hardEntry = fightTableEntryForNode(hardNode);
        // soloThreatDeci is the same "vs player" reference the pack budget
        // solve taxes — the monotonic gradient must hold BEFORE any pack tax
        // is applied, since the tax (packBudgetDeci) scales every tier's
        // budget by the identical factor for a given pack size.
        const easyDeci = soloThreatDeci(easyEntry.level, easyEntry.title, easyEntry.modifiers);
        const standardDeci = soloThreatDeci(standardEntry.level, standardEntry.title, standardEntry.modifiers);
        const hardDeci = soloThreatDeci(hardEntry.level, hardEntry.title, hardEntry.modifiers);
        expect(easyDeci).toBeLessThanOrEqual(standardDeci);
        expect(standardDeci).toBeLessThanOrEqual(hardDeci);
      }
    }
  });
});

describe('run/runState: PACK FIGHTS — floor-fallback to solo (never ships an over-budget pack)', () => {
  it('when the raw roll wants a pack but the budget solve floors below LV 1, the node falls back to solo', () => {
    let found = false;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 8); // low track level (waves 2-8, gate-eligible)
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight' || node.fightNumber! < MIN_PACK_FIGHT_NUMBER) continue;
        const raw = rawPackVariant(node.encounterSeed!);
        if (raw === 'solo') continue;
        const entry = fightTableEntryForNode(node);
        const solved = resolvePackMemberLevel(entry.level, entry.title, PACK_SIZE[raw], entry.modifiers);
        if (solved !== null) continue; // this node's budget actually affords the raw roll
        found = true;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        expect(pack.variant).toBe('solo');
        expect(pack.units).toHaveLength(1);
      }
    }
    expect(found).toBe(true);
  });

  it('never returns a resolved member level below 1 for any (level, title, size) combo, across a wide sweep', () => {
    for (const level of [1, 2, 3, 5, 8, 12, 20, 30, 50]) {
      for (const title of ['normal', 'elite', 'boss'] as const) {
        for (const size of [2, 3]) {
          const level1OrNull = resolvePackMemberLevel(level, title, size);
          if (level1OrNull !== null) expect(level1OrNull).toBeGreaterThanOrEqual(1);
        }
      }
    }
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

  it('a fight column\'s standard/hard tiers (of its three: easy/standard/hard) roll INDEPENDENT packs (distinct encounterSeed)', () => {
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
