import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  EventBoundSubjectsV3,
  EventMonoTypeBindingValueV3,
  LoadedEventDefV3,
} from '../../src/data/eventContentV3';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { biomeIds } from '../../src/data/biomes';
import { gemBook } from '../../src/data/gems';
import { loadEventContent, type LoadedEventContent } from '../../src/data/eventsContent';
import { skillBook } from '../../src/data/skills';
import { hashSeed } from '../../src/engine/rng';
import type { Element, WeaponType } from '../../src/engine/types';
import {
  clearRun,
  finalizeCurrentRunEventOffer,
  getActiveRun,
  installDevRunFixture,
  reopenCurrentRunEventOffer,
  resolveCurrentRunEventChoice,
} from '../../src/game/runStore';
import { buildRunEventViewModel } from '../../src/game/ui/runEventViewModel';
import { dueEventCallback, sweepExpiredEventCallbacks } from '../../src/run/eventCallbacks';
import type { CombatFactLedgerEntry } from '../../src/run/eventV3Facts';
import { recordEventInstance } from '../../src/run/eventInstances';
import { materializeReachedEventV3, resolveEventChoiceV3 } from '../../src/run/eventsV3';
import {
  firstEligibleConditionalEvent,
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { gemMatchesFilter, gemRarityEligible } from '../../src/run/shop';
import type { RunCard, RunNode, RunState } from '../../src/run/runState';
import { activeRun, eventNode, installCurrentNode, roundTrip } from '../fixtures/eventV2';

const aggregate = JSON.parse(readFileSync(
  new URL('../../src/data/content/events.v3.json', import.meta.url),
  'utf8',
)) as unknown;
const loaded = loadEventContent(aggregate);
const NEW_IDS = [
  'gilded_detour', 'victors_table', 'bitter_rematch',
  'last_light_at_roads_end', 'last_light_secret_route',
  'mirror_of_the_board', 'mirror_transformation',
  'card_that_remembered', 'signature_card_capstone',
  'cartographers_missing_road', 'missing_road_destination',
] as const;
type NewEventId = typeof NEW_IDS[number];

const AFFINITIES = [
  { typeKind: 'weapon', type: 'sword' },
  { typeKind: 'weapon', type: 'axe' },
  { typeKind: 'weapon', type: 'lance' },
  { typeKind: 'weapon', type: 'bow' },
  { typeKind: 'weapon', type: 'beast' },
  { typeKind: 'element', type: 'fire' },
  { typeKind: 'element', type: 'frost' },
  { typeKind: 'element', type: 'lightning' },
  { typeKind: 'element', type: 'nature' },
  { typeKind: 'element', type: 'holy' },
  { typeKind: 'element', type: 'dark' },
] as const satisfies readonly EventMonoTypeBindingValueV3[];

const lookup: LoadedEventContent['eventDefAtVersion'] = (eventId, version) => (
  loaded.eventDefAtVersion(eventId, version)
);

const content: EventSelectionContent = {
  catalog: Object.fromEntries(NEW_IDS.map((id) => [id, loaded.catalog[id]!])),
  orderedIds: NEW_IDS,
  currentVersionOf: (eventId) => loaded.meta[eventId]!.version,
};

function event(id: NewEventId): LoadedEventDefV3 {
  const found = loaded.catalog[id];
  if (found === undefined || !isEventDefV3(found)) throw new Error(`missing schema-v3 ${id}`);
  return found;
}

function combatFact(overrides: Partial<CombatFactLedgerEntry> = {}): CombatFactLedgerEntry {
  return {
    battleId: 'battle:fixture', nodeId: 'fight:fixture', depth: 2, biomeId: 'arrowfell',
    enemyIds: ['bandit_duelist'], result: 'win', boss: false, turns: 9,
    affinityId: 'sword', usedCardIds: ['sword_slash'], statusKinds: [], actionKinds: ['damage'],
    ...overrides,
  };
}

function card(instanceId: string, skillId: string, tier: RunCard['tier'] = 'bronze'): RunCard {
  return { instanceId, skillId, tier };
}

function emptyFacts(seed = 1900): RunState {
  const base = activeRun(seed);
  return {
    ...base,
    gold: 30,
    pieces: [],
    bagSlots: Array(base.bagSlots.length).fill(null),
    held: null,
    combatFactLedger: [],
    revengeFactLedger: [],
    signatureFactLedger: [],
    eventBindingReservations: [],
    journeyFactLedger: { visitedBiomeIds: [] },
    completedStoryIds: [],
    stats: {
      ...base.stats,
      goldSpent: 0,
      cardsBought: 0,
      gemsBought: 0,
      livesLost: 0,
      goldEarned: 0,
      eventsResolved: 0,
    },
    wins: 0,
    losses: 0,
    bossesCleared: 0,
  };
}

function withOwnedCards(state: RunState, cards: readonly RunCard[]): RunState {
  const bagSlots = Array(Math.max(state.bagSlots.length, cards.length)).fill(null) as Array<RunCard | null>;
  cards.forEach((owned, index) => { bagSlots[index] = owned; });
  return { ...state, pieces: [], bagSlots, held: null };
}

function broadRewardState(seed = 1900): RunState {
  const owned = [
    card('owned:sword', 'sword_slash'),
    card('owned:axe', 'armor_break'),
    card('owned:lance', 'lance_thrust'),
    card('owned:bow', 'aimed_shot'),
    card('owned:beast', 'battle_howl'),
    card('owned:fire', 'fireball'),
    card('owned:frost', 'frost_ward'),
    card('owned:lightning', 'arcane_bolt'),
    card('owned:nature', 'blooming_vine'),
    card('owned:holy', 'radiant_bolt'),
    card('owned:dark', 'shadow_bolt'),
  ];
  // Split across board + bag (2026-09-06): 11 owned cards do not fit ONE
  // 10-wide bag strip, and the old fixture packed all 11 into `bagSlots`
  // anyway — harmless before the bag-room gate (`cardOutcomeCanDeliver`,
  // `src/run/events.ts`) existed, but it left this fixture's bag reporting
  // ZERO room forever after, so a real `cardChoice`/`bonusDraft` reward
  // materialized against it (e.g. `victors_table`'s `choose_spoils`) could
  // never actually resolve. The board share keeps every affinity still
  // "owned" for any fact/filter that reads board+bag together (the same
  // idiom `monoBoard` below already uses for its own board pieces).
  const state = withOwnedCards(emptyFacts(seed), owned.slice(3));
  return { ...state, pieces: owned.slice(0, 3).map((c, index) => ({ ...c, slot: index })) };
}

function monoBoard(state: RunState, binding: EventMonoTypeBindingValueV3): RunState {
  const candidates = Object.values(skillBook).filter((skill) => (
    binding.typeKind === 'weapon' ? skill.weapon === binding.type : skill.element === binding.type
  )).slice(0, 3);
  if (candidates.length !== 3) throw new Error(`fixture needs three ${binding.typeKind}:${binding.type} cards`);
  return {
    ...state,
    pieces: candidates.map((skill, index) => ({
      ...card(`mono:${binding.typeKind}:${binding.type}:${String(index)}`, skill.id, index === 0 ? 'gold' : 'bronze'),
      slot: index,
    })),
    bagSlots: Array(state.bagSlots.length).fill(null),
    held: null,
    bossesCleared: 1,
  };
}

function revengeState(seed = 1900, finisherCardId: string | null = 'sword_slash'): RunState {
  const owned = withOwnedCards(emptyFacts(seed), [card('revenge-finisher', 'sword_slash')]);
  return {
    ...owned,
    revengeFactLedger: [{
      battleId: 'battle:revenge', enemyId: 'wolf_king',
      ...(finisherCardId === null ? {} : { finisherCardId }),
      achievedDepth: 2, status: 'ready',
    }],
  };
}

function signatureState(seed = 1900): RunState {
  const owned = withOwnedCards(emptyFacts(seed), [card('signature-owned', 'fireball')]);
  return {
    ...owned,
    signatureFactLedger: [0, 1, 2].map((index) => ({
      battleId: `battle:signature:${String(index)}`,
      cardId: 'fireball',
      achievedDepth: 2 + index,
      bossFinisher: index === 2,
      status: 'ready' as const,
    })),
  };
}

function cartographerState(seed = 1900): RunState {
  return {
    ...broadRewardState(seed),
    journeyFactLedger: { visitedBiomeIds: ['arrowfell', 'duskbarrow', 'emberwaste'] },
    completedStoryIds: ['feathered_cairn', 'names_under_stone'],
  };
}

function lastLightState(seed = 1900): RunState {
  return {
    ...emptyFacts(seed),
    lives: 1,
    combatFactLedger: [combatFact({ battleId: 'battle:loss', result: 'loss', depth: 3 })],
  };
}

function stateForEvent(id: NewEventId, seed = 1900): RunState {
  switch (id) {
    case 'gilded_detour': {
      const state = broadRewardState(seed);
      return { ...state, stats: { ...state.stats, goldSpent: 10 } };
    }
    case 'victors_table': return { ...broadRewardState(seed), wins: 5 };
    case 'bitter_rematch': return revengeState(seed);
    case 'last_light_at_roads_end': return lastLightState(seed);
    case 'last_light_secret_route': return broadRewardState(seed);
    case 'mirror_of_the_board': return monoBoard(broadRewardState(seed), { typeKind: 'weapon', type: 'sword' });
    case 'mirror_transformation': return broadRewardState(seed);
    case 'card_that_remembered': return signatureState(seed);
    case 'signature_card_capstone': return broadRewardState(seed);
    case 'cartographers_missing_road': return cartographerState(seed);
    case 'missing_road_destination': return broadRewardState(seed);
  }
}

function rarityHit(id: NewEventId): number {
  const rarity = event(id).rarity;
  const divisor = rarity === 'uncommon' ? 2 : rarity === 'rare' ? 4 : rarity === 'secret' ? 10 : 1;
  for (let seed = 0; seed < 1000; seed += 1) {
    if (hashSeed('eventRarity', seed, id) % divisor === 0) return seed;
  }
  throw new Error(`bounded rarity seed missing for ${id}`);
}

function nodeFor(def: LoadedEventDefV3, overrides: Partial<RunNode> = {}): RunNode {
  return eventNode({
    id: `node:${def.id}`,
    depth: 6,
    wave: 4,
    eventTheme: def.theme,
    biomeId: 'arrowfell',
    eventSeed: rarityHit(def.id as NewEventId),
    ...overrides,
  });
}

function callbackSubjects(id: NewEventId): Readonly<EventBoundSubjectsV3> | undefined {
  if (id === 'mirror_transformation') return { mono_type: { typeKind: 'weapon', type: 'sword' } };
  if (id === 'signature_card_capstone') return { signature_card_id: 'fireball' };
  if (id === 'missing_road_destination') return { destination_biome: 'frostmarch' };
  return undefined;
}

function materialized(
  def: LoadedEventDefV3,
  state: RunState,
  node = nodeFor(def),
  subjects = callbackSubjects(def.id as NewEventId),
): RunState {
  const current = installCurrentNode(state, node);
  const committed = recordEventInstance(current, node.id, {
    eventId: def.id,
    contentVersion: 1,
    instanceId: `event:${node.id}`,
    drawnDepth: node.depth,
    ...(subjects === undefined ? {} : { boundSubjects: subjects }),
  });
  const result = materializeReachedEventV3(committed, node, def, 1);
  if (!result.ok) throw new Error(`materialization failed for ${def.id}: ${result.reason}`);
  return result.state;
}

function materializedChoice(
  eventId: NewEventId,
  choiceId: string,
  stateFactory: (seed: number) => RunState = (seed) => stateForEvent(eventId, seed),
  nodeOverrides: Partial<RunNode> = {},
  subjects = callbackSubjects(eventId),
): { node: RunNode; state: RunState } {
  const def = event(eventId);
  const node = nodeFor(def, { id: `store:${eventId}:${choiceId}`, ...nodeOverrides });
  for (let seed = 1; seed <= 64; seed += 1) {
    const state = materialized(def, stateFactory(seed), node, subjects);
    if (state.eventMaterializations[`event:${node.id}`]?.choiceIds.includes(choiceId)) {
      return { node, state };
    }
  }
  throw new Error(`${eventId}/${choiceId} was not committed in the bounded seed set`);
}

function allAuthoredChoices(def: LoadedEventDefV3) {
  return [...def.choiceSet.fixed, ...(def.choiceSet.pool?.entries ?? [])];
}

afterEach(() => clearRun());

describe('schema-v3 global event runtime behavior', () => {
  it('unlocks every global anchor only from its exact authored facts', () => {
    const qualifying: Record<Exclude<NewEventId,
    'last_light_secret_route' | 'mirror_transformation' | 'signature_card_capstone' | 'missing_road_destination'>, RunState> = {
      gilded_detour: stateForEvent('gilded_detour'),
      victors_table: stateForEvent('victors_table'),
      bitter_rematch: stateForEvent('bitter_rematch'),
      last_light_at_roads_end: stateForEvent('last_light_at_roads_end'),
      mirror_of_the_board: stateForEvent('mirror_of_the_board'),
      card_that_remembered: stateForEvent('card_that_remembered'),
      cartographers_missing_road: stateForEvent('cartographers_missing_road'),
    };

    for (const [id, state] of Object.entries(qualifying)) {
      const def = event(id as keyof typeof qualifying);
      const node = nodeFor(def);
      expect(firstEligibleConditionalEvent(state, node, [def])?.id, id).toBe(id);
      expect(firstEligibleConditionalEvent(emptyFacts(1901), node, [def]), `${id} missing facts`).toBeUndefined();
    }

    const healing = withOwnedCards(lastLightState(), [card('healing', 'mending_light')]);
    expect(firstEligibleConditionalEvent(healing, nodeFor(event('last_light_at_roads_end')), [event('last_light_at_roads_end')])).toBeUndefined();
    const staleLoss = { ...lastLightState(), combatFactLedger: [combatFact({ result: 'loss', depth: 2 })] };
    expect(firstEligibleConditionalEvent(staleLoss, nodeFor(event('last_light_at_roads_end')), [event('last_light_at_roads_end')])).toBeUndefined();
  });

  it('commits the safe choice plus both seeded reward alternatives for every global payoff', () => {
    for (const [id, safe] of [
      ['gilded_detour', 'keep_fortune'],
      ['victors_table', 'take_purse'],
      ['bitter_rematch', 'spare_rival'],
    ] as const) {
      const def = event(id);
      const node = nodeFor(def, { id: `pool:${id}` });
      const variants = new Set<string>();
      for (let seed = 1; seed <= 64; seed += 1) {
        const first = materialized(def, stateForEvent(id, seed), node);
        const same = materialized(def, stateForEvent(id, seed), node);
        const replay = materializeReachedEventV3(roundTrip(first), node, def, 1);
        if (!replay.ok) throw new Error(`replay failed for ${id}`);
        const record = first.eventMaterializations[`event:${node.id}`]!;
        expect(record.choiceIds).toHaveLength(2);
        expect(record.choiceIds).toContain(safe);
        expect(JSON.stringify(same)).toBe(JSON.stringify(first));
        expect(JSON.stringify(replay.state)).toBe(JSON.stringify(first));
        variants.add(record.choiceIds.join(','));
      }
      expect(variants.size, id).toBe(2);
    }
  });

  it('binds an optional revenge finisher once and falls back exactly when it is absent', () => {
    const noFinisher = materializedChoice(
      'bitter_rematch', 'honor_finisher', (seed) => revengeState(seed, null),
    );
    const record = noFinisher.state.eventMaterializations[`event:${noFinisher.node.id}`]!;
    expect(record.boundSubjects).toEqual({ enemy_id: 'wolf_king' });
    expect(record.deferredOffersByChoiceId.honor_finisher).toEqual({
      kind: 'upgradeCardTargeted', status: 'pending', optionInstanceIds: [],
      fallback: { kind: 'grantGold', amount: 2 },
    });
    installDevRunFixture(roundTrip(noFinisher.state));
    expect(resolveCurrentRunEventChoice('honor_finisher', lookup)).toEqual({
      kind: 'grantGold', amount: 2, fellBack: true,
    });
    const settled = getActiveRun()!;
    expect(settled.gold).toBe(noFinisher.state.gold + 2);
    expect(settled.revengeFactLedger[0]?.status).toBe('consumed');
    const bytes = JSON.stringify(settled);
    expect(resolveCurrentRunEventChoice('honor_finisher', lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(bytes);
  });

  it('binds the qualified signature card rather than an earlier unqualified record', () => {
    const state = signatureState(1910);
    const withDistractor: RunState = {
      ...state,
      signatureFactLedger: [{
        battleId: 'battle:distractor', cardId: 'sword_slash', achievedDepth: 1,
        bossFinisher: false, status: 'ready',
      }, ...state.signatureFactLedger],
    };
    const def = event('card_that_remembered');
    const node = nodeFor(def, { id: 'signature-qualified-subject' });
    expect(firstEligibleConditionalEvent(withDistractor, node, [def])?.id).toBe(def.id);
    const result = materialized(def, withDistractor, node);
    expect(result.eventMaterializations[`event:${node.id}`]?.boundSubjects).toEqual({
      signature_card_id: 'fireball',
    });
    expect(result.signatureFactLedger.filter((record) => record.cardId === 'fireball' && record.status === 'reserved')).toHaveLength(1);
    expect(result.signatureFactLedger[0]).toMatchObject({ cardId: 'sword_slash', status: 'ready' });
  });

  it('materializes weapon and element mirror rewards solely from each persisted mono binding', () => {
    const def = event('mirror_of_the_board');
    const affinityOutcome = def.choiceSet.fixed.find((choice) => choice.id === 'take_affinity_gem')?.outcome;
    if (affinityOutcome?.kind !== 'gemChoice' || affinityOutcome.boundSubject === undefined) {
      throw new Error('mirror affinity outcome must use the bound selector');
    }
    const affinitySelector = affinityOutcome.boundSubject;

    for (const binding of AFFINITIES) {
      const node = nodeFor(def, { id: `mirror:${binding.typeKind}:${binding.type}`, depth: 1, wave: 1 });
      const state = monoBoard(broadRewardState(1920), binding);
      const result = materialized(def, state, node);
      const record = result.eventMaterializations[`event:${node.id}`]!;
      expect(record.boundSubjects).toEqual({ mono_type: binding });

      const upgrade = record.deferredOffersByChoiceId.perfect_reflection;
      expect(upgrade?.kind).toBe('upgradeCardTargeted');
      if (upgrade?.kind === 'upgradeCardTargeted') {
        expect(upgrade.optionInstanceIds).toEqual(state.pieces.map((owned) => owned.instanceId));
      }

      const gem = record.deferredOffersByChoiceId.take_affinity_gem;
      expect(gem?.kind).toBe('gemChoice');
      if (gem?.kind !== 'gemChoice') continue;
      expect(gem.optionGemIds).toHaveLength(3);
      expect(new Set(gem.optionGemIds).size).toBe(3);
      const authored = affinitySelector.cases.find((entry) => (
        entry.when.typeKind === binding.typeKind && entry.when.type === binding.type
      ));
      expect(authored).toBeDefined();
      for (const gemId of gem.optionGemIds) {
        expect(gemBook[gemId]).toBeDefined();
        expect(gemMatchesFilter(gemBook[gemId]!, authored!.filter)).toBe(true);
        expect(gemRarityEligible(gemBook[gemId]!.rarity, node.depth)).toBe(true);
      }

      const changedBoard = monoBoard(result, binding.typeKind === 'weapon'
        ? { typeKind: 'element', type: 'fire' }
        : { typeKind: 'weapon', type: 'sword' });
      const replay = materializeReachedEventV3(roundTrip(changedBoard), node, def, 1);
      expect(replay.ok).toBe(true);
      if (replay.ok) expect(replay.materialization).toEqual(record);
    }
  });

  it('copies mirror and signature subjects into callbacks and never rebinds from a changed board or ledger', () => {
    const mirror = materializedChoice('mirror_of_the_board', 'enter_mirror');
    const mirrorSubject = mirror.state.eventMaterializations[`event:${mirror.node.id}`]!.boundSubjects.mono_type;
    installDevRunFixture(mirror.state);
    expect(resolveCurrentRunEventChoice('enter_mirror', lookup)).toEqual({ kind: 'grantGold', amount: 1 });
    const mirrorScheduled = getActiveRun()!;
    expect(mirrorScheduled.eventCallbackQueue[0]?.boundSubjects).toEqual({ mono_type: mirrorSubject });
    const changed = monoBoard(mirrorScheduled, { typeKind: 'element', type: 'fire' });
    const mirrorDue = eventNode({
      id: 'mirror:due', depth: mirror.node.depth + 3, wave: 5,
      eventTheme: 'forge', biomeId: 'arrowfell',
    });
    const delivered = rollEventForNode(installCurrentNode(changed, mirrorDue), mirrorDue, lookup, content);
    expect(delivered.event.id).toBe('mirror_transformation');
    const callbackRecord = delivered.state.eventMaterializations[`event:${mirrorDue.id}`]!;
    expect(callbackRecord.boundSubjects).toEqual({ mono_type: mirrorSubject });

    const signature = materializedChoice('card_that_remembered', 'awaken_capstone');
    installDevRunFixture(signature.state);
    expect(resolveCurrentRunEventChoice('awaken_capstone', lookup)).toEqual({ kind: 'grantGold', amount: 1 });
    const signatureScheduled = getActiveRun()!;
    expect(signatureScheduled.eventCallbackQueue[0]?.boundSubjects).toEqual({ signature_card_id: 'fireball' });
    expect(signatureScheduled.signatureFactLedger.filter((record) => record.status === 'consumed')).toHaveLength(1);
  });

  it('uses the future-biome binding as the missing road callback sole destination', () => {
    const source = materializedChoice('cartographers_missing_road', 'mark_missing_road');
    const binding = source.state.eventMaterializations[`event:${source.node.id}`]!.boundSubjects.destination_biome;
    expect(binding).toBeDefined();
    expect(source.state.journeyFactLedger.visitedBiomeIds).not.toContain(binding);
    expect(binding).not.toBe(source.node.biomeId);

    installDevRunFixture(roundTrip(source.state));
    expect(resolveCurrentRunEventChoice('mark_missing_road', lookup)).toEqual({ kind: 'grantGold', amount: 1 });
    const scheduled = getActiveRun()!;
    expect(scheduled.eventCallbackQueue[0]).toMatchObject({
      callbackId: 'missing_road_destination',
      destinationBiomeIds: [binding],
      boundSubjects: { destination_biome: binding },
    });

    const wrongBiome = biomeIds.find((id) => id !== binding)!;
    const due = eventNode({
      id: 'missing-road:due', depth: source.node.depth + 2, wave: 5,
      eventTheme: 'cache', biomeId: binding,
    });
    expect(dueEventCallback(scheduled, { ...due, id: 'missing-road:wrong', biomeId: wrongBiome }, lookup)).toBeUndefined();
    const delivered = rollEventForNode(installCurrentNode(scheduled, due), due, lookup, content);
    expect(delivered.event.id).toBe('missing_road_destination');
    expect(delivered.state.eventInstances[due.id]?.boundSubjects).toEqual({ destination_biome: binding });
  });

  it('keeps an all-biomes-visited Cartographer usable while locking only its unavailable road', () => {
    const def = event('cartographers_missing_road');
    const node = nodeFor(def, { id: 'cartographer:all-biomes-visited' });
    const exhausted: RunState = {
      ...cartographerState(node.eventSeed),
      journeyFactLedger: { visitedBiomeIds: [...biomeIds] },
    };

    expect(firstEligibleConditionalEvent(exhausted, node, [def])?.id).toBe(def.id);
    const rolled = rollEventForNode(installCurrentNode(exhausted, node), node, lookup, content);
    expect(rolled.event.id).toBe(def.id);
    const instanceId = `event:${node.id}`;
    const record = rolled.state.eventMaterializations[instanceId]!;
    expect(record.choiceIds).toEqual(['mark_missing_road', 'study_map', 'sell_map']);
    expect(record.boundSubjects).toEqual({});
    expect(record.boundSubjects).not.toHaveProperty('destination_biome');
    expect((record as unknown as {
      unavailableChoiceReasonsByChoiceId: Readonly<Record<string, string>>;
    }).unavailableChoiceReasonsByChoiceId).toEqual({
      mark_missing_road: 'no_unvisited_biome',
    });

    const view = buildRunEventViewModel(rolled.state, node, def, lookup);
    expect(view?.choices.map(({ id, locked, lockReason }) => ({ id, locked, lockReason }))).toEqual([
      { id: 'mark_missing_road', locked: true, lockReason: 'no unvisited biome remains' },
      { id: 'study_map', locked: false, lockReason: null },
      { id: 'sell_map', locked: false, lockReason: null },
    ]);

    const beforePure = JSON.stringify(rolled.state);
    const refused = resolveEventChoiceV3(rolled.state, instanceId, 'mark_missing_road', lookup);
    expect(refused).toEqual({ ok: false, state: rolled.state, reason: 'gate' });
    expect(refused.state).toBe(rolled.state);
    expect(JSON.stringify(rolled.state)).toBe(beforePure);

    installDevRunFixture(roundTrip(rolled.state));
    const beforeStore = JSON.stringify(getActiveRun());
    expect(resolveCurrentRunEventChoice('mark_missing_road', lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(beforeStore);

    const reloaded = roundTrip(rolled.state);
    expect(reloaded.eventMaterializations[instanceId]).toEqual(record);
    expect(buildRunEventViewModel(reloaded, node, def, lookup)).toEqual(view);

    const studied = resolveEventChoiceV3(rolled.state, instanceId, 'study_map', lookup);
    expect(studied.ok).toBe(true);
    if (studied.ok) expect(studied.outcome.kind).toBe('grantLevel');
    const sold = resolveEventChoiceV3(rolled.state, instanceId, 'sell_map', lookup);
    expect(sold.ok).toBe(true);
    if (sold.ok) expect(sold.outcome).toEqual({ kind: 'grantGold', amount: 5 });
  });

  it('delays and prioritizes each global callback, completes only by terminal choice, and expires safely', () => {
    const chains = [
      { anchor: 'last_light_at_roads_end', schedule: 'risk_last_road', callback: 'last_light_secret_route', terminal: 'turn_back', delay: 2, theme: 'omen', expiry: 12, story: 'last_light_at_roads_end' },
      { anchor: 'mirror_of_the_board', schedule: 'enter_mirror', callback: 'mirror_transformation', terminal: 'break_mirror', delay: 3, theme: 'forge', expiry: 20, story: 'mirror_of_the_board' },
      { anchor: 'card_that_remembered', schedule: 'awaken_capstone', callback: 'signature_card_capstone', terminal: 'let_memory_rest', delay: 2, theme: 'forge', expiry: 20, story: 'card_that_remembered' },
      { anchor: 'cartographers_missing_road', schedule: 'mark_missing_road', callback: 'missing_road_destination', terminal: 'leave_road_missing', delay: 2, theme: 'cache', expiry: 20, story: 'cartographers_missing_road' },
    ] as const;

    for (const chain of chains) {
      const source = materializedChoice(chain.anchor, chain.schedule);
      installDevRunFixture(source.state);
      expect(resolveCurrentRunEventChoice(chain.schedule, lookup)).toBeDefined();
      const scheduled = roundTrip(getActiveRun()!);
      const queue = scheduled.eventCallbackQueue[0]!;
      expect(queue).toMatchObject({
        callbackId: chain.callback, eventId: chain.callback, contentVersion: 1,
        scheduledDepth: source.node.depth, earliestDepth: source.node.depth + chain.delay,
        minDepthDelay: chain.delay, destinationThemes: [chain.theme], priority: 700,
        expiry: { expiresAfterNodes: chain.expiry },
      });
      expect(scheduled.completedStoryIds).not.toContain(chain.story);
      const due = eventNode({
        id: `due:${chain.callback}`, depth: source.node.depth + chain.delay,
        wave: 5, eventTheme: chain.theme,
        biomeId: queue.destinationBiomeIds?.[0] ?? 'arrowfell',
      });
      expect(dueEventCallback(scheduled, { ...due, depth: due.depth - 1 }, lookup)).toBeUndefined();

      const delivered = rollEventForNode(installCurrentNode(scheduled, due), due, lookup, content);
      expect(delivered.event.id).toBe(chain.callback);
      expect(delivered.state.eventCallbackQueue).toEqual([]);
      expect(delivered.state.eventMaterializations[`event:${due.id}`]?.choiceIds).toHaveLength(3);
      const replay = rollEventForNode(roundTrip(delivered.state), due, lookup, content);
      expect(JSON.stringify(replay.state)).toBe(JSON.stringify(delivered.state));
      installDevRunFixture(replay.state);
      expect(resolveCurrentRunEventChoice(chain.terminal, lookup)).toBeDefined();
      expect(getActiveRun()!.completedStoryIds).toContain(chain.story);

      const expired = sweepExpiredEventCallbacks(scheduled, source.node.depth + chain.expiry + 1);
      expect(expired.eventCallbackQueue).toEqual([]);
      expect(expired.completedStoryIds).not.toContain(chain.story);
      const expectedGold = chain.callback === 'signature_card_capstone' ? scheduled.gold + 1 : scheduled.gold;
      expect(expired.gold).toBe(expectedGold);
      expect(sweepExpiredEventCallbacks(expired, source.node.depth + chain.expiry + 2)).toBe(expired);
    }
  });

  it('delivers a due callback before a simultaneously eligible higher-story ambient event', () => {
    const source = materializedChoice('last_light_at_roads_end', 'risk_last_road');
    installDevRunFixture(source.state);
    expect(resolveCurrentRunEventChoice('risk_last_road', lookup)).toBeDefined();
    const scheduled = getActiveRun()!;
    const signature = signatureState(scheduled.map.seed);
    const competing: RunState = {
      ...scheduled,
      pieces: signature.pieces,
      bagSlots: signature.bagSlots,
      held: signature.held,
      signatureFactLedger: signature.signatureFactLedger,
    };
    const due = eventNode({
      id: 'due:beats-ambient', depth: source.node.depth + 2, wave: 5,
      eventTheme: 'omen', biomeId: 'arrowfell', eventSeed: rarityHit('card_that_remembered'),
    });
    const atNode = installCurrentNode(competing, due);

    expect(firstEligibleConditionalEvent(atNode, due, [event('card_that_remembered')])?.id)
      .toBe('card_that_remembered');
    expect(rollEventForNode(atNode, due, lookup, content).event.id).toBe('last_light_secret_route');
  });

  it('persists three distinct depth-eligible options for generic and bound gem rewards', () => {
    for (const [eventId, choiceId] of [
      ['gilded_detour', 'buy_premium_gem'],
      ['card_that_remembered', 'take_signature_gem'],
      ['signature_card_capstone', 'take_answering_gem'],
    ] as const) {
      const selected = materializedChoice(eventId, choiceId, undefined, { depth: 1, wave: 1 });
      const offer = selected.state.eventMaterializations[`event:${selected.node.id}`]!.deferredOffersByChoiceId[choiceId];
      expect(offer?.kind).toBe('gemChoice');
      if (offer?.kind !== 'gemChoice') continue;
      expect(offer.optionGemIds).toHaveLength(3);
      expect(new Set(offer.optionGemIds).size).toBe(3);
      for (const gemId of offer.optionGemIds) {
        expect(gemBook[gemId]).toBeDefined();
        expect(gemRarityEligible(gemBook[gemId]!.rarity, selected.node.depth)).toBe(true);
      }
    }
  });

  it('applies exact costs, mutations, pending offers, and same-selection replay once', () => {
    const purchase = materializedChoice('gilded_detour', 'buy_premium_gem');
    const purchaseOffer = purchase.state.eventMaterializations[`event:${purchase.node.id}`]!.deferredOffersByChoiceId.buy_premium_gem;
    installDevRunFixture(roundTrip(purchase.state));
    expect(resolveCurrentRunEventChoice('buy_premium_gem', lookup)).toEqual({ kind: 'gemChoice', offer: purchaseOffer });
    expect(getActiveRun()!.gold).toBe(purchase.state.gold - 6);
    expect(getActiveRun()!.stats.goldSpent).toBe(purchase.state.stats.goldSpent + 6);
    expect(reopenCurrentRunEventOffer(lookup)).toEqual({ kind: 'gemChoice', offer: purchaseOffer });
    if (purchaseOffer?.kind !== 'gemChoice') throw new Error('premium gem picker missing');
    const selectedGem = purchaseOffer.optionGemIds[0];
    expect(finalizeCurrentRunEventOffer({ kind: 'gem', gemId: selectedGem }, lookup)).toEqual({
      kind: 'grantGem', gemId: selectedGem,
    });
    const settled = getActiveRun()!;
    expect(settled.gemInventory.filter((id) => id === selectedGem)).toHaveLength(1);
    const settledBytes = JSON.stringify(settled);
    expect(finalizeCurrentRunEventOffer({ kind: 'gem', gemId: selectedGem }, lookup)).toEqual({ kind: 'alreadySettled' });
    expect(JSON.stringify(getActiveRun())).toBe(settledBytes);

    const spared = materializedChoice('bitter_rematch', 'spare_rival');
    installDevRunFixture(spared.state);
    expect(resolveCurrentRunEventChoice('spare_rival', lookup)).toEqual({ kind: 'nothing' });
    expect(getActiveRun()!.storyStateV3.rival_spared).toBe(true);
  });

  it('materializes and resolves every authored choice through the canonical store', () => {
    for (const eventId of NEW_IDS) {
      const def = event(eventId);
      for (const authoredChoice of allAuthoredChoices(def)) {
        const selected = materializedChoice(eventId, authoredChoice.id);
        expect(selected.state.eventMaterializations[`event:${selected.node.id}`]?.choiceIds).toContain(authoredChoice.id);
        installDevRunFixture(selected.state);
        const result = resolveCurrentRunEventChoice(authoredChoice.id, lookup);
        expect(result, `${eventId}/${authoredChoice.id}`).toBeDefined();
        if (result === undefined || !('offer' in result) || result.offer.status !== 'pending') continue;
        const pendingBytes = JSON.stringify(getActiveRun());
        expect(reopenCurrentRunEventOffer(lookup)).toStrictEqual(result);
        expect(JSON.stringify(getActiveRun())).toBe(pendingBytes);
        const selection = result.kind === 'cardChoice' || result.kind === 'bonusDraft'
          ? { kind: 'card' as const, skillId: result.offer.options[0]!.skillId }
          : result.kind === 'gemChoice'
            ? { kind: 'gem' as const, gemId: result.offer.optionGemIds[0] }
            : result.kind === 'upgradeCardTargeted'
              ? { kind: 'upgrade' as const, instanceId: result.offer.optionInstanceIds[0]! }
              : result.kind === 'upgradeCard'
                ? { kind: 'upgrade' as const, instanceId: result.offer.optionInstanceIds[0]! }
                : undefined;
        expect(selection, `${eventId}/${authoredChoice.id} supported picker`).toBeDefined();
        if (selection !== undefined) expect(finalizeCurrentRunEventOffer(selection, lookup)).toBeDefined();
      }
    }
  });

  it('ignores presentation-copy changes when committing selections, bindings, and offers', () => {
    const original = event('mirror_of_the_board');
    const copyChanged: LoadedEventDefV3 = {
      ...original,
      title: 'Different title',
      body: 'Different body',
      choiceSet: {
        ...original.choiceSet,
        fixed: original.choiceSet.fixed.map((choice) => ({ ...choice, label: `Different ${choice.id}` })),
      },
    };
    const node = nodeFor(original, { id: 'copy-does-not-drive-behavior' });
    const state = stateForEvent('mirror_of_the_board', 1999);
    const left = materialized(original, state, node);
    const right = materialized(copyChanged, state, node);
    expect(right.eventInstances).toEqual(left.eventInstances);
    expect(right.eventBindingReservations).toEqual(left.eventBindingReservations);
    expect(right.eventMaterializations).toEqual(left.eventMaterializations);
  });
});
