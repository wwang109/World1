import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCommunityJson, requireCommunity } from '../src/community/validate';
import { currentRulesRevision, readBuildMetadata } from './sync-community-content';
import { EXECUTOR_PAGES_ORIGIN, inspectLocalArchive, type ArchiveEnvelope } from './run-executor-archive';
import type { ExecutorArchive } from '../src/service/runs/executorArchive';

export const APPROVE_EXECUTOR_SQL = `INSERT INTO eligible_executor_revisions(rules_revision,content_sha,source_digest,approved,active_references)
VALUES(?,?,?,1,0) ON CONFLICT(rules_revision,content_sha) DO UPDATE SET source_digest=excluded.source_digest,approved=1
WHERE eligible_executor_revisions.source_digest IS NULL OR eligible_executor_revisions.source_digest=excluded.source_digest
RETURNING rules_revision,content_sha,source_digest,approved,active_references`;
interface RegistryRow { rules_revision: string; content_sha: string; source_digest: string | null; approved: number; active_references: number }
export interface ExecutorApprovalPorts { root?: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; currentRules?: (root: string) => string; wait?: () => Promise<void> }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export async function approveCurrentExecutor(options: { apply?: boolean; waitForRuntime?: boolean } = {}, ports: ExecutorApprovalPorts = {}): Promise<{ mode: 'dry-run' | 'apply'; key: ExecutorArchive['key']; sourceDigest: string; activeReferences: number; approved: boolean }> {
  const root = resolve(ports.root ?? '.'), env = ports.env ?? process.env, transport = ports.fetch ?? fetch;
  const metadata = readBuildMetadata(root);
  const generated = parseCommunityJson(readFileSync(join(root, 'src/service/runs/generated/manifest.json'), 'utf8')) as { current: ExecutorArchive['key']; archives: ExecutorArchive[] };
  const current = generated.archives.find(archive => archive.key.contentSha === generated.current.contentSha && archive.key.rulesRevision === generated.current.rulesRevision);
  requireCommunity(current && /^[a-f0-9]{40}$/.test(current.sourceCommit) && current.sourceCommit === metadata.rulesRevision && current.key.contentSha === metadata.contentSha && (ports.currentRules ?? currentRulesRevision)(root) === current.sourceCommit, 'approval-requires-clean-current-published-production-manifest');
  const verified = inspectLocalArchive(join(root, '.run-executor-archive', current.archiveId), { key: current.key, sourceDigest: current.sourceDigest, approved: 1 });
  requireCommunity(JSON.stringify(verified.archive) === JSON.stringify(current), 'approval-current-generated-archive-mismatch');
  for (const [path, expected] of Object.entries({ ...current.files, ...current.artFiles })) requireCommunity(hash(readFileSync(join(root, path))) === expected, 'approval-current-source-changed');
  const contentBytes = readFileSync(join(root, 'content-manifest.v1.json'));
  requireCommunity(hash(contentBytes) === metadata.manifestSha256, 'approval-content-manifest-changed');
  const contentManifest = parseCommunityJson(contentBytes.toString('utf8')) as { files: { path: string; sha256: string }[] };
  const request = async (url: string, init: RequestInit = {}, maximum = 1024 * 1024): Promise<any> => {
    const response = await transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    requireCommunity(response.ok && response.body, `executor-approval-http-${response.status}`);
    const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; requireCommunity(size <= maximum, 'executor-approval-response-too-large'); chunks.push(item.value); } } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return parseCommunityJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  const authorization: Record<string, string> = env.COMMUNITY_READER_TOKEN ? { authorization: `Bearer ${env.COMMUNITY_READER_TOKEN}` } : {};
  const published = await request(`https://api.github.com/repos/wwang109/World1/commits/${current.sourceCommit}`, { headers: { accept: 'application/vnd.github+json', ...authorization } });
  requireCommunity(published.sha === current.sourceCommit, 'approval-game-source-unpublished');
  const canonical = await request(`https://api.github.com/repos/wwang109/wandering-hand-content/contents/content-manifest.v1.json?ref=${current.key.contentSha}`, { headers: { accept: 'application/vnd.github+json', ...authorization } }, 2 * 1024 * 1024);
  requireCommunity(canonical.encoding === 'base64' && typeof canonical.content === 'string' && hash(Buffer.from(canonical.content, 'base64')) === metadata.manifestSha256, 'approval-content-revision-unpublished-or-mismatch');
  for (let attempt = 0; ; attempt++) {
    try {
      const runtime = await request(`${EXECUTOR_PAGES_ORIGIN}/community/runtime?executorApproval=${current.archiveId}`, { headers: { 'cache-control': 'no-cache' } });
      requireCommunity(runtime.rulesRevision === current.sourceCommit && runtime.contentSha === current.key.contentSha && runtime.contentApiVersion === 1 && runtime.executor?.contentSha === current.key.contentSha && runtime.executor?.rulesRevision === current.key.rulesRevision && contentManifest.files.every(file => runtime.runtimeFiles?.[file.path] === file.sha256), 'approval-deployed-runtime-mismatch');
      const archive = await request(`${EXECUTOR_PAGES_ORIGIN}/executor-archives/${current.archiveId}/archive.json`, { headers: { 'cache-control': 'no-cache' } }) as ArchiveEnvelope;
      requireCommunity(archive.schemaVersion === 1 && JSON.stringify(archive) === JSON.stringify(verified), 'approval-deployed-archive-manifest-mismatch'); break;
    } catch (error) { if (!options.waitForRuntime || attempt >= 29) throw error; await (ports.wait ?? (() => new Promise<void>(done => setTimeout(done, 2000))))(); }
  }
  const account = env.CLOUDFLARE_ACCOUNT_ID, database = env.D1_DATABASE_ID, token = env.CLOUDFLARE_API_TOKEN;
  requireCommunity(account && /^[a-f0-9]{32}$/.test(account) && database && /^[a-f0-9-]{36}$/.test(database) && token, 'approval-explicit-Cloudflare-account-D1-token-required');
  const cfBase = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`;
  const identity = await request(cfBase, { headers: { authorization: `Bearer ${token}` } });
  requireCommunity(identity.success === true && identity.result?.uuid === database, 'approval-D1-target-identity-mismatch');
  const project = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/proof-of-concept-ab-deckbuilder`, { headers: { authorization: `Bearer ${token}` } });
  requireCommunity(project.success === true && project.result?.name === 'proof-of-concept-ab-deckbuilder' && project.result?.deployment_configs?.production?.d1_databases?.GHOSTS_DB?.id === database, 'approval-production-D1-binding-mismatch');
  const query = async (sql: string, params: string[]): Promise<RegistryRow[]> => {
    const result = await request(`${cfBase}/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
    requireCommunity(result.success === true && result.result?.[0]?.success === true && Array.isArray(result.result[0].results), 'approval-D1-query-failed'); return result.result[0].results;
  };
  const keyParams = [current.key.rulesRevision, current.key.contentSha];
  const existing = (await query('SELECT rules_revision,content_sha,source_digest,approved,active_references FROM eligible_executor_revisions WHERE rules_revision=? AND content_sha=?', keyParams))[0];
  requireCommunity(!existing || existing.source_digest === null || existing.source_digest === current.sourceDigest, 'approval-immutable-source-digest-conflict');
  let row = existing;
  if (options.apply) {
    row = (await query(APPROVE_EXECUTOR_SQL, [...keyParams, current.sourceDigest]))[0];
    requireCommunity(row?.approved === 1 && row.source_digest === current.sourceDigest, 'approval-raced-or-unconfirmed');
  }
  return { mode: options.apply ? 'apply' : 'dry-run', key: current.key, sourceDigest: current.sourceDigest, activeReferences: row?.active_references ?? 0, approved: row?.approved === 1 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) approveCurrentExecutor({ apply: process.argv.includes('--apply'), waitForRuntime: process.argv.includes('--wait') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error instanceof Error ? error.message : 'executor-approval-failed'); process.exitCode = 1; });
