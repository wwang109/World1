import assert from 'node:assert/strict';
import { auditStore, auditProposal, AUDIT_HEAD } from './community-audit-fixtures';
import { validatePromotion, type ReleaseReceipt } from '../src/community/release';
for (const kind of ['file', 'd1'] as const) {
  const { store } = await auditStore(kind); const proposal = auditProposal();
  await store.importProposal(proposal, []);
  await assert.rejects(() => store.markReleased(proposal.key, AUDIT_HEAD, 'deployment', 'd'.repeat(40)));
  await store.importProposal({ ...proposal, sourceState: 'closed', mergedCommitSha: 'e'.repeat(40) }, []);
  assert.equal((await store.getProposal(proposal.key))!.state, 'merged');
  const promotion = { key: proposal.key, approvedHeadSha: AUDIT_HEAD, runtimePaths: ['src/data/content/skills.v1.json'], runtimeHashes: ['f'.repeat(64)] };
  const receipt: ReleaseReceipt = { deploymentId: 'actual-deployment-fixture', contentSha: 'd'.repeat(40), promotions: [promotion] };
  const evidence = { deploymentSucceeded: true, deployedContentSha: receipt.contentSha, mergedApprovedHead: true, runtimeFiles: { 'src/data/content/skills.v1.json': 'f'.repeat(64) } };
  assert.throws(() => validatePromotion(receipt, { ...promotion, runtimePaths: [proposal.manifestPath] }, evidence), /draft-is-not-runtime/);
  assert.throws(() => validatePromotion(receipt, promotion, { ...evidence, deploymentSucceeded: false }));
  assert.throws(() => validatePromotion(receipt, promotion, { ...evidence, mergedApprovedHead: false }));
  assert.throws(() => validatePromotion(receipt, promotion, { ...evidence, runtimeFiles: {} }));
  assert.equal((await store.getProposal(proposal.key))!.state, 'merged');
  validatePromotion(receipt, promotion, evidence);
  await store.markReleased(proposal.key, AUDIT_HEAD, receipt.deploymentId, receipt.contentSha);
  assert.equal((await store.getProposal(proposal.key))!.state, 'released');
  console.log(`OK community-release ${kind}: unmerged/draft-only/failed-deploy/stale-hash-stay-unreleased/actual-promotion`);
}
