import type { CommunityPage, PublicProposal } from '../communityApi';

export const proposalStateLabel = (proposal: PublicProposal): string => ({ pending_review: 'Awaiting review', open: 'Open', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', merged: 'Merged', released: 'Released' })[proposal.state];
export const validationLabel = (proposal: PublicProposal): string => ({ needs_implementation: 'Needs implementation', needs_review: 'Needs technical review', ready: 'Technically ready' })[proposal.validation];
export function sourceIsStale(proposal: PublicProposal, page: Pick<CommunityPage, 'staleAfterMs' | 'sourceAvailable'> | null, now: number): boolean {
  return !page?.sourceAvailable || now - proposal.sourceCheckedAt > page.staleAfterMs;
}
export function supportBlockReason(proposal: PublicProposal, page: CommunityPage | null, balance: number | null, now: number): string | null {
  if (!page?.pointsEnabled) return 'Voting is not available yet.';
  if (balance === null) return 'Connect your game account to support a proposal.';
  if (sourceIsStale(proposal, page, now)) return 'Refresh to check the latest GitHub changes.';
  if (page.round.state !== 'open' || now >= page.round.closesAt) return 'This voting round has closed.';
  if (proposal.state !== 'open' || proposal.sourceState !== 'open') return 'This proposal is not open for support.';
  if (proposal.reviewedHeadSha !== proposal.headSha) return 'This version needs review before voting.';
  if (balance < 1) return 'No vote points available.';
  return null;
}
export function communityErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (['proposal-changed', 'proposal-not-ready', 'moderation-changed', 'stale-moderation', 'stale-proposal'].includes(code)) return 'This proposal changed. Refresh and review it again.';
  if (code.includes('round')) return 'The voting round changed. Refresh before supporting.';
  if (code.includes('balance') || code.includes('insufficient')) return 'You do not have enough vote points.';
  if (code === 'points-unavailable') return 'Voting is not available yet.';
  if (code === 'missing-account') return 'Your account connection expired. Reconnect from the title screen.';
  if (code === 'moderator-required') return 'Review permission is unavailable for this account.';
  if (['needs-implementation', 'technical-evidence-mismatch', 'human-technical-evidence-required'].includes(code)) return 'Technical validation is incomplete. This proposal cannot be admitted for merging.';
  if (code.includes('invalid') || code.includes('proposal-url')) return 'Use a pull request URL from the Wandering Hand content repository.';
  return 'Cannot reach the community service. Your confirmed support can be retried safely.';
}
export function detailPages(proposal: PublicProposal, maxChars: number): string[] {
  const text = `${proposal.manifest.title.length > 32 ? `${proposal.manifest.title}\n\n` : ''}${proposal.manifest.description}\n\nCREDIT\n${proposal.manifest.attribution || 'No attribution supplied.'}\n\nFILES\n${proposal.manifest.contentPaths.join('\n') || 'No content files.'}`;
  const pages: string[] = [];
  const maxLines = maxChars < 500 ? 11 : 8;
  const columns = maxChars < 500 ? 28 : 50;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > columns) {
      const split = rest.lastIndexOf(' ', columns);
      const end = split > columns / 2 ? split : columns;
      lines.push(rest.slice(0, end)); rest = rest.slice(end).trimStart();
    }
    lines.push(rest);
  }
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join('\n'));
  return pages;
}
