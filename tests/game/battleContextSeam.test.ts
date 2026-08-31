import { afterAll, describe, expect, it } from 'vitest';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';
import {
  applyRunDraft, choices, clearRun, currentEncounter, currentNode, getActiveRun,
  leaveCurrentEvent, leaveCurrentShop, pickCurrentStartDraftCard, pickNode, previewEncounter,
  resolveRunBattleResult, startRun,
} from '../../src/game/runStore';
import { getBattleTimelineInput, setBattleContext } from '../../src/game/battleContext';
import type { BattleTimelineInput } from '../../src/game/battleTimeline';
import type { EncounterPack } from '../../src/run/encounter';
import type { BattleLog } from '../../src/run/resolveBattle';
import type { RunNode } from '../../src/run/runState';

/**
 * HOP 1 — `battleContext.runBattleInput`, the seam with no tests.
 *
 * A run's fight is assembled by four hops: `rollEncounter` -> this module ->
 * `battleRequestOf` -> `resolveBattle`. Three of them are pinned; mutate any of
 * them and the suite goes red. This one was open, and an auditor proved it by
 * deleting five separate fields out of `runBattleInput` one at a time — `affix`,
 * `enemyModifiers`, the team's `modifiers`, the team's `rank`, `heroAllocation` —
 * with the whole suite staying green every single time.
 *
 * That is not hypothetical: `EncounterUnit.affix` died at exactly this seam and
 * stayed dead for days, so an elite the prep screen previewed as BRACED was
 * fought as a plain elite. Every test in the repo passed the entire time,
 * because they all asserted that the RUN LAYER PRODUCES the field — which it
 * always did.
 *
 * So these are positioned the only way that catches it: against the run state
 * the input claims to describe, on a real store walked to a real node, with the
 * KEY SET itself pinned so a field that is silently dropped cannot be silently
 * dropped.
 */

const WIN: BattleLog = { result: 'win', turns: 1, events: [] };

/** Every field `runBattleInput` is contracted to carry. Delete one at the seam
 * and this list is what notices. */
const INPUT_KEYS = [
  'pieces', 'heroLevel', 'heroAllocation', 'enemyId', 'enemyLevel', 'enemyTitle',
  'enemyRank', 'enemyModifiers', 'enemyAffix', 'enemyTeam', 'seed',
].sort();
const TEAM_KEYS = ['enemyId', 'level', 'title', 'rank', 'modifiers', 'affix'].sort();

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

/** The path the draft SCREENS take now that the reroll count and the picks are
 * run state (`RunState.draft`): record each set's pick through the store, then
 * START. Installs exactly the cards `draftPicksFor` names. */
function draftRunThroughStore(seed: number): void {
  const picks = draftPicksFor(seed);
  for (const key of DRAFT_SET_KEYS) pickCurrentStartDraftCard(key, picks[key]!);
  applyRunDraft();
}

/**
 * Walks the STORE — start, draft, then node by node — until a combat node whose
 * encounter satisfies `want` is on offer, and commits to it. Combat is settled
 * with a synthetic win log rather than simulated: this test is about which DIALS
 * reach the battle input, not about who would have won.
 */
function storeOnCombatNode(want: (pack: EncounterPack) => boolean, seed = 1, maxSteps = 200): EncounterPack {
  clearRun();
  startRun(seed);
  draftRunThroughStore(seed);
  for (let step = 0; step < maxSteps; step += 1) {
    const opts = choices();
    if (opts.length === 0) break;
    const target = opts.find((n) => {
      const pack = previewEncounter(n);
      return pack !== null && want(pack);
    });
    if (target) {
      pickNode(target.id);
      return currentEncounter()!;
    }
    const next: RunNode = opts.find((n) => n.kind === 'fight' || n.kind === 'boss') ?? opts[0]!;
    pickNode(next.id);
    const node = currentNode();
    if (!node) break;
    if (node.kind === 'fight' || node.kind === 'boss') resolveRunBattleResult({} as BattleTimelineInput, WIN);
    else if (node.kind === 'shop') leaveCurrentShop();
    else if (node.kind === 'event') leaveCurrentEvent();
    const run = getActiveRun();
    if (!run || run.status !== 'active') break;
  }
  throw new Error('no combat node matching the predicate was reachable');
}

/** An ELITE carrying an affix AND deep-run modifiers AND a non-zero rank — the
 * one encounter shape that makes every dial below a distinguishing value rather
 * than a default that a dropped field could accidentally match. */
const LOADED = (pack: EncounterPack): boolean =>
  pack.units.some((u) => u.affix !== null && u.affix !== undefined)
  && pack.units.some((u) => u.modifiers.length > 0)
  && pack.units.some((u) => u.rank > 0);

afterAll(() => { clearRun(); setBattleContext('demo'); });

describe('game/battleContext — the run -> battle-input seam', () => {
  it('carries EVERY dial of a loaded elite encounter onto the battle input', () => {
    const pack = storeOnCombatNode(LOADED);
    const run = getActiveRun()!;
    const node = currentNode()!;
    const primary = pack.units[0]!;

    // The fixture has to be loaded, or a dropped field could pass by matching a default.
    expect(primary.affix).toBeTruthy();
    expect(primary.modifiers.length).toBeGreaterThan(0);
    expect(primary.rank).toBeGreaterThan(0);

    setBattleContext('run');
    const input = getBattleTimelineInput();

    // THE KEY SET. Deleting any field at the seam lands here first.
    expect(Object.keys(input).sort()).toEqual(INPUT_KEYS);

    expect(input.pieces).toEqual(run.pieces);
    expect(input.heroLevel).toBe(run.heroLevel);
    expect(input.heroAllocation).toEqual(run.heroAllocation);
    expect(input.seed).toBe(node.encounterSeed);

    expect(input.enemyId).toBe(primary.enemyId);
    expect(input.enemyLevel).toBe(primary.level);
    expect(input.enemyTitle).toBe(primary.title);
    expect(input.enemyRank).toBe(primary.rank);
    expect(input.enemyModifiers).toEqual(primary.modifiers);
    // The field that actually died here.
    expect(input.enemyAffix).toBe(primary.affix);

    const team = input.enemyTeam!;
    expect(team).toHaveLength(pack.units.length);
    for (let i = 0; i < pack.units.length; i += 1) {
      const u = pack.units[i]!;
      const t = team[i]!;
      expect(Object.keys(t).sort()).toEqual(TEAM_KEYS);
      expect(t.enemyId).toBe(u.enemyId);
      expect(t.level).toBe(u.level);
      expect(t.title).toBe(u.title);
      expect(t.rank).toBe(u.rank);
      expect(t.modifiers).toEqual(u.modifiers);
      expect(t.affix).toBe(u.affix);
    }
  });

  it('carries every unit of a PACK fight, in order, not just the primary', () => {
    const pack = storeOnCombatNode((p) => p.units.length > 1);
    expect(pack.units.length).toBeGreaterThan(1);

    setBattleContext('run');
    const input = getBattleTimelineInput();
    expect(Object.keys(input).sort()).toEqual(INPUT_KEYS);

    const team = input.enemyTeam!;
    expect(team.map((t) => t.enemyId)).toEqual(pack.units.map((u) => u.enemyId));
    expect(team.map((t) => t.rank)).toEqual(pack.units.map((u) => u.rank));
    expect(team.map((t) => t.modifiers)).toEqual(pack.units.map((u) => u.modifiers));
    expect(team.map((t) => t.affix)).toEqual(pack.units.map((u) => u.affix));
    // The singular fields stay unit 0's view for the 1v1 renderers.
    expect(input.enemyId).toBe(pack.units[0]!.enemyId);
  });

  it("the team's modifiers are a COPY, so mutating the input cannot reach the run", () => {
    const pack = storeOnCombatNode(LOADED);
    setBattleContext('run');
    const input = getBattleTimelineInput();
    const before = [...pack.units[0]!.modifiers];
    (input.enemyTeam![0]!.modifiers as string[]).push('tampered');
    expect(currentEncounter()!.units[0]!.modifiers).toEqual(before);
  });

  it('falls back to the sandbox input when the run context has no combat node', () => {
    clearRun();
    setBattleContext('run');
    const input = getBattleTimelineInput();
    expect(getActiveRun()).toBeNull();
    expect(input.pieces).toBeDefined();
    expect(input.enemyId).toBeTruthy();
  });
});
