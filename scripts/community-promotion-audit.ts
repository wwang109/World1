import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {candidateFixture,mutateJson} from './content-audit-fixture';
import {ART_MANIFEST_PATH,GAME_ROOT,MANIFEST_PATH,REQUIRED_CONTENT,sha256} from './contentSnapshot';
import {assertImmutableBaseHistory,fetchImmutableBaseManifest,validateCommunityCandidate} from './validate-community-candidate';

const fixture=candidateFixture();
try{
  const base=JSON.parse(readFileSync(join(fixture.root,MANIFEST_PATH),'utf8'));
  const baseDocuments=new Map(REQUIRED_CONTENT.map(path=>[path,readFileSync(join(fixture.root,path))]));
  const gemPath='src/data/content/gems.v1.json';const futureGems=JSON.parse(baseDocuments.get(gemPath)!.toString('utf8'));const gem=futureGems.gems[0];const futureVersion=Math.max(...gem.versions.map((entry:{version:number})=>entry.version))+17;const retained=structuredClone(gem.versions.at(-1));retained.version=futureVersion;gem.versions.push(retained);
  assert.ok(!JSON.parse(readFileSync(join(GAME_ROOT,gemPath),'utf8')).gems[0].versions.some((entry:{version:number})=>entry.version===futureVersion),'base-only shipped version is absent from trusted game checkout');
  baseDocuments.set(gemPath,Buffer.from(JSON.stringify(futureGems,null,2)+'\n'));
  const gemFile=base.files.find((entry:{path:string})=>entry.path===gemPath);gemFile.bytes=baseDocuments.get(gemPath)!.length;gemFile.sha256=sha256(baseDocuments.get(gemPath)!);
  const baseBytes=Buffer.from(JSON.stringify(base));writeFileSync(join(fixture.root,gemPath),baseDocuments.get(gemPath)!);
  mutateJson(fixture.root,ART_MANIFEST_PATH,art=>{const ids=Object.keys(art.cards);art.cards[ids[0]!]=art.cards[ids[1]!];});
  const write=(path:string,value:unknown)=>{mkdirSync(dirname(join(fixture.root,path)),{recursive:true});writeFileSync(join(fixture.root,path),JSON.stringify(value));};
  write('community/proposals/draft-only/drafts/card.json',{effects:[{kind:'community_unimplemented_keyword'}]});
  write('art-src/cards/proposed-master.png',{candidate:'master-only; not a runtime asset'});
  const proposals=[
    {id:'draft-only',paths:['community/proposals/draft-only/drafts/card.json'],expected:'needs_implementation'},
    {id:'unchanged-runtime',paths:['src/data/content/skills.v1.json'],expected:'needs_implementation'},
    {id:'master-only',paths:['art-src/cards/proposed-master.png'],expected:'needs_implementation'},
    {id:'promoted-runtime',paths:[ART_MANIFEST_PATH],expected:'implemented'},
  ];
  for(const proposal of proposals)write(`community/proposals/${proposal.id}/proposal.json`,{version:1,title:`Promotion audit ${proposal.id}`,category:'art',description:'Promotion evidence fixture',attribution:'Local generated validation fixture',contentPaths:proposal.paths,previewPaths:[]});
  const baseSha='a'.repeat(40),requests:string[]=[];
  const prefix=`https://raw.githubusercontent.com/wwang109/wandering-hand-content/${baseSha}/`;
  const fetcher=(async(url:unknown)=>{const address=String(url);requests.push(address);assert.ok(address.startsWith(prefix));const path=address.slice(prefix.length);const bytes=path===MANIFEST_PATH?baseBytes:baseDocuments.get(path);assert.ok(bytes,`unexpected immutable base path ${path}`);return new Response(bytes);}) as typeof fetch;
  const report=await validateCommunityCandidate({root:fixture.root,sourceRevision:'b'.repeat(40),baseSha,fetcher});
  assert.equal(report.mechanicsValidation,'valid');assert.equal(requests.length,REQUIRED_CONTENT.length+1);assert.equal(requests[0],`${prefix}${MANIFEST_PATH}`);assert.ok(requests.every(address=>address.startsWith(prefix)));
  for(const proposal of proposals){const record=report.proposalManifests.find(entry=>entry.path===`community/proposals/${proposal.id}/proposal.json`);assert.ok(record);assert.equal(record.implementation.state,proposal.expected);if(proposal.expected==='implemented'){assert.equal(record.implementation.runtimeChanges.length,1);const change=record.implementation.runtimeChanges[0]!;assert.equal(change.path,ART_MANIFEST_PATH);assert.equal(change.baseSha256,base.files.find((entry:{path:string})=>entry.path===ART_MANIFEST_PATH).sha256);assert.notEqual(change.sha256,change.baseSha256);}else assert.deepEqual(record.implementation.runtimeChanges,[]);}
  const retainedError=new RegExp(`shipped ${gem.id}@${futureVersion} changed/deleted`);
  mutateJson(fixture.root,gemPath,document=>document.gems[0].versions=document.gems[0].versions.filter((entry:{version:number})=>entry.version!==futureVersion));
  await assert.rejects(()=>validateCommunityCandidate({root:fixture.root,sourceRevision:'b'.repeat(40),baseSha,fetcher}),retainedError);
  mutateJson(fixture.root,gemPath,document=>{document.gems[0]=structuredClone(gem);document.gems[0].versions.find((entry:{version:number})=>entry.version===futureVersion).def.name=`Changed ${retained.def.name}`;});
  await assert.rejects(()=>validateCommunityCandidate({root:fixture.root,sourceRevision:'b'.repeat(40),baseSha,fetcher}),retainedError);
  await assert.rejects(()=>assertImmutableBaseHistory(fixture.root,baseSha,base,(async()=>new Response('bad catalog bytes'))as typeof fetch),/hash\/length mismatch|exceeds byte bound/);
  let unsafeFetch=false;await assert.rejects(()=>fetchImmutableBaseManifest('../main',(async()=>{unsafeFetch=true;return new Response(baseBytes);}) as typeof fetch),/immutable base SHA/);assert.equal(unsafeFetch,false);
  await assert.rejects(()=>fetchImmutableBaseManifest(baseSha,(async()=>new Response('missing',{status:404}))as typeof fetch),/fetch failed/);
  await assert.rejects(()=>fetchImmutableBaseManifest(baseSha,(async()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}}))as typeof fetch),/exceeds byte bound/);
  await assert.rejects(()=>fetchImmutableBaseManifest(baseSha,(async()=>new Response('{"schemaVersion":1,"schemaVersion":1}'))as typeof fetch),/duplicate JSON keys/);
  console.log('community promotion OK: draft-only/master-only/unchanged paths need implementation; changed declared art pins base/head hashes; actual candidate retains a base-only shipped version absent trusted game and rejects deletion/mutation; immutable base downloads enforce hashes and byte bounds');
}finally{fixture.dispose();}
