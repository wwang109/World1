import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { D1Database } from '../functions/d1';
import type { EligibleRun } from '../src/run/online/types';
import { createD1EligibleRunStore } from '../functions/eligibleRunStoreD1';
import { createD1CommunityStore } from '../functions/communityStoreD1';
import { createEligibleRunService } from '../src/service/runs/service';
import { createSupportService } from '../src/service/community/support';
import { auditExecutor, auditKey, auditRegistry, auditPresent, bossFixture } from './online-audit-fixtures';
import { admit, fixtureGithub, auditHash, auditHashBytes, auditProposal, AUDIT_RULES } from './community-audit-fixtures';
import { makeBackupReceipt, verifyBackupReceipt } from '../src/community/backup';
import { createRoundMerger, type GitHubMergePort } from '../src/service/community/mergeWinner';
import { reconcileCommunitySources } from '../src/service/community/reconcile';

const modulePath = process.env.COMMUNITY_MINIFLARE_MODULE ?? 'miniflare';
const { Miniflare, convertV4MiniflareOptions } = await import(modulePath);
const runtime = new Miniflare(convertV4MiniflareOptions({ name: 'community-audit', modules: true, script: 'export default { fetch() { return new Response("local audit"); } }', compatibilityDate: '2026-10-19', d1Databases: { DB: 'community-local-evidence' } }));
try {
  const actual = await runtime.getD1Database('DB') as D1Database & { exec(sql: string): Promise<unknown> };
  for (const path of ['0003_community.sql', '0004_eligible_runs.sql', '0005_community_points.sql', '0006_voting_rounds.sql', '0007_community_backups.sql', '0008_community_source_sync.sql']) await actual.exec(readFileSync(`migrations/${path}`, 'utf8').replace(/^\s*--.*$/gm, '').replace(/\r?\n/g, ' '));
  let failAt: number | null = null;
  const db: D1Database = { prepare: sql => actual.prepare(sql), batch: statements => actual.batch(failAt === null ? statements : statements.map((statement, index) => index === failAt ? actual.prepare("SELECT json_extract('invalid-json','$')") : statement)) };
  const store = createD1EligibleRunStore(db, auditPresent), community = createD1CommunityStore(db);
  const service = createEligibleRunService(store, auditRegistry, { lookupGhost: async () => null, deliverEffect: async () => undefined });
  const account = 'local-workerd-account';
  const creation = { operationId: randomUUID() };
  const created = await Promise.all([service.create(account, creation), service.create(account, creation)]);
  assert.deepEqual(created[0], created[1]);
  assert.equal(await store.get(created[0]!.runId, 'another-account'), null);
  const run: EligibleRun = { id: randomUUID(), accountId: account, key: auditKey, revision: 0, state: bossFixture(), encounters: [] };
  await store.createOrReplace(account, run, { operationId: randomUUID(), payloadHash: 'local-boss-fixture', now: Date.now(), replace: true });
  const issued = await service.action(account, run.id, { operationId: randomUUID(), expectedRevision: 0, intent: { kind: 'issueEncounter' } });
  const encounter = issued.view.encounters[0]!;
  assert.equal(auditExecutor.resolve(issued.view.state, encounter).won, true);
  const command = { operationId: randomUUID(), expectedRevision: 1 };
  for (let boundary = 0; boundary < 8; boundary++) {
    failAt = boundary;
    await assert.rejects(() => service.resolve(account, run.id, encounter.id, command));
    failAt = null;
    assert.equal((await store.get(run.id, account))!.revision, 1);
    assert.equal((await community.wallet(account)).balance, 0);
    assert.equal((await community.ledger(account, 0, 50)).length, 0);
  }
  const settled = await Promise.all(Array.from({ length: 4 }, () => service.resolve(account, run.id, encounter.id, command)));
  settled.forEach(receipt => assert.deepEqual(receipt, settled[0]));
  assert.equal(settled[0]!.points?.pointsEarned, 1);
  assert.equal((await community.wallet(account)).balance, 1);
  const proposal = await admit(community);
  const round = await community.ensureRound(Date.now());
  const support = createSupportService({ store: community, github: fixtureGithub(proposal), now: Date.now, hash: auditHash, randomId: randomUUID });
  const input = { key: proposal.key, expectedHeadSha: proposal.headSha, moderationRevision: proposal.moderationRevision, roundId: round.id, amount: 1, operationId: 'local-support-one' };
  const spending = await Promise.allSettled([support(account, input), support(account, { ...input, operationId: 'local-support-two' })]);
  assert.equal(spending.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await community.wallet(account)).balance, 0);
  assert.equal((await community.getProposal(proposal.key))!.supportTotal, 1);
  assert.equal((await community.ledger(account, 0, 50)).length, 2);
  await assert.rejects(() => actual.prepare('UPDATE community_point_ledger SET delta=50').run());
  await assert.rejects(() => actual.prepare('DELETE FROM community_point_ledger').run());
  console.log('community workerd D1 OK: real local D1 migrations; concurrent create and boss settlement replay; canonical simulated boss +1; 8 SQL rollback boundaries; two-tab support overspend blocked; immutable ledger');
  await community.moderate({ accountId: 'local-workerd-moderator', input: { key: proposal.key, headSha: proposal.headSha, expectedRevision: proposal.moderationRevision, decision: 'open', operationId: 'local-backup-admission', note: 'Trusted local evidence fixture; not a real GitHub human review', technical: { key: proposal.key, headSha: proposal.headSha, rulesRevision: AUDIT_RULES, contentApiVersion: 1, evidenceHash: 'e'.repeat(64), reviewerId: 'local-workerd-moderator', admittedAt: Date.now() } }, payloadHash: 'local-backup-admission', now: Date.now() });
  const frozen = await community.closeRound(round.id, round.closesAt, AUDIT_RULES, 1); assert(frozen.winner);
  await assert.rejects(() => community.finishMerge(round.id, { operationId: `merge:${round.id}`, roundId: round.id, headSha: proposal.headSha, mergeCommitSha: 'f'.repeat(40), mergedAt: Date.now() }), /confirmed-backup-required/);
  const backup = await makeBackupReceipt(round.id, frozen.winner, Date.now());
  failAt = 0; await assert.rejects(() => community.recordBackup(round.id, backup)); failAt = null;
  assert.equal((await community.getRound(round.id))!.backupReceipt, undefined);
  const recorded = await Promise.all([community.recordBackup(round.id, backup), community.recordBackup(round.id, { ...backup, confirmedAt: backup.confirmedAt + 1 })]);
  assert.deepEqual(recorded[0], recorded[1]); await verifyBackupReceipt(round.id, frozen.winner, recorded[0]!);
  await assert.rejects(() => community.recordBackup(round.id, { ...backup, manifestSha256: '0'.repeat(64) }), /backup-manifest-digest/);
  await assert.rejects(() => actual.prepare('UPDATE community_round_backups SET confirmed_at=1').run());
  await assert.rejects(() => actual.prepare('DELETE FROM community_round_backups').run());
  let checks = 0; let approvals = 0; let merges = 0;
  const remoteFixture: GitHubMergePort = {
    async inspect(candidate) { return { headSha: candidate.headSha, baseSha: candidate.baseSha, open: merges === 0, merged: merges > 0, mergeCommitSha: merges ? 'f'.repeat(40) : null, mergedByExpectedApp: merges > 0, trustedChecksPass: true, rulesetsVerified: true }; },
    async ensureBackup() { throw new Error('Existing persisted backup should replay'); },
    async verifyBackup(candidate, id, receipt) { await verifyBackupReceipt(id, candidate, receipt); assert.equal((await community.getRound(id))!.backupReceipt!.manifestSha256, receipt.manifestSha256); },
    async recordVoteWinner(candidate, id, receipt) { await remoteFixture.verifyBackup(candidate, id, receipt); checks++; },
    async approve(candidate, receipt) { await remoteFixture.verifyBackup(candidate, round.id, receipt); approvals++; },
    async merge(candidate, receipt) { await remoteFixture.verifyBackup(candidate, round.id, receipt); merges++; return { mergeCommitSha: 'f'.repeat(40) }; },
  };
  const merger = createRoundMerger({ store: community, github: remoteFixture, now: Date.now });
  for (let boundary = 0; boundary < 3; boundary++) { failAt = boundary; await assert.rejects(() => merger(round.id)); failAt = null; assert.equal((await community.getRound(round.id))!.state, 'closing'); assert.equal((await community.getProposal(proposal.key))!.state, 'open'); assert.equal((await community.getProposal(proposal.key))!.mergedCommitSha, null); }
  assert.equal((await merger(round.id)).state, 'merged');
  assert.equal((await community.getProposal(proposal.key))!.state, 'merged'); assert.equal((await community.getProposal(proposal.key))!.sourceState, 'closed'); assert.equal((await community.getProposal(proposal.key))!.mergedCommitSha, 'f'.repeat(40));
  assert.equal(checks, 1); assert.equal(approvals, 1); assert.equal(merges, 1);
  assert.equal((await community.wallet(account)).balance, 0);
  console.log('community workerd backup D1 OK: real local D1 backup migration; no merge without receipt; backup INSERT rollback; concurrent stable receipt; immutable UPDATE/DELETE triggers; persisted backup before checks/review/merge (external GitHub operations are isolated port fixtures)');
  console.log('community workerd retirement D1 OK: all3 round/merge-operation/proposal-retirement rollback boundaries; round receipt and cached winner close atomically; external merge not replayed');
  const intake = fixtureGithub(auditProposal(2)); let syncNow = Date.now();
  const synchronize = () => reconcileCommunitySources({ store: community, github: intake, now: () => syncNow, randomId: randomUUID, hashBytes: auditHashBytes, budget: 1, intervalMs: 60_000 });
  const polls = await Promise.all([synchronize(), synchronize()]); assert.equal(polls.filter(poll => poll.ran).length, 1); assert(await community.getProposal(intake.current.key));
  const checkpoint = await community.sourceSync(); assert(checkpoint.lastSuccessAt); await assert.rejects(() => community.finishSourceSync('wrong-owner', checkpoint), /source-sync-lease-changed/);
  syncNow = checkpoint.nextPollAt + 1; intake.outage = true; const unavailable = await synchronize(); assert.equal(unavailable.healthy, false); assert.equal((await community.sourceSync()).lastError, 'github-source-unavailable');
  assert.equal((await synchronize()).ran, false);
  console.log('community workerd source sync D1 OK: actual durable checkpoint migration; concurrent lease once; automatic read-only proposal import; stale-owner rejection; source outage persisted and backoff honored');
} finally { await runtime.dispose(); }
