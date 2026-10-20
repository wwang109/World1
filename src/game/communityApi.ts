import type { ProposalSnapshot } from '../community/types';
import type { VotingRound } from '../community/rounds';
import type { PointEntry, SupportReceipt, Wallet } from '../community/points';
import { accountToken } from './accountSession';
import { battleApiBaseUrl } from './battleApi';

export type PublicProposal = Omit<ProposalSnapshot, 'technical'> & {
  technical: Omit<NonNullable<ProposalSnapshot['technical']>, 'reviewerId'> | null;
};
export interface CommunityPage {
  proposals: PublicProposal[]; nextCursor: string | null; contributionUrl: string;
  sourceAvailable: boolean; pointsEnabled: boolean; round: VotingRound;
  checkedAt: number; staleAfterMs: number;
}
export interface ModerationCapabilities {
  canReview: boolean; canCorrectPoints: boolean; technicalValidationConfigured: boolean;
  reviewEndpoint: string; decisions: readonly string[]; evidenceFields: readonly string[];
  noteMaxLength: number; evidenceMinLength: number; evidenceMaxLength: number; bodyMaxBytes: number;
}
export interface CommunityMe { wallet: Wallet; entries: PointEntry[]; pointsEnabled: boolean; canModerate?: boolean; moderation?: ModerationCapabilities }
export interface ReviewConfirmation {
  number: number; headSha: string; expectedRevision: number; decision: 'open' | 'declined';
  operationId: string; note: string; technicalReady?: true;
  technicalEvidence?: { fightOnOff: string; determinism: string; pairedUi: string; keywordSurfaces: string };
}
export interface SupportConfirmation {
  number: number; title: string; expectedHeadSha: string; moderationRevision: number;
  roundId: string; roundClosesAt: number; amount: number; operationId: string;
}
export class CommunityApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const base = battleApiBaseUrl(import.meta.env.VITE_BATTLE_API as string | undefined, Boolean(import.meta.env.DEV), window.location.hostname);
export const COMMUNITY_CONTRIBUTION_URL = 'https://github.com/wwang109/wandering-hand-content/blob/main/CONTRIBUTING.md';
export const communitySourceUrl = (number: number): string => `https://github.com/wwang109/wandering-hand-content/pull/${number}`;
export const communityPreviewUrl = (proposal: PublicProposal, path: string): string => `${base}/community/proposals/${proposal.key.number}/previews?sha=${encodeURIComponent(proposal.headSha)}&path=${encodeURIComponent(path)}`;
async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = accountToken();
  const response = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(15_000),
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new CommunityApiError(data.error ?? 'community-unavailable', response.status);
  return data;
}
export const fetchCommunityPage = (sort: 'supported' | 'newest', cursor: string | null, limit: number): Promise<CommunityPage> => call(`/community/proposals?sort=${sort}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
export const fetchCommunityDetail = (number: number): Promise<{ proposal: PublicProposal; checkedAt: number; staleAfterMs: number }> => call(`/community/proposals/${number}`);
export const fetchCommunityMe = (cursor = '0'): Promise<CommunityMe> => call(`/community/me?limit=8&cursor=${encodeURIComponent(cursor)}`);
export const importCommunityProposal = (url: string): Promise<{ proposal: PublicProposal }> => call('/community/import', { url });
export const reviewCommunityProposal = (input: ReviewConfirmation): Promise<{ operationId: string; headSha: string; moderationRevision: number }> => call('/community/moderation/review', input);
export const supportCommunityProposal = (confirmation: SupportConfirmation): Promise<SupportReceipt> => {
  const { number, title: _title, roundClosesAt: _roundClosesAt, ...input } = confirmation;
  return call(`/community/proposals/${number}/support`, input);
};
