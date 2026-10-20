import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditStore, auditProposal, admit, fund, AUDIT_RULES, auditHash, fixtureGithub } from './community-audit-fixtures';
import { ROUND_DURATION_MS, rankCandidates, roundAt } from '../src/community/rounds';
import { createSupportService } from '../src/service/community/support';
import { createRoundMerger, type GitHubMergePort } from '../src/service/community/mergeWinner';
import { COMMUNITY_CHECK_NAMES, verifyCommunityRulesets } from '../src/service/community/mergerGithub';
import { makeBackupReceipt, verifyBackupReceipt } from '../src/community/backup';
assert.equal(roundAt(Date.UTC(2026, 9, 20)).closesAt - roundAt(Date.UTC(2026, 9, 20)).opensAt, ROUND_DURATION_MS);
const boundary = roundAt(Date.now()); assert.equal(roundAt(boundary.closesAt).opensAt, boundary.closesAt);
for (const kind of ['file', 'd1'] as const) {
  const { store } = await auditStore(kind);
  const proposal = await admit(store, auditProposal(), true);
  await fund(store, 'voter', 3);
  const current = await store.ensureRound(Date.now());
  await assert.rejects(() => store.closeRound(current.id, current.closesAt - 1, AUDIT_RULES, 1), /round-still-open/);
  const support = createSupportService({ store, github: fixtureGithub(proposal), now: Date.now, hash: auditHash, randomId: randomUUID });
  await support('voter', { key: proposal.key, expectedHeadSha: proposal.headSha, moderationRevision: 1, roundId: current.id, amount: 2, operationId: 'round-support-once' });
  const loser = await admit(store, auditProposal(2), true);
  await fund(store, 'loser-voter', 1);
  await createSupportService({ store, github: fixtureGithub(loser), now: Date.now, hash: auditHash, randomId: randomUUID })('loser-voter', { key: loser.key, expectedHeadSha: loser.headSha, moderationRevision: 1, roundId: current.id, amount: 1, operationId: 'round-loser-support' });
  const closed = await Promise.all([store.closeRound(current.id, current.closesAt, AUDIT_RULES, 1), store.closeRound(current.id, current.closesAt, AUDIT_RULES, 1)]);
  assert.deepEqual(closed[0], closed[1]); assert.equal(closed[0]!.winner!.key.number, 1);
  await assert.rejects(() => support('voter', { key: proposal.key, expectedHeadSha: proposal.headSha, moderationRevision: 1, roundId: current.id, amount: 1, operationId: 'round-late-support' }));
  assert.equal((await store.wallet('voter')).balance, 1);
  let approvals = 0; let merges = 0; let merged = false;
  const port: GitHubMergePort = {
    async inspect(candidate) { return { headSha: candidate.headSha, baseSha: candidate.baseSha, open: !merged, merged, mergeCommitSha: merged ? 'f'.repeat(40) : null, mergedByExpectedApp: merged, trustedChecksPass: true, rulesetsVerified: true }; },
    async ensureBackup(candidate, id) { return makeBackupReceipt(id, candidate, Date.now()); },
    async verifyBackup(candidate, id, receipt) { await verifyBackupReceipt(id, candidate, receipt); },
    async recordVoteWinner() { assert((await store.getRound(current.id))?.backupReceipt); }, async approve() { approvals++; }, async merge() { merges++; merged = true; throw new Error('audit lost successful GitHub response'); },
  };
  const merger = createRoundMerger({ store, github: port, now: Date.now });
  await assert.rejects(() => merger(current.id), /lost successful/);
  const recovered = await merger(current.id); assert.equal(recovered.state, 'merged'); assert.equal(merges, 1); assert.equal(approvals, 1);
  assert.equal((await store.getProposal(proposal.key))!.state, 'merged'); assert.equal((await store.getProposal(proposal.key))!.sourceState, 'closed'); assert.equal((await store.getProposal(proposal.key))!.mergedCommitSha, 'f'.repeat(40));
  assert.deepEqual(await merger(current.id), recovered);
  const next = await store.ensureRound(current.closesAt);
  const carry = await store.closeRound(next.id, next.closesAt, AUDIT_RULES, 1); assert.equal(carry.winner!.support, 1); assert.equal(carry.winner!.key.number, 2);
  const blocked = createRoundMerger({ store, github: { ...port, async inspect(candidate) { return { headSha: 'd'.repeat(40), baseSha: candidate.baseSha, open: true, merged: false, mergeCommitSha: null, mergedByExpectedApp: false, trustedChecksPass: false, rulesetsVerified: true }; } }, now: Date.now });
  const failed = await blocked(next.id); assert.equal(failed.state, 'blocked'); assert.equal(failed.winner!.key.number, 2); assert.equal(merges, 1);
  await store.importProposal({ ...loser, headSha: 'd'.repeat(40) }, []);
  const third = await store.ensureRound(next.closesAt);
  assert.equal((await store.closeRound(third.id, third.closesAt, AUDIT_RULES, 1)).state, 'no_winner');
  const wrongRules = await store.ensureRound(third.closesAt); assert.equal((await store.closeRound(wrongRules.id, wrongRules.closesAt, 'wrong', 1)).state, 'no_winner');
  console.log(`OK community-rounds ${kind}: UTC-boundaries/concurrent-close/late-spend/frozen-winner/carry/head-rules-invalidation/no-votes/blocked-no-runnerup/lost-merge-response`);
}
const ranked = rankCandidates([3, 1, 2].map(number => ({ key: { repositoryId: '1', number }, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), support: 1, admittedAt: number === 3 ? 2 : 1, rulesRevision: AUDIT_RULES })));
assert.deepEqual(ranked.map(candidate => candidate.key.number), [1, 2, 3]);
const app = 123;
const backupRule = { target: 'tag', enforcement: 'active', conditions: { ref_name: { include: ['refs/tags/community-backup/*'], exclude: [] } }, bypass_actors: [], rules: [{ type: 'update' }, { type: 'deletion' }] };
const rules = [{ target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } }, rules: [{ type: 'update' }], bypass_actors: [{ actor_type: 'Integration', actor_id: app, bypass_mode: 'pull_request' }] }, { target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } }, bypass_actors: [], rules: [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: Object.values(COMMUNITY_CHECK_NAMES).map(context => ({ context, integration_id: app })) } }] }, backupRule];
assert(verifyCommunityRulesets(rules, app)); assert(!verifyCommunityRulesets(rules, 456));
assert(!verifyCommunityRulesets([{ ...rules[0], bypass_actors: [{ actor_type: 'Integration', actor_id: app, bypass_mode: 'always' }] }, rules[1], backupRule], app));
assert(!verifyCommunityRulesets([rules[0], { ...rules[1], bypass_actors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'always' }] }, backupRule], app));
assert(!verifyCommunityRulesets(rules.slice(0, 2), app));
console.log('OK community-rounds policy fixtures: deterministic-tie/PR-only-update-bypass/no-bypass-checks/pinned-App (actual repository/App configuration remains an external gate)');
