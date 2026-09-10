import { describe, expect, it } from 'vitest';
import { validateEventDocument } from '../../src/data/validateEventContent';

type JsonRecord = Record<string, any>;

const STORY_STATE_V3 = {
  oath_mercy: { kind: 'boolean', default: false },
  grave_path: { kind: 'enum', values: ['none', 'opened', 'answered'], default: 'none' },
  honorable_choice: { kind: 'boolean', default: false },
  reliquary_oath: { kind: 'boolean', default: false },
  oath_gate: { kind: 'enum', values: ['none', 'sworn', 'kept', 'released'], default: 'none' },
  venom_bloom: { kind: 'enum', values: ['none', 'cultivated'], default: 'none' },
  rival_spared: { kind: 'boolean', default: false },
  moon_quarry_released: { kind: 'boolean', default: false },
} as const;

const CASES = [
  ['weapon', 'sword'], ['weapon', 'axe'], ['weapon', 'lance'], ['weapon', 'bow'], ['weapon', 'beast'],
  ['element', 'fire'], ['element', 'frost'], ['element', 'lightning'], ['element', 'nature'], ['element', 'holy'], ['element', 'dark'],
] as const;

function document(): JsonRecord {
  return {
    schemaVersion: 3,
    storyStateSchema: STORY_STATE_V3,
    events: [{
      id: 'bound_affinity_probe',
      versions: [{
        version: 1,
        def: {
          title: 'Bound Affinity Probe', body: 'Typed fixture.', theme: 'forge', rarity: 'secret',
          story: { storyId: 'bound_affinity_probe', stage: 'setup', role: 'setup' },
          eligibility: { fact: 'board.isMonoType', args: { typeKind: 'weapon' } },
          delivery: { kind: 'ambient' }, visibility: 'hidden_until_eligible', priority: 400,
          once: 'run', cooldownNodes: 0, bindings: [{ as: 'mono_type', source: 'board.monoType' }],
          choiceSet: {
            fixed: [
              {
                id: 'upgrade', label: 'Upgrade', cost: 0,
                outcome: {
                  kind: 'upgradeCardTargeted',
                  target: { boundSubject: { slot: 'mono_type' } },
                  fallback: { kind: 'grantGold', amount: 2 },
                },
              },
              {
                id: 'gem', label: 'Gem', cost: 0,
                outcome: {
                  kind: 'gemChoice',
                  boundSubject: {
                    slot: 'mono_type',
                    cases: CASES.map(([typeKind, type]) => ({
                      when: { typeKind, type },
                      filter: [{ ids: ['armor_break_echo', 'bramble_sliver', 'iron_bulwark_echo'] }],
                    })),
                  },
                },
              },
              { id: 'leave', label: 'Leave', cost: 0, outcome: { kind: 'nothing' } },
            ],
          },
        },
      }],
    }],
  };
}

function gemOutcome(input: JsonRecord): JsonRecord {
  return input.events[0].versions[0].def.choiceSet.fixed[1].outcome as JsonRecord;
}

function problems(input: JsonRecord): string[] {
  return validateEventDocument(input, { includeCrossEventReferences: false })
    .map((problem) => `${problem.where}: ${problem.message}`);
}

describe('schema-v3 bound affinity selector', () => {
  it('accepts one exhaustive JSON-owned case for every structured mono subject', () => {
    expect(validateEventDocument(document(), { includeCrossEventReferences: false })).toEqual([]);
  });

  it.each([
    ['missing', (outcome: JsonRecord) => { outcome.boundSubject.cases.pop(); }],
    ['duplicate', (outcome: JsonRecord) => { outcome.boundSubject.cases[10] = structuredClone(outcome.boundSubject.cases[0]); }],
    ['unknown', (outcome: JsonRecord) => { outcome.boundSubject.cases[0].when.type = 'hammer'; }],
    ['open subject', (outcome: JsonRecord) => { outcome.boundSubject.cases[0].when.extra = true; }],
    ['mixed static filter', (outcome: JsonRecord) => { outcome.filter = [{ all: true }]; }],
    ['wrong slot', (outcome: JsonRecord) => { outcome.boundSubject.slot = 'signature_card_id'; }],
  ] as const)('rejects %s selector shapes', (_name, mutate) => {
    const input = document();
    mutate(gemOutcome(input));
    expect(problems(input)).not.toEqual([]);
  });

  it('retains the explicit mono-kind targeted-upgrade form while rejecting extra target fields', () => {
    const explicit = document();
    explicit.events[0].versions[0].def.choiceSet.fixed[0].outcome.target.boundSubject.typeKind = 'weapon';
    expect(validateEventDocument(explicit, { includeCrossEventReferences: false })).toEqual([]);

    const open = document();
    open.events[0].versions[0].def.choiceSet.fixed[0].outcome.target.boundSubject.extra = true;
    expect(problems(open)).not.toEqual([]);
  });

  it('allows optional true only on the exact revenge finisher binding variant', () => {
    const allowed = document();
    allowed.events[0].versions[0].def.bindings = [
      { as: 'mono_type', source: 'board.monoType' },
      { as: 'enemy_id', source: 'revenge.enemyId' },
      { as: 'revenge_finisher_card_id', source: 'revenge.finisherCardId', optional: true },
    ];
    expect(validateEventDocument(allowed, { includeCrossEventReferences: false })).toEqual([]);

    for (const mutate of [
      (binding: JsonRecord) => { binding.optional = false; },
      (binding: JsonRecord) => { binding.optional = 'yes'; },
      (binding: JsonRecord) => { binding.as = 'enemy_id'; binding.source = 'revenge.enemyId'; },
    ]) {
      const malformed = structuredClone(allowed);
      mutate(malformed.events[0].versions[0].def.bindings[2]);
      expect(problems(malformed)).not.toEqual([]);
    }
  });

  it('requires one unambiguous positive signature gate on every whole eligible path', () => {
    const signature = { fact: 'combat.signatureReady', args: { winsAtLeast: 3, bossFinisher: true } };
    const valid = document();
    valid.events[0].versions[0].def.bindings.push({ as: 'signature_card_id', source: 'signature.cardId' });
    valid.events[0].versions[0].def.eligibility = {
      all: [signature, { any: [
        { fact: 'wallet.current', args: { op: 'gte', value: 1 } },
        { fact: 'lives.current', args: { op: 'gte', value: 1 } },
      ] }],
    };
    expect(validateEventDocument(valid, { includeCrossEventReferences: false })).toEqual([]);

    const malformedRequirements = [
      { fact: 'wallet.current', args: { op: 'gte', value: 1 } },
      { not: signature },
      { any: [signature, { fact: 'wallet.current', args: { op: 'gte', value: 1 } }] },
      { all: [signature, signature] },
    ];
    for (const eligibility of malformedRequirements) {
      const malformed = document();
      malformed.events[0].versions[0].def.bindings.push({ as: 'signature_card_id', source: 'signature.cardId' });
      malformed.events[0].versions[0].def.eligibility = eligibility;
      expect(problems(malformed).some((problem) => problem.includes('signature.cardId'))).toBe(true);
    }
  });
});
