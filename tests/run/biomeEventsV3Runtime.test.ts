import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { LoadedEventDefV3 } from '../../src/data/eventContentV3';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { gemBook } from '../../src/data/gems';
import { loadEventContent, type LoadedEventContent } from '../../src/data/eventsContent';
import { skillBook } from '../../src/data/skills';
import { hashSeed } from '../../src/engine/rng';
import {
  clearRun,
  finalizeCurrentRunEventOffer,
  getActiveRun,
  installDevRunFixture,
  reopenCurrentRunEventOffer,
  resolveCurrentRunEventChoice,
} from '../../src/game/runStore';
import { dueEventCallback, sweepExpiredEventCallbacks } from '../../src/run/eventCallbacks';
import type { CombatFactLedgerEntry } from '../../src/run/eventV3Facts';
import { recordEventInstance } from '../../src/run/eventInstances';
import { materializeReachedEventV3 } from '../../src/run/eventsV3';
import {
  firstEligibleConditionalEvent,
  rollEventForNode,
  type EventSelectionContent,
} from '../../src/run/events';
import { gemRarityEligible } from '../../src/run/shop';
import type { RunCard, RunNode, RunState } from '../../src/run/runState';
import { activeRun, eventNode, installCurrentNode, roundTrip } from '../fixtures/eventV2';

const aggregate = JSON.parse(readFileSync(
  new URL('../../src/data/content/events.v3.json', import.meta.url),
  'utf8',
)) as unknown;
const loaded = loadEventContent(aggregate);
const NEW_IDS = [
  'names_under_stone', 'names_under_stone_answer', 'cinderheart_crucible',
  'whiteout_pilgrim', 'whiteout_guidance', 'moon_scented_trail', 'moon_scented_hunt',
  'red_standard', 'last_hedge', 'thunder_in_a_bottle', 'bloom_behind_the_teeth',
] as const;

const lookup: LoadedEventContent['eventDefAtVersion'] = (eventId, version) => (
  loaded.eventDefAtVersion(eventId, version)
);

const content: EventSelectionContent = {
  catalog: Object.fromEntries(NEW_IDS.map((id) => [id, loaded.catalog[id]!])),
  orderedIds: NEW_IDS,
  currentVersionOf: (eventId) => loaded.meta[eventId]!.version,
};

function event(id: typeof NEW_IDS[number]): LoadedEventDefV3 {
  const found = loaded.catalog[id];
  if (found === undefined || !isEventDefV3(found)) throw new Error(`missing schema-v3 ${id}`);
  return found;
}

function fact(overrides: Partial<CombatFactLedgerEntry>): CombatFactLedgerEntry {
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

function emptyFacts(seed = 700): RunState {
  const base = activeRun(seed);
  return {
    ...base,
    pieces: [],
    bagSlots: Array(base.bagSlots.length).fill(null),
    held: null,
    combatFactLedger: [],
  };
}

function withOwnedCards(state: RunState, cards: readonly RunCard[]): RunState {
  const bagSlots = Array(Math.max(state.bagSlots.length, cards.length)).fill(null) as Array<RunCard | null>;
  cards.forEach((owned, index) => { bagSlots[index] = owned; });
  return { ...state, pieces: [], bagSlots, held: null };
}

function withAffinity(state: RunState, type: string): RunState {
  const skills = Object.values(skillBook).filter((candidate) => (
    (candidate.weapon === type || candidate.element === type) && candidate.size === 1
  )).slice(0, 3);
  if (skills.length !== 3) throw new Error(`fixture needs three size-one ${type} cards`);
  return {
    ...state,
    pieces: skills.map((candidate, index) => card(`affinity:${type}:${String(index)}`, candidate.id, 'bronze') as RunCard & { slot: number })
      .map((owned, index) => ({ ...owned, slot: index })),
    bagSlots: Array(state.bagSlots.length).fill(null),
    held: null,
  };
}

function broadRewardState(seed: number): RunState {
  return withOwnedCards(emptyFacts(seed), [
    card('owned:dark', 'shadow_bolt'),
    card('owned:fire', 'fireball'),
    card('owned:frost', 'frost_ward'),
    card('owned:beast', 'battle_howl'),
    card('owned:axe', 'armor_break'),
    card('owned:lance', 'lance_thrust'),
    card('owned:lightning', 'arcane_bolt'),
    card('owned:nature', 'blooming_vine'),
  ]);
}

function rarityHit(id: string): number {
  const rarity = event(id as typeof NEW_IDS[number]).rarity;
  const divisor = rarity === 'uncommon' ? 2 : rarity === 'rare' ? 4 : 1;
  for (let seed = 0; seed < 100; seed += 1) {
    if (hashSeed('eventRarity', seed, id) % divisor === 0) return seed;
  }
  throw new Error(`bounded rarity seed missing for ${id}`);
}

function nodeFor(def: LoadedEventDefV3, overrides: Partial<RunNode> = {}): RunNode {
  return eventNode({
    id: `node:${def.id}`,
    depth: 4,
    wave: 3,
    eventTheme: def.theme,
    biomeId: def.biomeIds?.[0] ?? 'arrowfell',
    eventSeed: rarityHit(def.id),
    ...overrides,
  });
}

function materialized(
  def: LoadedEventDefV3,
  state: RunState,
  node = nodeFor(def),
): RunState {
  const current = installCurrentNode(state, node);
  const committed = recordEventInstance(current, node.id, {
    eventId: def.id,
    contentVersion: 1,
    instanceId: `event:${node.id}`,
    drawnDepth: node.depth,
  });
  const result = materializeReachedEventV3(committed, node, def, 1);
  if (!result.ok) throw new Error(`materialization failed for ${def.id}: ${result.reason}`);
  return result.state;
}

function materializedChoice(
  eventId: typeof NEW_IDS[number],
  choiceId: string,
  stateForSeed: (seed: number) => RunState = broadRewardState,
  nodeOverrides: Partial<RunNode> = {},
): { node: RunNode; state: RunState } {
  const def = event(eventId);
  const node = nodeFor(def, { id: `store:${eventId}:${choiceId}`, ...nodeOverrides });
  for (let seed = 1; seed <= 32; seed += 1) {
    const state = materialized(def, stateForSeed(seed), node);
    const committed: readonly string[] = state.eventMaterializations[`event:${node.id}`]?.choiceIds ?? [];
    if (committed.includes(choiceId)) {
      expect(committed, `${eventId}/${choiceId} persisted choice`).toContain(choiceId);
      return { node, state };
    }
  }
  throw new Error(`${eventId}/${choiceId} was not committed in the bounded seed set`);
}

afterEach(() => clearRun());

describe('schema-v3 biome event runtime behavior', () => {
  it('unlocks each ambient anchor only for its exact biome and persisted facts', () => {
    const qualifying = {
      names_under_stone: withOwnedCards({
        ...emptyFacts(),
        combatFactLedger: [fact({ biomeId: 'duskbarrow', boss: true })],
      }, [card('dark', 'shadow_bolt')]),
      cinderheart_crucible: withOwnedCards(emptyFacts(), [card('fire', 'fireball', 'gold')]),
      whiteout_pilgrim: {
        ...emptyFacts(),
        combatFactLedger: [fact({ biomeId: 'frostmarch', affinityId: 'frost' })],
      },
      // `moorfang_alpha` swapped out for a second `gorse_hound` kill
      // (2026-09-06): `combat.enemyDefeated`'s `weaponAffinity: 'beast'` fact
      // now reads each enemy's BOARD-DERIVED affinity (`enemyDerivedAffinity`,
      // no more authored override), and `moorfang_alpha`'s own 2-card board
      // never reaches `IDENTITY_THRESHOLD = 3` — it no longer counts as beast
      // at all. Only `gorse_hound` and `wolf_king` still do on the live
      // roster, so a fixture proving `atLeast: 3` needs a repeat kill of one
      // of those two, not a third distinct "beast-flavoured" enemy.
      moon_scented_trail: {
        ...emptyFacts(),
        combatFactLedger: [fact({ enemyIds: ['gorse_hound', 'gorse_hound', 'wolf_king'] })],
      },
      red_standard: {
        ...emptyFacts(),
        combatFactLedger: [0, 1, 2].map((index) => fact({
          battleId: `battle:axe:${String(index)}`, biomeId: 'ironmoot', affinityId: 'axe', depth: index + 1,
        })),
      },
      last_hedge: withOwnedCards(emptyFacts(), [card('lance-defense', 'braced_pike')]),
      thunder_in_a_bottle: {
        ...emptyFacts(),
        combatFactLedger: [fact({ biomeId: 'stormreach', affinityId: 'lightning', turns: 8 })],
      },
      bloom_behind_the_teeth: withAffinity({
        ...emptyFacts(),
        combatFactLedger: [fact({ biomeId: 'thornwild', boss: true, statusKinds: ['poison'] })],
      }, 'nature'),
    } as const;

    for (const [id, state] of Object.entries(qualifying)) {
      const def = event(id as keyof typeof qualifying);
      const exactNode = nodeFor(def);
      expect(firstEligibleConditionalEvent(state, exactNode, [def])?.id, id).toBe(id);

      const wrongBiome = { ...exactNode, id: `${exactNode.id}:wrong`, biomeId: 'arrowfell' };
      expect(firstEligibleConditionalEvent(state, wrongBiome, [def]), `${id} wrong biome`).toBeUndefined();

      const noFacts = emptyFacts(701);
      expect(firstEligibleConditionalEvent(noFacts, exactNode, [def]), `${id} missing facts`).toBeUndefined();
    }
  });

  it('commits one fixed safe choice plus one seed-selected reward for each payoff pool', () => {
    for (const id of ['cinderheart_crucible', 'red_standard', 'thunder_in_a_bottle'] as const) {
      const def = event(id);
      const node = nodeFor(def, { id: `pool:${id}` });
      const variants = new Set<string>();
      for (let seed = 1; seed <= 32; seed += 1) {
        const first = materialized(def, broadRewardState(seed), node);
        const sameSeed = materialized(def, broadRewardState(seed), node);
        const replay = materializeReachedEventV3(roundTrip(first), node, def, 1);
        if (!replay.ok) throw new Error(`replay failed for ${id}`);
        const record = first.eventMaterializations[`event:${node.id}`]!;
        expect(record.choiceIds).toHaveLength(2);
        expect(JSON.stringify(sameSeed)).toBe(JSON.stringify(first));
        expect(JSON.stringify(replay.state)).toBe(JSON.stringify(first));
        variants.add(record.choiceIds.join(','));
      }
      expect(variants.size, id).toBe(2);
    }
  });

  it('materializes three distinct known depth-eligible gems for every curated biome reward', () => {
    const gemChoices = [
      ['cinderheart_crucible', 'choose_fire_gem'],
      ['whiteout_pilgrim', 'take_ward'],
      ['whiteout_guidance', 'take_ward'],
      ['moon_scented_trail', 'take_trophy'],
      ['moon_scented_hunt', 'share_quarry'],
      ['last_hedge', 'take_hedge_ward'],
      ['thunder_in_a_bottle', 'socket_thunder'],
      ['bloom_behind_the_teeth', 'harvest_venom'],
    ] as const;

    for (const [eventId, choiceId] of gemChoices) {
      const def = event(eventId);
      const node = nodeFor(def, { id: `gems:${eventId}`, depth: 1, wave: 1 });
      let offer: any;
      for (let seed = 1; seed <= 32 && offer === undefined; seed += 1) {
        const state = materialized(def, broadRewardState(seed), node);
        offer = state.eventMaterializations[`event:${node.id}`]?.deferredOffersByChoiceId[choiceId];
      }
      expect(offer?.kind, `${eventId}/${choiceId}`).toBe('gemChoice');
      expect(offer.optionGemIds).toHaveLength(3);
      expect(new Set(offer.optionGemIds).size).toBe(3);
      for (const gemId of offer.optionGemIds as string[]) {
        expect(gemBook[gemId], gemId).toBeDefined();
        expect(gemRarityEligible(gemBook[gemId]!.rarity, node.depth), gemId).toBe(true);
      }
    }
  });

  it('schedules, delays, delivers, persists, resolves, and expires each biome callback exactly', () => {
    const chains = [
      {
        anchor: 'names_under_stone', schedule: 'take_grave_silver', callback: 'names_under_stone_answer',
        terminal: 'close_stone', story: 'names_under_stone', delay: 3, theme: 'omen', biome: 'arrowfell', expiry: 20,
      },
      {
        anchor: 'whiteout_pilgrim', schedule: 'share_white_road', callback: 'whiteout_guidance',
        terminal: 'walk_unaided', story: 'whiteout_pilgrim', delay: 2, theme: 'training', biome: 'frostmarch', expiry: 12,
      },
      {
        anchor: 'moon_scented_trail', schedule: 'follow_hunt', callback: 'moon_scented_hunt',
        terminal: 'release_quarry', story: 'moon_scented_trail', delay: 3, theme: 'recruit', biome: 'howlmoor', expiry: 15,
      },
    ] as const;

    for (const chain of chains) {
      const anchor = event(chain.anchor);
      const sourceNode = nodeFor(anchor, { id: `source:${chain.anchor}`, depth: 3, wave: 2 });
      installDevRunFixture(materialized(anchor, broadRewardState(811), sourceNode));
      expect(resolveCurrentRunEventChoice(chain.schedule, lookup), chain.anchor).toBeDefined();
      const scheduled = roundTrip(getActiveRun()!);
      expect(scheduled.completedStoryIds).not.toContain(chain.story);
      expect(scheduled.eventCallbackQueue).toEqual([expect.objectContaining({
        callbackId: chain.callback,
        eventId: chain.callback,
        contentVersion: 1,
        scheduledDepth: sourceNode.depth,
        earliestDepth: sourceNode.depth + chain.delay,
        minDepthDelay: chain.delay,
        destinationThemes: [chain.theme],
        priority: 700,
        boundSubjects: {},
        expiry: { expiresAfterNodes: chain.expiry, fallback: 'discard' },
      })]);

      const tooEarly = eventNode({
        id: `early:${chain.callback}`, depth: sourceNode.depth + chain.delay - 1,
        wave: 3, eventTheme: chain.theme, biomeId: chain.biome,
      });
      expect(dueEventCallback(scheduled, tooEarly, lookup)).toBeUndefined();

      const dueNode = eventNode({
        id: `due:${chain.callback}`, depth: sourceNode.depth + chain.delay,
        wave: 4, eventTheme: chain.theme, biomeId: chain.biome,
      });
      const wrongTheme = eventNode({
        ...dueNode,
        id: `wrong-theme:${chain.callback}`,
        eventTheme: 'cache',
      });
      expect(dueEventCallback(scheduled, wrongTheme, lookup)).toBeUndefined();
      if (chain.callback !== 'names_under_stone_answer') {
        const wrongBiome = eventNode({
          ...dueNode,
          id: `wrong-biome:${chain.callback}`,
          biomeId: 'arrowfell',
        });
        expect(dueEventCallback(scheduled, wrongBiome, lookup)).toBeUndefined();
      }
      const atDue = installCurrentNode(scheduled, dueNode);
      const delivered = rollEventForNode(atDue, dueNode, lookup, content);
      expect(delivered.event.id).toBe(chain.callback);
      expect(delivered.state.eventCallbackQueue).toEqual([]);
      expect(delivered.state.eventMaterializations[`event:${dueNode.id}`]?.choiceIds).toHaveLength(3);

      const replay = rollEventForNode(roundTrip(delivered.state), dueNode, lookup, content);
      expect(JSON.stringify(replay.state)).toBe(JSON.stringify(delivered.state));
      installDevRunFixture(replay.state);
      expect(resolveCurrentRunEventChoice(chain.terminal, lookup)).toBeDefined();
      expect(getActiveRun()!.completedStoryIds).toContain(chain.story);

      const expired = sweepExpiredEventCallbacks(
        scheduled,
        sourceNode.depth + chain.expiry + 1,
      );
      expect(expired.eventCallbackQueue).toEqual([]);
      expect(expired.completedStoryIds).not.toContain(chain.story);
    }
  });

  it('applies exact Task 5 immediate results and their canonical state mutations once', () => {
    const gold = materializedChoice('cinderheart_crucible', 'bank_cinders');
    installDevRunFixture(gold.state);
    expect(resolveCurrentRunEventChoice('bank_cinders', lookup)).toEqual({ kind: 'grantGold', amount: 3 });
    const goldState = getActiveRun()!;
    expect(goldState.gold).toBe(gold.state.gold + 3);
    expect(goldState.stats.goldEarned).toBe(gold.state.stats.goldEarned + 3);
    expect(goldState.stats.eventsResolved).toBe(gold.state.stats.eventsResolved + 1);
    expect(goldState.eventResolutions?.[gold.node.id]).toEqual({
      eventId: 'cinderheart_crucible', contentVersion: 1,
      instanceId: `event:${gold.node.id}`, choiceId: 'bank_cinders',
    });
    const goldBytes = JSON.stringify(goldState);
    expect(resolveCurrentRunEventChoice('bank_cinders', lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(goldBytes);

    const level = materializedChoice('last_hedge', 'drill_then_leave');
    installDevRunFixture(level.state);
    expect(resolveCurrentRunEventChoice('drill_then_leave', lookup)).toEqual({
      kind: 'grantLevel', level: level.state.heroLevel + 1,
    });
    expect(getActiveRun()!.heroLevel).toBe(level.state.heroLevel + 1);

    const guidance = materializedChoice(
      'whiteout_guidance', 'take_guidance', broadRewardState, { wave: 4 },
    );
    installDevRunFixture(guidance.state);
    expect(resolveCurrentRunEventChoice('take_guidance', lookup)).toEqual({
      kind: 'grantMapInfo', bandsAhead: 2, revealedBands: [1, 2],
    });
    const guidanceState = getActiveRun()!;
    expect(guidanceState.appliedMapInfoSourceIds).toContain(`event:${guidance.node.id}`);
    expect(Object.values(guidanceState.mapIntelByBand).map((record) => ({
      band: record.band, sourceEventInstanceId: record.sourceEventInstanceId,
    }))).toEqual([
      { band: 1, sourceEventInstanceId: `event:${guidance.node.id}` },
      { band: 2, sourceEventInstanceId: `event:${guidance.node.id}` },
    ]);
    expect(guidanceState.completedStoryIds).toContain('whiteout_pilgrim');

    const release = materializedChoice('moon_scented_hunt', 'release_quarry');
    installDevRunFixture(release.state);
    expect(resolveCurrentRunEventChoice('release_quarry', lookup)).toEqual({ kind: 'nothing' });
    const releaseState = getActiveRun()!;
    expect(releaseState.storyStateV3.moon_quarry_released).toBe(true);
    expect(releaseState.completedStoryIds).toContain('moon_scented_trail');
  });

  it('persists exact Task 5 card, gem, and bonus-draft offers and delivers each selection once', () => {
    const cardPick = materializedChoice('names_under_stone_answer', 'answer_name');
    const cardOffer = cardPick.state.eventMaterializations[`event:${cardPick.node.id}`]!
      .deferredOffersByChoiceId.answer_name;
    expect(cardOffer).toMatchObject({ kind: 'cardChoice', status: 'pending' });
    installDevRunFixture(roundTrip(cardPick.state));
    expect(resolveCurrentRunEventChoice('answer_name', lookup)).toStrictEqual({
      kind: 'cardChoice', offer: cardOffer,
    });
    expect(getActiveRun()!.storyStateV3.grave_path).toBe('answered');
    expect(getActiveRun()!.completedStoryIds).toContain('names_under_stone');
    if (cardOffer?.kind !== 'cardChoice' || cardOffer.status !== 'pending') {
      throw new Error('answer_name must persist a pending card choice');
    }
    const selectedCard = cardOffer.options[0];
    const cardResult = finalizeCurrentRunEventOffer({ kind: 'card', skillId: selectedCard.skillId }, lookup);
    expect(cardResult).toEqual({
      kind: 'cardGranted', skillId: selectedCard.skillId, tier: selectedCard.tier,
      instanceId: expect.any(String),
    });
    if (cardResult?.kind !== 'cardGranted') throw new Error('answer_name did not grant its selected card');
    expect(getActiveRun()!.bagSlots.some((owned) => owned?.instanceId === cardResult.instanceId
      && owned.skillId === selectedCard.skillId && owned.tier === selectedCard.tier)).toBe(true);
    const settledCardBytes = JSON.stringify(getActiveRun());
    expect(finalizeCurrentRunEventOffer({ kind: 'card', skillId: selectedCard.skillId }, lookup)).toEqual({ kind: 'alreadySettled' });
    expect(JSON.stringify(getActiveRun())).toBe(settledCardBytes);

    const gemPick = materializedChoice('bloom_behind_the_teeth', 'harvest_venom');
    const gemOffer = gemPick.state.eventMaterializations[`event:${gemPick.node.id}`]!
      .deferredOffersByChoiceId.harvest_venom;
    expect(gemOffer).toMatchObject({ kind: 'gemChoice', status: 'pending' });
    installDevRunFixture(roundTrip(gemPick.state));
    expect(resolveCurrentRunEventChoice('harvest_venom', lookup)).toStrictEqual({
      kind: 'gemChoice', offer: gemOffer,
    });
    if (gemOffer?.kind !== 'gemChoice' || gemOffer.status !== 'pending') {
      throw new Error('harvest_venom must persist a pending gem choice');
    }
    const selectedGem = gemOffer.optionGemIds[0];
    expect(finalizeCurrentRunEventOffer({ kind: 'gem', gemId: selectedGem }, lookup)).toEqual({
      kind: 'grantGem', gemId: selectedGem,
    });
    expect(getActiveRun()!.gemInventory.filter((gemId) => gemId === selectedGem)).toHaveLength(1);
    const settledGemBytes = JSON.stringify(getActiveRun());
    expect(finalizeCurrentRunEventOffer({ kind: 'gem', gemId: selectedGem }, lookup)).toEqual({ kind: 'alreadySettled' });
    expect(JSON.stringify(getActiveRun())).toBe(settledGemBytes);

    const draft = materializedChoice('red_standard', 'claim_axe_draft');
    const draftRecord = draft.state.eventMaterializations[`event:${draft.node.id}`]!;
    expect(draftRecord.choiceIds).toContain('claim_axe_draft');
    const draftOffer = draftRecord.deferredOffersByChoiceId.claim_axe_draft;
    expect(draftOffer).toMatchObject({ kind: 'bonusDraft', status: 'pending' });
    installDevRunFixture(roundTrip(draft.state));
    expect(resolveCurrentRunEventChoice('claim_axe_draft', lookup)).toStrictEqual({
      kind: 'bonusDraft', offer: draftOffer,
    });
    if (draftOffer?.kind !== 'bonusDraft' || draftOffer.status !== 'pending') {
      throw new Error('claim_axe_draft must persist a pending bonus draft');
    }
    const selectedDraft = draftOffer.options[0];
    if (selectedDraft === undefined) throw new Error('claim_axe_draft must persist an offered card');
    expect(finalizeCurrentRunEventOffer({ kind: 'card', skillId: selectedDraft.skillId }, lookup)).toEqual({
      kind: 'grantCard', skillId: selectedDraft.skillId, tier: selectedDraft.tier,
    });
    expect(getActiveRun()!.bagSlots.some((owned) => owned?.skillId === selectedDraft.skillId
      && owned.tier === selectedDraft.tier)).toBe(true);
    const settledDraftBytes = JSON.stringify(getActiveRun());
    expect(finalizeCurrentRunEventOffer({ kind: 'card', skillId: selectedDraft.skillId }, lookup)).toEqual({ kind: 'alreadySettled' });
    expect(JSON.stringify(getActiveRun())).toBe(settledDraftBytes);
  });

  it('uses the exact Task 5 targeted-upgrade fallback and never delivers it twice', () => {
    const fallback = materializedChoice('cinderheart_crucible', 'temper_fire_card', emptyFacts);
    const record = fallback.state.eventMaterializations[`event:${fallback.node.id}`]!;
    expect(record.choiceIds).toContain('temper_fire_card');
    expect(record.deferredOffersByChoiceId.temper_fire_card).toEqual({
      kind: 'upgradeCardTargeted', status: 'pending', optionInstanceIds: [],
      fallback: { kind: 'grantGold', amount: 2 },
    });
    installDevRunFixture(roundTrip(fallback.state));
    expect(resolveCurrentRunEventChoice('temper_fire_card', lookup)).toEqual({
      kind: 'grantGold', amount: 2, fellBack: true,
    });
    const settled = getActiveRun()!;
    expect(settled.gold).toBe(fallback.state.gold + 2);
    expect(settled.stats.goldEarned).toBe(fallback.state.stats.goldEarned + 2);
    expect(settled.stats.eventsResolved).toBe(fallback.state.stats.eventsResolved + 1);
    expect(settled.eventMaterializations[`event:${fallback.node.id}`]!
      .deferredOffersByChoiceId.temper_fire_card).toEqual({
      kind: 'upgradeCardTargeted', status: 'settled', optionInstanceIds: [],
      fallback: { kind: 'grantGold', amount: 2 },
    });
    const settledBytes = JSON.stringify(settled);
    expect(resolveCurrentRunEventChoice('temper_fire_card', lookup)).toBeUndefined();
    expect(JSON.stringify(getActiveRun())).toBe(settledBytes);
  });

  it('materializes and resolves every authored option through the canonical store without reading copy', () => {
    for (const eventId of NEW_IDS) {
      const def = event(eventId);
      const authored = [...def.choiceSet.fixed, ...(def.choiceSet.pool?.entries ?? [])];
      for (const authoredChoice of authored) {
        const node = nodeFor(def, { id: `resolve:${eventId}:${authoredChoice.id}`, depth: 6, wave: 4 });
        let state: RunState | undefined;
        for (let seed = 1; seed <= 32 && state === undefined; seed += 1) {
          const candidate = materialized(def, broadRewardState(seed), node);
          if (candidate.eventMaterializations[`event:${node.id}`]?.choiceIds.includes(authoredChoice.id)) {
            state = candidate;
          }
        }
        expect(state, `${eventId}/${authoredChoice.id} bounded visibility`).toBeDefined();
        if (state === undefined) continue;
        expect(state.eventMaterializations[`event:${node.id}`]?.choiceIds).toContain(authoredChoice.id);
        installDevRunFixture(state);
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
              : undefined;
        expect(selection, `${eventId}/${authoredChoice.id} supported picker`).toBeDefined();
        if (selection !== undefined) expect(finalizeCurrentRunEventOffer(selection, lookup)).toBeDefined();
      }
    }
  });
});
