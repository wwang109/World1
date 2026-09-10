import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import { eventDefAtVersion } from '../../src/data/eventsContent';
import { buildEnemyEncounter, type EncounterPack } from '../../src/run/encounter';
import { DRAFT_SET_KEYS } from '../../src/run/draft';
import { createRun, type RunNode, type RunState } from '../../src/run/runState';
import {
  buildRunTravelChoiceViewModel,
  encounterHintDetail,
  FIGHT_TIER_LABEL,
} from '../../src/game/ui/runTravelChoiceViewModel';

const eventNode: RunNode = { id: 'event-preview', kind: 'event', depth: 3, wave: 2, eventTheme: 'omen' };

function solo(title: 'normal' | 'elite' | 'boss' = 'normal', affix: string | null = null): EncounterPack {
  return { variant: 'solo', units: [buildEnemyEncounter('bandit_duelist', 6, title, undefined, [], affix)] };
}

function bellRun(): RunState {
  return {
    ...createRun(404),
    eventResolutions: {
      ice: { eventId: 'bell_beneath_ice', choiceId: 'prise_it_free', contentVersion: 1, instanceId: 'ice' },
    },
  };
}

describe('buildRunTravelChoiceViewModel', () => {
  it('keeps a thin shop catalog title, tagline, actual shelf footer and storefront art', () => {
    const node: RunNode = { id: 'shop', kind: 'shop', depth: 1, wave: 1, shopId: 'stormspire' };
    expect(buildRunTravelChoiceViewModel(createRun(404), node, eventCatalog.the_second_toll!, solo())).toEqual({
      nodeId: 'shop', kind: 'shop', title: 'SHOP · STORMSPIRE',
      detail: 'Thunder, sold by the bolt.', footer: '6 CARDS · 1 GEMS',
      artKey: 'run-art-shop-stormspire', accent: 0x7cab63, enabled: true,
    });
  });

  it.each([
    ['easy', 'EASY'], ['standard', 'MEDIUM'], ['hard', 'HARD'],
  ] as const)('keeps the %s fight tier and encounter detail without event art or metadata', (fightOption, label) => {
    const node: RunNode = { id: fightOption, kind: 'fight', depth: 3, wave: 1, fightOption };
    expect(buildRunTravelChoiceViewModel(createRun(404), node, eventCatalog.the_second_toll!, solo())).toEqual({
      nodeId: fightOption, kind: 'fight', title: `FIGHT · ${label}`,
      detail: `${label} · Bandit Duelist · LV 6 · NORMAL`, accent: 0x4a7ab5, enabled: true,
    });
  });

  it('keeps the previewed elite affix footer and its alarm ink', () => {
    const node: RunNode = { id: 'elite', kind: 'fight', depth: 9, wave: 3, fightOption: 'hard' };
    expect(buildRunTravelChoiceViewModel(createRun(404), node, null, solo('elite', 'braced'))).toEqual({
      nodeId: 'elite', kind: 'fight', title: 'FIGHT · HARD',
      detail: 'HARD · Bandit Duelist · LV 8 · ELITE', footer: 'AFFIX · BRACED', footerInk: 'alarm',
      accent: 0x4a7ab5, enabled: true,
    });
  });

  it('keeps pack count grammar and does not invent a solo title or event', () => {
    const unit = buildEnemyEncounter('bandit_duelist', 6);
    const pack: EncounterPack = { variant: 'pair', units: [unit, structuredClone(unit)] };
    const node: RunNode = { id: 'pack', kind: 'fight', depth: 9, wave: 3, fightOption: 'standard' };
    expect(buildRunTravelChoiceViewModel(createRun(404), node, null, pack).detail)
      .toBe('MEDIUM · PACK OF 2 · Bandit Duelist · LV 6');
  });

  it('keeps a boss mandatory identity, detail and skull art', () => {
    const node: RunNode = { id: 'boss', kind: 'boss', depth: 15, wave: 5 };
    expect(buildRunTravelChoiceViewModel(createRun(404), node, eventCatalog.the_second_toll!, solo('boss'))).toEqual({
      nodeId: 'boss', kind: 'boss', title: 'BOSS', detail: 'Bandit Duelist · LV 10 · BOSS',
      artKey: 'run-art-icon-boss-skull', accent: 0xc36a57, enabled: true,
    });
  });

  it.each(['fight', 'boss'] as const)('keeps a missing %s encounter defensively blank', (kind) => {
    const node: RunNode = { id: kind, kind, depth: 3, wave: 1 };
    const model = buildRunTravelChoiceViewModel(createRun(404), node, null, null);
    expect(model.title).toBe(kind.toUpperCase());
    expect(model.detail).toBe('');
    expect(model.footer).toBeUndefined();
  });

  it('previews an ordinary event identity with theme art and no earned receipt', () => {
    const node = { ...eventNode, eventTheme: 'cache' as const };
    expect(buildRunTravelChoiceViewModel(createRun(404), node, eventCatalog.abandoned_cache!, solo())).toEqual({
      nodeId: node.id, kind: 'event', title: 'EVENT · ABANDONED CACHE',
      detail: 'The Silt Hollows — dig for a card or gem.', artKey: 'run-art-event-cache',
      accent: 0xc69948, enabled: true,
      event: { eventId: 'abandoned_cache', chainUnlocked: false, requirementLines: [] },
    });
  });

  it('uses the exact chained story identity and earned lines while keeping the current node blurb', () => {
    const node = { ...eventNode, eventTheme: 'cache' as const };
    expect(buildRunTravelChoiceViewModel(bellRun(), node, eventCatalog.the_second_toll!, null)).toEqual({
      nodeId: node.id, kind: 'event', title: 'EVENT · THE SECOND TOLL',
      detail: 'The Silt Hollows — dig for a card or gem.', artKey: 'run-art-event-story-second-toll',
      accent: 0xc69948, enabled: true,
      event: {
        eventId: 'the_second_toll', chainUnlocked: true,
        requirementLines: ['Completed: The Bell Beneath the Ice — Prise the frost bell free'],
      },
    });
  });

  it('does not infer chain unlock from a gate when no earned receipt exists', () => {
    expect(buildRunTravelChoiceViewModel(createRun(404), eventNode, eventCatalog.the_second_toll!, null).event)
      .toEqual({ eventId: 'the_second_toll', chainUnlocked: false, requirementLines: [] });
  });

  it('uses a preview theme for art fallback even when its destination theme differs', () => {
    const model = buildRunTravelChoiceViewModel(createRun(404), eventNode, eventCatalog.abandoned_cache!, null);
    expect(model.artKey).toBe('run-art-event-cache');
    expect(model.detail).toBe('The Crossroads Unquiet — the biggest gambles.');
  });

  it('retains theme title, blurb and art without preview metadata', () => {
    expect(buildRunTravelChoiceViewModel(createRun(404), eventNode, null, null)).toEqual({
      nodeId: eventNode.id, kind: 'event', title: 'EVENT · OMEN',
      detail: 'The Crossroads Unquiet — the biggest gambles.', artKey: 'run-art-event-omen',
      accent: 0xc69948, enabled: true,
    });
  });

  it('retains the unthemed event defensive fallback', () => {
    expect(buildRunTravelChoiceViewModel(createRun(404), { ...eventNode, eventTheme: undefined }, null, null)).toEqual({
      nodeId: eventNode.id, kind: 'event', title: 'EVENT', detail: 'Text encounter — 2-3 choices.',
      artKey: 'run-art-event-training', accent: 0xc69948, enabled: true,
    });
  });

  it.each(['event', 'shop', 'fight', 'boss'] as const)('does not mutate any inputs while composing a %s choice', (kind) => {
    const input = { state: bellRun(), node: { ...eventNode, kind, shopId: 'stormspire' }, preview: structuredClone(eventCatalog.the_second_toll!), encounter: solo('elite', 'braced') };
    const before = structuredClone(input);
    buildRunTravelChoiceViewModel(input.state, input.node, input.preview, input.encounter);
    expect(input).toEqual(before);
  });
});

describe('runStore travel preview seam', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  async function freshStore() {
    const cells = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { cells.set(key, value); });
    vi.stubGlobal('window', {
      location: { search: '?ui=desktop' },
      localStorage: { getItem: (key: string) => cells.get(key) ?? null, setItem },
    });
    vi.resetModules();
    return { store: await import('../../src/game/runStore'), cells, setItem };
  }

  it('returns null without an active run and never persists a preview', async () => {
    const { store, setItem } = await freshStore();
    expect(store.previewRunEvent(eventNode)).toBeNull();
    expect(store.getActiveRun()).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('preserves active object and saved bytes, then commits precisely the previewed event', async () => {
    const { store, cells, setItem } = await freshStore();
    store.startRun(1103);
    const hand = store.currentStartDraftHand()!;
    for (const key of DRAFT_SET_KEYS) store.pickCurrentStartDraftCard(key, hand[key][0]!.skillId);
    store.applyRunDraft();
    const node = store.choices().find((choice) => choice.kind === 'event')!;
    expect(node).toBeDefined();
    const original = store.getActiveRun();
    const before = JSON.stringify(original);
    const saved = [...cells];
    setItem.mockClear();
    const preview = store.previewRunEvent(node);
    expect(preview).not.toBeNull();
    expect(store.previewRunEvent(node)).toBe(preview);
    for (const kind of ['shop', 'fight', 'boss'] as const) {
      expect(store.previewRunEvent({ ...node, kind })).toBeNull();
    }
    expect(store.getActiveRun()).toBe(original);
    expect(JSON.stringify(store.getActiveRun())).toBe(before);
    expect([...cells]).toEqual(saved);
    expect(setItem).not.toHaveBeenCalled();

    store.pickNode(node.id);
    store.currentRunEventViewModel();
    const committed = store.getActiveRun()!.eventInstances[node.id]!;
    expect(committed.eventId).toBe(preview!.id);
    expect(eventDefAtVersion(committed.eventId, committed.contentVersion)).toEqual(preview);
    expect(store.getActiveRun()).not.toBe(original);
    expect(setItem).toHaveBeenCalled();
  });

  it('preserves the existing store helper exports and solo, pack and unknown-name grammar', async () => {
    const { store } = await freshStore();
    expect(store.FIGHT_TIER_LABEL).toEqual(FIGHT_TIER_LABEL);
    const unit = solo().units[0]!;
    const cases: Array<[EncounterPack, 'easy' | 'standard' | 'hard' | undefined, string]> = [
      [solo(), undefined, 'Bandit Duelist · LV 6 · NORMAL'],
      [solo(), 'easy', 'EASY · Bandit Duelist · LV 6 · NORMAL'],
      [{ variant: 'pair', units: [unit, structuredClone(unit)] }, 'standard', 'MEDIUM · PACK OF 2 · Bandit Duelist · LV 6'],
      [{ variant: 'solo', units: [{ ...unit, enemyId: 'missing-enemy' }] }, 'hard', 'HARD · missing-enemy · LV 6 · NORMAL'],
    ];
    for (const [pack, tier, expected] of cases) {
      expect(store.encounterHintDetail(pack, tier)).toBe(expected);
      expect(encounterHintDetail(pack, tier)).toBe(expected);
    }
  });
});
