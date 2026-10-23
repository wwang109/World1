import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {ContentManifest} from '../src/data/contentManifest';
import { validateProposalManifest } from '../src/community/validate';
import { GAME_ROOT, MANIFEST_PATH, REQUIRED_CONTENT, assertRetainedDocumentHistory, parseContentManifest, readStrictJson, safeFile, sha256, validateContentSnapshot } from './contentSnapshot';
import {findDuplicateKeys} from './jsonDuplicateKeys';
import { assertCandidateInventory } from './candidateInventory';

export interface CandidateValidationOptions {
  root:string;sourceRevision:string;baseSha?:string;trustedGameRevision?:string;repositoryId?:number;prNumber?:number;fetcher?:typeof fetch;
}
async function fetchImmutableBaseBytes(baseSha:string,path:string,maxBytes:number,fetcher:typeof fetch=fetch):Promise<Uint8Array>{
  if(!/^[a-f0-9]{40}$/.test(baseSha))throw new Error('Promotion evidence requires an immutable base SHA');
  if(path!==MANIFEST_PATH&&!REQUIRED_CONTENT.includes(path))throw new Error('Immutable base fetch path is not a trusted catalog');
  const response=await fetcher(`https://raw.githubusercontent.com/wwang109/wandering-hand-content/${baseSha}/${path}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok||!response.body)throw new Error(`Immutable base manifest/catalog fetch failed (${response.status})`);
  if(Number(response.headers.get('content-length')??0)>maxBytes)throw new Error('Immutable base manifest/catalog exceeds byte bound');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let count=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>maxBytes)throw new Error('Immutable base manifest/catalog exceeds byte bound');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
function parseBaseJson(bytes:Uint8Array):unknown {
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(findDuplicateKeys(raw).length)throw new Error('Immutable base manifest/catalog contains duplicate JSON keys');return JSON.parse(raw);
}
export async function fetchImmutableBaseManifest(baseSha:string,fetcher:typeof fetch=fetch):Promise<ContentManifest>{
  return parseContentManifest(parseBaseJson(await fetchImmutableBaseBytes(baseSha,MANIFEST_PATH,1024*1024,fetcher)));
}
export async function assertImmutableBaseHistory(root:string,baseSha:string,manifest:ContentManifest,fetcher:typeof fetch=fetch):Promise<void>{
  for(const path of REQUIRED_CONTENT){
    const file=manifest.files.find(entry=>entry.path===path);if(!file||file.bytes>8*1024*1024)throw new Error(`Immutable base catalog missing/oversized: ${path}`);
    const bytes=await fetchImmutableBaseBytes(baseSha,path,file.bytes,fetcher);if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error(`Immutable base catalog hash/length mismatch: ${path}`);
    assertRetainedDocumentHistory(path,parseBaseJson(bytes),readStrictJson(root,path),bytes,readFileSync(safeFile(root,path)));
  }
}
export function proposalRuntimeChanges(declaredPaths:readonly string[],candidate:ContentManifest,base:ContentManifest):{path:string;baseSha256:string|null;sha256:string}[]{
  const candidateFiles=new Map(candidate.files.map(file=>[file.path,file.sha256]));const baseFiles=new Map(base.files.map(file=>[file.path,file.sha256]));
  return [...new Set(declaredPaths)].sort().flatMap(path=>{const sha256=candidateFiles.get(path),baseSha256=baseFiles.get(path)??null;return sha256&&sha256!==baseSha256?[{path,baseSha256,sha256}]:[];});
}
export async function validateCommunityCandidate(options:CandidateValidationOptions) {
const root=resolve(options.root);const sourceRevision=options.sourceRevision;
if(!/^[a-f0-9]{40}$/.test(sourceRevision))throw new Error('Candidate source revision must be a Git commit SHA');
const baseSha=options.baseSha??sourceRevision;const trustedGameRevision=options.trustedGameRevision??'0'.repeat(40);
const repositoryId=options.repositoryId??1426486653,prNumber=options.prNumber??0;
if(!/^[a-f0-9]{40}$/.test(baseSha)||!/^[a-f0-9]{40}$/.test(trustedGameRevision)||!Number.isSafeInteger(repositoryId)||repositoryId!==1426486653||!Number.isSafeInteger(prNumber)||prNumber<0)throw new Error('Invalid validation provenance');
const inventory=assertCandidateInventory(root);
const manifest=await validateContentSnapshot(root,{mechanics:true});
const proposals=join(root,'community/proposals');let count=0;const proposalManifests:{path:string;sha256:string;implementation:{state:'implemented'|'needs_implementation';runtimeChanges:{path:string;baseSha256:string|null;sha256:string}[]}}[]=[];
if(existsSync(proposals)){
  const entries=readdirSync(proposals,{withFileTypes:true});if(entries.length>128)throw new Error('Proposal validation report exceeds manifest count bound');
  const base=entries.length?await fetchImmutableBaseManifest(baseSha,options.fetcher):undefined;
  if(base)await assertImmutableBaseHistory(root,baseSha,base,options.fetcher);
  for(const entry of entries){
    if(!entry.isDirectory()||entry.isSymbolicLink()||!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.name))throw new Error('Unsafe proposal directory');
    const path=`community/proposals/${entry.name}/proposal.json`;const proposal=validateProposalManifest(readStrictJson(root,path,256*1024));
    const runtimeChanges=proposalRuntimeChanges([...proposal.contentPaths,...proposal.previewPaths],manifest.manifest,base!);
    proposalManifests.push({path,sha256:sha256(readFileSync(safeFile(root,path))),implementation:{state:runtimeChanges.length?'implemented':'needs_implementation',runtimeChanges}});
    for(const reference of [...proposal.contentPaths,...proposal.previewPaths]){const file=safeFile(root,reference);if(!lstatSync(file).isFile())throw new Error('Proposal references must be files');}
    count++;
  }
}
const report={version:1,status:'valid',repositoryId,prNumber,headSha:sourceRevision,baseSha,trustedGameRevision,gameContentApiVersion:1,contentManifestSha256:sha256(readFileSync(join(root,MANIFEST_PATH))),proposalManifests,mechanicsValidation:'valid',mechanicsEvidence:['schema-references','tier-budget-caps','equipment-catalog','equipment-battle','battle-passives'],results:{snapshot:'valid',generated:'valid',proposal:'valid'},files:manifest.manifest.files.length,inventory,proposals:count};
return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flag=(name:string):string|undefined=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  const root=flag('--root'),sourceRevision=flag('--sha');if(!root||!sourceRevision)throw new Error('--root and immutable --sha are required');
  const report=await validateCommunityCandidate({root,sourceRevision,baseSha:flag('--base-sha'),trustedGameRevision:flag('--game-revision'),repositoryId:Number(flag('--repository-id')??1426486653),prNumber:Number(flag('--pr-number')??0)});
  writeFileSync(join(GAME_ROOT,'tmp/content-validation-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
