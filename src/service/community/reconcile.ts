import type { ProposalSnapshot } from '../../community/types';
import { proposalKey } from '../../community/types';
import { CommunityError, requireCommunity } from '../../community/validate';
import type { CommunityStore } from './store';
import type { GitHubReadPort } from './github';
import { createProposalImporter } from './importer';
export interface SourceReconcileDeps { store: CommunityStore; github: GitHubReadPort | null; now: () => number; randomId: () => string; hashBytes: (bytes: Uint8Array) => Promise<string>; budget: number; intervalMs: number }
export async function cachedProposals(store: CommunityStore): Promise<ProposalSnapshot[]> {
  const result: ProposalSnapshot[] = [];
  for (let page = 0; page < 20; page++) { const batch = await store.listProposals(page * 50, 50, 'supported'); result.push(...batch); if (batch.length < 50) return result; }
  throw new CommunityError(503, 'source-cache-scan-budget-exhausted');
}
export async function sourcesFreshForRound(store: CommunityStore, roundId: string): Promise<boolean> {
  const round = await store.getRound(roundId); requireCommunity(round, 'round-not-found', 404);
  return (await cachedProposals(store)).filter(proposal => proposal.state === 'open' && proposal.sourceState === 'open' && proposal.supportTotal > 0 && proposal.technical).every(proposal => proposal.sourceCheckedAt >= round.closesAt);
}
export async function reconcileCommunitySources(deps: SourceReconcileDeps): Promise<{ ran: boolean; healthy: boolean; updated: number; invalid: number; pending: number }> {
  requireCommunity(Number.isSafeInteger(deps.budget) && deps.budget >= 1 && deps.budget <= 10 && deps.intervalMs >= 60_000, 'invalid-source-sync-budget');
  const now = deps.now();
  if (!deps.github) return { ran: false, healthy: false, updated: 0, invalid: 0, pending: 0 };
  const token = deps.randomId();
  const checkpoint = await deps.store.claimSourceSync(now, token, 4 * 60_000);
  if (!checkpoint) {
    const previous = await deps.store.sourceSync();
    return { ran: false, healthy: previous.leaseUntil <= now && !previous.lastError && previous.lastSuccessAt !== null && now - previous.lastSuccessAt <= 2 * deps.intervalMs, updated: 0, invalid: 0, pending: previous.pending.length };
  }
  let updated = 0; let invalid = 0;
  const importer = createProposalImporter({ github: deps.github, store: deps.store, now: deps.now, sha256: deps.hashBytes });
  checkpoint.lastAttemptAt = now; checkpoint.lastError = null;
  try {
    const due = await deps.store.dueRounds(now);
    const closes = await Promise.all(due.slice(0, 20).map(id => deps.store.getRound(id)));
    const threshold = Math.max(now - 60 * 60_000, ...closes.map(round => round?.closesAt ?? 0));
    const cached = await cachedProposals(deps.store);
    const priority = cached.filter(proposal => proposal.sourceState === 'open' && proposal.state === 'open' && proposal.supportTotal > 0 && proposal.sourceCheckedAt < threshold).sort((a, b) => a.sourceCheckedAt - b.sourceCheckedAt || a.key.number - b.key.number).map(proposal => proposal.key);
    const recent = await deps.github.listChangedPrs(null, 5);
    const recentChanges = recent.keys.filter(key => {
      const previous = cached.find(proposal => proposalKey(proposal.key) === proposalKey(key));
      const version = recent.versions?.find(value => proposalKey(value.key) === proposalKey(key));
      return !previous || previous.sourceCheckedAt < now - 60 * 60_000 || Boolean(version && (version.headSha !== previous.headSha || version.baseSha !== previous.baseSha || version.state !== previous.sourceState));
    });
    checkpoint.pending = [...recentChanges, ...checkpoint.pending].filter((key, index, all) => all.findIndex(other => proposalKey(other) === proposalKey(key)) === index).slice(0, 100);
    if (checkpoint.pending.length === 0) {
      if (checkpoint.cursor !== null) { const page = await deps.github.listChangedPrs(checkpoint.cursor, 5); checkpoint.pending = page.keys; checkpoint.cursor = page.nextCursor; }
      else { checkpoint.cursor = recent.nextCursor; checkpoint.cycleCompletedAt = deps.now(); }
    }
    const selected = [...priority, ...checkpoint.pending].filter((key, index, all) => all.findIndex(other => proposalKey(other) === proposalKey(key)) === index).slice(0, deps.budget);
    for (const key of selected) {
      try {
        await importer.importProposal(key); updated++; checkpoint.lastSuccessAt = deps.now();
        checkpoint.pending = checkpoint.pending.filter(other => proposalKey(other) !== proposalKey(key));
      } catch (error) {
        if (error instanceof CommunityError && error.status === 400) { await deps.store.suspendProposal(key, deps.now()); invalid++; checkpoint.pending = checkpoint.pending.filter(other => proposalKey(other) !== proposalKey(key)); }
        else { checkpoint.lastError = error instanceof CommunityError && error.status === 409 ? 'source-revision-race' : 'github-source-unavailable'; if (!checkpoint.pending.some(other => proposalKey(other) === proposalKey(key))) checkpoint.pending.unshift(key); break; }
      }
    }
    if (!checkpoint.lastError) checkpoint.lastSuccessAt = deps.now();
    if (!checkpoint.lastError && checkpoint.pending.length === 0 && checkpoint.cursor === null) checkpoint.cycleCompletedAt = deps.now();
  } catch { checkpoint.lastError = 'github-source-unavailable'; }
  checkpoint.nextPollAt = now + (checkpoint.lastError ? Math.max(deps.intervalMs, 15 * 60_000) : deps.intervalMs);
  const saved = await deps.store.finishSourceSync(token, checkpoint);
  return { ran: true, healthy: !saved.lastError, updated, invalid, pending: saved.pending.length };
}
