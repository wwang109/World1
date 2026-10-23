import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { proposalKey, type ModerationReceipt, type ProposalSnapshot } from '../src/community/types';
import { requireCommunity } from '../src/community/validate';
import { validateSupport, type CorrectionReceipt, type SupportReceipt } from '../src/community/points';
import { candidateFor, rankCandidates, roundAt, type VotingRound } from '../src/community/rounds';
import { assertBackupIdentity, verifyBackupReceipt } from '../src/community/backup';
import { emptySourceSync, type SourceSyncCheckpoint } from '../src/community/sourceSync';
import { initializePointState, pointWallet, type PointState } from '../src/service/community/pointStore';
import type { CommunityStore, StoredAsset } from '../src/service/community/store';

export interface DurableCommunityState {
  read<T>(namespace: string): T | undefined;
  transaction<T>(fn: (state: Record<string, unknown>) => T): Promise<T>;
}
const coordinators = new Map<string, DurableCommunityState>();
export function createDurableCommunityState(filePath = '.tmp/eligible-community-state.json'): DurableCommunityState {
  const absolute = resolve(filePath);
  const existing = coordinators.get(absolute);
  if (existing) return existing;
  const read = (): Record<string, unknown> => {
    if (!existsSync(absolute)) return {};
    const value: unknown = JSON.parse(readFileSync(absolute, 'utf8'));
    requireCommunity(value !== null && typeof value === 'object' && !Array.isArray(value), 'durable-state-corrupt', 503);
    return value as Record<string, unknown>;
  };
  let queue = Promise.resolve();
  const coordinator: DurableCommunityState = {
    read<T>(namespace: string): T | undefined { return structuredClone(read()[namespace]) as T | undefined; },
    transaction<T>(fn: (state: Record<string, unknown>) => T): Promise<T> {
      const operation = queue.then(async () => {
        const draft = read();
        const result = fn(draft);
        requireCommunity(!(result instanceof Promise), 'async-durable-transaction');
        mkdirSync(dirname(absolute), { recursive: true });
        const temporary = `${absolute}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify(draft), { encoding: 'utf8', flush: true });
        for (let attempt = 0;; attempt++) {
          try { renameSync(temporary, absolute); break; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 19 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
            await delay(10);
          }
        }
        return structuredClone(result);
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
  coordinators.set(absolute, coordinator);
  return coordinator;
}
interface FileCommunityState extends PointState {
  proposals: Record<string, ProposalSnapshot>;
  assets: Record<string, StoredAsset>;
  moderation: { accountId: string; operationId: string; payloadHash: string; note: string; receipt: ModerationReceipt }[];
  rounds: Record<string, VotingRound>;
  releases: { key: string; headSha: string; deploymentId: string; contentSha: string }[];
  sourceSync: SourceSyncCheckpoint;
}
function communityState(root: Record<string, unknown>): FileCommunityState {
  const old = root.community as Partial<FileCommunityState> | undefined;
  return root.community = { ...initializePointState(old), proposals: old?.proposals ?? {}, assets: old?.assets ?? {}, moderation: old?.moderation ?? [], rounds: old?.rounds ?? {}, releases: old?.releases ?? [], sourceSync: old?.sourceSync ?? emptySourceSync() };
}
function importInto(state: FileCommunityState, snapshot: ProposalSnapshot): ProposalSnapshot {
  const previous = state.proposals[proposalKey(snapshot.key)];
  const sameHead = previous?.headSha === snapshot.headSha;
  const imported: ProposalSnapshot = { ...snapshot, importedAt: previous?.importedAt ?? snapshot.importedAt, moderationRevision: previous?.moderationRevision ?? 0, reviewedHeadSha: sameHead ? previous.reviewedHeadSha : null, technical: sameHead ? previous.technical : null, supportTotal: 0 };
  if (sameHead && snapshot.sourceState === 'open') {
    imported.state = previous.state === 'released' ? 'released' : previous.state;
    imported.validation = previous.validation;
  }
  if (snapshot.mergedCommitSha) imported.state = sameHead && previous?.state === 'released' ? 'released' : 'merged';
  else if (snapshot.sourceState === 'closed') imported.state = previous?.state === 'declined' ? 'declined' : 'withdrawn';
  else if (!sameHead) { imported.state = 'pending_review'; imported.validation = 'needs_review'; }
  state.proposals[proposalKey(snapshot.key)] = imported;
  return imported;
}
function withTotals(state: FileCommunityState, snapshot: ProposalSnapshot, before = Infinity): ProposalSnapshot {
  const total = state.ledger.filter(entry => entry.reason === 'support' && entry.createdAt < before && (entry.receipt as SupportReceipt).key.repositoryId === snapshot.key.repositoryId && (entry.receipt as SupportReceipt).key.number === snapshot.key.number && (entry.receipt as SupportReceipt).headSha === snapshot.headSha).reduce((sum, entry) => sum - entry.delta, 0);
  return { ...snapshot, supportTotal: total };
}
export function createFileCommunityStore(coordinator: DurableCommunityState | string = createDurableCommunityState()): CommunityStore {
  const durable = typeof coordinator === 'string' ? createDurableCommunityState(coordinator) : coordinator;
  const read = (): FileCommunityState => communityState({ community: durable.read('community') });
  return {
    async getProposal(key) { const state = read(); const result = state.proposals[proposalKey(key)]; return result ? withTotals(state, result) : null; },
    async listProposals(offset, limit, sort) {
      const state = read();
      return Object.values(state.proposals).map(item => withTotals(state, item)).sort((a, b) => sort === 'newest' ? b.importedAt - a.importedAt || b.key.number - a.key.number : b.supportTotal - a.supportTotal || (a.technical?.admittedAt ?? a.importedAt) - (b.technical?.admittedAt ?? b.importedAt) || a.key.number - b.key.number).slice(offset, offset + limit);
    },
    async importProposal(snapshot, assets) { return durable.transaction(root => { const state = communityState(root); const result = importInto(state, snapshot); for (const asset of assets) state.assets[`${proposalKey(asset.key)}:${asset.headSha}:${asset.path}`] = asset; return withTotals(state, result); }); },
    async suspendProposal(key, checkedAt) { await durable.transaction(root => { const proposal = communityState(root).proposals[proposalKey(key)]; if (proposal && !proposal.mergedCommitSha) { proposal.state = 'pending_review'; proposal.reviewedHeadSha = null; proposal.technical = null; proposal.validation = 'needs_review'; proposal.sourceCheckedAt = checkedAt; } }); },
    async sourceSync() { return read().sourceSync; },
    async claimSourceSync(now, token, leaseMs) { return durable.transaction(root => { const state = communityState(root); const checkpoint = state.sourceSync; if (checkpoint.nextPollAt > now || checkpoint.leaseUntil > now) return null; checkpoint.revision++; checkpoint.leaseToken = token; checkpoint.leaseUntil = now + leaseMs; return checkpoint; }); },
    async finishSourceSync(token, checkpoint) { return durable.transaction(root => { const state = communityState(root); requireCommunity(state.sourceSync.leaseToken === token && state.sourceSync.revision === checkpoint.revision, 'source-sync-lease-changed', 409); state.sourceSync = { ...checkpoint, pending: [...checkpoint.pending], leaseToken: null, leaseUntil: 0, revision: checkpoint.revision + 1 }; return state.sourceSync; }); },
    async getAsset(key, headSha, path) { return read().assets[`${proposalKey(key)}:${headSha}:${path}`] ?? null; },
    async moderate({ accountId, input, payloadHash, now }) { return durable.transaction(root => {
      const state = communityState(root);
      const previous = state.moderation.find(entry => entry.accountId === accountId && entry.operationId === input.operationId);
      if (previous) { requireCommunity(previous.payloadHash === payloadHash, 'operation-payload-mismatch', 409); return previous.receipt; }
      const snapshot = state.proposals[proposalKey(input.key)];
      requireCommunity(snapshot && snapshot.headSha === input.headSha && snapshot.moderationRevision === input.expectedRevision && snapshot.sourceState === 'open', 'stale-review', 409);
      snapshot.state = input.decision; snapshot.reviewedHeadSha = input.headSha; snapshot.moderationRevision++;
      snapshot.technical = input.technical ? { ...input.technical, reviewerId: accountId, admittedAt: now } : null;
      snapshot.validation = input.technical ? 'ready' : 'needs_implementation';
      const receipt = { operationId: input.operationId, headSha: input.headSha, moderationRevision: snapshot.moderationRevision };
      state.moderation.push({ accountId, operationId: input.operationId, payloadHash, note: input.note, receipt });
      return receipt;
    }); },
    async wallet(accountId) { return pointWallet(read(), accountId); },
    async ledger(accountId, offset, limit) { return read().ledger.filter(entry => entry.accountId === accountId).reverse().slice(offset, offset + limit); },
    async supportReceipt(accountId, operationId, payloadHash) { const previous = read().ledger.find(entry => entry.accountId === accountId && entry.operationId === operationId); if (!previous) return null; requireCommunity(previous.payloadHash === payloadHash && previous.reason === 'support', 'operation-payload-mismatch', 409); return previous.receipt as SupportReceipt; },
    async spendSupport({ accountId, input, payloadHash, sourceConfirmedAt, now, entryId }) { return durable.transaction(root => {
      validateSupport(input);
      const state = communityState(root);
      const previous = state.ledger.find(entry => entry.accountId === accountId && entry.operationId === input.operationId);
      if (previous) { requireCommunity(previous.payloadHash === payloadHash && previous.reason === 'support', 'operation-payload-mismatch', 409); return previous.receipt as SupportReceipt; }
      const snapshot = state.proposals[proposalKey(input.key)];
      const round = state.rounds[input.roundId];
      const commitTime = Date.now();
      requireCommunity(round?.state === 'open' && now >= round.opensAt && now < round.closesAt && commitTime >= round.opensAt && commitTime < round.closesAt, 'round-closed', 409);
      requireCommunity(sourceConfirmedAt >= now - 30_000 && snapshot?.headSha === input.expectedHeadSha && snapshot.reviewedHeadSha === input.expectedHeadSha && snapshot.state === 'open' && snapshot.sourceState === 'open' && snapshot.moderationRevision === input.moderationRevision, 'proposal-changed', 409);
      const wallet = pointWallet(state, accountId);
      requireCommunity(wallet.balance >= input.amount, 'insufficient-points', 409);
      const receipt: SupportReceipt = { entryId, key: input.key, headSha: input.expectedHeadSha, amount: input.amount, balance: wallet.balance - input.amount, roundId: input.roundId, operationId: input.operationId };
      state.ledger.push({ id: entryId, accountId, delta: -input.amount, reason: 'support', sourceKey: `support:${input.operationId}`, operationId: input.operationId, payloadHash, receipt, createdAt: now });
      wallet.balance -= input.amount; wallet.revision++;
      return receipt;
    }); },
    async ensureRound(now) { return durable.transaction(root => { const state = communityState(root); const round = roundAt(now); return state.rounds[round.id] ??= round; }); },
    async correctPoints(input, moderatorId, payloadHash, entryId, now) { return durable.transaction(root => {
      requireCommunity(Number.isSafeInteger(input.delta) && input.delta !== 0 && input.reason.trim().length > 0, 'invalid-correction');
      const state = communityState(root); const wallet = pointWallet(state, input.accountId);
      const previous = state.ledger.find(entry => entry.accountId === input.accountId && entry.operationId === input.operationId);
      if (previous) { requireCommunity(previous.payloadHash === payloadHash && previous.reason === 'correction', 'operation-payload-mismatch', 409); return previous.receipt as CorrectionReceipt; }
      const balance = wallet.balance + input.delta;
      requireCommunity(Number.isSafeInteger(balance) && balance >= 0, 'invalid-correction-balance', 409);
      const receipt: CorrectionReceipt = { entryId, accountId: input.accountId, delta: input.delta, balance, reason: input.reason, moderatorId };
      state.ledger.push({ id: entryId, accountId: input.accountId, delta: input.delta, reason: 'correction', sourceKey: `correction:${input.operationId}`, operationId: input.operationId, payloadHash, receipt, createdAt: now });
      wallet.balance = balance; wallet.revision++; return receipt;
    }); },
    async getRound(id) { return read().rounds[id] ?? null; },
    async dueRounds(now) { return Object.values(read().rounds).filter(value => value.closesAt <= now && (value.state === 'open' || value.state === 'closing')).map(value => value.id); },
    async closeRound(id, now, rulesRevision, contentApiVersion) { return durable.transaction(root => {
      const state = communityState(root); const round = state.rounds[id];
      requireCommunity(round, 'round-not-found', 404);
      if (round.state !== 'open') return round;
      requireCommunity(now >= round.closesAt, 'round-still-open', 409);
      const candidates = rankCandidates(Object.values(state.proposals).map(item => candidateFor(withTotals(state, item, round.closesAt), rulesRevision, contentApiVersion)).filter(item => item !== null));
      round.candidates = candidates;
      if (candidates[0]) { round.state = 'closing'; round.winner = candidates[0]; } else round.state = 'no_winner';
      return round;
    }); },
    async recordBackup(id, receipt) {
      const existing = read().rounds[id]; requireCommunity(existing?.winner, 'round-no-winner', 409);
      await verifyBackupReceipt(id, existing.winner, receipt);
      return durable.transaction(root => {
        const state = communityState(root); const value = state.rounds[id]; requireCommunity(value?.state === 'closing', 'backup-round-not-closing', 409); assertBackupIdentity(value, receipt);
        if (value.backupReceipt) { requireCommunity(value.backupReceipt.manifestSha256 === receipt.manifestSha256, 'backup-receipt-mismatch', 409); return value.backupReceipt; }
        value.backupReceipt = receipt; return receipt;
      });
    },
    async finishMerge(id, receipt) { return durable.transaction(root => { const state = communityState(root); const round = state.rounds[id]; requireCommunity(round?.winner, 'round-no-winner', 409); if (round.state === 'merged' || round.state === 'blocked') return round; if ('blockedReason' in receipt) { round.state = 'blocked'; round.blockedReason = receipt.blockedReason; } else { requireCommunity(round.backupReceipt, 'confirmed-backup-required', 409); assertBackupIdentity(round, round.backupReceipt); requireCommunity(receipt.headSha === round.winner.headSha && receipt.roundId === round.id, 'merge-receipt-mismatch', 409); round.state = 'merged'; round.mergeReceipt = receipt; const proposal = state.proposals[proposalKey(round.winner.key)]; if (proposal?.headSha === receipt.headSha) { proposal.state = 'merged'; proposal.sourceState = 'closed'; proposal.mergedCommitSha = receipt.mergeCommitSha; proposal.sourceCheckedAt = receipt.mergedAt; } } return round; }); },
    async markReleased(key, headSha, deploymentId, contentSha) { await durable.transaction(root => { const state = communityState(root); const id = proposalKey(key); const snapshot = state.proposals[id]; requireCommunity(snapshot && snapshot.headSha === headSha && snapshot.mergedCommitSha && deploymentId && contentSha, 'release-source-mismatch', 409); const previous = state.releases.find(entry => entry.key === id && entry.deploymentId === deploymentId); requireCommunity(!previous || (previous.headSha === headSha && previous.contentSha === contentSha), 'release-receipt-mismatch', 409); if (!previous) state.releases.push({ key: id, headSha, deploymentId, contentSha }); snapshot.state = 'released'; }); },
  };
}
