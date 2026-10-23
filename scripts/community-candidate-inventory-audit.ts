import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertCandidateInventory } from './candidateInventory';
import { exportCommunityRepository } from './export-community-repository';
import { ART_MANIFEST_PATH, GAME_ROOT } from './contentSnapshot';
import { mutateJson } from './content-audit-fixture';
import { validateCommunityCandidate } from './validate-community-candidate';

const root=mkdtempSync(join(GAME_ROOT,'tmp/candidate-inventory-'));let rejected=0;
try{
  await exportCommunityRepository(root);const baseline=assertCandidateInventory(root);assert.equal(baseline.files,690);
  const publicRoot=join(GAME_ROOT,'tmp/wandering-hand-content');if(existsSync(publicRoot))assert.equal(assertCandidateInventory(publicRoot).files,690);
  mutateJson(root,ART_MANIFEST_PATH,art=>{const ids=Object.keys(art.cards);art.cards[ids[0]!]=art.cards[ids[1]!];});
  const valid=await validateCommunityCandidate({root,sourceRevision:'b'.repeat(40)});assert.equal(valid.status,'valid');assert.equal(valid.inventory.files,690);
  const reject=async(path:string,text:string):Promise<void>=>{
    const file=join(root,path),before=existsSync(file)?readFileSync(file):null;mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);
    try{await assert.rejects(()=>validateCommunityCandidate({root,sourceRevision:'b'.repeat(40)}),/Candidate inventory:/,`valid runtime plus ${path} must reject`);rejected++;}
    finally{if(before)writeFileSync(file,before);else{rmSync(file);let parent=dirname(file);while(parent!==root&&(parent.startsWith(`${root}\\`)||parent.startsWith(`${root}/`))){if(readdirSync(parent).length)break;rmdirSync(parent);parent=dirname(parent);}}}
  };
  await reject('.github/workflows/validate-content.yml','name: malicious\non: push\njobs: {}\n');
  await reject('.github/workflows/evil.yml','name: malicious\non: push\njobs: {}\n');
  await reject('scripts/evil.js','throw new Error("must never merge")');
  await reject('src/data/content/payload.ts','export default "must never merge"');
  await reject('package.json','{"scripts":{"postinstall":"must-never-run"}}');
  await reject('.gitattributes','* filter=malicious\n');
  await reject('community/proposal.schema.json','{}');
  await reject('public/game-art/unregistered.png','not a registered asset');
  await reject('art-src/reference/unallowlisted.png','not a production master');
  await reject('.hidden/payload.json','{}');
  await reject('community/proposals/attack/run.sh','echo malicious');
  const link=join(root,'art-src/cards/inventory-link');symlinkSync(join(root,'public/game-art'),link,'junction');
  try{assert(lstatSync(link).isSymbolicLink());await assert.rejects(()=>validateCommunityCandidate({root,sourceRevision:'b'.repeat(40)}),/symlink forbidden/);rejected++;}finally{rmSync(link);}
  const git=(args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();git(['init','--quiet']);
  assert.equal(assertCandidateInventory(root).files,690,'checkout metadata is ignored');
  const blob=git(['hash-object','-w','README.md']);git(['update-index','--add','--cacheinfo',`100755,${blob},README.md`]);
  assert.throws(()=>assertCandidateInventory(root),/Git tree requires regular nonexecutable files/);rejected++;
  git(['update-index','--cacheinfo',`120000,${blob},README.md`]);assert.throws(()=>assertCandidateInventory(root),/Git tree requires regular nonexecutable files/);rejected++;
  git(['update-index','--cacheinfo',`160000,${blob},README.md`]);assert.throws(()=>assertCandidateInventory(root),/Git tree requires regular nonexecutable files/);rejected++;
  git(['update-index','--cacheinfo',`100644,${blob},README.md`]);
  git(['update-index','--add','--cacheinfo',`100644,${blob},scripts/index-only.js`]);assert.throws(()=>assertCandidateInventory(root),/unallowlisted\/missing\/duplicate Git tree path/);rejected++;
  git(['update-index','--force-remove','scripts/index-only.js']);assert.equal(assertCandidateInventory(root).files,690);
  console.log(`candidate inventory OK: unchanged 690-file export/public snapshot; valid runtime change accepted; ${rejected} executable/workflow/control/symlink/unknown-path attacks rejected, including Git executable/symlink modes; only checkout metadata ignored`);
}finally{
  const target=resolve(root);assert(target.startsWith(`${join(GAME_ROOT,'tmp')}\\`)||target.startsWith(`${join(GAME_ROOT,'tmp')}/`));rmSync(target,{recursive:true,force:true});
}
