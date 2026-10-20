import type { EligibleRun, EligibleRunView, EncounterReceipt, ResolvedEncounterCommit, RunEffect, RunReceipt, Transition } from '../../run/online/types';

export class RunServiceError extends Error {
  constructor(message: string, readonly status = 400, readonly view?: EligibleRunView) { super(message); }
}
export interface StoredOperation { operationId: string; payloadHash: string; now: number; replace?: boolean }
export interface EffectDelivery { id: string; accountId: string; runId: string; key: EligibleRun['key']; effect: Exclude<RunEffect, { kind: 'encounter' | 'ghostLookup' }> }
export interface EligibleRunStore {
  get(runId: string, accountId: string): Promise<EligibleRun | null>;
  active(accountId: string): Promise<EligibleRun | null>;
  replay(accountId: string, operationId: string, payloadHash: string): Promise<RunReceipt | EncounterReceipt | null>;
  createOrReplace(accountId: string, run: EligibleRun, operation: StoredOperation): Promise<RunReceipt>;
  commitAction(runId: string, accountId: string, expectedRevision: number, operation: StoredOperation, transition: Transition): Promise<RunReceipt>;
  commitEncounter(resolved: ResolvedEncounterCommit): Promise<EncounterReceipt>;
  pendingEffects(accountId: string): Promise<readonly EffectDelivery[]>;
  acknowledgeEffect(id: string, accountId: string): Promise<void>;
}
export type PresentRun = (run: EligibleRun) => EligibleRunView;
export function isActive(run: EligibleRun): boolean { return run.state.status === 'active' || run.state.status === 'drafting'; }
export function verifyEncounterCommit(run: EligibleRun, input: ResolvedEncounterCommit): void {
  if (run.accountId !== input.accountId || run.revision !== input.expectedRevision || !isActive(run)) throw new RunServiceError('Run revision changed', 409);
  const encounter = run.encounters.find(encounter => encounter.id === input.resolved.encounterId);
  if (!encounter || encounter.status !== 'pending' || encounter.runId !== run.id || encounter.stateRevision !== run.revision
    || encounter.key.contentSha !== run.key.contentSha || encounter.key.rulesRevision !== run.key.rulesRevision) throw new RunServiceError('No matching pending encounter', 409);
  const credit = input.bossCredit;
  const eligible = input.resolved.won && input.resolved.log.result === 'win' && encounter.rewardClass === 'boss';
  if (!!credit !== eligible || (credit && (credit.accountId !== run.accountId || credit.runId !== run.id || credit.encounterId !== encounter.id || credit.amount !== 1))) throw new RunServiceError('Invalid canonical boss credit', 409);
}
