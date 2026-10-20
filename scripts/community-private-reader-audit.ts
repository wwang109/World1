import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createPrivateGithubReader, privateGithubTransport, PRIVATE_GITHUB_ORIGIN } from '../src/service/community/privateGithubReader';
import { configuredWorker, privateReaderBindingPatch, type AutomationConfig } from './community-automation';
import { createTrustedValidationReader, decodeValidationArtifact, type CandidateValidationReport } from '../src/service/community/trustedValidation';
import { auditProposal, AUDIT_RULES } from './community-audit-fixtures';
import { createGitHubMerger } from '../src/service/community/mergerGithub';
import type { RoundCandidate } from '../src/community/rounds';

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
const repo = 'wwang109/wandering-hand-content', id = '1426486653', token = 'ghs_read_only_fixture_never_disclose';
let now = Date.now(), mode = '', mints = 0, reads = 0, boundCalls = 0;
const zip = Uint8Array.of(80, 75, 3, 4, 0, 0, 0, 0);
const proposal = auditProposal();
const workflowBytes = Buffer.from('trusted exact base read-only candidate workflow');
const report: CandidateValidationReport = { version: 1, repositoryId: Number(id), prNumber: proposal.key.number, headSha: proposal.headSha, baseSha: proposal.baseSha, trustedGameRevision: AUDIT_RULES, contentManifestSha256: 'f'.repeat(64), gameContentApiVersion: 1, results: { snapshot: 'valid', generated: 'valid', proposal: 'valid' }, mechanicsValidation: 'valid', proposalManifests: [{ path: proposal.manifestPath, sha256: proposal.manifestSha256 }] };
function reportArchive(value: unknown, method: 0 | 8): Uint8Array {
  const name = Buffer.from('content-validation-report.json'), body = Buffer.from(JSON.stringify(value)); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
  const payload = method === 8 ? deflateRawSync(body) : body;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + payload.length, 16);
  return Buffer.concat([local, name, payload, central, name, end]);
}
assert.equal((await decodeValidationArtifact(reportArchive(report, 0))).headSha, proposal.headSha);
const reportZip = reportArchive(report, 8), reportDigest = createHash('sha256').update(reportZip).digest('hex');
const transport: typeof fetch = async (input, options) => {
  const url = new URL(String(input)); const path = url.pathname; const headers = new Headers(options?.headers);
  if (url.hostname.endsWith('.blob.core.windows.net') || url.hostname.endsWith('.actions.githubusercontent.com')) {
    assert.equal(headers.get('authorization'), null); assert.equal(headers.get('cookie'), null); assert.equal(options?.redirect, 'manual'); assert(options?.signal);
    if (mode === 'second-redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example' } });
    if (mode === 'oversize-zip') return new Response(new Uint8Array(1_048_577));
    const selected = mode.startsWith('complete') ? reportZip : zip; const body = new ArrayBuffer(selected.length); new Uint8Array(body).set(selected);
    return new Response(body, { headers: { authorization: token, 'set-cookie': `secret=${token}`, location: 'sensitive-signed-url' } });
  }
  assert.equal(url.origin, 'https://api.github.com'); assert(options?.signal);
  assert.equal(headers.get('user-agent'), 'Wandering-Hand-Community-Reader');
  if (path === `/repos/${repo}`) return Response.json({ id: mode === 'wrong-repo' ? 1 : Number(id), full_name: repo, default_branch: 'main' });
  if (path === `/repos/${repo}/installation` || path.endsWith('/access_tokens')) {
    const jwt = headers.get('authorization')!.slice('Bearer '.length).split('.'); assert.equal(jwt.length, 3);
    assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(jwt[2]!, 'base64url'), new TextEncoder().encode(`${jwt[0]}.${jwt[1]}`)));
    const payload = JSON.parse(Buffer.from(jwt[1]!, 'base64url').toString()); assert.equal(payload.iss, '5391036'); assert(payload.exp <= Math.floor(now / 1000) + 540);
    if (path.endsWith('/installation')) return Response.json({ id: mode === 'wrong-installation' ? 999 : 456, app_id: 5391036, app_slug: 'wandering-hand-community-merger', account: { login: mode === 'wrong-owner' ? 'ai-wwang' : 'wwang109' }, repository_selection: mode === 'broad-installation' ? 'all' : 'selected', suspended_at: mode === 'suspended' ? 'now' : null });
    assert.equal(options?.method, 'POST'); mints++;
    assert.deepEqual(JSON.parse(String(options?.body)), { repository_ids: [1426486653], permissions: { contents: 'read', pull_requests: 'read', actions: 'read' } });
    return Response.json({ token, expires_at: new Date(now + (mode === 'long-expiry' ? 24 * 60 : 60) * 60_000).toISOString(), permissions: { contents: mode === 'write-token' ? 'write' : 'read', pull_requests: 'read', actions: 'read', metadata: 'read' } });
  }
  assert.equal(headers.get('authorization'), `Bearer ${token}`);
  if (path === '/installation/repositories') return Response.json({ total_count: mode === 'wrong-token-repos' ? 2 : 1, repositories: [{ id: Number(id), full_name: repo }] });
  reads++; assert.equal(options?.method, 'GET'); assert(path.startsWith(`/repos/${repo}/`));
  if (mode.startsWith('complete') && !path.endsWith('/zip')) {
    if (path.endsWith('/actions/workflows/390137975')) return Response.json({ id: 390137975, path: '.github/workflows/validate-content.yml', state: 'active' });
    if (path.includes('/compare/')) return Response.json({ status: 'identical' });
    if (path.includes('/contents/')) return Response.json({ type: 'file', encoding: 'base64', content: workflowBytes.toString('base64') });
    if (path.endsWith('/pulls/1')) return Response.json({ head: { sha: proposal.headSha, repo: { id: Number(id) } }, base: { sha: proposal.baseSha, repo: { id: Number(id) } } });
    if (path.endsWith('/workflows/390137975/runs')) return Response.json({ workflow_runs: [{ id: 39427688099 }] });
    if (path.endsWith('/runs/39427688099')) return Response.json({ id: 39427688099, workflow_id: 390137975, event: 'pull_request_target', head_sha: proposal.baseSha, repository: { id: Number(id) }, head_repository: { id: Number(id) }, path: '.github/workflows/validate-content.yml', status: 'completed', conclusion: 'success' });
    if (path.endsWith('/runs/39427688099/artifacts')) return Response.json({ artifacts: [{ id: 12265898868, name: 'content-validation-report', expired: false, size_in_bytes: reportZip.length, digest: `sha256:${mode === 'complete-wrong-digest' ? '0'.repeat(64) : reportDigest}` }] });
    throw new Error('Unexpected complete validation request');
  }
  if (path.endsWith('/zip')) {
    assert.equal(options?.redirect, 'manual');
    const target = mode === 'evil-host' ? 'https://evil.example/zip' : mode === 'credentials-host' ? 'https://user:pass@fixture.blob.core.windows.net/artifact' : mode === 'http-host' ? 'http://fixture.blob.core.windows.net/artifact' : 'https://fixture.blob.core.windows.net/artifact?signed=private';
    return new Response(null, { status: 302, headers: { location: target } });
  }
  assert.equal(options?.redirect, 'manual');
  if (mode === 'metadata-redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example' } });
  if (mode === 'oversize-json') return new Response(new Uint8Array(2_000_001));
  if (mode === 'invalid-length') return new Response('{}', { headers: { 'content-length': '-1' } });
  return Response.json(mode === 'token-echo' ? { authorization: token } : { id: 390137975, valid: true }, { headers: { authorization: token, 'set-cookie': token } });
};
const make = () => createPrivateGithubReader({ repositoryId: id, appId: '5391036', installationId: '456', appSlug: 'wandering-hand-community-merger', privateKeyPem: pem, fetch: transport, now: () => now });
const path = `/repos/${repo}/actions/workflows/390137975`;
const request = (suffix = path, method = 'GET') => new Request(`${PRIVATE_GITHUB_ORIGIN}${suffix}`, { method, headers: { authorization: 'Bearer caller-must-not-forward', cookie: 'caller-session' } });
const reader = make(); const before = mints;
const responses = await Promise.all([0, 1, 2].map(() => reader(request()))); assert(responses.every(response => response.status === 200)); assert.equal(mints, before + 1);
for (const response of responses) { assert.equal(response.headers.get('authorization'), null); assert.equal(response.headers.get('set-cookie'), null); assert(!(await response.text()).includes(token)); }
await reader(request()); assert.equal(mints, before + 1); now += 10 * 60_000 + 1; await reader(request()); assert.equal(mints, before + 2);
const successfulZip = await reader(request(`/repos/${repo}/actions/artifacts/12265898868/zip`)); assert.equal(successfulZip.status, 200); assert.deepEqual(new Uint8Array(await successfulZip.arrayBuffer()), zip); assert.equal(successfulZip.headers.get('location'), null);
const allowed = [
  `/repos/${repo}/actions/workflows/390137975/runs?event=pull_request_target&status=success&per_page=100`,
  `/repos/${repo}/actions/runs/39427688099`, `/repos/${repo}/actions/runs/39427688099/artifacts?per_page=100`,
  `/repos/${repo}/contents/.github/workflows/validate-content.yml?ref=${'a'.repeat(40)}`,
  `/repos/${repo}/compare/${'a'.repeat(40)}...${'b'.repeat(40)}`, `/repos/${repo}/pulls/1`,
];
for (const suffix of allowed) assert.equal((await reader(request(suffix))).status, 200);
const denied = ['/repos/other/repo/pulls/1', `/repos/${repo}/contents/src/engine/combat.ts?ref=${'a'.repeat(40)}`, `/repos/${repo}/pulls/1/merge`, `/repos/${repo}/actions/runs/1/logs`, `/repos/${repo}/actions/workflows/390137975?url=https://evil.example`, `/repos/${repo}/actions/runs/1/artifacts?per_page=100&per_page=100`, `/repos/${repo}/actions/workflows/390137975/runs?event=push&status=success&per_page=100`, `/repos/${repo}/pulls/0`, `/repos/${repo}/pulls/9007199254740992`];
const beforeDenied = reads; for (const suffix of denied) assert.equal((await reader(request(suffix))).status, 403);
assert.equal((await reader(request(path, 'POST'))).status, 405); assert.equal((await reader(new Request(`https://public.example${path}`))).status, 403); assert.equal(reads, beforeDenied);
for (const failure of ['wrong-repo', 'wrong-owner', 'wrong-installation', 'broad-installation', 'suspended', 'long-expiry', 'write-token', 'wrong-token-repos', 'token-echo', 'oversize-json', 'invalid-length', 'metadata-redirect']) { mode = failure; const response = await make()(request()); assert.equal(response.status, 503, failure); assert(!(await response.text()).includes(token)); }
for (const failure of ['evil-host', 'credentials-host', 'http-host', 'second-redirect', 'oversize-zip']) { mode = failure; assert.equal((await make()(request(`/repos/${repo}/actions/artifacts/12265898868/zip`))).status, 503, failure); }
mode = ''; const binding = { async fetch(incoming: Request) { boundCalls++; assert.equal(new URL(incoming.url).origin, PRIVATE_GITHUB_ORIGIN); assert.equal(incoming.headers.get('authorization'), null); assert.equal(incoming.headers.get('cookie'), null); return reader(incoming); } };
const pages = privateGithubTransport(binding);
assert.equal((await pages(`https://api.github.com${path}`, { headers: { authorization: 'Bearer local-read-token-must-not-forward', cookie: 'session' } })).status, 200); assert.equal(boundCalls, 1);
await assert.rejects(pages(`https://api.github.com${path}`, { method: 'POST' })); await assert.rejects(pages(`https://evil.example${path}`)); await assert.rejects(pages(`https://api.github.com/repos/fork/repo/pulls/1`)); assert.equal(boundCalls, 1);
mode = 'complete'; const privateReadiness = make();
const readReport = createTrustedValidationReader({ repositoryId: id, workflowId: 390137975, workflowPath: '.github/workflows/validate-content.yml', workflowSha256: createHash('sha256').update(workflowBytes).digest('hex'), approvedBaseSha: proposal.baseSha, gameRulesRevision: AUDIT_RULES, readerToken: 'caller-token-never-forward', fetch: privateGithubTransport({ fetch: privateReadiness }) });
const verified = await readReport(proposal); assert.equal(verified.artifactSha256, reportDigest); assert.equal(verified.report.headSha, proposal.headSha);
mode = 'complete-wrong-digest'; await assert.rejects(readReport(proposal), /artifact-digest-mismatch/);
for (const redirectAt of ['auth', 'api']) {
  const merger = createGitHubMerger({ appId:'5391036',installationId:'456',appSlug:'wandering-hand-community-merger',privateKeyPem:pem,repositoryId:id,enabled:true,validateCandidate:async()=>{},fetch:async(input,init)=>{
    assert.equal(init?.redirect,'manual'); new Request(input,init);
    if(redirectAt==='api' && String(input).endsWith('/access_tokens')) return Response.json({token:'isolated-merger-read-check',expires_at:new Date(Date.now()+600_000).toISOString()});
    return new Response(null,{status:302,headers:{location:'https://evil.example'}});
  } });
  await assert.rejects(merger.inspect({key:proposal.key,headSha:proposal.headSha} as RoundCandidate),redirectAt==='auth'?/merger-auth-unavailable/:/merger-github-unavailable/);
}
const config = JSON.parse(readFileSync('community-automation.config.example.json', 'utf8')) as AutomationConfig;
const worker = configuredWorker(config, '.') as any; assert.equal(worker.workers_dev, false); assert.equal(worker.preview_urls, false); assert.deepEqual(worker.routes, []);
const staticWorker = JSON.parse(readFileSync('wrangler.community-rounds.jsonc', 'utf8')); assert.equal(staticWorker.workers_dev, false); assert.equal(staticWorker.preview_urls, false); assert.deepEqual(staticWorker.routes, []); assert.equal(staticWorker.vars.COMMUNITY_MERGE_ENABLED, 'false');
assert.deepEqual(privateReaderBindingPatch(config), { deployment_configs: { production: { services: { COMMUNITY_GITHUB_READER: { service: 'wandering-hand-community-rounds', environment: 'production' } } } } });
if (process.argv.includes('--workerd')) {
  const { build } = await import('esbuild');
  const bundle = async (contents: string): Promise<string> => (await build({ stdin: { contents, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })).outputFiles[0]!.text;
  const readerScript = await bundle(`import { createPrivateGithubReader } from './src/service/community/privateGithubReader';
let handler;
export default { async fetch(request, env) {
  handler ??= createPrivateGithubReader({ repositoryId:'1426486653',appId:'5391036',installationId:'456',appSlug:'wandering-hand-community-merger',privateKeyPem:env.APP_KEY,
    fetch: async (input, options) => {
      const url = new URL(input), path = url.pathname, headers = new Headers(options.headers);
      if(url.hostname==='fixture.blob.core.windows.net') { if(headers.has('authorization') || options.redirect!=='manual') throw Error('signed auth/redirect'); return new Response(Uint8Array.from(atob(env.REPORT_ZIP),c=>c.charCodeAt(0)).buffer); }
      if(url.origin !== 'https://api.github.com') throw Error('unexpected upstream');
      if(path === '/repos/wwang109/wandering-hand-content') return Response.json({id:1426486653,full_name:'wwang109/wandering-hand-content',default_branch:'main'});
      if(path.endsWith('/installation') || path.endsWith('/access_tokens')) {
        const parts = headers.get('authorization').slice(7).split('.');
        const key = await crypto.subtle.importKey('jwk', JSON.parse(env.PUBLIC_JWK), {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
        const signature = Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
        if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,new TextEncoder().encode(parts[0]+'.'+parts[1]))) throw Error('bad RSA signature');
        if(path.endsWith('/installation')) return Response.json({id:456,app_id:5391036,app_slug:'wandering-hand-community-merger',account:{login:'wwang109'},repository_selection:'selected'});
        const body=JSON.parse(options.body); if(JSON.stringify(body)!==JSON.stringify({repository_ids:[1426486653],permissions:{contents:'read',pull_requests:'read',actions:'read'}})) throw Error('wrong scope');
        return Response.json({token:'local_workerd_read_only_token',expires_at:new Date(Date.now()+3600000).toISOString(),permissions:{contents:'read',pull_requests:'read',actions:'read',metadata:'read'}});
      }
      if(headers.get('authorization')!=='Bearer local_workerd_read_only_token') throw Error('wrong credential');
      if(path==='/installation/repositories') return Response.json({total_count:1,repositories:[{id:1426486653,full_name:'wwang109/wandering-hand-content'}]});
      const proposal=JSON.parse(env.PROPOSAL);
      if(path.endsWith('/actions/workflows/390137975')) return Response.json({id:390137975,path:'.github/workflows/validate-content.yml',state:'active',actualServiceBinding:true});
      if(path.includes('/compare/')) return Response.json({status:'identical'});
      if(path.includes('/contents/')) return Response.json({type:'file',encoding:'base64',content:env.WORKFLOW_BYTES});
      if(path.endsWith('/pulls/1')) return Response.json({head:{sha:proposal.headSha,repo:{id:1426486653}},base:{sha:proposal.baseSha,repo:{id:1426486653}}});
      if(path.endsWith('/workflows/390137975/runs')) return Response.json({workflow_runs:[{id:39427688099}]});
      if(path.endsWith('/runs/39427688099')) return Response.json({id:39427688099,workflow_id:390137975,event:'pull_request_target',head_sha:proposal.baseSha,repository:{id:1426486653},head_repository:{id:1426486653},path:'.github/workflows/validate-content.yml',status:'completed',conclusion:'success'});
      if(path.endsWith('/runs/39427688099/artifacts')) return Response.json({artifacts:[{id:12265898868,name:'content-validation-report',expired:false,size_in_bytes:Number(env.REPORT_SIZE),digest:'sha256:'+env.REPORT_DIGEST}]});
      if(path.endsWith('/artifacts/12265898868/zip')) return new Response(null,{status:302,headers:{location:'https://fixture.blob.core.windows.net/artifact?signed=local'}});
      throw Error('unlisted upstream');
    }
  }); return handler(request);
}};`);
  const callerScript = await bundle(`import { privateGithubTransport,PRIVATE_GITHUB_ORIGIN } from './src/service/community/privateGithubReader'; import { createTrustedValidationReader,decodeValidationArtifact } from './src/service/community/trustedValidation'; import { createGitHubReadPort } from './src/service/community/github';
export default { async fetch(request,env) { const route=new URL(request.url).pathname;
  if(route==='/validation' || route==='/validation-defaults') {
    const proposal=JSON.parse(env.PROPOSAL);
    const transport=route==='/validation'?privateGithubTransport(env.READER):async(input,init)=>{const url=new URL(input);return env.READER.fetch(new Request(PRIVATE_GITHUB_ORIGIN+url.pathname+url.search,init));};
    const verified=await createTrustedValidationReader({repositoryId:'1426486653',workflowId:390137975,workflowPath:'.github/workflows/validate-content.yml',workflowSha256:env.WORKFLOW_DIGEST,approvedBaseSha:proposal.baseSha,gameRulesRevision:env.RULES,fetch:transport})(proposal);
    const source=await createGitHubReadPort({repositoryId:'1426486653',fetch:async(input,init)=>{const native=new Request(input,init);if(native.redirect!=='manual')throw Error('source redirect');return Response.json([]);}}).listChangedPrs(null);
    return Response.json({nativeDeflate:verified.artifactSha256===env.REPORT_DIGEST,sourceDefaults:source.keys.length===0});
  }
  if(route==='/provider-zip'){const bytes=Uint8Array.from(atob(env.PROVIDER_ZIP),c=>c.charCodeAt(0));return Response.json({version:(await decodeValidationArtifact(bytes)).version});}
  const path=route==='/denied'?'/repos/fork/other/pulls/1':'/repos/wwang109/wandering-hand-content/actions/workflows/390137975'; try {return await privateGithubTransport(env.READER)('https://api.github.com'+path,{headers:{authorization:'Bearer must-not-forward'}});}catch(error){return new Response(String(error.message),{status:403});}
} };`);
  const { Miniflare, convertV4MiniflareOptions } = await import(process.env.COMMUNITY_MINIFLARE_MODULE ?? 'miniflare');
  const shared = { PROPOSAL: JSON.stringify(proposal), WORKFLOW_BYTES: workflowBytes.toString('base64'), WORKFLOW_DIGEST: createHash('sha256').update(workflowBytes).digest('hex'), RULES: AUDIT_RULES, REPORT_ZIP: Buffer.from(reportZip).toString('base64'), REPORT_DIGEST: reportDigest, REPORT_SIZE: String(reportZip.length) };
  const providerPath = process.env.COMMUNITY_PROVIDER_ZIP; const provider = providerPath ? readFileSync(providerPath) : null;
  if(provider) assert.equal(createHash('sha256').update(provider).digest('hex'), process.env.COMMUNITY_PROVIDER_ZIP_SHA256);
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'private-reader-caller', modules: true, script: callerScript, compatibilityDate: '2026-10-19', serviceBindings: { READER: 'private-reader' }, bindings:{...shared,PROVIDER_ZIP:provider?.toString('base64')??''} }, { name: 'private-reader', modules: true, script: readerScript, compatibilityDate: '2026-10-19', bindings: { ...shared, APP_KEY: pem, PUBLIC_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey)) } }] }));
  try { const response = await runtime.dispatchFetch('https://caller.invalid/'); const responseText = await response.text(); assert.equal(response.status, 200, responseText); assert.equal(JSON.parse(responseText).actualServiceBinding, true); assert.equal((await runtime.dispatchFetch('https://caller.invalid/denied')).status, 403);
    for(const route of ['/validation','/validation-defaults']) {const validated=await runtime.dispatchFetch('https://caller.invalid'+route);assert.equal(validated.status,200,await validated.clone().text());assert.deepEqual(await validated.json(),{nativeDeflate:true,sourceDefaults:true});}
    if(provider){const decoded=await runtime.dispatchFetch('https://caller.invalid/provider-zip');assert.equal(decoded.status,200);assert.equal((await decoded.json() as any).version,1);console.log('community provider ZIP workerd OK: locally retained real GitHub artifact digest verified; native method8 decode; provider-format compatibility only, not proposal readiness');}
  }
  finally { await runtime.dispose(); }
  console.log('community private reader workerd OK: two actual local Workers; real service binding; native RSA sign/verify; exact read-token scope; full method8 ZIP artifact/provenance verification; default source/validation native manual redirect options; denied fork path; isolated GitHub transport, no external writes');
}
console.log('community private reader OK: ephemeral RSA/JWT verification; selected exact-repo READ-only token and bounded cache/single-flight; fixed GET allowlist; signed artifact download without auth forwarding; bad host/method/path/redirect/scope/expiry/oversize/token-leak denied; full trusted ZIP report verification through Pages binding and wrong-digest rejection; service-only generated config; no external writes');
