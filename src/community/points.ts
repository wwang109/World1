import type { ProposalKey } from './types';
import { requireCommunity, validateOperationId, validateSha } from './validate';
export interface Wallet { accountId: string; balance: number; revision: number }
export interface PointEntry { id: string; accountId: string; delta: number; reason: 'boss' | 'support' | 'correction'; sourceKey: string; operationId: string; payloadHash: string; receipt: unknown; createdAt: number }
export interface SupportInput { key: ProposalKey; expectedHeadSha: string; moderationRevision: number; roundId: string; amount: number; operationId: string }
export interface SupportReceipt { entryId: string; key: ProposalKey; headSha: string; amount: number; balance: number; roundId: string; operationId: string }
export interface BossPointReceipt { entryId: string; pointsEarned: 1; balance: number }
export interface CorrectionInput { accountId: string; delta: number; operationId: string; reason: string }
export interface CorrectionReceipt { entryId: string; accountId: string; delta: number; balance: number; reason: string; moderatorId: string }
export function validateSupport(input: SupportInput): void {
  validateSha(input.expectedHeadSha);
  validateOperationId(input.operationId);
  requireCommunity(Number.isSafeInteger(input.amount) && input.amount > 0, 'invalid-support-amount');
  requireCommunity(Number.isSafeInteger(input.moderationRevision) && input.moderationRevision >= 0, 'invalid-moderation-revision');
  requireCommunity(typeof input.roundId === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(input.roundId), 'invalid-round');
}
