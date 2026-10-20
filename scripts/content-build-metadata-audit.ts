import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {snapshotFixture} from './content-audit-fixture';
import {BUILD_METADATA,currentRulesRevision,readBuildMetadata,refreshBuildRulesMetadata,rulesRevisionForSource} from './sync-community-content';
import {MANIFEST_PATH} from './contentSnapshot';
import {buildRunExecutors} from './build-run-executors';

const fixture=snapshotFixture();
try{
  assert.equal(rulesRevisionForSource({head:'a'.repeat(40),dirty:false}),'a'.repeat(40));
  assert.equal(rulesRevisionForSource({head:'b'.repeat(40),dirty:false}),'b'.repeat(40));
  assert.equal(rulesRevisionForSource({head:'a'.repeat(40),dirty:true}),`development-${'a'.repeat(40)}`);
  assert.throws(()=>rulesRevisionForSource({head:'main',dirty:false}),/immutable Git HEAD/);
  const before=readBuildMetadata(fixture.root);const manifest=readFileSync(join(fixture.root,MANIFEST_PATH));
  writeFileSync(join(fixture.root,BUILD_METADATA),JSON.stringify({...before,rulesRevision:'stale-bootstrap-rules'}));
  const updated=refreshBuildRulesMetadata(fixture.root);assert.equal(updated.rulesRevision,currentRulesRevision());assert.equal(updated.contentSha,before.contentSha);assert.equal(updated.manifestSha256,before.manifestSha256);assert.deepEqual(readFileSync(join(fixture.root,MANIFEST_PATH)),manifest);
  if(updated.rulesRevision.startsWith('development-')){
    assert.throws(()=>refreshBuildRulesMetadata(fixture.root,{production:true}),/clean published game revision/);
    assert.throws(()=>buildRunExecutors({production:true,required:{exportedAt:Date.now(),databaseId:'audit-current-source',keys:[]}}),/current clean committed game rules/);
  }
  assert.deepEqual(refreshBuildRulesMetadata(fixture.root),updated);
  console.log('content build metadata OK: clean/dirty HEAD identities distinguished; stale rules metadata refreshed; content identity and manifest bytes unchanged; dirty production preflight refused');
}finally{fixture.dispose();}
