import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEligibleRunService } from '../src/service/runs/service';
import { auditExecutor, auditKey, auditRegistry, bossFixture, runStoreFixture } from './online-audit-fixtures';
import type { EligibleRun } from '../src/run/online/types';

for (const kind of ['file', 'd1'] as const) {
  const { store, community, db } = await runStoreFixture(kind);
  const service = createEligibleRunService(store, auditRegistry, { lookupGhost: async () => null, deliverEffect: async () => undefined });
  const account = `audit-${kind}`;
  const create = { operationId: randomUUID() };
  const created = await Promise.all([service.create(account, create), service.create(account, create)]);
  assert.deepEqual(created[0], created[1]);
  assert.equal((await service.handle(account, 'POST', '/runs', { operationId: randomUUID(), seed: 7 })).status, 400);
  assert.equal((await service.handle(account, 'POST', '/runs', { operationId: randomUUID() })).status, 409);
  assert.equal(await store.get(created[0]!.runId, 'another-account'), null);
  const command = { operationId: randomUUID(), expectedRevision: 0, intent: { kind: 'draftReroll' as const } };
  const actions = await Promise.all([service.action(account, created[0]!.runId, command), service.action(account, created[0]!.runId, command)]);
  assert.deepEqual(actions[0], actions[1]);
  await assert.rejects(() => service.action(account, created[0]!.runId, { ...command, expectedRevision: 1 }));
  assert.equal((await community.wallet(account)).balance, 0);
  const run: EligibleRun = { id: randomUUID(), accountId: account, key: auditKey, revision: 0, state: bossFixture(), encounters: [] };
  await store.createOrReplace(account, run, { operationId: randomUUID(), payloadHash: 'fixture', now: Date.now(), replace: true });
  const issue = await service.action(account, run.id, { operationId: randomUUID(), expectedRevision: 0, intent: { kind: 'issueEncounter' } });
  const encounter = issue.view.encounters[0]!;
  const simulated = auditExecutor.resolve(issue.view.state, encounter);
  assert.equal(simulated.won, true, 'canonical boss fixture must actually win simulation');
  const resolve = { operationId: randomUUID(), expectedRevision: 1 };
  if (db) {
    for (let boundary = 0; boundary < 8; boundary++) {
      db.failAtStatement = boundary;
      await assert.rejects(() => service.resolve(account, run.id, encounter.id, resolve));
      assert.equal((await store.get(run.id, account))!.revision, 1);
      assert.equal((await community.wallet(account)).balance, 0);
      assert.equal((await community.ledger(account, 0, 100)).length, 0);
    }
    db.failAtStatement = null;
  }
  const settled = await Promise.all(Array.from({ length: 4 }, () => service.resolve(account, run.id, encounter.id, resolve)));
  for (const receipt of settled) assert.deepEqual(receipt, settled[0]);
  assert.equal(settled[0]!.points?.pointsEarned, 1);
  assert.equal((await community.wallet(account)).balance, 1);
  assert.equal((await community.ledger(account, 0, 100)).length, 1);
  await assert.rejects(() => service.resolve(account, run.id, encounter.id, { operationId: randomUUID(), expectedRevision: 2 }));
  const resumed = await service.get(account, run.id);
  assert.equal(resumed.revision, 2);
  assert.equal(resumed.encounters[0]!.status, 'settled');
  console.log(`eligible run service OK ${kind}: auth ownership; create/action/resolve races; exact replay; forged seed rejection; canonical simulated boss +1; ${db ? '8 statement rollbacks' : 'durable atomic run and wallet'}; resume`);
}
