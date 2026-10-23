import type { EligibleRun, RevisionKey } from '../../run/online/types';

export interface ExecutorArchive {
  key: RevisionKey;
  sourceDigest: string;
  files: Readonly<Record<string, string>>;
  artFiles: Readonly<Record<string, string>>;
  sourceCommit: string;
  archiveId: string;
}
export function revisionId(key: RevisionKey): string { return `${key.rulesRevision}:${key.contentSha}`; }
export function migrateEligibleRun(_run: EligibleRun, _targetKey: RevisionKey): EligibleRun {
  throw new Error('No eligible-run migration has been approved; retain the exact executor');
}
