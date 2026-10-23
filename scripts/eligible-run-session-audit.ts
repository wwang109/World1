import assert from 'node:assert/strict';
import { EligibleRunSession, type RunOperationStorage } from '../src/game/eligibleRunSession';
import { EligibleRunApiError, isEligibleRunMutationPath, type EligibleRunTransport } from '../src/game/eligibleRunApi';
import type { EligibleRunView, RunReceipt } from '../src/run/online/types';

const values = new Map<string, string>();
const storage: RunOperationStorage = { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); }, remove: key => { values.delete(key); } };
const view = { id: 'server-run', accountId: 'account-a', revision: 4, key: { rulesRevision: 'old-rules', contentSha: 'old-content' }, state: { gold: 3 }, content: { skills: { skill: { name: 'Old card' } } }, encounters: [] } as unknown as EligibleRunView;
let canonical = structuredClone(view); let responseLost = true; let attempts: unknown[] = []; let saved: RunReceipt | null = null;
const transport: EligibleRunTransport = {
  get: async () => structuredClone(canonical),
  post: async (_path, body) => {
    attempts.push(structuredClone(body));
    if (!saved) { canonical = { ...canonical, revision: 5 }; saved = { operationId: (body as any).operationId, runId: canonical.id, revision: 5, view: structuredClone(canonical) }; }
    if (responseLost) { responseLost = false; throw new Error('Lost response after server commit'); }
    return structuredClone(saved);
  },
};
const first = new EligibleRunSession(transport, storage, () => 'operation-first'); first.account('account-a'); await first.resume();
await assert.rejects(() => first.submit({ kind: 'shopReroll' }));
assert.equal(first.state.view?.revision, 4, 'lost response never creates optimistic client success');
assert(first.state.pending);
await assert.rejects(() => first.submit({ kind: 'retire' }));
const reloaded = new EligibleRunSession(transport, storage, () => 'operation-new'); reloaded.account('account-a'); await reloaded.resume();
assert(reloaded.state.pending); await reloaded.retry();
assert.equal(reloaded.state.pending, null); assert.equal(reloaded.state.view?.revision, 5); assert.deepEqual(attempts[0], attempts[1]);
assert.equal(reloaded.state.view?.content.skills.skill?.name, 'Old card');
canonical = { ...canonical, revision: 9 };
const lateReplay = new EligibleRunSession(transport, storage);
lateReplay.account('account-a'); await lateReplay.resume();
await lateReplay.submit({ kind: 'shopReroll' });
assert.equal(lateReplay.state.view?.revision, 9, 'an old operation receipt cannot regress a resumed revision');
canonical = { ...canonical, id: 'replacement-run', revision: 0 };
await lateReplay.submit({ kind: 'shopReroll' });
assert.equal(lateReplay.state.view?.id, 'replacement-run', 'old run receipts recover the active replacement from the server');
canonical = { ...canonical, id: 'server-run', revision: 5 };

const conflict = new EligibleRunSession({ get: transport.get, post: async () => { throw new EligibleRunApiError('stale', 409, { ...canonical, revision: 6 }); } }, storage);
conflict.account('account-a'); await conflict.resume(); await assert.rejects(() => conflict.submit({ kind: 'shopReroll' }));
assert.equal(conflict.state.view?.revision, 6); assert.equal(conflict.state.pending, null);
conflict.account('account-b'); await conflict.resume(); assert.equal(conflict.state.view, null, 'wrong account view is never adopted');

let finish: ((receipt: RunReceipt) => void) | null = null;
const delayed = new EligibleRunSession({ get: transport.get, post: () => new Promise(resolve => { finish = resolve; }) }, storage);
delayed.account('account-a'); await delayed.resume(); const action = delayed.submit({ kind: 'shopReroll' }); delayed.account('account-b');
assert.equal(delayed.state.view, null); assert.equal(delayed.state.pending, null);
(finish as unknown as (receipt: RunReceipt) => void)(saved!); await assert.rejects(() => action); assert.equal(delayed.state.view, null);

const unavailable = new EligibleRunSession({ get: async () => { throw new Error('offline'); }, post: transport.post }, storage);
unavailable.account('offline-account'); await unavailable.resume(); assert.equal(unavailable.state.view, null); assert.equal(unavailable.state.error, 'offline');
for (const path of ['//external.example', 'https://external.example', '/account/name', '/runs/../account/name', '/runs/a/actions?redirect=external']) assert.equal(isEligibleRunMutationPath(path), false);
values.set('world1:online-operation:v1:poisoned', JSON.stringify({ accountId: 'poisoned', path: '//external.example', body: { operationId: 'poisoned-operation' } }));
const poisoned = new EligibleRunSession(transport, storage); poisoned.account('poisoned'); assert.equal(poisoned.state.pending, null);
console.log('eligible run session OK: lost response + reload same operation replay; no optimistic commit; pending freeze; authoritative conflict adoption; old receipt cannot regress newer revision or replacement run; account switch in-flight isolation; wrong-account refusal; pinned content preserved; offline no local fallback');
