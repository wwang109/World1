import assert from 'node:assert/strict';
import { encodeLoadout, decodeCode, type ShareLoadout } from '../src/run/shareCode';
import { equipmentCatalog, equipmentDocument } from '../src/data/equipmentContent';
import { EQUIPMENT_SLOTS, type EquippedItemRef } from '../src/engine/equipment/types';
import { createRun } from '../src/run/runState';
import { captureGhostFromRun, ghostCodeOf, ghostToBattlePieces, type GhostRecord } from '../src/run/ghost';
import { validateGhostSubmission } from '../src/run/ghostValidate';
import { prepareBattleConfig, resolveBattle, type BattleRequest } from '../src/run/resolveBattle';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok equipment-share ${name}`); }
function refsFor(setId: string): EquippedItemRef[] {
  return EQUIPMENT_SLOTS.map(slot => {
    const entry = equipmentDocument.items.find(item => item.versions[0]!.def.setId === setId && item.versions[0]!.def.slot === slot)!;
    return { instanceId: `audit-${entry.id}`, slot, itemId: entry.id, itemVersion: 1, setVersion: 1 };
  });
}
const base: ShareLoadout = { heroLevel: 1, allocation: [], board: [{ skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null }], bag: [], gems: [] };
check('legacy v1 code remains byte-identical', () => {
  const expected = 'W1-040020000000000H6DYG0000JB2G';
  assert.equal(encodeLoadout(base), expected);
  assert.equal(encodeLoadout({ ...base, equipment: [] }), expected);
  assert.equal(decodeCode(expected).loadout.equipment, undefined);
  assert.equal(encodeLoadout(decodeCode(expected).loadout), expected);
});
for (const set of equipmentDocument.sets) check(`${set.id} pinned v2 round trip`, () => {
  const equipment = refsFor(set.id);
  const input = { ...base, equipment };
  const copy = JSON.stringify(input);
  const code = encodeLoadout(input), decoded = decodeCode(code);
  assert.equal(JSON.stringify(input), copy);
  assert.equal(decoded.loadout.equipment!.length, 3);
  assert.deepEqual(decoded.loadout.equipment!.map(({ instanceId: _id, ...ref }) => ref), equipment.map(({ instanceId: _id, ...ref }) => ref));
  assert.equal(encodeLoadout(decoded.loadout), code);
  assert.equal(encodeLoadout({ ...base, equipment: [...equipment].reverse() }), code);
  assert.deepEqual(decoded.report, { unknownCards: 0, unknownGems: 0, clamped: [] });
});
check('standalone gear has no fabricated set pin', () => {
  const item = equipmentDocument.items.find(entry => entry.versions[0]!.def.setId === undefined)!;
  const equipment: EquippedItemRef[] = [{ instanceId: 'single', slot: item.versions[0]!.def.slot, itemId: item.id, itemVersion: 1 }];
  assert.equal(decodeCode(encodeLoadout({ ...base, equipment })).loadout.equipment![0]!.setVersion, undefined);
});
check('malformed gear references and damaged framing reject', () => {
  const refs = refsFor('restorer');
  for (const bad of [[refs[0], refs[0]], [{ ...refs[0], slot: 'accessory' }], [{ ...refs[0], itemId: 'missing' }],
    [{ ...refs[0], itemVersion: 2 }], [{ ...refs[0], setVersion: 2 }], [{ ...refs[0], itemVersion: 0 }],
    [{ ...refs[0], statMods: { attack: 1000 } }]]) assert.throws(() => encodeLoadout({ ...base, equipment: bad as EquippedItemRef[] }));
  const code = encodeLoadout({ ...base, equipment: refs });
  assert.throws(() => decodeCode(`${code}0`));
  assert.throws(() => decodeCode(`${code.slice(0, -2)}00`));
});
check('ghost capture, submission normalization and battle preserve gear power once', () => {
  const run = createRun(5);
  run.pieces = [0, 1, 2].map(slot => ({ instanceId: `card-${slot}`, skillId: 'second_wind', tier: 'bronze', slot }));
  run.equippedEquipment = refsFor('restorer');
  const captured = captureGhostFromRun(run);
  assert.equal(captured.equipment!.length, 3);
  const submission = validateGhostSubmission({ code: ghostCodeOf(run), displayName: 'Audit', fightNumber: 10, ownerLocalId: 'audit-local' });
  assert(submission.ok);
  assert.equal(decodeCode(submission.record.code).loadout.equipment!.length, 3);
  const record: GhostRecord = { ...submission.record, id: 'audit-ghost', createdAt: 0 };
  const ghost = ghostToBattlePieces(record);
  const request: BattleRequest = { pieces: run.pieces, heroLevel: run.heroLevel, heroAllocation: run.heroAllocation,
    heroEquipment: run.equippedEquipment, foes: [{ enemyId: 'bandit_duelist', level: 1, rank: 0, title: 'normal', ghost }], seed: 5 };
  const config = prepareBattleConfig(request), hero = config.playerTeam![0]!, foe = config.enemyTeam![0]!;
  assert.deepEqual(hero.stats, foe.stats);
  assert.deepEqual(hero.equipment!.effectMods, foe.equipment!.effectMods);
  assert.equal(foe.equipment!.effectMods.outgoingHealPct, 20);
  const receipts = resolveBattle(request).events.filter(event => event.kind === 'equipmentSetup');
  assert.equal(receipts.length, 2);
  assert.equal(equipmentCatalog.set('restorer', 1).name, 'Restorer');
});
console.log(`equipment share audit OK (${checks} checks)`);
