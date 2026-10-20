import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { configureCommunityGithub } from './community-github-setup';
import type { AutomationConfig } from './community-automation';

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
const sha = 'a'.repeat(40), workflow = Buffer.from('approved read-only candidate validator');
const config = { ...JSON.parse(readFileSync('community-automation.config.example.json', 'utf8')), mergerInstallationId: '456', validationWorkflowId: 123, validationAnchorSha: sha, trustedGameRevision: sha, validationWorkflowSha256: createHash('sha256').update(workflow).digest('hex') } as AutomationConfig;
const env = { COMMUNITY_SETUP_OWNER_TOKEN: 'owner-fixture-never-print', COMMUNITY_MERGER_PRIVATE_KEY: privateKey };
function fixture(mode = ''): { fetch: typeof fetch; writes: string[]; rules: any[] } {
  const branch = { source_type: 'Repository', target: 'branch', enforcement: 'active', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } };
  const rules: any[] = [{ ...branch, id: 25453489, name: 'Existing main update lock', bypass_actors: [], rules: [{ type: 'update' }, { type: 'deletion' }, { type: 'non_fast_forward' }] }, { id: 3, source_type: 'Repository', target: 'tag', enforcement: 'active', conditions: { ref_name: { include: ['refs/tags/community-backup/*'], exclude: [] } }, bypass_actors: [], rules: mode === 'weak-backup' ? [{ type: 'update' }] : [{ type: 'update' }, { type: 'deletion' }] }];
  if (mode === 'unknown-update-rule') rules[0].rules.push({ type: 'required_signatures' });
  let variable: string | null = null; const writes: string[] = [];
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input)), path = url.pathname, method = options?.method ?? 'GET'; assert.equal(url.origin, 'https://api.github.com'); assert.equal(options?.redirect, 'error');
    const body = options?.body ? JSON.parse(String(options.body)) : null;
    if (method !== 'GET' && !path.endsWith('/access_tokens')) writes.push(`${method} ${path}`);
    if (path.endsWith('/wandering-hand-content')) return Response.json({ id: 1426486653, default_branch: 'main', permissions: { admin: mode !== 'no-admin' } });
    if (path.endsWith('/installation')) return Response.json({ id: 456, app_id: 5391036, app_slug: config.mergerAppSlug, account: { login: mode === 'wrong-owner' ? 'ai-wwang' : 'wwang109' }, repository_selection: mode === 'broad' ? 'all' : 'selected', permissions: { contents: 'write', pull_requests: 'write', checks: 'write', actions: 'read' } });
    if (path.endsWith('/access_tokens')) { assert.deepEqual(body.repository_ids, [1426486653]); assert(Object.values(body.permissions).every(value => value === 'read')); return Response.json({ token: 'scoped-fixture-never-print' }); }
    if (path === '/installation/repositories') return Response.json({ total_count: mode === 'wrong-scope' ? 2 : 1, repositories: [{ id: 1426486653 }] });
    if (path.includes('/commits/')) return mode === 'unpublished' ? new Response('', { status: 404 }) : Response.json({ sha });
    if (path.includes('/contents/scripts/')) return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from('trusted tooling').toString('base64') });
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha } });
    if (path.includes('/compare/')) return Response.json({ status: 'identical' });
    if (path.endsWith('/actions/workflows/123')) return Response.json({ path: '.github/workflows/validate-content.yml', state: 'active' });
    if (path.endsWith('/contents/.github/workflows/validate-content.yml')) return Response.json({ encoding: 'base64', content: (mode === 'changed-workflow' ? Buffer.from('unreviewed') : workflow).toString('base64') });
    if (path.endsWith('/rulesets') && method === 'GET') return Response.json(rules.map(rule => ({ id: rule.id })));
    if (path.endsWith('/rulesets') && method === 'POST') { if (mode === 'invalid-App') return new Response('', { status: 422 }); const rule = { ...body, id: 4, source_type: 'Repository' }; rules.push(rule); return Response.json(rule); }
    if (/\/rulesets\/\d+$/.test(path)) { const id = Number(path.split('/').at(-1)), index = rules.findIndex(rule => rule.id === id); if (method === 'PUT') { assert(id !== 3); rules[index] = { ...body, id, source_type: 'Repository' }; } return Response.json(rules[index]); }
    if (path.endsWith('/actions/variables/TRUSTED_GAME_REVISION') && method === 'GET') return variable ? Response.json({ name: 'TRUSTED_GAME_REVISION', value: variable }) : new Response('', { status: 404 });
    if (path.includes('/actions/variables') && ['POST', 'PATCH'].includes(method)) { if (mode === 'variable-fault') throw new Error('isolated variable failure'); variable = body.value; return new Response(null, { status: 204 }); }
    throw new Error(`Unexpected setup fixture ${method} ${path}`);
  };
  return { fetch: transport, writes, rules };
}
for (const mode of ['no-admin', 'wrong-owner', 'broad', 'wrong-scope', 'unpublished', 'changed-workflow', 'weak-backup', 'unknown-update-rule']) { const probe = fixture(mode); await assert.rejects(configureCommunityGithub(config, { env, fetch: probe.fetch })); assert.equal(probe.writes.length, 0); }
for (const mode of ['invalid-App', 'variable-fault']) { const probe = fixture(mode); await assert.rejects(configureCommunityGithub(config, { env, fetch: probe.fetch })); assert.equal(probe.rules[0].bypass_actors.length, 0); assert(!probe.writes.some(write => write.endsWith('/rulesets/25453489'))); }
const good = fixture(); const result = await configureCommunityGithub(config, { env, fetch: good.fetch }); assert.equal(result.mergeEnabled, false);
assert.deepEqual(good.writes.map(write => write.split(' ')[0]), ['POST', 'POST', 'PUT']);
assert.deepEqual(good.rules[0].bypass_actors, [{ actor_type: 'Integration', actor_id: 5391036, bypass_mode: 'pull_request' }]);
assert.deepEqual(good.rules[0].rules, [{ type: 'update' }, { type: 'deletion' }, { type: 'non_fast_forward' }]);
assert.equal(good.rules[2].bypass_actors.length, 0); assert.equal(good.rules[2].rules[1].parameters.required_status_checks.length, 4);
await configureCommunityGithub(config, { env, fetch: good.fetch }); assert.equal(good.rules.length, 3);
assert(!JSON.stringify(result).includes('never-print'));
console.log('community GitHub setup OK: selected requested-repo installation and published tooling required; eight prerequisite failures write nothing; invalid App/variable failure retain main lock; no-bypass App-pinned checks precede sole PR-only updater bypass; actual update/deletion/non-fast-forward restrictions preserved; replay stable; backup rules untouched; no actual external writes');
