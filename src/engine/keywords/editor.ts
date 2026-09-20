import {
  MAX_CARD_SIZE,
  MAX_COOLDOWN_TURNS,
  MAX_EXPOSE_PCT,
  MAX_GUARD_PCT,
  MAX_STUN_PER_CARD,
  WEIGHT_MAX_BY_SIZE,
  WEIGHT_MIN,
  KEYWORD_PRICING,
  capViolations,
  powerLevelBreakdown,
  powerLevelDeci,
} from '../balance';
import type { CapFamily } from './pricing';
import { KEYWORD_TEXT } from './text';
import {
  BASELINE_COOLDOWN,
  MAX_NEGATE_CHARGES,
  MAX_WARD_CHARGES,
  TIER_ORDER,
  type Action,
  type Archetype,
  type AuraDef,
  type BuffableStat,
  type Element,
  type ExploitableStatus,
  type Property,
  type Rarity,
  type SkillDef,
  type SkillSize,
  type SkillTier,
  type StackedStatus,
  type TierUpgrade,
  type WeaponType,
} from '../types';

export interface EditableField {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  floor: number;
  unbounded?: true;
}

export interface SelectorField {
  key: string;
  label: string;
  source: string;
  options: readonly string[];
  default: string;
}

export interface FlagField {
  key: string;
  label: string;
  source: string;
}

export interface KeywordEditor {
  kind: Action['kind'];
  label: string;
  capFamily: CapFamily | null;
  isHit: boolean;
  offensive: boolean;
  fields: readonly EditableField[];
  selectors: readonly SelectorField[];
  flags: readonly FlagField[];
  needsProperty: boolean;
  needsTargetStat: boolean;
}

export type KeywordEditorTable = { readonly [K in Action['kind']]: KeywordEditor };

function exhaustive<T extends string>() {
  return <L extends readonly T[]>(
    list: L & (Exclude<T, L[number]> extends never ? unknown : readonly ['missing', Exclude<T, L[number]>]),
  ): readonly T[] => list;
}

export const PROPERTY_OPTIONS = exhaustive<Property>()(['physical', 'magical', 'true'] as const);
export const ARCHETYPE_OPTIONS = exhaustive<Archetype>()(['offense', 'defensive', 'healing', 'support', 'debuff'] as const);
export const ELEMENT_OPTIONS = exhaustive<Element>()(['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'] as const);
export const WEAPON_OPTIONS = exhaustive<WeaponType>()(['sword', 'axe', 'lance', 'bow', 'beast'] as const);
export const RARITY_OPTIONS = exhaustive<Rarity>()(['common', 'rare', 'epic', 'legendary'] as const);
export const BUFFABLE_STAT_OPTIONS = exhaustive<BuffableStat>()(['attack', 'magicPower', 'armor', 'magicResist', 'speed'] as const);
export const EXPLOITABLE_STATUS_OPTIONS = exhaustive<ExploitableStatus>()(['poison', 'burn', 'bleed', 'stun', 'debuff', 'expose'] as const);
export const STACKED_STATUS_OPTIONS = exhaustive<StackedStatus>()(['poison', 'burn', 'bleed', 'thorns', 'burden'] as const);
export const SCOPE_OPTIONS = exhaustive<'one' | 'all'>()(['one', 'all'] as const);
export const AURA_AFFECTS_OPTIONS = exhaustive<AuraDef['affects']>()(['adjacent', 'left', 'right', 'allBoard'] as const);
export const STACK_SOURCE_OPTIONS = exhaustive<'caster' | 'target'>()(['caster', 'target'] as const);
export const TIER_OPTIONS = exhaustive<SkillTier>()(['bronze', 'silver', 'gold', 'diamond'] as const);
export const UPGRADE_TIER_OPTIONS = exhaustive<Exclude<SkillTier, 'bronze'>>()(['silver', 'gold', 'diamond'] as const);
export const CARD_TYPE_OPTIONS: readonly string[] = [...WEAPON_OPTIONS, ...ELEMENT_OPTIONS];
export const TIER_LADDER: readonly SkillTier[] = TIER_ORDER;

interface FieldSpec {
  key: string;
  floor: number;
  hardMax: number;
  seed: number;
  unbounded?: true;
}

interface KeywordSpec {
  fields: readonly FieldSpec[];
  selectors?: readonly SelectorField[];
  flags?: readonly FlagField[];
}

const AUTHOR_CEILING = 999;
const TURN_CEILING = 99;

const propertySelector = (fallback: Property): SelectorField =>
  ({ key: 'property', label: 'property', source: 'Property', options: PROPERTY_OPTIONS, default: fallback });
const statSelector = (fallback: BuffableStat): SelectorField =>
  ({ key: 'stat', label: 'stat', source: 'BuffableStat', options: BUFFABLE_STAT_OPTIONS, default: fallback });

const SPEC: { readonly [K in Action['kind']]: KeywordSpec } = {
  damage: { fields: [{ key: 'power', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  statStrike: {
    fields: [
      { key: 'shareOf', floor: 1, hardMax: AUTHOR_CEILING, seed: 2, unbounded: true },
      { key: 'cap', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 },
    ],
    flags: [{ key: 'echoHostPower', label: 'echoHostPower', source: 'true' }],
  },
  heal: { fields: [{ key: 'power', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  shield: { fields: [{ key: 'power', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  attunedShield: { fields: [{ key: 'power', floor: 1, hardMax: AUTHOR_CEILING, seed: 1 }] },
  poison: { fields: [{ key: 'stacks', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  burn: { fields: [{ key: 'stacks', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  bleed: { fields: [{ key: 'stacks', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  thorns: { fields: [{ key: 'stacks', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  stun: { fields: [{ key: 'turns', floor: 0, hardMax: MAX_STUN_PER_CARD, seed: 1 }] },
  buffStat: {
    fields: [
      { key: 'pct', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 },
      { key: 'turns', floor: 0, hardMax: TURN_CEILING, seed: 2 },
    ],
    selectors: [statSelector('attack')],
  },
  debuffStat: {
    fields: [
      { key: 'pct', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 },
      { key: 'turns', floor: 0, hardMax: TURN_CEILING, seed: 2 },
    ],
    selectors: [statSelector('armor')],
  },
  expose: {
    fields: [
      { key: 'pct', floor: 1, hardMax: MAX_EXPOSE_PCT, seed: 0 },
      { key: 'turns', floor: 1, hardMax: TURN_CEILING, seed: 2 },
    ],
  },
  guard: {
    fields: [
      { key: 'pct', floor: 0, hardMax: MAX_GUARD_PCT, seed: 0 },
      { key: 'turns', floor: 0, hardMax: TURN_CEILING, seed: 2 },
    ],
    selectors: [propertySelector('physical')],
  },
  negate: {
    fields: [{ key: 'charges', floor: 0, hardMax: MAX_NEGATE_CHARGES, seed: 1 }],
    selectors: [propertySelector('physical')],
  },
  ward: { fields: [{ key: 'charges', floor: 0, hardMax: MAX_WARD_CHARGES, seed: 0 }] },
  cleanse: { fields: [{ key: 'charges', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  taunt: { fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  slow: { fields: [{ key: 'weight', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  burden: { fields: [{ key: 'weight', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  curse: {
    fields: [
      { key: 'amount', floor: 1, hardMax: AUTHOR_CEILING, seed: 0 },
      { key: 'turns', floor: 1, hardMax: TURN_CEILING, seed: 1 },
    ],
  },
  splash: { fields: [] },
  disrupt: { fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  lifesteal: { fields: [{ key: 'pct', floor: 0, hardMax: 1000, seed: 0 }] },
  shieldBreak: {
    fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }],
    flags: [{ key: 'shattersAttuned', label: 'shattersAttuned', source: 'true' }],
  },
  comboBonus: { fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  chainBonus: {
    fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }],
    selectors: [{ key: 'after', label: 'after', source: 'Element | WeaponType', options: CARD_TYPE_OPTIONS, default: 'sword' }],
  },
  empowerNext: { fields: [{ key: 'amount', floor: 1, hardMax: AUTHOR_CEILING, seed: 1 }] },
  exploit: {
    fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }],
    selectors: [{ key: 'status', label: 'status', source: 'ExploitableStatus', options: EXPLOITABLE_STATUS_OPTIONS, default: 'poison' }],
  },
  stackBonus: {
    fields: [
      { key: 'per', floor: 1, hardMax: AUTHOR_CEILING, seed: 1, unbounded: true },
      { key: 'cap', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 },
    ],
    selectors: [
      { key: 'status', label: 'status', source: 'StackedStatus', options: STACKED_STATUS_OPTIONS, default: 'poison' },
      { key: 'of', label: 'of', source: "'caster' | 'target'", options: STACK_SOURCE_OPTIONS, default: 'caster' },
    ],
  },
  shieldBurst: { fields: [{ key: 'cap', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  wardRelease: {
    fields: [
      { key: 'per', floor: 1, hardMax: AUTHOR_CEILING, seed: 1, unbounded: true },
      { key: 'cap', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 },
    ],
  },
  desperation: { fields: [{ key: 'amount', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  overhealShield: { fields: [{ key: 'cap', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 }] },
  cleanseConvert: {
    fields: [
      { key: 'per', floor: 1, hardMax: AUTHOR_CEILING, seed: 1, unbounded: true },
      { key: 'cap', floor: 0, hardMax: AUTHOR_CEILING, seed: 0 },
    ],
  },
};

const ACTION_KINDS = Object.keys(SPEC) as Action['kind'][];

export interface EditorContext {
  property?: Property;
  size?: SkillSize;
  tier?: SkillTier;
  scope?: 'one' | 'all';
  values?: Readonly<Record<string, number>>;
  flags?: Readonly<Record<string, boolean>>;
}

function propertiesOf(ctx: EditorContext): readonly Property[] {
  return ctx.property === undefined ? PROPERTY_OPTIONS : [ctx.property];
}

function selectorValue(kind: Action['kind'], selector: SelectorField, ctx: EditorContext): string {
  if (selector.key === 'property' && ctx.property !== undefined) {
    return ctx.property === 'physical' ? 'physical' : 'magical';
  }
  void kind;
  return selector.default;
}

export function selectorsFor(kind: Action['kind'], ctx: EditorContext = {}): readonly SelectorField[] {
  const selectors = SPEC[kind].selectors ?? [];
  const out: SelectorField[] = [];
  for (let i = 0; i < selectors.length; i += 1) {
    const s = selectors[i]!;
    out.push({ ...s, default: selectorValue(kind, s, ctx) });
  }
  return out;
}

function probeAction(kind: Action['kind'], values: Record<string, number>, ctx: EditorContext): Action {
  const spec = SPEC[kind];
  const raw: Record<string, unknown> = { kind };
  for (let i = 0; i < spec.fields.length; i += 1) {
    const f = spec.fields[i]!;
    raw[f.key] = values[f.key] ?? f.floor;
  }
  const selectors = spec.selectors ?? [];
  for (let i = 0; i < selectors.length; i += 1) {
    const s = selectors[i]!;
    raw[s.key] = selectorValue(kind, s, ctx);
  }
  const flags = spec.flags ?? [];
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]!;
    if (ctx.flags !== undefined && ctx.flags[flag.key] === true) raw[flag.key] = true;
  }
  return raw as unknown as Action;
}

function probeCard(
  kind: Action['kind'],
  values: Record<string, number>,
  property: Property,
  ctx: EditorContext,
): SkillDef {
  const card: SkillDef = {
    id: '__editorProbe__',
    name: 'editor probe',
    archetypes: ['offense'],
    property,
    size: ctx.size ?? 1,
    rarity: 'common',
    tier: ctx.tier ?? 'bronze',
    effects: [probeAction(kind, values, ctx)],
  };
  return ctx.scope === undefined ? card : { ...card, scope: ctx.scope };
}

function actionPartDeci(kind: Action['kind'], values: Record<string, number>, property: Property, ctx: EditorContext): number {
  const parts = powerLevelBreakdown(probeCard(kind, values, property, ctx));
  let deci = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (part.label === kind) deci += part.deci;
  }
  return deci;
}

function wholePl(kind: Action['kind'], values: Record<string, number>, ctx: EditorContext): boolean {
  const properties = propertiesOf(ctx);
  for (let i = 0; i < properties.length; i += 1) {
    if (actionPartDeci(kind, values, properties[i]!, ctx) % 10 !== 0) return false;
  }
  return true;
}

function capClean(kind: Action['kind'], values: Record<string, number>, ctx: EditorContext): boolean {
  const properties = propertiesOf(ctx);
  for (let i = 0; i < properties.length; i += 1) {
    if (capViolations(probeCard(kind, values, properties[i]!, ctx)).length > 0) return false;
  }
  return true;
}

const ANCHOR_SEARCH_LIMIT = 400;
const STEP_SEARCH_LIMIT = 40;

const anchorMemo = new Map<Action['kind'], Readonly<Record<string, number>>>();

function anchorValues(kind: Action['kind']): Readonly<Record<string, number>> {
  const cached = anchorMemo.get(kind);
  if (cached !== undefined) return cached;
  const specs = SPEC[kind].fields;
  const values: Record<string, number> = {};
  for (let i = 0; i < specs.length; i += 1) {
    const f = specs[i]!;
    values[f.key] = Math.max(f.seed, f.floor);
  }
  for (let pass = 0; pass < 3; pass += 1) {
    if (wholePl(kind, values, {})) break;
    for (let i = 0; i < specs.length; i += 1) {
      const f = specs[i]!;
      const start = values[f.key]!;
      const ceiling = Math.min(f.hardMax, start + ANCHOR_SEARCH_LIMIT);
      for (let v = start; v <= ceiling; v += 1) {
        if (wholePl(kind, { ...values, [f.key]: v }, {})) { values[f.key] = v; break; }
      }
    }
  }
  anchorMemo.set(kind, values);
  return values;
}

function capMaxFor(kind: Action['kind'], field: FieldSpec, anchor: number, siblings: Record<string, number>, ctx: EditorContext): number {
  if (!capClean(kind, { ...siblings, [field.key]: anchor }, ctx)) return anchor;
  let lo = anchor;
  let hi = field.hardMax;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (capClean(kind, { ...siblings, [field.key]: mid }, ctx)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function stepFor(
  kind: Action['kind'],
  field: FieldSpec,
  anchor: number,
  capMax: number,
  siblings: Record<string, number>,
  ctx: EditorContext,
): number {
  for (let s = 1; s <= STEP_SEARCH_LIMIT; s += 1) {
    if (anchor + s > capMax) break;
    let ok = true;
    for (let v = anchor + s; v <= capMax && ok; v += s) {
      if (!wholePl(kind, { ...siblings, [field.key]: v }, ctx)) ok = false;
    }
    if (ok) return s;
  }
  return 1;
}

function onLadder(anchor: number, step: number, value: number, max: number): number {
  if (value <= anchor) return anchor;
  const snapped = anchor + Math.ceil((value - anchor) / step) * step;
  return snapped > max ? max : snapped;
}

export function editableFieldsFor(kind: Action['kind'], ctx: EditorContext = {}): readonly EditableField[] {
  const specs = SPEC[kind].fields;
  const base = anchorValues(kind);
  const siblings: Record<string, number> = {};
  for (let i = 0; i < specs.length; i += 1) {
    const f = specs[i]!;
    siblings[f.key] = ctx.values?.[f.key] ?? base[f.key]!;
  }
  const out: EditableField[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const f = specs[i]!;
    const anchor = siblings[f.key]!;
    const capMax = capMaxFor(kind, f, anchor, siblings, ctx);
    const step = stepFor(kind, f, anchor, capMax, siblings, ctx);
    const max = anchor + Math.floor((capMax - anchor) / step) * step;
    const field: EditableField = {
      key: f.key,
      label: f.key,
      min: anchor,
      max,
      step,
      default: onLadder(anchor, step, base[f.key]!, max),
      floor: f.floor,
    };
    out.push(f.unbounded === true ? { ...field, unbounded: true } : field);
  }
  return out;
}

function labelOf(kind: Action['kind']): string {
  const title = KEYWORD_TEXT[kind].ruleTitle;
  return title.length > 0 ? title : kind;
}

function buildRow(kind: Action['kind']): KeywordEditor {
  const pricing = KEYWORD_PRICING[kind];
  const selectors = selectorsFor(kind);
  return {
    kind,
    label: labelOf(kind),
    capFamily: pricing.family,
    isHit: pricing.isHit,
    offensive: pricing.offensive,
    fields: editableFieldsFor(kind),
    selectors,
    flags: SPEC[kind].flags ?? [],
    needsProperty: selectors.some((s) => s.key === 'property'),
    needsTargetStat: selectors.some((s) => s.key === 'stat'),
  };
}

function lazyKeywordEditor(): KeywordEditorTable {
  const memo: Partial<Record<Action['kind'], KeywordEditor>> = {};
  const table = {} as Record<Action['kind'], KeywordEditor>;
  for (let i = 0; i < ACTION_KINDS.length; i += 1) {
    const kind = ACTION_KINDS[i]!;
    Object.defineProperty(table, kind, {
      enumerable: true,
      configurable: true,
      get(): KeywordEditor {
        let row = memo[kind];
        if (row === undefined) {
          row = buildRow(kind);
          memo[kind] = row;
        }
        return row;
      },
    });
  }
  return table as KeywordEditorTable;
}

export const KEYWORD_EDITOR: KeywordEditorTable = lazyKeywordEditor();

export const EDITABLE_ACTION_KINDS: readonly Action['kind'][] = ACTION_KINDS;

export const ACTION_MODIFIER_FIELDS: readonly (FlagField | SelectorField)[] = [
  { key: 'affinity', label: 'affinity', source: 'true' },
  { key: 'minTier', label: 'minTier', source: 'SkillTier', options: TIER_OPTIONS, default: 'bronze' },
];

export type CardFieldControl =
  | 'text'
  | 'enum'
  | 'enumMulti'
  | 'number'
  | 'actionList'
  | 'aura'
  | 'tierUpgrades';

export interface CardFieldDef {
  key: string;
  label: string;
  control: CardFieldControl;
  required: boolean;
  source: string;
  options?: readonly (string | number)[];
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

let weightStepMemo: number | undefined;
let cooldownStepMemo: number | undefined;

function weightStep(): number {
  if (weightStepMemo !== undefined) return weightStepMemo;
  const base = probeCard('damage', { power: 0 }, 'physical', {});
  let found = 1;
  for (let s = 1; s <= STEP_SEARCH_LIMIT; s += 1) {
    const delta = powerLevelDeci({ ...base, speedWeight: WEIGHT_MIN }) - powerLevelDeci({ ...base, speedWeight: WEIGHT_MIN + s });
    if (delta > 0 && delta % 10 === 0) { found = s; break; }
  }
  weightStepMemo = found;
  return found;
}

function cooldownStep(): number {
  if (cooldownStepMemo !== undefined) return cooldownStepMemo;
  const base = probeCard('damage', { power: 0 }, 'physical', {});
  let found = 1;
  for (let s = 1; s <= STEP_SEARCH_LIMIT; s += 1) {
    const delta = powerLevelDeci({ ...base, cooldownTurns: 1 }) - powerLevelDeci({ ...base, cooldownTurns: 1 + s });
    if (delta > 0 && delta % 10 === 0) { found = s; break; }
  }
  cooldownStepMemo = found;
  return found;
}

export type CardFieldTable = { readonly [K in keyof Required<SkillDef>]: CardFieldDef & { key: K } };

function buildCardFields(size: SkillSize): CardFieldTable {
  const weightMax = WEIGHT_MAX_BY_SIZE[Math.min(MAX_CARD_SIZE, size)]!;
  return {
    id: { key: 'id', label: 'id', control: 'text', required: true, source: 'string' },
    name: { key: 'name', label: 'name', control: 'text', required: true, source: 'string' },
    archetypes: { key: 'archetypes', label: 'archetypes', control: 'enumMulti', required: true, source: 'Archetype', options: ARCHETYPE_OPTIONS },
    property: { key: 'property', label: 'property', control: 'enum', required: true, source: 'Property', options: PROPERTY_OPTIONS },
    element: { key: 'element', label: 'element', control: 'enum', required: false, source: 'Element', options: ELEMENT_OPTIONS },
    weapon: { key: 'weapon', label: 'weapon', control: 'enum', required: false, source: 'WeaponType', options: WEAPON_OPTIONS },
    size: { key: 'size', label: 'size', control: 'enum', required: true, source: 'SkillSize', options: [1, 2, 3], min: 1, max: MAX_CARD_SIZE, step: 1, default: 1 },
    rarity: { key: 'rarity', label: 'rarity', control: 'enum', required: true, source: 'Rarity', options: RARITY_OPTIONS },
    tier: { key: 'tier', label: 'tier', control: 'enum', required: true, source: 'SkillTier', options: TIER_OPTIONS },
    speedWeight: {
      key: 'speedWeight',
      label: 'speedWeight',
      control: 'number',
      required: false,
      source: 'number (defaults to size * 10)',
      min: WEIGHT_MIN,
      max: weightMax,
      step: weightStep(),
      default: size * 10,
    },
    cooldownTurns: {
      key: 'cooldownTurns',
      label: 'cooldownTurns',
      control: 'number',
      required: false,
      source: 'number (defaults to BASELINE_COOLDOWN)',
      min: 1,
      max: MAX_COOLDOWN_TURNS,
      step: cooldownStep(),
      default: BASELINE_COOLDOWN,
    },
    scope: { key: 'scope', label: 'scope', control: 'enum', required: false, source: "'one' | 'all'", options: SCOPE_OPTIONS },
    effects: { key: 'effects', label: 'effects', control: 'actionList', required: true, source: 'Action[] — see KEYWORD_EDITOR' },
    aura: { key: 'aura', label: 'aura', control: 'aura', required: false, source: 'AuraDef — see AURA_FIELDS' },
    special: { key: 'special', label: 'special', control: 'text', required: false, source: 'string (special registry key)' },
    tierUpgrades: { key: 'tierUpgrades', label: 'tierUpgrades', control: 'tierUpgrades', required: false, source: 'TierUpgrades — see TIER_UPGRADE_FIELDS' },
    flavor: { key: 'flavor', label: 'flavor', control: 'text', required: false, source: 'string (no digit, no %, no {{token}})' },
  };
}

export function cardFieldsFor(ctx: { size?: SkillSize } = {}): CardFieldTable {
  return buildCardFields(ctx.size ?? 1);
}

export const CARD_FIELDS: CardFieldTable = buildCardFields(1);

export const CARD_FIELD_ORDER: readonly string[] = Object.keys(CARD_FIELDS);

export const AURA_MOD_FIELDS: { readonly [K in keyof Required<AuraDef['mods']>]: CardFieldDef & { key: K } } = {
  damageFlat: { key: 'damageFlat', label: 'damageFlat', control: 'number', required: false, source: 'number', min: 0, max: AUTHOR_CEILING, step: 1, default: 0 },
  healFlat: { key: 'healFlat', label: 'healFlat', control: 'number', required: false, source: 'number', min: 0, max: AUTHOR_CEILING, step: 1, default: 0 },
  weightDelta: { key: 'weightDelta', label: 'weightDelta', control: 'number', required: false, source: 'number', min: -WEIGHT_MAX_BY_SIZE[MAX_CARD_SIZE]!, max: WEIGHT_MAX_BY_SIZE[MAX_CARD_SIZE]!, step: 1, default: 0 },
};

export const AURA_FIELDS: { readonly [K in keyof Required<AuraDef>]: CardFieldDef & { key: K } } = {
  affects: { key: 'affects', label: 'affects', control: 'enum', required: true, source: "AuraDef['affects']", options: AURA_AFFECTS_OPTIONS },
  reach: { key: 'reach', label: 'reach', control: 'number', required: false, source: 'number', min: 0, max: MAX_CARD_SIZE, step: 1, default: 1 },
  archetypeFilter: { key: 'archetypeFilter', label: 'archetypeFilter', control: 'enum', required: false, source: 'Archetype', options: ARCHETYPE_OPTIONS },
  propertyFilter: { key: 'propertyFilter', label: 'propertyFilter', control: 'enum', required: false, source: 'Property', options: PROPERTY_OPTIONS },
  mods: { key: 'mods', label: 'mods', control: 'aura', required: true, source: "AuraDef['mods'] — see AURA_MOD_FIELDS" },
};

export type TierUpgradeFieldTable = { readonly [K in keyof Required<TierUpgrade>]: CardFieldDef & { key: K } };

export function tierUpgradeFieldsFor(ctx: { size?: SkillSize } = {}): TierUpgradeFieldTable {
  const card = buildCardFields(ctx.size ?? 1);
  return {
    effects: { key: 'effects', label: 'effects', control: 'actionList', required: false, source: 'Action[] — see KEYWORD_EDITOR' },
    aura: { key: 'aura', label: 'aura', control: 'aura', required: false, source: 'AuraDef — see AURA_FIELDS' },
    speedWeight: { ...card.speedWeight, required: false },
    cooldownTurns: { ...card.cooldownTurns, required: false },
    scope: { key: 'scope', label: 'scope', control: 'enum', required: false, source: "'one' | 'all'", options: SCOPE_OPTIONS },
  };
}

export const TIER_UPGRADE_FIELDS: TierUpgradeFieldTable = tierUpgradeFieldsFor();
