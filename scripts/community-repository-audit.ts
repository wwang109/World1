import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { exportCommunityRepository, TRUSTED_WORKFLOW } from './export-community-repository';
import { GAME_ROOT, MANIFEST_PATH, parseContentManifest, readStrictJson, sha256, validateContentSnapshot } from './contentSnapshot';
const destination=mkdtempSync(join(GAME_ROOT,'tmp/repository-audit-'));const second=mkdtempSync(join(GAME_ROOT,'tmp/repository-audit-repeat-'));
const walk=(root:string,dir=root):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(root,join(dir,entry.name)):[relative(root,join(dir,entry.name)).replaceAll('\\','/')]).sort();
try{
  const first=await exportCommunityRepository(destination);const again=await exportCommunityRepository(second);assert.deepEqual(first,again);
  const paths=walk(destination);assert.deepEqual(paths,walk(second));
  for(const path of paths){assert.equal(sha256(readFileSync(join(destination,path))),sha256(readFileSync(join(second,path))),`reproducible ${path}`);assert.ok(/^(src\/data\/content\/.*\.json|public\/game-art\/.*\.(webp|png)|art-src\/.*\.png|art-manifest\.v1\.json|content-manifest\.v1\.json|README\.md|CONTRIBUTING\.md|community\/proposal.schema.json|\.github\/workflows\/validate-content.yml|\.gitattributes)$/.test(path),path);assert.ok(!/manga-staging|style-preview|template-references|screenshots|account|telemetry|\.env/.test(path));}
  assert.match(TRUSTED_WORKFLOW,/pull_request_target:/);assert.match(TRUSTED_WORKFLOW,/contents: read/);assert.ok(!/secrets\.|contents: write|pull-requests: write|npm .*candidate/.test(TRUSTED_WORKFLOW));assert.equal((TRUSTED_WORKFLOW.match(/persist-credentials: false/g)??[]).length,2);assert.match(TRUSTED_WORKFLOW,/TRUSTED_GAME_REVISION/);
  const marker=join(GAME_ROOT,'tmp/CANDIDATE_SCRIPT_RAN');if(existsSync(marker))rmSync(marker);
  writeFileSync(join(destination,'package.json'),JSON.stringify({scripts:{postinstall:`node -e "require('fs').writeFileSync('${marker.replaceAll('\\','/')}','bad')"`}}));
  mkdirSync(join(destination,'scripts'));writeFileSync(join(destination,'scripts/evil.js'),`require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`);
  assert.throws(()=>execFileSync(process.execPath,[join(GAME_ROOT,'node_modules/tsx/dist/cli.mjs'),join(GAME_ROOT,'scripts/validate-community-candidate.ts'),'--root',destination,'--sha','b'.repeat(40)],{cwd:GAME_ROOT,encoding:'utf8',stdio:'pipe',timeout:180000}),error=>error instanceof Error&&/Candidate inventory: (file|directory) not allowed:/.test(String((error as {stderr?:unknown}).stderr)));
  assert.equal(existsSync(marker),false);
  // Runtime bytes are explicitly binary to Git, so Windows checkout cannot rewrite their hashes.
  assert.match(readFileSync(join(destination,'.gitattributes'),'utf8'),/src\/data\/content\/\*\* -text/);assert.match(readFileSync(join(destination,'.gitattributes'),'utf8'),/art-manifest.v1.json -text/);
  console.log(`community repository OK: ${paths.length} allowlisted files, ${first.runtimeBytes} runtime bytes; reproducible export; malicious candidate package/scripts rejected before execution; read-only trusted CI`);
}finally{rmSync(destination,{recursive:true,force:true});rmSync(second,{recursive:true,force:true});}
