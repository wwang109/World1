import type { ProposalKey, TechnicalAttestation } from '../../community/types';
import { requireCommunity } from '../../community/validate';
export interface TrustedTechnicalEvidence {
  repositoryId: string;
  number: number;
  headSha: string;
  rulesRevision: string;
  contentApiVersion: number;
  evidenceHash: string;
  implemented: boolean;
  supportedKinds: boolean;
  schemas: boolean;
  tierBalanceAndCaps: boolean;
  keywordSurfaces: boolean;
  fightOnOff: boolean;
  determinism: boolean;
  pairedUi: boolean;
  imageDecode: boolean;
}
export interface TechnicalReadinessPort { evidence(key: ProposalKey, headSha: string): Promise<TrustedTechnicalEvidence | null> }
export interface HumanTechnicalEvidence { fightOnOff: string; determinism: string; pairedUi: string; keywordSurfaces: string }
export async function technicalAttestation(port: TechnicalReadinessPort | null, key: ProposalKey, headSha: string, rulesRevision: string, contentApiVersion: number, reviewerId: string, now: number, human?: HumanTechnicalEvidence, hash?: (value: string) => Promise<string>): Promise<TechnicalAttestation> {
  requireCommunity(port, 'needs-implementation', 409);
  const evidence = await port.evidence(key, headSha);
  requireCommunity(evidence && evidence.repositoryId === key.repositoryId && evidence.number === key.number && evidence.headSha === headSha && evidence.rulesRevision === rulesRevision && evidence.contentApiVersion === contentApiVersion && /^[a-f0-9]{64}$/.test(evidence.evidenceHash), 'technical-evidence-mismatch', 409);
  requireCommunity(['implemented', 'supportedKinds', 'schemas', 'tierBalanceAndCaps', 'imageDecode'].every(key => evidence[key as keyof TrustedTechnicalEvidence] === true), 'needs-implementation', 409);
  requireCommunity(human && hash && Object.values(human).every(value => typeof value === 'string' && value.trim().length >= 20 && value.length <= 2000), 'human-technical-evidence-required', 400);
  const evidenceHash = await hash(JSON.stringify({ key, headSha, rulesRevision, contentApiVersion, reviewerId, validationArtifactSha256: evidence.evidenceHash, human }));
  return { key, headSha, rulesRevision, contentApiVersion, evidenceHash, validationArtifactSha256: evidence.evidenceHash, reviewerId, admittedAt: now };
}
