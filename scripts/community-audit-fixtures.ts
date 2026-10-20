import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import type { D1Database, D1PreparedStatement, D1Result } from '../functions/d1';
import { createD1CommunityStore } from '../functions/communityStoreD1';
import { createDurableCommunityState, createFileCommunityStore } from '../server/communityStoreFile';
import type { CommunityStore } from '../src/service/community/store';
import type { ProposalSnapshot } from '../src/community/types';
import type { GitHubReadPort, GitHubPr } from '../src/service/community/github';
export class AuditSqliteD1 implements D1Database {
  readonly sqlite = new DatabaseSync(':memory:');
  failAtStatement: number | null = null;
  prepare(query: string): D1PreparedStatement {
    let values: any[] = [];
    const execute = (): D1Result<any> => {
      const statement = this.sqlite.prepare(query);
      const rows = statement.columns().length > 0 ? statement.all(...values) : [];
      const meta = statement.columns().length > 0 ? { changes: 0 } : statement.run(...values);
      return { success: true, results: rows, meta: { changes: Number(meta.changes) } };
    };
    const result: D1PreparedStatement & { execute(): D1Result } = {
      bind(...bound) { values = bound; return result; },
      async first<T>(column?: string) { const row = thisSqlite.prepare(query).get(...values) as Record<string, unknown> | undefined; return (row ? column ? row[column] : row : null) as T | null; },
      async all<T>() { return execute() as D1Result<T>; },
      async run<T>() { return execute() as D1Result<T>; },
      execute,
    };
    const thisSqlite = this.sqlite;
    return result;
  }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => { if (this.failAtStatement === index) throw new Error(`injected-statement-${index}`); return (statement as D1PreparedStatement & { execute(): D1Result<T> }).execute(); });
      this.sqlite.exec('COMMIT'); return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
export const auditHash = async (value: string): Promise<string> => createHash('sha256').update(value).digest('hex');
export const auditHashBytes = async (value: Uint8Array): Promise<string> => createHash('sha256').update(value).digest('hex');
export const AUDIT_REPOSITORY_ID = '1426486653';
export const AUDIT_HEAD = 'a'.repeat(40);
export const AUDIT_BASE = 'b'.repeat(40);
export const AUDIT_RULES = 'c'.repeat(40);
export function auditProposal(number = 1, headSha = AUDIT_HEAD): ProposalSnapshot {
  return { key: { repositoryId: AUDIT_REPOSITORY_ID, number }, headSha, baseSha: AUDIT_BASE, manifest: { version: 1, title: '<script>literal proposal</script>', category: 'card', description: 'An idea awaiting trusted implementation.', attribution: 'Original audit illustration', contentPaths: [], previewPaths: [] }, manifestPath: `community/proposals/audit-${number}/proposal.json`, manifestSha256: 'f'.repeat(64), moderationRevision: 0, state: 'pending_review', sourceState: 'open', sourceUrl: `https://github.com/wwang109/wandering-hand-content/pull/${number}`, sourceCheckedAt: Date.now(), importedAt: Date.now(), mergedCommitSha: null, reviewedHeadSha: null, technical: null, validation: 'needs_review', supportTotal: 0 };
}
export function fixtureGithub(proposal = auditProposal()): GitHubReadPort & { current: ProposalSnapshot; outage: boolean; race: boolean } {
  const port = {
    current: proposal, outage: false, race: false,
    async readPr(key: ProposalSnapshot['key']): Promise<GitHubPr> {
      if (port.outage) throw new Error('audit-source-outage');
      if (key.repositoryId !== AUDIT_REPOSITORY_ID) throw new Error('repository-mismatch');
      return { key, headSha: port.current.headSha, baseSha: port.current.baseSha, state: port.current.sourceState, mergedCommitSha: port.current.mergedCommitSha, url: port.current.sourceUrl, manifestPath: port.current.manifestPath };
    },
    async readFilesAtSha(_key: ProposalSnapshot['key'], sha: string, paths: readonly string[]) {
      const files = paths.map(path => ({ path, bytes: new TextEncoder().encode(JSON.stringify(port.current.manifest)), blobSha: sha, mode: '100644' }));
      if (port.race) { port.current = { ...port.current, headSha: 'd'.repeat(40) }; port.race = false; }
      return files;
    },
    async listChangedPrs() { if (port.outage) throw new Error('audit-source-outage'); return { keys: [port.current.key], nextCursor: null }; },
  };
  return port;
}
export async function auditStore(kind: 'file' | 'd1'): Promise<{ store: CommunityStore; db?: AuditSqliteD1; durable?: ReturnType<typeof createDurableCommunityState> }> {
  if (kind === 'd1') {
    const db = new AuditSqliteD1();
    for (const path of ['migrations/0003_community.sql', 'migrations/0005_community_points.sql', 'migrations/0006_voting_rounds.sql', 'migrations/0007_community_backups.sql', 'migrations/0008_community_source_sync.sql']) db.sqlite.exec(readFileSync(path, 'utf8'));
    return { store: createD1CommunityStore(db), db };
  }
  mkdirSync('tmp/community/audits', { recursive: true });
  const durable = createDurableCommunityState(`tmp/community/audits/${randomUUID()}.json`);
  return { store: createFileCommunityStore(durable), durable };
}
export async function admit(store: CommunityStore, proposal = auditProposal(), ready = false): Promise<ProposalSnapshot> {
  await store.importProposal(proposal, []);
  await store.moderate({ accountId: 'moderator', input: { key: proposal.key, headSha: proposal.headSha, expectedRevision: 0, decision: 'open', note: 'audit-private-note', operationId: `review:${proposal.key.number}:${proposal.headSha}`, ...(ready ? { technical: { key: proposal.key, headSha: proposal.headSha, rulesRevision: AUDIT_RULES, contentApiVersion: 1, evidenceHash: 'e'.repeat(64), reviewerId: 'moderator', admittedAt: Date.now() } } : {}) }, payloadHash: `review:${proposal.key.number}`, now: Date.now() });
  return (await store.getProposal(proposal.key))!;
}
export async function fund(store: CommunityStore, accountId: string, delta: number, operationId = randomUUID()): Promise<void> {
  await store.correctPoints({ accountId, delta, operationId, reason: 'Audit operational credit fixture; not a canonical win' }, 'audit-moderator', await auditHash(`${accountId}:${delta}:${operationId}`), randomUUID(), Date.now());
}
