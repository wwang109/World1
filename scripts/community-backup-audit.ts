import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditStore, admit, auditProposal, fund, fixtureGithub, auditHash, AUDIT_RULES, AUDIT_REPOSITORY_ID, type AuditSqliteD1 } from './community-audit-fixtures';
import { createSupportService } from '../src/service/community/support';
import { makeBackupReceipt, verifyBackupReceipt, type BackupReceipt } from '../src/community/backup';
import { createRoundMerger, type GitHubMergePort } from '../src/service/community/mergeWinner';
import { createGitHubMerger, COMMUNITY_CHECK_NAMES, verifyBackupRulesets } from '../src/service/community/mergerGithub';
import type { CommunityStore } from '../src/service/community/store';
import type { RoundCandidate } from '../src/community/rounds';
import { CommunityError } from '../src/community/validate';

async function selected(kind: 'file' | 'd1') {
  const fixture = await auditStore(kind); const { store } = fixture;
  const proposal = await admit(store, auditProposal(), true); await fund(store, 'backup-voter', 1);
  const open = await store.ensureRound(Date.now());
  await createSupportService({ store, github: fixtureGithub(proposal), now: Date.now, hash: auditHash, randomId: randomUUID })('backup-voter', { key: proposal.key, expectedHeadSha: proposal.headSha, moderationRevision: 1, roundId: open.id, amount: 1, operationId: 'backup-support-one' });
  const round = await store.closeRound(open.id, open.closesAt, AUDIT_RULES, 1);
  return { ...fixture, round, candidate: round.winner! };
}
function fixturePort(store: CommunityStore, roundId: string) {
  const status = { tags: 0, checks: 0, approvals: 0, merges: 0, merged: false, tagPresent: false, missingRules: false, movedBase: false, loseTagResponse: false };
  const port: GitHubMergePort = {
    async inspect(candidate) { return { headSha: candidate.headSha, baseSha: status.movedBase ? 'd'.repeat(40) : candidate.baseSha, open: !status.merged, merged: status.merged, mergeCommitSha: status.merged ? 'f'.repeat(40) : null, mergedByExpectedApp: status.merged, trustedChecksPass: true, rulesetsVerified: !status.missingRules }; },
    async ensureBackup(candidate, id) {
      if (!status.tagPresent) { status.tagPresent = true; status.tags++; }
      if (status.loseTagResponse) { status.loseTagResponse = false; throw new Error('lost-tag-create-response'); }
      return makeBackupReceipt(id, candidate, Date.now());
    },
    async verifyBackup(candidate, id, receipt) { await verifyBackupReceipt(id, candidate, receipt); if (!status.tagPresent || status.missingRules || status.movedBase) throw new CommunityError(409, 'backup-ref-or-protection-mismatch'); },
    async recordVoteWinner(candidate, id, receipt) { await port.verifyBackup(candidate, id, receipt); assert.equal((await store.getRound(roundId))?.backupReceipt?.manifestSha256, receipt.manifestSha256); status.checks++; },
    async approve(candidate, receipt) { await port.verifyBackup(candidate, roundId, receipt); assert((await store.getRound(roundId))?.backupReceipt); status.approvals++; },
    async merge(candidate, receipt) { await port.verifyBackup(candidate, roundId, receipt); if (!status.merged) status.merges++; status.merged = true; return { mergeCommitSha: 'f'.repeat(40) }; },
  };
  return { port, status };
}
for (const kind of ['file', 'd1'] as const) {
  {
    const { store, round } = await selected(kind); const { port, status } = fixturePort(store, round.id);
    status.loseTagResponse = true;
    const merger = createRoundMerger({ store, github: port, now: Date.now });
    await assert.rejects(() => merger(round.id), /lost-tag-create-response/);
    assert.equal((await store.getRound(round.id))?.backupReceipt, undefined); assert.equal(status.checks, 0); assert.equal(status.approvals, 0); assert.equal(status.merges, 0);
    const completed = await merger(round.id); assert.equal(completed.state, 'merged'); assert(completed.backupReceipt); assert.equal(status.tags, 1); assert.equal(status.merges, 1);
    await verifyBackupReceipt(round.id, round.winner!, completed.backupReceipt);
    assert.deepEqual(await merger(round.id), completed);
  }
  {
    const { store, round, candidate, db } = await selected(kind); const { port, status } = fixturePort(store, round.id);
    let loseReceiptResponse = true;
    const wrapped: CommunityStore = { ...store, async recordBackup(id, receipt) { const result = await store.recordBackup(id, receipt); if (loseReceiptResponse) { loseReceiptResponse = false; throw new Error('lost-durable-backup-response'); } return result; } };
    const merger = createRoundMerger({ store: wrapped, github: port, now: Date.now });
    if (db) {
      db.failAtStatement = 0; await assert.rejects(() => merger(round.id), /injected-statement/); db.failAtStatement = null;
      assert.equal((await store.getRound(round.id))?.backupReceipt, undefined); assert.equal(status.checks, 0);
    }
    await assert.rejects(() => merger(round.id), /lost-durable-backup-response/);
    const saved = (await store.getRound(round.id))!.backupReceipt!; assert(saved); assert.equal(status.checks, 0); assert.equal(status.approvals, 0);
    const later = await makeBackupReceipt(round.id, candidate, Date.now() + 1000);
    assert.deepEqual(await store.recordBackup(round.id, later), saved);
    await assert.rejects(() => store.recordBackup(round.id, { ...saved, manifestSha256: '0'.repeat(64) }), /backup-manifest-digest/);
    assert.equal((await merger(round.id)).state, 'merged'); assert.equal(status.tags, 1); assert.equal(status.merges, 1);
    if (db) { assert.throws(() => db.sqlite.exec('UPDATE community_round_backups SET confirmed_at=1'), /immutable-community-backup/); assert.throws(() => db.sqlite.exec('DELETE FROM community_round_backups'), /immutable-community-backup/); }
  }
  {
    const { store, round } = await selected(kind); const { port, status } = fixturePort(store, round.id);
    const wrong: GitHubMergePort = { ...port, async ensureBackup(candidate, id) { const receipt = await port.ensureBackup(candidate, id); return { ...receipt, manifest: { ...receipt.manifest, baseSha: 'd'.repeat(40) } }; } };
    const value = await createRoundMerger({ store, github: wrong, now: Date.now })(round.id);
    assert.equal(value.state, 'blocked'); assert.equal(status.checks, 0); assert.equal(status.approvals, 0); assert.equal(status.merges, 0);
  }
  {
    const { store, round } = await selected(kind); const { port, status } = fixturePort(store, round.id); status.missingRules = true;
    assert.equal((await createRoundMerger({ store, github: port, now: Date.now })(round.id)).state, 'blocked'); assert.equal(status.tags, 0); assert.equal(status.checks, 0);
  }
  {
    const { store, round } = await selected(kind); const { port, status } = fixturePort(store, round.id);
    const racing: GitHubMergePort = { ...port, async ensureBackup(candidate, id) { const value = await port.ensureBackup(candidate, id); status.movedBase = true; return value; } };
    assert.equal((await createRoundMerger({ store, github: racing, now: Date.now })(round.id)).state, 'blocked'); assert.equal(status.checks, 0); assert.equal(status.approvals, 0); assert.equal(status.merges, 0);
  }
  {
    const { store, round } = await selected(kind); const { port, status } = fixturePort(store, round.id);
    const merger = createRoundMerger({ store, github: port, now: Date.now });
    const values = await Promise.all([merger(round.id), merger(round.id)]);
    assert(values.every(value => value.state === 'merged')); assert.equal(status.tags, 1); assert.equal(status.merges, 1);
    assert.equal((await store.getRound(round.id))!.backupReceipt!.manifestSha256, values[0]!.backupReceipt!.manifestSha256);
  }
  if (kind === 'd1') {
    const { store, round, candidate, db } = await selected(kind); const { port, status } = fixturePort(store, round.id);
    const backup = await port.ensureBackup(candidate, round.id); await store.recordBackup(round.id, backup);
    const merger = createRoundMerger({ store, github: port, now: Date.now });
    for (let boundary = 0; boundary < 3; boundary++) {
      db!.failAtStatement = boundary; await assert.rejects(() => merger(round.id), /injected-statement/); db!.failAtStatement = null;
      assert.equal((await store.getRound(round.id))!.state, 'closing'); assert.equal((await store.getProposal(candidate.key))!.state, 'open'); assert.equal((await store.getProposal(candidate.key))!.mergedCommitSha, null);
    }
    assert.equal((await merger(round.id)).state, 'merged'); assert.equal((await store.getProposal(candidate.key))!.state, 'merged'); assert.equal((await store.getProposal(candidate.key))!.sourceState, 'closed'); assert.equal(status.merges, 1);
  }
  console.log(`OK community-backup ${kind}: backup-before-checks-review-merge/lost-tag-response/durable-receipt-replay/mismatched-digest/rules-and-base-races/concurrent-cron${kind === 'd1' ? '/SQL-rollback/immutable-backup' : ''}`);
}

const appId = 5391036;
const protectedTags = { id: 3, target: 'tag', enforcement: 'active', conditions: { ref_name: { include: ['refs/tags/community-backup/*'], exclude: [] } }, bypass_actors: [], rules: [{ type: 'update' }, { type: 'deletion' }] };
assert(verifyBackupRulesets([protectedTags])); assert(!verifyBackupRulesets([{ ...protectedTags, bypass_actors: [{ actor_type: 'Integration', actor_id: appId, bypass_mode: 'always' }] }])); assert(!verifyBackupRulesets([{ ...protectedTags, rules: [{ type: 'update' }] }]));
const { store, round, candidate } = await selected('d1');
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const privateKey = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
let backupTag: { ref: string; object: { type: string; sha: string } } | null = null;
let actualMerges = 0; let lostTag = true; let lostMerge = true; let checks = 0; let approvals = 0;
const rules = [
  { id: 1, target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } }, bypass_actors: [{ actor_type: 'Integration', actor_id: appId, bypass_mode: 'pull_request' }], rules: [{ type: 'update' }] },
  { id: 2, target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } }, bypass_actors: [], rules: [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: Object.values(COMMUNITY_CHECK_NAMES).map(context => ({ context, integration_id: appId })) } }] }, protectedTags,
];
const transport: typeof fetch = async (input, init) => {
  const url = new URL(String(input)); assert.equal(url.origin, 'https://api.github.com'); const method = init?.method ?? 'GET';
  if (url.pathname === '/app/installations/123/access_tokens') return Response.json({ token: 'isolated-fixture-token', expires_at: new Date(Date.now() + 600_000).toISOString() });
  const path = url.pathname.replace('/repos/wwang109/wandering-hand-content/', '');
  if (path === 'rulesets') return Response.json(rules.map(rule => ({ id: rule.id })));
  if (/^rulesets\/\d+$/.test(path)) return Response.json(rules.find(rule => rule.id === Number(path.split('/')[1])));
  if (path === 'pulls/1' && method === 'GET') return Response.json({ head: { sha: candidate.headSha }, base: { sha: candidate.baseSha, ref: 'main', repo: { id: Number(AUDIT_REPOSITORY_ID), full_name: 'wwang109/wandering-hand-content' } }, state: actualMerges ? 'closed' : 'open', merged_at: actualMerges ? new Date().toISOString() : null, merge_commit_sha: actualMerges ? 'f'.repeat(40) : null, merged_by: { type: 'Bot', login: 'backup-fixture[bot]' } });
  if (path === 'git/ref/heads/main') return Response.json({ ref: 'refs/heads/main', object: { sha: actualMerges ? 'f'.repeat(40) : candidate.baseSha, type: 'commit' } });
  if (path.startsWith('git/ref/tags/community-backup/')) return backupTag ? Response.json(backupTag) : new Response('', { status: 404 });
  if (path === 'git/refs' && method === 'POST') {
    const body = JSON.parse(String(init?.body)); assert.equal(body.sha, candidate.baseSha); assert(/^refs\/tags\/community-backup\/[a-f0-9]{64}$/.test(body.ref));
    if (backupTag) return new Response('', { status: 422 }); backupTag = { ref: body.ref, object: { type: 'commit', sha: body.sha } };
    if (lostTag) { lostTag = false; throw new Error('lost-real-tag-response-fixture'); } return Response.json(backupTag, { status: 201 });
  }
  if (path.startsWith(`commits/${candidate.headSha}/check-runs`)) return Response.json({ check_runs: checks === 4 ? Object.values(COMMUNITY_CHECK_NAMES).map(name => ({ name, app: { id: appId }, head_sha: candidate.headSha, status: 'completed', conclusion: 'success' })) : [] });
  if (path === 'check-runs' && method === 'POST') { assert(backupTag); assert((await store.getRound(round.id))?.backupReceipt); checks++; return Response.json({ id: checks }, { status: 201 }); }
  if (path === 'pulls/1/reviews' && method === 'POST') { assert(backupTag); assert.equal(checks, 4); approvals++; return Response.json({ id: approvals }, { status: 201 }); }
  if (path === 'pulls/1/merge' && method === 'PUT') { assert(backupTag); assert.equal(checks, 4); assert.equal(approvals, 1); assert.equal(JSON.parse(String(init?.body)).sha, candidate.headSha); actualMerges++; if (lostMerge) { lostMerge = false; throw new Error('lost-real-merge-response-fixture'); } return Response.json({ merged: true, sha: 'f'.repeat(40) }); }
  throw new Error(`Unapproved fixture request ${method} ${path}`);
};
const github = createGitHubMerger({ appId: String(appId), installationId: '123', privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`, appSlug: 'backup-fixture', repositoryId: AUDIT_REPOSITORY_ID, enabled: true, fetch: transport, validateCandidate: async () => { assert(backupTag); assert((await store.getRound(round.id))?.backupReceipt); } });
const merger = createRoundMerger({ store, github, now: Date.now });
await assert.rejects(() => merger(round.id), /lost-real-merge-response-fixture/);
const recovered = await merger(round.id); assert.equal(recovered.state, 'merged'); assert.equal(actualMerges, 1); assert.equal(approvals, 1); assert.equal(checks, 4); assert(recovered.backupReceipt);
console.log('OK community-backup GitHub transport: real-client RSA auth/API-create-ref/readback/protected-tag/confirmed-durable-receipt/check-review-merge-order/lost-create-and-merge-recovery (isolated transport fixture; no external writes)');
