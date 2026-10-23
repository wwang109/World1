import { proposalKey, type ProposalKey, type ProposalSnapshot, type ModerationReceipt } from '../src/community/types';
import { requireCommunity } from '../src/community/validate';
import { validateSupport, type CorrectionReceipt, type PointEntry, type SupportReceipt } from '../src/community/points';
import { roundAt, type VotingRound, type RoundCandidate, type MergeReceipt } from '../src/community/rounds';
import type { CommunityStore } from '../src/service/community/store';
import type { D1Database } from './d1';
import { assertBackupIdentity, verifyBackupReceipt, type BackupReceipt } from '../src/community/backup';
import { emptySourceSync, type SourceSyncCheckpoint } from '../src/community/sourceSync';
export const COMMUNITY_DB_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
interface ProposalRow { snapshot_json: string; moderation_revision: number; moderation_state: ProposalSnapshot['state'] | null; reviewed_head_sha: string | null; technical_json: string | null; support_total: number }
function snapshot(row: ProposalRow): ProposalSnapshot {
  const value = JSON.parse(row.snapshot_json) as ProposalSnapshot;
  const state = value.mergedCommitSha ? 'merged' : value.sourceState === 'closed' ? 'withdrawn' : row.moderation_state ?? 'pending_review';
  const technical = row.technical_json ? JSON.parse(row.technical_json) as ProposalSnapshot['technical'] : null;
  return { ...value, state: row.moderation_state === 'released' ? 'released' : state, moderationRevision: row.moderation_revision, reviewedHeadSha: row.reviewed_head_sha, technical, validation: technical ? 'ready' : row.reviewed_head_sha === value.headSha ? 'needs_implementation' : 'needs_review', supportTotal: row.support_total ?? 0 };
}
interface RoundRow { id: string; opens_at: number; closes_at: number; state: VotingRound['state']; candidates_json: string | null; winner_json: string | null; backup_receipt_json?: string | null; merge_receipt_json: string | null; blocked_reason: string | null }
function round(row: RoundRow): VotingRound {
  return { id: row.id, opensAt: row.opens_at, closesAt: row.closes_at, state: row.state, ...(row.candidates_json ? { candidates: JSON.parse(row.candidates_json) as RoundCandidate[] } : {}), ...(row.winner_json ? { winner: JSON.parse(row.winner_json) as RoundCandidate } : {}), ...(row.backup_receipt_json ? { backupReceipt: JSON.parse(row.backup_receipt_json) as BackupReceipt } : {}), ...(row.merge_receipt_json ? { mergeReceipt: JSON.parse(row.merge_receipt_json) as MergeReceipt } : {}), ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}) };
}
const TOTAL = `(SELECT COALESCE(SUM(-l.delta),0) FROM community_point_ledger l WHERE l.reason='support' AND json_extract(l.receipt_json,'$.key.repositoryId')=p.repository_id AND json_extract(l.receipt_json,'$.key.number')=p.pr_number AND json_extract(l.receipt_json,'$.headSha')=p.head_sha)`;
export function createD1CommunityStore(db: D1Database): CommunityStore {
  const getRound = async (id: string): Promise<VotingRound | null> => { const value = await db.prepare('SELECT r.*,(SELECT receipt_json FROM community_round_backups b WHERE b.round_id=r.id) AS backup_receipt_json FROM community_rounds r WHERE r.id=?').bind(id).first<RoundRow>(); return value ? round(value) : null; };
  const supportReceipt = async (accountId: string, operationId: string, payloadHash: string): Promise<SupportReceipt | null> => {
    const previous = await db.prepare('SELECT payload_hash,reason,receipt_json FROM community_point_ledger WHERE account_id=? AND operation_id=?').bind(accountId, operationId).first<{ payload_hash: string; reason: string; receipt_json: string }>();
    if (!previous) return null;
    requireCommunity(previous.payload_hash === payloadHash && previous.reason === 'support', 'operation-payload-mismatch', 409);
    return JSON.parse(previous.receipt_json) as SupportReceipt;
  };
  const sourceSync = async (): Promise<SourceSyncCheckpoint> => {
    const row = await db.prepare('SELECT * FROM community_source_sync WHERE id=1').first<{ revision: number; lease_token: string | null; lease_until: number; next_poll_at: number; checkpoint_json: string }>();
    return row ? { ...JSON.parse(row.checkpoint_json) as SourceSyncCheckpoint, revision: row.revision, leaseToken: row.lease_token, leaseUntil: row.lease_until, nextPollAt: row.next_poll_at } : emptySourceSync();
  };
  return {
    async getProposal(key) { const row = await db.prepare(`SELECT p.*,${TOTAL} AS support_total FROM community_proposals p WHERE repository_id=? AND pr_number=?`).bind(key.repositoryId, key.number).first<ProposalRow>(); return row ? snapshot(row) : null; },
    async listProposals(offset, limit, sort) { const result = await db.prepare(`SELECT p.*,${TOTAL} AS support_total FROM community_proposals p ORDER BY ${sort === 'newest' ? "json_extract(snapshot_json,'$.importedAt') DESC,pr_number DESC" : "support_total DESC,COALESCE(json_extract(technical_json,'$.admittedAt'),json_extract(snapshot_json,'$.importedAt')),pr_number"} LIMIT ? OFFSET ?`).bind(limit, offset).all<ProposalRow>(); return (result.results ?? []).map(snapshot); },
    async importProposal(value, assets) {
      const statements = [db.prepare(`INSERT INTO community_proposals(repository_id,pr_number,head_sha,snapshot_json) VALUES(?,?,?,?) ON CONFLICT(repository_id,pr_number) DO UPDATE SET snapshot_json=json_set(excluded.snapshot_json,'$.importedAt',json_extract(community_proposals.snapshot_json,'$.importedAt')),moderation_state=CASE WHEN community_proposals.head_sha=excluded.head_sha THEN community_proposals.moderation_state ELSE NULL END,reviewed_head_sha=CASE WHEN community_proposals.head_sha=excluded.head_sha THEN community_proposals.reviewed_head_sha ELSE NULL END,technical_json=CASE WHEN community_proposals.head_sha=excluded.head_sha THEN community_proposals.technical_json ELSE NULL END,head_sha=excluded.head_sha`).bind(value.key.repositoryId, value.key.number, value.headSha, JSON.stringify(value))];
      for (const asset of assets) statements.push(db.prepare('INSERT INTO community_assets(repository_id,pr_number,head_sha,path,hash,content_type,width,height) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(asset.key.repositoryId, asset.key.number, asset.headSha, asset.path, asset.hash, asset.contentType, asset.width, asset.height));
      await db.batch(statements);
      const row = await db.prepare(`SELECT p.*,${TOTAL} AS support_total FROM community_proposals p WHERE repository_id=? AND pr_number=?`).bind(value.key.repositoryId, value.key.number).first<ProposalRow>();
      requireCommunity(row, 'import-failed', 503); return snapshot(row);
    },
    async suspendProposal(key, checkedAt) { await db.prepare("UPDATE community_proposals SET moderation_state=NULL,reviewed_head_sha=NULL,technical_json=NULL,snapshot_json=json_set(snapshot_json,'$.sourceCheckedAt',?) WHERE repository_id=? AND pr_number=? AND json_extract(snapshot_json,'$.mergedCommitSha') IS NULL").bind(checkedAt, key.repositoryId, key.number).run(); },
    sourceSync,
    async claimSourceSync(now, token, leaseMs) {
      await db.batch([db.prepare('INSERT INTO community_source_sync(id,revision,checkpoint_json) VALUES(1,0,?) ON CONFLICT DO NOTHING').bind(JSON.stringify(emptySourceSync())), db.prepare('UPDATE community_source_sync SET revision=revision+1,lease_token=?,lease_until=? WHERE id=1 AND lease_until<=? AND next_poll_at<=?').bind(token, now + leaseMs, now, now)]);
      const checkpoint = await sourceSync(); return checkpoint.leaseToken === token ? checkpoint : null;
    },
    async finishSourceSync(token, checkpoint) { const result = await db.prepare('UPDATE community_source_sync SET revision=revision+1,lease_token=NULL,lease_until=0,next_poll_at=?,checkpoint_json=? WHERE id=1 AND lease_token=? AND revision=?').bind(checkpoint.nextPollAt, JSON.stringify({ ...checkpoint, leaseToken: null, leaseUntil: 0, revision: checkpoint.revision + 1 }), token, checkpoint.revision).run(); requireCommunity(Number(result.meta.changes) === 1, 'source-sync-lease-changed', 409); return sourceSync(); },
    async getAsset(key, headSha, path) { const row = await db.prepare('SELECT hash,content_type,width,height FROM community_assets WHERE repository_id=? AND pr_number=? AND head_sha=? AND path=?').bind(key.repositoryId, key.number, headSha, path).first<{ hash: string; content_type: string; width: number; height: number }>(); return row ? { key, headSha, path, hash: row.hash, contentType: row.content_type, width: row.width, height: row.height } : null; },
    async moderate({ accountId, input, payloadHash, now }) {
      const previous = await db.prepare('SELECT payload_hash,receipt_json FROM community_moderation WHERE account_id=? AND operation_id=?').bind(accountId, input.operationId).first<{ payload_hash: string; receipt_json: string }>();
      if (previous) { requireCommunity(previous.payload_hash === payloadHash, 'operation-payload-mismatch', 409); return JSON.parse(previous.receipt_json) as ModerationReceipt; }
      const receipt: ModerationReceipt = { operationId: input.operationId, headSha: input.headSha, moderationRevision: input.expectedRevision + 1 };
      const technical = input.technical ? JSON.stringify({ ...input.technical, reviewerId: accountId, admittedAt: now }) : null;
      await db.batch([
        db.prepare(`INSERT INTO community_moderation(account_id,operation_id,payload_hash,repository_id,pr_number,head_sha,revision,note,receipt_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? FROM community_proposals WHERE repository_id=? AND pr_number=? AND head_sha=? AND moderation_revision=? AND json_extract(snapshot_json,'$.sourceState')='open' ON CONFLICT DO NOTHING`).bind(accountId, input.operationId, payloadHash, input.key.repositoryId, input.key.number, input.headSha, receipt.moderationRevision, input.note, JSON.stringify(receipt), now, input.key.repositoryId, input.key.number, input.headSha, input.expectedRevision),
        db.prepare(`UPDATE community_proposals SET moderation_revision=moderation_revision+1,moderation_state=?,reviewed_head_sha=?,technical_json=? WHERE repository_id=? AND pr_number=? AND head_sha=? AND moderation_revision=? AND EXISTS(SELECT 1 FROM community_moderation WHERE account_id=? AND operation_id=? AND payload_hash=? AND revision=?)`).bind(input.decision, input.headSha, technical, input.key.repositoryId, input.key.number, input.headSha, input.expectedRevision, accountId, input.operationId, payloadHash, receipt.moderationRevision),
      ]);
      const result = await db.prepare('SELECT payload_hash,receipt_json FROM community_moderation WHERE account_id=? AND operation_id=?').bind(accountId, input.operationId).first<{ payload_hash: string; receipt_json: string }>();
      requireCommunity(result, 'stale-review', 409); requireCommunity(result.payload_hash === payloadHash, 'operation-payload-mismatch', 409); return JSON.parse(result.receipt_json) as ModerationReceipt;
    },
    async wallet(accountId) { const row = await db.prepare('SELECT balance,revision FROM community_wallets WHERE account_id=?').bind(accountId).first<{ balance: number; revision: number }>(); return { accountId, balance: row?.balance ?? 0, revision: row?.revision ?? 0 }; },
    async ledger(accountId, offset, limit) { const rows = await db.prepare('SELECT * FROM community_point_ledger WHERE account_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').bind(accountId, limit, offset).all<{ id: string; account_id: string; delta: number; reason: PointEntry['reason']; source_key: string; operation_id: string; payload_hash: string; receipt_json: string; created_at: number }>(); return (rows.results ?? []).map(row => ({ id: row.id, accountId: row.account_id, delta: row.delta, reason: row.reason, sourceKey: row.source_key, operationId: row.operation_id, payloadHash: row.payload_hash, receipt: JSON.parse(row.receipt_json) as unknown, createdAt: row.created_at })); },
    supportReceipt,
    async spendSupport({ accountId, input, payloadHash, sourceConfirmedAt, now, entryId }) {
      validateSupport(input);
      const previous = await supportReceipt(accountId, input.operationId, payloadHash); if (previous) return previous;
      const receiptJson = `json_object('entryId',?,'key',json_object('repositoryId',?,'number',?),'headSha',?,'amount',?,'balance',w.balance-?,'roundId',?,'operationId',?)`;
      await db.batch([
        db.prepare('INSERT INTO community_wallets(account_id) VALUES(?) ON CONFLICT DO NOTHING').bind(accountId),
        db.prepare(`INSERT INTO community_point_ledger(id,account_id,delta,reason,source_key,operation_id,payload_hash,receipt_json,created_at) SELECT ?,?,-?,'support',?,?,?,${receiptJson},${COMMUNITY_DB_NOW} FROM community_wallets w,community_proposals p,community_rounds r WHERE w.account_id=? AND w.balance>=? AND p.repository_id=? AND p.pr_number=? AND p.head_sha=? AND p.reviewed_head_sha=? AND p.moderation_revision=? AND p.moderation_state='open' AND json_extract(p.snapshot_json,'$.sourceState')='open' AND r.id=? AND r.state='open' AND r.opens_at<=${COMMUNITY_DB_NOW} AND r.closes_at>${COMMUNITY_DB_NOW} AND ?>=${COMMUNITY_DB_NOW}-30000 AND ?<=${COMMUNITY_DB_NOW}+1000 ON CONFLICT DO NOTHING`).bind(entryId, accountId, input.amount, `support:${input.operationId}`, input.operationId, payloadHash, entryId, input.key.repositoryId, input.key.number, input.expectedHeadSha, input.amount, input.amount, input.roundId, input.operationId, accountId, input.amount, input.key.repositoryId, input.key.number, input.expectedHeadSha, input.expectedHeadSha, input.moderationRevision, input.roundId, sourceConfirmedAt, sourceConfirmedAt),
        db.prepare('UPDATE community_wallets SET balance=balance-?,revision=revision+1 WHERE account_id=? AND EXISTS(SELECT 1 FROM community_point_ledger WHERE id=? AND account_id=? AND operation_id=? AND payload_hash=?)').bind(input.amount, accountId, entryId, accountId, input.operationId, payloadHash),
      ]);
      const receipt = await supportReceipt(accountId, input.operationId, payloadHash);
      requireCommunity(receipt, 'support-conflict-or-insufficient-points', 409); return receipt;
    },
    async ensureRound(now) { const value = roundAt(now); await db.prepare('INSERT INTO community_rounds(id,opens_at,closes_at,state) VALUES(?,?,?,\'open\') ON CONFLICT DO NOTHING').bind(value.id, value.opensAt, value.closesAt).run(); return (await getRound(value.id))!; },
    async correctPoints(input, moderatorId, payloadHash, entryId, now) {
      requireCommunity(Number.isSafeInteger(input.delta) && input.delta !== 0 && input.reason.trim().length > 0, 'invalid-correction');
      const readPrevious = async (): Promise<CorrectionReceipt | null> => {
        const row = await db.prepare('SELECT reason,payload_hash,receipt_json FROM community_point_ledger WHERE account_id=? AND operation_id=?').bind(input.accountId, input.operationId).first<{ reason: string; payload_hash: string; receipt_json: string }>();
        if (!row) return null; requireCommunity(row.reason === 'correction' && row.payload_hash === payloadHash, 'operation-payload-mismatch', 409); return JSON.parse(row.receipt_json) as CorrectionReceipt;
      };
      const previous = await readPrevious(); if (previous) return previous;
      await db.batch([
        db.prepare('INSERT INTO community_wallets(account_id) VALUES(?) ON CONFLICT DO NOTHING').bind(input.accountId),
        db.prepare(`INSERT INTO community_point_ledger(id,account_id,delta,reason,source_key,operation_id,payload_hash,receipt_json,created_at) SELECT ?,?,?,'correction',?,?,?,json_object('entryId',?,'accountId',?,'delta',?,'balance',balance+?,'reason',?,'moderatorId',?),? FROM community_wallets WHERE account_id=? AND balance+? BETWEEN 0 AND 9007199254740991 ON CONFLICT DO NOTHING`).bind(entryId, input.accountId, input.delta, `correction:${input.operationId}`, input.operationId, payloadHash, entryId, input.accountId, input.delta, input.delta, input.reason, moderatorId, now, input.accountId, input.delta),
        db.prepare('UPDATE community_wallets SET balance=balance+?,revision=revision+1 WHERE account_id=? AND EXISTS(SELECT 1 FROM community_point_ledger WHERE id=? AND account_id=? AND payload_hash=?)').bind(input.delta, input.accountId, entryId, input.accountId, payloadHash),
      ]);
      const receipt = await readPrevious(); requireCommunity(receipt, 'invalid-correction-balance', 409); return receipt;
    },
    getRound,
    async dueRounds(now) { const values = await db.prepare("SELECT id FROM community_rounds WHERE closes_at<=? AND state IN ('open','closing') ORDER BY closes_at").bind(now).all<{ id: string }>(); return (values.results ?? []).map(value => value.id); },
    async closeRound(id, now, rulesRevision, contentApiVersion) {
      const value = await getRound(id); requireCommunity(value, 'round-not-found', 404); if (value.state !== 'open') return value;
      requireCommunity(now >= value.closesAt, 'round-still-open', 409);
      const roundTotal = TOTAL.replace("l.reason='support'", `l.reason='support' AND l.created_at<${value.closesAt}`);
      const ranked = `SELECT json_object('key',json_object('repositoryId',p.repository_id,'number',p.pr_number),'headSha',p.head_sha,'baseSha',json_extract(p.snapshot_json,'$.baseSha'),'support',${roundTotal},'admittedAt',json_extract(p.technical_json,'$.admittedAt'),'rulesRevision',json_extract(p.technical_json,'$.rulesRevision'),'technicalEvidenceHash',json_extract(p.technical_json,'$.evidenceHash'),'validationArtifactSha256',json_extract(p.technical_json,'$.validationArtifactSha256')) AS candidate FROM community_proposals p WHERE p.moderation_state='open' AND p.reviewed_head_sha=p.head_sha AND json_extract(p.snapshot_json,'$.sourceState')='open' AND json_extract(p.technical_json,'$.headSha')=p.head_sha AND json_extract(p.technical_json,'$.rulesRevision')=? AND json_extract(p.technical_json,'$.contentApiVersion')=? AND ${roundTotal}>0 ORDER BY ${roundTotal} DESC,json_extract(p.technical_json,'$.admittedAt'),p.pr_number`;
      await db.batch([
        db.prepare(`UPDATE community_rounds SET state='closing',candidates_json=(SELECT json_group_array(json(candidate)) FROM (${ranked})) WHERE id=? AND state='open' AND closes_at<=?`).bind(rulesRevision, contentApiVersion, id, now),
        db.prepare(`UPDATE community_rounds SET winner_json=json_extract(candidates_json,'$[0]'),state=CASE WHEN json_array_length(candidates_json)=0 THEN 'no_winner' ELSE 'closing' END WHERE id=? AND state='closing' AND winner_json IS NULL`).bind(id),
        db.prepare(`INSERT INTO community_merge_operations(round_id,operation_id,expected_head_sha) SELECT id,'merge:'||id,json_extract(winner_json,'$.headSha') FROM community_rounds WHERE id=? AND winner_json IS NOT NULL ON CONFLICT DO NOTHING`).bind(id),
      ]);
      return (await getRound(id))!;
    },
    async recordBackup(id, receipt) {
      const existing = await getRound(id); requireCommunity(existing?.winner && existing.state === 'closing', 'backup-round-not-closing', 409);
      await verifyBackupReceipt(id, existing.winner, receipt); assertBackupIdentity(existing, receipt);
      await db.batch([db.prepare(`INSERT INTO community_round_backups(round_id,operation_id,manifest_sha256,receipt_json,confirmed_at) SELECT id,?,?,?,? FROM community_rounds WHERE id=? AND state='closing' AND json_extract(winner_json,'$.headSha')=? AND json_extract(winner_json,'$.baseSha')=? AND json_extract(winner_json,'$.key.repositoryId')=? AND json_extract(winner_json,'$.key.number')=? AND json_extract(winner_json,'$.technicalEvidenceHash')=? ON CONFLICT DO NOTHING`).bind(receipt.manifest.operationId, receipt.manifestSha256, JSON.stringify(receipt), receipt.confirmedAt, id, receipt.manifest.winner.headSha, receipt.manifest.baseSha, receipt.manifest.repositoryId, receipt.manifest.winner.key.number, receipt.manifest.winner.technicalEvidenceHash)]);
      const value = await getRound(id); requireCommunity(value?.backupReceipt && value.backupReceipt.manifestSha256 === receipt.manifestSha256, 'backup-receipt-mismatch', 409); return value.backupReceipt;
    },
    async finishMerge(id, receipt) {
      const existing = await getRound(id); requireCommunity(existing?.winner, 'round-no-winner', 409);
      if ('blockedReason' in receipt) await db.prepare("UPDATE community_rounds SET state='blocked',blocked_reason=? WHERE id=? AND state='closing'").bind(receipt.blockedReason, id).run();
      else {
        requireCommunity(existing.backupReceipt, 'confirmed-backup-required', 409); assertBackupIdentity(existing, existing.backupReceipt);
        requireCommunity(receipt.roundId === id && receipt.headSha === existing.winner.headSha, 'merge-receipt-mismatch', 409);
        await db.batch([db.prepare("UPDATE community_rounds SET state='merged',merge_receipt_json=? WHERE id=? AND state='closing' AND json_extract(winner_json,'$.headSha')=? AND EXISTS(SELECT 1 FROM community_round_backups b WHERE b.round_id=community_rounds.id AND b.manifest_sha256=?)").bind(JSON.stringify(receipt), id, receipt.headSha, existing.backupReceipt.manifestSha256), db.prepare('UPDATE community_merge_operations SET result_json=? WHERE round_id=? AND EXISTS(SELECT 1 FROM community_rounds WHERE id=? AND state=\'merged\')').bind(JSON.stringify(receipt), id, id), db.prepare("UPDATE community_proposals SET moderation_state='merged',snapshot_json=json_set(snapshot_json,'$.state','merged','$.sourceState','closed','$.mergedCommitSha',?,'$.sourceCheckedAt',?) WHERE repository_id=? AND pr_number=? AND head_sha=? AND EXISTS(SELECT 1 FROM community_rounds WHERE id=? AND state='merged' AND json_extract(merge_receipt_json,'$.mergeCommitSha')=?)").bind(receipt.mergeCommitSha, receipt.mergedAt, existing.winner.key.repositoryId, existing.winner.key.number, receipt.headSha, id, receipt.mergeCommitSha)]);
      }
      return (await getRound(id))!;
    },
    async markReleased(key, headSha, deploymentId, contentSha) { const result = await db.batch([db.prepare(`INSERT INTO community_releases(repository_id,pr_number,approved_head_sha,deployment_id,content_sha) SELECT ?,?,?,?,? FROM community_proposals WHERE repository_id=? AND pr_number=? AND head_sha=? AND json_extract(snapshot_json,'$.mergedCommitSha') IS NOT NULL ON CONFLICT DO NOTHING`).bind(key.repositoryId, key.number, headSha, deploymentId, contentSha, key.repositoryId, key.number, headSha), db.prepare("UPDATE community_proposals SET moderation_state='released' WHERE repository_id=? AND pr_number=? AND head_sha=? AND EXISTS(SELECT 1 FROM community_releases WHERE repository_id=? AND pr_number=? AND deployment_id=? AND approved_head_sha=? AND content_sha=?)").bind(key.repositoryId, key.number, headSha, key.repositoryId, key.number, deploymentId, headSha, contentSha)]); requireCommunity(result.some(row => Number(row.meta.changes) > 0), 'release-source-mismatch', 409); },
  };
}
