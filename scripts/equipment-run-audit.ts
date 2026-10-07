import assert from 'node:assert/strict';
import { createRun } from '../src/run/runState';
import { awardEquipment, awardBattleEquipment, awardCompletedEventEquipment, encounterEquipmentPool, equipmentLootConfig } from '../src/run/equipmentLoot';
import { equipEquipment, unequipEquipment, validateRunEquipment } from '../src/run/equipmentInventory';
import { saveRun, loadRun, SCHEMA_VERSION, RUN_SAVE_STORAGE_KEY } from '../src/meta/runSave';
import { equipmentCatalog } from '../src/data/equipmentContent';
import { validateEquipmentLoot } from '../src/data/validateEquipmentLoot';
import { eventContentMeta, eventDefAtVersion } from '../src/data/eventsContent';
import { isEventDefV3 } from '../src/data/eventContentV3';

let checks = 0;
function check(name: string, action: () => void) { action(); checks++; console.log(`ok equipment run ${name}`); }
const base = { ...createRun(5), status: 'active' as const, draft: undefined };
const pool = encounterEquipmentPool(['bandit_duelist']);
check('canonical pools and event versions are valid', () => {
  for (const event of equipmentLootConfig.events) {
    const def = eventDefAtVersion(event.eventId,event.eventVersion)!;
    assert(def);
    assert(!eventContentMeta[event.eventId]?.retired);
    const choices = isEventDefV3(def) ? def.choiceSet.fixed ?? [] : def.choices;
    assert(event.choiceIds.every(id => choices.some(choice => choice.id === id)));
    assert.deepEqual(validateEquipmentLoot({ pool:event.pool },equipmentCatalog,'event'),[]);
  }
});
check('pack dedup uses max weights and repeated foes do not alter rewards', () => {
  assert.deepEqual(encounterEquipmentPool(['bandit_duelist','bandit_duelist']),pool);
  assert.deepEqual(encounterEquipmentPool(['bandit_duelist','giant_rat']),encounterEquipmentPool(['giant_rat','bandit_duelist']));
  assert(encounterEquipmentPool(['ghost']).length > 0);
});
const awarded = awardEquipment(base,'fight','audit',pool,10000);
check('at most one award, deterministic, immutable, idempotent', () => {
  assert.equal(awarded.ownedEquipment!.length,1);
  assert.deepEqual(awarded,awardEquipment(base,'fight','audit',pool,10000));
  assert.equal(awardEquipment(awarded,'fight','audit',pool,10000),awarded);
  assert.equal(base.ownedEquipment!.length,0);
  assert.equal(awardEquipment(base,'fight','miss',pool,0).ownedEquipment!.length,0);
  for(let seed=0;seed<100;seed++) assert.equal(awardBattleEquipment({...base,seed},'one',['bandit_duelist'],true).ownedEquipment!.length,1);
  for(let seed=0;seed<100;seed++) { const lost={...base,seed}; assert.equal(awardBattleEquipment(lost,'one',['bandit_duelist'],false),lost); }
});
check('owned pins equip in their slot and unequip; unknown owned id is inert', () => {
  const item = awarded.ownedEquipment![0]!;
  const equipped = equipEquipment(awarded,item.instanceId);
  assert.equal(equipped.equippedEquipment!.length,1);
  assert(validateRunEquipment(equipped));
  assert.equal(equipEquipment(equipped,'not-owned'),equipped);
  assert.equal(unequipEquipment(equipped,equipped.equippedEquipment![0]!.slot).equippedEquipment!.length,0);
  assert(!validateRunEquipment({...equipped,ownedEquipment:[]}));
  assert(!validateRunEquipment({...equipped,ownedEquipment:[item,item]}));
});
check('event completion grants once; pending picker and unchosen event do not', () => {
  const event = equipmentLootConfig.events[0]!;
  const previous = { ...base,currentNodeId:'event-a',eventInstances:{'event-a':{eventId:event.eventId,contentVersion:event.eventVersion,instanceId:'instance-a',drawnDepth:1}} };
  assert.equal(awardCompletedEventEquipment(previous,previous),previous);
  const resolution = {eventId:event.eventId,contentVersion:event.eventVersion,instanceId:'instance-a',choiceId:event.choiceIds[0]!};
  const pending = { ...previous,eventResolutions:{'event-a':{...resolution,pending:true}} };
  assert.equal(awardCompletedEventEquipment(previous,pending),pending);
  const completed = { ...previous,eventResolutions:{'event-a':{...resolution,pending:false}} };
  const result = awardCompletedEventEquipment(previous,completed);
  assert.equal(result.ownedEquipment!.length,1);
  assert.equal(result.equipmentRewardReceipts![0]!.sourceId,'instance-a');
  assert.equal(awardCompletedEventEquipment(result,result),result);
  const left = { ...completed,eventResolutions:{'event-a':{...resolution,choiceId:'leave'}} };
  assert.equal(awardCompletedEventEquipment(previous,left),left);
});
check('schema six round trip preserves owned/equipped/receipts and rejects corrupt ownership', () => {
  const data = new Map<string,string>();
  const driver = {get:(key:string)=>data.get(key)??null,set:(key:string,value:string)=>{data.set(key,value);return true}};
  const equipped = equipEquipment(awarded,awarded.ownedEquipment![0]!.instanceId);
  assert.equal(SCHEMA_VERSION,6);
  assert(saveRun(driver,equipped).ok);
  assert.deepEqual(loadRun(driver),JSON.parse(JSON.stringify(equipped)));
  const broken = JSON.parse(data.get(RUN_SAVE_STORAGE_KEY)!);
  broken.run.ownedEquipment = [];
  data.set(RUN_SAVE_STORAGE_KEY,JSON.stringify(broken));
  assert.equal(loadRun(driver),null);
  data.set(RUN_SAVE_STORAGE_KEY,JSON.stringify({schemaVersion:5,run:equipped}));
  assert.equal(loadRun(driver),null);
});
console.log(`Equipment run audit: ${checks} checks passed.`);
