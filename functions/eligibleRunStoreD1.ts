import type { D1Database, D1PreparedStatement } from './d1';
import type { EligibleRun, RunReceipt, EncounterReceipt, RunEffect } from '../src/run/online/types';
import { RunServiceError, isActive, verifyEncounterCommit, type EligibleRunStore, type EffectDelivery, type PresentRun } from '../src/service/runs/store';

export function createD1EligibleRunStore(db: D1Database, present: PresentRun): EligibleRunStore {
  async function get(id: string, accountId: string): Promise<EligibleRun | null> {
    const row = await db.prepare('SELECT run_json FROM eligible_runs WHERE id=? AND account_id=?').bind(id, accountId).first<{ run_json: string }>();
    return row ? JSON.parse(row.run_json) as EligibleRun : null;
  }
  async function replay(accountId: string, operationId: string, hash: string): Promise<RunReceipt | EncounterReceipt | null> {
    const row = await db.prepare('SELECT payload_hash,receipt_json FROM eligible_operations WHERE account_id=? AND operation_id=?').bind(accountId, operationId).first<{ payload_hash: string; receipt_json: string }>();
    if (row && row.payload_hash !== hash) throw new RunServiceError('Operation ID was used with another payload', 409);
    return row ? JSON.parse(row.receipt_json) as RunReceipt | EncounterReceipt : null;
  }
  function effectStatements(run: EligibleRun, operationId: string, effects: readonly RunEffect[]): D1PreparedStatement[] {
    return effects.flatMap((effect, index) => {
      if (effect.kind === 'encounter' || effect.kind === 'ghostLookup') return [];
      const delivery: EffectDelivery = { id: `${run.id}:${operationId}:${index}`, accountId: run.accountId, runId: run.id, key: run.key, effect };
      return [db.prepare('INSERT INTO eligible_effects(id,account_id,delivery_json) VALUES(?,?,?)').bind(delivery.id, run.accountId, JSON.stringify(delivery))];
    });
  }
  async function commit(statements: D1PreparedStatement[], accountId: string, operationId: string, hash: string, runId: string): Promise<RunReceipt | EncounterReceipt> {
    try { await db.batch(statements); }
    catch (error) {
      const prior = await replay(accountId, operationId, hash);
      if (prior) return prior;
      const current = await get(runId, accountId);
      throw new RunServiceError(error instanceof Error && /CHECK|constraint|guard/i.test(error.message) ? 'Run revision changed' : 'Run commit failed', 409, current ? present(current) : undefined);
    }
    const receipt = await replay(accountId, operationId, hash);
    if (!receipt) throw new RunServiceError('Run receipt missing after commit', 503);
    return receipt;
  }
  const receiptStatement = (accountId: string, operationId: string, hash: string, id: string, receipt: RunReceipt) => db.prepare('INSERT INTO eligible_operations(account_id,operation_id,payload_hash,run_id,receipt_json) VALUES(?,?,?,?,?)').bind(accountId, operationId, hash, id, JSON.stringify(receipt));
  return {
    get, replay,
    async active(accountId) { const row = await db.prepare('SELECT run_json FROM eligible_runs WHERE account_id=? AND active=1').bind(accountId).first<{ run_json: string }>(); return row ? JSON.parse(row.run_json) as EligibleRun : null; },
    async createOrReplace(accountId, run, operation) {
      const prior = await replay(accountId, operation.operationId, operation.payloadHash);
      if (prior) return prior;
      if (run.accountId !== accountId) throw new RunServiceError('Invalid run owner');
      const guard = crypto.randomUUID(), statements: D1PreparedStatement[] = [];
      statements.push(db.prepare('INSERT INTO eligible_commit_guards(id,ok) SELECT ?,CASE WHEN ?=1 OR NOT EXISTS(SELECT 1 FROM eligible_runs WHERE account_id=? AND active=1) THEN 1 ELSE 0 END').bind(guard, operation.replace ? 1 : 0, accountId));
      if (operation.replace) statements.push(db.prepare("UPDATE eligible_runs SET active=0,revision=revision+1,run_json=json_set(run_json,'$.state.status','retired','$.revision',revision+1) WHERE account_id=? AND active=1").bind(accountId));
      statements.push(db.prepare('INSERT INTO eligible_runs(id,account_id,revision,active,rules_revision,content_sha,run_json) VALUES(?,?,?,?,?,?,?)').bind(run.id, accountId, run.revision, 1, run.key.rulesRevision, run.key.contentSha, JSON.stringify(run)));
      const receipt: RunReceipt = { operationId: operation.operationId, runId: run.id, revision: run.revision, view: present(run) };
      statements.push(receiptStatement(accountId, operation.operationId, operation.payloadHash, run.id, receipt), db.prepare('DELETE FROM eligible_commit_guards WHERE id=?').bind(guard));
      return commit(statements, accountId, operation.operationId, operation.payloadHash, run.id);
    },
    async commitAction(id, accountId, revision, operation, transition) {
      const prior = await replay(accountId, operation.operationId, operation.payloadHash);
      if (prior) return prior;
      const run = await get(id, accountId);
      if (!run) throw new RunServiceError('Run not found', 404);
      const retiring = transition.state.status === 'retired';
      if (run.revision !== revision || !isActive(run) || (!retiring && run.encounters.some(encounter => encounter.status === 'pending'))) throw new RunServiceError('Run revision changed', 409, present(run));
      const encounters = transition.effects.flatMap(effect => effect.kind === 'encounter' ? [effect.encounter] : []);
      if (encounters.length > 1 || encounters.some(encounter => encounter.runId !== id || encounter.stateRevision !== revision + 1)) throw new RunServiceError('Invalid encounter issuance');
      const next: EligibleRun = { ...run, revision: revision + 1, state: transition.state, encounters: [...run.encounters, ...encounters] };
      const guard = crypto.randomUUID();
      const statements = [db.prepare('INSERT INTO eligible_commit_guards(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM eligible_runs WHERE id=? AND account_id=? AND revision=? AND active=1) AND (?=1 OR NOT EXISTS(SELECT 1 FROM eligible_encounters WHERE run_id=? AND status=\'pending\')) THEN 1 ELSE 0 END').bind(guard, id, accountId, revision, retiring ? 1 : 0, id),
        db.prepare('UPDATE eligible_runs SET revision=?,active=?,run_json=? WHERE id=? AND account_id=? AND revision=?').bind(next.revision, isActive(next) ? 1 : 0, JSON.stringify(next), id, accountId, revision)];
      for (const encounter of encounters) statements.push(db.prepare('INSERT INTO eligible_encounters(id,run_id,account_id,state_revision,reward_class,role,status,encounter_json) VALUES(?,?,?,?,?,?,?,?)').bind(encounter.id, id, accountId, encounter.stateRevision, encounter.rewardClass, encounter.role, encounter.status, JSON.stringify(encounter)));
      const receipt: RunReceipt = { operationId: operation.operationId, runId: id, revision: next.revision, view: present(next) };
      statements.push(receiptStatement(accountId, operation.operationId, operation.payloadHash, id, receipt), ...effectStatements(next, operation.operationId, transition.effects), db.prepare('DELETE FROM eligible_commit_guards WHERE id=?').bind(guard));
      return commit(statements, accountId, operation.operationId, operation.payloadHash, id);
    },
    async commitEncounter(input) {
      const prior = await replay(input.accountId, input.operationId, input.payloadHash);
      if (prior) { if (!('encounterId' in prior)) throw new RunServiceError('Operation kind mismatch', 409); return prior; }
      const row = await db.prepare('SELECT run_id FROM eligible_encounters WHERE id=? AND account_id=?').bind(input.resolved.encounterId, input.accountId).first<{ run_id: string }>();
      const run = row ? await get(row.run_id, input.accountId) : null;
      if (!run) throw new RunServiceError('Run encounter not found', 404);
      verifyEncounterCommit(run, input);
      const encounter = run.encounters.find(encounter => encounter.id === input.resolved.encounterId)!;
      const next: EligibleRun = { ...run, revision: run.revision + 1, state: input.resolved.state,
        encounters: run.encounters.map(value => value.id === encounter.id ? { ...value, status: 'settled' } : value) };
      const receipt: EncounterReceipt = { operationId: input.operationId, runId: run.id, revision: next.revision, view: present(next), encounterId: encounter.id, log: input.resolved.log };
      const guard = crypto.randomUUID(), entryId = crypto.randomUUID(), now = Date.now();
      const statements = [db.prepare("INSERT INTO eligible_commit_guards(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM eligible_runs r JOIN eligible_encounters e ON e.run_id=r.id WHERE r.id=? AND r.account_id=? AND r.revision=? AND r.active=1 AND e.id=? AND e.state_revision=r.revision AND e.status='pending' AND e.reward_class=? AND e.encounter_json=?) THEN 1 ELSE 0 END").bind(guard, run.id, input.accountId, input.expectedRevision, encounter.id, encounter.rewardClass, JSON.stringify(encounter)),
        db.prepare('UPDATE eligible_runs SET revision=?,active=?,run_json=? WHERE id=? AND revision=?').bind(next.revision, isActive(next) ? 1 : 0, JSON.stringify(next), run.id, input.expectedRevision),
        db.prepare("UPDATE eligible_encounters SET status='settled' WHERE id=? AND status='pending'").bind(encounter.id)];
      if (input.bossCredit) {
        statements.push(db.prepare('INSERT INTO community_wallets(account_id,balance,revision) VALUES(?,0,0) ON CONFLICT(account_id) DO NOTHING').bind(input.accountId),
          db.prepare("INSERT INTO community_point_ledger(id,account_id,delta,reason,source_key,operation_id,payload_hash,receipt_json,created_at) SELECT ?,account_id,1,'boss',?,?,?,json_object('entryId',?,'pointsEarned',1,'balance',balance+1),? FROM community_wallets WHERE account_id=?").bind(entryId, `boss:${run.id}:${encounter.id}`, input.operationId, input.payloadHash, entryId, now, input.accountId),
          db.prepare('UPDATE community_wallets SET balance=balance+1,revision=revision+1 WHERE account_id=?').bind(input.accountId),
          db.prepare("INSERT INTO eligible_operations(account_id,operation_id,payload_hash,run_id,receipt_json) SELECT ?,?,?,?,json_set(?,'$.points',json_object('entryId',?,'pointsEarned',1,'balance',balance)) FROM community_wallets WHERE account_id=?").bind(input.accountId, input.operationId, input.payloadHash, run.id, JSON.stringify(receipt), entryId, input.accountId));
      } else statements.push(receiptStatement(input.accountId, input.operationId, input.payloadHash, run.id, receipt));
      statements.push(...effectStatements(next, input.operationId, input.resolved.effects), db.prepare('DELETE FROM eligible_commit_guards WHERE id=?').bind(guard));
      const saved = await commit(statements, input.accountId, input.operationId, input.payloadHash, run.id);
      if (!('encounterId' in saved)) throw new RunServiceError('Operation kind mismatch', 409);
      return saved;
    },
    async pendingEffects(accountId) { const rows = await db.prepare('SELECT delivery_json FROM eligible_effects WHERE account_id=? ORDER BY id').bind(accountId).all<{ delivery_json: string }>(); return (rows.results ?? []).map(row => JSON.parse(row.delivery_json) as EffectDelivery); },
    async acknowledgeEffect(id, accountId) { await db.prepare('DELETE FROM eligible_effects WHERE id=? AND account_id=?').bind(id, accountId).run(); },
  };
}
