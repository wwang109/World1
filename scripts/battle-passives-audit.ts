import assert from 'node:assert/strict';
import { BASE_HERO_STATS } from '../src/data/heroes';
import { skillBook } from '../src/data/skills';
import { gemBook } from '../src/data/gems';
import { resolveEffectiveSkill } from '../src/engine/cards';
import { simulate } from '../src/engine/combat/simulate';
import { preparePassives } from '../src/engine/passives/prepare';
import { validatePassiveRecipe } from '../src/engine/passives/validate';
import { weightOf, type CombatantSetup } from '../src/engine/types';
import type { PassiveRecipe } from '../src/engine/passives/types';
import { battlePassiveFixture, BATTLE_PASSIVE_FIXTURES } from './battle-passives-fixtures';
import { resolveBattle } from '../src/run/resolveBattle';
import { initCombatState } from '../src/engine/combat/state';
import { scanCast } from '../src/engine/combat/castSelect';

let checks = 0;
function check(name: string, run: () => void): void {
  run(); checks += 1; console.log(`ok battle-passives ${name}`);
}
const base: CombatantSetup = { name: 'Audit Hero', stats: { ...BASE_HERO_STATS }, boardSize: 10, pieces: [] };
const foe: CombatantSetup = { name: 'Audit Foe', stats: { ...BASE_HERO_STATS, maxHp: 300, hp: 300 }, boardSize: 2, pieces: [{ skillId: 'sword_slash', slot: 0 }] };
const fixture = (name = 'slot_shield') => battlePassiveFixture(name, structuredClone(base));
const battle = (setup: CombatantSetup) => simulate({ playerTeam: [setup], enemyTeam: [foe], skillBook }, 5);
function editEffect(setup: CombatantSetup, change: (effect: PassiveRecipe['sources'][number]['effects'][number]) => void): CombatantSetup {
  const copy = structuredClone(setup);
  const effects = copy.passives!.sources[0]!.effects;
  effects.forEach(change);
  return copy;
}
function activeSetup(setup: CombatantSetup): number { return preparePassives(setup, skillBook).setupEffects.length; }
function initialCastWeight(setup: CombatantSetup): number {
  const state = initCombatState({ playerTeam: [setup], enemyTeam: [foe], skillBook });
  const scan = scanCast(state.player, skillBook, { currentTurn: 1, cooldownsEnabled: true });
  assert(scan.kind === 'choice'); return scan.choice.weight;
}
function resolvedShieldPower(setup: CombatantSetup, at = 0): number {
  const piece = setup.pieces[at]!;
  return resolveEffectiveSkill(skillBook[piece.skillId]!, piece).effects.find((action) => action.kind === 'shield')!.power;
}

check('closed fixtures and strict recipe acceptance', () => {
  assert.throws(() => fixture('arbitrary_payload'), /FIGHT_PASSIVES_FIXTURE/);
  for (const name of BATTLE_PASSIVE_FIXTURES) {
    const setup = fixture(name);
    if (setup.passives !== undefined) assert.deepEqual(validatePassiveRecipe(setup.passives), setup.passives);
  }
});
check('absent and empty recipes preserve events and state', () => {
  const absent = fixture('off');
  const empty = { ...absent, passives: { schemaVersion: 1 as const, sources: [] } };
  assert.deepEqual(battle(empty), battle(absent));
  const noRefs = { ...absent, pieces: absent.pieces.map(({ pieceRef: _ref, ...piece }) => piece) };
  assert.deepEqual(battle(absent), battle(noRefs));
});
check('static slot condition on, off, moved, and unassigned', () => {
  assert.equal(activeSetup(fixture()), 1);
  assert.equal(activeSetup(fixture('off')), 0);
  assert.equal(activeSetup(fixture('slot_moved')), 0);
  assert.equal(activeSetup(fixture('selected_card')), 1);
  assert.equal(activeSetup(fixture('selected_slot')), 1);
  assert.equal(activeSetup(fixture('missing_target')), 0);
});
check('anchor differs from occupied cell on multisize card', () => {
  const occupies = editEffect(fixture(), (effect) => { effect.conditions = { occupiesSlot: 1 }; });
  const wrongAnchor = editEffect(fixture(), (effect) => { effect.conditions = { anchorSlot: 1 }; });
  assert.equal(activeSetup(occupies), 1);
  assert.equal(activeSetup(wrongAnchor), 0);
  const sizeThree = structuredClone(skillBook);
  sizeThree['iron_bulwark'] = { ...sizeThree['iron_bulwark']!, size: 3 };
  const wide = fixture(); wide.pieces[1]!.slot = 3;
  wide.passives = editEffect(wide, (effect) => { effect.conditions = { occupiesSlot: 2 }; }).passives;
  assert.equal(preparePassives(wide, sizeThree).setupEffects.length, 1);
});
check('adjacency uses distinct touching footprints, not gaps or wrap', () => {
  const touching = editEffect(fixture(), (effect) => { effect.conditions = { adjacent: { archetype: 'offense' } }; });
  assert.equal(activeSetup(touching), 1);
  const gap = structuredClone(touching); gap.pieces[1]!.slot = 3;
  assert.equal(activeSetup(gap), 0);
  const edge = structuredClone(touching); edge.pieces[0]!.slot = 8; edge.pieces[1]!.slot = 0;
  assert.equal(activeSetup(edge), 0);
});
check('card identity distinguishes duplicate catalog copies and follows movement', () => {
  const selected = editEffect(fixture('selected_card'), (effect) => { effect.conditions = {}; });
  selected.pieces[1] = { skillId: 'iron_bulwark', slot: 2, pieceRef: 'second-copy' };
  const result = battle(selected);
  const first = result.finalState.player.pieces.find((piece) => piece.slot === 0)!;
  const second = result.finalState.player.pieces.find((piece) => piece.slot === 2)!;
  assert.equal(first.skill.effects.find((action) => action.kind === 'shield')!.power, resolvedShieldPower(selected) + 5);
  assert.equal(second.skill.effects.find((action) => action.kind === 'shield')!.power, resolvedShieldPower(selected, 1));
  const moved = structuredClone(selected); moved.pieces[0]!.slot = 5;
  assert.equal(activeSetup(moved), 1);
  const removed = structuredClone(selected); removed.pieces = removed.pieces.slice(1);
  assert.equal(activeSetup(removed), 0);
});
check('slot binding stays at coordinate and checks its new occupant', () => {
  const selected = editEffect(fixture('selected_slot'), (effect) => { effect.conditions = {}; });
  selected.pieces[0]!.slot = 5;
  assert.equal(activeSetup(selected), 0);
  selected.pieces[1] = { skillId: 'iron_bulwark', slot: 0, pieceRef: 'replacement-copy' };
  assert.equal(activeSetup(selected), 1);
  const interior = editEffect(fixture('selected_slot'), (effect) => { effect.conditions = {}; effect.binding = { slot: 1, match: 'occupies' }; });
  assert.equal(activeSetup(interior), 1);
  const anchorOnly = editEffect(interior, (effect) => { effect.binding = { slot: 1, match: 'anchor' }; });
  assert.equal(activeSetup(anchorOnly), 0);
});
check('recipe validation rejects malformed and unsupported effect contracts', () => {
  const mutations: Array<(recipe: Record<string, any>) => void> = [
    (r) => { r.unknown = true; }, (r) => { r.schemaVersion = 2; },
    (r) => { r.sources[0].source.kind = 'client'; }, (r) => { r.sources[0].source.version = 0; },
    (r) => { r.sources[0].source.version = Number.MAX_SAFE_INTEGER + 1; },
    (r) => { r.sources[0].effects[0].effect.amount = 1.5; },
    (r) => { r.sources[0].effects[0].effect.amount = Number.MAX_SAFE_INTEGER + 1; },
    (r) => { r.sources[0].effects[0].effect.kind = 'effectiveCardTier'; },
    (r) => { r.sources[0].effects[0].conditions.anchorSlot = -1; },
    (r) => { r.sources[0].effects[0].targetBinding = 'playerCard'; r.sources[0].effects[0].binding = { slot: 0 }; },
    (r) => { r.sources[0].effects[0].binding = { pieceRef: 'fixture-ward' }; },
    (r) => { r.sources[0].effects[0].targetBinding = 'playerCard'; r.sources[0].effects[0].binding = { pieceRef: 1 }; },
    (r) => { r.sources[0].effects[0].selector = { unknown: 'physical' }; },
    (r) => { r.sources[0].effects[0].effect.property = 'untyped'; },
    (r) => { r.sources.push(r.sources[0]); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(fixture().passives!) as unknown as Record<string, any>;
    mutate(copy); assert.throws(() => validatePassiveRecipe(copy));
  }
});
check('duplicate piece references and invalid board coordinates rejected', () => {
  const duplicate = fixture(); duplicate.pieces[1]!.pieceRef = duplicate.pieces[0]!.pieceRef;
  assert.throws(() => preparePassives(duplicate, skillBook));
  const outside = editEffect(fixture('selected_slot'), (effect) => { effect.binding = { slot: 10 }; });
  assert.throws(() => preparePassives(outside, skillBook));
  const malformed = fixture(); malformed.pieces[0]!.pieceRef = 1 as unknown as string;
  assert.throws(() => preparePassives(malformed, skillBook));
  const overlap = fixture(); overlap.pieces[1]!.slot = 1;
  assert.throws(() => preparePassives(overlap, skillBook));
  const unknown = fixture(); unknown.pieces[0]!.skillId = 'missing_card';
  assert.throws(() => preparePassives(unknown, skillBook));
  const fractional = fixture(); fractional.pieces[0]!.slot = 0.5;
  assert.throws(() => preparePassives(fractional, skillBook));
});
check('input immutability and canonical source order', () => {
  const setup = fixture();
  const recipe = setup.passives!;
  const second = structuredClone(recipe.sources[0]!); second.source.id = 'aaa_fixture';
  setup.passives = { schemaVersion: 1, sources: [recipe.sources[0]!, second] };
  const before = structuredClone(setup);
  const prepared = preparePassives(setup, skillBook);
  const result = battle(setup);
  assert.deepEqual(setup, before);
  const reverse = structuredClone(setup); reverse.passives = { schemaVersion: 1, sources: [...setup.passives.sources].reverse() };
  assert.deepEqual(preparePassives(reverse, skillBook), prepared);
  assert.deepEqual(battle(reverse), result);
});
check('combined modifier and derived action overflow rejected', () => {
  const huge = editEffect(fixture(), (effect) => {
    if (effect.effect.kind === 'cardShieldPower') effect.effect.amount = Number.MAX_SAFE_INTEGER;
  });
  assert.throws(() => battle(huge), /overflow/);
  const recipe = huge.passives!;
  const second = structuredClone(recipe.sources[0]!); second.source.id = 'second_fixture';
  huge.passives = { schemaVersion: 1, sources: [recipe.sources[0]!, second] };
  assert.throws(() => preparePassives(huge, skillBook), /overflow/);
});
check('authored card boost does not modify or fold gem actions twice', () => {
  const setup = fixture(); setup.pieces[0]!.gem = gemBook['iron_bulwark_echo']!;
  const result = battle(setup);
  const skill = result.finalState.player.pieces[0]!.skill;
  const shields = skill.effects.filter((action) => action.kind === 'shield');
  assert.equal(shields.length, 2);
  assert.equal(shields[0]!.power, resolvedShieldPower(setup) + 5);
  const gem = gemBook['iron_bulwark_echo']!;
  assert.equal(gem.kind, 'effect');
  const gemShield = gem.kind === 'effect' ? gem.actions.find((action) => action.kind === 'shield') : undefined;
  assert(gemShield);
  assert.equal(shields[1]!.power, gemShield.power);
  assert.equal(shields[0]!.fromGem, undefined);
  assert.equal(shields[1]!.fromGem, true);
  assert.equal(shields[0]!.passiveSources?.length, 1);
  assert.equal(shields[1]!.passiveSources, undefined);
});
check('setup shield is logged at turn zero and determinism is stable', () => {
  const first = battle(fixture()); const second = battle(fixture());
  assert.deepEqual(first, second);
  const startup = first.events.filter((event) => event.kind === 'shieldGain' && event.turn === 0);
  assert.equal(startup.length, 1);
  assert.equal(startup[0]!.kind === 'shieldGain' && startup[0]!.amount, 8);
  assert.equal(startup[0]!.kind === 'shieldGain' && startup[0]!.sourcePassive?.effectId, 'opening_shield');
  assert(first.events.some((event) => event.kind === 'shieldGain' && event.turn > 0 && event.passiveSources?.some((source) => source.effectId === 'card_shield')));
  assert.equal(first.events[0]!.kind, 'preBattleEffect');
});
check('range summaries preserve structured conditions and use human slot numbers', () => {
  const setup = fixture('slot_range');
  const summaries = battle(setup).events.filter((event) => event.kind === 'preBattleEffect');
  assert.equal(summaries.length, 2);
  for (const summary of summaries) {
    assert.equal(summary.active, true);
    assert.deepEqual(summary.slotRange, { min: 1, max: 2, match: 'occupies' });
    assert.match(summary.conditionsText, /Slots 2–3/);
    assert.match(summary.displayText, /\[relic\] fixture ward: Active/);
    assert.deepEqual(summary.targetSlots, [0]);
    assert.equal(summary.targets[0]!.size, 2);
  }
  const inactive = editEffect(setup, (effect) => { effect.conditions = { slotRange: { min: 4, max: 5 } }; });
  assert(battle(inactive).events.filter((event) => event.kind === 'preBattleEffect').every((event) => !event.active && /Conditions unmet/.test(event.displayText)));
  for (const range of [{ min: 3, max: 2 }, { min: 0, max: 10 }, { min: 0.5, max: 2 }]) {
    assert.throws(() => preparePassives(editEffect(setup, (effect) => { effect.conditions = { slotRange: range }; }), skillBook));
  }
});
check('trusted battle response carries one generated summary per effect', () => {
  const setup = fixture('slot_range');
  const request = { pieces: setup.pieces, heroLevel: 1, heroAllocation: {}, foes: [{ enemyId: 'bandit_duelist', level: 1, title: 'normal' as const, rank: 0 }], seed: 5 };
  const log = resolveBattle(request, { heroPassives: setup.passives });
  const summaries = log.events.filter((event) => event.kind === 'preBattleEffect');
  assert.equal(summaries.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(summaries)), summaries);
  assert.deepEqual(resolveBattle(request, { heroPassives: setup.passives }), log);
  assert.equal(resolveBattle({ ...request, heroPassives: setup.passives } as typeof request).events.filter((event) => event.kind === 'preBattleEffect').length, 0);
  assert.equal(log.events.filter((event) => event.kind === 'shieldGain' && event.turn === 0).length, 1);
});
check('prepared WT changes match actual casts and payment for either source kind', () => {
  for (const name of ['weight', 'weight_talent']) {
    const setup = fixture(name); const result = battle(setup);
    const expected = initialCastWeight(fixture('weight_off')) - 3;
    assert.equal(initialCastWeight(setup), expected);
    const receipt = result.events.find(event => event.kind === 'preBattleEffect')!;
    assert.equal(receipt.kind, 'preBattleEffect');
    if (receipt.kind !== 'preBattleEffect') return;
    assert.equal(receipt.changes.length, 1);
    assert.deepEqual(receipt.changes.map(({field,before,after,slot,stage,basis}) => ({field,before,after,slot,stage,basis})), [{field:'weight',before:expected+3,after:expected,slot:0,stage:'prepared',basis:'castWeightWithoutTransientTaxes'}]);
    assert.match(receipt.displayText, new RegExp(`WT ${expected+3}→${expected}`));
    for (const [i,event] of result.events.entries()) {
      if (event.kind !== 'play' || event.side !== 'player' || event.slot !== 0) continue;
      assert.equal(event.weight, expected);
      const paid = result.events.slice(i+1).find(next => next.kind === 'cost' && next.side === event.side && next.unit === event.unit);
      assert(paid?.kind === 'cost'); assert.equal(paid.paid, expected);
    }
  }
  assert.deepEqual(battle(fixture('weight')), battle(fixture('weight')));
  const moved = battle(fixture('weight_moved'));
  assert(moved.events.some(event => event.kind === 'preBattleEffect' && !event.active && event.changes.length === 0));
  assert.equal(weightOf(moved.finalState.player.pieces.find(piece => piece.slot === 2)!.skill), weightOf(skillBook['iron_bulwark']!));
});
check('board counts distinct eligible instances, not occupied cells or catalog ids', () => {
  const setup = editEffect(fixture('weight'), effect => { effect.conditions = { boardCount: {selector:{archetype:'defensive'},min:2,max:2} }; });
  assert.equal(preparePassives(setup,skillBook).receipts[0]!.active, false);
  setup.pieces.push({skillId:'iron_bulwark',slot:4,pieceRef:'duplicate-defensive'});
  assert.equal(preparePassives(setup,skillBook).receipts[0]!.active, true);
  setup.pieces.push({skillId:'iron_bulwark',slot:6,pieceRef:'third-defensive'});
  assert.equal(preparePassives(setup,skillBook).receipts[0]!.active, false);
  for (const count of [{min:-1},{min:1.5},{min:2,max:1},{min:1,max:Number.MAX_SAFE_INTEGER+1}]) {
    assert.throws(() => validatePassiveRecipe(editEffect(fixture('weight'), effect => { effect.conditions = {boardCount:count}; }).passives));
  }
});
check('WT stacking is canonical, gem folds once, and positive taxes precede floor', () => {
  const setup = fixture('weight'); setup.pieces[0]!.gem = gemBook['lightweight_core']!;
  const baseline = fixture('weight_off'); baseline.pieces[0]!.gem = gemBook['lightweight_core']!;
  const controlWeight = initialCastWeight(baseline);
  assert.equal(initialCastWeight(setup), controlWeight-3);
  const first = setup.passives!.sources[0]!; const second = structuredClone(first); second.source.id='aaa-modifier'; second.effects[0]!.effect.amount=4;
  setup.passives={schemaVersion:1,sources:[first,second]};
  const result = battle(setup); const changes = result.events.filter(event=>event.kind==='preBattleEffect').flatMap(event=>event.changes.filter(change=>change.field==='weight'));
  assert.equal(changes[0]!.before,controlWeight); assert.equal(changes[1]!.before,changes[0]!.after);
  assert.equal(changes[1]!.after,controlWeight-7);
  const reversed = structuredClone(setup); reversed.passives={schemaVersion:1,sources:[...setup.passives.sources].reverse()};
  assert.deepEqual(battle(reversed),result);
  const floor = editEffect(fixture('weight'),effect=>{effect.effect.amount=22;});
  const state=initCombatState({playerTeam:[floor],enemyTeam:[foe],skillBook});
  state.player.nextWeightPenalty=4; state.player.pieces[0]!.nextWeightPenalty=5;
  const scan=scanCast(state.player,skillBook,{currentTurn:1,cooldownsEnabled:true});
  assert.equal(scan.kind,'choice');
  assert(scan.kind==='choice'); assert.equal(scan.choice.weight,7);
  const receipt=preparePassives(floor,skillBook).receipts[0]!;
  assert.equal(receipt.changes[0]!.after,1); assert.equal(receipt.changes[0]!.rawAfter,-2);
  assert.equal(state.player.nextWeightPenalty,4); assert.equal(state.player.pieces[0]!.nextWeightPenalty,5);
});
check('versioned source refs resolve only trusted recipes and validated card bindings', () => {
  const setup=editEffect(fixture('weight'),effect=>{effect.targetBinding='playerCard';effect.conditions={};});
  const source=setup.passives!.sources[0]!.source;
  const request={pieces:setup.pieces,heroLevel:1,heroAllocation:{},foes:[{enemyId:'bandit_duelist',level:1,title:'normal' as const,rank:0}],seed:5,preBattle:{schemaVersion:1 as const,sources:[source],bindings:[{source,effectId:'prepared_weight',binding:{pieceRef:'owned-ward'}}]}};
  const preparation={sourceCatalog:setup.passives!.sources,heroPieceRefs:[{slot:0,pieceRef:'owned-ward'},{slot:2,pieceRef:'owned-sword'}]};
  const log=resolveBattle(request,preparation);
  assert(log.events.some(event=>event.kind==='preBattleEffect'&&event.active&&event.targets[0]!.pieceRef==='owned-ward'));
  assert.deepEqual(JSON.parse(JSON.stringify(log)).events.filter((event: {kind:string})=>event.kind==='preBattleEffect'),log.events.filter(event=>event.kind==='preBattleEffect'));
  assert.throws(()=>resolveBattle(request));
  const invalidVersion=structuredClone(request); invalidVersion.preBattle.sources[0]!.version+=1;
  assert.throws(()=>resolveBattle(invalidVersion,preparation));
  assert.throws(()=>resolveBattle({...request,preBattle:{...request.preBattle,effects:setup.passives!.sources[0]!.effects}} as typeof request,preparation));
  assert.throws(()=>resolveBattle(request,{...preparation,heroPieceRefs:[{slot:1,pieceRef:'owned-ward'}]}));
  assert.throws(()=>resolveBattle(request,{...preparation,heroPieceRefs:[{slot:0,pieceRef:'owned-ward'},{slot:2,pieceRef:'owned-ward'}]}));
  assert.throws(()=>resolveBattle(request,{...preparation,heroPassives:setup.passives}));
  const unavailable=structuredClone(request); unavailable.preBattle.bindings[0]!.binding.pieceRef='owned-in-bag';
  assert(resolveBattle(unavailable,preparation).events.some(event=>event.kind==='preBattleEffect'&&!event.active&&event.reason==='target-unavailable'&&event.changes.length===0));
});
console.log(`battle passives audit passed: ${checks} checks`);
