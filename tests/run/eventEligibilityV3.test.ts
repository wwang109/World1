import { describe, expect, it } from 'vitest';
import { biomeIds } from '../../src/data/biomes';
import type { EventBindingSpecV3, EventRequirementV3 } from '../../src/data/eventContentV3';
import { gemBook } from '../../src/data/gems';
import { skillBook } from '../../src/data/skills';
import type { EventInstanceRecord } from '../../src/run/eventInstances';
import { sameEventInstance } from '../../src/run/eventInstances';
import {
  bindEventV3,
  eventRequirementMetV3,
  monoTypeBinding,
} from '../../src/run/eventEligibilityV3';
import type { CombatFactLedgerEntry } from '../../src/run/eventV3Facts';
import { createRun, type RunNode, type RunState } from '../../src/run/runState';

const NODE: RunNode = {
  id: 'event-node', depth: 8, wave: 4, kind: 'event', eventSeed: 99,
  eventTheme: 'omen', biomeId: 'arrowfell',
};

function activeRun(overrides: Partial<RunState> = {}): RunState {
  return { ...createRun(404), status: 'active', ...overrides };
}

function met(state: RunState, requirement: EventRequirementV3, node: RunNode = NODE): boolean {
  return eventRequirementMetV3({ state, node }, requirement);
}

function committedRun(
  instanceId: string,
  node: RunNode = NODE,
  overrides: Partial<RunState> = {},
): RunState {
  const state = activeRun(overrides);
  return {
    ...state,
    eventInstances: {
      ...state.eventInstances,
      [node.id]: {
        eventId: 'v3_test_event', contentVersion: 3, instanceId, drawnDepth: node.depth,
      },
    },
  };
}

function combatFact(overrides: Partial<CombatFactLedgerEntry> = {}): CombatFactLedgerEntry {
  return {
    battleId: 'battle:base', nodeId: 'fight-node', depth: 5, biomeId: 'arrowfell',
    enemyIds: ['bandit_duelist'], result: 'win', boss: false, turns: 6,
    affinityId: 'sword', usedCardIds: ['sword_slash'], statusKinds: [], actionKinds: [],
    ...overrides,
  };
}

describe('run/eventEligibilityV3: pure closed requirement evaluation', () => {
  it('recurses through all, any, and not while applying exact numeric comparisons', () => {
    const base = activeRun({
      gold: 12, lives: 2, wins: 7, losses: 3, bossesCleared: 1,
      stats: {
        ...createRun(404).stats,
        goldSpent: 9, cardsBought: 4, gemsBought: 2, livesLost: 1,
      },
    });
    const facts: Array<[EventRequirementV3, boolean]> = [
      [{ fact: 'wallet.current', args: { op: 'eq', value: 12 } }, true],
      [{ fact: 'lives.current', args: { op: 'lte', value: 2 } }, true],
      [{ fact: 'node.depth', args: { op: 'gte', value: 8 } }, true],
      [{ fact: 'node.wave', args: { op: 'eq', value: 4 } }, true],
      [{ fact: 'run.tally', args: { stat: 'wins', op: 'eq', value: 7 } }, true],
      [{ fact: 'run.tally', args: { stat: 'losses', op: 'eq', value: 3 } }, true],
      [{ fact: 'run.tally', args: { stat: 'bossesCleared', op: 'eq', value: 1 } }, true],
      [{ fact: 'run.tally', args: { stat: 'goldSpent', op: 'eq', value: 9 } }, true],
      [{ fact: 'run.tally', args: { stat: 'cardsBought', op: 'gte', value: 4 } }, true],
      [{ fact: 'run.tally', args: { stat: 'gemsBought', op: 'lte', value: 2 } }, true],
      [{ fact: 'run.tally', args: { stat: 'livesLost', op: 'eq', value: 1 } }, true],
      [{ fact: 'wallet.current', args: { op: 'eq', value: 11 } }, false],
    ];
    for (const [requirement, expected] of facts) expect(met(base, requirement)).toBe(expected);

    expect(met(base, {
      all: [
        { any: [
          { fact: 'wallet.current', args: { op: 'eq', value: 0 } },
          { fact: 'wallet.current', args: { op: 'gte', value: 12 } },
        ] },
        { not: { fact: 'lives.current', args: { op: 'lte', value: 1 } } },
      ],
    })).toBe(true);
  });

  it('reads choices, story flags, chains, journeys, biome, and callbacks only from their authorities', () => {
    const base = activeRun({
      eventResolutions: {
        old: {
          eventId: 'the_old_oath', contentVersion: 3, instanceId: 'event:old',
          choiceId: 'show_mercy',
        },
      },
      completedStoryIds: ['chain:a', 'chain:a', 'chain:b'],
      journeyFactLedger: { visitedBiomeIds: ['arrowfell', 'arrowfell', 'swornhold'] },
      storyStateV3: {
        ...createRun(404).storyStateV3, oath_mercy: true, grave_path: 'answered',
      },
      eventCallbackQueue: [{
        callbackInstanceId: 'callback-instance:1', callbackId: 'oath_returns',
        eventId: 'callback_event', contentVersion: 3, scheduledDepth: 4,
        earliestDepth: 6, minDepthDelay: 2, destinationThemes: ['omen'],
        priority: 5, boundSubjects: {},
      }],
    });

    const cases: Array<[EventRequirementV3, boolean]> = [
      [{ fact: 'event.choice', args: { eventId: 'the_old_oath' } }, true],
      [{ fact: 'event.choice', args: { eventId: 'the_old_oath', choiceIds: ['leave', 'show_mercy'] } }, true],
      [{ fact: 'event.choice', args: { eventId: 'the_old_oath', choiceIds: ['leave'] } }, false],
      [{ fact: 'story.flag', args: { key: 'oath_mercy', op: 'eq', value: true } }, true],
      [{ fact: 'story.flag', args: { key: 'oath_mercy', op: 'neq', value: true } }, false],
      [{ fact: 'story.flag', args: { key: 'grave_path', op: 'eq', value: 'answered' } }, true],
      [{ fact: 'story.flag', args: { key: 'grave_path', op: 'neq', value: 'opened' } }, true],
      [{ fact: 'story.flag', args: { key: 'grave_path', op: 'in', value: ['opened', 'answered'] } }, true],
      [{ fact: 'chain.completed', args: { storyId: 'chain:b' } }, true],
      [{ fact: 'journey.visitedBiomes', args: { op: 'gte', value: 2 } }, true],
      [{ fact: 'journey.completedChains', args: { op: 'gte', value: 2 } }, true],
      [{ fact: 'biome.current', args: { ids: ['arrowfell'] } }, true],
      [{ fact: 'callback.queued', args: { callbackId: 'oath_returns' } }, true],
      [{ fact: 'callback.queued', args: { callbackId: 'not_queued' } }, false],
    ];
    for (const [requirement, expected] of cases) expect(met(base, requirement)).toBe(expected);
  });

  it('matches owned cards on one physical instance, selected locations, catalog fields, and tier floor', () => {
    const base = activeRun({
      pieces: [{ instanceId: 'card:sword', skillId: 'sword_slash', tier: 'gold', slot: 0 }],
      bagSlots: [
        { instanceId: 'card:sword', skillId: 'sword_slash', tier: 'gold' },
        { instanceId: 'card:fire', skillId: 'cinder_dart', tier: 'silver' },
        null,
      ],
      held: { instanceId: 'card:held', skillId: 'armor_break', tier: 'bronze' },
      shopShelves: {
        offer: {
          cards: [{ skillId: 'sword_slash', tier: 'diamond', price: 1 }],
          gems: [], rerollCount: 0,
        },
      },
    });

    expect(met(base, { fact: 'owned.card.count', args: {
      where: 'any', count: 1, tierAtLeast: 'gold',
      match: { cardIds: ['sword_slash'], weapons: ['sword'], archetypes: ['offense'] },
    } })).toBe(true);
    expect(met(base, { fact: 'owned.card.count', args: {
      where: 'any', count: 2, match: { cardIds: ['sword_slash'] },
    } })).toBe(false);
    expect(met(base, { fact: 'owned.card.count', args: {
      where: 'bag', count: 1, match: { elements: ['fire'] },
    } })).toBe(true);
    expect(met(base, { fact: 'owned.card.count', args: {
      where: 'held', count: 1, match: { weapons: ['axe'], archetypes: ['debuff'] },
    } })).toBe(true);
    expect(met(base, { fact: 'owned.card.count', args: {
      where: 'any', count: 1, match: { cardIds: ['sword_slash'], elements: ['fire'] },
    } })).toBe(false);

    const offersOnly = activeRun({ pieces: [], bagSlots: [], held: null, shopShelves: base.shopShelves });
    expect(met(offersOnly, { fact: 'owned.card.count', args: {
      where: 'any', count: 1, match: { cardIds: ['sword_slash'] },
    } })).toBe(false);
  });

  it('counts physical pouch entries and sockets while applying same-gem action and hero-stat filters', () => {
    const base = activeRun({
      gemInventory: ['armor_break_echo', 'armor_break_echo', 'archmages_core'],
      pieces: [{
        instanceId: 'card:socket', skillId: 'sword_slash', tier: 'bronze', slot: 0,
        gem: gemBook.brawlers_core!,
      }],
      shopShelves: {
        offer: { cards: [], gems: [{ gemId: 'armor_break_echo', price: 1 }], rerollCount: 0 },
      },
    });

    expect(met(base, { fact: 'owned.gem.count', args: {
      where: 'pouch', count: 2,
      match: { gemIds: ['armor_break_echo'], actionKinds: ['debuffStat'] },
    } })).toBe(true);
    expect(met(base, { fact: 'owned.gem.count', args: {
      where: 'pouch', count: 1,
      match: { gemIds: ['archmages_core'], heroStats: ['magicPower'] },
    } })).toBe(true);
    expect(met(base, { fact: 'owned.gem.count', args: {
      where: 'socketed', count: 1, match: { heroStats: ['attack'] },
    } })).toBe(true);
    expect(met(base, { fact: 'owned.gem.count', args: {
      where: 'any', count: 4, match: {},
    } })).toBe(true);
    expect(met(base, { fact: 'owned.gem.count', args: {
      where: 'any', count: 1,
      match: { gemIds: ['armor_break_echo'], heroStats: ['magicPower'] },
    } })).toBe(false);

    const offerOnly = activeRun({ gemInventory: [], pieces: [], shopShelves: base.shopShelves });
    expect(met(offerOnly, { fact: 'owned.gem.count', args: {
      where: 'any', count: 1, match: { gemIds: ['armor_break_echo'] },
    } })).toBe(false);
  });

  it('reads every combat leaf from persisted winning and losing facts only', () => {
    const base = activeRun({
      combatFactLedger: [
        combatFact({
          battleId: 'battle:boss', depth: 5,
          enemyIds: ['bandit_duelist', 'unknown_historical_enemy', 'bandit_duelist'],
          boss: true, turns: 4, affinityId: 'fire', statusKinds: ['burn'],
          actionKinds: ['damage', 'burn'],
        }),
        combatFact({
          battleId: 'battle:win', depth: 6, biomeId: 'swornhold',
          enemyIds: ['berserker'], turns: 9, affinityId: 'sword',
          statusKinds: ['poison'], actionKinds: ['shield'],
        }),
        combatFact({
          battleId: 'battle:loss', depth: 7, biomeId: 'thornwild', result: 'loss',
          enemyIds: ['bandit_duelist'], boss: true, turns: 2, affinityId: 'fire',
          statusKinds: ['burn'], actionKinds: ['damage'],
        }),
        combatFact({ battleId: 'battle:content-drift', depth: 4, usedCardIds: ['fireball'], actionKinds: [] }),
      ],
      revengeFactLedger: [{
        battleId: 'battle:revenge', enemyId: 'bandit_duelist', achievedDepth: 5, status: 'ready',
      }],
      signatureFactLedger: [
        { battleId: 'battle:sig-1', cardId: 'sword_slash', achievedDepth: 3, bossFinisher: false, status: 'ready' },
        { battleId: 'battle:sig-2', cardId: 'sword_slash', achievedDepth: 4, bossFinisher: true, status: 'ready' },
        { battleId: 'battle:sig-3', cardId: 'other', achievedDepth: 2, bossFinisher: true, status: 'ready' },
      ],
    });

    const cases: Array<[EventRequirementV3, boolean]> = [
      [{ fact: 'combat.enemyDefeated', args: { enemyId: 'bandit_duelist', atLeast: 2 } }, true],
      [{ fact: 'combat.enemyDefeated', args: { weaponAffinity: 'sword', atLeast: 2 } }, true],
      [{ fact: 'combat.enemyDefeated', args: { enemyId: 'unknown_historical_enemy', atLeast: 1 } }, true],
      [{ fact: 'combat.enemyDefeated', args: { weaponAffinity: 'beast', atLeast: 1 } }, false],
      [{ fact: 'combat.biomeBossDefeated', args: { biomeId: 'arrowfell' } }, true],
      [{ fact: 'combat.biomeBossDefeated', args: { biomeId: 'thornwild' } }, false],
      [{ fact: 'combat.affinityWin', args: { affinityId: 'fire', atLeast: 1, biomeId: 'arrowfell' } }, true],
      [{ fact: 'combat.statusUsed', args: { status: 'burn', result: 'bossWin', biomeId: 'arrowfell' } }, true],
      [{ fact: 'combat.statusUsed', args: { status: 'burn', result: 'win', biomeId: 'thornwild' } }, false],
      [{ fact: 'combat.actionKindUsed', args: { actionKind: 'shield', result: 'win', biomeId: 'swornhold' } }, true],
      [{ fact: 'combat.actionKindUsed', args: { actionKind: 'damage', result: 'win', biomeId: 'thornwild' } }, false],
      [{ fact: 'combat.fastWin', args: { maxTurns: 4, element: 'fire' } }, true],
      [{ fact: 'combat.fastWin', args: { maxTurns: 3, element: 'fire' } }, false],
      [{ fact: 'combat.recentLoss', args: { withinDepth: 1 } }, true],
      [{ fact: 'combat.noLossesInBiome', args: { biomeId: 'arrowfell' } }, true],
      [{ fact: 'combat.noLossesInBiome', args: { biomeId: 'thornwild' } }, false],
      [{ fact: 'combat.revengeReady', args: {} }, true],
      [{ fact: 'combat.signatureReady', args: { winsAtLeast: 2, bossFinisher: true } }, true],
      [{ fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } }, false],
    ];
    for (const [requirement, expected] of cases) expect(met(base, requirement)).toBe(expected);

    expect(met(activeRun({
      combatFactLedger: [combatFact({ usedCardIds: ['fireball'], actionKinds: [] })],
    }), { fact: 'combat.actionKindUsed', args: { actionKind: 'damage', result: 'win' } })).toBe(false);
  });

  it('derives mono weapon and element identity without the board-affinity threshold', () => {
    const weapon = activeRun({
      pieces: [{ instanceId: 'card:1', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
    });
    const element = activeRun({
      pieces: [
        { instanceId: 'card:1', skillId: 'cinder_dart', tier: 'bronze', slot: 0 },
        { instanceId: 'card:2', skillId: 'fireball', tier: 'bronze', slot: 1 },
      ],
    });
    const mixed = activeRun({
      pieces: [
        { instanceId: 'card:1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
        { instanceId: 'card:2', skillId: 'armor_break', tier: 'bronze', slot: 1 },
      ],
    });

    expect(monoTypeBinding(weapon)).toEqual({ typeKind: 'weapon', type: 'sword' });
    expect(monoTypeBinding(element)).toEqual({ typeKind: 'element', type: 'fire' });
    expect(monoTypeBinding(mixed)).toBeUndefined();
    expect(monoTypeBinding(activeRun({ pieces: [] }))).toBeUndefined();
    expect(met(weapon, { fact: 'board.isMonoType', args: { typeKind: 'weapon' } })).toBe(true);
    expect(met(weapon, { fact: 'board.isMonoType', args: { typeKind: 'element' } })).toBe(false);
    expect(met(activeRun({ pieces: [
      { instanceId: 'card:1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
      { instanceId: 'card:2', skillId: 'twin_slash', tier: 'bronze', slot: 1 },
      { instanceId: 'card:3', skillId: 'void_pierce', tier: 'bronze', slot: 2 },
    ] }), { fact: 'board.affinity', args: { affinityId: 'sword' } })).toBe(true);
    expect(met(weapon, { fact: 'board.affinity', args: { affinityId: 'sword' } })).toBe(false);
  });

  it('board.affinity passes BOTH board.affinity:sword AND board.affinity:fire on a dual-affinity board (3 fire + 3 sword)', () => {
    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    const fires = Object.values(skillBook).filter((s) => s.element === 'fire').slice(0, 3);
    expect(swords.length).toBe(3);
    expect(fires.length).toBe(3);
    const dual = activeRun({
      pieces: [
        ...swords.map((s, i) => ({ instanceId: `sw:${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
        ...fires.map((s, i) => ({ instanceId: `fi:${i}`, skillId: s.id, tier: 'bronze' as const, slot: swords.length + i })),
      ],
    });

    // The old element-first collapse (`boardTypeIdentity(...)?.type ===`)
    // would only ever agree with 'fire' here and REFUSE a player who has
    // genuinely earned sword too. Both must pass.
    expect(met(dual, { fact: 'board.affinity', args: { affinityId: 'sword' } })).toBe(true);
    expect(met(dual, { fact: 'board.affinity', args: { affinityId: 'fire' } })).toBe(true);
    // An affinity neither axis earned still fails.
    expect(met(dual, { fact: 'board.affinity', args: { affinityId: 'frost' } })).toBe(false);
    expect(met(dual, { fact: 'board.affinity', args: { affinityId: 'axe' } })).toBe(false);
  });

  it('a within-axis tie (3 fire + 3 frost) fails board.affinity on EITHER element, but a weapon affinity earned alongside it still passes', () => {
    const fires = Object.values(skillBook).filter((s) => s.element === 'fire').slice(0, 3);
    const frosts = Object.values(skillBook).filter((s) => s.element === 'frost').slice(0, 3);
    const swords = Object.values(skillBook).filter((s) => s.weapon === 'sword' && s.element === undefined).slice(0, 3);
    expect(fires.length).toBe(3);
    expect(frosts.length).toBe(3);
    expect(swords.length).toBe(3);
    const tiedElementPlusWeapon = activeRun({
      pieces: [
        ...fires.map((s, i) => ({ instanceId: `fi:${i}`, skillId: s.id, tier: 'bronze' as const, slot: i })),
        ...frosts.map((s, i) => ({ instanceId: `fr:${i}`, skillId: s.id, tier: 'bronze' as const, slot: fires.length + i })),
        ...swords.map((s, i) => (
          { instanceId: `sw:${i}`, skillId: s.id, tier: 'bronze' as const, slot: fires.length + frosts.length + i }
        )),
      ],
    });

    // 3 fire + 3 frost is an exact tie WITHIN the element axis — neither
    // element clears the threshold.
    expect(met(tiedElementPlusWeapon, { fact: 'board.affinity', args: { affinityId: 'fire' } })).toBe(false);
    expect(met(tiedElementPlusWeapon, { fact: 'board.affinity', args: { affinityId: 'frost' } })).toBe(false);
    // The tie is scoped to ITS OWN axis — the untouched sword lean sitting
    // beside it still earns the weapon affinity.
    expect(met(tiedElementPlusWeapon, { fact: 'board.affinity', args: { affinityId: 'sword' } })).toBe(true);
  });

  it('gives weapon identity deterministic priority when both dimensions qualify', () => {
    skillBook.__dual_type_test__ = {
      id: '__dual_type_test__', name: 'Dual Type Test', archetypes: ['offense'],
      property: 'true', size: 1, rarity: 'common', tier: 'bronze',
      weapon: 'sword', element: 'fire', effects: [],
    };
    try {
      const state = activeRun({
        pieces: [{ instanceId: 'card:dual', skillId: '__dual_type_test__', tier: 'bronze', slot: 0 }],
      });
      expect(monoTypeBinding(state)).toEqual({ typeKind: 'weapon', type: 'sword' });
    } finally {
      delete skillBook.__dual_type_test__;
    }
  });
});

describe('run/eventEligibilityV3: atomic deterministic bindings', () => {
  it('binds a deterministic bounded future biome and replays the persisted result without rerolling', () => {
    const unvisited = ['duskbarrow', 'stormreach'];
    const visited = biomeIds.filter((id) => id !== 'arrowfell' && !unvisited.includes(id));
    const input = committedRun('event:alpha', NODE, {
      journeyFactLedger: { visitedBiomeIds: visited },
    });
    const binding = [{
      as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
    }] as const satisfies readonly EventBindingSpecV3[];

    const first = bindEventV3(input, 'event:alpha', binding, NODE);
    expect(first).toMatchObject({ ok: true, boundSubjects: { destination_biome: 'duskbarrow' } });
    if (!first.ok) throw new Error('fixture must bind');
    expect(first.state.eventInstances[NODE.id]?.boundSubjects).toEqual(first.boundSubjects);

    const changedCandidates = {
      ...first.state,
      journeyFactLedger: { visitedBiomeIds: [...biomeIds] },
    };
    const replay = bindEventV3(changedCandidates, 'event:alpha', binding, NODE);
    expect(replay).toEqual({ ok: true, state: changedCandidates, boundSubjects: first.boundSubjects });
    expect(replay.state).toBe(changedCandidates);

    const gammaNode = { ...NODE, id: 'event-node-gamma' };
    const gamma = bindEventV3(
      committedRun('event:gamma', gammaNode, { journeyFactLedger: { visitedBiomeIds: visited } }),
      'event:gamma', binding, gammaNode,
    );
    expect(gamma).toMatchObject({ ok: true, boundSubjects: { destination_biome: 'stormreach' } });
  });

  it('persists an absent future-biome subject when the closed unvisited catalog is exhausted', () => {
    const input = committedRun('event:full', NODE, {
      journeyFactLedger: { visitedBiomeIds: [...biomeIds] },
    });
    const result = bindEventV3(input, 'event:full', [{
      as: 'destination_biome', source: 'journey.futureBiome', candidates: 'unvisited_catalog',
    }], NODE);

    expect(result).toMatchObject({ ok: true, boundSubjects: {} });
    if (!result.ok) throw new Error('exhausted future-biome policy must bind an absent subject');
    expect(result.state.eventInstances[NODE.id]?.boundSubjects).toEqual({});
    expect(result.boundSubjects).not.toHaveProperty('destination_biome');
  });

  it('orders revenge and signature by depth, lexical subject, then battle and pairs revenge slots', () => {
    const input = committedRun('event:ordered', NODE, {
      pieces: [{ instanceId: 'card:mono', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      revengeFactLedger: [
        { battleId: 'battle:0', enemyId: 'aardvark', finisherCardId: 'too-deep', achievedDepth: 2, status: 'ready' },
        { battleId: 'battle:z', enemyId: 'aardvark', finisherCardId: 'later-battle', achievedDepth: 1, status: 'ready' },
        { battleId: 'battle:a', enemyId: 'zebra', finisherCardId: 'later-subject', achievedDepth: 1, status: 'ready' },
        { battleId: 'battle:a', enemyId: 'aardvark', finisherCardId: 'chosen-finisher', achievedDepth: 1, status: 'ready' },
      ],
      signatureFactLedger: [
        { battleId: 'battle:0', cardId: 'alpha', achievedDepth: 2, bossFinisher: true, status: 'ready' },
        { battleId: 'battle:z', cardId: 'alpha', achievedDepth: 1, bossFinisher: true, status: 'ready' },
        { battleId: 'battle:a', cardId: 'zeta', achievedDepth: 1, bossFinisher: true, status: 'ready' },
        { battleId: 'battle:a', cardId: 'alpha', achievedDepth: 1, bossFinisher: false, status: 'ready' },
      ],
    });
    const result = bindEventV3(input, 'event:ordered', [
      { as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId' },
      { as: 'signature_card_id', source: 'signature.cardId' },
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'mono_type', source: 'board.monoType' },
    ], NODE, { fact: 'combat.signatureReady', args: { winsAtLeast: 1, bossFinisher: true } });

    expect(result).toMatchObject({
      ok: true,
      boundSubjects: {
        enemy_id: 'aardvark', revenge_finisher_card_id: 'chosen-finisher',
        signature_card_id: 'alpha', mono_type: { typeKind: 'weapon', type: 'sword' },
      },
    });
    if (!result.ok) throw new Error('fixture must bind');
    expect(result.state.revengeFactLedger[3]).toMatchObject({
      status: 'reserved', reservedByInstanceId: 'event:ordered',
    });
    expect(result.state.signatureFactLedger[3]).toMatchObject({
      status: 'reserved', reservedByInstanceId: 'event:ordered',
    });
    expect(result.state.eventBindingReservations).toHaveLength(2);
    expect(result.state.eventBindingReservations.map((entry) => ({
      source: entry.source, sourceBattleId: entry.sourceBattleId, subjectId: entry.subjectId,
    }))).toEqual([
      { source: 'revenge', sourceBattleId: 'battle:a', subjectId: 'aardvark' },
      { source: 'signature', sourceBattleId: 'battle:a', subjectId: 'alpha' },
    ]);
  });

  it('resolves every required binding before mutation and leaves all bytes unchanged on a missing finisher', () => {
    const input = committedRun('event:atomic', NODE, {
      revengeFactLedger: [
        { battleId: 'battle:first', enemyId: 'alpha', achievedDepth: 1, status: 'ready' },
        { battleId: 'battle:second', enemyId: 'beta', finisherCardId: 'has-one', achievedDepth: 2, status: 'ready' },
      ],
      signatureFactLedger: [
        { battleId: 'battle:sig', cardId: 'card:sig', achievedDepth: 1, bossFinisher: true, status: 'ready' },
      ],
    });
    const before = JSON.stringify(input);
    const result = bindEventV3(input, 'event:atomic', [
      { as: 'signature_card_id', source: 'signature.cardId' },
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId' },
    ], NODE, { fact: 'combat.signatureReady', args: { winsAtLeast: 1, bossFinisher: true } });

    expect(result).toEqual({ ok: false, state: input, reason: 'no-subject' });
    expect(result.state).toBe(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('allows only an explicitly optional revenge finisher to reserve and persist the chosen revenge subject', () => {
    const input = committedRun('event:optional-finisher', NODE, {
      revengeFactLedger: [
        { battleId: 'battle:first', enemyId: 'alpha', achievedDepth: 1, status: 'ready' },
        { battleId: 'battle:second', enemyId: 'beta', finisherCardId: 'has-one', achievedDepth: 2, status: 'ready' },
      ],
    });
    const binding = [
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true },
    ] as const satisfies readonly EventBindingSpecV3[];
    const result = bindEventV3(input, 'event:optional-finisher', binding, NODE);

    expect(result).toMatchObject({
      ok: true,
      boundSubjects: { enemy_id: 'alpha' },
    });
    if (!result.ok) throw new Error('fixture must bind');
    expect(result.boundSubjects).not.toHaveProperty('revenge_finisher_card_id');
    expect(result.state.revengeFactLedger[0]).toMatchObject({
      status: 'reserved', reservedByInstanceId: 'event:optional-finisher',
    });
    expect(result.state.eventBindingReservations).toHaveLength(1);

    const restored = JSON.parse(JSON.stringify(result.state)) as RunState;
    const replay = bindEventV3(restored, 'event:optional-finisher', binding, NODE);
    expect(replay).toEqual({ ok: true, state: restored, boundSubjects: { enemy_id: 'alpha' } });
    expect(replay.state.eventBindingReservations).toHaveLength(1);
  });

  it.each([
    ['absent', { fact: 'wallet.current', args: { op: 'gte', value: 0 } }],
    ['negated', { not: { fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } } }],
    ['branch-only', { any: [
      { fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } },
      { fact: 'wallet.current', args: { op: 'gte', value: 0 } },
    ] }],
    ['ambiguous', { all: [
      { fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } },
      { fact: 'combat.signatureReady', args: { winsAtLeast: 4, bossFinisher: true } },
    ] }],
  ] as const)('fails closed without mutation for %s signature qualification', (_name, eligibility) => {
    const input = committedRun('event:signature-closed', NODE, {
      signatureFactLedger: [0, 1, 2].map((index) => ({
        battleId: `battle:signature:${String(index)}`, cardId: 'sword_slash',
        achievedDepth: index + 1, bossFinisher: index === 2, status: 'ready' as const,
      })),
    });
    const result = bindEventV3(input, 'event:signature-closed', [{
      as: 'signature_card_id', source: 'signature.cardId',
    }], NODE, eligibility as EventRequirementV3);

    expect(result).toEqual({ ok: false, state: input, reason: 'no-subject' });
    expect(result.state).toBe(input);
  });

  it('survives JSON round trip, blocks another instance, and replays without duplicate reservations', () => {
    const firstInput = committedRun('event:first', NODE, {
      revengeFactLedger: [{
        battleId: 'battle:revenge', enemyId: 'bandit_duelist', finisherCardId: 'sword_slash',
        achievedDepth: 2, status: 'ready',
      }],
    });
    const binding = [{ as: 'enemy_id', source: 'revenge.enemyId' }] as const;
    const first = bindEventV3(firstInput, 'event:first', binding, NODE);
    if (!first.ok) throw new Error('fixture must bind');
    expect(first.state.eventBindingReservations).toHaveLength(1);

    const replay = bindEventV3(first.state, 'event:first', binding, NODE);
    expect(replay).toEqual({ ok: true, state: first.state, boundSubjects: first.boundSubjects });
    expect(replay.state).toBe(first.state);
    expect(replay.state.eventBindingReservations).toHaveLength(1);

    const restored = JSON.parse(JSON.stringify(first.state)) as RunState;
    const otherNode = { ...NODE, id: 'event-node-other' };
    const otherInput: RunState = {
      ...restored,
      eventInstances: {
        ...restored.eventInstances,
        [otherNode.id]: {
          eventId: 'other', contentVersion: 3, instanceId: 'event:other', drawnDepth: otherNode.depth,
        },
      },
    };
    const other = bindEventV3(otherInput, 'event:other', binding, otherNode);
    expect(other).toEqual({ ok: false, state: otherInput, reason: 'no-subject' });
    expect(other.state).toBe(otherInput);
  });

  it('rejects orphan binding and inconsistent same-instance reservations without mutation', () => {
    const orphan = activeRun();
    expect(bindEventV3(orphan, 'event:orphan', [], NODE)).toEqual({
      ok: false, state: orphan, reason: 'no-subject',
    });

    const inconsistent = committedRun('event:conflict', NODE, {
      eventBindingReservations: [{
        reservationId: 'reservation:stale', instanceId: 'event:conflict', source: 'revenge',
        sourceBattleId: 'battle:stale', subjectId: 'stale-enemy',
      }],
    });
    const result = bindEventV3(inconsistent, 'event:conflict', [], NODE);
    expect(result).toEqual({ ok: false, state: inconsistent, reason: 'already-reserved' });
    expect(result.state).toBe(inconsistent);
  });

  it('replays a materialization binding when the matching committed instance predates snapshots', () => {
    const input = committedRun('event:materialized', NODE, {
      eventMaterializations: {
        'event:materialized': {
          eventInstanceId: 'event:materialized', choiceIds: ['take', 'leave'],
          selectedWeightedBranchIds: {}, unavailableChoiceReasonsByChoiceId: {},
          boundSubjects: { signature_card_id: 'sword_slash' },
          deferredOffersByChoiceId: {},
        },
      },
    });
    const result = bindEventV3(input, 'event:materialized', [{
      as: 'signature_card_id', source: 'signature.cardId',
    }], NODE);

    expect(result).toEqual({
      ok: true, state: input, boundSubjects: { signature_card_id: 'sword_slash' },
    });
    expect(result.state).toBe(input);
  });
});

describe('run/eventInstances: closed binding equality', () => {
  const legacy: EventInstanceRecord = {
    eventId: 'legacy', contentVersion: 2, instanceId: 'event:legacy', drawnDepth: 3,
  };

  it('retains equality for two legacy records without bindings', () => {
    expect(sameEventInstance(legacy, { ...legacy })).toBe(true);
  });

  it('compares bindings structurally rather than by identity or key order', () => {
    const first: EventInstanceRecord = {
      ...legacy,
      boundSubjects: {
        enemy_id: 'bandit_duelist', mono_type: { typeKind: 'weapon', type: 'sword' },
      },
    };
    const same: EventInstanceRecord = {
      ...legacy,
      boundSubjects: {
        mono_type: { typeKind: 'weapon', type: 'sword' }, enemy_id: 'bandit_duelist',
      },
    };
    expect(sameEventInstance(first, same)).toBe(true);
    expect(sameEventInstance(first, {
      ...same, boundSubjects: { ...same.boundSubjects, enemy_id: 'berserker' },
    })).toBe(false);
    expect(sameEventInstance(legacy, first)).toBe(false);
  });
});
