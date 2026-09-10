import { afterAll, describe, expect, it } from 'vitest';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';
import {
  applyRunDraft, choices, clearRun, currentEncounter, currentNode, getActiveRun,
  leaveCurrentEvent, leaveCurrentShop, pickCurrentStartDraftCard, pickNode, previewEncounter,
  resolveRunBattleResult, startRun,
} from '../../src/game/runStore';
import { getBattleTimelineInput, setBattleContext } from '../../src/game/battleContext';
import { battleRequestOf } from '../../src/game/battleApi';
import { buildBattleTimeline } from '../../src/game/battleTimeline';
import type { BattleTimelineInput } from '../../src/game/battleTimeline';
import type { EncounterPack } from '../../src/run/encounter';
import { buildAutoHeroSetup, buildEnemyEncounter } from '../../src/run/encounter';
import { resolveBattle, type BattleLog } from '../../src/run/resolveBattle';
import type { RunNode } from '../../src/run/runState';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { onRequestPost } from '../../functions/battle';

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
  'enemyRank', 'enemyGrowthLevel', 'enemyFightNumber', 'enemyModifiers', 'enemyAffix', 'enemyTeam', 'seed',
].sort();
const TEAM_KEYS = ['enemyId', 'level', 'growthLevel', 'fightNumber', 'title', 'rank', 'modifiers', 'affix'].sort();

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

it('a real normal level-6 node sends base rank zero and applies growth only once', () => {
  const pack = storeOnCombatNode((p) => p.units.length === 1 && p.units[0]!.title === 'normal' && p.units[0]!.level === 6);
  const unit = pack.units[0]!;
  expect(unit.baseRank).toBe(0);
  expect(unit.rank).toBe(3);
  setBattleContext('run');
  const input = getBattleTimelineInput();
  expect(input.enemyRank).toBe(0);
  expect(input.enemyGrowthLevel).toBe(6);
  const foe = input.enemyTeam![0]!;
  expect(foe.rank).toBe(0);
  expect(foe.growthLevel).toBe(6);
  const rebuilt = buildEnemyEncounter(foe.enemyId, foe.level, foe.title, foe.rank, foe.modifiers, foe.affix, undefined, null, foe.growthLevel);
  expect(rebuilt.setup).toEqual(unit.setup);
});

describe('game/battleContext — the run -> battle-input seam', () => {
  it('keeps the seed-1 first boss title ramp identical through prep, request, service, and playback', () => {
    const pack = storeOnCombatNode((p) => p.units.length === 1
      && p.units[0]!.title === 'boss'
      && p.units[0]!.enemyId === 'bramble_matriarch'
      && p.units[0]!.effectiveLevel === 6);
    const run = getActiveRun()!;
    const node = currentNode()!;
    const primary = pack.units[0]!;
    expect(node.id).toBe('d19-0');
    expect(node.fightNumber).toBe(5);
    expect(primary.enemyId).toBe('bramble_matriarch');
    expect(primary.effectiveLevel).toBe(6);
    expect(primary.setup.pieces).toHaveLength(3);

    setBattleContext('run');
    const input = getBattleTimelineInput();
    expect(input.enemyFightNumber).toBe(5);
    expect(input.enemyTeam![0]!.fightNumber).toBe(5);
    expect(input.enemyRank).toBe(primary.baseRank);
    expect(input.enemyGrowthLevel).toBe(primary.growthLevel);

    const request = battleRequestOf(input);
    expect(request.foes[0]!.fightNumber).toBe(5);
    expect(request.foes[0]!.rank).toBe(primary.baseRank);
    expect(request.foes[0]!.growthLevel).toBe(primary.growthLevel);

    const served = resolveBattle(request);
    const hero = buildAutoHeroSetup(run.heroLevel, run.pieces.map((p) => ({ ...p })), run.heroAllocation).setup;
    const expected = simulate({ playerTeam: [hero], enemyTeam: [primary.setup], skillBook }, request.seed);
    expect(served.events).toEqual(expected.events);

    const model = buildBattleTimeline(input, served);
    expect(model.foes[0]!.maxHp).toBe(primary.setup.stats.maxHp);
    expect(model.foes[0]!.pieces.map((p) => [p.skill.id, p.slot, p.tier ?? 'bronze']))
      .toEqual(primary.setup.pieces.map((p) => [p.skillId, p.slot, p.tier ?? 'bronze']));
  });

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
    expect(input.enemyRank).toBe(primary.baseRank);
    expect(input.enemyGrowthLevel).toBe(primary.growthLevel);
    expect(input.enemyFightNumber).toBe(node.fightNumber);
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
      expect(t.rank).toBe(u.baseRank);
      expect(t.growthLevel).toBe(u.growthLevel);
      expect(t.fightNumber).toBe(node.fightNumber);
      expect(t.modifiers).toEqual(u.modifiers);
      expect(t.affix).toBe(u.affix);
    }
  });

  it('carries every grown PACK member identically through request, production service, and playback', async () => {
    const pack = storeOnCombatNode((p) => p.units.length > 1 && p.units[0]!.effectiveLevel >= 4, 1, 500);
    expect(pack.units.length).toBeGreaterThan(1);

    setBattleContext('run');
    const input = getBattleTimelineInput();
    expect(Object.keys(input).sort()).toEqual(INPUT_KEYS);

    const team = input.enemyTeam!;
    expect(team.map((t) => t.enemyId)).toEqual(pack.units.map((u) => u.enemyId));
    expect(team.map((t) => t.rank)).toEqual(pack.units.map((u) => u.baseRank));
    for (const unit of pack.units) expect(unit.growthLevel).toBe(Math.max(1, unit.effectiveLevel));
    for (const member of team) {
      expect(Object.keys(member).sort()).toEqual(TEAM_KEYS);
      expect(member.growthLevel).toBe(Math.max(1, pack.units[0]!.effectiveLevel));
    }
    expect(team.map((t) => t.modifiers)).toEqual(pack.units.map((u) => u.modifiers));
    expect(team.map((t) => t.affix)).toEqual(pack.units.map((u) => u.affix));
    // The singular fields stay unit 0's view for the 1v1 renderers.
    expect(input.enemyId).toBe(pack.units[0]!.enemyId);
    const request = JSON.parse(JSON.stringify(battleRequestOf(input)));
    const rebuilt = request.foes.map((foe: typeof request.foes[number]) => buildEnemyEncounter(
      foe.enemyId, foe.level, foe.title, foe.rank, foe.modifiers, foe.affix,
      foe.fightNumber, foe.deck, foe.growthLevel,
    ).setup);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(pack.units.map((u) => u.setup)));
    const served = resolveBattle(request);
    const response = await onRequestPost({ request: new Request('http://world1.test/battle', {
      method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
    }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(served);
    const hero = buildAutoHeroSetup(input.heroLevel, input.pieces, input.heroAllocation).setup;
    expect(served.events).toEqual(simulate({ playerTeam: [hero], enemyTeam: pack.units.map((u) => u.setup), skillBook }, input.seed).events);
    const timeline = buildBattleTimeline(input, served);
    for (let i = 0; i < pack.units.length; i += 1) {
      const setup = pack.units[i]!.setup;
      expect(timeline.foes[i]!.maxHp).toBe(setup.stats.maxHp);
      expect(timeline.foes[i]!.pieces.map((p) => [p.skill.id, p.slot, p.tier ?? 'bronze']))
        .toEqual(setup.pieces.map((p) => [p.skillId, p.slot, p.tier ?? 'bronze']));
    }
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
