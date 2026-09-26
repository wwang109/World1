import type { GhostRecord } from '../src/run/ghost';
import { evictionCandidateId, nextRotationPick, type GhostStore } from '../src/run/ghostPool';
import type { D1Database } from './d1';

interface GhostRow {
  id: number;
  code: string;
  display_name: string;
  band: number;
  fight_number: number;
  created_at: number;
  owner_local_id: string;
  defense_wins: number;
  defense_losses: number;
}

function rowToRecord(row: GhostRow): GhostRecord {
  return {
    id: String(row.id),
    code: row.code,
    displayName: row.display_name,
    band: row.band,
    fightNumber: row.fight_number,
    createdAt: row.created_at,
    ownerLocalId: row.owner_local_id,
    defenseWins: row.defense_wins,
    defenseLosses: row.defense_losses,
  };
}

export function createD1GhostStore(db: D1Database): GhostStore {
  return {
    async save(input) {
      const createdAt = Date.now();
      const inserted = await db
        .prepare(
          'INSERT INTO ghosts (code, display_name, band, fight_number, created_at, owner_local_id, defense_wins, defense_losses) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
        )
        .bind(input.code, input.displayName, input.band, input.fightNumber, createdAt, input.ownerLocalId)
        .run();
      const newId = inserted.meta.last_row_id;
      if (newId === undefined) throw new Error('ghost insert did not return an id');
      const record: GhostRecord = {
        id: String(newId),
        code: input.code,
        displayName: input.displayName,
        band: input.band,
        fightNumber: input.fightNumber,
        createdAt,
        ownerLocalId: input.ownerLocalId,
        defenseWins: 0,
        defenseLosses: 0,
      };

      const bandRows = await db
        .prepare('SELECT * FROM ghosts WHERE band = ?')
        .bind(input.band)
        .all<GhostRow>();
      const bandRecords = (bandRows.results ?? []).map(rowToRecord);
      const evictedId = evictionCandidateId(bandRecords);
      if (evictedId !== null) {
        await db.prepare('DELETE FROM ghosts WHERE id = ?').bind(Number(evictedId)).run();
      }
      return record;
    },

    async fetchForBand(band, excludeOwnerLocalId) {
      const [rowsResult, cursorResult] = await db.batch<GhostRow | { cursor: number }>([
        db.prepare('SELECT * FROM ghosts WHERE band = ? ORDER BY id ASC').bind(band),
        db.prepare('SELECT cursor FROM band_cursor WHERE band = ?').bind(band),
      ]);
      const bandRecords = ((rowsResult?.results ?? []) as GhostRow[]).map(rowToRecord);
      if (bandRecords.length === 0) return null;
      const cursorRow = (cursorResult?.results ?? [])[0] as { cursor: number } | undefined;
      const cursor = cursorRow?.cursor ?? 0;
      const { picked, nextCursor } = nextRotationPick(bandRecords, cursor, excludeOwnerLocalId);
      await db
        .prepare('INSERT INTO band_cursor (band, cursor) VALUES (?, ?) ON CONFLICT(band) DO UPDATE SET cursor = excluded.cursor')
        .bind(band, nextCursor)
        .run();
      return picked;
    },

    async reportResult(id, ghostWon) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId)) return { ok: false, reason: 'unknown ghost id' };
      const existing = await db.prepare('SELECT * FROM ghosts WHERE id = ?').bind(numericId).first<GhostRow>();
      if (existing === null) return { ok: false, reason: 'unknown ghost id' };
      const column = ghostWon ? 'defense_wins' : 'defense_losses';
      await db.prepare(`UPDATE ghosts SET ${column} = ${column} + 1 WHERE id = ?`).bind(numericId).run();
      return { ok: true };
    },
  };
}
