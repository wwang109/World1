import assert from 'node:assert/strict';
import { equipmentCatalog, equipmentDocument } from '../src/data/equipmentContent';
import { skillBook } from '../src/data/skills';
import { EQUIPMENT_SLOTS, type EquippedItemRef } from '../src/engine/equipment/types';
import { equipmentCardMatches } from '../src/engine/equipment/registry';
import { resolveEquipment, applyEquipmentStats } from '../src/engine/equipment/resolve';
import { applyBattleEquipment, requestEquipment } from '../src/run/battleEquipment';
import { prepareBattleConfig, resolveBattle, type BattleRequest } from '../src/run/resolveBattle';
import { initCombatState } from '../src/engine/combat/state';
import { applyCast, tickRegen } from '../src/engine/combat/interpreter';
import { NO_MODS } from '../src/engine/combat/auras';
import type { CombatEvent } from '../src/engine/combat/events';
import type { SkillDef } from '../src/engine/types';
import { Rng } from '../src/engine/rng';
import { gemBook } from '../src/data/gems';
import { applyHeroGems, gemHeroStats } from '../src/engine/cards';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok equipment-battle ${name}`); }
function refsFor(setId: string): EquippedItemRef[] {
  return EQUIPMENT_SLOTS.map(slot => {
    const entry = equipmentDocument.items.find(item => item.versions[0]!.def.setId === setId && item.versions[0]!.def.slot === slot)!;
    return { instanceId: `audit-${entry.id}`, slot, itemId: entry.id, itemVersion: 1, setVersion: 1 };
  });
}
const request: BattleRequest = { pieces: [{ skillId: 'sword_slash', slot: 0 }], heroLevel: 1, heroAllocation: {},
  foes: [{ enemyId: 'bandit_duelist', level: 1, rank: 0, title: 'normal' }], seed: 5 };
check('absent and empty equipment are byte-identical', () => {
  assert.equal(JSON.stringify(resolveBattle(request)), JSON.stringify(resolveBattle({ ...request, heroEquipment: [] })));
});
check('reference-only request rejects malformed, unknown, duplicated and unpinned items', () => {
  const refs = refsFor('duelist');
  for (const bad of [null, {}, [null], [{ ...refs[0], stats: { attack: 999 } }], [{ ...refs[0], itemVersion: 0 }], [{ ...refs[0], itemId: 'unknown' }],
    [refs[0], refs[0]], [{ ...refs[0], slot: 'charm' }], [{ ...refs[0], setVersion: undefined }], [{ ...refs[0], itemVersion: 2 }],
    [{ ...refs[0], get illegal() { throw new Error('must not run'); } }]]) {
    assert.throws(() => applyBattleEquipment(prepareBattleConfig(request).playerTeam![0]!, bad));
  }
  const getter = { ...refs[0], get itemId() { throw new Error('getter must not run'); } };
  assert.throws(() => requestEquipment([getter]), /plain values/);
});
for (const entry of equipmentDocument.sets) check(`${entry.id} active board and two/three-piece thresholds`, () => {
  const def = equipmentCatalog.set(entry.id, 1);
  const card = Object.values(skillBook).find(skill => equipmentCardMatches(skill, def.boardRequirement.match) && skill.size <= 3)!;
  assert(card);
  const pieces = Array.from({ length: def.boardRequirement.minCount }, (_, n) => ({ skillId: card.id, slot: n * card.size }));
  for (const n of [1, 2, 3]) {
    const refs = refsFor(entry.id).slice(0, n);
    const configured = prepareBattleConfig({ ...request, pieces, heroEquipment: refs }).playerTeam![0]!;
    const base = prepareBattleConfig({ ...request, pieces }).playerTeam![0]!;
    const resolved = resolveEquipment(refs, pieces.map(p => skillBook[p.skillId]!), equipmentCatalog);
    assert.deepEqual(configured.stats, applyEquipmentStats(base.stats, resolved, { fullHpAtBattleSetup: true }));
    assert.equal(configured.stats.hp, configured.stats.maxHp);
    assert.deepEqual(configured.equipment!.sets[0]!.activeThresholds, n < 2 ? [] : n === 2 ? [2] : [2, 3]);
  }
});
check('card instance counts exclude occupied span slots and saved bag cards', () => {
  const configured = prepareBattleConfig({ ...request, pieces: [{ skillId: 'iron_bulwark', slot: 0 }], heroEquipment: refsFor('bastion') }).playerTeam![0]!;
  assert.equal(configured.equipment!.sets[0]!.matchingCards, 1);
  assert.deepEqual(configured.equipment!.sets[0]!.activeThresholds, []);
});
check('turn-zero receipt survives API JSON and same seed repeats', () => {
  const input = { ...request, heroEquipment: refsFor('duelist') };
  const copy = JSON.stringify(input);
  const one = resolveBattle(input), two = resolveBattle(input);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.equal(JSON.stringify(input), copy);
  assert.equal(one.events[0]!.kind, 'equipmentSetup');
  assert.deepEqual(JSON.parse(JSON.stringify(one)).events[0], one.events[0]);
});
check('hero gems and ghost equipment fold once', () => {
  const gem = Object.values(gemBook).find(candidate => candidate.kind === 'stat' && candidate.scope === 'hero');
  assert(gem);
  const pieces = [{ skillId: 'sword_slash', slot: 0, gem }];
  const config = prepareBattleConfig({ ...request, pieces, heroEquipment: refsFor('duelist'),
    foes: [{ ...request.foes[0]!, ghost: { pieces: [{ skillId: 'sword_slash', slot: 0 }], level: 1, allocation: {}, displayName: 'Equipped Ghost', equipment: refsFor('duelist') } }] });
  const state = initCombatState(config);
  assert.deepEqual(state.player.stats, applyHeroGems(config.playerTeam![0]!.stats, gemHeroStats(config.playerTeam![0]!.pieces)));
  assert.deepEqual(state.enemy.stats, config.enemyTeam![0]!.equipment!.statsAfter);
  assert.equal(resolveBattle({ ...request, foes: [{ ...request.foes[0]!, ghost: { pieces: [{ skillId: 'sword_slash', slot: 0 }], level: 1, allocation: {}, displayName: 'Equipped Ghost', equipment: refsFor('duelist') } }] }).events[0]!.kind, 'equipmentSetup');
});
function castHealing(property: 'physical' | 'true', tax: boolean, gem = false): Extract<CombatEvent, { kind: 'heal' }> {
  const prepared = prepareBattleConfig({ ...request, pieces: [0, 1, 2].map(slot => ({ skillId: 'second_wind', slot })), heroEquipment: refsFor('restorer') });
  const state = initCombatState(prepared), events: CombatEvent[] = [];
  state.player.stats.hp = 1;
  if (tax) state.player.statuses.push({ kind: 'poison', stacks: 2, turnsLeft: 2 }, { kind: 'expose', turnsLeft: 2 });
  const skill: SkillDef = { ...skillBook['second_wind']!, property, effects: [{ kind: 'heal', power: 7, ...(gem ? { fromGem: true } : {}) }] };
  applyCast({ state, events, rng: new Rng(5) }, state.player, skill, 0, { ...NO_MODS, healFlat: 2 }, { before: 0, after: 1 });
  const heal = events.find((event): event is Extract<CombatEvent, { kind: 'heal' }> => event.kind === 'heal')!;
  assert(heal?.calculation);
  const c = heal.calculation;
  const base = c.power + c.statBonus + c.healFlat + (c.bonus ?? 0);
  assert.equal(c.equipmentBonus, Math.floor(base * 120 / 100) - base);
  assert.equal(heal.amount + heal.overheal + (heal.antiHeal?.reduced ?? 0), Math.floor(base * 120 / 100));
  return heal;
}
check('Restorer applies summed twenty percent once before tax and HP cap', () => {
  castHealing('physical', false); const taxed = castHealing('physical', true);
  assert.equal(taxed.antiHeal!.pct, 40);
  assert.equal(taxed.antiHeal!.reduced, Math.floor((taxed.amount + taxed.overheal + taxed.antiHeal!.reduced) * 40 / 100));
  assert.equal(castHealing('true', true).antiHeal, undefined);
  castHealing('physical', true, true);
});
check('regeneration bypasses direct-heal modifier', () => {
  const prepared = prepareBattleConfig({ ...request, pieces: [0, 1, 2].map(slot => ({ skillId: 'second_wind', slot })), heroEquipment: refsFor('restorer') });
  const state = initCombatState(prepared), events: CombatEvent[] = [];
  state.player.stats.hp = 1; state.player.statuses.push({ kind: 'regen', stacks: 7, turnsLeft: 7 });
  tickRegen({ state, events, rng: new Rng(5) }, state.player);
  const heal = events.find(event => event.kind === 'heal');
  assert(heal?.kind === 'heal'); assert.equal(heal.amount, 7); assert.equal(heal.calculation, undefined);
});
check('lifesteal bypasses direct-heal modifier', () => {
  const prepared = prepareBattleConfig({ ...request, pieces: [0, 1, 2].map(slot => ({ skillId: 'second_wind', slot })), heroEquipment: refsFor('restorer') });
  const state = initCombatState(prepared), events: CombatEvent[] = [];
  state.player.stats.hp = 1;
  const skill: SkillDef = { ...skillBook['sword_slash']!, effects: [{ kind: 'damage', power: 10 }, { kind: 'lifesteal', pct: 100 }] };
  applyCast({ state, events, rng: new Rng(5) }, state.player, skill, 0, NO_MODS, { before: 0, after: 1 });
  const damage = events.find(event => event.kind === 'damage'), heal = events.find(event => event.kind === 'heal');
  assert(damage?.kind === 'damage' && heal?.kind === 'heal');
  assert.equal(heal.amount + heal.overheal, damage.amount); assert.equal(heal.calculation, undefined);
});
console.log(`equipment battle audit OK (${checks} checks)`);
