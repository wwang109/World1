import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { buildRunExecutors, type RequiredExecutors } from './build-run-executors';
import { refreshBuildRulesMetadata } from './sync-community-content';
import { EXECUTOR_PAGES_REGISTRY, hydrateExecutorArchives } from './run-executor-archive';

function allFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(join(root, entry.name)) : [join(root, entry.name)]);
}
export async function checkExecutorBundle(): Promise<{ bytes: number; gzipBytes: number; assets: number }> {
  const entries = allFiles('functions').filter(path => path.endsWith('.ts'));
  const result = await build({ stdin: { contents: entries.map((path, i) => `export * as module${i} from ${JSON.stringify(`./${path.replaceAll('\\', '/')}`)};`).join('\n'), resolveDir: resolve('.') }, bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', target: 'es2022', metafile: true });
  const data = result.outputFiles[0]!.contents;
  if (data.length > 63 * 1024 * 1024) throw new Error('Executor bundle exceeds the 64 MiB Worker limit with routing reserve');
  const assets = allFiles('public');
  if (assets.length > 20000) throw new Error('Retained art exceeds the 20,000 asset floor');
  for (const path of assets) if (statSync(path).size > 25 * 1024 * 1024) throw new Error(`Asset exceeds 25 MiB: ${relative('.', path)}`);
  return { bytes: data.length, gzipBytes: gzipSync(data).length, assets: assets.length };
}
export async function exportRequiredExecutors(): Promise<RequiredExecutors> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID, databaseId = process.env.D1_DATABASE_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !token) throw new Error('Executor preflight requires Cloudflare account, D1 database and API token configuration');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT rules_revision,content_sha,source_digest,approved,active_references FROM eligible_executor_revisions WHERE approved=1 OR active_references>0' }),
  });
  if (!response.ok) throw new Error(`Executor database export failed (${response.status})`);
  const body = await response.json() as { success: boolean; result: { results: { rules_revision: string; content_sha: string; source_digest: string | null; approved: number }[] }[] };
  if (!body.success || !body.result[0]) throw new Error('Executor database export was not successful');
  const rows = body.result[0].results;
  if (rows.some(row => row.approved !== 1 || !row.source_digest || !row.rules_revision.endsWith(`.${row.source_digest}`))) throw new Error('Active executor lacks an approved immutable source registry entry');
  return { exportedAt: Date.now(), databaseId, keys: rows.map(row => ({ contentSha: row.content_sha, rulesRevision: row.rules_revision })), approvals: rows.map(row => ({ key: { contentSha: row.content_sha, rulesRevision: row.rules_revision }, sourceDigest: row.source_digest!, approved: 1 })) };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/run-executor-preflight.ts')) {
  if (process.argv.includes('--production')) {
    refreshBuildRulesMetadata(resolve('.'), { production: true });
    const required = await exportRequiredExecutors();
    mkdirSync('tmp/community', { recursive: true }); writeFileSync('tmp/community/required-executors.json', JSON.stringify(required, null, 2));
    await hydrateExecutorArchives({ approvals: required.approvals!, registryUrl: process.env.RUN_EXECUTOR_ARCHIVE_REGISTRY_URL ?? EXECUTOR_PAGES_REGISTRY });
    buildRunExecutors({ production: true, required });
  } else {
    const manifest = JSON.parse(readFileSync('src/service/runs/generated/manifest.json', 'utf8')) as { archives: unknown[] };
    if (!manifest.archives.length) throw new Error('No executor archive was generated');
  }
  const checked = await checkExecutorBundle();
  console.log(`executor preflight OK: ${checked.bytes} bundled bytes, ${checked.gzipBytes} gzip bytes, ${checked.assets} immutable/current assets`);
}
