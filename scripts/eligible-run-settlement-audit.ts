import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditExecutor, auditKey, auditRegistry, bossFixture, drafted, runStoreFixture } from './online-audit-fixtures';
import { createEligibleRunService } from '../src/service/runs/service';
import { ghostCodeOf, type GhostRecord } from '../src/run/ghost';
import { rollChallengeFightEnemy } from '../src/run/challengeFight';
import type { RunState } from '../src/run/runState';
import type { EligibleRun, EncounterRecord } from '../src/run/online/types';
const ghost: GhostRecord = { id: 'trusted-ghost', code: ghostCodeOf(drafted()), displayName: 'Audit', band: 0, fightNumber: 5, createdAt: 0, ownerLocalId: 'another-account' };

for (const kind of ['file', 'd1'] as const) {
  const { store, community } = await runStoreFixture(kind);
  const service = createEligibleRunService(store, auditRegistry, { lookupGhost: async () => null, deliverEffect: async () => undefined });
  const accountId = `settlement-${kind}`;
  let total = 0;
  const cases = ['boss', 'boss-later-run', 'boss-multiple-units', 'substitute', 'challenge-boss', 'extra-boss', 'extra-ordinary', 'loss'] as const;
  for (const scenario of cases) {
    let state: RunState = bossFixture();
    if (scenario === 'substitute') state.activeGhostFight = { nodeId: state.currentNodeId!, role: 'substitute', ghost };
    if (scenario.startsWith('extra')) state = { ...state, currentNodeId: null, activeGhostFight: { nodeId: state.currentNodeId!, role: 'extra', ghost } };
    if (scenario === 'challenge-boss') state = { ...state, activeChallengeFight: { ...rollChallengeFightEnemy(state.seed, 5, 'trusted-event', 'fight', 'elite'), nodeId: state.currentNodeId!, instanceId: 'trusted-event', choiceId: 'fight', difficulty: 'elite', reward: { kind: 'grantGold', amount: 1 } } };
    if (scenario === 'loss') state = { ...state, heroLevel: 1, heroAllocation: {}, pieces: [{ instanceId: 'defensive-audit', skillId: 'aegis_of_the_unbroken', tier: 'bronze', slot: 0 }] };
    const run: EligibleRun = { id: randomUUID(), accountId, key: auditKey, revision: 0, state, encounters: [] };
    await store.createOrReplace(accountId, run, { operationId: randomUUID(), payloadHash: scenario, now: Date.now(), replace: true });
    let transition = auditExecutor.apply(state, { kind: 'issueEncounter' }, { runId: run.id, revision: 0, encounterId: randomUUID() });
    const effect = transition.effects[0]!;
    assert.equal(effect.kind, 'encounter');
    if (effect.kind !== 'encounter') throw new Error('No canonical fixture encounter');
    let encounter: EncounterRecord = effect.encounter;
    if (scenario === 'boss-multiple-units') encounter = { ...encounter, preparation: { ...encounter.preparation, request: { ...encounter.preparation.request, foes: [encounter.preparation.request.foes[0]!, encounter.preparation.request.foes[0]!] } } };
    if (scenario === 'extra-ordinary') encounter = { ...encounter, rewardClass: 'none', preparation: { ...encounter.preparation, request: { ...encounter.preparation.request, foes: encounter.preparation.request.foes.map(foe => ({ ...foe, title: 'normal' })) } } };
    transition = { ...transition, effects: [{ kind: 'encounter', encounter }] };
    await store.commitAction(run.id, accountId, 0, { operationId: randomUUID(), payloadHash: `${scenario}-issue`, now: Date.now() }, transition);
    const result = await service.resolve(accountId, run.id, encounter.id, { operationId: randomUUID(), expectedRevision: 1 });
    const expected = scenario === 'loss' || scenario === 'extra-ordinary' ? 0 : 1;
    assert.equal(result.log.result === 'win', scenario !== 'loss', `${scenario}: actual simulation outcome`);
    assert.equal(result.points?.pointsEarned ?? 0, expected, `${scenario}: once-only rewardClass credit`);
    total += expected;
    assert.equal((await community.wallet(accountId)).balance, total);
  }
  const entries = await community.ledger(accountId, 0, 100);
  assert.equal(entries.reduce((sum, entry) => sum + entry.delta, 0), total);
  assert.equal(total, 6);
  console.log(`eligible settlement OK ${kind}: ${cases.length} canonical store fixtures; boss/multi-unit/substitute/challenge/extra +1; ordinary extra/loss +0; later run earns again; wallet equals ledger`);
}
