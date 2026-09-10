import { describe, expect, it } from 'vitest';
import { isEventDefV2 } from '../../src/data/eventContentV2';
import { loadEventContent, requireLegacyEventContent } from '../../src/data/eventsContent';
import { validateEventDocument } from '../../src/data/validateEventContent';
import { resolveEventOutcomeSpec } from '../../src/run/events';
import { createRun, type RunNode } from '../../src/run/runState';

type JsonRecord = Record<string, unknown>;

const paths = (document: unknown): string[] =>
  validateEventDocument(document).map((problem) => problem.where);

const clone = <T>(value: T): T => structuredClone(value);

const definitionAt = (document: JsonRecord, eventIndex: number): JsonRecord =>
  ((document.events as JsonRecord[])[eventIndex]!.versions as JsonRecord[])[0]!.def as JsonRecord;

const callbackOfProbe = (document: JsonRecord): JsonRecord =>
  (definitionAt(document, 0).choices as JsonRecord[])[0]!.callback as JsonRecord;

function probeDocument(): JsonRecord {
  return {
    schemaVersion: 2,
    storyStateSchema: {},
    events: [
      { id: 'probe', versions: [{ version: 1, def: {
        title: 'Probe', body: 'Copy.', theme: 'cache', rarity: 'uncommon', biomeIds: ['arrowfell'],
        story: { storyId: 'probe', stage: 'setup', role: 'setup' },
        eligibility: { any: [
          { fact: 'board.affinity', args: { affinityId: 'bow' } },
          { fact: 'owned.card.count', args: { where: 'any', count: 3, match: { weapons: ['bow'] } } },
        ] }, delivery: { kind: 'ambient' }, visibility: 'visible', priority: 200,
        once: 'run', cooldownNodes: 0,
        choices: [
          { id: 'read', label: 'Read', cost: 0, outcome: { kind: 'grantMapInfo', bandsAhead: 2 },
            callback: { callbackId: 'probe_callback', eventId: 'probe_callback', contentVersion: 1,
              minDepthDelay: 2, destinationThemes: ['omen'], destinationBiomeIds: ['arrowfell'],
              priority: 700, bind: [], expiry: { expiresAfterNodes: 20, fallback: 'discard' } } },
          { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'grantGold', amount: 1 } },
        ],
      } }] },
      { id: 'probe_callback', versions: [{ version: 1, def: {
        title: 'Probe callback', body: 'Copy.', theme: 'omen', rarity: 'uncommon',
        biomeIds: ['arrowfell'], story: { storyId: 'probe', stage: 'callback', role: 'callback' },
        eligibility: { fact: 'callback.queued', args: { callbackId: 'probe_callback' } },
        delivery: { kind: 'queued_callback' }, visibility: 'teased_when_due', priority: 700,
        once: 'run', cooldownNodes: 0,
        choices: [
          { id: 'finish', label: 'Finish', cost: 0, outcome: { kind: 'grantGold', amount: 1 }, mutations: [{ op: 'completeStory', storyId: 'probe' }] },
          { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' }, mutations: [{ op: 'completeStory', storyId: 'probe' }] },
        ],
      } }] },
    ],
  };
}

describe('data: event content v2', () => {
  it('accepts the literal probe and projects every version without presentation semantics', () => {
    const document = probeDocument();

    expect(validateEventDocument(document)).toEqual([]);
    const loaded = requireLegacyEventContent(loadEventContent(document));
    expect(loaded.catalog.probe!.choices[1]!.outcome).toEqual({ kind: 'grantGold', amount: 1 });
    expect(loaded.versions.probe![1]).toBe(loaded.eventDefAtVersion('probe', 1));
    expect(loaded.eventDefAtVersion('probe', 1)?.id).toBe('probe');
    expect(loaded.eventDefAtVersion('probe_callback', 2)).toBeUndefined();
    expect(isEventDefV2(loaded.catalog.probe!)).toBe(true);
    if (isEventDefV2(loaded.catalog.probe!)) expect(loaded.catalog.probe!.delivery.kind).toBe('ambient');
    expect(isEventDefV2(loaded.catalog.probe_callback!)).toBe(true);
  });

  it.each([
    ['uppercase rarity', (document: JsonRecord) => { ((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def = { ...(((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord), rarity: 'UNCOMMON' }; }],
    ['uppercase tier', (document: JsonRecord) => { (((((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).choices as JsonRecord[])[0]!.outcome as JsonRecord).tier = 'BRONZE'; }],
    ['legacy callback delay alias', (document: JsonRecord) => { (((((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).choices as JsonRecord[])[0]!.callback as JsonRecord).delay = 2; }],
    ['legacy callback destination alias', (document: JsonRecord) => { (((((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).choices as JsonRecord[])[0]!.callback as JsonRecord).destination = 'omen'; }],
    ['callback inside mutations', (document: JsonRecord) => { (((((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).choices as JsonRecord[])[0]!.mutations = [{ op: 'completeStory', storyId: 'probe', callback: {} }]); }],
    ['unknown fact', (document: JsonRecord) => { (((((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).eligibility as JsonRecord).any as JsonRecord[])[0]!.fact = 'wallet.current'; }],
    ['unknown v2 field', (document: JsonRecord) => { (((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).surprise = true; }],
    ['dangling callback event and version', (document: JsonRecord) => { const callback = (((((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).choices as JsonRecord[])[0]!.callback as JsonRecord); callback.eventId = 'missing_callback'; callback.contentVersion = 2; }],
    ['more than three choices', (document: JsonRecord) => { const def = ((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord; def.choices = [...(def.choices as JsonRecord[]), { id: 'more', label: 'More', cost: 0, outcome: { kind: 'nothing' } }, { id: 'still_more', label: 'Still more', cost: 0, outcome: { kind: 'nothing' } }]; }],
    ['paid and gated-only exits', (document: JsonRecord) => { const choices = (((document.events as JsonRecord[])[0]!.versions as JsonRecord[])[0]!.def as JsonRecord).choices as JsonRecord[]; choices[0]!.cost = 1; choices[1]!.requires = { eventId: 'probe' }; }],
  ])('rejects %s', (_name, mutate) => {
    const document = clone(probeDocument());
    mutate(document);
    expect(paths(document)).not.toEqual([]);
  });

  it.each([
    ['a legacy event version', (document: JsonRecord) => {
      definitionAt(document, 1).title = 'Legacy callback';
      definitionAt(document, 1).body = 'Copy.';
      definitionAt(document, 1).theme = 'omen';
      definitionAt(document, 1).choices = [
        { id: 'take', label: 'Take', outcome: { kind: 'grantGold', amount: 1 } },
        { id: 'leave', label: 'Leave', outcome: { kind: 'nothing' } },
      ];
      for (const key of ['rarity', 'biomeIds', 'story', 'eligibility', 'delivery', 'visibility', 'priority', 'once', 'cooldownNodes']) {
        delete definitionAt(document, 1)[key];
      }
    }],
    ['a v2 ambient event', (document: JsonRecord) => { (definitionAt(document, 1).delivery as JsonRecord).kind = 'ambient'; }],
    ['a queued callback with non-exact callback eligibility', (document: JsonRecord) => {
      definitionAt(document, 1).eligibility = { any: [{ fact: 'callback.queued', args: { callbackId: 'probe_callback' } }] };
    }],
  ])('rejects a callback target that is %s', (_name, mutate) => {
    const document = clone(probeDocument());
    mutate(document);
    expect(paths(document)).toContain('probe@v1.choices[0].callback.eventId');
  });

  it('requires a committed source event instance for a typed map-info reward', () => {
    const node: RunNode = { id: 'v2-probe', depth: 1, wave: 1, kind: 'event', eventSeed: 1, eventTheme: 'cache' };

    expect(() => resolveEventOutcomeSpec(
      createRun(1103), node, 'read', { kind: 'grantMapInfo', bandsAhead: 2 },
    )).toThrow('grantMapInfo requires a committed source event instance');
  });
});
