import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditStore, auditProposal, auditHashBytes, AUDIT_RULES, fund, admit, auditHash } from './community-audit-fixtures';
import { reconcileCommunitySources, sourcesFreshForRound } from '../src/service/community/reconcile';
import { createSupportService } from '../src/service/community/support';
import type { GitHubReadPort } from '../src/service/community/github';
import type { ProposalSnapshot } from '../src/community/types';
import { CommunityError } from '../src/community/validate';
for (const kind of ['file', 'd1'] as const) {
  const { store } = await auditStore(kind); const proposals = new Map<number, ProposalSnapshot>([1, 2, 3].map(number => [number, auditProposal(number)]));
  let clock = Date.now(); let requests = 0; let fileReads = 0; let outage = false; let invalid = false;
  const github: GitHubReadPort = {
    async listChangedPrs(cursor) { requests++; if (outage) throw new Error('source outage fixture'); const keys = [...proposals.values()].map(value => value.key); return { keys: cursor === '2' ? [] : keys, nextCursor: cursor === null ? '2' : null, versions: [...proposals.values()].map(value => ({ key: value.key, headSha: value.headSha, baseSha: value.baseSha, state: value.sourceState })) }; },
    async readPr(key) { requests++; if (outage) throw new Error('source outage fixture'); const value = proposals.get(key.number)!; if (invalid && key.number === 1) throw new CommunityError(400, 'invalid-manifest-fixture'); return { key, headSha: value.headSha, baseSha: value.baseSha, state: value.sourceState, mergedCommitSha: value.mergedCommitSha, url: value.sourceUrl, manifestPath: value.manifestPath }; },
    async readFilesAtSha(key, sha, paths) { if (paths.length) fileReads++; return paths.map(path => ({ path, bytes: new TextEncoder().encode(JSON.stringify(proposals.get(key.number)!.manifest)), mode: '100644', blobSha: sha })); },
  };
  const tick = () => reconcileCommunitySources({ store, github, now: () => clock, randomId: randomUUID, hashBytes: auditHashBytes, budget: 1, intervalMs: 60_000 });
  const concurrent = await Promise.all([tick(), tick()]); assert.equal(concurrent.filter(value => value.ran).length, 1); assert.equal((await store.listProposals(0, 50, 'newest')).length, 1); assert.equal((await store.sourceSync()).pending.length, 2);
  const beforeSkip = requests; assert.equal((await tick()).ran, false); assert.equal(requests, beforeSkip);
  clock += 60_001; await tick(); clock += 60_001; await tick(); assert.equal((await store.listProposals(0, 50, 'newest')).length, 3);
  const importedReads = fileReads;
  const original = proposals.get(1)!; const cached = (await store.getProposal(original.key))!;
  await store.moderate({ accountId: 'moderator', input: { key: original.key, headSha: original.headSha, expectedRevision: cached.moderationRevision, decision: 'open', operationId: 'reconcile-admit-operation', note: '', technical: { key: original.key, headSha: original.headSha, rulesRevision: AUDIT_RULES, contentApiVersion: 1, evidenceHash: 'e'.repeat(64), reviewerId: 'moderator', admittedAt: clock } }, payloadHash: 'admit', now: clock });
  await fund(store, 'sync-voter', 1); const open = await store.ensureRound(Date.now());
  await createSupportService({ store, github, now: Date.now, hash: auditHash, randomId: randomUUID })('sync-voter', { key: original.key, expectedHeadSha: original.headSha, moderationRevision: cached.moderationRevision + 1, roundId: open.id, amount: 1, operationId: 'reconcile-support-one' });
  clock = open.closesAt + 1; assert.equal(await sourcesFreshForRound(store, open.id), false); await tick(); assert.equal(await sourcesFreshForRound(store, open.id), true); assert.equal(fileReads, importedReads);
  outage = true; clock += 60_001; const failed = await tick(); assert.equal(failed.healthy, false); assert.equal((await store.sourceSync()).lastError, 'github-source-unavailable');
  const beforeBackoff = requests; clock += 60_001; assert.equal((await tick()).healthy, false); assert.equal(requests, beforeBackoff);
  await assert.rejects(() => createSupportService({ store, github, now: Date.now, hash: auditHash, randomId: randomUUID })('sync-voter', { key: original.key, expectedHeadSha: original.headSha, moderationRevision: cached.moderationRevision + 1, roundId: open.id, amount: 1, operationId: 'sync-outage-support' })); assert.equal((await store.wallet('sync-voter')).balance, 0);
  outage = false; invalid = true; proposals.set(1, { ...original, headSha: 'd'.repeat(40) }); clock = (await store.sourceSync()).nextPollAt + 1;
  const invalidated = await tick(); assert.equal(invalidated.invalid, 1); assert.equal((await store.getProposal(original.key))!.state, 'pending_review'); assert.equal((await store.getProposal(original.key))!.technical, null);
  const previous = await store.sourceSync(); await assert.rejects(() => store.finishSourceSync('stolen-lease', previous), /source-sync-lease-changed/);
  console.log(`OK community-reconcile ${kind}: automatic-discovery/bounded-resume/concurrent-lease/no-extra-poll/immutable-cache/fresh-close-gate/outage-backoff/no-spend/invalid-head-suspended`);
}
