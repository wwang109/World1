import { randomUUID } from 'node:crypto';
import type { EligibleRun, RunReceipt, EncounterReceipt, RunEffect } from '../src/run/online/types';
import { RunServiceError, isActive, verifyEncounterCommit, type EligibleRunStore, type EffectDelivery, type PresentRun } from '../src/service/runs/store';
import { createDurableCommunityState, type DurableCommunityState } from './communityStoreFile';
import { applyBossCredit } from '../src/service/community/pointStore';

interface Operations { accountId: string; operationId: string; payloadHash: string; receipt: RunReceipt | EncounterReceipt }
interface Runs { records: Record<string, EligibleRun>; operations: Operations[]; effects: EffectDelivery[] }
function runs(root: Record<string, unknown>): Runs {
  return (root.runs ??= { records: {}, operations: [], effects: [] }) as Runs;
}
function replay(state: Runs, accountId: string, operationId: string, payloadHash: string): RunReceipt | EncounterReceipt | null {
  const operation = state.operations.find(row => row.accountId === accountId && row.operationId === operationId);
  if (operation && operation.payloadHash !== payloadHash) throw new RunServiceError('Operation ID was used with another payload', 409);
  return operation?.receipt ?? null;
}
function persistEffects(state: Runs, run: EligibleRun, operationId: string, effects: readonly RunEffect[]): void {
  effects.forEach((effect, index) => {
    if (effect.kind === 'encounter' || effect.kind === 'ghostLookup') return;
    state.effects.push({ id: `${run.id}:${operationId}:${index}`, accountId: run.accountId, runId: run.id, key: run.key, effect });
  });
}
export function createFileEligibleRunStore(present: PresentRun, coordinator: DurableCommunityState = createDurableCommunityState()): EligibleRunStore {
  const read = () => runs({ runs: coordinator.read('runs') });
  return {
    async get(id, accountId) { const run = read().records[id]; return run?.accountId === accountId ? run : null; },
    async active(accountId) { return Object.values(read().records).find(run => run.accountId === accountId && isActive(run)) ?? null; },
    async replay(accountId, operationId, hash) { return replay(read(), accountId, operationId, hash); },
    async createOrReplace(accountId, run, operation) {
      return coordinator.transaction(root => {
        const state = runs(root), prior = replay(state, accountId, operation.operationId, operation.payloadHash);
        if (prior) return prior;
        const old = Object.values(state.records).find(candidate => candidate.accountId === accountId && isActive(candidate));
        if (old && !operation.replace) throw new RunServiceError('An earning run is already active', 409, present(old));
        if (old) state.records[old.id] = { ...old, revision: old.revision + 1, state: { ...old.state, status: 'retired' } };
        if (run.accountId !== accountId || state.records[run.id]) throw new RunServiceError('Invalid new run');
        state.records[run.id] = run;
        const receipt: RunReceipt = { operationId: operation.operationId, runId: run.id, revision: run.revision, view: present(run) };
        state.operations.push({ accountId, operationId: operation.operationId, payloadHash: operation.payloadHash, receipt });
        return JSON.parse(JSON.stringify(receipt)) as RunReceipt;
      });
    },
    async commitAction(id, accountId, revision, operation, transition) {
      return coordinator.transaction(root => {
        const state = runs(root), prior = replay(state, accountId, operation.operationId, operation.payloadHash);
        if (prior) return prior;
        const run = state.records[id];
        if (!run || run.accountId !== accountId) throw new RunServiceError('Run not found', 404);
        if (run.revision !== revision || !isActive(run) || (transition.state.status !== 'retired' && run.encounters.some(encounter => encounter.status === 'pending'))) throw new RunServiceError('Run revision changed', 409, present(run));
        const encounters = transition.effects.flatMap(effect => effect.kind === 'encounter' ? [effect.encounter] : []);
        if (encounters.length > 1 || encounters.some(encounter => encounter.runId !== id || encounter.stateRevision !== revision + 1)) throw new RunServiceError('Invalid encounter issuance');
        const next = { ...run, revision: revision + 1, state: transition.state, encounters: [...run.encounters, ...encounters] };
        state.records[id] = next;
        persistEffects(state, next, operation.operationId, transition.effects);
        const receipt: RunReceipt = { operationId: operation.operationId, runId: id, revision: next.revision, view: present(next) };
        state.operations.push({ accountId, operationId: operation.operationId, payloadHash: operation.payloadHash, receipt });
        return JSON.parse(JSON.stringify(receipt)) as RunReceipt;
      });
    },
    async commitEncounter(input) {
      return coordinator.transaction(root => {
        const state = runs(root), prior = replay(state, input.accountId, input.operationId, input.payloadHash);
        if (prior) { if (!('encounterId' in prior)) throw new RunServiceError('Operation kind mismatch', 409); return prior; }
        const run = Object.values(state.records).find(run => run.accountId === input.accountId && run.encounters.some(encounter => encounter.id === input.resolved.encounterId));
        if (!run) throw new RunServiceError('Run encounter not found', 404);
        verifyEncounterCommit(run, input);
        const next: EligibleRun = { ...run, revision: run.revision + 1, state: input.resolved.state,
          encounters: run.encounters.map(encounter => encounter.id === input.resolved.encounterId ? { ...encounter, status: 'settled' } : encounter) };
        state.records[run.id] = next;
        const points = input.bossCredit ? applyBossCredit(root, { ...input.bossCredit, operationId: input.operationId, payloadHash: input.payloadHash, entryId: randomUUID(), now: Date.now() }) : undefined;
        persistEffects(state, next, input.operationId, input.resolved.effects);
        const receipt: EncounterReceipt = { operationId: input.operationId, runId: run.id, revision: next.revision, view: present(next), encounterId: input.resolved.encounterId, log: input.resolved.log, ...(points ? { points } : {}) };
        state.operations.push({ accountId: input.accountId, operationId: input.operationId, payloadHash: input.payloadHash, receipt });
        return JSON.parse(JSON.stringify(receipt)) as EncounterReceipt;
      });
    },
    async pendingEffects(accountId) { return read().effects.filter(effect => effect.accountId === accountId); },
    async acknowledgeEffect(id, accountId) { await coordinator.transaction(root => { const state = runs(root); state.effects = state.effects.filter(effect => effect.id !== id || effect.accountId !== accountId); }); },
  };
}
