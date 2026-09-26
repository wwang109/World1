import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GhostRecord } from '../src/run/ghost';
import { evictionCandidateId, nextRotationPick, type GhostStore } from '../src/run/ghostPool';

// .tmp/ is gitignored.
const DEFAULT_FILE_PATH = '.tmp/ghost-store.json';

interface GhostStoreFileShape {
  nextId: number;
  records: GhostRecord[];
  cursorByBand: Record<string, number>;
}

function emptyShape(): GhostStoreFileShape {
  return { nextId: 1, records: [], cursorByBand: {} };
}

function loadFromDisk(filePath: string): GhostStoreFileShape {
  if (!existsSync(filePath)) return emptyShape();
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<GhostStoreFileShape>;
    if (!Array.isArray(parsed.records)) return emptyShape();
    return {
      nextId: typeof parsed.nextId === 'number' && Number.isFinite(parsed.nextId)
        ? parsed.nextId
        : parsed.records.length + 1,
      records: parsed.records,
      cursorByBand: parsed.cursorByBand && typeof parsed.cursorByBand === 'object' ? parsed.cursorByBand : {},
    };
  } catch {
    return emptyShape();
  }
}

function writeToDisk(filePath: string, shape: GhostStoreFileShape): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(shape, null, 2));
}

export function createFileGhostStore(filePath: string = DEFAULT_FILE_PATH): GhostStore {
  let state = loadFromDisk(filePath);

  return {
    async save(input) {
      const record: GhostRecord = {
        ...input,
        id: String(state.nextId),
        createdAt: Date.now(),
        defenseWins: 0,
        defenseLosses: 0,
      };
      let records = [...state.records, record];
      const bandRecords = records.filter((r) => r.band === record.band);
      const evictedId = evictionCandidateId(bandRecords);
      if (evictedId !== null) {
        records = records.filter((r) => r.id !== evictedId);
      }
      state = { nextId: state.nextId + 1, records, cursorByBand: state.cursorByBand };
      writeToDisk(filePath, state);
      return record;
    },
    async fetchForBand(band, excludeOwnerLocalId) {
      const bandRecords = state.records
        .filter((record) => record.band === band)
        .sort((a, b) => Number(a.id) - Number(b.id));
      if (bandRecords.length === 0) return null;
      const cursorKey = String(band);
      const { picked, nextCursor } = nextRotationPick(bandRecords, state.cursorByBand[cursorKey] ?? 0, excludeOwnerLocalId);
      state = { ...state, cursorByBand: { ...state.cursorByBand, [cursorKey]: nextCursor } };
      writeToDisk(filePath, state);
      return picked;
    },
    async reportResult(id, ghostWon) {
      const index = state.records.findIndex((record) => record.id === id);
      if (index === -1) return { ok: false, reason: 'unknown ghost id' };
      const record = state.records[index]!;
      const updated: GhostRecord = {
        ...record,
        defenseWins: (record.defenseWins ?? 0) + (ghostWon ? 1 : 0),
        defenseLosses: (record.defenseLosses ?? 0) + (ghostWon ? 0 : 1),
      };
      const records = [...state.records];
      records[index] = updated;
      state = { ...state, records };
      writeToDisk(filePath, state);
      return { ok: true };
    },
  };
}
