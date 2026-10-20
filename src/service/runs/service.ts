import type { EligibleRun, RunExecutor, RevisionKey, RunReceipt, EncounterReceipt, RunEffect, TrustedRunInputs } from '../../run/online/types';
import type { GhostRecord } from '../../run/ghost';
import { validOperationId, validateCommand } from '../../run/online/validateIntent';
import { RunServiceError, type EligibleRunStore, type EffectDelivery } from './store';

export interface ExecutorRegistry { current: RevisionKey; get(key: RevisionKey): RunExecutor }
export interface RunPorts {
  lookupGhost(accountId: string, band: number, key: RevisionKey): Promise<GhostRecord | null>;
  deliverEffect(delivery: EffectDelivery, ghost?: Omit<GhostRecord, 'id' | 'createdAt'>): Promise<void>;
}
export type ApiReply<T> = { status: number; body: T | { error: string; view?: unknown } };
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${stable(value)}`).join(',')}}`;
}
export async function payloadHash(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function object(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new RunServiceError('Invalid request');
}
export function createEligibleRunService(store: EligibleRunStore, registry: ExecutorRegistry, ports: RunPorts) {
  const present = (run: EligibleRun) => ({ ...run, content: registry.get(run.key).present(run.state) });
  async function get(accountId: string, id: string): Promise<EligibleRun> {
    const run = id === 'active' ? await store.active(accountId) : await store.get(id, accountId);
    if (!run) throw new RunServiceError('Run not found', 404);
    return run;
  }
  async function flush(accountId: string): Promise<void> {
    for (const delivery of await store.pendingEffects(accountId)) {
      try {
        const effect = delivery.effect;
        const validated = effect.kind === 'ghostSave' ? registry.get(delivery.key).validateGhost({ code: effect.code, displayName: effect.name, fightNumber: effect.fightNumber, ownerLocalId: accountId }) : undefined;
        if (validated && !validated.ok) throw new Error(`Canonical ghost save rejected: ${validated.reason}`);
        await ports.deliverEffect(delivery, validated?.ok ? validated.record : undefined); await store.acknowledgeEffect(delivery.id, accountId);
      }
      catch { return; }
    }
  }
  async function lookup(accountId: string, effects: readonly RunEffect[], key: RevisionKey): Promise<TrustedRunInputs['ghostLookup']> {
    const effect = effects.find(effect => effect.kind === 'ghostLookup');
    return effect?.kind === 'ghostLookup' ? { nodeId: effect.nodeId, role: effect.role, ghost: await ports.lookupGhost(accountId, effect.band, key) } : undefined;
  }
  async function create(accountId: string, input: unknown): Promise<RunReceipt> {
    object(input, ['operationId', 'replace']);
    if (!validOperationId(input.operationId) || (input.replace !== undefined && typeof input.replace !== 'boolean')) throw new RunServiceError('Invalid create request');
    const operationId = input.operationId as string, hash = await payloadHash({ kind: 'create', input });
    const replay = await store.replay(accountId, operationId, hash);
    if (replay) return replay;
    const executor = registry.get(registry.current);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const run: EligibleRun = { id: crypto.randomUUID(), accountId, revision: 0, key: executor.key, state: executor.create(seed), encounters: [] };
    return store.createOrReplace(accountId, run, { operationId, payloadHash: hash, now: Date.now(), replace: input.replace === true });
  }
  async function action(accountId: string, id: string, input: unknown): Promise<RunReceipt> {
    const command = validateCommand(input), hash = await payloadHash({ kind: 'action', id, command });
    const replay = await store.replay(accountId, command.operationId, hash);
    if (replay) return replay;
    const run = await get(accountId, id), executor = registry.get(run.key);
    if (run.revision !== command.expectedRevision) throw new RunServiceError('Run revision changed', 409, present(run));
    if (run.encounters.some(encounter => encounter.status === 'pending') && command.intent.kind !== 'retire') throw new RunServiceError('Resolve the pending encounter first', 409, present(run));
    const inputs: TrustedRunInputs = { runId: id, revision: run.revision, encounterId: crypto.randomUUID() };
    let transition = executor.apply(run.state, command.intent, inputs);
    const ghostLookup = await lookup(accountId, transition.effects, run.key);
    if (ghostLookup) transition = executor.apply(run.state, command.intent, { ...inputs, ghostLookup });
    const receipt = await store.commitAction(id, accountId, command.expectedRevision, { operationId: command.operationId, payloadHash: hash, now: Date.now() }, transition);
    await flush(accountId);
    return receipt;
  }
  async function resolve(accountId: string, id: string, encounterId: string, input: unknown): Promise<EncounterReceipt> {
    object(input, ['operationId', 'expectedRevision']);
    if (!validOperationId(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new RunServiceError('Invalid resolution request');
    const operationId = input.operationId as string, expectedRevision = input.expectedRevision as number;
    const hash = await payloadHash({ kind: 'resolve', id, encounterId, input });
    const replay = await store.replay(accountId, operationId, hash);
    if (replay) { if (!('encounterId' in replay)) throw new RunServiceError('Operation kind mismatch', 409); return replay; }
    const run = await get(accountId, id), executor = registry.get(run.key);
    if (run.revision !== expectedRevision) throw new RunServiceError('Run revision changed', 409, present(run));
    const encounter = run.encounters.find(encounter => encounter.id === encounterId);
    if (!encounter || encounter.status !== 'pending' || encounter.stateRevision !== run.revision) throw new RunServiceError('No pending canonical encounter', 409, present(run));
    let resolved = executor.resolve(run.state, encounter);
    const ghostLookup = await lookup(accountId, resolved.effects, run.key);
    if (ghostLookup) {
      const applied = executor.apply(resolved.state, { kind: 'ghostLookup' }, { runId: id, revision: run.revision, encounterId, ghostLookup });
      resolved = { ...resolved, state: applied.state, effects: [...resolved.effects.filter(effect => effect.kind !== 'ghostLookup'), ...applied.effects] };
    }
    const receipt = await store.commitEncounter({ accountId, expectedRevision, operationId, payloadHash: hash, resolved,
      ...(resolved.won && encounter.rewardClass === 'boss' ? { bossCredit: { accountId, runId: id, encounterId, amount: 1 as const } } : {}) });
    await flush(accountId);
    return receipt;
  }
  async function handle(accountId: string, method: string, path: string, input?: unknown): Promise<ApiReply<unknown>> {
    try {
      if (!accountId) throw new RunServiceError('Authentication required', 401);
      const parts = path.replace(/^\/runs\/?/, '').split('/').filter(Boolean);
      if (method === 'POST' && parts.length === 0) return { status: 201, body: await create(accountId, input) };
      if (method === 'GET' && parts.length === 1) { await flush(accountId); return { status: 200, body: present(await get(accountId, parts[0]!)) }; }
      if (method === 'POST' && parts.length === 2 && parts[1] === 'actions') return { status: 200, body: await action(accountId, parts[0]!, input) };
      if (method === 'POST' && parts.length === 4 && parts[1] === 'encounters' && parts[3] === 'resolve') return { status: 200, body: await resolve(accountId, parts[0]!, parts[2]!, input) };
      throw new RunServiceError('Run route not found', 404);
    } catch (error) {
      return { status: error instanceof RunServiceError ? error.status : 400, body: { error: error instanceof Error ? error.message : 'Invalid run request', ...(error instanceof RunServiceError && error.view ? { view: error.view } : {}) } };
    }
  }
  return { create, get, action, resolve, handle, present };
}
export type EligibleRunService = ReturnType<typeof createEligibleRunService>;
