import assert from 'node:assert/strict';
import { createRemoteCommunityD1 } from './community-remote-d1';
import { auditStore, auditProposal, AUDIT_HEAD } from './community-audit-fixtures';
import { createD1CommunityStore } from '../functions/communityStoreD1';
import { createReleaseRecorder, type ReleaseProofPort } from '../src/service/community/release';
import type { ReleaseReceipt } from '../src/community/release';

const { store: seed, db } = await auditStore('d1'); const proposal = { ...auditProposal(), sourceState: 'closed' as const, mergedCommitSha: 'e'.repeat(40) };
await seed.importProposal(proposal, []);
const database = '12345678-1234-1234-1234-123456789abc'; const env = { CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32), D1_DATABASE_ID: database, CLOUDFLARE_API_TOKEN: 'fixture-never-print' };
let wrongBinding = false, failAt: number | null = null, mutations = 0;
const transport: typeof fetch = async (input, options) => {
  const url = new URL(String(input)); assert.equal(url.hostname, 'api.cloudflare.com'); assert.equal(options?.redirect, 'error');
  if (url.pathname.endsWith(`/d1/database/${database}`)) return Response.json({ success: true, result: { uuid: database } });
  if (url.pathname.endsWith('/pages/projects/proof-of-concept-ab-deckbuilder')) return Response.json({ success: true, result: { name: 'proof-of-concept-ab-deckbuilder', deployment_configs: { production: { d1_databases: { GHOSTS_DB: { id: wrongBinding ? 'wrong' : database } } } } } });
  assert(url.pathname.endsWith('/query')); const body = JSON.parse(String(options?.body));
  const queries = body.batch ?? [body]; if (body.batch) { assert.equal(queries.length, 2); db!.sqlite.exec('BEGIN IMMEDIATE'); }
  try {
    const results = queries.map((query: { sql: string; params: any[] }, index: number) => {
      if (!query.sql.startsWith('SELECT')) mutations++;
      if (body.batch && failAt === index) throw new Error('isolated SQL fault');
      const statement = db!.sqlite.prepare(query.sql); if (statement.columns().length) return { success: true, results: statement.all(...query.params), meta: { changes: 0 } };
      return { success: true, results: [], meta: { changes: Number(statement.run(...query.params).changes) } };
    });
    if (body.batch) db!.sqlite.exec('COMMIT'); return Response.json({ success: true, result: results });
  } catch { if (body.batch) db!.sqlite.exec('ROLLBACK'); return Response.json({ success: false, errors: [{ code: 9999 }] }); }
};
const runtimePath = 'src/data/content/skills.v1.json';
const receipt: ReleaseReceipt = { deploymentId: 'actual-reviewed-fixture', contentSha: 'd'.repeat(40), promotions: [{ key: proposal.key, approvedHeadSha: AUDIT_HEAD, runtimePaths: [runtimePath], runtimeHashes: ['f'.repeat(64)] }] };
let proofValid = true;
const proof: ReleaseProofPort = { async deployment() { return { succeeded: proofValid, contentSha: receipt.contentSha, runtimeFiles: { [runtimePath]: 'f'.repeat(64) } }; }, async mergedAncestor() { return true; } };
const readOnlyDb = await createRemoteCommunityD1({ env, fetch: transport, readOnly: true }); const readOnlyStore = createD1CommunityStore(readOnlyDb);
await createReleaseRecorder(readOnlyStore, proof, { dryRun: true })(receipt); assert.equal(mutations, 0); assert.equal((await seed.getProposal(proposal.key))!.state, 'merged');
await assert.rejects(readOnlyDb.prepare("UPDATE community_proposals SET moderation_state='released'").run(), /read-only/); assert.equal(mutations, 0);
wrongBinding = true; await assert.rejects(createRemoteCommunityD1({ env, fetch: transport }), /binding-mismatch/); wrongBinding = false;
const remote = await createRemoteCommunityD1({ env, fetch: transport }); const store = createD1CommunityStore(remote); const record = createReleaseRecorder(store, proof);
proofValid = false; await assert.rejects(record(receipt)); assert.equal(mutations, 0); proofValid = true;
for (const boundary of [0, 1]) { failAt = boundary; await assert.rejects(record(receipt)); assert.equal((await seed.getProposal(proposal.key))!.state, 'merged'); assert.equal(db!.sqlite.prepare('SELECT COUNT(*) AS n FROM community_releases').get()!.n, 0); }
failAt = null; await record(receipt); await record(receipt); assert.equal((await seed.getProposal(proposal.key))!.state, 'released'); assert.equal(db!.sqlite.prepare('SELECT COUNT(*) AS n FROM community_releases').get()!.n, 1);
await assert.rejects(store.markReleased(proposal.key, AUDIT_HEAD, receipt.deploymentId, '0'.repeat(40)), /release-source-mismatch/);
assert.equal(db!.sqlite.prepare('SELECT content_sha FROM community_releases').get()!.content_sha, receipt.contentSha);
console.log('community remote release OK: explicit D1/project binding; read-only dry run cannot mutate; actual SQLite two-statement batch rollback at both boundaries; deployment proof failure blocks; verified receipt records and replays once; conflicting receipt refused; no actual cloud writes');
