import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activateSnapshot, recoverContentSync } from './contentSyncJournal';
import { GAME_ROOT, MANIFEST_PATH } from './contentSnapshot';
import { snapshotFixture } from './content-audit-fixture';
import { syncContent } from './sync-community-content';
const source={owner:'wwang109',repo:'wandering-hand-content',ref:'main'} as const;
const fixture=snapshotFixture();let cases=0;
try{
  const initial=readFileSync(join(fixture.root,MANIFEST_PATH));
  await assert.rejects(()=>syncContent(source,{root:fixture.root,refresh:true,fetcher:(async()=>{throw new Error('network outage');}) as typeof fetch}),/network outage/);assert.deepEqual(readFileSync(join(fixture.root,MANIFEST_PATH)),initial);cases++;
  writeFileSync(join(fixture.root,'src/data/content/skills.v1.json'),'{}');let fetched=false;
  await assert.rejects(()=>syncContent(source,{root:fixture.root,refresh:true,fetcher:(async()=>{fetched=true;throw new Error('unexpected network');})as typeof fetch}),/hash\/length/);assert.equal(fetched,false);cases++;
  fixture.reset();const sha='a'.repeat(40);const requests:string[]=[];
  await assert.rejects(()=>syncContent(source,{root:fixture.root,refresh:true,fetcher:(async(url:any)=>{const value=String(url);requests.push(value);if(value.endsWith('/commits/main'))return new Response(JSON.stringify({sha}));if(value.endsWith(MANIFEST_PATH))return new Response(initial);return new Response('corrupt');})as typeof fetch}),/Corrupt\/incomplete|byte limit/);
  assert.equal(requests.filter(url=>url.endsWith('/commits/main')).length,1);assert.ok(requests.slice(1).every(url=>url.includes(`/${sha}/`)));assert.deepEqual(readFileSync(join(fixture.root,MANIFEST_PATH)),initial);cases++;
  const tiny=mkdtempSync(join(GAME_ROOT,'tmp/journal-audit-'));const staged=mkdtempSync(join(GAME_ROOT,'tmp/journal-new-'));
  try{
    for(const fault of [-1,1,2,-2]){mkdirSync(join(tiny,'data'),{recursive:true});mkdirSync(join(staged,'data'),{recursive:true});for(const path of ['data/a.json','data/b.json']){writeFileSync(join(tiny,path),'old');writeFileSync(join(staged,path),'new');}assert.throws(()=>activateSnapshot(tiny,staged,['data/a.json','data/b.json'],'old','new',count=>{if(count===fault)throw new Error('power loss');}),/power loss/);assert.equal(recoverContentSync(tiny),true);const expected=fault===-2?'new':'old';assert.equal(readFileSync(join(tiny,'data/a.json'),'utf8'),expected);assert.equal(readFileSync(join(tiny,'data/b.json'),'utf8'),expected);cases++;}
    const unchanged=join(tiny,'data/unchanged.webp');writeFileSync(unchanged,'same-art');writeFileSync(join(staged,'data/unchanged.webp'),'same-art');utimesSync(unchanged,new Date('2001-01-01T00:00:00Z'),new Date('2001-01-01T00:00:00Z'));const originalMtime=statSync(unchanged).mtimeMs;
    writeFileSync(join(tiny,'data/a.json'),'old');writeFileSync(join(staged,'data/a.json'),'new');
    let attempts=0;
    activateSnapshot(tiny,staged,['data/unchanged.webp','data/a.json'],'old','new',undefined,{rename:(from,to)=>{if(to===join(tiny,'data/a.json')&&++attempts<3)throw Object.assign(new Error('transient Windows lock'),{code:'EPERM'});renameSync(from,to);},delay:()=>{}});
    assert.equal(attempts,3);assert.equal(statSync(unchanged).mtimeMs,originalMtime);assert.equal(existsSync(join(tiny,'.content-sync')),false);assert.equal(existsSync(join(tiny,'data/a.json.incoming')),false);assert.equal(readFileSync(join(tiny,'data/a.json'),'utf8'),'new');cases++;
    writeFileSync(join(tiny,'data/a.json'),'old');
    assert.throws(()=>activateSnapshot(tiny,staged,['data/unchanged.webp','data/a.json'],'old','new',count=>{if(count===2)throw new Error('post-write interruption');}),/post-write interruption/);
    let recoveryAttempts=0;recoverContentSync(tiny,{rename:(from,to)=>{if(to===join(tiny,'data/a.json')&&++recoveryAttempts<3)throw Object.assign(new Error('transient recovery lock'),{code:'EBUSY'});renameSync(from,to);},delay:()=>{}});
    assert.equal(recoveryAttempts,3);assert.equal(statSync(unchanged).mtimeMs,originalMtime);assert.equal(readFileSync(join(tiny,'data/a.json'),'utf8'),'old');assert.equal(existsSync(join(tiny,'.content-sync')),false);assert.equal(existsSync(join(tiny,'data/a.json.recover')),false);cases++;
    let exhausted=0;assert.throws(()=>activateSnapshot(tiny,staged,['data/unchanged.webp','data/a.json'],'old','new',undefined,{rename:(from,to)=>{if(to===join(tiny,'data/a.json')){exhausted++;throw Object.assign(new Error('persistent lock'),{code:'EACCES'});}renameSync(from,to);},delay:()=>{}}),/persistent lock/);
    assert.equal(exhausted,50);assert.equal(readFileSync(join(tiny,'data/a.json'),'utf8'),'old');assert.equal(recoverContentSync(tiny),true);assert.equal(statSync(unchanged).mtimeMs,originalMtime);assert.equal(existsSync(join(tiny,'.content-sync')),false);assert.equal(existsSync(join(tiny,'data/a.json.incoming')),false);cases++;
  }
  finally{rmSync(tiny,{recursive:true,force:true});rmSync(staged,{recursive:true,force:true});}
  console.log(`content sync OK: ${cases} failure/recovery cases; one immutable SHA, dirty refusal, prior snapshot retained, journal wholly old/new; unchanged art mtime preserved; transient activation/recovery retries clean; permanent lock bounded at 50 attempts`);
}finally{fixture.dispose();}
