import type { ProposalKey } from './types';
import { requireCommunity, safeRepositoryPath, validateSha } from './validate';
export interface ProposalPromotion { key: ProposalKey; approvedHeadSha: string; runtimePaths: readonly string[]; runtimeHashes: readonly string[] }
export interface ReleaseReceipt { deploymentId: string; contentSha: string; promotions: readonly ProposalPromotion[] }
export interface ReleaseEvidence { deploymentSucceeded: boolean; deployedContentSha: string; mergedApprovedHead: boolean; runtimeFiles: Readonly<Record<string, string>> }
export function validatePromotion(receipt: ReleaseReceipt, promotion: ProposalPromotion, evidence: ReleaseEvidence): void {
  validateSha(receipt.contentSha); validateSha(promotion.approvedHeadSha);
  requireCommunity(receipt.deploymentId.length > 0 && evidence.deploymentSucceeded && evidence.deployedContentSha === receipt.contentSha && evidence.mergedApprovedHead, 'release-evidence-mismatch', 409);
  requireCommunity(promotion.runtimePaths.length > 0 && promotion.runtimePaths.length === promotion.runtimeHashes.length, 'missing-runtime-promotion');
  promotion.runtimePaths.forEach((path, index) => {
    safeRepositoryPath(path);
    requireCommunity(!path.startsWith('community/') && !path.startsWith('drafts/') && !path.includes('/proposals/'), 'draft-is-not-runtime');
    const hash = promotion.runtimeHashes[index];
    requireCommunity(typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && evidence.runtimeFiles[path] === hash, 'runtime-hash-mismatch', 409);
  });
}
