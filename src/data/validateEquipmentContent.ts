import { EQUIPMENT_EFFECT_KEYS, EQUIPMENT_SELECTOR_KEYS, EQUIPMENT_SELECTOR_REGISTRY, EQUIPMENT_STAT_KEYS } from '../engine/equipment/registry';
import { EQUIPMENT_SLOTS, type EquipmentDocument } from '../engine/equipment/types';

export interface EquipmentContentProblem { where: string; message: string }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateEquipmentDocument(input: unknown): EquipmentContentProblem[] {
  const problems: EquipmentContentProblem[] = [];
  const fail = (where: string, message: string) => { problems.push({ where, message }); };
  function object(value: unknown, keys: readonly string[], at: string): value is Record<string, unknown> {
    if (!record(value)) { fail(at, 'expected object'); return false; }
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${at}.${key}`, 'unknown field');
    return true;
  }
  function mods(value: unknown, keys: readonly string[], at: string): void {
    if (!object(value, keys, at)) return;
    if (Object.keys(value).length === 0) fail(at, 'modifier map must not be empty');
    for (const [key, n] of Object.entries(value)) if (!Number.isSafeInteger(n) || (n as number) <= 0) fail(`${at}.${key}`, 'expected positive safe integer');
  }
  if (!object(input, ['schemaVersion', 'status', 'notes', 'items', 'sets'], '$')) return problems;
  if (input.schemaVersion !== 1) fail('schemaVersion', 'expected 1');
  if (typeof input.status !== 'string' || !input.status) fail('status', 'expected nonempty string');
  if (!Array.isArray(input.notes) || !input.notes.every((n) => typeof n === 'string')) fail('notes', 'expected strings');
  const itemRefs: { setId: string; slot: string; at: string }[] = [];
  const setIds = new Set<string>();
  function entries(value: unknown, kind: 'items' | 'sets'): void {
    if (!Array.isArray(value) || value.length === 0) { fail(kind, 'expected nonempty array'); return; }
    const ids = new Set<string>();
    value.forEach((entry: unknown, i) => {
      const at = `${kind}[${i}]`;
      if (!object(entry, ['id', 'versions'], at)) return;
      if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(entry.id)) fail(`${at}.id`, 'expected stable snake_case id');
      else {
        if (ids.has(entry.id)) fail(`${at}.id`, 'duplicate id');
        ids.add(entry.id);
        if (kind === 'sets') setIds.add(entry.id);
      }
      if (!Array.isArray(entry.versions) || entry.versions.length === 0) { fail(`${at}.versions`, 'expected nonempty array'); return; }
      const versions = new Set<number>();
      entry.versions.forEach((version: unknown, j) => {
        const path = `${at}.versions[${j}]`;
        if (!object(version, ['version', 'def'], path)) return;
        if (!Number.isSafeInteger(version.version) || (version.version as number) <= 0) fail(`${path}.version`, 'expected positive safe integer');
        else {
          if (versions.has(version.version as number)) fail(`${path}.version`, 'duplicate version');
          versions.add(version.version as number);
        }
        const def = version.def;
        const defAt = `${path}.def`;
        if (!object(def, kind === 'items' ? ['name', 'slot', 'setId', 'statMods', 'dropEligibility'] : ['name', 'boardRequirement', 'bonuses'], defAt)) return;
        if (typeof def.name !== 'string' || !def.name.trim()) fail(`${defAt}.name`, 'expected nonempty name');
        if (kind === 'items') {
          if (!EQUIPMENT_SLOTS.includes(def.slot as typeof EQUIPMENT_SLOTS[number])) fail(`${defAt}.slot`, 'unsupported slot');
          mods(def.statMods, EQUIPMENT_STAT_KEYS, `${defAt}.statMods`);
          if (def.setId !== undefined) {
            if (typeof def.setId !== 'string') fail(`${defAt}.setId`, 'expected set id');
            else itemRefs.push({ setId: def.setId, slot: String(def.slot), at: defAt });
          }
          if (object(def.dropEligibility, ['sourceKinds'], `${defAt}.dropEligibility`)) {
            const sources = def.dropEligibility.sourceKinds;
            if (!Array.isArray(sources) || !sources.length || new Set(sources).size !== sources.length || sources.some((s) => s !== 'fight' && s !== 'event')) fail(`${defAt}.dropEligibility.sourceKinds`, 'expected distinct fight/event kinds');
          }
        } else {
          if (object(def.boardRequirement, ['source', 'minCount', 'match'], `${defAt}.boardRequirement`)) {
            const requirement = def.boardRequirement;
            if (requirement.source !== 'active_equipped_board_card_instances') fail(`${defAt}.boardRequirement.source`, 'unsupported source');
            if (!Number.isSafeInteger(requirement.minCount) || (requirement.minCount as number) <= 0) fail(`${defAt}.boardRequirement.minCount`, 'expected positive safe integer');
            if (object(requirement.match, EQUIPMENT_SELECTOR_KEYS, `${defAt}.boardRequirement.match`)) {
              if (!Object.keys(requirement.match).length) fail(`${defAt}.boardRequirement.match`, 'expected at least one selector');
              for (const key of EQUIPMENT_SELECTOR_KEYS) {
                const selected = requirement.match[key];
                if (selected !== undefined && !EQUIPMENT_SELECTOR_REGISTRY[key].values.some((v) => v === selected)) fail(`${defAt}.boardRequirement.match.${key}`, 'unsupported selector value');
              }
            }
          }
          if (!Array.isArray(def.bonuses) || def.bonuses.length !== 2) fail(`${defAt}.bonuses`, 'expected ordered 2-piece and 3-piece bonuses');
          else def.bonuses.forEach((bonus: unknown, k) => {
            const bonusAt = `${defAt}.bonuses[${k}]`;
            if (!object(bonus, ['pieces', 'statMods', 'effectMods'], bonusAt)) return;
            if (bonus.pieces !== k + 2) fail(`${bonusAt}.pieces`, 'expected ascending 2, 3 thresholds');
            if (bonus.statMods === undefined && bonus.effectMods === undefined) fail(bonusAt, 'expected modifiers');
            if (bonus.statMods !== undefined) mods(bonus.statMods, EQUIPMENT_STAT_KEYS, `${bonusAt}.statMods`);
            if (bonus.effectMods !== undefined) mods(bonus.effectMods, EQUIPMENT_EFFECT_KEYS, `${bonusAt}.effectMods`);
          });
        }
      });
    });
  }
  entries(input.sets, 'sets');
  entries(input.items, 'items');
  for (const ref of itemRefs) if (!setIds.has(ref.setId)) fail(`${ref.at}.setId`, 'unknown set reference');
  for (const setId of setIds) for (const slot of EQUIPMENT_SLOTS) {
    if (!itemRefs.some((r) => r.setId === setId && r.slot === slot)) fail(`sets.${setId}`, `missing ${slot} item`);
  }
  return problems;
}

export function assertEquipmentDocument(input: unknown): asserts input is EquipmentDocument {
  const problems = validateEquipmentDocument(input);
  if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.message}`).join('\n'));
}
