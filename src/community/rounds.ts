import type { ProposalKey, ProposalSnapshot } from './types';
import type { BackupReceipt } from './backup';
export const ROUND_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const ROUND_EPOCH_MS = Date.UTC(2026, 0, 1);
export interface RoundCandidate { key: ProposalKey; headSha: string; baseSha: string; support: number; admittedAt: number; rulesRevision: string; technicalEvidenceHash?: string; validationArtifactSha256?: string }
export interface VotingRound { id: string; opensAt: number; closesAt: number; state: 'open' | 'closing' | 'no_winner' | 'blocked' | 'merged'; winner?: RoundCandidate; candidates?: RoundCandidate[]; backupReceipt?: BackupReceipt; mergeReceipt?: MergeReceipt; blockedReason?: string }
export interface MergeReceipt { operationId: string; roundId: string; headSha: string; mergeCommitSha: string; mergedAt: number }
export function roundAt(now: number): VotingRound {
  const index = Math.floor((now - ROUND_EPOCH_MS) / ROUND_DURATION_MS);
  const opensAt = ROUND_EPOCH_MS + index * ROUND_DURATION_MS;
  return { id: `utc7:${opensAt}`, opensAt, closesAt: opensAt + ROUND_DURATION_MS, state: 'open' };
}
export function candidateFor(proposal: ProposalSnapshot, rulesRevision: string, contentApiVersion: number): RoundCandidate | null {
  const technical = proposal.technical;
  if (proposal.state !== 'open' || proposal.sourceState !== 'open' || proposal.supportTotal <= 0 || !technical || technical.headSha !== proposal.headSha || proposal.reviewedHeadSha !== proposal.headSha || technical.rulesRevision !== rulesRevision || technical.contentApiVersion !== contentApiVersion || proposal.validation !== 'ready') return null;
  return { key: proposal.key, headSha: proposal.headSha, baseSha: proposal.baseSha, support: proposal.supportTotal, admittedAt: technical.admittedAt, rulesRevision, technicalEvidenceHash: technical.evidenceHash, ...(technical.validationArtifactSha256 ? { validationArtifactSha256: technical.validationArtifactSha256 } : {}) };
}
export function rankCandidates(candidates: readonly RoundCandidate[]): RoundCandidate[] {
  return [...candidates].filter(candidate => candidate.support > 0).sort((a, b) => b.support - a.support || a.admittedAt - b.admittedAt || a.key.number - b.key.number);
}
