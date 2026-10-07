import assert from 'node:assert/strict';
import { equipmentCatalog, equipmentDocument, loadEquipmentContent } from '../src/data/equipmentContent';
import { enemyBookFromJson, enemyContentMeta } from '../src/data/enemiesContent';
import { biomeCatalog } from '../src/data/biomes';
import { buildEquipmentLootSources, equipmentLootSourcesFromJson, type EquipmentEnemySource, type EquipmentEventGrantSource } from '../src/data/equipmentLootSources';
import { validateEquipmentLoot, validateEquipmentLootPool } from '../src/data/validateEquipmentLoot';
import { equipmentDetailsModel } from '../src/engine/equipment/details';
import type { EquipmentLootEntry } from '../src/engine/equipment/types';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok equipment sources ${name}`); }
const sources = equipmentLootSourcesFromJson();
const ref: EquipmentLootEntry = { itemId: 'duelist_coat', itemVersion: 1, setVersion: 1, weight: 1 };
check('every authored current enemy pool is valid', () => {
  for (const enemy of Object.values(enemyBookFromJson)) {
    assert(enemy.equipmentDrop, `${enemy.id} has no pool`);
    assert.deepEqual(validateEquipmentLoot(enemy.equipmentDrop, equipmentCatalog), [], enemy.id);
    assert(enemyContentMeta[enemy.id]);
  }
});
check('every equipment item has overlapping enemy sources', () => {
  for (const item of equipmentDocument.items) {
    const current = [...item.versions].sort((a, b) => b.version - a.version)[0]!;
    const set = equipmentDocument.sets.find((s) => s.id === current.def.setId);
    const pinned = { itemId: item.id, itemVersion: current.version, ...(set === undefined ? {} : { setVersion: Math.max(...set.versions.map((v) => v.version)) }) };
    const model = equipmentDetailsModel(pinned, equipmentCatalog, sources);
    assert(model.lootFrom.enemies.length >= 3, `${item.id} needs three enemy sources`);
    assert(model.lootFrom.locations.length >= 2, `${item.id} needs two preferred biomes`);
    assert(model.lootFrom.locations.every((b) => b.preferred && !b.exclusive));
    assert.equal(model.lootFrom.title, 'Loot From');
    assert.equal(model.lootFrom.locationCaption, 'Often found in');
    if (!model.lootFrom.events.length) assert.equal(model.lootFrom.eventEmptyText, 'No event sources.');
  }
});
check('source names and biome membership come from authoritative catalogs', () => {
  for (const source of sources.sources) {
    for (const enemy of source.enemies) {
      assert.equal(enemy.name, enemyBookFromJson[enemy.id]!.name);
      assert.equal(enemy.inEnemyPool, true);
      const preferred = Object.values(biomeCatalog).filter((b) => b.mobs.includes(enemy.id) || b.bosses.includes(enemy.id)).map((b) => b.id).sort();
      assert.deepEqual([...enemy.preferredBiomeIds], preferred);
    }
    for (const biome of source.locations) assert.equal(biome.name, biomeCatalog[biome.id]!.name);
  }
});
check('deterministic input ordering and duplicate source deduplication', () => {
  const enemies = Object.values(enemyBookFromJson), biomes = Object.values(biomeCatalog);
  const input = JSON.stringify({ enemies, biomes });
  const eventless = buildEquipmentLootSources(enemies, biomes, [], equipmentCatalog);
  assert.deepEqual(buildEquipmentLootSources([...enemies].reverse(), [...biomes].reverse(), [], equipmentCatalog), eventless);
  assert.deepEqual(buildEquipmentLootSources([...enemies, enemies[0]!], [...biomes, biomes[0]!], [], equipmentCatalog), eventless);
  assert.equal(JSON.stringify({ enemies, biomes }), input);
  assert.deepEqual(equipmentLootSourcesFromJson(), sources);
});
check('name changes propagate and source details are detached', () => {
  const enemy: EquipmentEnemySource = { id: 'fixture', name: 'Renamed Enemy', equipmentDrop: { pool: [ref] } };
  const biomes = [{ id: 'fixture_biome', name: 'Renamed Biome', mobs: ['fixture'], bosses: ['fixture'] }];
  const index = buildEquipmentLootSources([enemy], biomes, [], equipmentCatalog);
  const model = equipmentDetailsModel(ref, equipmentCatalog, index);
  assert.equal(model.lootFrom.enemies[0]?.name, enemy.name);
  assert.equal(model.lootFrom.locations[0]?.name, biomes[0]!.name);
  assert.equal(model.lootFrom.locations.length, 1);
  (model.lootFrom.enemies[0] as { name: string }).name = 'Local change';
  assert.equal(index.sources[0]?.enemies[0]?.name, 'Renamed Enemy');
  assert.equal(equipmentDetailsModel(ref, equipmentCatalog, buildEquipmentLootSources([enemy], [], [], equipmentCatalog)).lootFrom.locationNote, 'No known locations.');
});
check('strict pool shapes, weights, references and versions', () => {
  const invalid = [
    null, [], {}, { pool: [] }, { chance: 10, pool: [ref] },
    { pool: [ref, ref] }, { pool: [{ ...ref, typo: 1 }] },
    ...[0, -1, 1.2, NaN, Infinity].map((weight) => ({ pool: [{ ...ref, weight }] })),
    { pool: [{ ...ref, itemVersion: 0 }] },
    { pool: [{ ...ref, weight: Number.MAX_SAFE_INTEGER }, { itemId: 'wind_charm', itemVersion: 1, weight: 1 }] },
  ];
  for (const input of invalid) assert(validateEquipmentLootPool(input).length > 0);
  for (const entry of [
    { ...ref, itemId: 'unknown' }, { ...ref, itemVersion: 99 },
    { ...ref, setVersion: undefined }, { ...ref, setVersion: 99 },
    { itemId: 'wind_charm', itemVersion: 1, setVersion: 1, weight: 1 },
  ]) assert(validateEquipmentLoot({ pool: [entry] }, equipmentCatalog).length > 0);
  assert.deepEqual(validateEquipmentLootPool({ pool: [ref] }), []);
});
check('pinned versions isolate reverse sources and preserve set versions', () => {
  const document = structuredClone(equipmentDocument) as any;
  const item = document.items.find((i: any) => i.id === ref.itemId);
  item.versions.push({ version: 2, def: { ...structuredClone(item.versions[0].def), name: 'Historical Fixture New Version' } });
  const set = document.sets.find((s: any) => s.id === 'duelist');
  set.versions.push({ version: 2, def: structuredClone(set.versions[0].def) });
  const catalog = loadEquipmentContent(document);
  const index = buildEquipmentLootSources([
    { id: 'old', name: 'Old Source', equipmentDrop: { pool: [ref] } },
    { id: 'new', name: 'New Source', equipmentDrop: { pool: [{ ...ref, itemVersion: 2 }] } },
    { id: 'set_new', name: 'New Set Source', equipmentDrop: { pool: [{ ...ref, setVersion: 2 }] } },
  ], [], [], catalog);
  assert.deepEqual(equipmentDetailsModel(ref, catalog, index).lootFrom.enemies.map((e) => e.id), ['old']);
  assert.deepEqual(equipmentDetailsModel({ ...ref, itemVersion: 2 }, catalog, index).lootFrom.enemies.map((e) => e.id), ['new']);
  assert.deepEqual(equipmentDetailsModel({ ...ref, setVersion: 2 }, catalog, index).lootFrom.enemies.map((e) => e.id), ['set_new']);
  assert(validateEquipmentLoot({ pool: [ref, { itemId: 'duelist_crest', itemVersion: 1, setVersion: 2, weight: 1 }] }, catalog).length > 0);
});
check('source eligibility and explicit event extension without false events', () => {
  const document = structuredClone(equipmentDocument) as any;
  const item = document.items.find((i: any) => i.id === 'wind_charm');
  item.versions[0].def.dropEligibility.sourceKinds = ['event'];
  const catalog = loadEquipmentContent(document);
  const wind = { itemId: 'wind_charm', itemVersion: 1, weight: 1 };
  assert(validateEquipmentLoot({ pool: [wind] }, catalog, 'fight').length > 0);
  assert.deepEqual(validateEquipmentLoot({ pool: [wind] }, catalog, 'event'), []);
  const event: EquipmentEventGrantSource = { id: 'fixture_event', name: 'Explicit Event Fixture', equipmentGrant: wind };
  const index = buildEquipmentLootSources([], [], [event, event], catalog);
  const details = equipmentDetailsModel(wind, catalog, index);
  assert.equal(details.lootFrom.events.length, 1);
  assert.equal(details.lootFrom.events[0]?.name, event.name);
  assert.equal(details.lootFrom.events[0]?.authored, true);
  assert.equal(details.lootFrom.eventEmptyText, undefined);
  assert.equal(equipmentDetailsModel({ itemId: 'wind_charm', itemVersion: 1 }, equipmentCatalog, sources).set, undefined);
});
console.log(`Equipment sources audit: ${checks} checks passed; ${Object.keys(enemyBookFromJson).length} enemy pools, ${equipmentDocument.items.length} items with enemy sources`);
