import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectCommunityAutomation, migrationObjects, type AutomationConfig } from './community-automation';
import { COMMUNITY_CHECK_NAMES } from '../src/service/community/mergerGithub';
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
const workflow = Buffer.from('trusted read-only workflow fixture'); const sha = 'a'.repeat(40); const database = '12345678-1234-1234-1234-123456789abc';
const config: AutomationConfig = { schemaVersion: 1, repository: 'wwang109/wandering-hand-content', repositoryId: '1426486653', mergerAppId: '5391036', mergerAppSlug: 'fixture', mergerInstallationId: '456', validationWorkflowId: 123, validationWorkflowSha256: createHash('sha256').update(workflow).digest('hex'), validationAnchorSha: sha, trustedGameRepository: 'trusted/game', trustedGameRevision: sha, contentSha: sha, gameOrigin: 'https://game.example.invalid', cloudflareAccountId: 'c'.repeat(32), d1DatabaseId: database, d1DatabaseName: 'known-community-db', workerName: 'wandering-hand-community-rounds', localRepositoryBundle: 'fixture.bundle', allowWorkerDeploy: false };
const branch = { target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } };
const rules = [{ ...branch, id: 1, bypass_actors: [{ actor_type: 'Integration', actor_id: 5391036, bypass_mode: 'pull_request' }], rules: [{ type: 'update' }] }, { ...branch, id: 2, bypass_actors: [], rules: [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: Object.values(COMMUNITY_CHECK_NAMES).map(context => ({ context, integration_id: 5391036 })) } }] }, { id: 3, target: 'tag', enforcement: 'active', conditions: { ref_name: { include: ['refs/tags/community-backup/*'], exclude: [] } }, bypass_actors: [], rules: [{ type: 'update' }, { type: 'deletion' }] }];
let wrongOwner = false; let badRules = false; let unpublished = false; let cfFailed = false; let partial = false; let configWrites = 0;
const transport: typeof fetch = async (input, init) => {
  const url = new URL(String(input)); const method = init?.method ?? 'GET'; const path = url.pathname;
  if (method !== 'GET' && !path.endsWith('/access_tokens') && !path.endsWith('/query')) configWrites++;
  if (path === '/repos/wwang109/wandering-hand-content') return Response.json({ id: 1426486653, default_branch: 'main' });
  if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha } });
  if (path.endsWith('/installation')) return Response.json({ id: 456, app_id: 5391036, app_slug: 'fixture', account: { login: wrongOwner ? 'ai-wwang' : 'wwang109' }, repository_selection: wrongOwner ? 'all' : 'selected', permissions: { contents: 'write', pull_requests: 'write', checks: 'write', actions: 'read' } });
  if (path.endsWith('/access_tokens')) { const body = JSON.parse(String(init?.body)); assert.deepEqual(body.repository_ids, [1426486653]); assert(Object.values(body.permissions).every(value => value === 'read')); return Response.json({ token: 'fixture-token-never-print' }); }
  if (path === '/installation/repositories') return Response.json({ total_count: 1, repositories: [{ id: 1426486653 }] });
  if (path.endsWith('/rulesets')) return Response.json((badRules ? rules.slice(0, 1) : rules).map(rule => ({ id: rule.id })));
  if (/\/rulesets\/\d+$/.test(path)) return Response.json(rules.find(rule => rule.id === Number(path.split('/').at(-1))));
  if (path.endsWith('/git/ref/tags/community-backup/bootstrap-2026-10-20')) return Response.json({ object: { type: 'commit', sha } });
  if (path.startsWith('/repos/trusted/game/commits/')) return unpublished ? new Response('', { status: 404 }) : Response.json({ sha });
  if (path.endsWith('/actions/workflows/123')) return Response.json({ path: '.github/workflows/validate-content.yml', state: 'active' });
  if (path.includes('/compare/')) return Response.json({ status: 'identical' });
  if (path.endsWith('/contents/.github/workflows/validate-content.yml')) return Response.json({ encoding: 'base64', content: workflow.toString('base64') });
  if (path.endsWith('/actions/variables/TRUSTED_GAME_REVISION')) return Response.json({ value: sha });
  if (url.origin === 'https://game.example.invalid') return Response.json({ contentSha: sha, rulesRevision: sha, contentApiVersion: 1 });
  if (url.hostname === 'api.cloudflare.com') {
    if (cfFailed) return Response.json({ success: false, errors: [{ code: 10000 }] });
    if (path.endsWith(`/d1/database/${database}`)) return Response.json({ success: true, result: { uuid: database, name: config.d1DatabaseName } });
    if (path.endsWith('/query')) { assert(String(JSON.parse(String(init?.body)).sql).startsWith('SELECT name FROM sqlite_master')); return Response.json({ success: true, result: [{ results: (partial ? ['one'] : ['one', 'two']).map(name => ({ name })) }] }); }
    if (path.endsWith('/pages/projects/proof-of-concept-ab-deckbuilder')) return Response.json({ success: true, result: { name: 'proof-of-concept-ab-deckbuilder', deployment_configs: { production: { d1_databases: { GHOSTS_DB: { id: database } } } } } });
    if (path.endsWith('/settings')) return Response.json({ success: true, result: { bindings: [{ type: 'd1', name: 'GHOSTS_DB', id: database }, { type: 'secret_text', name: 'COMMUNITY_MERGER_PRIVATE_KEY' }] } });
    if (path.endsWith('/schedules')) return Response.json({ success: true, result: { schedules: [{ cron: '*/5 * * * *' }] } });
  }
  throw new Error('Unexpected doctor fixture request');
};
const inspect = () => inspectCommunityAutomation(config, { env: { COMMUNITY_MERGER_PRIVATE_KEY: privateKey, CLOUDFLARE_API_TOKEN: 'fixture-CF-token-never-print' }, fetch: transport, migrationFiles: [{ name: '0008_fixture.sql', objects: ['one', 'two'] }], verifyBundle: () => 'actual-bundle-verification-port-fixture' });
assert((await inspect()).ready);
wrongOwner = true; const wrong = await inspect(); assert.equal(wrong.setupReady, false); assert(wrong.gates.find(gate => gate.name === 'scoped-merger-installation')?.detail.includes('wrong-owner-or-broad-installation')); wrongOwner = false;
badRules = true; assert.equal((await inspect()).ready, false); badRules = false;
unpublished = true; assert.equal((await inspect()).ready, false); unpublished = false;
cfFailed = true; const unavailable = await inspect(); assert.equal(unavailable.ready, false); assert(unavailable.gates.some(gate => gate.detail.includes('10000'))); cfFailed = false;
partial = true; assert.equal((await inspect()).setupReady, false); partial = false;
assert.equal(configWrites, 0); assert(!JSON.stringify(await inspect()).includes('fixture-token-never-print')); assert(!JSON.stringify(await inspect()).includes('fixture-CF-token-never-print'));
assert.deepEqual(migrationObjects('CREATE TABLE x(a); CREATE INDEX ix ON x(a); CREATE TRIGGER z BEFORE UPDATE ON x BEGIN SELECT 1; END;'), ['x', 'ix', 'z']);
console.log('OK community-automation doctor: scoped-target/install/token/rules/published-workflow/runtime/D1/bundle/schema/cron reads; wrong-owner-broad-installation/unpublished-SHA/incomplete-rules/auth10000/partial-schema block; no configuration writes or secret output');
