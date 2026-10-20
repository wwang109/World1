import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentSource } from '../src/data/contentManifest';
import { ART_MANIFEST_PATH, GAME_ROOT, MANIFEST_PATH, parseContentManifest, readStrictJson, safeFile, sha256, validateCatalogsIsolated, validateContentSnapshot } from './contentSnapshot';
import { activateSnapshot, recoverContentSync } from './contentSyncJournal';

export interface BuildMetadata {contentSha:string;rulesRevision:string;manifestSha256:string}
export const BUILD_METADATA='src/data/content-build.v1.json';
export function readBuildMetadata(root:string):BuildMetadata{return readStrictJson(root,BUILD_METADATA,4096) as BuildMetadata;}
export function rulesRevisionForSource(state:{head:string;dirty:boolean}):string {
  if(!/^[a-f0-9]{40}$/.test(state.head))throw new Error('Game rules source did not resolve to an immutable Git HEAD');
  return state.dirty?`development-${state.head}`:state.head;
}
export function currentRulesRevision(gameRoot=GAME_ROOT):string {
  const checkoutRoot=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:gameRoot,encoding:'utf8'}).trim();
  if(resolve(checkoutRoot).toLowerCase()!==resolve(gameRoot).toLowerCase())throw new Error('Build rules must be evaluated from the actual Git checkout root');
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:gameRoot,encoding:'utf8'}).trim();
  const dirty=execFileSync('git',['status','--porcelain','--untracked-files=all','--','src','scripts','server','functions','package.json','package-lock.json','tsconfig.json','tsconfig.functions.json','tsconfig.community-worker.json','vite.config.ts','index.html',':(exclude)src/data/content/**',':(exclude)src/data/content-build.v1.json',':(exclude)src/service/runs/generated/**'],{cwd:gameRoot,encoding:'utf8'}).trim().length>0;
  return rulesRevisionForSource({head,dirty});
}
export function refreshBuildRulesMetadata(root:string,options:{production?:boolean;gameRoot?:string}={}):BuildMetadata {
  const previous=readBuildMetadata(root);const rulesRevision=currentRulesRevision(options.gameRoot??GAME_ROOT);
  if(options.production&&!/^[a-f0-9]{40}$/.test(rulesRevision))throw new Error('Production rules require a clean published game revision; uncommitted source remains development-only');
  if(previous.manifestSha256!==sha256(readFileSync(safeFile(root,MANIFEST_PATH))))throw new Error('Refusing to refresh rules metadata over an edited content manifest');
  if(rulesRevision===previous.rulesRevision)return previous;
  const next={...previous,rulesRevision};const target=safeFile(root,BUILD_METADATA);writeFileSync(`${target}.rules-next`,JSON.stringify(next,null,2)+'\n');renameSync(`${target}.rules-next`,target);return next;
}
export async function verifyLocalSnapshot(root:string):Promise<BuildMetadata>{
  if(existsSync(join(root,'.content-sync/journal.json')))throw new Error('Content activation interrupted; run content:sync to recover before building');
  const metadata=readBuildMetadata(root);
  if(metadata.manifestSha256!==sha256(readFileSync(safeFile(root,MANIFEST_PATH))))throw new Error('Managed manifest was edited; explicit content:snapshot --write is required for local authoring');
  await validateContentSnapshot(root);
  if(existsSync(join(root,'.content-sync/journal.json'))||JSON.stringify(readBuildMetadata(root))!==JSON.stringify(metadata)||metadata.manifestSha256!==sha256(readFileSync(safeFile(root,MANIFEST_PATH))))throw new Error('Content changed during offline verification; retry after sync completes');
  return metadata;
}
export function localBuildMetadata(root:string):void{
  const hash=sha256(readFileSync(join(root,MANIFEST_PATH)));const rulesRevision=currentRulesRevision();
  writeFileSync(join(root,BUILD_METADATA),JSON.stringify({contentSha:`local-${hash}`,rulesRevision,manifestSha256:hash},null,2)+'\n');
}
async function boundedFetch(fetcher:typeof fetch,url:string,maxBytes:number):Promise<Uint8Array>{
  const response=await fetcher(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'Wandering-Hand-Content-Sync'},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error(`Content refresh failed (${response.status}) at ${url}`);
  const length=response.headers.get('content-length');if(length&&Number(length)>maxBytes)throw new Error('Download exceeds byte limit');
  if(!response.body)throw new Error('Empty download body');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('Download exceeds byte limit');chunks.push(value);}}finally{await reader.cancel();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
async function syncContentUnlocked(source:ContentSource,opts:{refresh:boolean;root:string;fetcher?:typeof fetch;onReplace?:(count:number)=>void}):Promise<{sha:string;changed:boolean}>{
  if(source.owner!=='wwang109'||source.repo!=='wandering-hand-content'||source.ref!=='main')throw new Error('Unexpected community content source');
  const root=resolve(opts.root);recoverContentSync(root);
  const previous=await verifyLocalSnapshot(root);if(!opts.refresh)return {sha:previous.contentSha,changed:false};
  const fetcher=opts.fetcher??fetch;
  const commitBytes=await boundedFetch(fetcher,`https://api.github.com/repos/${source.owner}/${source.repo}/commits/main`,256*1024);
  const commit=JSON.parse(new TextDecoder().decode(commitBytes)) as {sha?:string};if(!commit.sha||!/^[a-f0-9]{40}$/.test(commit.sha))throw new Error('GitHub did not return an immutable commit SHA');
  const sha=commit.sha;const base=`https://raw.githubusercontent.com/${source.owner}/${source.repo}/${sha}/`;
  mkdirSync(join(root,'tmp'),{recursive:true});const staged=mkdtempSync(join(root,'tmp/content-download-'));
  try{
    writeFileSync(join(staged,MANIFEST_PATH),await boundedFetch(fetcher,`${base}${MANIFEST_PATH}`,1024*1024));
    const manifest=parseContentManifest(readStrictJson(staged,MANIFEST_PATH));
    for(const entry of manifest.files){const bytes=await boundedFetch(fetcher,`${base}${entry.path}`,entry.bytes);if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw new Error(`Corrupt/incomplete download: ${entry.path}`);const target=join(staged,entry.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
    await validateContentSnapshot(staged);
    const generated=validateCatalogsIsolated(staged);const wiki='docs/generated/event-catalog.md',template='docs/templates/equipment.v1.template.json';
    for(const [path,text]of [[wiki,generated.wiki],[template,generated.equipmentTemplate]]){const target=join(staged,path!);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text!);}
    const metadata:BuildMetadata={contentSha:sha,rulesRevision:currentRulesRevision(),manifestSha256:sha256(readFileSync(join(staged,MANIFEST_PATH)))};
    mkdirSync(join(staged,'src/data'),{recursive:true});writeFileSync(join(staged,BUILD_METADATA),JSON.stringify(metadata,null,2)+'\n');
    // Re-check immediately before activation, after all network and validation work.
    const latest=await verifyLocalSnapshot(root);if(JSON.stringify(latest)!==JSON.stringify(previous))throw new Error('Managed snapshot changed during refresh');
    const oldManifest=parseContentManifest(readStrictJson(root,MANIFEST_PATH));
    const oldPaths=new Set(oldManifest.files.map(file=>file.path));
    for(const entry of manifest.files)if(!oldPaths.has(entry.path)&&existsSync(safeFile(root,entry.path)))throw new Error(`Refusing to overwrite local unmanaged file: ${entry.path}`);
    const paths=[...new Set([...manifest.files.map(f=>f.path),...oldManifest.files.map(f=>f.path),MANIFEST_PATH,BUILD_METADATA,wiki,template])].sort();
    activateSnapshot(root,staged,paths,previous.contentSha,sha,opts.onReplace);
    return {sha,changed:sha!==previous.contentSha};
  }catch(error){recoverContentSync(root);throw error;}finally{rmSync(staged,{recursive:true,force:true});}
}
export async function syncContent(source:ContentSource,opts:Parameters<typeof syncContentUnlocked>[1]):Promise<{sha:string;changed:boolean}>{
  const lock=join(resolve(opts.root),'.content-sync.lock');
  if(existsSync(lock)){
    const pid=Number(readFileSync(lock,'utf8'));
    if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid content sync lock; manual inspection required');
    let alive=true;try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}
    if(alive)throw new Error('Another content sync is active');unlinkSync(lock);
  }
  const fd=openSync(lock,'wx');writeFileSync(fd,String(process.pid));closeSync(fd);
  try{return await syncContentUnlocked(source,opts);}finally{unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=readStrictJson(GAME_ROOT,'content-source.json') as ContentSource;
  const root=process.argv.includes('--root')?resolve(process.argv[process.argv.indexOf('--root')+1]!):GAME_ROOT;
  if(process.argv.includes('--bootstrap')){localBuildMetadata(root);console.log(`local snapshot: ${readBuildMetadata(root).contentSha}`);}else{const result=await syncContent(source,{root,refresh:!process.argv.includes('--offline')});const metadata=refreshBuildRulesMetadata(root,{production:process.argv.includes('--production')});console.log(`content ${result.changed?'updated':'retained'}: ${result.sha}; rules ${metadata.rulesRevision}`);}
}
