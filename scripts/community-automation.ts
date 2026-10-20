import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMMUNITY_REPOSITORY } from '../src/community/types';
import { parseCommunityJson, requireCommunity } from '../src/community/validate';
import { githubAppJwt, verifyBackupRulesets, verifyCommunityRulesets } from '../src/service/community/mergerGithub';
import { configureCommunityGithub } from './community-github-setup';
export interface AutomationConfig {
  schemaVersion: 1; repository: string; repositoryId: string; mergerAppId: string; mergerAppSlug: string; mergerInstallationId: string;
  validationWorkflowId: number; validationWorkflowSha256: string; validationAnchorSha: string; trustedGameRepository: string; trustedGameRevision: string;
  contentSha: string; gameOrigin: string; cloudflareAccountId: string; d1DatabaseId: string; d1DatabaseName: string; workerName: string; localRepositoryBundle: string; allowWorkerDeploy: boolean;
  mainUpdateRulesetId?: number;
}
export interface DoctorGate { name: string; ready: boolean; detail: string; requiredForSetup?: boolean }
export interface DoctorResult { ready: boolean; setupReady: boolean; gates: DoctorGate[]; pendingMigrations: string[]; tables: string[] }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export function migrationObjects(sql: string): string[] { return [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi)].map(match => match[1]!); }
export async function inspectCommunityAutomation(config: AutomationConfig, options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; migrationFiles?: { name: string; objects: string[] }[]; verifyBundle?: (path: string) => string } = {}): Promise<DoctorResult> {
  const env = options.env ?? process.env; const transport = options.fetch ?? fetch;
  const gates: DoctorGate[] = []; let pendingMigrations: string[] = []; let tables: string[] = [];
  const gate = async (name: string, action: () => Promise<string>): Promise<void> => { try { gates.push({ name, ready: true, detail: await action() }); } catch (error) { gates.push({ name, ready: false, detail: error instanceof Error ? error.message : 'unavailable' }); } };
  const require = (condition: unknown, detail: string): void => { if (!condition) throw new Error(detail); };
  const request = async (url: string, authorization?: string, body?: unknown): Promise<any> => {
    const response = await transport(url, { method: body === undefined ? 'GET' : 'POST', headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', ...(authorization ? { authorization } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
    require(response.ok, `${new URL(url).hostname}-http-${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer()); require(bytes.length <= 4 * 1024 * 1024, 'doctor-response-too-large'); return parseCommunityJson(new TextDecoder().decode(bytes));
  };
  let readerAuthorization = env.COMMUNITY_READER_TOKEN ? `Bearer ${env.COMMUNITY_READER_TOKEN}` : undefined;
  const github = (path: string, authorization = readerAuthorization) => request(`https://api.github.com/${path}`, authorization);
  const prefix = `repos/${COMMUNITY_REPOSITORY}`;
  let mainSha = '';
  await gate('target-repository', async () => {
    require(config.schemaVersion === 1 && config.repository === COMMUNITY_REPOSITORY && config.repositoryId === '1426486653' && config.workerName === 'wandering-hand-community-rounds', 'configured-target-mismatch');
    const repository = await github(prefix); require(String(repository.id) === config.repositoryId && repository.default_branch === 'main', 'repository-identity-mismatch');
    mainSha = (await github(`${prefix}/git/ref/heads/main`)).object?.sha; require(/^[a-f0-9]{40}$/.test(mainSha), 'main-sha-unavailable'); return `repository ${repository.id}; main ${mainSha}`;
  });
  await gate('scoped-merger-installation', async () => {
    require(/^\d+$/.test(config.mergerAppId) && /^\d+$/.test(config.mergerInstallationId) && Boolean(env.COMMUNITY_MERGER_PRIVATE_KEY), 'App-key-or-target-installation-unconfigured');
    const jwt = `Bearer ${await githubAppJwt(config.mergerAppId, env.COMMUNITY_MERGER_PRIVATE_KEY!, Date.now())}`;
    const installation = await github(`${prefix}/installation`, jwt);
    require(String(installation.id) === config.mergerInstallationId && String(installation.app_id) === config.mergerAppId && installation.account?.login?.toLowerCase() === 'wwang109' && installation.repository_selection === 'selected' && !installation.suspended_at, 'wrong-owner-or-broad-installation');
    require(/^[a-z0-9-]+$/.test(config.mergerAppSlug) && installation.app_slug === config.mergerAppSlug && ['contents', 'pull_requests', 'checks'].every(permission => installation.permissions?.[permission] === 'write') && ['read', 'write'].includes(installation.permissions?.actions), 'merger-App-slug-or-permissions-mismatch');
    const token = await request(`https://api.github.com/app/installations/${config.mergerInstallationId}/access_tokens`, jwt, { repository_ids: [Number(config.repositoryId)], permissions: { contents: 'read', pull_requests: 'read', checks: 'read', actions: 'read' } });
    require(typeof token.token === 'string', 'scoped-installation-token-unavailable');
    const scoped = await github('installation/repositories?per_page=100', `Bearer ${token.token}`);
    require(scoped.total_count === 1 && String(scoped.repositories?.[0]?.id) === config.repositoryId, 'installation-token-not-target-only'); readerAuthorization = `Bearer ${token.token}`;
    return `App ${config.mergerAppId}; selected installation ${installation.id}; token restricted to ${config.repositoryId}`;
  });
  let rules: any[] = [];
  await gate('main-and-backup-protections', async () => { const summaries = await github(`${prefix}/rulesets?includes_parents=true&per_page=100`); require(Array.isArray(summaries) && summaries.length < 100, 'ruleset-list-unavailable'); rules = await Promise.all(summaries.map((summary: { id: number }) => github(`${prefix}/rulesets/${Number(summary.id)}`))); require(verifyCommunityRulesets(rules, Number(config.mergerAppId)), 'main-PR-only-update-and-no-bypass-pinned-checks-or-tag-rules-incomplete'); return 'actual active main rules and immutable backup namespace verified'; });
  await gate('backup-tags', async () => { require(verifyBackupRulesets(rules), 'backup-update-delete-no-bypass-rules-unverified'); const reference = await github(`${prefix}/git/ref/tags/community-backup/bootstrap-2026-10-20`); require(reference.object?.type === 'commit' && reference.object.sha === config.validationAnchorSha, 'bootstrap-backup-reference-mismatch'); return `protected restore point ${reference.object.sha}; versioned GitHub restore point, not offsite storage`; });
  await gate('trusted-published-validation', async () => {
    require(Number.isSafeInteger(config.validationWorkflowId) && config.validationWorkflowId > 0 && /^[a-f0-9]{64}$/.test(config.validationWorkflowSha256) && /^[a-f0-9]{40}$/.test(config.trustedGameRevision) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.trustedGameRepository), 'trusted-tooling-workflow-config-incomplete');
    const commit = await github(`repos/${config.trustedGameRepository}/commits/${config.trustedGameRevision}`); require(commit.sha === config.trustedGameRevision, 'trusted-game-revision-unpublished');
    const workflow = await github(`${prefix}/actions/workflows/${config.validationWorkflowId}`); require(workflow.path === '.github/workflows/validate-content.yml' && workflow.state === 'active', 'trusted-workflow-identity-mismatch');
    const ancestry = await github(`${prefix}/compare/${config.validationAnchorSha}...${mainSha}`); require(['ahead', 'identical'].includes(ancestry.status), 'main-not-descended-from-trusted-anchor');
    const source = await github(`${prefix}/contents/.github/workflows/validate-content.yml?ref=${mainSha}`); require(source.encoding === 'base64' && typeof source.content === 'string' && hash(Buffer.from(source.content, 'base64')) === config.validationWorkflowSha256, 'trusted-workflow-digest-mismatch');
    const variable = await github(`${prefix}/actions/variables/TRUSTED_GAME_REVISION`, env.COMMUNITY_OPERATOR_READER_TOKEN ? `Bearer ${env.COMMUNITY_OPERATOR_READER_TOKEN}` : readerAuthorization); require(variable.value === config.trustedGameRevision, 'workflow-tooling-pin-mismatch'); return `published trusted game ${config.trustedGameRevision}; verified workflow ${config.validationWorkflowId}`;
  });
  await gate('runtime-build-identity', async () => { require(/^[a-f0-9]{40}$/.test(config.contentSha), 'expected-content-SHA-unconfigured'); const origin = new URL(config.gameOrigin); require(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/', 'invalid-game-origin'); const runtime = await request(new URL('/community/runtime', origin).toString()); require(runtime.contentSha === config.contentSha && runtime.rulesRevision === config.trustedGameRevision && runtime.contentApiVersion === 1, 'deployed-runtime-content-or-rules-mismatch'); return `deployed content ${runtime.contentSha}; rules ${runtime.rulesRevision}`; });
  const cfPrefix = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}`;
  const cf = async (path: string, body?: unknown): Promise<any> => { require(/^[a-f0-9]{32}$/.test(config.cloudflareAccountId) && Boolean(env.CLOUDFLARE_API_TOKEN), 'Cloudflare-explicit-read-token-or-account-unconfigured'); const response = await request(`${cfPrefix}/${path}`, `Bearer ${env.CLOUDFLARE_API_TOKEN}`, body); require(response.success === true, `Cloudflare-api-${response.errors?.[0]?.code ?? 'unavailable'}`); return response.result; };
  await gate('D1-database-and-schema', async () => {
    require(/^[a-f0-9-]{36}$/.test(config.d1DatabaseId) && /^[A-Za-z0-9_-]{1,100}$/.test(config.d1DatabaseName), 'D1-target-unconfigured');
    const database = await cf(`d1/database/${config.d1DatabaseId}`); require(database.uuid === config.d1DatabaseId && database.name === config.d1DatabaseName, 'D1-database-identity-mismatch');
    const query = await cf(`d1/database/${config.d1DatabaseId}/query`, { sql: "SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY name" }); tables = query[0]?.results?.map((row: { name: string }) => row.name) ?? [];
    const migrations = options.migrationFiles ?? [];
    for (const migration of migrations) { const present = migration.objects.filter(name => tables.includes(name)); require(present.length === 0 || present.length === migration.objects.length, `partial-schema-${migration.name}-requires-reviewed-repair`); if (present.length === 0) pendingMigrations.push(migration.name); }
    return `${database.name}; ${pendingMigrations.length} pending additive migrations; export required before apply`;
  });
  await gate('Pages-D1-binding', async () => { const project = await cf('pages/projects/proof-of-concept-ab-deckbuilder'); require(project.name === 'proof-of-concept-ab-deckbuilder' && project.deployment_configs?.production?.d1_databases?.GHOSTS_DB?.id === config.d1DatabaseId, 'production-Pages-binding-mismatch'); return 'existing requested Pages project GHOSTS_DB matches target'; });
  await gate('retained-repository-bundle', async () => { require(config.localRepositoryBundle && options.verifyBundle, 'local-repository-bundle-unconfigured'); return options.verifyBundle!(config.localRepositoryBundle); });
  gates.push({ name: 'migrations-current', ready: pendingMigrations.length === 0 && gates.some(item => item.name === 'D1-database-and-schema' && item.ready), requiredForSetup: false, detail: pendingMigrations.length ? `pending reviewed migrations: ${pendingMigrations.join(', ')}` : 'see verified D1 schema gate' });
  await gate('scheduled-worker-deployment', async () => { const settings = await cf(`workers/scripts/${config.workerName}/settings`); const bindings = settings.bindings ?? []; require(bindings.some((binding: any) => binding.type === 'd1' && binding.name === 'GHOSTS_DB' && binding.id === config.d1DatabaseId), 'scheduled-worker-D1-binding-unverified'); require(bindings.some((binding: any) => binding.name === 'COMMUNITY_MERGER_PRIVATE_KEY' && binding.type === 'secret_text'), 'scheduled-worker-App-secret-unconfigured'); const schedule = await cf(`workers/scripts/${config.workerName}/schedules`); require(schedule.schedules?.some((item: any) => item.cron === '*/5 * * * *'), 'scheduled-worker-cron-unverified'); return 'actual scoped Worker binding, App secret metadata and five-minute cron verified'; });
  const worker = gates.find(item => item.name === 'scheduled-worker-deployment'); if (worker) worker.requiredForSetup = false;
  return { ready: gates.every(item => item.ready), setupReady: gates.filter(item => item.requiredForSetup !== false).every(item => item.ready), gates, pendingMigrations, tables };
}
function configuredWorker(config: AutomationConfig, root: string): unknown {
  return { name: config.workerName, main: join(root, 'workers/community-rounds.ts'), compatibility_date: '2026-10-20', account_id: config.cloudflareAccountId, triggers: { crons: ['*/5 * * * *'] }, vars: { COMMUNITY_REPOSITORY_ID: config.repositoryId, COMMUNITY_MERGER_APP_ID: config.mergerAppId, COMMUNITY_MERGER_INSTALLATION_ID: config.mergerInstallationId, COMMUNITY_MERGER_APP_SLUG: config.mergerAppSlug, COMMUNITY_VALIDATION_WORKFLOW_ID: String(config.validationWorkflowId), COMMUNITY_VALIDATION_WORKFLOW_SHA256: config.validationWorkflowSha256, COMMUNITY_VALIDATION_BASE_SHA: config.validationAnchorSha, GAME_RULES_REVISION: config.trustedGameRevision, CONTENT_API_VERSION: '1', COMMUNITY_MERGE_ENABLED: 'false' }, d1_databases: [{ binding: 'GHOSTS_DB', database_name: config.d1DatabaseName, database_id: config.d1DatabaseId }] };
}
async function main(): Promise<void> {
  const option = (name: string): string | undefined => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
  const root = resolve('.'); const config = parseCommunityJson(readFileSync(option('--config') ?? 'community-automation.config.example.json', 'utf8')) as AutomationConfig;
  if (process.argv.includes('--configure-github')) { requireCommunity(!process.argv.includes('--apply'), 'configure-github-and-Worker-apply-are-separate-operations'); console.log(JSON.stringify(await configureCommunityGithub(config), null, 2)); return; }
  const migrations = readdirSync('migrations').filter(name => /^\d+_.+\.sql$/.test(name)).sort().map(name => ({ name, objects: migrationObjects(readFileSync(join('migrations', name), 'utf8')) }));
  const doctorOptions = { migrationFiles: migrations, verifyBundle: (path: string) => { const absolute = resolve(path); requireCommunity(existsSync(absolute) && statSync(absolute).isFile(), 'repository-bundle-missing'); execFileSync('git', ['bundle', 'verify', absolute], { stdio: 'pipe' }); return `verified Git history bundle; SHA256 ${hash(readFileSync(absolute))}`; } };
  const result = await inspectCommunityAutomation(config, doctorOptions);
  const output = resolve(option('--output') ?? 'tmp/community-operator'); const path = join(output, 'wrangler.community-rounds.json');
  requireCommunity(output.startsWith(`${root}\\`) || output.startsWith(`${root}/`), 'operator-output-must-stay-in-workspace');
  let existing = output; while (!existsSync(existing)) existing = dirname(existing);
  const realRoot = realpathSync(root); const realParent = realpathSync(existing); requireCommunity(realParent === realRoot || realParent.startsWith(`${realRoot}\\`) || realParent.startsWith(`${realRoot}/`), 'operator-output-parent-leaves-workspace');
  const wrangler = option('--wrangler');
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'read-only-doctor', ...result, generatedConfigPath: path, workerMergeEnabled: false, plan: ['verify all actual target/install/rules/workflow/runtime/D1/bundle gates', 'export actual remote D1 to private local SQL and hash receipt', 'apply only wholly absent reviewed migrations; refuse partial schema', 'deploy scoped scheduled Worker with merge disabled', 'write configured worker secrets through stdin; no code push or game deployment'] }, null, 2));
  if (!process.argv.includes('--apply') && !process.argv.includes('--write-config')) { if (!result.ready) process.exitCode = 1; return; }
  requireCommunity(config.repository === COMMUNITY_REPOSITORY && config.repositoryId === '1426486653' && config.workerName === 'wandering-hand-community-rounds', 'configured-target-mismatch');
  mkdirSync(output, { recursive: true }); writeFileSync(path, JSON.stringify(configuredWorker(config, root), null, 2));
  if (!process.argv.includes('--apply')) { if (!result.ready) process.exitCode = 1; return; }
  requireCommunity(result.setupReady && config.allowWorkerDeploy === true && wrangler && existsSync(resolve(wrangler)), 'actual-gates-or-explicit-worker-deploy-not-ready', 409);
  const command = (args: string[], input?: string): void => { try { execFileSync(process.execPath, [resolve(wrangler), ...args, '--config', path], { stdio: ['pipe', 'pipe', 'pipe'], input, env: { ...process.env, CI: 'true' }, timeout: 300_000 }); } catch { throw new Error(`scoped-Wrangler-${args[0]}-${args[1] ?? 'command'}-failed; private output suppressed`); } };
  const backupFile = join(output, `d1-backup-${Date.now()}.sql`); command(['d1', 'export', config.d1DatabaseId, '--remote', '--output', backupFile]);
  const bytes = readFileSync(backupFile); requireCommunity(bytes.length > 0, 'database-export-empty'); writeFileSync(`${backupFile}.receipt.json`, JSON.stringify({ databaseId: config.d1DatabaseId, accountId: config.cloudflareAccountId, createdAt: new Date().toISOString(), sha256: hash(bytes), bytes: bytes.length, kind: 'local-D1-export' }, null, 2));
  for (const name of result.pendingMigrations) command(['d1', 'execute', config.d1DatabaseId, '--remote', '--file', join(root, 'migrations', name), '--yes']);
  const migrated = await inspectCommunityAutomation(config, doctorOptions); requireCommunity(migrated.setupReady && migrated.pendingMigrations.length === 0, 'post-migration-readiness-unconfirmed', 409);
  command(['deploy']);
  const secrets: Record<string, string> = {}; for (const name of ['COMMUNITY_MERGER_PRIVATE_KEY', 'COMMUNITY_READER_TOKEN']) if (process.env[name]) secrets[name] = process.env[name]!;
  if (Object.keys(secrets).length) command(['secret', 'bulk'], JSON.stringify(secrets));
  const deployed = await inspectCommunityAutomation(config, doctorOptions); requireCommunity(deployed.ready, 'post-worker-deployment-readiness-unconfirmed', 409);
  console.log(JSON.stringify({ configuredWorker: config.workerName, mergeEnabled: false, databaseBackupReceipt: `${backupFile}.receipt.json`, gameDeployed: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : 'community-operator-failed'); process.exitCode = 1; });
