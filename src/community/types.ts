export const COMMUNITY_REPOSITORY = 'wwang109/wandering-hand-content';
export const COMMUNITY_BODY_MAX_BYTES = 16_384;
export const SHA_PATTERN = /^[a-f0-9]{40}$/;
export type OperationId = string;
export type ProposalCategory = 'card' | 'gem' | 'equipment' | 'event' | 'art';
export type ProposalState = 'pending_review' | 'open' | 'accepted' | 'declined' | 'withdrawn' | 'merged' | 'released';
export interface ProposalKey { repositoryId: string; number: number }
export interface ProposalManifest {
  version: 1;
  title: string;
  category: ProposalCategory;
  description: string;
  attribution: string;
  contentPaths: string[];
  previewPaths: string[];
}
export interface TechnicalAttestation {
  key: ProposalKey;
  headSha: string;
  rulesRevision: string;
  contentApiVersion: number;
  evidenceHash: string;
  validationArtifactSha256?: string;
  reviewerId: string;
  admittedAt: number;
}
export interface ProposalSnapshot {
  key: ProposalKey;
  headSha: string;
  baseSha: string;
  manifest: ProposalManifest;
  manifestPath: string;
  manifestSha256: string;
  moderationRevision: number;
  state: ProposalState;
  sourceState: 'open' | 'closed';
  sourceUrl: string;
  sourceCheckedAt: number;
  importedAt: number;
  mergedCommitSha: string | null;
  reviewedHeadSha: string | null;
  technical: TechnicalAttestation | null;
  validation: 'needs_implementation' | 'needs_review' | 'ready';
  supportTotal: number;
}
export interface ModerationInput {
  key: ProposalKey;
  headSha: string;
  expectedRevision: number;
  decision: 'open' | 'accepted' | 'declined';
  operationId: OperationId;
  note: string;
  technical?: TechnicalAttestation;
}
export interface ModerationReceipt { operationId: string; headSha: string; moderationRevision: number }
export interface CommunityRequest { method: string; path: string; url: URL; authorization: string | null; body: string }
export interface ApiReply<T> { status: number; body: T | { error: string } }
export const proposalKey = (key: ProposalKey): string => `${key.repositoryId}#${key.number}`;
export const contributionUrl = (): string => `https://github.com/${COMMUNITY_REPOSITORY}/blob/main/CONTRIBUTING.md`;
