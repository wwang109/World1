import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {validateCommunityCandidate} from './validate-community-candidate';
import {candidateFixture,mutateJson} from './content-audit-fixture';
import {writeContentManifest} from './contentSnapshot';

const fixture=candidateFixture();let rejected=0;
const append=(document:any,collection:string,predicate:(value:any)=>boolean,mutate:(def:any)=>void):void=>{
  const entry=document[collection].find(predicate);assert.ok(entry,'fixture entry exists');
  const current=entry.versions.reduce((a:any,b:any)=>a.version>b.version?a:b);const next=structuredClone(current);next.version=Math.max(...entry.versions.map((version:any)=>version.version))+1;mutate(next.def);entry.versions.push(next);
};
const reject=async(label:string,path:string,mutation:(document:any)=>void,pattern:RegExp)=>{
  fixture.reset();mutateJson(fixture.root,path,mutation);
  try{await validateCommunityCandidate({root:fixture.root,sourceRevision:'c'.repeat(40)});assert.fail(`${label}: actual candidate validator accepted unsupported mechanics`);}
  catch(error){assert.ok(error instanceof Error);assert.ok(!/shipped .* changed\/deleted|frozen compatibility history/.test(error.message),`${label}: must reach mechanics validation`);assert.match(error.message,pattern,label);}
  rejected++;console.log(`rejected unsupported ${label}`);
};
try{
  if(!process.argv.includes('--additional')){
  await reject('modifier card wiring','src/data/content/modifiers.v1.json',doc=>append(doc,'modifiers',(entry:any)=>entry.versions.at(-1).def.affix===true,def=>def.cards=['community_unimplemented_card']),/unknown skill id.*community_unimplemented_card/);
  await reject('enemy inline gem wiring','src/data/content/enemies.v1.json',doc=>append(doc,'enemies',()=>true,def=>def.pieces[0].gem={id:'community_unknown_gem',kind:'effect',rarity:'common',actions:[{kind:'community_unknown_action'}]}),/unknown gem id.*community_unknown_gem/);
  await reject('card Action kind','src/data/content/skills.v1.json',doc=>append(doc,'cards',()=>true,def=>def.effects[0]={kind:'community_unknown_action'}),/unhandled action kind.*community_unknown_action/);
  await reject('conditional status','src/data/content/skills.v1.json',doc=>append(doc,'cards',()=>true,def=>def.effects[0]={kind:'exploit',status:'community_unknown_status',amount:1}),/status must be.*community_unknown_status/);
  await reject('gem Action kind','src/data/content/gems.v1.json',doc=>append(doc,'gems',(entry:any)=>entry.versions.at(-1).def.kind==='effect',def=>def.actions[0]={kind:'community_unknown_action'}),/unhandled action kind.*community_unknown_action/);
  await reject('gem kind','src/data/content/gems.v1.json',doc=>append(doc,'gems',()=>true,def=>def.kind='community_unknown_gem_kind'),/kind must be effect or stat.*community_unknown_gem_kind/);
  await reject('gem modifier wiring','src/data/content/gems.v1.json',doc=>append(doc,'gems',(entry:any)=>entry.versions.at(-1).def.kind==='stat',def=>def.mods.hero={community_unknown_stat:1}),/unknown hero mod community_unknown_stat/);
  await reject('equipment modifier','src/data/content/equipment.v1.json',doc=>append(doc,'items',()=>true,def=>def.statMods.community_unknown_modifier=1),/community_unknown_modifier/);
  await reject('equipment passive effect','src/data/content/equipment.v1.json',doc=>append(doc,'items',(entry:any)=>entry.versions.at(-1).def.passives?.length,def=>def.passives[0].effect.kind='community_unknown_effect'),/[Uu]nsupported passive effect/);
  await reject('enemy skill reference','src/data/content/enemies.v1.json',doc=>append(doc,'enemies',()=>true,def=>def.pieces[0].skillId='community_unimplemented_card'),/unknown skill id.*community_unimplemented_card/);
  await reject('modifier operation','src/data/content/modifiers.v1.json',doc=>append(doc,'modifiers',()=>true,def=>def.community_unknown_operation={kind:'new_engine_rule'}),/unknown field community_unknown_operation/);
  await reject('event operation','src/data/content/event-packs/00-core.json',doc=>append(doc,'events',()=>true,def=>def.choices[0].outcome={kind:'community_unknown_event_operation'}),/outcome is missing a recognized string kind/);
  }
  const knownGem=JSON.parse(readFileSync(join(fixture.root,'src/data/content/gems.v1.json'),'utf8')).gems[0];
  await reject('canonical gem payload override','src/data/content/enemies.v1.json',doc=>append(doc,'enemies',()=>true,def=>def.pieces[0].gem={id:knownGem.id,kind:'effect',rarity:'common',actions:[{kind:'community_unknown_action'}]}),/inline gem payload does not match a retained canonical definition/);
  await reject('V3 event outcome','src/data/content/event-packs/05-wayside.json',doc=>append(doc,'events',(entry:any)=>entry.versions.at(-1).def.choiceSet?.fixed?.length,def=>def.choiceSet.fixed[0].outcome={kind:'community_unknown_v3_effect'}),/outcome is missing a recognized string kind/);
  await reject('V3 event mutation','src/data/content/event-packs/05-wayside.json',doc=>append(doc,'events',(entry:any)=>entry.versions.at(-1).def.choiceSet?.fixed?.length,def=>def.choiceSet.fixed[0].mutations=[{op:'community_unknown_v3_mutation'}]),/community_unknown_v3_mutation/);
  fixture.reset();const report=await validateCommunityCandidate({root:fixture.root,sourceRevision:'c'.repeat(40)});assert.equal(report.mechanicsValidation,'valid');
  console.log(`community mechanics OK: ${rejected} unsupported mechanics rejected by actual isolated candidate validator; supported baseline passes trusted pricing/integration gates`);
}finally{fixture.dispose();}
