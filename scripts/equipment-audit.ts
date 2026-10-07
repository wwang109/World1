import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { equipmentCatalog, equipmentDocument, loadEquipmentContent } from '../src/data/equipmentContent';
import { validateEquipmentDocument } from '../src/data/validateEquipmentContent';
import { applyEquipmentDirectHeal, applyEquipmentStats, resolveEquipment } from '../src/engine/equipment/resolve';
import { equipmentItemText, equipmentSetText } from '../src/engine/equipment/text';
import { EQUIPMENT_EFFECT_REGISTRY, EQUIPMENT_STAT_REGISTRY } from '../src/engine/equipment/registry';
import { EQUIPMENT_SLOTS, type EquippedItemRef, type EquipmentActiveCard } from '../src/engine/equipment/types';
import { BASE_HERO_STATS } from '../src/data/heroes';
import { findDuplicateKeys } from './jsonDuplicateKeys';

let checks = 0;
function check(name: string, run: () => void): void {
  run(); checks += 1; console.log(`ok equipment ${name}`);
}
function refsFor(setId: string): EquippedItemRef[] {
  const set = equipmentDocument.sets.find((s) => s.id === setId);
  assert(set);
  const setVersion = Math.max(...set.versions.map((v) => v.version));
  return EQUIPMENT_SLOTS.map((slot) => {
    const item = equipmentDocument.items.find((i) => {
      const current = [...i.versions].sort((a, b) => b.version - a.version)[0]!;
      return current.def.setId === setId && current.def.slot === slot;
    });
    assert(item);
    return { instanceId: item.id, slot, itemId: item.id, itemVersion: Math.max(...item.versions.map((v) => v.version)), setVersion };
  });
}
function cardsFor(setId: string): EquipmentActiveCard[] {
  const version = refsFor(setId)[0]!.setVersion!;
  const requirement = equipmentCatalog.set(setId, version).boardRequirement;
  const match = requirement.match;
  const card: EquipmentActiveCard = { archetypes: [match.archetypesIncludes ?? 'offense'], property: match.property ?? 'physical', size: 3, ...(match.weapon === undefined ? {} : { weapon: match.weapon }) };
  return Array.from({ length: requirement.minCount }, () => structuredClone(card));
}
check('canonical document and raw keys', () => {
  assert.deepEqual(validateEquipmentDocument(equipmentDocument), []);
  assert.deepEqual(findDuplicateKeys(readFileSync(new URL('../src/data/content/equipment.v1.json', import.meta.url), 'utf8')), []);
});
check('empty equipment is neutral', () => {
  const resolved = resolveEquipment([], [], equipmentCatalog);
  assert.deepEqual(resolved, { statMods: {}, effectMods: {}, sets: [], pricingStatus: 'unresolved' });
  assert.deepEqual(applyEquipmentStats(BASE_HERO_STATS, resolved, { fullHpAtBattleSetup: false }), BASE_HERO_STATS);
});
for (const entry of equipmentDocument.sets) {
  check(`${entry.id} 0/1/2/3 pieces and board requirement`, () => {
    const refs = refsFor(entry.id);
    const cards = cardsFor(entry.id);
    for (let n = 0; n <= 3; n++) {
      const result = resolveEquipment(refs.slice(0, n), cards, equipmentCatalog);
      assert.deepEqual(result.sets[0]?.activeThresholds ?? [], n < 2 ? [] : n === 2 ? [2] : [2, 3]);
      const expectedStats: Record<string, number> = {};
      const expectedEffects: Record<string, number> = {};
      for (const ref of refs.slice(0, n)) for (const [key, value] of Object.entries(equipmentCatalog.item(ref.itemId, ref.itemVersion).statMods)) expectedStats[key] = (expectedStats[key] ?? 0) + value;
      for (const bonus of equipmentCatalog.set(entry.id, refs[0]!.setVersion!).bonuses.filter((b) => n >= b.pieces)) {
        for (const [key, value] of Object.entries(bonus.statMods ?? {})) expectedStats[key] = (expectedStats[key] ?? 0) + value;
        for (const [key, value] of Object.entries(bonus.effectMods ?? {})) expectedEffects[key] = (expectedEffects[key] ?? 0) + value;
      }
      assert.deepEqual(result.statMods, expectedStats);
      assert.deepEqual(result.effectMods, expectedEffects);
      for (const board of [[], cards.slice(0, Math.max(0, cards.length - 1))]) {
        const locked = resolveEquipment(refs.slice(0, n), board, equipmentCatalog);
        assert.deepEqual(locked.sets[0]?.activeThresholds ?? [], []);
        if (n) assert.equal(locked.sets[0]?.requirementMet, false);
      }
    }
    assert.equal(resolveEquipment(refs, cards.slice(0, 1), equipmentCatalog).sets[0]?.matchingCards, 1);
  });
}
check('mixed sets and standalone item', () => {
  const refs = [refsFor('duelist')[0]!, refsFor('arcanist')[1]!, { instanceId: 'wind', slot: 'charm' as const, itemId: 'wind_charm', itemVersion: 1 }];
  const result = resolveEquipment(refs, [...cardsFor('duelist'), ...cardsFor('arcanist')], equipmentCatalog);
  assert.equal(result.sets.length, 2);
  assert(result.sets.every((set) => set.activeThresholds.length === 0));
  assert.equal(result.statMods.speed, 1);
});
check('combined selectors require both criteria', () => {
  const cards = cardsFor('ravager');
  cards[0]!.property = 'magical';
  cards[1]!.archetypes = ['defensive'];
  const result = resolveEquipment(refsFor('ravager'), cards, equipmentCatalog);
  assert.equal(result.sets[0]?.matchingCards, 1);
  assert.deepEqual(result.sets[0]?.activeThresholds, []);
});
check('invalid equipped references rejected', () => {
  const valid = refsFor('duelist')[0]!;
  for (const refs of [
    [valid, { ...valid, instanceId: 'other' }],
    [valid, { ...valid, slot: 'accessory' as const }],
    [{ ...valid, itemId: 'missing' }],
    [{ ...valid, itemVersion: 99 }],
    [{ ...valid, itemVersion: NaN }],
    [{ ...valid, slot: 'charm' as const }],
    [{ ...valid, setVersion: undefined }],
    [{ ...valid, setVersion: 99 }],
    [{ ...valid, slot: 'weapon' }],
  ]) assert.throws(() => resolveEquipment(refs as EquippedItemRef[], [], equipmentCatalog));
});
check('strict schema rejects malformed content', () => {
  const mutations: ((d: Record<string, any>) => void)[] = [
    (d) => { d.typo = true; },
    (d) => { d.items[0].versions[0].def.text = 'duplicate prose'; },
    (d) => { d.items[0].versions[0].def.statMods.hp = 3; },
    (d) => { d.items[0].versions[0].def.statMods.attack = -1; },
    (d) => { d.items[0].versions[0].def.statMods.attack = 1.5; },
    (d) => { d.items[0].versions[0].def.slot = 'weapon'; },
    (d) => { d.items[0].versions[0].def.setId = 'missing'; },
    (d) => { d.items.push(d.items[0]); },
    (d) => { d.items[0].versions.push(d.items[0].versions[0]); },
    (d) => { d.items[0].versions[0].version = 0; },
    (d) => { d.sets[0].versions[0].def.boardRequirement.match.wepon = 'sword'; },
    (d) => { d.sets[0].versions[0].def.boardRequirement.match.weapon = 'gun'; },
    (d) => { d.sets[0].versions[0].def.boardRequirement.minCount = 0; },
    (d) => { d.sets[0].versions[0].def.bonuses[0].effectMods = { healPct: 5 }; },
    (d) => { d.sets[0].versions[0].def.bonuses[0].pieces = 3; },
    (d) => { d.items[0].versions[0].def.dropEligibility.sourceKinds = ['shop']; },
    (d) => { d.items = d.items.filter((i: any) => i.id !== 'duelist_coat'); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(equipmentDocument);
    mutate(copy); assert(validateEquipmentDocument(copy).length > 0);
    assert.throws(() => loadEquipmentContent(copy));
  }
});
check('pinned versions, historical values, snapshots, configurable count', () => {
  const d = structuredClone(equipmentDocument) as any;
  const first = d.items[0];
  const old = structuredClone(first.versions[0].def);
  first.versions.unshift({ version: 2, def: { ...old, statMods: { attack: 99 } } });
  d.sets[0].versions.push({ version: 2, def: { ...structuredClone(d.sets[0].versions[0].def), boardRequirement: { source: 'active_equipped_board_card_instances', minCount: 1, match: { weapon: 'sword' } } } });
  const catalog = loadEquipmentContent(d);
  assert.deepEqual(catalog.item(first.id, 1), old);
  assert.equal(catalog.item(first.id, 2).statMods.attack, 99);
  first.versions[0].def.statMods.attack = 500;
  assert.equal(catalog.item(first.id, 2).statMods.attack, 99);
  assert.throws(() => { catalog.item(first.id, 2).statMods.attack = 4; });
  const refs = refsFor('duelist').map((r) => ({ ...r, setVersion: 2 }));
  assert.deepEqual(resolveEquipment(refs, cardsFor('duelist').slice(0, 1), catalog).sets[0]?.activeThresholds, [2, 3]);
  refs[0]!.setVersion = 1;
  assert.throws(() => resolveEquipment(refs, cardsFor('duelist'), catalog));
});
check('immutable stat fold and full HP policy', () => {
  const stats = { ...BASE_HERO_STATS, hp: 40 };
  const refs = refsFor('bastion'); const board = cardsFor('bastion');
  const before = JSON.stringify({ refs, board, stats });
  const resolved = resolveEquipment(refs, board, equipmentCatalog);
  const full = applyEquipmentStats(stats, resolved, { fullHpAtBattleSetup: true });
  assert.equal(full.hp, full.maxHp);
  assert.equal(applyEquipmentStats(stats, resolved, { fullHpAtBattleSetup: false }).hp, 40);
  assert.equal(JSON.stringify({ refs, board, stats }), before);
  assert.deepEqual(resolveEquipment([...refs].reverse(), board, equipmentCatalog), resolved);
  assert.equal(JSON.stringify(resolveEquipment(refs, board, equipmentCatalog)), JSON.stringify(resolved));
});
check('Restorer additive healing floors once and excludes other actions', () => {
  const result = resolveEquipment(refsFor('restorer'), cardsFor('restorer'), equipmentCatalog);
  assert.equal(result.effectMods.outgoingHealPct, 20);
  const action = { kind: 'heal' as const, power: 3 };
  assert.equal(applyEquipmentDirectHeal(action, 9, result.effectMods), 10);
  assert.equal(applyEquipmentDirectHeal({ kind: 'heal', power: 0 }, 17, {}), 17);
  assert.equal(applyEquipmentDirectHeal({ kind: 'shield', power: 3 }, 9, result.effectMods), 9);
  assert.equal(applyEquipmentDirectHeal({ kind: 'lifesteal', pct: 10 }, 9, result.effectMods), 9);
  assert.equal(applyEquipmentDirectHeal({ kind: 'regen', stacks: 3 }, 9, result.effectMods), 9);
  assert.equal(action.power, 3);
  for (const n of [-1, NaN, Infinity, 0.5]) {
    assert.throws(() => applyEquipmentDirectHeal(action, n, {}));
    assert.throws(() => applyEquipmentDirectHeal(action, 9, { outgoingHealPct: n }));
  }
  assert.throws(() => applyEquipmentDirectHeal(action, Number.MAX_SAFE_INTEGER, { outgoingHealPct: 20 }));
});
check('generated descriptions and shared rules', () => {
  assert.equal(equipmentItemText(equipmentCatalog.item('duelist_coat', 1)), 'HP +12 · DEF +1');
  assert.equal(equipmentSetText(equipmentCatalog.set('ravager', 1)).requirement, '3 PHYSICAL + OFFENSE cards on board');
  assert.equal(equipmentSetText(equipmentCatalog.set('restorer', 1)).bonuses[1], '3 pieces (additional): HP +10 · HEAL +10%');
  assert(Object.values(EQUIPMENT_STAT_REGISTRY).every((r) => r.title && r.rule));
  assert(EQUIPMENT_EFFECT_REGISTRY.outgoingHealPct.rule.includes('Excludes'));
});
check('generated template byte equality', () => {
  const expected = JSON.stringify({ ...equipmentDocument, status: 'generated_template_mirror', notes: ['Generated from src/data/content/equipment.v1.json; edit the canonical catalog, then run npm run content:equipment-template.', ...equipmentDocument.notes] }, null, 2) + '\n';
  assert.equal(readFileSync(new URL('../docs/templates/equipment.v1.template.json', import.meta.url), 'utf8'), expected);
});
console.log(`Equipment audit: ${checks} checks passed; ${equipmentDocument.items.length} items, ${equipmentDocument.sets.length} sets`);
