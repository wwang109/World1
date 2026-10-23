import type { ProposalKey } from './types';
export interface SourceSyncCheckpoint {
  revision: number;
  cursor: string | null;
  pending: ProposalKey[];
  cycleCompletedAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  nextPollAt: number;
  leaseToken: string | null;
  leaseUntil: number;
}
export const emptySourceSync = (): SourceSyncCheckpoint => ({ revision: 0, cursor: null, pending: [], cycleCompletedAt: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null, nextPollAt: 0, leaseToken: null, leaseUntil: 0 });
