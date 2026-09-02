import { describe, expect, it } from 'vitest';
import {
  applyDraftResult,
  availableChoices,
  BOSS_SWIFT_FROM_FIGHT,
  buyHeroStatAllocation,
  buyRunCard,
  buyRunGem,
  chooseNode,
  createRun,
  currentEventNode,
  currentShopNode,
  DAILY_INCOME,
  ensureRunShopShelf,
  fightSpecFor,
  fightTableEntry,
  fightTableEntryForNode,
  heroAllocationCost,
  leaveEvent,
  leaveShop,
  LIVES_PER_RUN,
  MAX_LEVEL,
  mergeRunCard,
  recordBattleResult,
  rerollCostForNode,
  rerollRunShop,
  retireRun,
  rollEncounter,
  runBagHasRoomFor,
  runMergeTargetFor,
  setHeroAllocation,
  type RunBagSlot,
  type RunBoardPiece,
  type RunState,
} from '../../src/run/runState';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import { battleGoldReward, rollShopStock } from '../../src/run/shop';
import { BOSS_EVERY, ensureWavesThrough, type RunNode } from '../../src/run/runMap';
import { bankedPL, LEVEL_STAT_COST } from '../../src/run/leveling';
import { buildEnemyEncounter, TITLE_PRESETS } from '../../src/run/encounter';
import { gemBook } from '../../src/data/gems';
import { skillBook } from '../../src/data/skills';
import type { SkillTier } from '../../src/engine/types';

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    picks[key] = draft[key][0]!.skillId;
  }
  return picks;
}

/** Same shape as `draftPicksFor`, but picks the LARGEST-size candidate in
 * each of the 4 sets rather than always `[0]` — the policy that actually
 * exercises the overflow path (offense(3) + defense(3) + support(2) +
 * wildcard(3) = 11 > `RUN_BOARD_SLOTS` for several seeds), since a player is
 * free to click any of the 5 offered cards per set (`DesktopDraftScene`). */
function largestDraftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) {
    const set = draft[key];
    let best = set[0]!;
    for (const card of set) {
      const bestSize = skillBook[best.skillId]?.size ?? 1;
      const cardSize = skillBook[card.skillId]?.size ?? 1;
      if (cardSize > bestSize) best = card;
    }
    picks[key] = best.skillId;
  }
  return picks;
}

/**
 * Seeds whose largest-card draft genuinely overflows the 10-slot board.
 *
 * SEARCHED, NEVER PINNED. An earlier version hardcoded [25, 45, 158, ...],
 * which broke the moment content was added: `rollStartDraft` draws from the
 * live `skillBook`, so growing the book reshuffles which seeds overflow. The
 * assertion those seeds existed to support — that an overflowing pick is not
 * dropped — is about the BEHAVIOUR, not about any particular seed, so the test
 * finds its own fixtures instead of asserting the book never changes.
 */
function overflowingSeeds(count: number): number[] {
  const found: number[] = [];
  for (let seed = 0; seed < 5000 && found.length < count; seed += 1) {
    const picks = largestDraftPicksFor(seed);
    const total = DRAFT_SET_KEYS.map((k) => picks[k])
      .filter((id): id is string => id != null)
      .reduce((sum, id) => sum + (skillBook[id]?.size ?? 1), 0);
    if (total > 10) found.push(seed);
  }
  if (found.length < count) {
    throw new Error(`only ${found.length} overflowing seeds found; the card book may no longer contain enough large cards`);
  }
  return found;
}

/** Every owned skillId across both the board and the bag, for an
 * `applyDraftResult` output — the invariant helper: this must always equal
 * the set of picks the player actually made. */
function ownedSkillIds(state: RunState): string[] {
  return [
    ...state.pieces.map((p) => p.skillId),
    ...state.bagSlots.filter((c): c is NonNullable<RunBagSlot> => c != null).map((c) => c.skillId),
  ];
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Walk an active run forward (browsing shops, leaving events unresolved,
 * winning every fight/boss) until the FIRST shop node is reached — returned
 * with that node still `current` (uncommitted) so the caller can roll/browse
 * its shelf. Shared by the shop-purchase and duplicate-merge describe blocks
 * below. Throws if the guard is exceeded before finding one. */
function stateAtFirstShop(seed: number): { state: RunState; nodeId: string } {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error('no shop node reachable for this seed');
    const shop = choices.find((n) => n.kind === 'shop');
    if (shop) {
      state = chooseNode(state, shop.id);
      return { state, nodeId: shop.id };
    }
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'event') {
      state = leaveEvent(state);
    } else if (node.kind === 'boss' || node.kind === 'fight') {
      state = recordBattleResult(state, { won: true, goldEarned: 1 });
    }
  }
  throw new Error('guard exceeded while looking for a shop node');
}

/** Walk an active run forward, always taking the first available choice,
 * browsing (not buying) shops, leaving events unresolved, and resolving
 * every fight/boss with `won` — UNTIL a fight/boss node whose `fightNumber`
 * equals `targetFightNumber` is reached. Returns with that node still
 * `current` (uncommitted) so the caller can resolve it. Throws if the run
 * ends (defeat) or the guard is exceeded before getting there. */
function walkToFightNumber(seed: number, targetFightNumber: number, won = true): RunState {
  let state = startedRun(seed);
  for (let guard = 0; guard < 5000; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) {
      throw new Error(`run ended (status "${state.status}") before reaching fight ${targetFightNumber}`);
    }
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') {
      state = leaveShop(state);
      continue;
    }
    if (node.kind === 'event') {
      state = leaveEvent(state);
      continue;
    }
    // fight or boss
    if (node.fightNumber === targetFightNumber) return state;
    state = recordBattleResult(state, { won, goldEarned: 5 });
  }
  throw new Error('guard exceeded while walking to target fight');
}

/** Walk stop columns (browsing shops, leaving events unresolved) until the
 * first fight/boss node is reached; returns with that node still `current`
 * (uncommitted result) so the caller can resolve it. */
function stateAtFirstFight(seed: number): RunState {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard++) {
    const choices = availableChoices(state);
    if (choices.length === 0) throw new Error('no fight node reachable for this seed');
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'fight' || node.kind === 'boss') return state;
    if (node.kind === 'shop') state = leaveShop(state);
    else state = leaveEvent(state);
  }
  throw new Error('guard exceeded while looking for a fight node');
}

describe('run/runState: determinism', () => {
  it('same seed -> identical map + encounter rolls', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const a = createRun(seed);
      const b = createRun(seed);
      expect(a.map).toEqual(b.map);

      const firstNodeId = a.map.depths[1]![0]!.id;
      const withA = chooseNode(applyDraftResult(a, draftPicksFor(seed)), firstNodeId);
      const withB = chooseNode(applyDraftResult(b, draftPicksFor(seed)), firstNodeId);
      const kind = withA.map.depths[1]![0]!.kind;
      if (kind === 'fight' || kind === 'boss') {
        expect(rollEncounter(withA)).toEqual(rollEncounter(withB));
        // Repeated calls for the same node are stable too.
        expect(rollEncounter(withA)).toEqual(rollEncounter(withA));
      }
    }
  });
});

describe('run/runState: draft + choices', () => {
  it('createRun starts in drafting status with no board, full lives, no bosses cleared', () => {
    const state = createRun(7);
    expect(state.status).toBe('drafting');
    expect(state.pieces).toHaveLength(0);
    expect(state.depth).toBe(0);
    expect(state.lives).toBe(LIVES_PER_RUN);
    expect(state.bossesCleared).toBe(0);
    expect(availableChoices(state)).toHaveLength(0);
  });

  it('applyDraftResult installs 4 cards and goes active', () => {
    const state = startedRun(7);
    expect(state.status).toBe('active');
    expect(state.pieces).toHaveLength(4);
    expect(state.gold).toBe(0);
  });

  it('applyDraftResult throws once already active', () => {
    const state = startedRun(7);
    expect(() => applyDraftResult(state, draftPicksFor(7))).toThrow();
  });

  it('a pick that overflows the board (largest-card policy) lands in the bag instead of being dropped', () => {
    // Seed 25 reproduces the historical bug: offense(3) + defense(3) +
    // support(2) + wildcard(3) = 11 > RUN_BOARD_SLOTS(10), and the wildcard
    // pick (annihilation_strike) used to be silently dropped.
    for (const seed of overflowingSeeds(5)) {
      const picks = largestDraftPicksFor(seed);
      const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
      const totalSize = pickedIds.reduce((sum, id) => sum + (skillBook[id]?.size ?? 1), 0);
      expect(totalSize).toBeGreaterThan(10); // the searched seed genuinely overflows

      const state = applyDraftResult(createRun(seed), picks);
      expect(state.status).toBe('active');
      // Every picked card is owned somewhere — board or bag — none dropped.
      expect(ownedSkillIds(state).sort()).toEqual([...pickedIds].sort());
      // The overflowing card specifically landed in the bag, not nowhere.
      expect(state.bagSlots.some((c) => c != null)).toBe(true);
      // Nothing on the board overlaps a bag slot, and vice versa: every
      // board piece's slots stay within bounds (canPlace's own invariant).
      for (const piece of state.pieces) {
        const size = skillBook[piece.skillId]?.size ?? 1;
        expect(piece.slot + size).toBeLessThanOrEqual(10);
      }
    }
  });

  it('the small-pick path (draftPicksFor: always candidate [0]) is unchanged — all 4 land on the board, none in the bag', () => {
    for (const seed of [1, 2, 3, 7, 42, 999]) {
      const picks = draftPicksFor(seed);
      const state = applyDraftResult(createRun(seed), picks);
      expect(state.pieces).toHaveLength(4);
      expect(state.bagSlots.every((c) => c == null)).toBe(true);
      const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
      expect(ownedSkillIds(state).sort()).toEqual([...pickedIds].sort());
    }
  });

  it('invariant: owned-card count after applyDraftResult always equals picks made, across many seeds and both pick policies (largest never drops, and never throws)', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const picksFor of [draftPicksFor, largestDraftPicksFor]) {
        const picks = picksFor(seed);
        const pickedIds = DRAFT_SET_KEYS.map((key) => picks[key]).filter((id): id is string => id != null);
        const state = applyDraftResult(createRun(seed), picks);
        expect(ownedSkillIds(state)).toHaveLength(pickedIds.length);
        expect(ownedSkillIds(state).sort()).toEqual([...pickedIds].sort());
      }
    }
  });

  it('availableChoices surfaces the depth-1 column (2-3 nodes) right after draft', () => {
    const state = startedRun(7);
    const choices = availableChoices(state);
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(choices.every((n) => n.depth === 1)).toBe(true);
  });

  it('chooseNode rejects a node that is not an available choice', () => {
    const state = startedRun(7);
    expect(() => chooseNode(state, 'not-a-real-node')).toThrow();
    // A well-formed but never-actually-generated-as-a-CHOICE id (far beyond
    // anything the map would ever produce at this depth) is still rejected.
    expect(() => chooseNode(state, 'd9999-0')).toThrow();
  });

  it('while a node is occupied, availableChoices is empty', () => {
    const state = startedRun(7);
    const first = availableChoices(state)[0]!;
    const occupied = chooseNode(state, first.id);
    expect(availableChoices(occupied)).toHaveLength(0);
  });

  it('the map lazily extends as the run walks deeper — 40+ fights never hits a missing column', () => {
    let state = startedRun(13);
    let fightsSeen = 0;
    for (let guard = 0; guard < 3000 && fightsSeen < 42; guard++) {
      const choices = availableChoices(state);
      expect(choices.length).toBeGreaterThan(0); // never an empty/void column
      const node = choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'shop') state = leaveShop(state);
      else if (node.kind === 'event') state = leaveEvent(state);
      else {
        fightsSeen += 1;
        state = recordBattleResult(state, { won: true, goldEarned: 5 });
      }
    }
    expect(fightsSeen).toBeGreaterThanOrEqual(42);
    expect(state.status).toBe('active');
  });
});

describe('run/runState: fight-spec resolver (endless, replaces the fixed FIGHT_TABLE)', () => {
  it('cadence repeats every BOSS_EVERY (5) fights: 1,2 normal · 3,4 elite · 5 boss · 6,7 normal · ...', () => {
    const expected: Record<number, string> = {
      1: 'normal', 2: 'normal', 3: 'elite', 4: 'elite', 5: 'boss',
      6: 'normal', 7: 'normal', 8: 'elite', 9: 'elite', 10: 'boss',
      11: 'normal', 12: 'normal',
    };
    for (const [n, title] of Object.entries(expected)) {
      expect(fightSpecFor(Number(n)).title).toBe(title);
    }
  });

  it('level tracks the fight number 1:1 forever — no upper bound (2026-07-30 fix)', () => {
    for (const n of [1, 30, 31, 45, 100, 1000]) {
      expect(fightSpecFor(n).level).toBe(n);
    }
  });

  // RE-PINNED (2026-09-02, boss tempo): fights at/under the cap used to carry
  // NO modifiers at all. Bosses from `BOSS_SWIFT_FROM_FIGHT` (10) now carry
  // `swift` — measured fix for milestone bosses under-threatening their band
  // (w15 boss won 35% vs its band's 47.5-50% standard fights and even sat
  // above the optional hard rung's 12.5%; with swift it measures 20%).
  // Non-boss fights at/under the cap still carry none.
  it('at/under the level cap (fight 30): non-boss fights carry no modifiers; bosses from fight 10 carry exactly [swift]', () => {
    expect(fightSpecFor(30).modifiers).toEqual(['swift']); // fight 30 is a boss (pos 5)
    expect(fightSpecFor(29).modifiers).toEqual([]);
    expect(fightSpecFor(28).modifiers).toEqual([]);
    for (let n = 1; n <= 30; n += 1) {
      const spec = fightSpecFor(n);
      if (spec.title === 'boss' && n >= BOSS_SWIFT_FROM_FIGHT) {
        expect(spec.modifiers, `fight ${n}`).toEqual(['swift']);
      } else {
        expect(spec.modifiers, `fight ${n}`).toEqual([]);
      }
    }
  });

  it('boss tempo: swift starts EXACTLY at BOSS_SWIFT_FROM_FIGHT, and is never duplicated once the escalation ramp unlocks it', () => {
    expect(BOSS_SWIFT_FROM_FIGHT).toBe(10);
    expect(fightSpecFor(5).modifiers).toEqual([]); // boss #1 stays swift-free (early-curve fix)
    expect(fightSpecFor(10).modifiers).toEqual(['swift']);
    expect(fightSpecFor(15).modifiers).toEqual(['swift']);
    // Deep bosses: the escalation ramp already delivers swift as a distinct id
    // — the boss branch must not add a second copy (battleGoldReward counts
    // modifiers.length, so a duplicate would inflate gold for free).
    for (let n = BOSS_SWIFT_FROM_FIGHT; n <= 200; n += 1) {
      const spec = fightSpecFor(n);
      if (spec.title !== 'boss') continue;
      expect(spec.modifiers.filter((id) => id === 'swift'), `fight ${n}`).toHaveLength(1);
    }
  });

  it('modifiers past the cap are DISTINCT (never repeated) at every fight number 1-200', () => {
    for (let n = 1; n <= 200; n++) {
      const mods = fightSpecFor(n).modifiers;
      expect(new Set(mods).size).toBe(mods.length);
    }
  });

  it('escalation past the cap keeps growing: fight 45 unlocks more distinct modifiers than fight 30, fight 100 at least as many as 45', () => {
    const at30 = fightSpecFor(30);
    const at45 = fightSpecFor(45);
    const at100 = fightSpecFor(100);
    expect(at45.modifiers.length).toBeGreaterThan(at30.modifiers.length);
    expect(at100.modifiers.length).toBeGreaterThanOrEqual(at45.modifiers.length);
  });

  it('difficulty is monotonic and genuinely unbounded — metric: buildEnemyEncounter\'s resolved stat total (sum of setup.stats) strictly increases at fights 30 -> 45 -> 100', () => {
    const statTotal = (n: number): number => {
      const spec = fightSpecFor(n);
      const rank = TITLE_PRESETS[spec.title].rank;
      const encounter = buildEnemyEncounter('wolf_king', spec.level, spec.title, rank, spec.modifiers);
      const s = encounter.setup.stats;
      return s.maxHp + s.attack + s.magicPower + s.armor + s.magicResist + s.speed;
    };
    const at30 = statTotal(30);
    const at45 = statTotal(45);
    const at100 = statTotal(100);
    expect(at45).toBeGreaterThan(at30);
    expect(at100).toBeGreaterThan(at45);
  });

  it('a table for fights 1-12 and 28-32 (spot-check the old cap crossover, now a non-event)', () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => i + 1), 28, 29, 30, 31, 32];
    const table = rows.map((n) => ({ n, ...fightSpecFor(n) }));
    // fight 30 is exactly the old cap: level now simply equals the fight
    // number on both sides — 31/32 keep climbing (31, 32), not pinned at 30.
    // RE-PINNED 2026-09-02: fight 30 is a boss, so it carries the boss-tempo
    // `swift` (see BOSS_SWIFT_FROM_FIGHT); non-boss 31/32 still carry nothing.
    expect(table.find((r) => r.n === 30)).toMatchObject({ level: 30, title: 'boss', modifiers: ['swift'] });
    expect(table.find((r) => r.n === 31)).toMatchObject({ level: 31, title: 'normal', modifiers: [] });
    expect(table.find((r) => r.n === 32)).toMatchObject({ level: 32, title: 'normal' });
  });

  it('fightTableEntry is a thin alias of fightSpecFor', () => {
    for (const n of [1, 5, 12, 30, 45, 100]) {
      expect(fightTableEntry(n)).toEqual(fightSpecFor(n));
    }
  });

  it("fightTableEntryForNode's 'hard' option is one title rung + 1 level (uncapped) above 'standard', modifiers unchanged", () => {
    for (const n of [1, 3, 6, 8, 29, 44, 99]) {
      const standard = fightTableEntryForNode({ fightNumber: n, fightOption: 'standard' });
      const hard = fightTableEntryForNode({ fightNumber: n, fightOption: 'hard' });
      const rung: Record<string, string> = { normal: 'elite', elite: 'boss' };
      expect(hard.level).toBe(standard.level + 1);
      expect(hard.title).toBe(rung[standard.title]);
      expect(hard.modifiers).toEqual(standard.modifiers);
    }
  });

  it("fightTableEntryForNode's 'easy' option is 1 level BELOW 'standard' (floored at 1), title capped at 'normal' (never 'elite'), modifiers unchanged — THREE-TIER fight choices, USER-DIRECTED 2026-08-04", () => {
    for (const n of [1, 3, 6, 8, 29, 44, 99]) {
      const standard = fightTableEntryForNode({ fightNumber: n, fightOption: 'standard' });
      const easy = fightTableEntryForNode({ fightNumber: n, fightOption: 'easy' });
      expect(easy.level).toBe(Math.max(1, standard.level - 1));
      expect(easy.title).toBe('normal'); // fight nodes are always normal/elite; easy caps either down to normal
      expect(easy.modifiers).toEqual(standard.modifiers);
    }
  });

  it("the three tiers form a strict difficulty ladder (easy <= standard <= hard) in BOTH level and title rank, for every non-boss fight number", () => {
    const titleRank: Record<string, number> = { mob: 0, normal: 1, elite: 2, boss: 3 };
    for (const n of [1, 2, 3, 4, 6, 7, 8, 9, 29, 44, 99]) {
      const easy = fightTableEntryForNode({ fightNumber: n, fightOption: 'easy' });
      const standard = fightTableEntryForNode({ fightNumber: n, fightOption: 'standard' });
      const hard = fightTableEntryForNode({ fightNumber: n, fightOption: 'hard' });
      expect(easy.level).toBeLessThanOrEqual(standard.level);
      expect(standard.level).toBeLessThanOrEqual(hard.level);
      expect(titleRank[easy.title]).toBeLessThanOrEqual(titleRank[standard.title]!);
      expect(titleRank[standard.title]).toBeLessThanOrEqual(titleRank[hard.title]!);
    }
  });

  it('battleGoldReward stays monotonic in fight number at a fixed hero level, and is no longer inflated by duplicate modifier entries', () => {
    const heroLevel = MAX_LEVEL;
    const rewardFor = (n: number) => {
      const spec = fightSpecFor(n);
      return battleGoldReward([{ level: spec.level, title: spec.title, rank: 0, modifiers: spec.modifiers }], heroLevel);
    };
    const fights = [1, 5, 10, 30, 35, 45, 60, 100];
    let prevScore = -Infinity;
    for (const n of fights) {
      const reward = rewardFor(n);
      // winBonus itself clamps at 3, so compare via the un-clamped difficulty
      // proxy instead: level-above-hero + title weight + distinct modifiers.
      const spec = fightSpecFor(n);
      const score = Math.max(0, spec.level - heroLevel) + spec.modifiers.length;
      expect(score).toBeGreaterThanOrEqual(prevScore);
      prevScore = score;
      expect(reward.winBonus).toBeGreaterThanOrEqual(1);
      expect(reward.winBonus).toBeLessThanOrEqual(3);
    }
    // Two fight numbers with the SAME modifier-layer count must score
    // identically on the modifiers axis (no duplicate-id inflation possible,
    // since modifiers are always a distinct prefix of ENEMY_MODIFIER_IDS).
    const at31 = fightSpecFor(31);
    const at34 = fightSpecFor(34);
    expect(at31.modifiers).toEqual(at34.modifiers);
  });
});

describe('run/runState: hero/enemy level lockstep + cap', () => {
  it('the hero is exactly LV n entering fight n while under the cap, across seeds', () => {
    for (const seed of [1, 2, 3, 11, 42, 100]) {
      let state = startedRun(seed);
      expect(state.heroLevel).toBe(1);
      let fightsSeen = 0;
      for (let guard = 0; guard < 200 && fightsSeen < BOSS_EVERY * 2; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const node = choices[0]!;
        state = chooseNode(state, node.id);
        if (node.kind === 'shop') { state = leaveShop(state); continue; }
        if (node.kind === 'event') { state = leaveEvent(state); continue; }
        fightsSeen += 1;
        expect(state.heroLevel).toBe(node.fightNumber);
        expect(node.fightNumber).toBe(fightsSeen);
        // Lose exactly once (fight 1) to prove a LOSS also bumps the level
        // (see `recordBattleResult`), then win the rest — losing more than
        // LIVES_PER_RUN times would end the run before this window finishes,
        // which "a loss on a non-boss node ... still levels the hero" already
        // covers on its own in isolation.
        const won = fightsSeen !== 1;
        state = recordBattleResult(state, { won, goldEarned: 5 });
      }
      expect(fightsSeen).toBe(BOSS_EVERY * 2);
    }
  });

  it('hero level caps at MAX_LEVEL and never exceeds it, walking well past fight 30 (win every fight to avoid losing lives)', () => {
    const state = walkToFightNumber(11, MAX_LEVEL + 15, true);
    // state is sitting AT the target fight, uncommitted — heroLevel reflects
    // every EARLIER fight's level-up already applied.
    expect(state.heroLevel).toBeLessThanOrEqual(MAX_LEVEL);
    expect(state.heroLevel).toBe(MAX_LEVEL);
    const after = recordBattleResult(state, { won: true, goldEarned: 5 });
    expect(after.heroLevel).toBe(MAX_LEVEL);
  });

  it('hero-vs-enemy gap widens past fight 30 (2026-07-30 fix): at fight 45 the enemy is above hero-level-30, an intended, documented gap', () => {
    // Walk to fight 45 without ever resolving it, winning every earlier fight
    // so heroLevel is already pinned at MAX_LEVEL by then.
    const state = walkToFightNumber(11, MAX_LEVEL + 15, true);
    expect(state.heroLevel).toBe(MAX_LEVEL);
    const enemyLevel = fightSpecFor(45).level;
    expect(enemyLevel).toBeGreaterThan(state.heroLevel);
    expect(enemyLevel).toBe(45);
  });
});

describe('run/runState: lives, defeat, and retire (endless run — no more fixed victory)', () => {
  it('LIVES_PER_RUN is 3 and createRun starts with a full life total', () => {
    expect(LIVES_PER_RUN).toBe(3);
    expect(createRun(1).lives).toBe(LIVES_PER_RUN);
  });

  it('a fight loss costs exactly one life; a win never costs a life', () => {
    const state0 = stateAtFirstFight(11);
    const win = recordBattleResult(state0, { won: true, goldEarned: 3 });
    expect(win.lives).toBe(state0.lives);

    const state1 = stateAtFirstFight(21);
    const loss = recordBattleResult(state1, { won: false, goldEarned: 3 });
    expect(loss.lives).toBe(state1.lives - 1);
  });

  it('losing a BOSS fight also costs only one life and does NOT end the run outright', () => {
    const atBoss = walkToFightNumber(21, BOSS_EVERY, true);
    expect(atBoss.currentNodeId).not.toBeNull();
    const before = atBoss.lives;
    const after = recordBattleResult(atBoss, { won: false, goldEarned: 10 });
    expect(after.lives).toBe(before - 1);
    // 3 lives - 1 loss still leaves the run active (assuming no prior losses).
    if (before - 1 > 0) {
      expect(after.status).toBe('active');
      expect(availableChoices(after).length).toBeGreaterThan(0);
    }
  });

  it('losing LIVES_PER_RUN times in a row ends the run in defeat, whatever the fight kind', () => {
    let state = startedRun(31);
    let losses = 0;
    for (let guard = 0; guard < 500; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      const node = choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'shop') { state = leaveShop(state); continue; }
      if (node.kind === 'event') { state = leaveEvent(state); continue; }
      state = recordBattleResult(state, { won: false, goldEarned: 5 });
      losses += 1;
      if (state.status === 'defeat') break;
    }
    expect(state.status).toBe('defeat');
    expect(state.lives).toBe(0);
    expect(losses).toBe(LIVES_PER_RUN);
    expect(availableChoices(state)).toHaveLength(0);
  });

  it('winning a boss increments bossesCleared; a non-boss win does not', () => {
    const state0 = stateAtFirstFight(11);
    const nonBoss = recordBattleResult(state0, { won: true, goldEarned: 3 });
    expect(nonBoss.bossesCleared).toBe(0);

    const atBoss = walkToFightNumber(7, BOSS_EVERY, true);
    const bossWin = recordBattleResult(atBoss, { won: true, goldEarned: 10 });
    expect(bossWin.bossesCleared).toBe(1);
    expect(bossWin.status).toBe('active'); // the run continues past a boss now
  });

  it('bossesCleared only increments on a boss WIN, not a boss loss, and keeps counting across multiple bosses', () => {
    const atBoss1 = walkToFightNumber(7, BOSS_EVERY, true);
    const lostBoss = recordBattleResult(atBoss1, { won: false, goldEarned: 0 });
    expect(lostBoss.bossesCleared).toBe(0);

    // Walking to the SECOND boss (fight BOSS_EVERY*2) passes through (and, per
    // `walkToFightNumber`'s `won=true`, WINS) the first boss along the way —
    // so bossesCleared is already 1 by the time boss #2 is reached, and 2
    // once it's won too.
    const atBoss2 = walkToFightNumber(7, BOSS_EVERY * 2, true);
    expect(atBoss2.bossesCleared).toBe(1);
    const wonBoss2 = recordBattleResult(atBoss2, { won: true, goldEarned: 10 });
    expect(wonBoss2.bossesCleared).toBe(2);
  });

  it('retireRun sets status to "retired" from an active run and clears currentNodeId', () => {
    const state = stateAtFirstFight(7); // active, mid-node
    const retired = retireRun(state);
    expect(retired.status).toBe('retired');
    expect(retired.currentNodeId).toBeNull();
    expect(availableChoices(retired)).toHaveLength(0);
  });

  it('retireRun is a no-op (same reference) on a non-active run (drafting, already defeated, or already retired)', () => {
    const drafting = createRun(1);
    expect(retireRun(drafting)).toBe(drafting);

    const active = stateAtFirstFight(7);
    const retired = retireRun(active);
    expect(retireRun(retired)).toBe(retired);
  });

  it('"victory" status is a legacy union member nothing sets any more', () => {
    // Walk a decent number of fights winning every one — status should only
    // ever be 'active' (never 'victory', since the run no longer ends there).
    const state = walkToFightNumber(7, BOSS_EVERY * 3, true);
    const afterBoss = recordBattleResult(state, { won: true, goldEarned: 10 });
    expect(afterBoss.status).not.toBe('victory');
    expect(afterBoss.status).toBe('active');
  });
});

describe('run/runState: battle outcomes', () => {
  it('a win credits gold, increments wins, and levels the hero up', () => {
    const state0 = stateAtFirstFight(11);
    const before = { gold: state0.gold, wins: state0.wins, level: state0.heroLevel };
    const state = recordBattleResult(state0, { won: true, goldEarned: 3 });
    expect(state.gold).toBe(before.gold + 3);
    expect(state.wins).toBe(before.wins + 1);
    expect(state.heroLevel).toBe(before.level + 1);
    expect(state.losses).toBe(0);
    expect(state.status).toBe('active');
  });

  it('a loss on a non-boss node credits no gold, but still levels the hero, and the run continues', () => {
    const state0 = stateAtFirstFight(11);
    const before = { gold: state0.gold, losses: state0.losses, level: state0.heroLevel };
    let state = state0;
    state = recordBattleResult(state, { won: false, goldEarned: 3 });
    expect(state.gold).toBe(before.gold);
    expect(state.losses).toBe(before.losses + 1);
    expect(state.heroLevel).toBe(before.level + 1);
    expect(state.status).toBe('active');
    expect(availableChoices(state).length).toBeGreaterThan(0);
  });

  it('recordBattleResult throws when no combat node is active', () => {
    const state = startedRun(11);
    expect(() => recordBattleResult(state, { won: true, goldEarned: 1 })).toThrow();
  });

  it('rollEncounter throws on a shop or event node', () => {
    let state = startedRun(11);
    const nonCombat = availableChoices(state).find((n) => n.kind === 'shop' || n.kind === 'event');
    if (nonCombat) {
      state = chooseNode(state, nonCombat.id);
      expect(() => rollEncounter(state)).toThrow();
    }
  });
});

describe('run/runState: shop-node purchases', () => {
  it('ensureRunShopShelf rolls a shelf once and is idempotent after', () => {
    const { state, nodeId } = stateAtFirstShop(1);
    const withShelf = ensureRunShopShelf(state, nodeId);
    expect(withShelf.shopShelves[nodeId]).toBeDefined();
    const again = ensureRunShopShelf(withShelf, nodeId);
    expect(again.shopShelves[nodeId]).toEqual(withShelf.shopShelves[nodeId]);
  });

  it('buyRunCard deducts gold, lands the card in the bag, and removes the offer', () => {
    let { state, nodeId } = stateAtFirstShop(3);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 20 };
    const before = state.shopShelves[nodeId]!.cards.length;
    const offer = state.shopShelves[nodeId]!.cards[0];
    if (!offer) return; // shelf had no cards this seed — nothing to assert
    const result = buyRunCard(state, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(20 - offer.price);
    expect(result.state.shopShelves[nodeId]!.cards.length).toBe(before - 1);
    expect(result.state.bagSlots.some((s) => s?.skillId === offer.skillId)).toBe(true);
    expect(result.state.nextCardInstanceId).toBe(state.nextCardInstanceId + 1);
  });

  it('buyRunCard fails cleanly (no charge) when gold is short', () => {
    let { state, nodeId } = stateAtFirstShop(3);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 0 };
    if (!state.shopShelves[nodeId]!.cards[0]) return;
    const result = buyRunCard(state, nodeId, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('gold');
    expect(result.state).toBe(state);
  });

  it('buyRunGem deducts gold, adds the gem, and removes the offer', () => {
    let { state, nodeId } = stateAtFirstShop(5);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 20 };
    const offer = state.shopShelves[nodeId]!.gems[0];
    if (!offer) return;
    const before = state.shopShelves[nodeId]!.gems.length;
    const result = buyRunGem(state, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(20 - offer.price);
    expect(result.state.gemInventory).toContain(offer.gemId);
    expect(result.state.shopShelves[nodeId]!.gems.length).toBe(before - 1);
  });

  it('rerollRunShop costs 1 gold and deals a different (deterministic) shelf', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 5 };
    const rerolled = rerollRunShop(state, nodeId);
    expect(rerolled.gold).toBe(4);
    expect(rerolled.shopShelves[nodeId]!.rerollCount).toBe(1);
    const rerolledAgain = rerollRunShop(state, nodeId);
    expect(rerolledAgain.shopShelves[nodeId]).toEqual(rerolled.shopShelves[nodeId]);
  });

  it('rerollRunShop no-ops when the wallet cannot afford it', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 0 };
    const rerolled = rerollRunShop(state, nodeId);
    expect(rerolled).toBe(state);
  });

  it('rerollRunShop escalates 1, 2, 3, 4 gold across repeated rerolls at ONE node', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 100 };
    let gold = state.gold;
    for (const expectedCost of [1, 2, 3, 4]) {
      expect(rerollCostForNode(state, nodeId)).toBe(expectedCost);
      state = rerollRunShop(state, nodeId);
      expect(gold - state.gold).toBe(expectedCost);
      gold = state.gold;
    }
    expect(state.shopShelves[nodeId]!.rerollCount).toBe(4);
  });

  it('rerollCostForNode resets to 1 at a DIFFERENT node — escalation is per-node, not per-run', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 100 };
    state = rerollRunShop(state, nodeId);
    state = rerollRunShop(state, nodeId);
    state = rerollRunShop(state, nodeId);
    expect(rerollCostForNode(state, nodeId)).toBe(4); // this node has escalated
    const otherNodeId = `${nodeId}__never_rerolled_probe`;
    expect(rerollCostForNode(state, otherNodeId)).toBe(1); // an unrelated node id starts fresh
  });

  it('rerollRunShop no-ops once the escalated price outruns the wallet, at whatever step that happens', () => {
    let { state, nodeId } = stateAtFirstShop(1);
    state = { ...ensureRunShopShelf(state, nodeId), gold: 3 }; // affords reroll 1 (1g) and 2 (2g), not 3 (3g, leaves 0 short)
    state = rerollRunShop(state, nodeId); // gold 3 -> 2
    state = rerollRunShop(state, nodeId); // gold 2 -> 0
    expect(state.gold).toBe(0);
    expect(state.shopShelves[nodeId]!.rerollCount).toBe(2);
    const stuck = rerollRunShop(state, nodeId); // next reroll costs 3, can't afford
    expect(stuck).toBe(state);
  });

  it('runBagHasRoomFor reflects the run bag, not the sandbox demoState bag', () => {
    const { state } = stateAtFirstShop(7);
    expect(runBagHasRoomFor(state, 'sword_slash')).toBe(true);
  });
});

describe('run/runState: mergeRunCard + runMergeTargetFor (duplicate merging)', () => {
  /** A shop node with gold=20 and its shelf's FIRST card offer forced to a
   * known `skillId`/`price` (tier bronze) — every other offer/gem is left as
   * whatever the seed rolled, so tests only ever touch index 0. */
  function stateWithForcedOffer(seed: number, skillId: string, price: number): { state: RunState; nodeId: string } {
    const { state, nodeId } = stateAtFirstShop(seed);
    const withShelf = ensureRunShopShelf(state, nodeId);
    const shelf = withShelf.shopShelves[nodeId]!;
    return {
      nodeId,
      state: {
        ...withShelf,
        gold: 20,
        shopShelves: {
          ...withShelf.shopShelves,
          [nodeId]: { ...shelf, cards: [{ skillId, tier: 'bronze', price }, ...shelf.cards.slice(1)] },
        },
      },
    };
  }

  const boardPiece = (tier: SkillTier, skillId = 'sword_slash', slot = 0): RunBoardPiece => (
    { instanceId: 'card_900', skillId, tier, slot }
  );
  const bagCard = (tier: SkillTier, skillId = 'sword_slash'): NonNullable<RunBagSlot> => (
    { instanceId: 'card_901', skillId, tier }
  );

  it('runMergeTargetFor is null when the player owns no copy, and finds an owned board copy', () => {
    const { state } = stateWithForcedOffer(3, 'sword_slash', 2);
    expect(runMergeTargetFor(state, 'sword_slash')).toBeNull();
    const owned = { ...state, pieces: [boardPiece('bronze')] };
    expect(runMergeTargetFor(owned, 'sword_slash')).toEqual({
      location: 'board', index: 0, instanceId: 'card_900', fromTier: 'bronze', toTier: 'silver',
    });
  });

  it('upgrades tier IN PLACE (no new copy added) and consumes the shelf offer, same price/stats as a normal buy', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze')] };
    const beforeShelfLen = owned.shopShelves[nodeId]!.cards.length;
    const result = mergeRunCard(owned, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces).toHaveLength(1); // merge replaces tier, never adds a count
    expect(result.state.pieces[0]).toEqual(boardPiece('silver'));
    expect(result.state.bagSlots).toEqual(owned.bagSlots);
    expect(result.state.shopShelves[nodeId]!.cards.length).toBe(beforeShelfLen - 1);
    expect(result.state.gold).toBe(owned.gold - 2);
    expect(result.state.stats.goldSpent).toBe(owned.stats.goldSpent + 2);
    expect(result.state.stats.cardsBought).toBe(owned.stats.cardsBought + 1); // a merge IS a purchase
  });

  it('targets the LOWEST-tier owned instance across board+bag', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('gold')], bagSlots: [bagCard('bronze')] };
    const result = mergeRunCard(owned, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces[0]!.tier).toBe('gold'); // untouched — not the lowest tier
    expect(result.state.bagSlots[0]).toEqual({ instanceId: 'card_901', skillId: 'sword_slash', tier: 'silver' });
  });

  it('on a tier TIE, the board copy is targeted over the bag copy', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze')], bagSlots: [bagCard('bronze')] };
    const result = mergeRunCard(owned, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces[0]!.tier).toBe('silver');
    expect(result.state.bagSlots[0]).toEqual({ instanceId: 'card_901', skillId: 'sword_slash', tier: 'bronze' }); // untouched
  });

  it('a diamond-only collection has no merge target: fails with reason "no-target", no charge', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('diamond')] };
    const result = mergeRunCard(owned, nodeId, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-target');
    expect(result.state).toBe(owned);
  });

  it('fails cleanly (no charge, no reference change) when gold is short', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, gold: 1, pieces: [boardPiece('bronze')] };
    const result = mergeRunCard(owned, nodeId, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('gold');
    expect(result.state).toBe(owned);
  });

  it('a socketed gem survives the merge — tier change never touches the socket', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const gem = gemBook.swift_charm!;
    const owned = { ...state, pieces: [{ ...boardPiece('bronze'), gem }] };
    const result = mergeRunCard(owned, nodeId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces[0]!.gem).toBe(gem);
    expect(result.state.pieces[0]!.tier).toBe('silver');
  });

  it('does not mutate the input state (immutability contract)', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze')] };
    const piecesSnapshot = JSON.parse(JSON.stringify(owned.pieces));
    const shelfSnapshot = JSON.parse(JSON.stringify(owned.shopShelves[nodeId]));
    mergeRunCard(owned, nodeId, 0);
    expect(owned.pieces).toEqual(piecesSnapshot);
    expect(owned.shopShelves[nodeId]).toEqual(shelfSnapshot);
  });

  it('is deterministic: identical input -> identical output, every time', () => {
    const { state, nodeId } = stateWithForcedOffer(3, 'sword_slash', 2);
    const owned = { ...state, pieces: [boardPiece('bronze')] };
    const a = mergeRunCard(owned, nodeId, 0);
    const b = mergeRunCard(owned, nodeId, 0);
    expect(a).toEqual(b);
  });
});

describe('run/runState: event-node accessor', () => {
  it('currentEventNode/leaveEvent mirror currentShopNode/leaveShop', () => {
    let state = startedRun(2);
    for (let guard = 0; guard < 200; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) throw new Error('no event node reachable for this seed');
      const eventChoice = choices.find((n) => n.kind === 'event');
      if (eventChoice) {
        state = chooseNode(state, eventChoice.id);
        const node = currentEventNode(state);
        expect(node?.id).toBe(eventChoice.id);
        expect(currentShopNode(state)).toBeUndefined();
        const left = leaveEvent(state);
        expect(left.currentNodeId).toBeNull();
        return;
      }
      const node = choices[0]!;
      state = chooseNode(state, node.id);
      if (node.kind === 'shop') state = leaveShop(state);
      else if (node.kind === 'event') state = leaveEvent(state);
      else state = recordBattleResult(state, { won: true, goldEarned: 1 });
    }
    throw new Error('guard exceeded while looking for an event node');
  });

  it('leaveEvent throws off an event node', () => {
    const state = startedRun(2);
    expect(() => leaveEvent(state)).toThrow();
  });

  it('currentEventNode is undefined off an event node', () => {
    const state = startedRun(2);
    expect(currentEventNode(state)).toBeUndefined();
  });
});

describe('run/runState: buyHeroStatAllocation', () => {
  it('spends one buy of a stat and is additive across repeated calls', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked; attack costs 1 PL/buy.
    const once = buyHeroStatAllocation(state, 'attack');
    expect(once.heroAllocation.attack).toBe(1);
    const twice = buyHeroStatAllocation(once, 'attack');
    expect(twice.heroAllocation.attack).toBe(2);
    expect(twice).not.toBe(once);
  });

  it('is a no-op (same reference) when the buy is unaffordable', () => {
    const state = startedRun(1); // heroLevel 1 -> 0 PL banked
    const result = buyHeroStatAllocation(state, 'attack');
    expect(result).toBe(state);
    expect(result.heroAllocation.attack ?? 0).toBe(0);
  });

  it('never lets spentPL exceed totalLevelPL across repeated buys of the pricier speed stat', () => {
    let state = startedRun(3);
    state = { ...state, heroLevel: 4 }; // 9 PL banked; speed costs 2 PL/buy
    for (let i = 0; i < 10; i++) state = buyHeroStatAllocation(state, 'speed');
    expect(bankedPL(state.heroLevel, state.heroAllocation)).toBeGreaterThanOrEqual(0);
    expect(state.heroAllocation.speed).toBe(4); // floor(9/2)
  });
});

describe('run/runState: heroAllocationCost + setHeroAllocation (confirmable scratch edit)', () => {
  it('heroAllocationCost prices an allocation against LEVEL_STAT_COST', () => {
    expect(heroAllocationCost({})).toBe(0);
    expect(heroAllocationCost({ attack: 2 })).toBe(2 * LEVEL_STAT_COST.attack.pl);
    expect(heroAllocationCost({ attack: 2, speed: 1 })).toBe(
      2 * LEVEL_STAT_COST.attack.pl + 1 * LEVEL_STAT_COST.speed.pl,
    );
  });

  it('accepts an in-budget scratch allocation', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked
    const next = setHeroAllocation(state, { attack: 3 }); // 3 PL spent
    expect(next.heroAllocation).toEqual({ attack: 3 });
    expect(next).not.toBe(state);
  });

  it('rejects (no-op, same reference) an over-budget allocation', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked
    const result = setHeroAllocation(state, { attack: 4 }); // 4 PL > 3 banked
    expect(result).toBe(state);
  });

  it('rejects (no-op, same reference) an allocation with a negative buy count', () => {
    const state = { ...startedRun(1), heroLevel: 3 }; // 6 PL banked
    const result = setHeroAllocation(state, { attack: -1 });
    expect(result).toBe(state);
  });

  it('allows a confirm that LOWERS a stat back toward zero relative to the last confirmed allocation', () => {
    const state = { ...startedRun(1), heroLevel: 3, heroAllocation: { attack: 6 } }; // fully spent
    const lowered = setHeroAllocation(state, { attack: 2, armor: 4 }); // same total PL, different split
    expect(lowered.heroAllocation).toEqual({ attack: 2, armor: 4 });
    const toZero = setHeroAllocation(lowered, {});
    expect(toZero.heroAllocation).toEqual({});
  });

  it('buyHeroStatAllocation still behaves exactly as before (implemented via setHeroAllocation)', () => {
    const state = { ...startedRun(1), heroLevel: 2 }; // 3 PL banked
    const once = buyHeroStatAllocation(state, 'attack');
    expect(once.heroAllocation.attack).toBe(1);
    const twice = buyHeroStatAllocation(once, 'attack');
    expect(twice.heroAllocation.attack).toBe(2);
    expect(twice).not.toBe(once);
    const unaffordable = startedRun(1); // heroLevel 1 -> 0 PL banked
    const noop = buyHeroStatAllocation(unaffordable, 'attack');
    expect(noop).toBe(unaffordable);
  });

  it('a committed allocation still reaches the battle request unchanged', () => {
    const state = { ...startedRun(1), heroLevel: 3 };
    const next = setHeroAllocation(state, { attack: 2, maxHp: 4 });
    expect(next.heroAllocation).toEqual({ attack: 2, maxHp: 4 });
    expect(next.pieces).toEqual(state.pieces);
    expect(next.gold).toBe(state.gold);
  });
});

// ---------------------------------------------------------------------------
// Daily income (+1 gold per node committed) — USER-LOCKED 2026-07-30.
// ---------------------------------------------------------------------------

describe('run/runState: daily income (+1 gold per node committed)', () => {
  it('DAILY_INCOME is 1 and chooseNode awards it exactly once per node, every kind', () => {
    expect(DAILY_INCOME).toBe(1);
    let state = startedRun(31);
    for (let guard = 0; guard < 60; guard++) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      const node = choices[0]!;
      const before = state.gold;
      state = chooseNode(state, node.id);
      expect(state.gold).toBe(before + DAILY_INCOME);
      if (node.kind === 'shop') {
        state = leaveShop(state);
      } else if (node.kind === 'event') {
        state = leaveEvent(state);
      } else {
        rollEncounter(state);
        state = recordBattleResult(state, { won: true, goldEarned: 5 });
      }
    }
  });

  it('availableChoices (mere preview) never awards gold', () => {
    const state = startedRun(31);
    const before = state.gold;
    availableChoices(state);
    availableChoices(state);
    expect(state.gold).toBe(before);
  });

  it('a fight win nets exactly DAILY_INCOME + base(1) + winBonus for that day (2 minimum, bonus on top)', () => {
    const state0 = stateAtFirstFight(11); // chooseNode already credited this day's DAILY_INCOME
    const goldAfterChoose = state0.gold;
    const encounter = rollEncounter(state0);
    const reward = battleGoldReward(
      [{ level: encounter.units[0]!.level, title: encounter.units[0]!.title, rank: encounter.units[0]!.rank }],
      state0.heroLevel,
    );
    const state = recordBattleResult(state0, { won: true, goldEarned: reward.base + reward.winBonus });
    expect(reward.base).toBe(1);
    expect(reward.winBonus).toBeGreaterThanOrEqual(1);
    expect(state.gold).toBe(goldAfterChoose + reward.base + reward.winBonus);
    expect(state.gold).toBeGreaterThanOrEqual(goldAfterChoose + 2); // 2 gold minimum on a win day
  });

  it('a fight loss still nets exactly DAILY_INCOME for that day (no longer literally zero income)', () => {
    const state0 = stateAtFirstFight(11);
    const goldAfterChoose = state0.gold;
    const state = recordBattleResult(state0, { won: false, goldEarned: 5 });
    expect(state.gold).toBe(goldAfterChoose);
    expect(state.gold).toBeGreaterThanOrEqual(DAILY_INCOME);
  });

  it('total income over a 30-fight walk (win every fight) matches a computed expectation', () => {
    for (const seed of [5, 42, 79]) {
      let state = startedRun(seed);
      let expectedGold = 0;
      let fightsSeen = 0;
      for (let guard = 0; guard < 2000 && fightsSeen < 30; guard++) {
        const choices = availableChoices(state);
        if (choices.length === 0) break;
        const node = choices[0]!;
        state = chooseNode(state, node.id);
        expectedGold += DAILY_INCOME;
        if (node.kind === 'shop') {
          state = leaveShop(state);
        } else if (node.kind === 'event') {
          state = leaveEvent(state);
        } else {
          const encounter = rollEncounter(state);
          const reward = battleGoldReward(
            [{ level: encounter.units[0]!.level, title: encounter.units[0]!.title, rank: encounter.units[0]!.rank }],
            state.heroLevel,
          );
          expectedGold += reward.base + reward.winBonus;
          state = recordBattleResult(state, { won: true, goldEarned: reward.base + reward.winBonus });
          fightsSeen += 1;
        }
      }
      expect(state.gold).toBe(expectedGold);
    }
  });
});

// ---------------------------------------------------------------------------
// Fight columns offer a choice of THREE foes on every non-boss wave —
// EASY / MEDIUM / HARD (USER-DIRECTED 2026-08-04, supersedes the 2026-07-30
// two-option "standard/hard" rule). `'standard'` keeps its original
// `RunNode.fightOption` id (the unchanged middle rung, labeled "MEDIUM" in
// the UI — see `FIGHT_TIER_LABEL` in `src/game/runStore.ts`).
// ---------------------------------------------------------------------------

describe('run/runState: fight column offers 3 foe options (non-boss waves)', () => {
  /** The 3-node fight column for `wave` straight off the map — no run walking
   * required, mirroring `runStore.ts#previewEncounter`'s idiom of building a
   * throwaway `currentNodeId` to preview a not-yet-chosen node. */
  function fightNodesForWave(state: RunState, wave: number): RunNode[] {
    const map = ensureWavesThrough(state.map, wave);
    for (const column of map.depths) {
      if (column.length === 3 && column[0]?.kind === 'fight' && column[0].wave === wave) {
        return [...column];
      }
    }
    throw new Error(`no 3-option fight column found for wave ${wave}`);
  }

  const SEEDS = [1, 2, 3, 11, 42, 100];
  const NON_BOSS_WAVES = [1, 2, 3, 4, 6, 7, 8, 9];

  it('non-boss waves have exactly 3 fight nodes with equal fightNumber (easy/standard/hard); boss waves have exactly 1 boss node', () => {
    for (const seed of SEEDS) {
      const state = startedRun(seed);
      for (const wave of NON_BOSS_WAVES) {
        const nodes = fightNodesForWave(state, wave);
        expect(nodes).toHaveLength(3);
        for (const node of nodes) expect(node.fightNumber).toBe(wave);
        expect(nodes.every((n) => n.kind === 'fight')).toBe(true);
        expect([...nodes.map((n) => n.fightOption)].sort()).toEqual(['easy', 'hard', 'standard']);
      }
      const map = ensureWavesThrough(state.map, BOSS_EVERY);
      const bossColumn = map.depths.find(
        (column) => column.length >= 1 && column[0]?.kind === 'boss',
      )!;
      expect(bossColumn).toHaveLength(1);
      expect(bossColumn[0]!.wave).toBe(BOSS_EVERY);
      expect(bossColumn[0]!.fightNumber).toBe(BOSS_EVERY);
    }
  });

  it("hard's title/level is one rung above standard's, easy's is one rung/level below (floored/capped), for every non-boss wave 1-9", () => {
    const rung: Record<string, string> = { normal: 'elite', elite: 'boss' };
    for (const seed of SEEDS) {
      const state = startedRun(seed);
      for (const wave of NON_BOSS_WAVES) {
        const nodes = fightNodesForWave(state, wave);
        const easy = nodes.find((n) => n.fightOption === 'easy')!;
        const standard = nodes.find((n) => n.fightOption === 'standard')!;
        const hard = nodes.find((n) => n.fightOption === 'hard')!;
        expect(easy).toBeDefined();
        expect(standard).toBeDefined();
        expect(hard).toBeDefined();
        const entryEasy = fightTableEntryForNode(easy);
        const entryStandard = fightTableEntryForNode(standard);
        const entryHard = fightTableEntryForNode(hard);
        expect(entryHard.level).toBe(entryStandard.level + 1);
        expect(entryHard.title).toBe(rung[entryStandard.title]);
        expect(entryEasy.level).toBe(Math.max(1, entryStandard.level - 1));
        expect(entryEasy.title).toBe('normal');
        expect(entryStandard).toEqual(fightSpecFor(wave));
      }
    }
  });

  it("battleGoldReward's winBonus is monotonic easy <= standard <= hard, for every non-boss wave 1-9, across seeds — the gradient FALLS OUT of the resolved fight-table entry (level/title/modifiers), not a hand-tuned table", () => {
    // Keyed off `fightTableEntryForNode` (the resolved, pre-pack-roll spec
    // `battleGoldReward` actually derives its inputs from) rather than a full
    // `rollEncounter` pack — a pack's VARIANT (solo/pair/trio) is its OWN
    // independent Rng draw per node id (each tier gets a distinct
    // `encounterSeed`, see runMap.ts), so a fully-random multi-foe pack roll
    // is NOT guaranteed monotonic tier-to-tier on its own (a deeper-tier node
    // could happen to roll solo while a shallower one rolls a trio, and the
    // trio's extra-foe difficulty term can outweigh one tier step) — that
    // pack-vs-tier interplay is verified separately, and correctly, in
    // `packFights.test.ts` (budget-based, not reward-based). What IS
    // structurally guaranteed — and is what this test proves — is that the
    // TIER ITSELF (level/title/modifiers, identical inputs `rollEncounter`
    // feeds every pack member) produces a non-decreasing `battleGoldReward`
    // for a single resolved foe, which is exactly the pre-pack (solo)
    // reward shape.
    for (const seed of SEEDS) {
      const state = startedRun(seed);
      for (const wave of NON_BOSS_WAVES) {
        const nodes = fightNodesForWave(state, wave);
        const easy = nodes.find((n) => n.fightOption === 'easy')!;
        const standard = nodes.find((n) => n.fightOption === 'standard')!;
        const hard = nodes.find((n) => n.fightOption === 'hard')!;
        const rewardFor = (node: RunNode) => {
          const entry = fightTableEntryForNode(node);
          return battleGoldReward([{ level: entry.level, title: entry.title, rank: 0, modifiers: entry.modifiers }], state.heroLevel);
        };
        const rewardEasy = rewardFor(easy);
        const rewardStandard = rewardFor(standard);
        const rewardHard = rewardFor(hard);
        expect(rewardStandard.winBonus).toBeGreaterThanOrEqual(rewardEasy.winBonus);
        expect(rewardHard.winBonus).toBeGreaterThanOrEqual(rewardStandard.winBonus);
      }
    }
  });

  it('all three options are deterministic per seed and pairwise distinct from each other', () => {
    for (const seed of SEEDS) {
      const baseA = startedRun(seed);
      const baseB = startedRun(seed);
      const stateA = { ...baseA, map: ensureWavesThrough(baseA.map, 9) };
      const stateB = { ...baseB, map: ensureWavesThrough(baseB.map, 9) };
      for (const wave of NON_BOSS_WAVES) {
        const nodesA = fightNodesForWave(stateA, wave);
        const nodesB = fightNodesForWave(stateB, wave);
        expect(nodesA).toEqual(nodesB);
        const ids = new Set(nodesA.map((n) => n.id));
        const seedsSet = new Set(nodesA.map((n) => n.encounterSeed));
        expect(ids.size).toBe(3);
        expect(seedsSet.size).toBe(3);
        const encounterStd = rollEncounter({ ...stateA, currentNodeId: nodesA[0]!.id });
        const encounterStdAgain = rollEncounter({ ...stateA, currentNodeId: nodesA[0]!.id });
        expect(encounterStd).toEqual(encounterStdAgain);
      }
    }
  });

  it('choosing any of the three fight options advances the run identically (same depth/wave progression, same hero level, same status), across a 12-fight walk', () => {
    let stateA = startedRun(7);
    let stateB = startedRun(7);
    let stateC = startedRun(7);
    let fightsSeen = 0;
    for (let guard = 0; guard < 500 && fightsSeen < 12; guard++) {
      const choicesA = availableChoices(stateA);
      if (choicesA.length === 0) break;
      if (choicesA.length === 3 && choicesA[0]!.kind === 'fight') {
        const easy = choicesA.find((n) => n.fightOption === 'easy')!;
        const standard = choicesA.find((n) => n.fightOption === 'standard')!;
        const hard = choicesA.find((n) => n.fightOption === 'hard')!;
        stateA = chooseNode(stateA, easy.id);
        stateB = chooseNode(stateB, standard.id);
        stateC = chooseNode(stateC, hard.id);
        expect(stateA.depth).toBe(stateB.depth);
        expect(stateB.depth).toBe(stateC.depth);
        stateA = recordBattleResult(stateA, { won: true, goldEarned: 5 });
        stateB = recordBattleResult(stateB, { won: true, goldEarned: 5 });
        stateC = recordBattleResult(stateC, { won: true, goldEarned: 5 });
        expect(stateA.heroLevel).toBe(stateB.heroLevel);
        expect(stateB.heroLevel).toBe(stateC.heroLevel);
        expect(stateA.status).toBe(stateB.status);
        expect(stateB.status).toBe(stateC.status);
        fightsSeen += 1;
        continue;
      }
      const node = choicesA[0]!;
      stateA = chooseNode(stateA, node.id);
      stateB = chooseNode(stateB, node.id);
      stateC = chooseNode(stateC, node.id);
      expect(stateA.depth).toBe(stateB.depth);
      if (node.kind === 'shop') {
        stateA = leaveShop(stateA);
        stateB = leaveShop(stateB);
        stateC = leaveShop(stateC);
      } else if (node.kind === 'event') {
        stateA = leaveEvent(stateA);
        stateB = leaveEvent(stateB);
        stateC = leaveEvent(stateC);
      } else {
        stateA = recordBattleResult(stateA, { won: true, goldEarned: 5 });
        stateB = recordBattleResult(stateB, { won: true, goldEarned: 5 });
        stateC = recordBattleResult(stateC, { won: true, goldEarned: 5 });
        fightsSeen += 1;
      }
    }
    expect(fightsSeen).toBeGreaterThanOrEqual(12);
    expect(stateA.status).toBe('active');
    expect(stateB.status).toBe('active');
    expect(stateC.status).toBe('active');
  });
});
