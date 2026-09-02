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
  PACK_SIZE,
  PACK_VARIANT_WEIGHTS,
  packRosterCostDeci,
  packThreatDeci,
  REFERENCE_ENEMY_DECK_SIZE,
  resolvePackMemberLevel,
  resolvePackRosterLevel,
  rosterDeckDeci,
  soloThreatDeci,
  type PackVariant,
} from '../../src/run/encounter';
import { Rng } from '../../src/engine/rng';
import { enemies } from '../../src/data/enemies';
import { TIER_BUDGET_DECI } from '../../src/engine/balance';
import { monsterLevelPL, PL_PER_LEVEL } from '../../src/run/leveling';

/**
 * PACK FIGHTS (2026-08-04, re-priced onto PL budgets 2026-08-04, re-shaped
 * 2026-08-30) — a fight-column node can roll 1-3 foes (see `rollEncounter` in
 * `src/run/runState.ts` + the `PACK_*`/budget helpers in
 * `src/run/encounter.ts`). These tests cover the roll's own contract:
 * variant mix (at levels where the budget solve can't distort it), the
 * BUDGET math (the ledger identity `packThreatDeci === soloThreatDeci`,
 * across a level sweep), the early-game gate (fight 1 is always solo), the
 * floor-fallback-to-solo invariant, the boss-is-always-solo invariant, the
 * COLUMN PROMISE (a higher risk tier is never materially easier than a lower
 * one — the invariant the map shows the player), and the preview/committed
 * determinism a pack's map preview and battle-input rely on being
 * byte-identical.
 *
 * WHY THE COLUMN PROMISE IS PINNED HERE (2026-08-30). The 2026-08-04 solve
 * charged every member a FULL board out of a taxed 1/K share, so a pack's
 * level collapsed to LV1-14 regardless of wave and a HARD pack column shipped
 * less threat than its own EASY solo — 116 such columns across a 15-seed,
 * 80-wave sweep, the worst 1170 deci under. Every assertion below is stated
 * against the model's own currency and derived constants; none of them pins a
 * level number, so a future retune moves the levels freely and still cannot
 * bring the inversion back.
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

/** Every enemy id in the roster, index-ordered (no Set/Map iteration). */
const ROSTER_IDS: readonly string[] = Object.keys(enemies);

/** The lowest node level at which a `size`-member pack is affordable at all —
 * read off the ledger, so it moves with the model instead of being a magic
 * wave number a retune would silently invalidate. */
function firstAffordable(title: 'mob' | 'normal' | 'elite' | 'boss', size: number): number {
  for (let level = 1; level <= 400; level += 1) {
    if (resolvePackMemberLevel(level, title, size) !== null) return level;
  }
  throw new Error(`firstAffordable: no ${size}-pack is ever affordable at ${title}`);
}

/** Every COMPLETE three-option fight column (easy + standard + hard node ids)
 * among `nodeIds`, in wave order — iterated by index, never by Map order. */
function fightColumns(
  state: RunState,
  nodeIds: readonly string[],
): { easy: string; standard: string; hard: string }[] {
  const byWave: { wave: number; easy?: string; standard?: string; hard?: string }[] = [];
  const all = state.map.depths.flat();
  for (const nodeId of nodeIds) {
    const node = all.find((n) => n.id === nodeId)!;
    if (node.kind !== 'fight' || !node.fightOption) continue;
    let row = byWave.find((r) => r.wave === node.fightNumber!);
    if (!row) { row = { wave: node.fightNumber! }; byWave.push(row); }
    row[node.fightOption] = nodeId;
  }
  const out: { easy: string; standard: string; hard: string }[] = [];
  for (const row of byWave) {
    if (row.easy && row.standard && row.hard) out.push({ easy: row.easy, standard: row.standard, hard: row.hard });
  }
  return out;
}

/** A resolved encounter's TOTAL threat PL (deci) — the sum over every foe it
 * actually fields, in the same currency `soloThreatDeci` quotes a node in.
 * This is what a fight-column's three risk options must be ordered by. */
function encounterThreatDeci(pack: { units: readonly { level: number; setup: { pieces: readonly { tier?: string }[] }; modifiers: readonly string[] }[] }): number {
  let deci = 0;
  for (let i = 0; i < pack.units.length; i += 1) {
    const unit = pack.units[i]!;
    const modifierBonus = unit.modifiers.reduce((sum, id) => sum + (MODIFIER_PRESETS[id]?.bonusPL ?? 0) * 10, 0);
    let deck = 0;
    for (const piece of unit.setup.pieces) deck += TIER_BUDGET_DECI[(piece.tier ?? 'bronze') as keyof typeof TIER_BUDGET_DECI];
    deci += Math.max(0, monsterLevelPL(unit.level)) * 10 + modifierBonus + deck;
  }
  return deci;
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
        // RE-PINNED 2026-09-02 (title depth ramp): viability is judged at the
        // node's own fightNumber so the filter prices the SAME ramped budget
        // rollEncounter solves against (identical at fights >= 10).
        const pairViable = resolvePackMemberLevel(entry.level, entry.title, 2, entry.modifiers, null, node.fightNumber!) !== null;
        const trioViable = resolvePackMemberLevel(entry.level, entry.title, 3, entry.modifiers, null, node.fightNumber!) !== null;
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

describe('run/runState: PACK FIGHTS — BUDGET math (the ledger identity)', () => {
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

  /** The largest amount of a node's budget an integer level solve can leave
   * unspent: the roster is homogeneous, so each of its up-to-`MAX_PACK_SIZE`
   * members can be short by at most one level's worth of PL, plus the even
   * split's own remainder (< size). Derived, never hand-picked. */
  const MAX_PACK_SIZE = Math.max(...Object.values(PACK_SIZE));
  const LEDGER_SLACK_DECI = MAX_PACK_SIZE * PL_PER_LEVEL * 10 + MAX_PACK_SIZE;

  it('THE LEDGER IDENTITY: a pack ships its node\'s FULL solo budget, to within one member level of integer rounding (waves 1..70)', () => {
    let sawPair = false;
    let sawTrio = false;
    let checked = 0;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        const entry = fightTableEntryForNode(node);
        const size = PACK_SIZE[pack.variant];
        // The BUDGET is what a SOLO foe at this node costs — one number, the
        // same one the map's other two options are priced against.
        // RE-PINNED 2026-09-02 (title depth ramp): priced at the node's own
        // fightNumber — at fights < 10 an elite/boss-titled node's budget is
        // the RAMPED package (what a solo there actually ships), identical to
        // the flat package at fights >= 10. Without this, a fight-4 hard
        // (boss-titled) pack would be held to the flat {+4,+4,+2} budget
        // (940 deci) it was never given (ramped: 600).
        const budgetDeci = soloThreatDeci(entry.level, entry.title, entry.modifiers, null, node.fightNumber!);

        expect(pack.units).toHaveLength(size);
        const expectedTitle = capPackTitle(entry.title);
        let totalDeci = 0;
        for (const unit of pack.units) {
          // Homogeneous roster: one solved level, one capped title.
          expect(unit.level).toBe(pack.units[0]!.level);
          expect(unit.title).toBe(expectedTitle);
          totalDeci += unitThreatDeci(unit.level, unit.setup.pieces, unit.modifiers);
        }

        // UPPER BOUND — never ship a pack over its node's budget. (This was
        // the model's only invariant before 2026-08-30, and it was satisfied
        // vacuously: nothing stopped a pack landing 50% under.)
        expect(totalDeci, `${seed} w${node.wave} ${pack.variant} over budget`).toBeLessThanOrEqual(budgetDeci);
        // LOWER BOUND — and this is the half that was missing. A pack must
        // SPEND the budget, not merely stay under it.
        expect(budgetDeci - totalDeci, `${seed} w${node.wave} ${pack.variant} under-spent`).toBeLessThanOrEqual(LEDGER_SLACK_DECI);

        // The production helper prices the same roster the same way.
        expect(packThreatDeci(pack.units[0]!.level, size, expectedTitle, entry.modifiers)
          - packRosterCostDeci(size, expectedTitle, entry.modifiers)
          + rosterDeckDeci(pack.units.map((u) => u.enemyId), expectedTitle, entry.modifiers)
          + size * entry.modifiers.reduce((sum, id) => sum + (MODIFIER_PRESETS[id]?.bonusPL ?? 0) * 10, 0),
        ).toBe(totalDeci);

        checked += 1;
        if (pack.variant === 'pair') sawPair = true;
        if (pack.variant === 'trio') sawTrio = true;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(sawPair).toBe(true);
    expect(sawTrio).toBe(true);
  });

  it('the generic solve is CONSERVATIVE: pricing every board at REFERENCE_ENEMY_DECK_SIZE can only under-state the level the drawn roster affords, never over-state it', () => {
    // This is what lets `rollEncounter` decide pack-vs-solo BEFORE it draws a
    // single enemy id (so the draw count never moves) and still re-solve the
    // level exactly afterwards.
    for (const seed of WIDE_SEEDS.slice(0, 20)) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const nodeId of nodeIds) {
        const node = state.map.depths.flat().find((n) => n.id === nodeId)!;
        if (node.kind !== 'fight') continue;
        const pack = rollEncounter({ ...state, currentNodeId: nodeId });
        if (pack.variant === 'solo') continue;
        const entry = fightTableEntryForNode(node);
        const size = PACK_SIZE[pack.variant];
        // (2026-09-02) Both solves at the node's fightNumber — the ramped
        // budget rollEncounter itself uses; see the ledger re-pin above.
        const generic = resolvePackMemberLevel(entry.level, entry.title, size, entry.modifiers, null, node.fightNumber!);
        const exact = resolvePackRosterLevel(pack.units.map((u) => u.enemyId), entry.level, entry.title, entry.modifiers, null, node.fightNumber!);
        expect(generic).not.toBeNull();
        expect(exact).not.toBeNull();
        expect(exact!).toBeGreaterThanOrEqual(generic!);
        expect(pack.units[0]!.level).toBe(exact);
      }
    }
  });

  it('every enemy in the roster fits the generic worst case, so the conservative solve is actually conservative', () => {
    for (const title of ['mob', 'normal'] as const) {
      for (const modifiers of [[], ['diamond'], ['diamond', 'swift']]) {
        for (const id of ROSTER_IDS) {
          expect(rosterDeckDeci([id], title, modifiers))
            .toBeLessThanOrEqual(packRosterCostDeci(1, title, modifiers)
              - modifiers.reduce((sum, m) => sum + (MODIFIER_PRESETS[m]?.bonusPL ?? 0) * 10, 0));
        }
      }
    }
    expect(REFERENCE_ENEMY_DECK_SIZE).toBeGreaterThanOrEqual(2);
  });

  it('worked examples: the ledger, not a level number — an early node cannot afford two boards at all, and the first affordable pair/trio lands exactly on its budget', () => {
    // A LV2 normal node is worth 330 deci: 30 of stats over one 300-deci
    // Bronze board. Two boards cost 600 — already double the whole node — so
    // no pair exists here, whatever the variant roll said.
    expect(soloThreatDeci(2, 'normal')).toBe(330);
    expect(packRosterCostDeci(2, 'normal', [])).toBeGreaterThan(soloThreatDeci(2, 'normal'));
    expect(resolvePackMemberLevel(2, 'normal', 2)).toBeNull();
    expect(resolvePackMemberLevel(2, 'normal', 3)).toBeNull();

    // The floor is the ledger's own, not a hand-picked wave: a pair becomes
    // affordable exactly when the node is worth two boards, a trio at three.
    const firstPair = firstAffordable('normal', 2);
    const firstTrio = firstAffordable('normal', 3);
    expect(soloThreatDeci(firstPair, 'normal')).toBeGreaterThanOrEqual(packRosterCostDeci(2, 'normal', []));
    expect(soloThreatDeci(firstPair - 1, 'normal')).toBeLessThan(packRosterCostDeci(2, 'normal', []));
    expect(firstTrio).toBeGreaterThan(firstPair);
    expect(resolvePackMemberLevel(firstPair, 'normal', 2)).toBe(1);
    expect(resolvePackMemberLevel(firstTrio, 'normal', 3)).toBe(1);

    // And once affordable, the solve SPENDS the budget: the shortfall at any
    // depth is only the integer-level remainder, never a structural gap.
    for (const level of [firstPair, 25, 40, 62, 90]) {
      for (const size of [2, 3] as const) {
        const solved = resolvePackMemberLevel(level, 'normal', size, []);
        if (solved === null) continue;
        const shipped = packThreatDeci(solved, size, 'normal', []);
        const budget = soloThreatDeci(level, 'normal', []);
        expect(shipped).toBeLessThanOrEqual(budget);
        expect(budget - shipped).toBeLessThanOrEqual(size * PL_PER_LEVEL * 10 + size);
      }
    }
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
        const ids = pack.units.map((u) => u.enemyId);
        // (2026-09-02) At the node's fightNumber: the hard option's title bump
        // lands on the RAMPED package at fights < 10 (see the ledger re-pin).
        const expectedLevel = resolvePackRosterLevel(ids, entry.level, entry.title, entry.modifiers, null, node.fightNumber!);
        for (const unit of pack.units) expect(unit.level).toBe(expectedLevel);
        // and the hard bump is what moved it: the same roster at the STANDARD
        // spec must solve no higher.
        const standardSpec = fightTableEntryForNode({ fightNumber: node.fightNumber, fightOption: 'standard' });
        const standardLevel = resolvePackRosterLevel(ids, standardSpec.level, standardSpec.title, standardSpec.modifiers, null, node.fightNumber!);
        // `null` = the standard spec cannot even afford this roster, which is
        // itself the hard option being the bigger budget.
        if (standardLevel !== null) expect(expectedLevel!).toBeGreaterThanOrEqual(standardLevel);
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
        // (2026-09-02) fightNumber passed for uniformity — easy's normal title
        // never ramps, so this is identical either way.
        const expectedLevel = resolvePackRosterLevel(pack.units.map((u) => u.enemyId), entry.level, entry.title, entry.modifiers, null, node.fightNumber!);
        for (const unit of pack.units) {
          expect(unit.level).toBe(expectedLevel);
          expect(unit.title).toBe('normal'); // capPackTitle('normal') === 'normal'; easy's own cap already forces normal
        }
      }
    }
    expect(sawPack).toBe(true);
  });

  it('the SPEC gradient is monotone before any pack solve runs: easy <= standard <= hard, every column', () => {
    for (const seed of WIDE_SEEDS.slice(0, 15)) {
      const { state, nodeIds } = combatNodesThrough(seed, 40);
      for (const tiers of fightColumns(state, nodeIds)) {
        const specs = (['easy', 'standard', 'hard'] as const).map((opt) => {
          const node = state.map.depths.flat().find((n) => n.id === tiers[opt]!)!;
          const entry = fightTableEntryForNode(node);
          // RE-PINNED 2026-09-02 (title depth ramp): priced at the node's own
          // fightNumber, so this asserts the gradient of what the ladder
          // actually ships — the ramp table was shaped so the RAMPED budgets
          // stay strictly monotone per column too (hard's +1 level and its
          // boss cell dominating the elite cell carry the ordering).
          return soloThreatDeci(entry.level, entry.title, entry.modifiers, null, node.fightNumber!);
        });
        expect(specs[0]!).toBeLessThanOrEqual(specs[1]!);
        expect(specs[1]!).toBeLessThanOrEqual(specs[2]!);
      }
    }
  });
});

/**
 * THE COLUMN PROMISE (2026-08-30) — the invariant the MAP shows the player,
 * pinned against what a column actually ships rather than what its spec says.
 *
 * A fight column offers three risk tiers side by side. Whatever each of them
 * rolls — one foe, a pair, a trio — the higher tier must not be the easier
 * fight. This is the assertion the 2026-08-04 pack solve broke and no existing
 * test could see: the old gradient test compared the three options' SPECS,
 * which are monotone by construction (`fightTableEntryForNode` just adds a
 * level and bumps a title), and never looked at what the pack solve then
 * turned that spec into.
 *
 * TWO TOLERANCES, BOTH DERIVED, NEITHER TUNED:
 *   • `ROUNDING_SLACK_DECI` — a homogeneous roster's level is an integer, so
 *     up to one level per member of its budget is unspendable.
 *   • `ROSTER_JITTER_DECI` — the roster is not PL-flat: enemies ship 2 or 3
 *     authored cards, and the DIAMOND escalation modifier prices every card at
 *     the top tier, so two SOLO foes at the same level can differ by one card
 *     at `TIER_BUDGET_DECI.diamond`. That variance is pre-existing, has
 *     nothing to do with packs (it shows up on solo-only columns at exactly
 *     the same magnitude), and is owned by `src/data`.
 * Nothing here pins a level, a wave, or a tax rate.
 */
describe('run/runState: PACK FIGHTS — THE COLUMN PROMISE (a higher risk tier is never materially easier)', () => {
  const MAX_PACK_SIZE = Math.max(...Object.values(PACK_SIZE));
  const ROUNDING_SLACK_DECI = MAX_PACK_SIZE * PL_PER_LEVEL * 10 + MAX_PACK_SIZE;
  const ROSTER_JITTER_DECI = TIER_BUDGET_DECI.diamond;
  const TOLERANCE_DECI = ROUNDING_SLACK_DECI + ROSTER_JITTER_DECI;

  it("HARD never ships less threat than its own column's EASY, across a seed x wave sweep", () => {
    let columns = 0;
    let packColumns = 0;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const tiers of fightColumns(state, nodeIds)) {
        const rolled = (['easy', 'standard', 'hard'] as const).map((opt) =>
          rollEncounter({ ...state, currentNodeId: tiers[opt]! }));
        const [easy, standard, hard] = rolled.map(encounterThreatDeci) as [number, number, number];
        const wave = state.map.depths.flat().find((n) => n.id === tiers.easy)!.wave;
        const shape = rolled.map((p) => p.variant).join('/');

        // THE HEADLINE: the option the map labels riskiest is never the soft one.
        expect(hard, `s${seed} w${wave} [${shape}] HARD ${hard} < EASY ${easy}`)
          .toBeGreaterThanOrEqual(easy - ROUNDING_SLACK_DECI);
        // And the gradient holds step by step, within the roster's own variance.
        expect(standard, `s${seed} w${wave} [${shape}] STANDARD ${standard} < EASY ${easy}`)
          .toBeGreaterThanOrEqual(easy - TOLERANCE_DECI);
        expect(hard, `s${seed} w${wave} [${shape}] HARD ${hard} < STANDARD ${standard}`)
          .toBeGreaterThanOrEqual(standard - TOLERANCE_DECI);

        columns += 1;
        if (rolled.some((p) => p.units.length > 1)) packColumns += 1;
      }
    }
    // The sweep has to actually contain packs, or it proves nothing.
    expect(columns).toBeGreaterThan(500);
    expect(packColumns).toBeGreaterThan(100);
  });

  it('a PACK column is no more prone to an inversion than a solo-only one — packs add no jitter of their own', () => {
    // The 2026-08-04 solve failed exactly here: pack columns inverted by up to
    // 1170 deci while solo-only columns never exceeded the roster's own card
    // variance. Both must now sit inside the SAME bound.
    let worstPack = 0;
    let worstSolo = 0;
    for (const seed of WIDE_SEEDS) {
      const { state, nodeIds } = combatNodesThrough(seed, 70);
      for (const tiers of fightColumns(state, nodeIds)) {
        const rolled = (['easy', 'standard', 'hard'] as const).map((opt) =>
          rollEncounter({ ...state, currentNodeId: tiers[opt]! }));
        const [easy, standard, hard] = rolled.map(encounterThreatDeci) as [number, number, number];
        const worst = Math.max(easy - standard, standard - hard, easy - hard, 0);
        if (rolled.some((p) => p.units.length > 1)) worstPack = Math.max(worstPack, worst);
        else worstSolo = Math.max(worstSolo, worst);
      }
    }
    expect(worstSolo).toBeLessThanOrEqual(TOLERANCE_DECI);
    expect(worstPack).toBeLessThanOrEqual(TOLERANCE_DECI);
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
        // (2026-09-02) Solved at the node's fightNumber — the ramped early
        // budgets floor MORE rolls back to solo (elite fights 3-4 can no
        // longer afford two boards), which is exactly this test's subject.
        const solved = resolvePackMemberLevel(entry.level, entry.title, PACK_SIZE[raw], entry.modifiers, null, node.fightNumber!);
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
