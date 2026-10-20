import type { MergeReceipt, RoundCandidate, VotingRound } from '../../community/rounds';
import { CommunityError, requireCommunity } from '../../community/validate';
import type { CommunityStore } from './store';
import { verifyBackupReceipt, type BackupReceipt } from '../../community/backup';
export interface MergeInspection { headSha: string; baseSha: string; open: boolean; merged: boolean; mergeCommitSha: string | null; mergedByExpectedApp: boolean; trustedChecksPass: boolean; rulesetsVerified: boolean }
export interface GitHubMergePort {
  inspect(candidate: RoundCandidate): Promise<MergeInspection>;
  ensureBackup(candidate: RoundCandidate, roundId: string): Promise<BackupReceipt>;
  verifyBackup(candidate: RoundCandidate, roundId: string, receipt: BackupReceipt): Promise<void>;
  recordVoteWinner(candidate: RoundCandidate, roundId: string, backup: BackupReceipt): Promise<void>;
  approve(candidate: RoundCandidate, backup: BackupReceipt): Promise<void>;
  merge(candidate: RoundCandidate, backup: BackupReceipt): Promise<{ mergeCommitSha: string }>;
}
export function createRoundMerger(deps: { store: CommunityStore; github: GitHubMergePort | null; now: () => number }) {
  return async function mergeRoundWinner(roundId: string): Promise<VotingRound> {
    const frozen = await deps.store.getRound(roundId);
    requireCommunity(frozen && frozen.state !== 'open', 'round-not-closed', 409);
    if (frozen.state !== 'closing') return frozen;
    requireCommunity(frozen.winner, 'round-no-winner', 409);
    requireCommunity(deps.github, 'merge-automation-unconfigured', 503);
    const candidate = frozen.winner;
    let backup = frozen.backupReceipt;
    const receipt = (mergeCommitSha: string): MergeReceipt => ({ operationId: `merge:${roundId}`, roundId, headSha: candidate.headSha, mergeCommitSha, mergedAt: deps.now() });
    try {
      let current = await deps.github.inspect(candidate);
      if (current.merged) {
        requireCommunity(current.headSha === candidate.headSha && current.mergedByExpectedApp && current.mergeCommitSha, 'unexpected-merge-source', 409);
        requireCommunity(backup, 'confirmed-backup-required', 409);
        await verifyBackupReceipt(roundId, candidate, backup); await deps.github.verifyBackup(candidate, roundId, backup);
        return deps.store.finishMerge(roundId, receipt(current.mergeCommitSha));
      }
      requireCommunity(current.open && current.headSha === candidate.headSha && current.baseSha === candidate.baseSha && current.rulesetsVerified, 'winner-final-source-or-rules-changed', 409);
      if (!backup) {
        const confirmed = await deps.github.ensureBackup(candidate, roundId);
        await verifyBackupReceipt(roundId, candidate, confirmed);
        await deps.github.verifyBackup(candidate, roundId, confirmed);
        backup = await deps.store.recordBackup(roundId, confirmed);
      }
      await verifyBackupReceipt(roundId, candidate, backup); await deps.github.verifyBackup(candidate, roundId, backup);
      await deps.github.recordVoteWinner(candidate, roundId, backup);
      current = await deps.github.inspect(candidate);
      if (current.merged) {
        requireCommunity(current.headSha === candidate.headSha && current.mergedByExpectedApp && current.mergeCommitSha, 'unexpected-merge-source', 409);
        await deps.github.verifyBackup(candidate, roundId, backup);
        return deps.store.finishMerge(roundId, receipt(current.mergeCommitSha));
      }
      requireCommunity(current.open && current.headSha === candidate.headSha && current.baseSha === candidate.baseSha && current.rulesetsVerified && current.trustedChecksPass, 'winner-final-checks-failed', 409);
      await deps.github.verifyBackup(candidate, roundId, backup);
      await deps.github.approve(candidate, backup);
      await deps.github.verifyBackup(candidate, roundId, backup);
      const result = await deps.github.merge(candidate, backup);
      return deps.store.finishMerge(roundId, receipt(result.mergeCommitSha));
    } catch (error) {
      if (error instanceof CommunityError && error.status === 409) return deps.store.finishMerge(roundId, { blockedReason: error.message });
      throw error;
    }
  };
}
