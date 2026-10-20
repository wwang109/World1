import type { SupportInput, SupportReceipt } from '../../community/points';
import { validateSupport } from '../../community/points';
import { requireCommunity } from '../../community/validate';
import type { CommunityStore } from './store';
import type { GitHubReadPort } from './github';
export function createSupportService(deps: { store: CommunityStore; github: GitHubReadPort | null; now: () => number; hash: (value: string) => Promise<string>; randomId: () => string }) {
  return async function spendSupport(accountId: string, input: SupportInput): Promise<SupportReceipt> {
    validateSupport(input);
    const payloadHash = await deps.hash(JSON.stringify({ key: input.key, expectedHeadSha: input.expectedHeadSha, moderationRevision: input.moderationRevision, roundId: input.roundId, amount: input.amount, operationId: input.operationId }));
    const previous = await deps.store.supportReceipt(accountId, input.operationId, payloadHash);
    if (previous) return previous;
    requireCommunity(deps.github, 'github-source-unavailable', 503);
    const pr = await deps.github.readPr(input.key);
    requireCommunity(pr.headSha === input.expectedHeadSha && pr.state === 'open' && !pr.mergedCommitSha, 'proposal-changed', 409);
    const now = deps.now();
    return deps.store.spendSupport({ accountId, input, payloadHash, sourceConfirmedAt: now, now, entryId: deps.randomId() });
  };
}
