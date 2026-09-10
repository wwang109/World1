import { describe, expect, it } from 'vitest';
import {
  eventIdOfInstance,
  eventInstanceAt,
  hasDrawnEvent,
  recordEventInstance,
} from '../../src/run/eventInstances';
import { eventCatalog } from '../../src/data/events';
import { reopenEventChoice, resolveEventChoice, rollEventForNode } from '../../src/run/events';
import { ensureDepthThrough } from '../../src/run/runMap';
import { createRun } from '../../src/run/runState';

describe('run/eventInstances', () => {
  it('records and reads the exact factors_ledger versioned instance', () => {
    const record = {
      eventId: 'factors_ledger',
      contentVersion: 1,
      instanceId: 'legacy:d1-0',
      drawnDepth: 1,
    };

    const run = recordEventInstance(createRun(1103), 'd1-0', record);

    expect(eventInstanceAt(run, 'd1-0')).toEqual(record);
    expect(eventIdOfInstance(run, 'd1-0')).toBe('factors_ledger');
    expect(hasDrawnEvent(run, 'factors_ledger')).toBe(true);
  });

  it('does not report a different event as drawn', () => {
    const run = recordEventInstance(createRun(1103), 'd1-0', {
      eventId: 'factors_ledger',
      contentVersion: 1,
      instanceId: 'legacy:d1-0',
      drawnDepth: 1,
    });

    expect(eventInstanceAt(run, 'missing')).toBeUndefined();
    expect(eventIdOfInstance(run, 'missing')).toBeUndefined();
    expect(hasDrawnEvent(run, 'wandering_tutor')).toBe(false);
  });

  it('refuses a missing recorded content version before mutating a node draw', () => {
    const started = createRun(1103);
    const node = started.map.depths.flat().find((candidate) => candidate.kind === 'event');
    if (!node) throw new Error('fixture seed requires an event node');
    const run = recordEventInstance(started, node.id, {
      eventId: 'factors_ledger',
      contentVersion: 999,
      instanceId: `event:${node.id}`,
      drawnDepth: node.depth,
    });
    const before = structuredClone(run);

    expect(() => rollEventForNode(run, node)).toThrow(/missing recorded content factors_ledger@v999/);
    expect(run).toEqual(before);
  });

  it('refuses to resolve an uncommitted event node without fabricating current-version identity', () => {
    const base = createRun(1103);
    const node = base.map.depths.flat().find((candidate) => candidate.kind === 'event');
    if (!node) throw new Error('fixture seed requires an event node');
    const event = eventCatalog.factors_ledger!;
    const run = { ...base, currentNodeId: node.id };
    const before = structuredClone(run);

    expect(() => resolveEventChoice(run, event.id, event.choices[0]!.id)).toThrow(/no committed event instance/);
    expect(run).toEqual(before);
  });

  it.each([
    ['event id', { eventId: 'wandering_tutor' }],
    ['content version', { contentVersion: 2 }],
    ['instance id', { instanceId: 'event:replacement' }],
    ['drawn depth', { drawnDepth: 2 }],
    ['callback instance id', { callbackInstanceId: 'callback:replacement' }],
  ])('refuses to replace a committed record with a different %s', (_label, change) => {
    const record = {
      eventId: 'factors_ledger',
      contentVersion: 1,
      instanceId: 'event:d1-0',
      drawnDepth: 1,
    };
    const run = recordEventInstance(createRun(1103), 'd1-0', record);
    const before = structuredClone(run);

    expect(() => recordEventInstance(run, 'd1-0', { ...record, ...change })).toThrow(/immutable event instance/);
    expect(run).toEqual(before);
  });

  it('refuses to reopen a pending picker whose identity differs from its committed instance', () => {
    const base = createRun(1103);
    const node = base.map.depths.flat().find((candidate) => candidate.kind === 'event');
    if (!node) throw new Error('fixture seed requires an event node');
    const committed = recordEventInstance({ ...base, currentNodeId: node.id }, node.id, {
      eventId: 'recruiter',
      contentVersion: 1,
      instanceId: `event:${node.id}`,
      drawnDepth: node.depth,
    });
    const run = {
      ...committed,
      eventResolutions: {
        [node.id]: {
          eventId: 'recruiter',
          contentVersion: 1,
          instanceId: 'event:wrong-node',
          choiceId: 'pick_sword',
          pending: true,
        },
      },
    };
    const before = structuredClone(run);

    expect(() => reopenEventChoice(run)).toThrow(/does not match committed event instance/);
    expect(run).toEqual(before);
  });

  it('preserves legacy map and themed-bag draws through a refill', () => {
    const initial = createRun(1103);
    const serializedMap = JSON.stringify(initial.map);
    let state = { ...initial, gold: 999, map: ensureDepthThrough(initial.map, 60) };
    const nodes = state.map.depths.flat()
      .filter((node) => node.kind === 'event' && node.eventTheme === 'training')
      .slice(0, 10);
    const draws: string[] = [];
    for (const node of nodes) {
      const rolled = rollEventForNode(state, node);
      draws.push(rolled.event.id);
      state = rolled.state;
    }

    expect({
      seed: initial.seed,
      serializedMap,
      eventBag: state.eventBag,
      eventBagRefills: state.eventBagRefills,
      eventThemeBags: state.eventThemeBags,
      eventThemeBagRefills: state.eventThemeBagRefills,
      firstDraws: draws.slice(0, 5),
      refillDraws: draws.slice(5),
    }).toEqual({
      seed: 1103,
      serializedMap: `{"seed":1103,"depths":[[],[{"id":"d1-0","depth":1,"wave":1,"kind":"event","biomeId":"swornhold","eventSeed":3102056035,"eventTheme":"training"},{"id":"d1-1","depth":1,"wave":1,"kind":"event","biomeId":"swornhold","eventSeed":4175970746,"eventTheme":"forge"},{"id":"d1-2","depth":1,"wave":1,"kind":"event","biomeId":"swornhold","eventSeed":2027994229,"eventTheme":"cache"}],[{"id":"d2-0","depth":2,"wave":1,"kind":"event","biomeId":"swornhold","eventSeed":2779368532,"eventTheme":"recruit"},{"id":"d2-1","depth":2,"wave":1,"kind":"event","biomeId":"swornhold","eventSeed":1705453821,"eventTheme":"omen"},{"id":"d2-2","depth":2,"wave":1,"kind":"event","biomeId":"swornhold","eventSeed":3853430338,"eventTheme":"market"}],[{"id":"d3-0","depth":3,"wave":1,"kind":"fight","biomeId":"swornhold","fightNumber":1,"fightOption":"easy","encounterSeed":439369430},{"id":"d3-1","depth":3,"wave":1,"kind":"fight","biomeId":"swornhold","fightNumber":1,"fightOption":"standard","encounterSeed":3660422015},{"id":"d3-2","depth":3,"wave":1,"kind":"fight","biomeId":"swornhold","fightNumber":1,"fightOption":"hard","encounterSeed":3660274920}],[{"id":"d4-0","depth":4,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":310954594,"eventTheme":"forge"},{"id":"d4-1","depth":4,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":3532007179,"eventTheme":"training"},{"id":"d4-2","depth":4,"wave":2,"kind":"shop","biomeId":"swornhold","shopId":"swordwright","shopSeed":2680711038}],[{"id":"d5-0","depth":5,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":2895416231,"eventTheme":"market"},{"id":"d5-1","depth":5,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":2895563326,"eventTheme":"omen"},{"id":"d5-2","depth":5,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":747586809,"eventTheme":"recruit"}],[{"id":"d6-0","depth":6,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":3157433944,"eventTheme":"cache"},{"id":"d6-1","depth":6,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":3157286849,"eventTheme":"training"},{"id":"d6-2","depth":6,"wave":2,"kind":"event","biomeId":"swornhold","eventSeed":4231495750,"eventTheme":"forge"}],[{"id":"d7-0","depth":7,"wave":2,"kind":"fight","biomeId":"swornhold","fightNumber":2,"fightOption":"easy","encounterSeed":2959747194},{"id":"d7-1","depth":7,"wave":2,"kind":"fight","biomeId":"swornhold","fightNumber":2,"fightOption":"standard","encounterSeed":1885832483},{"id":"d7-2","depth":7,"wave":2,"kind":"fight","biomeId":"swornhold","fightNumber":2,"fightOption":"hard","encounterSeed":811917772}]]}`,
      eventBag: [],
      eventBagRefills: 0,
      eventThemeBags: { training: [] },
      eventThemeBagRefills: { training: 2 },
      firstDraws: ['sparring_circle', 'veterans_last_lesson', 'hermits_riddle', 'wandering_tutor', 'sweep_drill'],
      refillDraws: ['sweep_drill', 'wandering_tutor', 'sparring_circle', 'veterans_last_lesson', 'hermits_riddle'],
    });
  });
});
