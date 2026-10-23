import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, toNamespacedPath } from 'node:path';
import { link } from 'node:fs/promises';
import ts from 'typescript';
import { parseCommunityJson } from '../src/community/validate';
import type { ExecutorArchive } from '../src/service/runs/executorArchive';
import type { RevisionKey } from '../src/run/online/types';

export interface ApprovedExecutor { key: RevisionKey; sourceDigest: string; approved: 1 }
export interface ArchiveEnvelope { schemaVersion: 1; archive: ExecutorArchive; byteLengths: Record<string, number>; totalBytes: number }
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const maximumFile = 25 * 1024 * 1024, maximumTotal = 256 * 1024 * 1024;
const requireArchive = (condition: unknown, message: string): void => { if (!condition) throw new Error(`Executor archive: ${message}`); };
export const executorArchiveId = (key: RevisionKey): string => digest(JSON.stringify({ contentSha: key.contentSha, rulesRevision: key.rulesRevision }));
export const linkExecutorFile = (source: string, target: string): Promise<void> => link(toNamespacedPath(source), toNamespacedPath(target));
function safePath(path: string, art: boolean): boolean {
  return path.length <= 240 && path.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) && part !== '.' && part !== '..')
    && (art ? /^public\/game-art\/.+\.(png|webp)$/.test(path) : /^(src\/(engine|data|run)\/.+\.(ts|json)|art-manifest\.v1\.json)$/.test(path));
}
export function validateArchiveManifest(archive: ExecutorArchive, approval?: ApprovedExecutor): void {
  requireArchive(archive && typeof archive === 'object' && archive.key && typeof archive.key === 'object', 'manifest missing');
  requireArchive(Object.keys(archive).every(name => ['key', 'sourceDigest', 'files', 'artFiles', 'sourceCommit', 'archiveId'].includes(name)) && Object.keys(archive.key).every(name => ['contentSha', 'rulesRevision'].includes(name)), 'unknown manifest fields');
  requireArchive(/^[a-f0-9]{64}$/.test(archive.sourceDigest) && archive.key.rulesRevision === `${archive.sourceCommit}.${archive.sourceDigest}` && executorArchiveId(archive.key) === archive.archiveId, 'key/digest mismatch');
  if (approval) requireArchive(approval.approved === 1 && /^[a-f0-9]{40}$/.test(archive.sourceCommit) && /^[a-f0-9]{40}$/.test(archive.key.contentSha) && approval.key.rulesRevision === archive.key.rulesRevision && approval.key.contentSha === archive.key.contentSha && approval.sourceDigest === archive.sourceDigest, 'not the D1 approved production revision');
  const seen = new Set<string>();
  for (const [map, art] of [[archive.files, false], [archive.artFiles, true]] as const) {
    requireArchive(map && typeof map === 'object' && !Array.isArray(map), 'file map missing');
    for (const [path, hash] of Object.entries(map)) { requireArchive(safePath(path, art) && /^[a-f0-9]{64}$/.test(hash) && !seen.has(path.toLowerCase()), 'invalid/colliding file path or digest'); seen.add(path.toLowerCase()); }
  }
  requireArchive(seen.size > 0 && seen.size <= 2048 && archive.files['src/run/online/executor.ts'] && archive.files['src/run/ghostValidate.ts'], 'source closure missing or excessive');
  requireArchive(digest(JSON.stringify({ files: archive.files, artFiles: archive.artFiles })) === archive.sourceDigest, 'source digest mismatch');
}
function safeLocalFile(root: string, path: string): string {
  let location = root; requireArchive(!lstatSync(location).isSymbolicLink(), 'symlink archive root');
  for (const part of path.split('/')) { location = join(location, part); requireArchive(!lstatSync(location).isSymbolicLink(), 'symlink archive member'); }
  requireArchive(lstatSync(location).isFile(), 'non-file archive member'); return location;
}
export function validateArchiveBytes(archive: ExecutorArchive, read: (path: string) => Uint8Array): ArchiveEnvelope {
  validateArchiveManifest(archive); const byteLengths: Record<string, number> = {}; let totalBytes = 0;
  for (const [path, hash] of Object.entries({ ...archive.files, ...archive.artFiles })) {
    const bytes = read(path); const limit = path.startsWith('public/') ? maximumFile : 8 * 1024 * 1024;
    requireArchive(bytes.byteLength > 0 && bytes.byteLength <= limit && digest(bytes) === hash, `integrity failure (size/hash): ${path}`);
    byteLengths[path] = bytes.byteLength; totalBytes += bytes.byteLength; requireArchive(totalBytes <= maximumTotal, 'aggregate size exceeded');
    if (!path.endsWith('.ts')) continue;
    const imports = ts.preProcessFile(new TextDecoder('utf-8', { fatal: true }).decode(bytes), true, true);
    for (const imported of imports.importedFiles) {
      requireArchive(imported.fileName.startsWith('.'), 'external source import');
      const base = posix.normalize(posix.join(posix.dirname(path), imported.fileName));
      requireArchive([base, `${base}.ts`, `${base}.json`, `${base}/index.ts`].some(name => Object.hasOwn(archive.files, name)), 'source import outside verified closure');
    }
  }
  return { schemaVersion: 1, archive, byteLengths, totalBytes };
}
export function inspectLocalArchive(directory: string, approval?: ApprovedExecutor): ArchiveEnvelope {
  const manifest = parseCommunityJson(readFileSync(safeLocalFile(directory, 'manifest.json'), 'utf8')) as ExecutorArchive;
  validateArchiveManifest(manifest, approval); return validateArchiveBytes(manifest, path => readFileSync(safeLocalFile(directory, path)));
}
export function exportExecutorArchive(directory: string, destination: string, approval: ApprovedExecutor): ArchiveEnvelope {
  const envelope = inspectLocalArchive(directory, approval); requireArchive(!existsSync(destination), 'publish directory already exists');
  mkdirSync(destination, { recursive: true });
  for (const path of Object.keys(envelope.byteLengths)) { const output = join(destination, 'files', path); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, readFileSync(safeLocalFile(directory, path))); }
  writeFileSync(join(destination, 'archive.json'), JSON.stringify(envelope)); return envelope;
}
export const EXECUTOR_PAGES_ORIGIN = 'https://proof-of-concept-ab-deckbuilder.pages.dev';
export const EXECUTOR_PAGES_REGISTRY = `${EXECUTOR_PAGES_ORIGIN}/executor-archives/`;
export function publishExecutorArchives(root: string, archives: readonly ExecutorArchive[]): void {
  const destination = join(resolve(root), 'public/executor-archives');
  if (existsSync(destination)) requireArchive(!lstatSync(destination).isSymbolicLink() && lstatSync(destination).isDirectory(), 'unsafe static archive directory');
  mkdirSync(destination, { recursive: true });
  const selected = new Set(archives.map(archive => archive.archiveId));
  for (const name of readdirSync(destination)) {
    requireArchive(/^[a-f0-9]{64}$/.test(name) && !lstatSync(join(destination, name)).isSymbolicLink(), 'unknown static archive member');
    if (!selected.has(name)) rmSync(join(destination, name), { recursive: true });
  }
  for (const archive of archives) {
    const approval: ApprovedExecutor = { key: archive.key, sourceDigest: archive.sourceDigest, approved: 1 };
    const directory = join(destination, archive.archiveId);
    const source = join(resolve(root), '.run-executor-archive', archive.archiveId);
    if (!existsSync(directory)) { exportExecutorArchive(source, directory, approval); continue; }
    const envelope = parseCommunityJson(readFileSync(safeLocalFile(directory, 'archive.json'), 'utf8')) as ArchiveEnvelope;
    requireArchive(envelope.schemaVersion === 1 && JSON.stringify(envelope.archive) === JSON.stringify(archive), 'static immutable manifest conflict');
    const actual = validateArchiveBytes(archive, path => readFileSync(safeLocalFile(directory, `files/${path}`)));
    requireArchive(JSON.stringify(actual) === JSON.stringify(envelope), 'static immutable byte inventory conflict');
    const allowed = new Set(['archive.json', ...Object.keys(actual.byteLengths).map(path => `files/${path}`)]);
    const inspect = (path = ''): void => { for (const name of readdirSync(join(directory, path))) { const member = path ? `${path}/${name}` : name; const stat = lstatSync(join(directory, member)); requireArchive(!stat.isSymbolicLink(), 'static symlink member'); if (stat.isDirectory()) inspect(member); else requireArchive(stat.isFile() && allowed.has(member), 'unexpected static member'); } };
    inspect();
  }
}
async function bounded(response: Response, maximum: number): Promise<Uint8Array> {
  requireArchive(response.ok && response.body && response.headers.get('content-encoding') !== 'gzip', `HTTP ${response.status}`);
  const length = response.headers.get('content-length'); if (length) requireArchive(/^\d+$/.test(length) && Number(length) <= maximum, 'response size exceeded');
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; requireArchive(size <= maximum, 'stream size exceeded'); chunks.push(item.value); } } finally { await reader.cancel(); }
  const result = new Uint8Array(size); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; } return result;
}
export async function hydrateExecutorArchives(options: { root?: string; approvals: ApprovedExecutor[]; registryUrl?: string; fetch?: typeof fetch; install?: { link?: (source: string, target: string) => void | Promise<void>; wait?: () => Promise<void> } }): Promise<number> {
  requireArchive(options.approvals.length <= 32, 'too many retained contexts');
  const root = resolve(options.root ?? '.'), cache = join(root, '.run-executor-archive'); let fetched = 0, aggregate = 0;
  if (existsSync(cache)) requireArchive(!lstatSync(cache).isSymbolicLink() && lstatSync(cache).isDirectory(), 'unsafe cache directory');
  for (const approval of options.approvals) {
    const id = executorArchiveId(approval.key), target = join(cache, id);
    if (existsSync(target)) requireArchive(!lstatSync(target).isSymbolicLink() && lstatSync(target).isDirectory(), 'unsafe partial target');
    if (existsSync(join(target, 'manifest.json'))) { inspectLocalArchive(target, approval); continue; }
    requireArchive(options.registryUrl, `missing approved archive ${id}; configure RUN_EXECUTOR_ARCHIVE_REGISTRY_URL`);
    const base = new URL(options.registryUrl!); requireArchive(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && !/%|\.{2}/.test(base.pathname), 'registry must be an explicit HTTPS directory');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const get = (path: string) => (options.fetch ?? fetch)(new URL(`${id}/${path}`, base), { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' } });
    const envelope = parseCommunityJson(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(await get('archive.json'), 1024 * 1024))) as ArchiveEnvelope;
    requireArchive(envelope.schemaVersion === 1, 'unsupported envelope'); validateArchiveManifest(envelope.archive, approval);
    const paths = Object.keys({ ...envelope.archive.files, ...envelope.archive.artFiles });
    requireArchive(envelope.byteLengths && Object.keys(envelope.byteLengths).length === paths.length && paths.every(path => Number.isSafeInteger(envelope.byteLengths[path]) && envelope.byteLengths[path]! > 0 && envelope.byteLengths[path]! <= (path.startsWith('public/') ? maximumFile : 8 * 1024 * 1024)), 'invalid byte inventory');
    const total = paths.reduce((sum, path) => sum + envelope.byteLengths[path]!, 0); aggregate += total;
    requireArchive(total === envelope.totalBytes && total <= maximumTotal && aggregate <= 512 * 1024 * 1024, 'aggregate download exceeded');
    mkdirSync(cache, { recursive: true });
    const stage = join(cache, `.stage-${randomUUID()}`); mkdirSync(stage, { recursive: true });
    try {
      for (const path of paths) { const bytes = await bounded(await get(`files/${path}`), envelope.byteLengths[path]!); requireArchive(bytes.length === envelope.byteLengths[path] && digest(bytes) === ({ ...envelope.archive.files, ...envelope.archive.artFiles })[path], `download digest mismatch: ${path}`); const output = join(stage, path); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, bytes); }
      writeFileSync(join(stage, 'manifest.json'), JSON.stringify(envelope.archive)); inspectLocalArchive(stage, approval);
      mkdirSync(target, { recursive: true });
      const hashes: Record<string, string> = { ...envelope.archive.files, ...envelope.archive.artFiles, 'manifest.json': digest(readFileSync(join(stage, 'manifest.json'))) };
      const pause = options.install?.wait ?? (() => new Promise<void>(done => setTimeout(done, 100)));
      for (const path of [...paths, 'manifest.json']) {
        let parent = target;
        for (const part of path.split('/').slice(0, -1)) { parent = join(parent, part); mkdirSync(parent, { recursive: true }); requireArchive(!lstatSync(parent).isSymbolicLink() && lstatSync(parent).isDirectory(), 'unsafe target parent'); }
        for (let attempt = 0; ; attempt++) {
          try { await (options.install?.link ?? linkExecutorFile)(join(stage, path), join(target, path)); break; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') {
              const existing = readFileSync(safeLocalFile(target, path));
              if (digest(existing) === hashes[path]) break;
              if (attempt >= 50) throw new Error(`Executor archive: immutable member conflict: ${path}`);
            } else if (attempt >= 50 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
            await pause();
          }
        }
      }
      inspectLocalArchive(target, approval);
      fetched++;
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  return fetched;
}
