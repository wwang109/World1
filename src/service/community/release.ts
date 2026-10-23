import type { CommunityStore } from './store';
import { validatePromotion, type ReleaseReceipt } from '../../community/release';
import { requireCommunity } from '../../community/validate';
export interface ReleaseProofPort {
  deployment(id: string): Promise<{ succeeded: boolean; contentSha: string; runtimeFiles: Readonly<Record<string, string>> }>;
  mergedAncestor(repositoryId: string, number: number, approvedHeadSha: string, contentSha: string): Promise<boolean>;
}
export function createReleaseRecorder(store: CommunityStore, proof: ReleaseProofPort, options: { dryRun?: boolean } = {}) {
  return async function markReleased(receipt: ReleaseReceipt): Promise<void> {
    requireCommunity(receipt.promotions.length > 0 && receipt.promotions.length <= 50, 'invalid-promotion-count');
    const deployed = await proof.deployment(receipt.deploymentId);
    for (const promotion of receipt.promotions) {
      const mergedApprovedHead = await proof.mergedAncestor(promotion.key.repositoryId, promotion.key.number, promotion.approvedHeadSha, receipt.contentSha);
      validatePromotion(receipt, promotion, { deploymentSucceeded: deployed.succeeded, deployedContentSha: deployed.contentSha, mergedApprovedHead, runtimeFiles: deployed.runtimeFiles });
    }
    if (options.dryRun) { for (const promotion of receipt.promotions) { const proposal = await store.getProposal(promotion.key); requireCommunity(proposal?.headSha === promotion.approvedHeadSha && proposal.mergedCommitSha, 'release-source-mismatch', 409); } return; }
    for (const promotion of receipt.promotions) await store.markReleased(promotion.key, promotion.approvedHeadSha, receipt.deploymentId, receipt.contentSha);
  };
}
