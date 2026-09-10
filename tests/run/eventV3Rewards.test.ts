import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type {
  EventBoundSubjectsV3,
  EventDirectOutcomeSpecV3,
} from '../../src/data/eventContentV3';
import { skillBook } from '../../src/data/skills';
import { hashSeed } from '../../src/engine/rng';
import {
  cardOfferableAtTier,
  minOfferableTier,
  TIER_ORDER,
  type SkillDef,
  type SkillTier,
} from '../../src/engine/types';
import { ownedCardsMatchingV3 } from '../../src/run/eventEligibilityV3';
import type { EventDeferredOfferV3 } from '../../src/run/eventV3Materialization';
import { rollStartDraft } from '../../src/run/draft';
import {
  EVENT_CARD_FALLBACK_GOLD,
  eventCardChoiceV3,
  eventOfferTierCap,
  settleEventCardChoiceV3,
  settleTargetedUpgradeV3,
  targetedUpgradeV3,
  type EventRewardSourceV3,
} from '../../src/run/eventV3Rewards';
import {
  createRun,
  tryInsertPersistedEventRunCard,
  type RunCard,
  type RunState,
} from '../../src/run/runState';

const ADDED_SKILLS: string[] = [];

afterEach(() => {
  for (const id of ADDED_SKILLS.splice(0)) delete skillBook[id];
});

function activeRun(seed = 404, overrides: Partial<RunState> = {}): RunState {
  return { ...createRun(seed), status: 'active', ...overrides };
}

const SOURCE: EventRewardSourceV3 = {
  eventId: 'reward_probe', rarity: 'rare', story: { stage: 'payoff', role: 'payoff' },
};

function cardChoice(
  maxTier: SkillTier = 'diamond',
  filter: Extract<EventDirectOutcomeSpecV3, { kind: 'cardChoice' }>['filter'] = [{}],
): Extract<EventDirectOutcomeSpecV3, { kind: 'cardChoice' }> {
  return { kind: 'cardChoice', filter, maxTier };
}

function addProbe(id: string, tier: SkillTier = 'bronze', lockedUntil?: SkillTier): SkillDef {
  const base = skillBook.sword_slash!;
  const probe: SkillDef = {
    ...base,
    id,
    tier,
    element: 'fire',
    effects: lockedUntil === undefined
      ? base.effects
      : base.effects.map((effect) => ({ ...effect, minTier: lockedUntil })),
  };
  skillBook[id] = probe;
  ADDED_SKILLS.push(id);
  return probe;
}

function addProbePool(prefix: string, tiers: readonly SkillTier[]): SkillDef[] {
  return tiers.map((tier, index) => addProbe(`${prefix}_${String(index)}`, tier));
}

const PROBE_FILTER = [{ weapons: ['sword'], elements: ['fire'] }] as const;

function pendingCardOffer(
  options: Extract<EventDeferredOfferV3, { kind: 'cardChoice'; status: 'pending' }>['options'],
): Extract<EventDeferredOfferV3, { kind: 'cardChoice'; status: 'pending' }> {
  return { kind: 'cardChoice', status: 'pending', options };
}

function pendingUpgrade(
  optionInstanceIds: readonly string[],
  fallback: { kind: 'grantGold'; amount: number } | { kind: 'nothing' } = { kind: 'nothing' },
): Extract<EventDeferredOfferV3, { kind: 'upgradeCardTargeted'; status: 'pending' }> {
  return { kind: 'upgradeCardTargeted', status: 'pending', optionInstanceIds, fallback };
}

describe('run/eventV3Rewards: event card offer tier caps', () => {
  it.each([
    [1, 'silver'],
    [3, 'silver'],
    [4, 'gold'],
    [8, 'gold'],
    [9, 'diamond'],
    [99, 'diamond'],
  ] as const)('caps depth %i at %s', (depth, tier) => {
    expect(eventOfferTierCap({ depth })).toBe(tier);
  });
});

describe('run/eventV3Rewards: deterministic event-only card offers', () => {
  it('deals exactly three distinct minimal DTOs and replays display order without a shared bag', () => {
    const state = activeRun(1234);
    const node = { id: 'event-a', depth: 9 };
    const first = eventCardChoiceV3(state, node, SOURCE, 'take_power', cardChoice());
    const replay = eventCardChoiceV3(state, node, SOURCE, 'take_power', cardChoice());

    expect(replay).toStrictEqual(first);
    expect(first.options).toHaveLength(3);
    expect(new Set(first.options.map((option) => option.skillId)).size).toBe(3);
    for (const option of first.options) {
      expect(Object.keys(option).sort()).toEqual(['skillId', 'tier']);
      expect(cardOfferableAtTier(skillBook[option.skillId]!, option.tier)).toBe(true);
    }
    expect(state.eventBag).toEqual([]);
    expect(state.eventThemeBags).toEqual({});
  });

  it('isolates map-seed, node-id, and choice-id domains', () => {
    const signatures = new Set([
      eventCardChoiceV3(activeRun(11), { id: 'a', depth: 9 }, SOURCE, 'choice', cardChoice()),
      eventCardChoiceV3(activeRun(12), { id: 'a', depth: 9 }, SOURCE, 'choice', cardChoice()),
      eventCardChoiceV3(activeRun(11), { id: 'b', depth: 9 }, SOURCE, 'choice', cardChoice()),
      eventCardChoiceV3(activeRun(11), { id: 'a', depth: 9 }, SOURCE, 'other', cardChoice()),
    ].map((offer) => JSON.stringify(offer)));
    expect(signatures.size).toBe(4);
  });

  it('maps all four hash bands, including every boundary, independently by display slot', () => {
    addProbePool('__event_band', ['bronze', 'bronze', 'bronze']);
    const wanted = new Set([0, 54, 55, 81, 82, 95, 96, 99]);
    const observed = new Map<number, SkillTier>();
    for (let seed = 0; seed < 100_000 && observed.size < wanted.size; seed += 1) {
      const state = activeRun(seed);
      const offer = eventCardChoiceV3(
        state, { id: 'band-node', depth: 9 }, SOURCE, 'band-choice',
        cardChoice('diamond', PROBE_FILTER),
      );
      offer.options.forEach((option, optionIndex) => {
        const roll = hashSeed(
          state.map.seed, 'event-offer-tier', 'band-node', 'band-choice', option.skillId, optionIndex,
        ) % 100;
        if (wanted.has(roll)) observed.set(roll, option.tier);
      });
    }
    expect([...observed.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 'bronze'], [54, 'bronze'], [55, 'silver'], [81, 'silver'],
      [82, 'gold'], [95, 'gold'], [96, 'diamond'], [99, 'diamond'],
    ]);
  });

  it('clamps to real card minimum, authored maximum, and ordinary depth maximum', () => {
    const probes = [
      addProbe('__event_min_gold_0', 'gold'),
      addProbe('__event_min_gold_1', 'bronze', 'gold'),
      addProbe('__event_min_bronze', 'bronze'),
    ];
    const authored = eventCardChoiceV3(
      activeRun(81), { id: 'authored', depth: 99 }, SOURCE, 'pick',
      cardChoice('gold', PROBE_FILTER),
    );
    expect(authored.options.every((option) => TIER_ORDER.indexOf(option.tier) <= 2)).toBe(true);
    for (const option of authored.options) {
      const minimum = minOfferableTier(skillBook[option.skillId]!)!;
      expect(TIER_ORDER.indexOf(option.tier)).toBeGreaterThanOrEqual(TIER_ORDER.indexOf(minimum));
    }

    addProbe('__event_min_bronze_2', 'bronze');
    addProbe('__event_min_bronze_3', 'bronze');
    const depth = eventCardChoiceV3(
      activeRun(82), { id: 'depth', depth: 1 }, SOURCE, 'pick',
      cardChoice('diamond', PROBE_FILTER),
    );
    expect(depth.options.every((option) => option.tier === 'bronze' || option.tier === 'silver')).toBe(true);
    expect(probes.map((probe) => minOfferableTier(probe))).toEqual(['gold', 'gold', 'bronze']);
  });

  it('throws instead of widening when fewer than three filtered cards are deliverable', () => {
    addProbe('__event_thin_0', 'bronze');
    addProbe('__event_thin_1', 'bronze');
    expect(() => eventCardChoiceV3(
      activeRun(), { id: 'thin', depth: 9 }, SOURCE, 'pick',
      cardChoice('diamond', PROBE_FILTER),
    )).toThrow(/only 2 card\(s\).*3/);

    addProbe('__event_too_high', 'diamond');
    expect(() => eventCardChoiceV3(
      activeRun(), { id: 'thin-depth', depth: 1 }, SOURCE, 'pick',
      cardChoice('diamond', PROBE_FILTER),
    )).toThrow(/fewer than.*3|only 2 card/);
  });

  it('counts distinct skill IDs rather than duplicate book entries when enforcing width', () => {
    const first = addProbe('__event_duplicate_0', 'bronze');
    addProbe('__event_duplicate_1', 'bronze');
    skillBook.__event_duplicate_alias = { ...first };
    ADDED_SKILLS.push('__event_duplicate_alias');

    expect(() => eventCardChoiceV3(
      activeRun(), { id: 'duplicate-book-entry', depth: 9 }, SOURCE, 'pick',
      cardChoice('diamond', PROBE_FILTER),
    )).toThrow(/only 2 card\(s\).*3/);
  });

  it('lets an authorized Secret capstone lift only depth and rejects every malformed capstone before drawing', () => {
    addProbePool('__event_capstone', ['diamond', 'diamond', 'diamond']);
    const validSource: EventRewardSourceV3 = {
      eventId: 'secret_capstone', rarity: 'secret', story: { stage: 'capstone', role: 'capstone' },
    };
    const validSpec = { ...cardChoice('diamond', PROBE_FILTER), capstone: true as const };
    const offer = eventCardChoiceV3(activeRun(), { id: 'cap', depth: 1 }, validSource, 'claim', validSpec);
    expect(offer.options.map((option) => option.tier)).toEqual(['diamond', 'diamond', 'diamond']);

    const invalidSources: EventRewardSourceV3[] = [
      { ...validSource, rarity: 'rare' },
      { ...validSource, story: { stage: 'payoff', role: 'capstone' } },
      { ...validSource, story: { stage: 'capstone', role: 'payoff' } },
    ];
    for (const source of invalidSources) {
      expect(() => eventCardChoiceV3(activeRun(), { id: 'cap', depth: 9 }, source, 'claim', validSpec))
        .toThrow(/capstone/i);
    }
    expect(() => eventCardChoiceV3(
      activeRun(), { id: 'cap', depth: 9 }, validSource, 'claim',
      { ...cardChoice('gold', PROBE_FILTER), capstone: true },
    )).toThrow(/diamond/i);
  });
});

describe('run/eventV3Rewards: card-choice settlement', () => {
  const offer = pendingCardOffer([
    { skillId: 'sword_slash', tier: 'gold' },
    { skillId: 'armor_break', tier: 'silver' },
    { skillId: 'cinder_dart', tier: 'bronze' },
  ]);

  it('inserts the exact persisted tier and settles with the allocated instance id', () => {
    const input = activeRun(1, { nextCardInstanceId: 7 });
    const result = settleEventCardChoiceV3(input, offer, 'sword_slash');
    expect(result).toMatchObject({
      ok: true,
      offer: { status: 'settled', selectedSkillId: 'sword_slash' },
      outcome: { kind: 'cardGranted', skillId: 'sword_slash', tier: 'gold', instanceId: 'card_007' },
    });
    expect(result.state.bagSlots[0]).toEqual({ instanceId: 'card_007', skillId: 'sword_slash', tier: 'gold' });
  });

  it('preserves a valid persisted tier after the current catalog minimum moves upward', () => {
    const original = skillBook.sword_slash!;
    const persisted = pendingCardOffer([
      { skillId: 'sword_slash', tier: 'bronze' },
      { skillId: 'armor_break', tier: 'silver' },
      { skillId: 'cinder_dart', tier: 'gold' },
    ]);
    skillBook.sword_slash = {
      ...original,
      effects: original.effects.map((effect) => ({ ...effect, minTier: 'gold' as const })),
    };
    try {
      expect(minOfferableTier(skillBook.sword_slash!)).toBe('gold');
      const result = settleEventCardChoiceV3(activeRun(1), persisted, 'sword_slash');
      expect(result).toMatchObject({
        ok: true,
        offer: { status: 'settled', selectedSkillId: 'sword_slash' },
        outcome: { kind: 'cardGranted', skillId: 'sword_slash', tier: 'bronze' },
      });
      expect(result.state.bagSlots[0]).toMatchObject({ skillId: 'sword_slash', tier: 'bronze' });
      expect(persisted.options[0]).toEqual({ skillId: 'sword_slash', tier: 'bronze' });
    } finally {
      skillBook.sword_slash = original;
    }
  });

  it.each([
    ['unknown skill', pendingCardOffer([
      { skillId: 'fabricated_missing_skill', tier: 'diamond' },
      { skillId: 'armor_break', tier: 'silver' },
      { skillId: 'cinder_dart', tier: 'bronze' },
    ])],
    ['duplicate skills', pendingCardOffer([
      { skillId: 'sword_slash', tier: 'bronze' },
      { skillId: 'sword_slash', tier: 'silver' },
      { skillId: 'cinder_dart', tier: 'gold' },
    ])],
    ['invalid tier', pendingCardOffer([
      { skillId: 'sword_slash', tier: 'mythic' as SkillTier },
      { skillId: 'armor_break', tier: 'silver' },
      { skillId: 'cinder_dart', tier: 'gold' },
    ])],
    ['invalid tuple length', {
      kind: 'cardChoice', status: 'pending',
      options: [
        { skillId: 'sword_slash', tier: 'bronze' },
        { skillId: 'armor_break', tier: 'silver' },
      ],
    } as unknown as Extract<EventDeferredOfferV3, { kind: 'cardChoice'; status: 'pending' }>],
  ] as const)('fails closed before mutating state for a persisted offer with %s', (_name, malformed) => {
    const input = activeRun(1, { nextCardInstanceId: 19, gold: 7 });
    const before = JSON.stringify(input);
    expect(() => settleEventCardChoiceV3(input, malformed, malformed.options[0].skillId)).toThrow(/offer/i);
    expect(JSON.stringify(input)).toBe(before);
    expect(input.nextCardInstanceId).toBe(19);
    expect(input.bagSlots).toEqual([]);
  });

  it('keeps the persisted-event insertion seam closed to an invalid runtime tier', () => {
    const input = activeRun(1, { nextCardInstanceId: 23 });
    expect(() => tryInsertPersistedEventRunCard(input, 'sword_slash', 'mythic' as SkillTier))
      .toThrow(/invalid persisted card/i);
    expect(input.nextCardInstanceId).toBe(23);
    expect(input.bagSlots).toEqual([]);
  });

  it('rejects an unoffered card with identical state and offer references', () => {
    const input = activeRun();
    const result = settleEventCardChoiceV3(input, offer, 'fireball');
    expect(result).toEqual({ ok: false, state: input, offer, reason: 'unoffered-card' });
    expect(result.state).toBe(input);
    expect(result.offer).toBe(offer);
  });

  it('pays the exact full-bag fallback to both gold authorities once', () => {
    const full = Array.from({ length: 10 }, (_, index): RunCard => ({
      instanceId: `full-${String(index)}`, skillId: 'sword_slash', tier: 'bronze',
    }));
    const input = activeRun(1, { bagSlots: full, gold: 5 });
    const first = settleEventCardChoiceV3(input, offer, 'armor_break');
    expect(EVENT_CARD_FALLBACK_GOLD).toBe(2);
    expect(first).toMatchObject({
      ok: true,
      state: { gold: 7, stats: { goldEarned: 2 } },
      outcome: { kind: 'grantGold', amount: 2, fellBack: true },
      offer: { status: 'settled', selectedSkillId: 'armor_break' },
    });
    if (!first.ok || first.offer.kind !== 'cardChoice') throw new Error('fixture must settle');
    const replay = settleEventCardChoiceV3(first.state, first.offer, 'armor_break');
    expect(replay).toEqual({ ok: true, state: first.state, offer: first.offer, outcome: { kind: 'alreadySettled' } });
    expect(replay.state).toBe(first.state);
    expect(replay.offer).toBe(first.offer);
  });
});

describe('run/eventEligibilityV3: shared exact owned-card matcher', () => {
  it('ANDs fields on one instance, ORs members, de-duplicates, and orders board slots then bag then held', () => {
    const state = activeRun(1, {
      pieces: [
        { instanceId: 'board-8', skillId: 'sword_slash', tier: 'silver', slot: 8 },
        { instanceId: 'board-2', skillId: 'armor_break', tier: 'bronze', slot: 2 },
      ],
      bagSlots: [
        { instanceId: 'board-2', skillId: 'armor_break', tier: 'bronze' },
        null,
        { instanceId: 'bag-2', skillId: 'cinder_dart', tier: 'gold' },
      ],
      held: { instanceId: 'held', skillId: 'fireball', tier: 'bronze' },
    });
    expect(ownedCardsMatchingV3(state, 'any', {} as never).map((card) => card.instanceId))
      .toEqual(['board-2', 'board-8', 'bag-2', 'held']);
    expect(ownedCardsMatchingV3(state, 'any', {
      cardIds: ['sword_slash', 'armor_break'], weapons: ['sword', 'axe'], archetypes: ['offense', 'debuff'],
    }).map((card) => card.instanceId)).toEqual(['board-2', 'board-8']);
    expect(ownedCardsMatchingV3(state, 'any', { cardIds: ['sword_slash'], elements: ['fire'] })).toEqual([]);
    expect(ownedCardsMatchingV3(state, 'bag', {}).map((card) => card.instanceId)).toEqual(['board-2', 'bag-2']);
  });
});

describe('run/eventV3Rewards: inert targeted upgrade materialization', () => {
  const filterSpec = (where: 'board' | 'bag' | 'held' | 'any' = 'any') => ({
    kind: 'upgradeCardTargeted' as const,
    target: { filter: { where, match: { cardIds: ['sword_slash'] } } },
    fallback: { kind: 'grantGold' as const, amount: 3 },
  });

  it('snapshots zero, one, and many exact targets without mutating or paying an unchosen reward', () => {
    const states = [
      activeRun(1, { gold: 4 }),
      activeRun(1, { gold: 4, pieces: [{ instanceId: 'one', skillId: 'sword_slash', tier: 'bronze', slot: 0 }] }),
      activeRun(1, {
        gold: 4,
        pieces: [{ instanceId: 'later-slot', skillId: 'sword_slash', tier: 'silver', slot: 8 }],
        bagSlots: [{ instanceId: 'bag-first', skillId: 'sword_slash', tier: 'gold' }],
        held: { instanceId: 'held-last', skillId: 'sword_slash', tier: 'bronze' },
      }),
    ];
    const before = states.map((state) => JSON.stringify(state));
    const offers = states.map((state) => targetedUpgradeV3(state, filterSpec(), {}));
    expect(offers.map((entry) => entry.optionInstanceIds)).toEqual([
      [], ['one'], ['later-slot', 'bag-first', 'held-last'],
    ]);
    expect(offers.every((entry) => entry.status === 'pending')).toBe(true);
    expect(states.map((state) => JSON.stringify(state))).toEqual(before);
    expect(states.map((state) => state.gold)).toEqual([4, 4, 4]);
    expect(JSON.parse(JSON.stringify(offers[2]))).toEqual(offers[2]);
  });

  it('interprets revenge, signature, and typed mono bindings and excludes Diamond', () => {
    const state = activeRun(1, {
      pieces: [
        { instanceId: 'sword', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
        { instanceId: 'diamond', skillId: 'sword_slash', tier: 'diamond', slot: 1 },
      ],
      bagSlots: [{ instanceId: 'axe', skillId: 'armor_break', tier: 'silver' }],
    });
    const bound: EventBoundSubjectsV3 = {
      revenge_finisher_card_id: 'sword_slash', signature_card_id: 'armor_break',
      mono_type: { typeKind: 'weapon', type: 'sword' },
    };
    const bySlot = (slot: 'revenge_finisher_card_id' | 'signature_card_id') => ({
      kind: 'upgradeCardTargeted' as const, target: { boundSubject: { slot } },
      fallback: { kind: 'nothing' as const },
    });
    expect(targetedUpgradeV3(state, bySlot('revenge_finisher_card_id'), bound).optionInstanceIds).toEqual(['sword']);
    expect(targetedUpgradeV3(state, bySlot('signature_card_id'), bound).optionInstanceIds).toEqual(['axe']);
    expect(targetedUpgradeV3(state, {
      kind: 'upgradeCardTargeted',
      target: { boundSubject: { slot: 'mono_type', typeKind: 'weapon' } },
      fallback: { kind: 'nothing' },
    }, bound).optionInstanceIds).toEqual(['sword']);
    expect(targetedUpgradeV3(state, {
      kind: 'upgradeCardTargeted',
      target: { boundSubject: { slot: 'mono_type', typeKind: 'element' } },
      fallback: { kind: 'nothing' },
    }, bound).optionInstanceIds).toEqual([]);

    const elemental = activeRun(1, {
      pieces: [{ instanceId: 'fire', skillId: 'cinder_dart', tier: 'bronze', slot: 0 }],
    });
    expect(targetedUpgradeV3(elemental, {
      kind: 'upgradeCardTargeted',
      target: { boundSubject: { slot: 'mono_type', typeKind: 'element' } },
      fallback: { kind: 'nothing' },
    }, { mono_type: { typeKind: 'element', type: 'fire' } }).optionInstanceIds).toEqual(['fire']);
    expect(targetedUpgradeV3(state, bySlot('signature_card_id'), {}).optionInstanceIds).toEqual([]);
  });
});

describe('run/eventV3Rewards: targeted upgrade settlement', () => {
  it('applies a zero-target persisted fallback only when settlement is invoked', () => {
    const input = activeRun(1, { gold: 4 });
    const offer = pendingUpgrade([], { kind: 'grantGold', amount: 3 });
    const first = settleTargetedUpgradeV3(input, offer);
    expect(first).toMatchObject({
      state: { gold: 7, stats: { goldEarned: 3 } },
      offer: { status: 'settled' },
      outcome: { kind: 'grantGold', amount: 3, fellBack: true },
    });
    expect(first.offer).not.toHaveProperty('selectedInstanceId');
    const replay = settleTargetedUpgradeV3(first.state, first.offer);
    expect(replay).toEqual({ state: first.state, offer: first.offer, outcome: { kind: 'alreadySettled' } });
    expect(replay.state).toBe(first.state);
    expect(replay.offer).toBe(first.offer);
  });

  it.each([
    ['board', { pieces: [{ instanceId: 'target', skillId: 'sword_slash', tier: 'bronze' as const, slot: 0 }] }, 'silver'],
    ['bag', { bagSlots: [{ instanceId: 'target', skillId: 'armor_break', tier: 'silver' as const }] }, 'gold'],
    ['held', { held: { instanceId: 'target', skillId: 'fireball', tier: 'gold' as const } }, 'diamond'],
  ] as const)('auto-upgrades one exact %s target by one rung', (_location, owned, to) => {
    const input = activeRun(1, owned as Partial<RunState>);
    const result = settleTargetedUpgradeV3(input, pendingUpgrade(['target']));
    expect(result.offer).toMatchObject({ status: 'settled', selectedInstanceId: 'target' });
    expect(result.outcome).toMatchObject({ kind: 'cardUpgraded', instanceId: 'target', to });
    expect(ownedCardsMatchingV3(result.state, 'any', {}).find((card) => card.instanceId === 'target')?.tier).toBe(to);
  });

  it('leaves a multi-target offer pending until an exact selection is supplied', () => {
    const input = activeRun(1, {
      pieces: [{ instanceId: 'first', skillId: 'sword_slash', tier: 'bronze', slot: 0 }],
      bagSlots: [{ instanceId: 'second', skillId: 'armor_break', tier: 'silver' }],
    });
    const offer = pendingUpgrade(['first', 'second']);
    const pending = settleTargetedUpgradeV3(input, offer);
    expect(pending).toEqual({ state: input, offer });
    expect(pending.state).toBe(input);
    expect(pending.offer).toBe(offer);

    const settled = settleTargetedUpgradeV3(input, offer, 'second');
    expect(settled.offer).toMatchObject({ status: 'settled', selectedInstanceId: 'second' });
    expect(settled.outcome).toMatchObject({
      kind: 'cardUpgraded', instanceId: 'second', skillId: 'armor_break', from: 'silver', to: 'gold',
    });
  });

  it.each(['fabricated', 'stale', 'diamond'] as const)('%s selection settles through persisted fallback once', (mode) => {
    const present = mode === 'stale' ? [] : [{ instanceId: 'target', skillId: 'sword_slash', tier: mode === 'diamond' ? 'diamond' as const : 'bronze' as const }];
    const input = activeRun(1, { bagSlots: present, gold: 2 });
    const offer = pendingUpgrade(['target'], { kind: 'grantGold', amount: 5 });
    const selected = mode === 'fabricated' ? 'not-offered' : 'target';
    const first = settleTargetedUpgradeV3(input, offer, selected);
    expect(first).toMatchObject({
      state: { gold: 7, stats: { goldEarned: 5 } },
      offer: { status: 'settled' },
      outcome: { kind: 'grantGold', amount: 5, fellBack: true },
    });
    const replay = settleTargetedUpgradeV3(first.state, first.offer, selected);
    expect(replay.outcome).toEqual({ kind: 'alreadySettled' });
    expect(replay.state).toBe(first.state);
  });

  it('settles a persisted nothing fallback without changing state values', () => {
    const input = activeRun();
    const result = settleTargetedUpgradeV3(input, pendingUpgrade([], { kind: 'nothing' }));
    expect(result.state).toBe(input);
    expect(result.outcome).toEqual({ kind: 'nothing', fellBack: true });
  });
});

describe('run/eventV3Rewards: isolation from the Bronze start draft', () => {
  it('keeps the established seed-42 starting hand byte-identical and Bronze-only', () => {
    const draft = rollStartDraft(42);
    expect(JSON.stringify(draft)).toBe('{"offense":[{"skillId":"thermal_shock","tier":"bronze"},{"skillId":"massed_volley","tier":"bronze"},{"skillId":"lance_thrust","tier":"bronze"},{"skillId":"crippling_gore","tier":"bronze"},{"skillId":"warband_cleave","tier":"bronze"}],"defense":[{"skillId":"overgrowth","tier":"bronze"},{"skillId":"warding_prayer","tier":"bronze"},{"skillId":"bulwark_of_the_line","tier":"bronze"},{"skillId":"steady_draw","tier":"bronze"},{"skillId":"toxic_bulwark","tier":"bronze"}],"support":[{"skillId":"frostbind_litany","tier":"bronze"},{"skillId":"overcharge","tier":"bronze"},{"skillId":"stormrank_relay","tier":"bronze"},{"skillId":"rustbind_hex","tier":"bronze"},{"skillId":"concussive_shot","tier":"bronze"}],"wildcard":[{"skillId":"blooming_vine","tier":"bronze"},{"skillId":"disarming_blow","tier":"bronze"},{"skillId":"hamstring","tier":"bronze"},{"skillId":"cinder_dart","tier":"bronze"},{"skillId":"cornered_beast","tier":"bronze"}]}');
    expect(Object.values(draft).flat().every((card) => card.tier === 'bronze')).toBe(true);
  });

  it('does not import or reuse start-draft APIs or DTO names', () => {
    const source = readFileSync(new URL('../../src/run/eventV3Rewards.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]\.\/draft(?:\.ts)?['"]/);
    expect(source).not.toMatch(/\b(?:DraftCard|StartDraft|rollStartDraft|DRAFT_SET_KEYS)\b/);
  });
});
