import { describe, expect, it } from 'vitest';
import { eventRuntimeCatalog } from '../../src/data/events';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import { isEventDefV2 } from '../../src/data/eventContentV2';
import { eventDefAtVersion } from '../../src/data/eventsContent';
import {
  EVENT_CONTINUATION_HINT,
  EVENT_SPECIAL_UNLOCK_HINT,
  eventChoiceOpportunityHint,
} from '../../src/run/eventOpportunityHint';

describe('eventChoiceOpportunityHint', () => {
  it('derives story continuation from a real schema-v3 callback choice', () => {
    expect(eventChoiceOpportunityHint(eventRuntimeCatalog.feathered_cairn!, 'read_feathers', eventRuntimeCatalog))
      .toBe(EVENT_CONTINUATION_HINT);
  });

  it('derives story continuation from the real persisted schema-v2 Feathered Cairn callback', () => {
    const historical = eventDefAtVersion('feathered_cairn', 1);
    expect(historical !== undefined && !isEventDefV3(historical) && isEventDefV2(historical)).toBe(true);
    if (historical === undefined || isEventDefV3(historical) || !isEventDefV2(historical)) {
      throw new Error('expected retained Feathered Cairn @1 schema-v2 definition');
    }

    expect(eventChoiceOpportunityHint(historical, 'read_feathers', eventRuntimeCatalog))
      .toBe(EVENT_CONTINUATION_HINT);
    expect(eventChoiceOpportunityHint(historical, 'leave', eventRuntimeCatalog))
      .toBeUndefined();
  });

  it('derives a special-event opportunity from real event-level choice dependencies', () => {
    expect(eventChoiceOpportunityHint(eventRuntimeCatalog.bell_beneath_ice!, 'prise_it_free', eventRuntimeCatalog))
      .toBe(EVENT_SPECIAL_UNLOCK_HINT);
    expect(eventChoiceOpportunityHint(eventRuntimeCatalog.crossroads_shrine!, 'tithe', eventRuntimeCatalog))
      .toBe(EVENT_SPECIAL_UNLOCK_HINT);
  });

  it('does not infer an opportunity from an unrelated real choice', () => {
    expect(eventChoiceOpportunityHint(eventRuntimeCatalog.bell_beneath_ice!, 'leave_it_sleeping', eventRuntimeCatalog))
      .toBeUndefined();
  });

  it('returns no hint for a missing source choice', () => {
    expect(eventChoiceOpportunityHint(eventRuntimeCatalog.bell_beneath_ice!, 'secret_choice', eventRuntimeCatalog))
      .toBeUndefined();
  });

  it('reads positive schema-v3 event.choice dependencies but not negated ones', () => {
    const source = eventRuntimeCatalog.bell_beneath_ice!;
    const template = eventRuntimeCatalog.feathered_cairn!;
    if (!isEventDefV3(template)) throw new Error('expected current schema-v3 graph template');
    const fact = {
      fact: 'event.choice' as const,
      args: { eventId: source.id, choiceIds: ['leave_it_sleeping'] },
    };
    const positive = { ...template, id: 'positive_graph_probe', eligibility: { all: [fact] } };
    const negated = { ...template, id: 'negated_graph_probe', eligibility: { not: fact } };

    expect(eventChoiceOpportunityHint(source, 'leave_it_sleeping', {
      [source.id]: source,
      [positive.id]: positive,
    })).toBe(EVENT_SPECIAL_UNLOCK_HINT);
    expect(eventChoiceOpportunityHint(source, 'leave_it_sleeping', {
      [source.id]: source,
      [negated.id]: negated,
    })).toBeUndefined();
  });

  it('exposes only the approved spoiler-safe vocabulary', () => {
    const hints = Object.values(eventRuntimeCatalog).flatMap((event) => {
      const choices = 'choiceSet' in event
        ? [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])]
        : event.choices;
      return choices
        .map((choice) => eventChoiceOpportunityHint(event, choice.id, eventRuntimeCatalog))
        .filter((hint) => hint !== undefined);
    });

    expect(new Set(hints)).toEqual(new Set([
      'MAY CONTINUE THIS STORY',
      'MAY UNLOCK A SPECIAL EVENT',
    ]));
    expect(hints.every((hint) => hint === EVENT_CONTINUATION_HINT || hint === EVENT_SPECIAL_UNLOCK_HINT))
      .toBe(true);
  });
});
