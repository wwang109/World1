import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sha256, safeFile, type SnapshotError } from './contentSnapshot';

export interface ContentSyncJournal {
  stage: 'downloaded'|'validated'|'activating'|'committed';
  oldSha: string; newSha: string;
  replacements: {path:string;oldHash:string|null;newHash:string|null}[];
}
export const JOURNAL_DIRECTORY='.content-sync';
export interface FileReplacementOperations {rename?:(source:string,target:string)=>void;delay?:()=>void}
function paths(root:string){const dir=join(root,JOURNAL_DIRECTORY);return {dir,journal:join(dir,'journal.json'),backup:join(dir,'backup')};}
function replaceFile(source:string,target:string,operations:FileReplacementOperations={}):void {
  const delay=new Int32Array(new SharedArrayBuffer(4));
  for(let attempt=0;;attempt++)try{(operations.rename??renameSync)(source,target);return;}catch(error){
    if(attempt>=49||!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;
    if(operations.delay)operations.delay();else Atomics.wait(delay,0,0,20);
  }
}
function writeJournal(root:string,journal:ContentSyncJournal,operations:FileReplacementOperations={}):void{const p=paths(root);mkdirSync(p.dir,{recursive:true});writeFileSync(`${p.journal}.next`,JSON.stringify(journal,null,2));replaceFile(`${p.journal}.next`,p.journal,operations);}
export function recoverContentSync(root:string,operations:FileReplacementOperations={}):boolean {
  const p=paths(root);if(!existsSync(p.journal))return false;
  const journal=JSON.parse(readFileSync(p.journal,'utf8')) as ContentSyncJournal;
  if(!Array.isArray(journal.replacements)||!['downloaded','validated','activating','committed'].includes(journal.stage))throw new Error('Invalid sync journal; retain backups for repair');
  // A committed journal means every replacement was durably recorded. Otherwise roll back.
  if(journal.stage==='activating')for(const entry of journal.replacements){
    const target=safeFile(root,entry.path);
    for(const temporary of [`${target}.incoming`,`${target}.recover`])if(existsSync(temporary))rmSync(temporary);
    if(entry.oldHash===null){if(existsSync(target))rmSync(target);continue;}
    if(existsSync(target)&&sha256(readFileSync(target))===entry.oldHash)continue;
    const backup=safeFile(p.backup,entry.path);const bytes=readFileSync(backup);
    if(sha256(bytes)!==entry.oldHash)throw new Error(`Corrupt sync backup: ${entry.path}`);
    mkdirSync(dirname(target),{recursive:true});copyFileSync(backup,`${target}.recover`);replaceFile(`${target}.recover`,target,operations);
  }
  rmSync(p.dir,{recursive:true,force:true});return true;
}
export function activateSnapshot(root:string,staged:string,entries:readonly string[],oldSha:string,newSha:string,onReplace?:(count:number)=>void,operations:FileReplacementOperations={}):void {
  root=resolve(root);const p=paths(root);if(existsSync(p.journal))throw new Error('Recover prior sync before activation');
  mkdirSync(p.backup,{recursive:true});
  const journal:ContentSyncJournal={stage:'downloaded',oldSha,newSha,replacements:entries.map(path=>({path,oldHash:existsSync(safeFile(root,path))?sha256(readFileSync(safeFile(root,path))):null,newHash:existsSync(safeFile(staged,path))?sha256(readFileSync(safeFile(staged,path))):null}))};
  writeJournal(root,journal,operations);
  for(const entry of journal.replacements)if(entry.oldHash!==null){const destination=join(p.backup,entry.path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(safeFile(root,entry.path),destination);}
  journal.stage='validated';writeJournal(root,journal,operations);onReplace?.(-1);
  journal.stage='activating';writeJournal(root,journal,operations);
  let count=0;
  for(const entry of journal.replacements){const target=safeFile(root,entry.path);mkdirSync(dirname(target),{recursive:true});if(entry.newHash===null){if(existsSync(target))rmSync(target);}else{const bytes=readFileSync(safeFile(staged,entry.path));if(sha256(bytes)!==entry.newHash)throw new Error(`Staging changed: ${entry.path}`);if(!existsSync(target)||sha256(readFileSync(target))!==entry.newHash){writeFileSync(`${target}.incoming`,bytes);replaceFile(`${target}.incoming`,target,operations);}}onReplace?.(++count);}
  journal.stage='committed';writeJournal(root,journal,operations);onReplace?.(-2);
  rmSync(p.dir,{recursive:true,force:true});
}
