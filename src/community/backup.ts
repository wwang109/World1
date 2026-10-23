import { COMMUNITY_REPOSITORY, type ProposalKey } from './types';
import type { RoundCandidate, VotingRound } from './rounds';
import { requireCommunity, validateSha } from './validate';
export interface BackupManifest {
  version: 1;
  repository: typeof COMMUNITY_REPOSITORY;
  repositoryId: string;
  roundId: string;
  operationId: string;
  reference: string;
  baseSha: string;
  winner: { key: ProposalKey; headSha: string; technicalEvidenceHash: string };
}
export interface BackupReceipt { manifest: BackupManifest; manifestSha256: string; confirmedAt: number }
async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function backupManifestJson(manifest: BackupManifest): string {
  return JSON.stringify({ version: manifest.version, repository: manifest.repository, repositoryId: manifest.repositoryId, roundId: manifest.roundId, operationId: manifest.operationId, reference: manifest.reference, baseSha: manifest.baseSha, winner: { key: { repositoryId: manifest.winner.key.repositoryId, number: manifest.winner.key.number }, headSha: manifest.winner.headSha, technicalEvidenceHash: manifest.winner.technicalEvidenceHash } });
}
export async function backupManifest(roundId: string, candidate: RoundCandidate): Promise<BackupManifest> {
  requireCommunity(/^[A-Za-z0-9:_-]{1,100}$/.test(roundId), 'invalid-backup-round');
  validateSha(candidate.baseSha); validateSha(candidate.headSha);
  requireCommunity(/^\d+$/.test(candidate.key.repositoryId) && Number.isSafeInteger(candidate.key.number) && candidate.key.number > 0 && /^[a-f0-9]{64}$/.test(candidate.technicalEvidenceHash ?? ''), 'invalid-backup-winner', 409);
  return { version: 1, repository: COMMUNITY_REPOSITORY, repositoryId: candidate.key.repositoryId, roundId, operationId: `backup:${roundId}`, reference: `refs/tags/community-backup/${await hash(roundId)}`, baseSha: candidate.baseSha, winner: { key: candidate.key, headSha: candidate.headSha, technicalEvidenceHash: candidate.technicalEvidenceHash! } };
}
export async function makeBackupReceipt(roundId: string, candidate: RoundCandidate, now: number): Promise<BackupReceipt> {
  const manifest = await backupManifest(roundId, candidate);
  return { manifest, manifestSha256: await hash(backupManifestJson(manifest)), confirmedAt: now };
}
export function assertBackupIdentity(round: VotingRound, receipt: BackupReceipt): void {
  const manifest = receipt.manifest;
  requireCommunity(round.winner && manifest.version === 1 && manifest.repository === COMMUNITY_REPOSITORY && manifest.roundId === round.id && manifest.operationId === `backup:${round.id}` && manifest.repositoryId === round.winner.key.repositoryId && manifest.baseSha === round.winner.baseSha && manifest.winner.key.repositoryId === round.winner.key.repositoryId && manifest.winner.key.number === round.winner.key.number && manifest.winner.headSha === round.winner.headSha && manifest.winner.technicalEvidenceHash === round.winner.technicalEvidenceHash && /^refs\/tags\/community-backup\/[a-f0-9]{64}$/.test(manifest.reference) && /^[a-f0-9]{64}$/.test(receipt.manifestSha256) && Number.isSafeInteger(receipt.confirmedAt) && receipt.confirmedAt > 0, 'backup-receipt-mismatch', 409);
}
export async function verifyBackupReceipt(roundId: string, candidate: RoundCandidate, receipt: BackupReceipt): Promise<void> {
  const expected = await makeBackupReceipt(roundId, candidate, receipt.confirmedAt);
  requireCommunity(backupManifestJson(receipt.manifest) === backupManifestJson(expected.manifest) && receipt.manifestSha256 === expected.manifestSha256, 'backup-manifest-digest-mismatch', 409);
}
