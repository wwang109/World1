import type { D1Database } from './d1';
import type { RunPorts } from '../src/service/runs/service';
import type { GhostRecord } from '../src/run/ghost';
import { nextRotationPick } from '../src/run/ghostPool';

export function createD1EligibleGhostPorts(db: D1Database): RunPorts {
  return {
    async lookupGhost(accountId, band, key) {
      const partition = JSON.stringify([key.rulesRevision, key.contentSha]);
      const rows = await db.prepare('SELECT ghost_json FROM eligible_ghosts WHERE revision_key=? AND band=? ORDER BY created_at,id').bind(partition, band).all<{ ghost_json: string }>();
      const cursor = await db.prepare('SELECT cursor FROM eligible_ghost_cursors WHERE revision_key=? AND band=?').bind(partition, band).first<{ cursor: number }>();
      const result = nextRotationPick((rows.results ?? []).map(row => JSON.parse(row.ghost_json) as GhostRecord), cursor?.cursor ?? 0, accountId);
      await db.prepare('INSERT INTO eligible_ghost_cursors(revision_key,band,cursor) VALUES(?,?,?) ON CONFLICT(revision_key,band) DO UPDATE SET cursor=excluded.cursor').bind(partition, band, result.nextCursor).run();
      return result.picked;
    },
    async deliverEffect(delivery, validatedGhost) {
      if (await db.prepare('SELECT id FROM eligible_ghost_deliveries WHERE id=?').bind(delivery.id).first()) return;
      const statements = [db.prepare('INSERT INTO eligible_ghost_deliveries(id) VALUES(?)').bind(delivery.id)];
      const effect = delivery.effect;
      const partition = JSON.stringify([delivery.key.rulesRevision, delivery.key.contentSha]);
      if (effect.kind === 'ghostSave') {
        if (!validatedGhost || validatedGhost.ownerLocalId !== delivery.accountId) throw new Error('Missing pinned ghost validation');
        const ghost: GhostRecord = { ...validatedGhost, id: delivery.id, createdAt: Date.now(), defenseWins: 0, defenseLosses: 0 };
        statements.push(db.prepare('INSERT INTO eligible_ghosts(id,revision_key,band,created_at,ghost_json) VALUES(?,?,?,?,?)').bind(ghost.id, partition, ghost.band, ghost.createdAt, JSON.stringify(ghost)),
          db.prepare("DELETE FROM eligible_ghosts WHERE id IN (SELECT id FROM eligible_ghosts WHERE revision_key=? AND band=? ORDER BY json_extract(ghost_json,'$.defenseWins') DESC,json_extract(ghost_json,'$.defenseLosses') ASC,created_at DESC LIMIT -1 OFFSET 10)").bind(partition, ghost.band));
      } else statements.push(db.prepare(`UPDATE eligible_ghosts SET ghost_json=json_set(ghost_json,'$.${effect.won ? 'defenseWins' : 'defenseLosses'}',COALESCE(json_extract(ghost_json,'$.${effect.won ? 'defenseWins' : 'defenseLosses'}'),0)+1) WHERE revision_key=? AND id=?`).bind(partition, effect.ghostId));
      try { await db.batch(statements); }
      catch (error) { if (!await db.prepare('SELECT id FROM eligible_ghost_deliveries WHERE id=?').bind(delivery.id).first()) throw error; }
    },
  };
}
