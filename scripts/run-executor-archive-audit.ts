import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildRunExecutors } from './build-run-executors';
import { executorArchiveId, exportExecutorArchive, hydrateExecutorArchives, inspectLocalArchive, linkExecutorFile, type ApprovedExecutor } from './run-executor-archive';

const root = resolve('tmp/executor-archive', randomUUID().slice(0, 8));
const longDirectory = 'long-child-'.repeat(8);
function put(directory: string, name: string, bytes: string | Uint8Array): void { const path = join(directory, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
function current(directory: string, contentSha: string, value: string): void {
  put(directory, 'src/run/online/executor.ts', `import { value } from '../ghostValidate'; import '../../engine/${longDirectory}/archiveProbe'; export const createRunExecutor = () => ({ value });`);
  put(directory, `src/engine/${longDirectory}/archiveProbe.ts`, 'export const archiveProbe = true;');
  put(directory, 'src/run/ghostValidate.ts', `export const value = ${JSON.stringify(value)}; export const validateGhostSubmission = () => value;`);
  put(directory, 'src/data/content-build.v1.json', JSON.stringify({ contentSha, rulesRevision: 'a'.repeat(40) }));
  put(directory, 'art-manifest.v1.json', JSON.stringify({ assets: [{ path: 'public/game-art/a.png' }] }));
  put(directory, 'public/game-art/a.png', Uint8Array.of(137, 80, 78, 71));
}
const sourceRoot = join(root, 'source'); current(sourceRoot, '1'.repeat(40), 'approved-old');
const first = buildRunExecutors({ root: sourceRoot }); const archive = first.archives[0]!;
const approval: ApprovedExecutor = { key: archive.key, sourceDigest: archive.sourceDigest, approved: 1 };
const published = join(root, 'registry', archive.archiveId); const envelope = exportExecutorArchive(join(sourceRoot, '.run-executor-archive', archive.archiveId), published, approval);
assert.equal(executorArchiveId({ rulesRevision: archive.key.rulesRevision, contentSha: archive.key.contentSha }), archive.archiveId);
let requests = 0;
const transport: typeof fetch = async (input, options) => {
  const url = new URL(String(input)); requests++; assert.equal(options?.redirect, 'error'); assert.equal(url.origin, 'https://archives.example');
  const path = url.pathname.replace('/immutable/', ''); const file = join(root, 'registry', path);
  return existsSync(file) ? new Response(readFileSync(file)) : new Response('missing', { status: 404 });
};
const clean = join(root, 'clean'); current(clean, '2'.repeat(40), 'current-new');
assert.equal(await hydrateExecutorArchives({ root: clean, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport }), 1);
const longChild = join(clean, '.run-executor-archive', archive.archiveId, `src/engine/${longDirectory}/archiveProbe.ts`);
assert(longChild.length > 260); assert.equal(readFileSync(longChild, 'utf8'), 'export const archiveProbe = true;');
const count = requests; assert.equal(await hydrateExecutorArchives({ root: clean, approvals: [approval], fetch: transport }), 0); assert.equal(requests, count);
const concurrent = join(root, 'concurrent');
await Promise.all([0, 1].map(() => hydrateExecutorArchives({ root: concurrent, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport })));
assert.equal(inspectLocalArchive(join(concurrent, '.run-executor-archive', archive.archiveId), approval).archive.sourceDigest, archive.sourceDigest);
assert.deepEqual(readdirSync(join(concurrent, '.run-executor-archive')), [archive.archiveId]);
let linkAttempts = 0, retryWaits = 0;
const sharingFailure = (code: string): NodeJS.ErrnoException => Object.assign(new Error('isolated Windows sharing failure'), { code });
const transient = join(root, 'transient-sharing');
await hydrateExecutorArchives({ root: transient, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport, install: {
  link(source, target) { assert.equal(existsSync(target), false); linkAttempts++; if (linkAttempts < 3) throw sharingFailure(linkAttempts === 1 ? 'EPERM' : 'EBUSY'); return linkExecutorFile(source, target); },
  async wait() { retryWaits++; assert.equal(existsSync(join(transient, '.run-executor-archive', archive.archiveId, 'manifest.json')), false); await new Promise<void>(done => setTimeout(done, 100)); },
} });
assert(retryWaits >= 2); assert.equal(linkAttempts, Object.keys(envelope.byteLengths).length + 1 + retryWaits);
inspectLocalArchive(join(transient, '.run-executor-archive', archive.archiveId), approval);
const interrupted = join(root, 'interrupted'); let publishedMembers = 0;
await assert.rejects(hydrateExecutorArchives({ root: interrupted, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport, install: { async link(source, target) { if (publishedMembers++ === 2) throw sharingFailure('EIO'); await linkExecutorFile(source, target); } } }));
assert.equal(existsSync(join(interrupted, '.run-executor-archive', archive.archiveId, 'manifest.json')), false);
assert.equal(await hydrateExecutorArchives({ root: interrupted, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport }), 1);
inspectLocalArchive(join(interrupted, '.run-executor-archive', archive.archiveId), approval);
const conflicting = join(root, 'conflicting'); const conflictingPath = Object.keys(archive.files)[0]!;
put(conflicting, `.run-executor-archive/${archive.archiveId}/${conflictingPath}`, 'conflicting immutable bytes'); let conflictWaits = 0;
await assert.rejects(hydrateExecutorArchives({ root: conflicting, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport, install: { async wait() { conflictWaits++; } } }), /immutable member conflict/);
assert.equal(conflictWaits, 50); assert.equal(existsSync(join(conflicting, '.run-executor-archive', archive.archiveId, 'manifest.json')), false);
assert.equal(readFileSync(join(conflicting, '.run-executor-archive', archive.archiveId, conflictingPath), 'utf8'), 'conflicting immutable bytes');
const rebuilt = buildRunExecutors({ root: clean, required: { databaseId: 'fixture-D1', exportedAt: Date.now(), keys: [archive.key], approvals: [approval] } });
assert.equal(rebuilt.archives.length, 2); assert.equal(inspectLocalArchive(join(clean, '.run-executor-archive', archive.archiveId), approval).archive.sourceDigest, archive.sourceDigest);
assert.equal(readFileSync(join(clean, 'src/service/runs/generated', archive.archiveId, 'src/run/ghostValidate.ts'), 'utf8').includes('approved-old'), true);
assert.equal(readFileSync(join(clean, 'src/service/runs/generated', rebuilt.archives[0]!.archiveId, 'src/run/ghostValidate.ts'), 'utf8').includes('current-new'), true);
assert.throws(() => buildRunExecutors({ root: clean, production: true }), /fresh active-executor/);
let rejected = 0;
async function negative(name: string, changes: Partial<Parameters<typeof hydrateExecutorArchives>[0]>): Promise<void> {
  const directory = join(root, name); await assert.rejects(hydrateExecutorArchives({ root: directory, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport, ...changes }));
  assert.equal(existsSync(join(directory, '.run-executor-archive', archive.archiveId, 'manifest.json')), false);
  const cache = join(directory, '.run-executor-archive'); if (existsSync(cache)) assert(readdirSync(cache).every(name => !name.startsWith('.stage-'))); rejected++;
}
await negative('unapproved', { approvals: [{ ...approval, approved: 0 as 1 }] });
await negative('wrong-digest', { approvals: [{ ...approval, sourceDigest: '0'.repeat(64) }] });
await negative('wrong-key', { approvals: [{ ...approval, key: { ...approval.key, contentSha: '3'.repeat(40) } }] });
await negative('http', { registryUrl: 'http://archives.example/immutable/' });
await negative('credentials', { registryUrl: 'https://user:password@archives.example/immutable/' });
const alter = (change: (value: typeof envelope) => void): typeof fetch => async (input, options) => {
  if (String(input).endsWith('/archive.json')) { const value = structuredClone(envelope); change(value); return new Response(JSON.stringify(value)); } return transport(input, options);
};
await negative('traversal', { fetch: alter(value => { value.archive.files = { ...value.archive.files, '../escape.ts': 'a'.repeat(64) }; }) });
await negative('development-source', { fetch: alter(value => { value.archive.sourceCommit = `development-${'a'.repeat(40)}`; }) });
await negative('oversize', { fetch: alter(value => { value.byteLengths['src/run/online/executor.ts'] = 8 * 1024 * 1024 + 1; }) });
await negative('tampered-member', { fetch: async (input, options) => String(input).endsWith('/src/run/ghostValidate.ts') ? new Response('tampered') : transport(input, options) });
await negative('lost-mid-download', { fetch: async (input, options) => { if (String(input).endsWith('/src/run/ghostValidate.ts')) throw new Error('connection lost'); return transport(input, options); } });
await negative('oversize-stream', { fetch: async () => new Response(new Uint8Array(1024 * 1024 + 1)) });
await negative('redirect', { fetch: async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/code' } }) });
let permanentAttempts = 0, permanentWaits = 0;
await negative('permanent-sharing', { install: { link() { permanentAttempts++; throw sharingFailure('EPERM'); }, async wait() { permanentWaits++; } } });
assert.equal(permanentAttempts, 51); assert.equal(permanentWaits, 50);
let nonSharingAttempts = 0;
await negative('non-sharing-install-failure', { install: { link() { nonSharingAttempts++; throw sharingFailure('EIO'); }, async wait() { throw new Error('must not retry unrelated filesystem failure'); } } });
assert.equal(nonSharingAttempts, 1);
put(clean, `.run-executor-archive/${archive.archiveId}/src/run/ghostValidate.ts`, 'local corruption');
const beforeCorruption = requests;
await assert.rejects(hydrateExecutorArchives({ root: clean, approvals: [approval], registryUrl: 'https://archives.example/immutable/', fetch: transport }), /integrity/);
assert.equal(requests, beforeCorruption);
console.log(`executor archive recovery OK: approved immutable export; real Windows >260-character child paths; concurrent exclusive hardlinks and atomic final manifest; interrupted publication resumes; conflicting members refused unchanged; transient sharing retry and bounded failure cleanup; two isolated old/current closures; cached reuse; ${rejected} rejected transport/approval/path/size/partial-download/install cases; local corruption and unverified production refused; no remote code executed during download`);
