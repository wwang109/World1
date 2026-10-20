import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import type { ExecutorArchive } from '../src/service/runs/executorArchive';
import type { RevisionKey } from '../src/run/online/types';
import { currentRulesRevision } from './sync-community-content';
import { executorArchiveId, inspectLocalArchive, publishExecutorArchives, type ApprovedExecutor } from './run-executor-archive';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const slash = (path: string) => path.split(sep).join('/');
export interface RequiredExecutors { exportedAt: number; databaseId: string; keys: RevisionKey[]; approvals?: ApprovedExecutor[] }
export function buildRunExecutors(options: { root?: string; production?: boolean; required?: RequiredExecutors } = {}): { current: RevisionKey; archives: ExecutorArchive[]; bytes: number } {
  const root = resolve(options.root ?? '.'), archiveRoot = join(root, '.run-executor-archive');
  const generated = join(root, 'src/service/runs/generated');
  const closure = new Map<string, Uint8Array>();
  function visit(path: string): void {
    const absolute = resolve(path), name = slash(relative(root, absolute));
    if (name.startsWith('../') || !/^(src\/(engine|data|run)\/|art-manifest\.v1\.json$)/.test(name)) throw new Error(`Executor import escapes trusted pure closure: ${name}`);
    if (closure.has(name)) return;
    const bytes = readFileSync(absolute); closure.set(name, bytes);
    if (!absolute.endsWith('.ts')) return;
    const info = ts.preProcessFile(bytes.toString('utf8'), true, true);
    for (const imported of info.importedFiles) {
      const specifier = imported.fileName;
      if (!specifier.startsWith('.')) throw new Error(`Executor external import forbidden: ${name} -> ${specifier}`);
      const base = resolve(dirname(absolute), specifier);
      const dependency = [base, `${base}.ts`, `${base}.json`, join(base, 'index.ts')].find(candidate => existsSync(candidate) && /\.(ts|json)$/.test(candidate));
      if (!dependency) throw new Error(`Missing executor dependency ${name} -> ${specifier}`);
      visit(dependency);
    }
  }
  visit(join(root, 'src/run/online/executor.ts'));
  const files = Object.fromEntries([...closure].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)]));
  const artManifest = JSON.parse(readFileSync(join(root, 'art-manifest.v1.json'), 'utf8')) as { assets: { path: string }[] };
  const artFiles = Object.fromEntries(artManifest.assets.map(asset => {
    if (!asset.path.startsWith('public/game-art/') || asset.path.includes('..')) throw new Error('Invalid immutable art path');
    return [asset.path, hash(readFileSync(join(root, asset.path)))];
  }));
  const sourceDigest = hash(JSON.stringify({ files, artFiles }));
  const metadata = JSON.parse(readFileSync(join(root, 'src/data/content-build.v1.json'), 'utf8')) as { contentSha: string; rulesRevision: string };
  const current: RevisionKey = { contentSha: metadata.contentSha, rulesRevision: `${metadata.rulesRevision}.${sourceDigest}` };
  if (options.production && (!/^[a-f0-9]{40}$/.test(current.contentSha) || !options.required || Date.now() - options.required.exportedAt > 300000 || options.required.exportedAt > Date.now() + 1000 || !options.required.databaseId)) throw new Error('Deployment requires a real immutable content SHA and a fresh active-executor database export');
  if (options.production && (!/^[a-f0-9]{40}$/.test(metadata.rulesRevision) || currentRulesRevision(root) !== metadata.rulesRevision)) throw new Error('Deployment requires metadata for the current clean committed game rules; dirty or stale rules remain development-only');
  if (options.production && (!options.required?.approvals || options.required.keys.some(key => !options.required!.approvals!.some(entry => entry.approved === 1 && entry.key.contentSha === key.contentSha && entry.key.rulesRevision === key.rulesRevision && key.rulesRevision.endsWith(`.${entry.sourceDigest}`))))) throw new Error('Deployment requires explicit D1-approved source digests for every retained executor');
  const archiveId = executorArchiveId(current);
  const manifest: ExecutorArchive = { key: current, sourceDigest, files, artFiles, sourceCommit: metadata.rulesRevision, archiveId };
  const target = join(archiveRoot, archiveId);
  mkdirSync(target, { recursive: true });
  const existing = join(target, 'manifest.json');
  if (existsSync(existing) && readFileSync(existing, 'utf8') !== JSON.stringify(manifest)) throw new Error('Immutable archive key collision');
  for (const [name, bytes] of closure) { const destination = join(target, name); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); }
  for (const name of Object.keys(artFiles)) { const destination = join(target, name); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(join(root, name), destination); }
  writeFileSync(existing, JSON.stringify(manifest));
  const previousRegistry = join(generated, 'manifest.json');
  const retained = existsSync(previousRegistry) ? (JSON.parse(readFileSync(previousRegistry, 'utf8')) as { archives: ExecutorArchive[] }).archives.map(archive => archive.key) : [];
  const required = options.required?.keys ?? retained;
  const all = readdirSync(archiveRoot).flatMap(name => {
    if (!/^[a-f0-9]{64}$/.test(name)) return [];
    const path = join(archiveRoot, name, 'manifest.json');
    return existsSync(path) ? [JSON.parse(readFileSync(path, 'utf8')) as ExecutorArchive] : [];
  });
  const archives: ExecutorArchive[] = [manifest];
  for (const key of required) {
    if (archives.some(item => item.key.contentSha === key.contentSha && item.key.rulesRevision === key.rulesRevision)) continue;
    const archive = all.find(item => item.key.contentSha === key.contentSha && item.key.rulesRevision === key.rulesRevision);
    if (!archive) throw new Error(`Missing retained executor archive: ${key.rulesRevision}/${key.contentSha}`);
    archives.push(archive);
  }
  let bytes = 0;
  for (const archive of archives) {
    const approval = options.required?.approvals?.find(entry => entry.key.contentSha === archive.key.contentSha && entry.key.rulesRevision === archive.key.rulesRevision);
    inspectLocalArchive(join(archiveRoot, archive.archiveId), approval);
    if (hash(JSON.stringify({ files: archive.files, artFiles: archive.artFiles })) !== archive.sourceDigest
      || archive.key.rulesRevision !== `${archive.sourceCommit}.${archive.sourceDigest}` || executorArchiveId(archive.key) !== archive.archiveId) throw new Error('Retained executor manifest integrity failure');
    for (const [name, expected] of Object.entries(archive.files)) {
      if (name.includes('..') || !/^(src\/(engine|data|run)\/|art-manifest\.v1\.json$)/.test(name)) throw new Error('Invalid archive source path');
      const source = join(archiveRoot, archive.archiveId, name), data = readFileSync(source);
      if (hash(data) !== expected) throw new Error(`Retained executor integrity failure: ${name}`);
      bytes += data.byteLength;
      const destination = join(generated, archive.archiveId, name); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
    }
    if (!archive.artFiles) throw new Error('Retained executor is missing immutable art');
    for (const [name, expected] of Object.entries(archive.artFiles)) {
      if (!name.startsWith('public/game-art/') || name.includes('..')) throw new Error('Invalid retained art path');
      const source = join(archiveRoot, archive.archiveId, name);
      if (hash(readFileSync(source)) !== expected) throw new Error(`Retained art integrity failure: ${name}`);
      const destination = join(root, 'public/content', archive.key.contentSha, name.slice('public/'.length));
      mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
    }
  }
  const registry = archives.map((archive, index) => `import { createRunExecutor as create${index} } from './${archive.archiveId}/src/run/online/executor';\nimport { validateGhostSubmission as validateGhost${index} } from './${archive.archiveId}/src/run/ghostValidate';`).join('\n')
    + `\nexport const current = ${JSON.stringify(current)};\nexport const executors = [${archives.map((archive, index) => `({...create${index}(${JSON.stringify(archive.key)}), validateGhost: validateGhost${index}})`).join(',')}];\n`;
  mkdirSync(generated, { recursive: true }); writeFileSync(join(generated, 'registry.ts'), registry);
  writeFileSync(join(generated, 'manifest.json'), JSON.stringify({ current, archives, sourceBytes: bytes }, null, 2));
  writeFileSync(join(generated, 'current.json'), JSON.stringify(current));
  if (options.production) publishExecutorArchives(root, archives);
  return { current, archives, bytes };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requiredIndex = process.argv.indexOf('--required');
  const required = requiredIndex < 0 ? undefined : JSON.parse(readFileSync(process.argv[requiredIndex + 1]!, 'utf8')) as RequiredExecutors;
  const built = buildRunExecutors({ production: process.argv.includes('--production'), required });
  process.stdout.write(`run executors OK: ${built.archives.length} isolated contexts, ${built.bytes} source bytes\n`);
}
