import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditStore, admit, fund, fixtureGithub, auditHash } from './community-audit-fixtures';
import { createSupportService } from '../src/service/community/support';
for (const kind of ['file', 'd1'] as const) {
  const fixture = await auditStore(kind); const { store } = fixture;
  const proposal = await admit(store);
  const github = fixtureGithub(proposal);
  const round = await store.ensureRound(Date.now());
  await fund(store, 'account-a', 3);
  const support = createSupportService({ store, github, now: Date.now, hash: auditHash, randomId: randomUUID });
  const base = { key: proposal.key, expectedHeadSha: proposal.headSha, moderationRevision: proposal.moderationRevision, roundId: round.id, amount: 1, operationId: 'support-operation-1' };
  for (const amount of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) await assert.rejects(() => support('account-a', { ...base, amount }));
  const receipt = await support('account-a', base);
  assert.equal(receipt.balance, 2);
  github.outage = true;
  assert.deepEqual(await support('account-a', base), receipt);
  await assert.rejects(() => support('account-a', { ...base, operationId: 'support-outage-2' }));
  github.outage = false;
  await assert.rejects(() => support('account-a', { ...base, amount: 2 }));
  const concurrent = await Promise.allSettled([support('account-a', { ...base, amount: 2, operationId: 'support-tab-one' }), support('account-a', { ...base, amount: 2, operationId: 'support-tab-two' })]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.wallet('account-a')).balance, 0);
  assert.equal((await store.ledger('account-a', 0, 50)).reduce((sum, entry) => sum + entry.delta, 0), 0);
  assert.equal((await store.getProposal(proposal.key))!.supportTotal, 3);
  assert.equal((await store.ledger('another-account', 0, 50)).length, 0);
  await fund(store, 'account-a', 1);
  github.current = { ...proposal, headSha: 'd'.repeat(40) };
  await assert.rejects(() => support('account-a', { ...base, operationId: 'support-stale-head' }));
  await store.importProposal(github.current, []);
  assert.equal((await store.getProposal(proposal.key))!.supportTotal, 0);
  assert.equal((await store.wallet('account-a')).balance, 1);
  github.current = proposal;
  await store.importProposal(proposal, []);
  const refreshed = await store.getProposal(proposal.key);
  await store.moderate({ accountId: 'moderator', input: { key: proposal.key, headSha: proposal.headSha, expectedRevision: refreshed!.moderationRevision, decision: 'open', note: '', operationId: 'review-again-operation' }, payloadHash: 'again', now: Date.now() });
  const reviewed = (await store.getProposal(proposal.key))!;
  await assert.rejects(() => support('account-a', { ...base, expectedHeadSha: reviewed.headSha, moderationRevision: reviewed.moderationRevision, roundId: 'wrong-round', operationId: 'support-wrong-round' }));
  if (fixture.db) {
    for (let boundary = 0; boundary < 3; boundary++) {
      fixture.db.failAtStatement = boundary;
      await assert.rejects(() => support('account-a', { ...base, moderationRevision: reviewed.moderationRevision, operationId: `support-fault-${boundary}` }));
      fixture.db.failAtStatement = null;
      assert.equal((await store.wallet('account-a')).balance, 1);
      assert.equal((await store.ledger('account-a', 0, 50)).filter(entry => entry.operationId.startsWith('support-fault')).length, 0);
    }
    assert.throws(() => fixture.db!.sqlite.exec("UPDATE community_point_ledger SET delta=50"), /immutable-community-ledger/);
    assert.throws(() => fixture.db!.sqlite.exec('DELETE FROM community_point_ledger'), /immutable-community-ledger/);
  }
  console.log(`OK community-support ${kind}: integer/source/replay/mismatch/two-tab-overspend/SHA-history/no-refund${fixture.db ? '/SQL-rollback-3-boundaries/immutable-ledger' : ''}`);
}
