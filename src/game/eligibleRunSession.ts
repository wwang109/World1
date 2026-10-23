import type { EligibleRunView, EncounterReceipt, RunIntent, RunReceipt } from '../run/online/types';
import { EligibleRunApiError, eligibleRunTransport, isEligibleRunMutationPath, type EligibleRunTransport } from './eligibleRunApi';
import { accountOwnerId, getAccountState, initAccount, onAccountChange } from './accountSession';

export interface PendingRunOperation { accountId: string; path: string; body: { operationId: string; expectedRevision?: number; intent?: RunIntent; replace?: boolean } }
export interface RunOperationStorage { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }
export interface EligibleRunSessionState { view: EligibleRunView | null; busy: boolean; pending: PendingRunOperation | null; error: string | null; lastEncounter: EncounterReceipt | null; accountId: string }
const keyOf = (accountId: string) => `world1:online-operation:v1:${accountId}`;
const ACCOUNT_UNAVAILABLE = "Can't reach your game account. Check your connection and select RECONNECT.";
export class EligibleRunSession {
  state: EligibleRunSessionState = { view: null, busy: false, pending: null, error: null, lastEncounter: null, accountId: '' };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly transport: EligibleRunTransport, private readonly storage: RunOperationStorage, private readonly operationId: () => string = () => crypto.randomUUID()) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private update(patch: Partial<EligibleRunSessionState>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  account(accountId: string): void {
    if (accountId === this.state.accountId) return;
    this.generation++;
    let pending: PendingRunOperation | null = null;
    try { const saved = JSON.parse(this.storage.get(keyOf(accountId)) ?? 'null') as PendingRunOperation | null; if (saved?.accountId === accountId && typeof saved.path === 'string' && isEligibleRunMutationPath(saved.path) && typeof saved.body?.operationId === 'string') pending = saved; } catch {}
    this.update({ accountId, view: null, pending, error: null, busy: false, lastEncounter: null });
  }
  async resume(): Promise<void> {
    if (!this.state.accountId) { this.update({ error: ACCOUNT_UNAVAILABLE }); return; }
    if (this.state.busy) return;
    const generation = this.generation;
    this.update({ busy: true, error: null });
    try { const view = await this.transport.get(); if (generation === this.generation) {
      if (view && view.accountId !== this.state.accountId) throw new Error('This run belongs to another account.');
      this.update({ view, ...(this.state.lastEncounter?.runId !== view?.id ? { lastEncounter: null } : {}) });
    } }
    catch (error) { if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : 'Connection unavailable' }); }
    finally { if (generation === this.generation) this.update({ busy: false }); }
  }
  create(replace = false): Promise<RunReceipt> { return this.begin('/runs', { operationId: this.operationId(), ...(replace ? { replace: true } : {}) }); }
  submit(intent: RunIntent): Promise<RunReceipt> {
    const view = this.state.view;
    if (!view) return Promise.reject(new Error('Resume your online run first.'));
    return this.begin(`/runs/${view.id}/actions`, { operationId: this.operationId(), expectedRevision: view.revision, intent });
  }
  async resolve(encounterId: string): Promise<EncounterReceipt> {
    const view = this.state.view;
    if (!view) throw new Error('Resume your online run first.');
    return await this.begin(`/runs/${view.id}/encounters/${encounterId}/resolve`, { operationId: this.operationId(), expectedRevision: view.revision }) as EncounterReceipt;
  }
  retry(): Promise<RunReceipt> {
    if (!this.state.pending) return Promise.reject(new Error('No unconfirmed action.'));
    return this.deliver(this.state.pending);
  }
  dismissEncounter(): void { this.update({ lastEncounter: null }); }
  private begin(path: string, body: PendingRunOperation['body']): Promise<RunReceipt> {
    if (!this.state.accountId) return Promise.reject(new Error(ACCOUNT_UNAVAILABLE));
    if (this.state.busy || this.state.pending) return Promise.reject(new Error('Confirm the previous action before continuing.'));
    const pending = { accountId: this.state.accountId, path, body };
    try { this.storage.set(keyOf(pending.accountId), JSON.stringify(pending)); }
    catch { return Promise.reject(new Error('Enable browser storage before playing online so interrupted actions can be recovered.')); }
    this.update({ pending });
    return this.deliver(pending);
  }
  private async deliver(pending: PendingRunOperation): Promise<RunReceipt> {
    if (this.state.busy || pending.accountId !== this.state.accountId) throw new Error('Account or action changed.');
    const generation = this.generation;
    this.update({ busy: true, error: null });
    try {
      const receipt = await this.transport.post(pending.path, pending.body);
      if (generation !== this.generation || receipt.view.accountId !== pending.accountId) throw new Error('Account changed. Resume this account to recover its action.');
      let view: EligibleRunView | null = receipt.view;
      const current = this.state.view;
      if (current?.id !== view.id || current.revision >= view.revision) {
        const active = await this.transport.get();
        if (generation !== this.generation) throw new Error('Account changed. Resume this account to recover its action.');
        if (active && active.accountId !== pending.accountId) throw new Error('This run belongs to another account.');
        view = active ?? (['active', 'drafting'].includes(receipt.view.state.status) ? null : receipt.view);
      }
      this.storage.remove(keyOf(pending.accountId));
      this.update({ view, pending: null, ...('encounterId' in receipt && receipt.runId === view?.id ? { lastEncounter: receipt } : this.state.lastEncounter?.runId !== view?.id ? { lastEncounter: null } : {}) });
      return receipt;
    } catch (error) {
      if (generation === this.generation) {
        const definitive = error instanceof EligibleRunApiError && error.status >= 400 && error.status < 500;
        if (definitive) this.storage.remove(keyOf(pending.accountId));
        this.update({ error: error instanceof EligibleRunApiError && error.status === 409 ? 'Your run changed in another tab. The confirmed state has been refreshed.' : error instanceof Error ? error.message : 'Connection interrupted. Retry to confirm this action.',
          ...(definitive ? { pending: null } : {}), ...(error instanceof EligibleRunApiError && error.view?.accountId === pending.accountId ? { view: error.view } : {}) });
      }
      throw error;
    } finally { if (generation === this.generation) this.update({ busy: false }); }
  }
}
const browserStorage: RunOperationStorage = { get: key => typeof window === 'undefined' ? null : window.localStorage.getItem(key), set: (key, value) => window.localStorage.setItem(key, value), remove: key => window.localStorage.removeItem(key) };
export const eligibleRunSession = new EligibleRunSession(eligibleRunTransport, browserStorage);
export async function resumeEligibleRun(): Promise<void> {
  await initAccount();
  eligibleRunSession.account(getAccountState().status === 'ready' ? accountOwnerId() : '');
  await eligibleRunSession.resume();
}
onAccountChange(next => { eligibleRunSession.account(next.status === 'ready' ? next.account?.id ?? '' : ''); });
