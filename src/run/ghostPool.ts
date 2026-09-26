import type { GhostRecord } from './ghost';

export const GHOST_POOL_PER_BAND = 10;

export type GhostResultReportOutcome = { ok: true } | { ok: false; reason: string };

export interface GhostStore {
  save(input: Omit<GhostRecord, 'id' | 'createdAt' | 'defenseWins' | 'defenseLosses'>): Promise<GhostRecord>;
  fetchForBand(band: number, excludeOwnerLocalId?: string): Promise<GhostRecord | null>;
  reportResult(id: string, ghostWon: boolean): Promise<GhostResultReportOutcome>;
}

export function rankCompare(a: GhostRecord, b: GhostRecord): number {
  const winsA = a.defenseWins ?? 0;
  const winsB = b.defenseWins ?? 0;
  if (winsA !== winsB) return winsB - winsA;
  const lossesA = a.defenseLosses ?? 0;
  const lossesB = b.defenseLosses ?? 0;
  if (lossesA !== lossesB) return lossesA - lossesB;
  return b.createdAt - a.createdAt;
}

export function rankGhosts(records: GhostRecord[]): GhostRecord[] {
  return [...records].sort(rankCompare);
}

export function evictionCandidateId(bandRecordsIncludingNew: GhostRecord[]): string | null {
  if (bandRecordsIncludingNew.length <= GHOST_POOL_PER_BAND) return null;
  const ranked = rankGhosts(bandRecordsIncludingNew);
  return ranked[ranked.length - 1]!.id;
}

export interface RotationPick {
  picked: GhostRecord | null;
  nextCursor: number;
}

export function nextRotationPick(
  bandRecordsByInsertionOrder: GhostRecord[],
  cursor: number,
  excludeOwnerLocalId?: string,
): RotationPick {
  if (bandRecordsByInsertionOrder.length === 0) return { picked: null, nextCursor: cursor };
  let nextCursor = cursor;
  let picked: GhostRecord | null = null;
  for (let i = 0; i < bandRecordsByInsertionOrder.length; i++) {
    const candidate = bandRecordsByInsertionOrder[nextCursor % bandRecordsByInsertionOrder.length]!;
    nextCursor += 1;
    if (candidate.ownerLocalId !== excludeOwnerLocalId) { picked = candidate; break; }
  }
  return { picked, nextCursor };
}
