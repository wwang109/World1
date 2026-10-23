import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildRunExecutors } from './build-run-executors';
import { checkExecutorBundle } from './run-executor-preflight';
import type { RunExecutor } from '../src/run/online/types';
import { bossFixture } from './online-audit-fixtures';

const baseline = buildRunExecutors();
const root = resolve('tmp/community/retention', randomUUID());
mkdirSync(root, { recursive: true });
const source = baseline.archives[0]!;
for (const name of [...Object.keys(source.files), ...Object.keys(source.artFiles)]) {
  const destination = join(root, name); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(name, destination);
}
copyFileSync('src/data/content-build.v1.json', join(root, 'src/data/content-build.v1.json'));
const first = buildRunExecutors({ root });
const definitions = JSON.parse(readFileSync(join(root, 'src/data/content/skills.v1.json'), 'utf8'));
definitions.cards[0].versions[0].def.name += ' revision B';
definitions.cards.find((card: { id: string }) => card.id === 'sword_slash').versions[0].def.effects[0].power += 1;
writeFileSync(join(root, 'src/data/content/skills.v1.json'), JSON.stringify(definitions));
const meta = JSON.parse(readFileSync(join(root, 'src/data/content-build.v1.json'), 'utf8'));
meta.contentSha = 'b'.repeat(40); writeFileSync(join(root, 'src/data/content-build.v1.json'), JSON.stringify(meta));
const second = buildRunExecutors({ root, required: { exportedAt: Date.now(), databaseId: 'audit', keys: [first.current] } });
assert.equal(second.archives.length, 2);
async function load(id: string): Promise<RunExecutor> {
  const module = await import(pathToFileURL(join(root, 'src/service/runs/generated', id, 'src/run/online/executor.ts')).href) as { createRunExecutor: (key: RunExecutor['key']) => RunExecutor };
  const archive = second.archives.find(archive => archive.archiveId === id)!;
  return module.createRunExecutor(archive.key);
}
const old = await load(first.archives[0]!.archiveId), fresh = await load(second.archives[0]!.archiveId);
const oldState = old.create(711), oldContent = JSON.stringify(old.present(oldState)), oldOffer = JSON.stringify(old.present(oldState).draft);
const battleState = bossFixture();
const pending = old.apply(battleState, { kind: 'issueEncounter' }, { runId: 'retention-run', revision: 0, encounterId: 'retention-encounter' }).effects[0]!;
assert.equal(pending.kind, 'encounter');
if (pending.kind !== 'encounter') throw new Error('Missing retained canonical encounter');
const oldLog = JSON.stringify(old.resolve(battleState, pending.encounter).log);
fresh.resolve(battleState, { ...pending.encounter, key: fresh.key });
assert.equal(JSON.stringify(old.resolve(battleState, pending.encounter).log), oldLog);
for (let index = 0; index < 3; index++) { fresh.present(fresh.create(index)); old.present(oldState); }
assert.notEqual(JSON.stringify(fresh.present(oldState).skills), JSON.stringify(old.present(oldState).skills));
assert.equal(JSON.stringify(old.present(oldState)), oldContent);
assert.equal(JSON.stringify(old.present(oldState).draft), oldOffer);
assert.notEqual(old.present(oldState).artBase, fresh.present(oldState).artBase);
assert.throws(() => buildRunExecutors({ root, required: { exportedAt: Date.now(), databaseId: 'audit', keys: [{ contentSha: 'missing', rulesRevision: 'missing' }] } }), /Missing retained/);
assert.throws(() => buildRunExecutors({ root, production: true }), /fresh active-executor/);
const oldSource = Object.keys(first.archives[0]!.files)[0]!;
writeFileSync(join(root, '.run-executor-archive', first.archives[0]!.archiveId, oldSource), 'tampered');
assert.throws(() => buildRunExecutors({ root, required: { exportedAt: Date.now(), databaseId: 'audit', keys: [first.current] } }), /integrity failure/);
const bundle = await checkExecutorBundle();
console.log(`executor retention OK: 2 isolated source closures; old content/offers/art stable; missing/tampered/unverified deployment rejected; ${bundle.bytes} bundle bytes`);
