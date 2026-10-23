import type { ModerationInput, ModerationReceipt, ProposalKey, ProposalSnapshot } from '../../community/types';
import type { CorrectionInput, CorrectionReceipt, PointEntry, SupportInput, SupportReceipt, Wallet } from '../../community/points';
import type { MergeReceipt, VotingRound } from '../../community/rounds';
import type { BackupReceipt } from '../../community/backup';
import type { SourceSyncCheckpoint } from '../../community/sourceSync';
export interface StoredAsset { key: ProposalKey; headSha: string; path: string; hash: string; contentType: string; width: number; height: number }
export interface ModerationCommit { accountId: string; input: ModerationInput; payloadHash: string; now: number }
export interface SupportCommit { accountId: string; input: SupportInput; payloadHash: string; sourceConfirmedAt: number; now: number; entryId: string }
export interface CommunityStore {
  getProposal(key: ProposalKey): Promise<ProposalSnapshot | null>;
  listProposals(offset: number, limit: number, sort: 'supported' | 'newest'): Promise<ProposalSnapshot[]>;
  importProposal(snapshot: ProposalSnapshot, assets: readonly StoredAsset[]): Promise<ProposalSnapshot>;
  suspendProposal(key: ProposalKey, checkedAt: number): Promise<void>;
  sourceSync(): Promise<SourceSyncCheckpoint>;
  claimSourceSync(now: number, token: string, leaseMs: number): Promise<SourceSyncCheckpoint | null>;
  finishSourceSync(token: string, checkpoint: SourceSyncCheckpoint): Promise<SourceSyncCheckpoint>;
  getAsset(key: ProposalKey, headSha: string, path: string): Promise<StoredAsset | null>;
  moderate(commit: ModerationCommit): Promise<ModerationReceipt>;
  wallet(accountId: string): Promise<Wallet>;
  ledger(accountId: string, offset: number, limit: number): Promise<PointEntry[]>;
  supportReceipt(accountId: string, operationId: string, payloadHash: string): Promise<SupportReceipt | null>;
  spendSupport(commit: SupportCommit): Promise<SupportReceipt>;
  correctPoints(input: CorrectionInput, moderatorId: string, payloadHash: string, entryId: string, now: number): Promise<CorrectionReceipt>;
  ensureRound(now: number): Promise<VotingRound>;
  getRound(id: string): Promise<VotingRound | null>;
  dueRounds(now: number): Promise<string[]>;
  closeRound(id: string, now: number, rulesRevision: string, contentApiVersion: number): Promise<VotingRound>;
  recordBackup(id: string, receipt: BackupReceipt): Promise<BackupReceipt>;
  finishMerge(id: string, receipt: MergeReceipt | { blockedReason: string }): Promise<VotingRound>;
  markReleased(key: ProposalKey, headSha: string, deploymentId: string, contentSha: string): Promise<void>;
}
