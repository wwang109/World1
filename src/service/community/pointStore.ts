import type { BossPointReceipt, PointEntry, Wallet } from '../../community/points';
import { requireCommunity } from '../../community/validate';
export interface PointState { wallets: Record<string, Wallet>; ledger: PointEntry[] }
export function initializePointState(value: unknown): PointState {
  const state = (value ?? {}) as Partial<PointState>;
  return { wallets: state.wallets ?? {}, ledger: state.ledger ?? [] };
}
export function pointWallet(state: PointState, accountId: string): Wallet {
  return state.wallets[accountId] ??= { accountId, balance: 0, revision: 0 };
}
export interface BossCreditCommit { accountId: string; runId: string; encounterId: string; operationId: string; payloadHash: string; entryId: string; now: number }
export function applyBossCredit(root: Record<string, unknown>, input: BossCreditCommit): BossPointReceipt {
  const community = root.community as (Record<string, unknown> & PointState) | undefined;
  const state = community ?? Object.assign({}, initializePointState(undefined));
  root.community = state;
  state.wallets ??= {}; state.ledger ??= [];
  const sourceKey = `boss:${input.runId}:${input.encounterId}`;
  const operation = state.ledger.find(entry => entry.accountId === input.accountId && entry.operationId === input.operationId);
  requireCommunity(!operation || (operation.payloadHash === input.payloadHash && operation.sourceKey === sourceKey && operation.reason === 'boss'), 'operation-payload-mismatch', 409);
  const previous = state.ledger.find(entry => entry.accountId === input.accountId && entry.sourceKey === sourceKey);
  if (previous) return previous.receipt as BossPointReceipt;
  const wallet = pointWallet(state, input.accountId);
  requireCommunity(Number.isSafeInteger(wallet.balance + 1), 'wallet-overflow', 409);
  const receipt: BossPointReceipt = { entryId: input.entryId, pointsEarned: 1, balance: wallet.balance + 1 };
  state.ledger.push({ id: input.entryId, accountId: input.accountId, delta: 1, reason: 'boss', sourceKey, operationId: input.operationId, payloadHash: input.payloadHash, receipt, createdAt: input.now });
  wallet.balance++; wallet.revision++;
  return receipt;
}
