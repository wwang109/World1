import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ART_MANIFEST_PATH, GAME_ROOT, MANIFEST_PATH, parseContentManifest, safeFile, validateContentSnapshot, writeContentManifest } from './contentSnapshot';
import { mutateJson, snapshotFixture } from './content-audit-fixture';

const fixture=snapshotFixture();let rejected=0;
try{
  const baseline=await validateContentSnapshot(fixture.root);assert.deepEqual(JSON.parse(readFileSync(join(fixture.root,'src/data/content/skills.v1.json'),'utf8')),JSON.parse(readFileSync(join(GAME_ROOT,'src/data/content/skills.v1.json'),'utf8')));
  mkdirSync(join(fixture.root,'docs/generated'),{recursive:true});mkdirSync(join(fixture.root,'docs/templates'),{recursive:true});
  const regenerate=()=>{for(const script of ['eventPackCompiler.ts','generateEventCatalog.ts','equipment-template.ts'])execFileSync(process.execPath,[join(GAME_ROOT,'node_modules/tsx/dist/cli.mjs'),join(GAME_ROOT,'scripts',script),'--root',fixture.root],{cwd:GAME_ROOT,stdio:'pipe'});};
  regenerate();const generatedPaths=['src/data/content/events.v3.json','docs/generated/event-catalog.md','docs/templates/equipment.v1.template.json'];const generated=generatedPaths.map(path=>readFileSync(join(fixture.root,path)));regenerate();generatedPaths.forEach((path,index)=>assert.deepEqual(readFileSync(join(fixture.root,path)),generated[index]));
  const reject=async(name:string,mutation:()=>void,pattern:RegExp)=>{fixture.reset();mutation();await assert.rejects(()=>validateContentSnapshot(fixture.root),pattern,name);rejected++;};
  await reject('corrupt hash',()=>writeFileSync(join(fixture.root,'src/data/content/skills.v1.json'),'{}'),/hash\/length/);
  await reject('duplicate raw keys',()=>{writeFileSync(join(fixture.root,'src/data/content/skills.v1.json'),'{"schemaVersion":1,"schemaVersion":1}');writeContentManifest(fixture.root);},/duplicate JSON/);
  await reject('API mismatch',()=>{const m=JSON.parse(readFileSync(join(fixture.root,MANIFEST_PATH),'utf8'));m.gameContentApiVersion=2;writeFileSync(join(fixture.root,MANIFEST_PATH),JSON.stringify(m));},/incompatible/);
  await reject('missing asset',()=>mutateJson(fixture.root,ART_MANIFEST_PATH,a=>a.assets[0].path='public/game-art/missing.webp'),/missing\/disallowed/);
  await reject('bad dimensions',()=>mutateJson(fixture.root,ART_MANIFEST_PATH,a=>a.assets[0].width=1),/dimension contract/);
  await reject('bad alpha',()=>mutateJson(fixture.root,ART_MANIFEST_PATH,a=>a.assets[0].alpha='transparent'),/alpha contract/);
  await reject('frozen history',()=>mutateJson(fixture.root,'src/data/content/events.v2.json',a=>a.events[0].versions[0].def.title='changed'),/frozen/);
  await reject('stale generated output',()=>{const path=join(fixture.root,'src/data/content/events.v3.json');writeFileSync(path,readFileSync(path,'utf8')+'\n');writeContentManifest(fixture.root);},/stale/);
  await reject('missing paired art',()=>mutateJson(fixture.root,ART_MANIFEST_PATH,a=>delete a.platforms['biome:arrowfell'].mobile),/paired variants/);
  await reject('fallback bypass',()=>mutateJson(fixture.root,ART_MANIFEST_PATH,a=>a.cardFallbacks.push('new_missing_card')),/fallback allowlist/);
  const manifest=JSON.parse(readFileSync(join(GAME_ROOT,MANIFEST_PATH),'utf8'));manifest.files[0].path='../escape.json';assert.throws(()=>parseContentManifest(manifest),/unsafe/);rejected++;
  fixture.reset();const link=join(fixture.root,'linked');symlinkSync(GAME_ROOT,link,'junction');assert.throws(()=>safeFile(fixture.root,'linked/package.json'),/symlink/);unlinkSync(link);rejected++;
  console.log(`snapshot validation OK: ${rejected} malicious fixtures rejected; ${baseline.manifest.files.length} runtime files; initial definitions byte-equal; 3 generators byte-idempotent`);
}finally{fixture.dispose();}
