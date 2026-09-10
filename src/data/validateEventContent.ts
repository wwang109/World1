import type { Action, Archetype, BuffableStat, Element, Property, SkillTier, WeaponType } from '../engine/types';
import { biomeIds } from './biomes';
import { enemies } from './enemies';
import { normalizedIntegerPercentagesV3 } from './eventContentV3';
import type {
  EventDef,
  EventArtId,
  EventOutcomeSpec,
  EventRarity,
  EventRequirement,
  EventTallyGate,
  EventTheme,
  FilterFromSource,
} from './eventTypes';
import { gemBook } from './gems';
import { skillBook } from './skills';
import type { ContentProblem } from './validateSkillContent';
import { inRange, isInt, opt, req } from './validateSkillContent';

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function enumValues<K extends string>(table: Readonly<Record<K, true>>): readonly K[] {
  return Object.keys(table) as K[];
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const THEMES = enumValues<EventTheme>({ training: true, cache: true, recruit: true, forge: true, market: true, omen: true });
const RARITIES = enumValues<EventRarity>({ common: true, uncommon: true, rare: true, secret: true });
const EVENT_ART_IDS = enumValues<EventArtId>({ bell_beneath_ice: true, second_toll: true, bell_unbound: true });
const TIERS = enumValues<SkillTier>({ bronze: true, silver: true, gold: true, diamond: true });
const FILTER_FROM = enumValues<FilterFromSource>({ biomeLean: true, biomeCounter: true, boardIdentity: true });
const TALLY_STATS = enumValues<EventTallyGate['stat']>({
  goldSpent: true,
  cardsBought: true,
  gemsBought: true,
  livesLost: true,
  wins: true,
  losses: true,
  bossesCleared: true,
});
const PROPERTIES = enumValues<Property>({ physical: true, magical: true, true: true });
const WEAPONS = enumValues<WeaponType>({ sword: true, axe: true, lance: true, bow: true, beast: true });
const ELEMENTS = enumValues<Element>({ fire: true, frost: true, lightning: true, nature: true, holy: true, dark: true });
const ARCHETYPES = enumValues<Archetype>({ offense: true, defensive: true, healing: true, support: true, debuff: true });
const HERO_STATS = enumValues<BuffableStat>({ attack: true, magicPower: true, armor: true, magicResist: true, speed: true });

const OUTCOME_KINDS: Readonly<Record<EventOutcomeSpec['kind'], true>> = {
  grantCard: true,
  grantGem: true,
  cardChoice: true,
  gemChoice: true,
  grantGold: true,
  loseGold: true,
  grantLevel: true,
  bonusDraft: true,
  upgradeCard: true,
  sellGem: true,
  mergeCards: true,
  grantMapInfo: true,
  nothing: true,
};

const ACTION_KINDS: Readonly<Record<Action['kind'], true>> = {
  damage: true,
  statStrike: true,
  heal: true,
  shield: true,
  attunedShield: true,
  poison: true,
  burn: true,
  bleed: true,
  stun: true,
  buffStat: true,
  debuffStat: true,
  expose: true,
  cleanse: true,
  thorns: true,
  taunt: true,
  slow: true,
  burden: true,
  curse: true,
  splash: true,
  disrupt: true,
  lifesteal: true,
  shieldBreak: true,
  comboBonus: true,
  chainBonus: true,
  empowerNext: true,
  exploit: true,
  stackBonus: true,
  shieldBurst: true,
  taxBonus: true,
  wardRelease: true,
  desperation: true,
  overhealShield: true,
  cleanseConvert: true,
  guard: true,
  negate: true,
  ward: true,
};

function required(
  raw: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean,
  description: string,
  where: string,
  problems: ContentProblem[],
): void {
  req(raw, key, predicate, description, `${where}.${key}`, problems);
}

function optional(
  raw: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean,
  description: string,
  where: string,
  problems: ContentProblem[],
): void {
  opt(raw, key, predicate, description, `${where}.${key}`, problems);
}

function rejectUnknownFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  problems: ContentProblem[],
): void {
  const known = new Set(allowed);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) problems.push({ where: `${where}.${key}`, message: `unknown field ${key}` });
  }
}

function validateNotes(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!Array.isArray(value) || value.some((note) => typeof note !== 'string' || note.trim() === '')) {
    problems.push({ where, message: 'notes must be an array of non-empty strings' });
  }
}

function validateEnumList(
  value: unknown,
  allowed: readonly string[],
  where: string,
  problems: ContentProblem[],
  options: { knownIds?: ReadonlySet<string> } = {},
): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ where, message: 'must be a non-empty array' });
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const at = `${where}[${index}]`;
    if (typeof item !== 'string' || !allowed.includes(item)) {
      problems.push({ where: at, message: `unknown value ${JSON.stringify(item)}` });
      return;
    }
    if (options.knownIds !== undefined && !options.knownIds.has(item)) {
      problems.push({ where: at, message: `unknown id ${item}` });
    }
    if (seen.has(item)) problems.push({ where: at, message: `duplicate value ${item}` });
    seen.add(item);
  });
}

function validateCardFilter(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ where, message: 'card filter must be a non-empty array of non-empty clauses' });
    return;
  }
  value.forEach((clause, index) => {
    const at = `${where}[${index}]`;
    if (!isObj(clause)) {
      problems.push({ where: at, message: 'card filter clause must be an object' });
      return;
    }
    const fields = ['properties', 'weapons', 'elements', 'archetypes'] as const;
    if (Object.keys(clause).length === 0) {
      problems.push({ where: at, message: 'card filter clause must not be empty' });
    }
    rejectUnknownFields(clause, fields, at, problems);
    if (clause.properties !== undefined) validateEnumList(clause.properties, PROPERTIES, `${at}.properties`, problems);
    if (clause.weapons !== undefined) validateEnumList(clause.weapons, WEAPONS, `${at}.weapons`, problems);
    if (clause.elements !== undefined) validateEnumList(clause.elements, ELEMENTS, `${at}.elements`, problems);
    if (clause.archetypes !== undefined) validateEnumList(clause.archetypes, ARCHETYPES, `${at}.archetypes`, problems);
  });
}

const GEM_IDS = new Set(Object.keys(gemBook));
const CARD_IDS = new Set(Object.keys(skillBook));
const ENEMY_IDS = new Set(Object.keys(enemies));

function validateGemFilter(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ where, message: 'gem filter must be a non-empty array of non-empty clauses' });
    return;
  }
  value.forEach((clause, index) => {
    const at = `${where}[${index}]`;
    if (!isObj(clause)) {
      problems.push({ where: at, message: 'gem filter clause must be an object' });
      return;
    }
    const fields = ['ids', 'actionKinds', 'heroStats', 'all'] as const;
    const present = fields.filter((field) => clause[field] !== undefined);
    if (present.length !== 1) {
      problems.push({ where: at, message: 'gem filter clause must select exactly one of ids, actionKinds, heroStats, or all' });
    }
    rejectUnknownFields(clause, fields, at, problems);
    if (clause.ids !== undefined) {
      validateEnumList(clause.ids, [...GEM_IDS], `${at}.ids`, problems, { knownIds: GEM_IDS });
    }
    if (clause.actionKinds !== undefined) {
      validateEnumList(clause.actionKinds, Object.keys(ACTION_KINDS), `${at}.actionKinds`, problems);
    }
    if (clause.heroStats !== undefined) validateEnumList(clause.heroStats, HERO_STATS, `${at}.heroStats`, problems);
    if (clause.all !== undefined && clause.all !== true) {
      problems.push({ where: `${at}.all`, message: 'all must be exactly true' });
    }
  });
}

function validateIdList(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ where, message: 'must be a non-empty array of choice ids' });
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const at = `${where}[${index}]`;
    if (typeof item !== 'string' || !ID_PATTERN.test(item)) {
      problems.push({ where: at, message: 'choice id must be non-empty lowercase snake_case' });
      return;
    }
    if (seen.has(item)) problems.push({ where: at, message: `duplicate choice id ${item}` });
    seen.add(item);
  });
}

function validateGate(value: unknown, where: string, problems: ContentProblem[], includesKind = false): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'resolution gate must be an object' });
    return;
  }
  required(value, 'eventId', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case event id', where, problems);
  if (value.choiceIds !== undefined) validateIdList(value.choiceIds, `${where}.choiceIds`, problems);
  rejectUnknownFields(value, includesKind ? ['kind', 'eventId', 'choiceIds'] : ['eventId', 'choiceIds'], where, problems);
}

function validateTallyGate(value: unknown, where: string, problems: ContentProblem[], includesKind = false): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'tally gate must be an object' });
    return;
  }
  required(value, 'stat', (v) => TALLY_STATS.includes(v as EventTallyGate['stat']), TALLY_STATS.join('|'), where, problems);
  required(value, 'atLeast', (v) => isInt(v) && v > 0, 'a positive integer', where, problems);
  rejectUnknownFields(value, includesKind ? ['kind', 'stat', 'atLeast'] : ['stat', 'atLeast'], where, problems);
}

function assertNeverRequirement(value: never, where: string, problems: ContentProblem[]): void {
  problems.push({ where, message: `unhandled requirement kind ${JSON.stringify(value)}` });
}

function validateRequirement(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'requirement must be an object' });
    return;
  }
  if (typeof value.kind !== 'string' || (value.kind !== 'resolution' && value.kind !== 'tally')) {
    problems.push({ where: `${where}.kind`, message: 'requirement is missing a recognized string kind' });
    return;
  }
  const kind = value.kind as EventRequirement['kind'];
  switch (kind) {
    case 'resolution':
      validateGate(value, where, problems, true);
      return;
    case 'tally':
      validateTallyGate(value, where, problems, true);
      return;
    default:
      assertNeverRequirement(kind, `${where}.kind`, problems);
  }
}

function requirementFingerprint(value: unknown): string | undefined {
  if (!isObj(value)) return undefined;
  if (value.kind === 'resolution' && typeof value.eventId === 'string') {
    const choices = Array.isArray(value.choiceIds)
      ? value.choiceIds.filter((choice): choice is string => typeof choice === 'string').slice().sort()
      : [];
    return `resolution|${value.eventId}|${choices.join(',')}`;
  }
  if (value.kind === 'tally' && typeof value.stat === 'string' && isInt(value.atLeast)) {
    return `tally|${value.stat}|${value.atLeast}`;
  }
  return undefined;
}

function validateGrantCard(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'cardId', 'filter', 'tier'], where, problems);
  optional(raw, 'cardId', (v) => typeof v === 'string' && CARD_IDS.has(v), 'a real card id', where, problems);
  optional(raw, 'tier', (v) => TIERS.includes(v as SkillTier), TIERS.join('|'), where, problems);
  if (raw.filter !== undefined) validateCardFilter(raw.filter, `${where}.filter`, problems);
}

function validateGrantGem(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'gemId', 'filter'], where, problems);
  optional(raw, 'gemId', (v) => typeof v === 'string' && GEM_IDS.has(v), 'a real gem id', where, problems);
  if (raw.filter !== undefined) validateGemFilter(raw.filter, `${where}.filter`, problems);
}

function validateCardChoice(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'filter', 'filterFrom', 'tier'], where, problems);
  optional(raw, 'filterFrom', (v) => FILTER_FROM.includes(v as FilterFromSource), FILTER_FROM.join('|'), where, problems);
  optional(raw, 'tier', (v) => v === 'bronze', 'exactly bronze', where, problems);
  if (raw.filter !== undefined) validateCardFilter(raw.filter, `${where}.filter`, problems);
  if (raw.filter !== undefined && raw.filterFrom !== undefined) {
    problems.push({ where: `${where}.filterFrom`, message: 'filter and filterFrom are mutually exclusive' });
  }
}

function validateGemChoice(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'filter'], where, problems);
  if (raw.filter !== undefined) validateGemFilter(raw.filter, `${where}.filter`, problems);
}

function validateGrantGold(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'amount'], where, problems);
  required(raw, 'amount', (v) => isInt(v) && v > 0, 'a positive integer', where, problems);
}

function validateLoseGold(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'amount'], where, problems);
  required(raw, 'amount', (v) => isInt(v) && v > 0, 'a positive integer', where, problems);
}

function validateGrantLevel(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind'], where, problems);
}

function validateBonusDraft(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'filter', 'filterFrom'], where, problems);
  optional(raw, 'filterFrom', (v) => FILTER_FROM.includes(v as FilterFromSource), FILTER_FROM.join('|'), where, problems);
  if (raw.filter !== undefined) validateCardFilter(raw.filter, `${where}.filter`, problems);
  if (raw.filter !== undefined && raw.filterFrom !== undefined) {
    problems.push({ where: `${where}.filterFrom`, message: 'filter and filterFrom are mutually exclusive' });
  }
}

function validateUpgradeCard(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind'], where, problems);
}

function validateSellGem(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind'], where, problems);
}

function validateMergeCards(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind'], where, problems);
}

function validateGrantMapInfo(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'bandsAhead'], where, problems);
  required(raw, 'bandsAhead', (v) => v === 2 || v === 3, 'exactly 2 or 3', where, problems);
}

function validateNothing(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind'], where, problems);
}

function assertNeverOutcome(value: never, where: string, problems: ContentProblem[]): void {
  problems.push({ where, message: `unhandled outcome kind ${JSON.stringify(value)}` });
}

function validateOutcome(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'outcome must be an object' });
    return;
  }
  if (typeof value.kind !== 'string' || !(value.kind in OUTCOME_KINDS)) {
    problems.push({ where: `${where}.kind`, message: 'outcome is missing a recognized string kind' });
    return;
  }
  const kind = value.kind as EventOutcomeSpec['kind'];
  switch (kind) {
    case 'grantCard': validateGrantCard(value, where, problems); return;
    case 'grantGem': validateGrantGem(value, where, problems); return;
    case 'cardChoice': validateCardChoice(value, where, problems); return;
    case 'gemChoice': validateGemChoice(value, where, problems); return;
    case 'grantGold': validateGrantGold(value, where, problems); return;
    case 'loseGold': validateLoseGold(value, where, problems); return;
    case 'grantLevel': validateGrantLevel(value, where, problems); return;
    case 'bonusDraft': validateBonusDraft(value, where, problems); return;
    case 'upgradeCard': validateUpgradeCard(value, where, problems); return;
    case 'sellGem': validateSellGem(value, where, problems); return;
    case 'mergeCards': validateMergeCards(value, where, problems); return;
    case 'grantMapInfo': validateGrantMapInfo(value, where, problems); return;
    case 'nothing': validateNothing(value, where, problems); return;
    default: assertNeverOutcome(kind, `${where}.kind`, problems);
  }
}

function validateChoice(
  value: unknown,
  where: string,
  seenIds: Set<string>,
  problems: ContentProblem[],
): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'choice must be an object' });
    return;
  }
  required(value, 'id', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case id', where, problems);
  if (typeof value.id === 'string' && ID_PATTERN.test(value.id)) {
    if (seenIds.has(value.id)) problems.push({ where: `${where}.id`, message: `duplicate choice id ${value.id}` });
    seenIds.add(value.id);
  }
  required(value, 'label', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  optional(value, 'cost', inRange(0, 999), 'an integer 0..999', where, problems);
  if (value.requires !== undefined) validateGate(value.requires, `${where}.requires`, problems);
  if (value.requiresTally !== undefined) validateTallyGate(value.requiresTally, `${where}.requiresTally`, problems);
  if (!('outcome' in value)) problems.push({ where: `${where}.outcome`, message: 'missing required field outcome' });
  else validateOutcome(value.outcome, `${where}.outcome`, problems);
  rejectUnknownFields(value, ['id', 'label', 'cost', 'requires', 'requiresTally', 'outcome'], where, problems);
}

function validateDefinition(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  required(raw, 'title', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  required(raw, 'body', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  required(raw, 'theme', (v) => THEMES.includes(v as typeof THEMES[number]), THEMES.join('|'), where, problems);
  optional(raw, 'artId', (v) => EVENT_ART_IDS.includes(v as typeof EVENT_ART_IDS[number]), EVENT_ART_IDS.join('|'), where, problems);
  optional(raw, 'rarity', (v) => RARITIES.includes(v as typeof RARITIES[number]), RARITIES.join('|'), where, problems);
  if (raw.notes !== undefined) validateNotes(raw.notes, `${where}.notes`, problems);
  if (raw.biomeIds !== undefined) {
    const ids = new Set(biomeIds);
    validateEnumList(raw.biomeIds, biomeIds, `${where}.biomeIds`, problems, { knownIds: ids });
  }
  if (raw.requires !== undefined) validateGate(raw.requires, `${where}.requires`, problems);
  if (raw.requiresTally !== undefined) validateTallyGate(raw.requiresTally, `${where}.requiresTally`, problems);
  if (raw.requiresAll !== undefined) {
    if (!Array.isArray(raw.requiresAll) || raw.requiresAll.length === 0) {
      problems.push({ where: `${where}.requiresAll`, message: 'requiresAll must be a non-empty array' });
    } else {
      const seenRequirements = new Set<string>();
      raw.requiresAll.forEach((requirement, index) => {
        const at = `${where}.requiresAll[${index}]`;
        validateRequirement(requirement, at, problems);
        const fingerprint = requirementFingerprint(requirement);
        if (fingerprint !== undefined && seenRequirements.has(fingerprint)) {
          problems.push({ where: at, message: 'duplicate requirement' });
        }
        if (fingerprint !== undefined) seenRequirements.add(fingerprint);
      });
    }
  }

  if (!Array.isArray(raw.choices) || raw.choices.length < 2 || raw.choices.length > 3) {
    problems.push({ where: `${where}.choices`, message: 'choices must contain exactly 2 or 3 entries' });
  }
  if (Array.isArray(raw.choices)) {
    const seenIds = new Set<string>();
    raw.choices.forEach((choice, index) => validateChoice(choice, `${where}.choices[${index}]`, seenIds, problems));
    const choices = raw.choices.filter(isObj);
    const isFree = (choice: Record<string, unknown>): boolean => choice.cost === undefined || choice.cost === 0;
    const isUngated = (choice: Record<string, unknown>): boolean => choice.requires === undefined && choice.requiresTally === undefined;
    if (!choices.some((choice) => isFree(choice) && isUngated(choice))) {
      problems.push({ where: `${where}.choices`, message: 'event needs a cost-zero choice with no choice-level gate as a safe exit' });
    }
  }

  const allowed = ['notes', 'title', 'theme', 'artId', 'body', 'rarity', 'biomeIds', 'requires', 'requiresTally', 'requiresAll', 'choices'];
  for (const key of Object.keys(raw)) {
    if (key === 'id' || key === 'version') {
      problems.push({ where: `${where}.${key}`, message: `${key} belongs on the document envelope, not inside def` });
    } else if (!allowed.includes(key)) {
      problems.push({ where: `${where}.${key}`, message: `unknown field ${key}` });
    }
  }
}

function validateV2Story(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'story must be an object' });
    return;
  }
  required(value, 'storyId', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case story id', where, problems);
  required(value, 'stage', (v) => v === 'setup' || v === 'callback', 'setup|callback', where, problems);
  required(value, 'role', (v) => v === 'setup' || v === 'callback', 'setup|callback', where, problems);
  rejectUnknownFields(value, ['storyId', 'stage', 'role'], where, problems);
}

function validateV2Requirement(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'eligibility requirement must be an object' });
    return;
  }
  if ('all' in value || 'any' in value) {
    const key = 'all' in value ? 'all' : 'any';
    rejectUnknownFields(value, [key], where, problems);
    const children = value[key];
    if (!Array.isArray(children) || children.length === 0) {
      problems.push({ where: `${where}.${key}`, message: `${key} must be a non-empty array` });
      return;
    }
    children.forEach((child, index) => validateV2Requirement(child, `${where}.${key}[${index}]`, problems));
    return;
  }
  if ('not' in value) {
    rejectUnknownFields(value, ['not'], where, problems);
    validateV2Requirement(value.not, `${where}.not`, problems);
    return;
  }
  if (typeof value.fact !== 'string') {
    problems.push({ where: `${where}.fact`, message: 'requirement must contain one recognized fact' });
    return;
  }
  rejectUnknownFields(value, ['fact', 'args'], where, problems);
  if (!isObj(value.args)) {
    problems.push({ where: `${where}.args`, message: 'fact args must be an object' });
    return;
  }
  switch (value.fact) {
    case 'biome.current':
      rejectUnknownFields(value.args, ['ids'], `${where}.args`, problems);
      validateEnumList(value.args.ids, biomeIds, `${where}.args.ids`, problems, { knownIds: new Set(biomeIds) });
      return;
    case 'board.affinity':
      rejectUnknownFields(value.args, ['affinityId'], `${where}.args`, problems);
      required(value.args, 'affinityId', (v) => WEAPONS.includes(v as WeaponType) || ELEMENTS.includes(v as Element), 'a weapon or element affinity', `${where}.args`, problems);
      return;
    case 'owned.card.count': {
      rejectUnknownFields(value.args, ['where', 'count', 'match'], `${where}.args`, problems);
      required(value.args, 'where', (v) => v === 'board' || v === 'bag' || v === 'held' || v === 'any', 'board|bag|held|any', `${where}.args`, problems);
      required(value.args, 'count', (v) => isInt(v) && v > 0, 'a positive integer', `${where}.args`, problems);
      if (!isObj(value.args.match)) {
        problems.push({ where: `${where}.args.match`, message: 'match must be an object' });
      } else {
        rejectUnknownFields(value.args.match, ['weapons'], `${where}.args.match`, problems);
        validateEnumList(value.args.match.weapons, WEAPONS, `${where}.args.match.weapons`, problems);
      }
      return;
    }
    case 'callback.queued':
      rejectUnknownFields(value.args, ['callbackId'], `${where}.args`, problems);
      required(value.args, 'callbackId', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case callback id', `${where}.args`, problems);
      return;
    default:
      problems.push({ where: `${where}.fact`, message: `unknown v2 fact ${JSON.stringify(value.fact)}` });
  }
}

function validateV2Callback(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'callback must be an object' });
    return;
  }
  required(value, 'callbackId', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case callback id', where, problems);
  required(value, 'eventId', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case event id', where, problems);
  required(value, 'contentVersion', (v) => isInt(v) && v >= 1, 'an integer >= 1', where, problems);
  required(value, 'minDepthDelay', (v) => isInt(v) && v >= 1, 'a positive integer', where, problems);
  if (value.destinationThemes === undefined) problems.push({ where: `${where}.destinationThemes`, message: 'missing required field destinationThemes' });
  else validateEnumList(value.destinationThemes, THEMES, `${where}.destinationThemes`, problems);
  if (value.destinationBiomeIds !== undefined) validateEnumList(value.destinationBiomeIds, biomeIds, `${where}.destinationBiomeIds`, problems, { knownIds: new Set(biomeIds) });
  required(value, 'priority', (v) => inRange(0, 999)(v), 'an integer 0..999', where, problems);
  if (!Array.isArray(value.bind) || value.bind.length !== 0) problems.push({ where: `${where}.bind`, message: 'bind must be exactly an empty array in schema v2' });
  if (!isObj(value.expiry)) {
    problems.push({ where: `${where}.expiry`, message: 'expiry must be an object' });
  } else {
    required(value.expiry, 'expiresAfterNodes', (v) => isInt(v) && v > 0, 'a positive integer', `${where}.expiry`, problems);
    required(value.expiry, 'fallback', (v) => v === 'discard', 'exactly discard', `${where}.expiry`, problems);
    rejectUnknownFields(value.expiry, ['expiresAfterNodes', 'fallback'], `${where}.expiry`, problems);
  }
  rejectUnknownFields(value, ['callbackId', 'eventId', 'contentVersion', 'minDepthDelay', 'destinationThemes', 'destinationBiomeIds', 'priority', 'bind', 'expiry'], where, problems);
}

function validateV2Choice(value: unknown, where: string, seenIds: Set<string>, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'choice must be an object' });
    return;
  }
  required(value, 'id', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case id', where, problems);
  if (typeof value.id === 'string' && ID_PATTERN.test(value.id)) {
    if (seenIds.has(value.id)) problems.push({ where: `${where}.id`, message: `duplicate choice id ${value.id}` });
    seenIds.add(value.id);
  }
  required(value, 'label', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  optional(value, 'cost', inRange(0, 999), 'an integer 0..999', where, problems);
  if (!('outcome' in value)) problems.push({ where: `${where}.outcome`, message: 'missing required field outcome' });
  else validateOutcome(value.outcome, `${where}.outcome`, problems);
  if (value.mutations !== undefined) {
    if (!Array.isArray(value.mutations) || value.mutations.length === 0) {
      problems.push({ where: `${where}.mutations`, message: 'mutations must be a non-empty array' });
    } else {
      value.mutations.forEach((mutation, index) => {
        const at = `${where}.mutations[${index}]`;
        if (!isObj(mutation)) {
          problems.push({ where: at, message: 'mutation must be an object' });
          return;
        }
        required(mutation, 'op', (v) => v === 'completeStory', 'exactly completeStory', at, problems);
        required(mutation, 'storyId', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a lowercase snake_case story id', at, problems);
        rejectUnknownFields(mutation, ['op', 'storyId'], at, problems);
      });
    }
  }
  if (value.callback !== undefined) validateV2Callback(value.callback, `${where}.callback`, problems);
  rejectUnknownFields(value, ['id', 'label', 'cost', 'outcome', 'mutations', 'callback'], where, problems);
}

function validateV2Definition(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  required(raw, 'title', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  required(raw, 'body', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  required(raw, 'theme', (v) => THEMES.includes(v as typeof THEMES[number]), THEMES.join('|'), where, problems);
  required(raw, 'rarity', (v) => RARITIES.includes(v as EventRarity), RARITIES.join('|'), where, problems);
  if (raw.biomeIds !== undefined) validateEnumList(raw.biomeIds, biomeIds, `${where}.biomeIds`, problems, { knownIds: new Set(biomeIds) });
  if (raw.artId !== undefined) optional(raw, 'artId', (v) => EVENT_ART_IDS.includes(v as EventArtId), EVENT_ART_IDS.join('|'), where, problems);
  if (!('story' in raw)) problems.push({ where: `${where}.story`, message: 'missing required field story' });
  else validateV2Story(raw.story, `${where}.story`, problems);
  if (!('eligibility' in raw)) problems.push({ where: `${where}.eligibility`, message: 'missing required field eligibility' });
  else validateV2Requirement(raw.eligibility, `${where}.eligibility`, problems);
  if (!isObj(raw.delivery) || (raw.delivery.kind !== 'ambient' && raw.delivery.kind !== 'queued_callback')) {
    problems.push({ where: `${where}.delivery`, message: 'delivery must be ambient or queued_callback' });
  } else rejectUnknownFields(raw.delivery, ['kind'], `${where}.delivery`, problems);
  required(raw, 'visibility', (v) => v === 'visible' || v === 'hidden_until_eligible' || v === 'teased_when_due', 'visible|hidden_until_eligible|teased_when_due', where, problems);
  required(raw, 'priority', (v) => inRange(0, 999)(v), 'an integer 0..999', where, problems);
  required(raw, 'once', (v) => v === 'node' || v === 'run', 'node|run', where, problems);
  required(raw, 'cooldownNodes', (v) => isInt(v) && v >= 0, 'a non-negative integer', where, problems);
  if (!Array.isArray(raw.choices) || raw.choices.length < 2 || raw.choices.length > 3) {
    problems.push({ where: `${where}.choices`, message: 'choices must contain exactly 2 or 3 entries' });
  }
  if (Array.isArray(raw.choices)) {
    const seenIds = new Set<string>();
    raw.choices.forEach((choice, index) => validateV2Choice(choice, `${where}.choices[${index}]`, seenIds, problems));
    const choices = raw.choices.filter(isObj);
    if (!choices.some((choice) => (choice.cost === undefined || choice.cost === 0) && choice.requires === undefined && choice.requiresTally === undefined)) {
      problems.push({ where: `${where}.choices`, message: 'event needs a cost-zero choice with no choice-level gate as a safe exit' });
    }
  }
  rejectUnknownFields(raw, ['title', 'body', 'theme', 'artId', 'rarity', 'biomeIds', 'story', 'eligibility', 'delivery', 'visibility', 'priority', 'once', 'cooldownNodes', 'choices'], where, problems);
}

const STORY_STATE_V3 = {
  oath_mercy: { kind: 'boolean', default: false },
  grave_path: { kind: 'enum', values: ['none', 'opened', 'answered'], default: 'none' },
  honorable_choice: { kind: 'boolean', default: false },
  reliquary_oath: { kind: 'boolean', default: false },
  oath_gate: { kind: 'enum', values: ['none', 'sworn', 'kept', 'released'], default: 'none' },
  venom_bloom: { kind: 'enum', values: ['none', 'cultivated'], default: 'none' },
  rival_spared: { kind: 'boolean', default: false },
  moon_quarry_released: { kind: 'boolean', default: false },
} as const;

type StoryStateKeyV3 = keyof typeof STORY_STATE_V3;

const STORY_STATE_KEYS_V3 = Object.keys(STORY_STATE_V3) as StoryStateKeyV3[];
const BOOLEAN_STORY_KEYS_V3 = new Set<StoryStateKeyV3>([
  'oath_mercy',
  'honorable_choice',
  'reliquary_oath',
  'rival_spared',
  'moon_quarry_released',
]);
const BINDING_SLOTS_V3 = [
  'enemy_id',
  'revenge_finisher_card_id',
  'signature_card_id',
  'mono_type',
  'destination_biome',
] as const;

function canonicalFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFingerprint).join(',')}]`;
  if (!isObj(value)) return JSON.stringify(value) ?? String(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalFingerprint(value[key])}`).join(',')}}`;
}

function validateV3StoryStateSchema(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'schema v3 storyStateSchema must be an object' });
    return;
  }
  rejectUnknownFields(value, STORY_STATE_KEYS_V3, where, problems);
  for (const key of STORY_STATE_KEYS_V3) {
    if (!Object.hasOwn(value, key)) {
      problems.push({ where: `${where}.${key}`, message: `missing required story-state field ${key}` });
      continue;
    }
    const field = value[key];
    const at = `${where}.${key}`;
    if (!isObj(field)) {
      problems.push({ where: at, message: 'story-state field must be an object' });
      continue;
    }
    const expected = STORY_STATE_V3[key];
    required(field, 'kind', (entry) => entry === expected.kind, `exactly ${expected.kind}`, at, problems);
    required(field, 'default', (entry) => entry === expected.default, `exactly ${String(expected.default)}`, at, problems);
    if (expected.kind === 'enum') {
      required(
        field,
        'values',
        (entry) => Array.isArray(entry)
          && entry.length === expected.values.length
          && entry.every((item, index) => item === expected.values[index]),
        `exactly ${expected.values.join('|')} in registry order`,
        at,
        problems,
      );
      rejectUnknownFields(field, ['kind', 'values', 'default'], at, problems);
    } else {
      rejectUnknownFields(field, ['kind', 'default'], at, problems);
    }
  }
}

function validateV3CardMatch(
  value: unknown,
  where: string,
  problems: ContentProblem[],
  requireAxis = false,
): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'card match must be an object' });
    return;
  }
  const axes = ['cardIds', 'weapons', 'elements', 'archetypes'] as const;
  rejectUnknownFields(value, axes, where, problems);
  if (requireAxis && !axes.some((axis) => value[axis] !== undefined)) {
    problems.push({ where, message: 'card match must select at least one axis' });
  }
  if (value.cardIds !== undefined) validateEnumList(value.cardIds, [...CARD_IDS], `${where}.cardIds`, problems, { knownIds: CARD_IDS });
  if (value.weapons !== undefined) validateEnumList(value.weapons, WEAPONS, `${where}.weapons`, problems);
  if (value.elements !== undefined) validateEnumList(value.elements, ELEMENTS, `${where}.elements`, problems);
  if (value.archetypes !== undefined) validateEnumList(value.archetypes, ARCHETYPES, `${where}.archetypes`, problems);
}

function validateV3GemMatch(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'gem match must be an object' });
    return;
  }
  rejectUnknownFields(value, ['gemIds', 'actionKinds', 'heroStats'], where, problems);
  if (value.gemIds !== undefined) validateEnumList(value.gemIds, [...GEM_IDS], `${where}.gemIds`, problems, { knownIds: GEM_IDS });
  if (value.actionKinds !== undefined) validateEnumList(value.actionKinds, Object.keys(ACTION_KINDS), `${where}.actionKinds`, problems);
  if (value.heroStats !== undefined) validateEnumList(value.heroStats, HERO_STATS, `${where}.heroStats`, problems);
}

function validateV3StoryFlagArgs(args: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(args, ['key', 'op', 'value'], where, problems);
  required(args, 'key', (value) => typeof value === 'string' && STORY_STATE_KEYS_V3.includes(value as StoryStateKeyV3), STORY_STATE_KEYS_V3.join('|'), where, problems);
  if (typeof args.key !== 'string' || !STORY_STATE_KEYS_V3.includes(args.key as StoryStateKeyV3)) return;
  const key = args.key as StoryStateKeyV3;
  if (BOOLEAN_STORY_KEYS_V3.has(key)) {
    required(args, 'op', (value) => value === 'eq' || value === 'neq', 'eq|neq for a boolean story field', where, problems);
    required(args, 'value', (value) => typeof value === 'boolean', 'a boolean', where, problems);
    return;
  }
  const field = STORY_STATE_V3[key];
  if (field.kind !== 'enum') return;
  required(args, 'op', (value) => value === 'eq' || value === 'neq' || value === 'in', 'eq|neq|in for an enum story field', where, problems);
  if (args.op === 'in') {
    validateEnumList(args.value, field.values, `${where}.value`, problems);
  } else {
    required(args, 'value', (value) => typeof value === 'string' && field.values.includes(value as never), field.values.join('|'), where, problems);
  }
}

function validateV3Requirement(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'eligibility requirement must be an object' });
    return;
  }
  if ('all' in value || 'any' in value) {
    const key = 'all' in value ? 'all' : 'any';
    rejectUnknownFields(value, [key], where, problems);
    const children = value[key];
    if (!Array.isArray(children) || children.length === 0) {
      problems.push({ where: `${where}.${key}`, message: `${key} must be a non-empty array` });
      return;
    }
    const seen = new Set<string>();
    children.forEach((child, index) => {
      const at = `${where}.${key}[${index}]`;
      validateV3Requirement(child, at, problems);
      const fingerprint = canonicalFingerprint(child);
      if (seen.has(fingerprint)) problems.push({ where: at, message: 'duplicate requirement child' });
      seen.add(fingerprint);
    });
    return;
  }
  if ('not' in value) {
    rejectUnknownFields(value, ['not'], where, problems);
    validateV3Requirement(value.not, `${where}.not`, problems);
    return;
  }
  rejectUnknownFields(value, ['fact', 'args'], where, problems);
  if (typeof value.fact !== 'string') {
    problems.push({ where: `${where}.fact`, message: 'requirement must contain one recognized fact' });
    return;
  }
  if (!isObj(value.args)) {
    problems.push({ where: `${where}.args`, message: 'fact args must be an object' });
    return;
  }
  const args = value.args;
  const argsWhere = `${where}.args`;
  const numericComparison = (): void => {
    rejectUnknownFields(args, ['op', 'value'], argsWhere, problems);
    required(args, 'op', (entry) => entry === 'eq' || entry === 'gte' || entry === 'lte', 'eq|gte|lte', argsWhere, problems);
    required(args, 'value', isInt, 'an integer', argsWhere, problems);
  };
  const requiredBiome = (key = 'biomeId'): void => {
    required(args, key, (entry) => typeof entry === 'string' && biomeIds.includes(entry), 'a catalog biome id', argsWhere, problems);
  };
  const requiredAffinity = (): void => {
    required(args, 'affinityId', (entry) => WEAPONS.includes(entry as WeaponType) || ELEMENTS.includes(entry as Element), 'a weapon or element affinity', argsWhere, problems);
  };
  switch (value.fact) {
    case 'wallet.current':
    case 'lives.current':
    case 'node.depth':
    case 'node.wave':
      numericComparison();
      return;
    case 'run.tally':
      rejectUnknownFields(args, ['stat', 'op', 'value'], argsWhere, problems);
      required(args, 'stat', (entry) => TALLY_STATS.includes(entry as EventTallyGate['stat']), TALLY_STATS.join('|'), argsWhere, problems);
      required(args, 'op', (entry) => entry === 'eq' || entry === 'gte' || entry === 'lte', 'eq|gte|lte', argsWhere, problems);
      required(args, 'value', isInt, 'an integer', argsWhere, problems);
      return;
    case 'event.choice':
      rejectUnknownFields(args, ['eventId', 'choiceIds'], argsWhere, problems);
      required(args, 'eventId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case event id', argsWhere, problems);
      if (args.choiceIds !== undefined) validateIdList(args.choiceIds, `${argsWhere}.choiceIds`, problems);
      return;
    case 'story.flag':
      validateV3StoryFlagArgs(args, argsWhere, problems);
      return;
    case 'chain.completed':
      rejectUnknownFields(args, ['storyId'], argsWhere, problems);
      required(args, 'storyId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case story id', argsWhere, problems);
      return;
    case 'biome.current':
      rejectUnknownFields(args, ['ids'], argsWhere, problems);
      validateEnumList(args.ids, biomeIds, `${argsWhere}.ids`, problems, { knownIds: new Set(biomeIds) });
      return;
    case 'board.affinity':
      rejectUnknownFields(args, ['affinityId'], argsWhere, problems);
      requiredAffinity();
      return;
    case 'board.isMonoType':
      rejectUnknownFields(args, ['typeKind'], argsWhere, problems);
      required(args, 'typeKind', (entry) => entry === 'weapon' || entry === 'element', 'weapon|element', argsWhere, problems);
      return;
    case 'owned.card.count':
      rejectUnknownFields(args, ['where', 'count', 'match', 'tierAtLeast'], argsWhere, problems);
      required(args, 'where', (entry) => entry === 'board' || entry === 'bag' || entry === 'held' || entry === 'any', 'board|bag|held|any', argsWhere, problems);
      required(args, 'count', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      if (!Object.hasOwn(args, 'match')) problems.push({ where: `${argsWhere}.match`, message: 'missing required field match' });
      else validateV3CardMatch(args.match, `${argsWhere}.match`, problems);
      optional(args, 'tierAtLeast', (entry) => TIERS.includes(entry as SkillTier), TIERS.join('|'), argsWhere, problems);
      return;
    case 'owned.gem.count':
      rejectUnknownFields(args, ['where', 'count', 'match'], argsWhere, problems);
      required(args, 'where', (entry) => entry === 'pouch' || entry === 'socketed' || entry === 'any', 'pouch|socketed|any', argsWhere, problems);
      required(args, 'count', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      if (!Object.hasOwn(args, 'match')) problems.push({ where: `${argsWhere}.match`, message: 'missing required field match' });
      else validateV3GemMatch(args.match, `${argsWhere}.match`, problems);
      return;
    case 'combat.enemyDefeated': {
      rejectUnknownFields(args, ['enemyId', 'weaponAffinity', 'atLeast'], argsWhere, problems);
      const selectors = Number(args.enemyId !== undefined) + Number(args.weaponAffinity !== undefined);
      if (selectors !== 1) problems.push({ where: argsWhere, message: 'exactly one of enemyId or weaponAffinity is required' });
      optional(args, 'enemyId', (entry) => typeof entry === 'string' && ENEMY_IDS.has(entry), 'a catalog enemy id', argsWhere, problems);
      optional(args, 'weaponAffinity', (entry) => WEAPONS.includes(entry as WeaponType), WEAPONS.join('|'), argsWhere, problems);
      required(args, 'atLeast', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      return;
    }
    case 'combat.biomeBossDefeated':
      rejectUnknownFields(args, ['biomeId'], argsWhere, problems);
      requiredBiome();
      return;
    case 'combat.affinityWin':
      rejectUnknownFields(args, ['affinityId', 'atLeast', 'biomeId'], argsWhere, problems);
      requiredAffinity();
      required(args, 'atLeast', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      if (args.biomeId !== undefined) requiredBiome();
      return;
    case 'combat.statusUsed':
      rejectUnknownFields(args, ['status', 'result', 'biomeId'], argsWhere, problems);
      required(args, 'status', (entry) => entry === 'burn' || entry === 'poison', 'burn|poison', argsWhere, problems);
      required(args, 'result', (entry) => entry === 'win' || entry === 'bossWin', 'win|bossWin', argsWhere, problems);
      if (args.biomeId !== undefined) requiredBiome();
      return;
    case 'combat.actionKindUsed':
      rejectUnknownFields(args, ['actionKind', 'result', 'biomeId'], argsWhere, problems);
      required(args, 'actionKind', (entry) => typeof entry === 'string' && entry in ACTION_KINDS, 'a catalog action kind', argsWhere, problems);
      required(args, 'result', (entry) => entry === 'win' || entry === 'bossWin', 'win|bossWin', argsWhere, problems);
      if (args.biomeId !== undefined) requiredBiome();
      return;
    case 'combat.fastWin':
      rejectUnknownFields(args, ['maxTurns', 'element'], argsWhere, problems);
      required(args, 'maxTurns', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      optional(args, 'element', (entry) => ELEMENTS.includes(entry as Element), ELEMENTS.join('|'), argsWhere, problems);
      return;
    case 'combat.recentLoss':
      rejectUnknownFields(args, ['withinDepth'], argsWhere, problems);
      required(args, 'withinDepth', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      return;
    case 'combat.noLossesInBiome':
      rejectUnknownFields(args, ['biomeId'], argsWhere, problems);
      requiredBiome();
      return;
    case 'combat.revengeReady':
      rejectUnknownFields(args, [], argsWhere, problems);
      return;
    case 'combat.signatureReady':
      rejectUnknownFields(args, ['winsAtLeast', 'bossFinisher'], argsWhere, problems);
      required(args, 'winsAtLeast', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      required(args, 'bossFinisher', (entry) => entry === true, 'exactly true', argsWhere, problems);
      return;
    case 'journey.visitedBiomes':
    case 'journey.completedChains':
      rejectUnknownFields(args, ['op', 'value'], argsWhere, problems);
      required(args, 'op', (entry) => entry === 'gte', 'exactly gte', argsWhere, problems);
      required(args, 'value', (entry) => isInt(entry) && entry > 0, 'a positive integer', argsWhere, problems);
      return;
    case 'callback.queued':
      rejectUnknownFields(args, ['callbackId'], argsWhere, problems);
      required(args, 'callbackId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case callback id', argsWhere, problems);
      return;
    default:
      problems.push({ where: `${where}.fact`, message: `unknown v3 fact ${JSON.stringify(value.fact)}` });
  }
}

function validateV3Binding(
  value: unknown,
  where: string,
  problems: ContentProblem[],
  allowOptional: boolean,
): string | undefined {
  if (!isObj(value)) {
    problems.push({ where, message: 'binding must be an object' });
    return undefined;
  }
  rejectUnknownFields(value, ['as', 'source', 'candidates', 'optional'], where, problems);
  required(value, 'as', (entry) => typeof entry === 'string' && BINDING_SLOTS_V3.includes(entry as typeof BINDING_SLOTS_V3[number]), BINDING_SLOTS_V3.join('|'), where, problems);
  required(value, 'source', (entry) => typeof entry === 'string', 'a binding source', where, problems);
  const expectedSources: Readonly<Record<string, string>> = {
    enemy_id: 'revenge.enemyId',
    revenge_finisher_card_id: 'revenge.finisherCardId',
    signature_card_id: 'signature.cardId',
    mono_type: 'board.monoType',
    destination_biome: 'journey.futureBiome',
  };
  if (typeof value.as === 'string' && BINDING_SLOTS_V3.includes(value.as as typeof BINDING_SLOTS_V3[number])) {
    required(value, 'source', (entry) => entry === expectedSources[value.as as string], `exactly ${expectedSources[value.as]}`, where, problems);
    if (value.as === 'destination_biome') {
      required(value, 'candidates', (entry) => entry === 'unvisited_catalog', 'exactly unvisited_catalog', where, problems);
    } else if (value.candidates !== undefined) {
      problems.push({ where: `${where}.candidates`, message: 'candidates is only valid for destination_biome' });
    }
    if (value.as === 'revenge_finisher_card_id') {
      if (value.optional !== undefined && value.optional !== true) {
        problems.push({ where: `${where}.optional`, message: 'optional must be exactly true when present' });
      } else if (value.optional === true && !allowOptional) {
        problems.push({
          where: `${where}.optional`,
          message: 'optional is valid only in ambient definition bindings, never callback.bind',
        });
      }
    } else if (value.optional !== undefined) {
      problems.push({ where: `${where}.optional`, message: 'optional is only valid for revenge_finisher_card_id' });
    }
    return value.as;
  }
  return undefined;
}

interface SignatureGateAnalysisV3 {
  positiveCount: number;
  branchOnly: boolean;
}

function analyzeSignatureGateV3(
  value: unknown,
  underNot = false,
  underAny = false,
): SignatureGateAnalysisV3 {
  if (!isObj(value)) return { positiveCount: 0, branchOnly: false };
  if (value.fact === 'combat.signatureReady') {
    return underNot
      ? { positiveCount: 0, branchOnly: false }
      : { positiveCount: 1, branchOnly: underAny };
  }
  if (Object.hasOwn(value, 'not')) return analyzeSignatureGateV3(value.not, true, underAny);
  const children = Array.isArray(value.all) ? value.all : Array.isArray(value.any) ? value.any : [];
  const childUnderAny = underAny || Array.isArray(value.any);
  return children.reduce<SignatureGateAnalysisV3>((result, child) => {
    const analysis = analyzeSignatureGateV3(child, underNot, childUnderAny);
    return {
      positiveCount: result.positiveCount + analysis.positiveCount,
      branchOnly: result.branchOnly || analysis.branchOnly,
    };
  }, { positiveCount: 0, branchOnly: false });
}

function validateV3BindingArray(
  value: unknown,
  where: string,
  problems: ContentProblem[],
  allowEmpty: boolean,
  allowOptional: boolean,
): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    problems.push({ where, message: allowEmpty ? 'bind must be an array' : 'bindings must be a non-empty array' });
    return;
  }
  const seen = new Set<string>();
  value.forEach((binding, index) => {
    const at = `${where}[${index}]`;
    const slot = validateV3Binding(binding, at, problems, allowOptional);
    if (slot !== undefined && seen.has(slot)) problems.push({ where: `${at}.as`, message: `duplicate binding slot ${slot}` });
    if (slot !== undefined) seen.add(slot);
  });
}

function validateV3Mutation(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'mutation must be an object' });
    return;
  }
  if (value.op === 'completeStory') {
    required(value, 'storyId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case story id', where, problems);
    rejectUnknownFields(value, ['op', 'storyId'], where, problems);
    return;
  }
  if (value.op !== 'set') {
    required(value, 'op', (entry) => entry === 'completeStory' || entry === 'set', 'completeStory|set', where, problems);
    rejectUnknownFields(value, ['op', 'key', 'value'], where, problems);
    return;
  }
  rejectUnknownFields(value, ['op', 'key', 'value'], where, problems);
  required(value, 'key', (entry) => typeof entry === 'string' && STORY_STATE_KEYS_V3.includes(entry as StoryStateKeyV3), STORY_STATE_KEYS_V3.join('|'), where, problems);
  if (typeof value.key !== 'string' || !STORY_STATE_KEYS_V3.includes(value.key as StoryStateKeyV3)) return;
  const key = value.key as StoryStateKeyV3;
  if (BOOLEAN_STORY_KEYS_V3.has(key)) {
    required(value, 'value', (entry) => typeof entry === 'boolean', 'a boolean', where, problems);
  } else {
    const field = STORY_STATE_V3[key];
    if (field.kind === 'enum') required(value, 'value', (entry) => typeof entry === 'string' && field.values.includes(entry as never), field.values.join('|'), where, problems);
  }
}

function validateV3Mutations(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ where, message: 'mutations must be a non-empty array' });
    return;
  }
  value.forEach((mutation, index) => validateV3Mutation(mutation, `${where}[${index}]`, problems));
}

interface V3OutcomeContext {
  rarity: unknown;
  story: unknown;
}

function validateV3CardChoice(
  raw: Record<string, unknown>,
  where: string,
  problems: ContentProblem[],
  context: V3OutcomeContext,
): void {
  rejectUnknownFields(raw, ['kind', 'filter', 'maxTier', 'capstone'], where, problems);
  if (!Object.hasOwn(raw, 'filter')) problems.push({ where: `${where}.filter`, message: 'missing required field filter' });
  else validateCardFilter(raw.filter, `${where}.filter`, problems);
  required(raw, 'maxTier', (entry) => TIERS.includes(entry as SkillTier), TIERS.join('|'), where, problems);
  optional(raw, 'capstone', (entry) => entry === true, 'exactly true', where, problems);
  if (raw.capstone === true) {
    const authorized = context.rarity === 'secret'
      && isObj(context.story)
      && context.story.stage === 'capstone'
      && context.story.role === 'capstone';
    if (!authorized) {
      problems.push({
        where: `${where}.capstone`,
        message: 'capstone cardChoice requires a Secret capstone/capstone definition',
      });
    }
    if (raw.maxTier !== 'diamond') {
      problems.push({ where: `${where}.maxTier`, message: 'capstone cardChoice maxTier must be diamond' });
    }
  }
}

function validateV3BoundGemChoice(
  raw: Record<string, unknown>,
  where: string,
  problems: ContentProblem[],
): void {
  rejectUnknownFields(raw, ['kind', 'filter', 'boundSubject'], where, problems);
  if (raw.filter !== undefined && raw.boundSubject !== undefined) {
    problems.push({ where, message: 'filter and boundSubject are mutually exclusive' });
  }
  if (raw.filter !== undefined) validateGemFilter(raw.filter, `${where}.filter`, problems);
  if (raw.boundSubject === undefined) return;
  const subjectWhere = `${where}.boundSubject`;
  if (!isObj(raw.boundSubject)) {
    problems.push({ where: subjectWhere, message: 'boundSubject must be an object' });
    return;
  }
  const subject = raw.boundSubject;
  rejectUnknownFields(subject, ['slot', 'cases'], subjectWhere, problems);
  required(subject, 'slot', (entry) => entry === 'mono_type', 'exactly mono_type', subjectWhere, problems);
  const expected = [
    ...WEAPONS.map((type) => `weapon:${type}`),
    ...ELEMENTS.map((type) => `element:${type}`),
  ];
  if (!Array.isArray(subject.cases)) {
    problems.push({ where: `${subjectWhere}.cases`, message: 'cases must be an exhaustive array' });
    return;
  }
  const seen = new Set<string>();
  subject.cases.forEach((candidate, index) => {
    const caseWhere = `${subjectWhere}.cases[${index}]`;
    if (!isObj(candidate)) {
      problems.push({ where: caseWhere, message: 'case must be an object' });
      return;
    }
    rejectUnknownFields(candidate, ['when', 'filter'], caseWhere, problems);
    if (!isObj(candidate.when)) {
      problems.push({ where: `${caseWhere}.when`, message: 'when must be a structured mono subject' });
    } else {
      const whenWhere = `${caseWhere}.when`;
      rejectUnknownFields(candidate.when, ['typeKind', 'type'], whenWhere, problems);
      required(candidate.when, 'typeKind', (entry) => entry === 'weapon' || entry === 'element', 'weapon|element', whenWhere, problems);
      const allowed = candidate.when.typeKind === 'weapon' ? WEAPONS
        : candidate.when.typeKind === 'element' ? ELEMENTS
          : [];
      required(candidate.when, 'type', (entry) => allowed.includes(entry as never), allowed.length === 0 ? 'a known mono type' : allowed.join('|'), whenWhere, problems);
      if (typeof candidate.when.typeKind === 'string' && typeof candidate.when.type === 'string') {
        const key = `${candidate.when.typeKind}:${candidate.when.type}`;
        if (seen.has(key)) problems.push({ where: whenWhere, message: `duplicate bound affinity case ${key}` });
        seen.add(key);
      }
    }
    if (!Object.hasOwn(candidate, 'filter')) {
      problems.push({ where: `${caseWhere}.filter`, message: 'missing required field filter' });
    } else {
      validateGemFilter(candidate.filter, `${caseWhere}.filter`, problems);
    }
  });
  for (const key of expected) {
    if (!seen.has(key)) problems.push({ where: `${subjectWhere}.cases`, message: `missing bound affinity case ${key}` });
  }
  for (const key of seen) {
    if (!expected.includes(key)) problems.push({ where: `${subjectWhere}.cases`, message: `unknown bound affinity case ${key}` });
  }
}

function validateV3TargetedUpgrade(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  rejectUnknownFields(raw, ['kind', 'target', 'fallback'], where, problems);
  if (!isObj(raw.target)) {
    problems.push({ where: `${where}.target`, message: 'target must be an object' });
  } else {
    const target = raw.target;
    rejectUnknownFields(target, ['filter', 'boundSubject'], `${where}.target`, problems);
    const targetCount = Number(target.filter !== undefined) + Number(target.boundSubject !== undefined);
    if (targetCount !== 1) problems.push({ where: `${where}.target`, message: 'target must select exactly one of filter or boundSubject' });
    if (target.filter !== undefined) {
      const at = `${where}.target.filter`;
      if (!isObj(target.filter)) {
        problems.push({ where: at, message: 'filter target must be an object' });
      } else {
        rejectUnknownFields(target.filter, ['where', 'match'], at, problems);
        required(target.filter, 'where', (entry) => entry === 'board' || entry === 'bag' || entry === 'held' || entry === 'any', 'board|bag|held|any', at, problems);
        if (!Object.hasOwn(target.filter, 'match')) problems.push({ where: `${at}.match`, message: 'missing required field match' });
        else validateV3CardMatch(target.filter.match, `${at}.match`, problems, true);
      }
    }
    if (target.boundSubject !== undefined) {
      const at = `${where}.target.boundSubject`;
      if (!isObj(target.boundSubject)) {
        problems.push({ where: at, message: 'boundSubject must be an object' });
      } else {
        rejectUnknownFields(target.boundSubject, ['slot', 'typeKind'], at, problems);
        required(target.boundSubject, 'slot', (entry) => entry === 'revenge_finisher_card_id' || entry === 'signature_card_id' || entry === 'mono_type', 'revenge_finisher_card_id|signature_card_id|mono_type', at, problems);
        if (target.boundSubject.slot === 'mono_type') {
          optional(target.boundSubject, 'typeKind', (entry) => entry === 'weapon' || entry === 'element', 'weapon|element', at, problems);
        } else if (target.boundSubject.typeKind !== undefined) {
          problems.push({ where: `${at}.typeKind`, message: 'typeKind is only valid for mono_type' });
        }
      }
    }
  }
  const fallbackAt = `${where}.fallback`;
  if (!isObj(raw.fallback)) {
    problems.push({ where: fallbackAt, message: 'fallback must be an object' });
  } else if (raw.fallback.kind === 'grantGold') {
    validateGrantGold(raw.fallback, fallbackAt, problems);
  } else if (raw.fallback.kind === 'nothing') {
    validateNothing(raw.fallback, fallbackAt, problems);
  } else {
    problems.push({ where: `${fallbackAt}.kind`, message: 'fallback must be grantGold or nothing' });
    rejectUnknownFields(raw.fallback, ['kind'], fallbackAt, problems);
  }
}

function validateV3DirectOutcome(
  value: unknown,
  where: string,
  problems: ContentProblem[],
  context: V3OutcomeContext,
): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'outcome must be an object' });
    return;
  }
  if (value.kind === 'cardChoice') {
    validateV3CardChoice(value, where, problems, context);
    return;
  }
  if (value.kind === 'gemChoice') {
    validateV3BoundGemChoice(value, where, problems);
    return;
  }
  if (value.kind === 'upgradeCardTargeted') {
    validateV3TargetedUpgrade(value, where, problems);
    return;
  }
  if (value.kind === 'weighted') {
    problems.push({ where: `${where}.kind`, message: 'weighted outcomes cannot be recursive' });
    return;
  }
  validateOutcome(value, where, problems);
}

function labelContainsPercentage(label: string, percentage: number): boolean {
  return new RegExp(`(?:^|[^0-9])${String(percentage)}%(?![0-9])`).test(label);
}

function validateV3Outcome(
  value: unknown,
  where: string,
  problems: ContentProblem[],
  context: V3OutcomeContext,
): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'outcome must be an object' });
    return;
  }
  if (value.kind !== 'weighted') {
    validateV3DirectOutcome(value, where, problems, context);
    return;
  }
  rejectUnknownFields(value, ['kind', 'branches'], where, problems);
  if (!Array.isArray(value.branches) || value.branches.length < 2) {
    problems.push({ where: `${where}.branches`, message: 'weighted branches must contain at least two entries' });
    return;
  }
  const seenIds = new Set<string>();
  const weights: number[] = [];
  let allWeightsValid = true;
  value.branches.forEach((branch, index) => {
    const at = `${where}.branches[${index}]`;
    if (!isObj(branch)) {
      problems.push({ where: at, message: 'weighted branch must be an object' });
      allWeightsValid = false;
      return;
    }
    rejectUnknownFields(branch, ['id', 'label', 'weight', 'outcome', 'mutations'], at, problems);
    required(branch, 'id', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case id', at, problems);
    if (typeof branch.id === 'string' && ID_PATTERN.test(branch.id)) {
      if (seenIds.has(branch.id)) problems.push({ where: `${at}.id`, message: `duplicate weighted branch id ${branch.id}` });
      seenIds.add(branch.id);
    }
    required(branch, 'label', (entry) => typeof entry === 'string' && entry.trim() !== '', 'a non-empty odds label', at, problems);
    required(branch, 'weight', (entry) => isInt(entry) && entry > 0, 'a positive integer', at, problems);
    if (isInt(branch.weight) && branch.weight > 0) weights.push(branch.weight);
    else allWeightsValid = false;
    if (!Object.hasOwn(branch, 'outcome')) problems.push({ where: `${at}.outcome`, message: 'missing required field outcome' });
    else validateV3DirectOutcome(branch.outcome, `${at}.outcome`, problems, context);
    if (branch.mutations !== undefined) validateV3Mutations(branch.mutations, `${at}.mutations`, problems);
  });
  if (!allWeightsValid || weights.length !== value.branches.length) return;
  const percentages = normalizedIntegerPercentagesV3(weights);
  value.branches.forEach((branch, index) => {
    if (!isObj(branch) || typeof branch.label !== 'string') return;
    const percentage = percentages[index]!;
    if (!labelContainsPercentage(branch.label, percentage)) {
      problems.push({ where: `${where}.branches[${index}].label`, message: `label must contain normalized odds ${String(percentage)}%` });
    }
  });
}

function validateV3Callback(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'callback must be an object' });
    return;
  }
  required(value, 'callbackId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case callback id', where, problems);
  required(value, 'eventId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case event id', where, problems);
  required(value, 'contentVersion', (entry) => isInt(entry) && entry >= 1, 'an integer >= 1', where, problems);
  required(value, 'minDepthDelay', (entry) => isInt(entry) && entry >= 1, 'a positive integer', where, problems);
  if (value.destinationThemes === undefined) problems.push({ where: `${where}.destinationThemes`, message: 'missing required field destinationThemes' });
  else validateEnumList(value.destinationThemes, THEMES, `${where}.destinationThemes`, problems);
  if (value.destinationBiomeIds !== undefined) validateEnumList(value.destinationBiomeIds, biomeIds, `${where}.destinationBiomeIds`, problems, { knownIds: new Set(biomeIds) });
  required(value, 'priority', (entry) => inRange(0, 999)(entry), 'an integer 0..999', where, problems);
  if (!Object.hasOwn(value, 'bind')) problems.push({ where: `${where}.bind`, message: 'missing required field bind' });
  else validateV3BindingArray(value.bind, `${where}.bind`, problems, true, false);
  const expiryAt = `${where}.expiry`;
  if (!isObj(value.expiry)) {
    problems.push({ where: expiryAt, message: 'expiry must be an object' });
  } else {
    required(value.expiry, 'expiresAfterNodes', (entry) => isInt(entry) && entry > 0, 'a positive integer', expiryAt, problems);
    if (value.expiry.fallback === 'discard') {
      // Terminal discard is the only scalar fallback.
    } else if (!isObj(value.expiry.fallback)) {
      problems.push({ where: `${expiryAt}.fallback`, message: 'fallback must be discard or an immediate grantGold outcome' });
    } else {
      const fallbackAt = `${expiryAt}.fallback`;
      rejectUnknownFields(value.expiry.fallback, ['outcome'], fallbackAt, problems);
      if (!isObj(value.expiry.fallback.outcome)) {
        problems.push({ where: `${fallbackAt}.outcome`, message: 'fallback outcome must be an object' });
      } else if (value.expiry.fallback.outcome.kind === 'grantGold') {
        validateGrantGold(value.expiry.fallback.outcome, `${fallbackAt}.outcome`, problems);
      } else {
        problems.push({ where: `${fallbackAt}.outcome.kind`, message: 'expiry outcome must be immediate grantGold' });
      }
    }
    rejectUnknownFields(value.expiry, ['expiresAfterNodes', 'fallback'], expiryAt, problems);
  }
  rejectUnknownFields(value, ['callbackId', 'eventId', 'contentVersion', 'minDepthDelay', 'destinationThemes', 'destinationBiomeIds', 'priority', 'bind', 'expiry'], where, problems);
}

function validateV3Choice(
  value: unknown,
  where: string,
  seenIds: Set<string>,
  problems: ContentProblem[],
  context: V3OutcomeContext,
): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'choice must be an object' });
    return;
  }
  required(value, 'id', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case id', where, problems);
  if (typeof value.id === 'string' && ID_PATTERN.test(value.id)) {
    if (seenIds.has(value.id)) problems.push({ where: `${where}.id`, message: `duplicate choice id ${value.id}` });
    seenIds.add(value.id);
  }
  required(value, 'label', (entry) => typeof entry === 'string' && entry.trim() !== '', 'a non-empty string', where, problems);
  optional(value, 'cost', inRange(0, 999), 'an integer 0..999', where, problems);
  if (value.requires !== undefined) validateGate(value.requires, `${where}.requires`, problems);
  if (value.requiresTally !== undefined) validateTallyGate(value.requiresTally, `${where}.requiresTally`, problems);
  if (!Object.hasOwn(value, 'outcome')) problems.push({ where: `${where}.outcome`, message: 'missing required field outcome' });
  else validateV3Outcome(value.outcome, `${where}.outcome`, problems, context);
  if (value.mutations !== undefined) validateV3Mutations(value.mutations, `${where}.mutations`, problems);
  if (value.callback !== undefined) validateV3Callback(value.callback, `${where}.callback`, problems);
  rejectUnknownFields(value, ['id', 'label', 'cost', 'requires', 'requiresTally', 'outcome', 'mutations', 'callback'], where, problems);
}

function validateV3ChoiceSet(
  value: unknown,
  where: string,
  problems: ContentProblem[],
  context: V3OutcomeContext,
): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'choiceSet must be an object' });
    return;
  }
  rejectUnknownFields(value, ['fixed', 'pool'], where, problems);
  const seenIds = new Set<string>();
  if (!Array.isArray(value.fixed)) {
    problems.push({ where: `${where}.fixed`, message: 'fixed must be an array' });
  } else {
    value.fixed.forEach((choice, index) => validateV3Choice(
      choice, `${where}.fixed[${index}]`, seenIds, problems, context,
    ));
    const fixedChoices = value.fixed.filter(isObj);
    if (!fixedChoices.some((choice) => (choice.cost === undefined || choice.cost === 0) && choice.requires === undefined && choice.requiresTally === undefined)) {
      problems.push({ where: `${where}.fixed`, message: 'fixed choices need a guaranteed cost-zero ungated safe exit' });
    }
  }
  let draw = 0;
  if (value.pool !== undefined) {
    if (!isObj(value.pool)) {
      problems.push({ where: `${where}.pool`, message: 'pool must be an object' });
    } else {
      rejectUnknownFields(value.pool, ['draw', 'entries'], `${where}.pool`, problems);
      required(value.pool, 'draw', (entry) => entry === 1, 'exactly 1', `${where}.pool`, problems);
      if (value.pool.draw === 1) draw = 1;
      if (!Array.isArray(value.pool.entries) || value.pool.entries.length === 0) {
        problems.push({ where: `${where}.pool.entries`, message: 'pool entries must be a non-empty array' });
      } else {
        value.pool.entries.forEach((choice, index) => validateV3Choice(
          choice, `${where}.pool.entries[${index}]`, seenIds, problems, context,
        ));
      }
    }
  }
  if (Array.isArray(value.fixed)) {
    const displayedCount = value.fixed.length + draw;
    if (displayedCount < 2 || displayedCount > 3) {
      problems.push({ where, message: 'fixed count plus draw must display exactly 2 or 3 choices' });
    }
  }
}

function validateV3Story(value: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(value)) {
    problems.push({ where, message: 'story must be an object' });
    return;
  }
  required(value, 'storyId', (entry) => typeof entry === 'string' && ID_PATTERN.test(entry), 'a lowercase snake_case story id', where, problems);
  required(value, 'stage', (entry) => entry === 'setup' || entry === 'callback' || entry === 'payoff' || entry === 'capstone', 'setup|callback|payoff|capstone', where, problems);
  required(value, 'role', (entry) => entry === 'setup' || entry === 'callback' || entry === 'payoff' || entry === 'capstone', 'setup|callback|payoff|capstone', where, problems);
  rejectUnknownFields(value, ['storyId', 'stage', 'role'], where, problems);
}

interface V3BoundConsumer {
  slot: string;
  where: string;
}

function collectV3OutcomeBoundConsumers(
  value: unknown,
  where: string,
  consumers: V3BoundConsumer[],
): void {
  if (!isObj(value)) return;
  if (value.kind === 'weighted' && Array.isArray(value.branches)) {
    value.branches.forEach((branch, index) => {
      if (isObj(branch)) {
        collectV3OutcomeBoundConsumers(
          branch.outcome,
          `${where}.branches[${index}].outcome`,
          consumers,
        );
      }
    });
    return;
  }
  const subject = value.kind === 'gemChoice' && isObj(value.boundSubject)
    ? value.boundSubject
    : value.kind === 'upgradeCardTargeted' && isObj(value.target)
      && isObj(value.target.boundSubject)
      ? value.target.boundSubject
      : undefined;
  if (subject !== undefined && typeof subject.slot === 'string') {
    consumers.push({ slot: subject.slot, where: `${where}${value.kind === 'upgradeCardTargeted' ? '.target' : ''}.boundSubject.slot` });
  }
}

function validateV3BindingTopology(
  raw: Record<string, unknown>,
  where: string,
  problems: ContentProblem[],
): void {
  if (!isObj(raw.choiceSet)) return;
  const consumers: V3BoundConsumer[] = [];
  const groups: Array<{ choices: unknown[]; where: string }> = [];
  if (Array.isArray(raw.choiceSet.fixed)) {
    groups.push({ choices: raw.choiceSet.fixed, where: `${where}.choiceSet.fixed` });
  }
  if (isObj(raw.choiceSet.pool) && Array.isArray(raw.choiceSet.pool.entries)) {
    groups.push({ choices: raw.choiceSet.pool.entries, where: `${where}.choiceSet.pool.entries` });
  }
  for (const group of groups) {
    group.choices.forEach((choice, index) => {
      if (!isObj(choice)) return;
      collectV3OutcomeBoundConsumers(
        choice.outcome,
        `${group.where}[${index}].outcome`,
        consumers,
      );
      if (isObj(choice.callback) && Array.isArray(choice.callback.bind)) {
        choice.callback.bind.forEach((binding, bindingIndex) => {
          if (isObj(binding) && typeof binding.as === 'string') {
            consumers.push({
              slot: binding.as,
              where: `${group.where}[${index}].callback.bind[${bindingIndex}].as`,
            });
          }
        });
      }
    });
  }

  const declaredValues = isObj(raw.delivery) && raw.delivery.kind === 'queued_callback'
    ? raw.acceptsBindings
    : raw.bindings;
  const declared = new Set<string>();
  if (Array.isArray(declaredValues)) {
    for (const value of declaredValues) {
      if (typeof value === 'string') declared.add(value);
      else if (isObj(value) && typeof value.as === 'string') declared.add(value.as);
    }
  }
  for (const consumer of consumers) {
    if (!declared.has(consumer.slot)) {
      problems.push({
        where: consumer.where,
        message: `bound subject ${consumer.slot} is not declared by this ${isObj(raw.delivery) && raw.delivery.kind === 'queued_callback' ? 'queued target' : 'ambient definition'}`,
      });
    }
  }
}

function validateV3Definition(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  required(raw, 'title', (entry) => typeof entry === 'string' && entry.trim() !== '', 'a non-empty string', where, problems);
  required(raw, 'body', (entry) => typeof entry === 'string' && entry.trim() !== '', 'a non-empty string', where, problems);
  required(raw, 'theme', (entry) => THEMES.includes(entry as EventTheme), THEMES.join('|'), where, problems);
  required(raw, 'rarity', (entry) => RARITIES.includes(entry as EventRarity), RARITIES.join('|'), where, problems);
  if (raw.artId !== undefined) optional(raw, 'artId', (entry) => EVENT_ART_IDS.includes(entry as EventArtId), EVENT_ART_IDS.join('|'), where, problems);
  if (raw.biomeIds !== undefined) validateEnumList(raw.biomeIds, biomeIds, `${where}.biomeIds`, problems, { knownIds: new Set(biomeIds) });
  if (!Object.hasOwn(raw, 'story')) problems.push({ where: `${where}.story`, message: 'missing required field story' });
  else validateV3Story(raw.story, `${where}.story`, problems);
  if (!Object.hasOwn(raw, 'eligibility')) problems.push({ where: `${where}.eligibility`, message: 'missing required field eligibility' });
  else validateV3Requirement(raw.eligibility, `${where}.eligibility`, problems);
  const deliveryKind = isObj(raw.delivery) ? raw.delivery.kind : undefined;
  if (deliveryKind !== 'ambient' && deliveryKind !== 'queued_callback') {
    problems.push({ where: `${where}.delivery`, message: 'delivery must be ambient or queued_callback' });
  } else rejectUnknownFields(raw.delivery as Record<string, unknown>, ['kind'], `${where}.delivery`, problems);
  required(raw, 'visibility', (entry) => entry === 'visible' || entry === 'hidden_until_eligible' || entry === 'teased_when_due', 'visible|hidden_until_eligible|teased_when_due', where, problems);
  required(raw, 'priority', (entry) => inRange(0, 999)(entry), 'an integer 0..999', where, problems);
  required(raw, 'once', (entry) => entry === 'node' || entry === 'run', 'node|run', where, problems);
  required(raw, 'cooldownNodes', (entry) => isInt(entry) && entry >= 0, 'a non-negative integer', where, problems);
  if (deliveryKind === 'ambient') {
    if (Object.hasOwn(raw, 'acceptsBindings')) {
      problems.push({
        where: `${where}.acceptsBindings`,
        message: 'ambient definitions must not declare acceptsBindings',
      });
    }
    if (raw.bindings !== undefined) {
      validateV3BindingArray(raw.bindings, `${where}.bindings`, problems, false, true);
    }
    if (Array.isArray(raw.bindings) && raw.bindings.some((binding) => (
      isObj(binding) && binding.as === 'signature_card_id' && binding.source === 'signature.cardId'
    ))) {
      const signatureGate = analyzeSignatureGateV3(raw.eligibility);
      if (signatureGate.positiveCount !== 1 || signatureGate.branchOnly) {
        problems.push({
          where: `${where}.bindings`,
          message: 'signature.cardId requires exactly one positive combat.signatureReady gate outside every any/not branch',
        });
      }
    }
  } else if (deliveryKind === 'queued_callback') {
    if (Object.hasOwn(raw, 'bindings')) {
      problems.push({
        where: `${where}.bindings`,
        message: 'queued callback definitions must not declare bindings',
      });
      if (raw.bindings !== undefined) {
        validateV3BindingArray(raw.bindings, `${where}.bindings`, problems, false, false);
      }
    }
    if (raw.acceptsBindings !== undefined) {
      validateEnumList(raw.acceptsBindings, BINDING_SLOTS_V3, `${where}.acceptsBindings`, problems);
    }
  } else {
    // Preserve useful structural diagnostics when delivery itself is malformed.
    if (raw.bindings !== undefined) {
      validateV3BindingArray(raw.bindings, `${where}.bindings`, problems, false, false);
    }
    if (raw.acceptsBindings !== undefined) {
      validateEnumList(raw.acceptsBindings, BINDING_SLOTS_V3, `${where}.acceptsBindings`, problems);
    }
  }
  if (!Object.hasOwn(raw, 'choiceSet')) problems.push({ where: `${where}.choiceSet`, message: 'missing required field choiceSet' });
  else validateV3ChoiceSet(raw.choiceSet, `${where}.choiceSet`, problems, {
    rarity: raw.rarity,
    story: raw.story,
  });
  validateV3BindingTopology(raw, where, problems);
  rejectUnknownFields(raw, [
    'title', 'body', 'theme', 'artId', 'rarity', 'biomeIds', 'story', 'eligibility', 'delivery',
    'visibility', 'priority', 'once', 'cooldownNodes', 'bindings', 'acceptsBindings', 'choiceSet',
  ], where, problems);
}

interface CurrentDefinition {
  id: string;
  version: number;
  schemaVersion: 1 | 2 | 3;
  def: Record<string, unknown>;
  where: string;
}

interface ReferenceEdge {
  target: string;
  where: string;
}

function gatesOf(current: CurrentDefinition): Array<{ gate: Record<string, unknown>; where: string }> {
  const gates: Array<{ gate: Record<string, unknown>; where: string }> = [];
  const add = (value: unknown, where: string): void => { if (isObj(value)) gates.push({ gate: value, where }); };
  if (current.schemaVersion === 3) {
    const visit = (value: unknown, where: string): void => {
      if (!isObj(value)) return;
      if (Array.isArray(value.all)) {
        value.all.forEach((child, index) => visit(child, `${where}.all[${index}]`));
      } else if (Array.isArray(value.any)) {
        value.any.forEach((child, index) => visit(child, `${where}.any[${index}]`));
      } else if (value.not !== undefined) {
        visit(value.not, `${where}.not`);
      } else if (value.fact === 'event.choice' && isObj(value.args)) {
        add(value.args, `${where}.args`);
      }
    };
    visit(current.def.eligibility, `${current.where}.eligibility`);
    if (isObj(current.def.choiceSet)) {
      const choiceGroups: Array<{ choices: unknown[]; where: string }> = [];
      if (Array.isArray(current.def.choiceSet.fixed)) {
        choiceGroups.push({ choices: current.def.choiceSet.fixed, where: `${current.where}.choiceSet.fixed` });
      }
      if (isObj(current.def.choiceSet.pool) && Array.isArray(current.def.choiceSet.pool.entries)) {
        choiceGroups.push({ choices: current.def.choiceSet.pool.entries, where: `${current.where}.choiceSet.pool.entries` });
      }
      for (const group of choiceGroups) {
        group.choices.forEach((choice, index) => {
          if (isObj(choice)) add(choice.requires, `${group.where}[${index}].requires`);
        });
      }
    }
    return gates;
  }
  add(current.def.requires, `${current.where}.requires`);
  if (Array.isArray(current.def.requiresAll)) {
    current.def.requiresAll.forEach((requirement, index) => {
      if (isObj(requirement) && requirement.kind === 'resolution') add(requirement, `${current.where}.requiresAll[${index}]`);
    });
  }
  if (Array.isArray(current.def.choices)) {
    current.def.choices.forEach((choice, index) => {
      if (isObj(choice)) add(choice.requires, `${current.where}.choices[${index}].requires`);
    });
  }
  return gates;
}

function choiceIdsOf(current: CurrentDefinition): ReadonlySet<string> {
  const ids = new Set<string>();
  const addChoices = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    value.forEach((choice) => {
      if (isObj(choice) && typeof choice.id === 'string') ids.add(choice.id);
    });
  };
  if (current.schemaVersion === 3 && isObj(current.def.choiceSet)) {
    addChoices(current.def.choiceSet.fixed);
    if (isObj(current.def.choiceSet.pool)) addChoices(current.def.choiceSet.pool.entries);
  } else {
    addChoices(current.def.choices);
  }
  return ids;
}

function validateReferencesAndGraph(currentById: Map<string, CurrentDefinition>, problems: ContentProblem[]): void {
  const graph = new Map<string, ReferenceEdge[]>();
  for (const current of currentById.values()) {
    const edges: ReferenceEdge[] = [];
    for (const { gate, where } of gatesOf(current)) {
      if (typeof gate.eventId !== 'string' || !ID_PATTERN.test(gate.eventId)) continue;
      const target = currentById.get(gate.eventId);
      if (gate.eventId === current.id) {
        problems.push({ where: `${where}.eventId`, message: 'an event cannot depend on itself' });
        continue;
      }
      if (target === undefined) {
        problems.push({ where: `${where}.eventId`, message: `unknown event ${gate.eventId}` });
        continue;
      }
      if (Array.isArray(gate.choiceIds)) {
        const targetChoices = choiceIdsOf(target);
        gate.choiceIds.forEach((choiceId, index) => {
          if (typeof choiceId === 'string' && !targetChoices.has(choiceId)) {
            problems.push({ where: `${where}.choiceIds[${index}]`, message: `unknown choice ${choiceId} on event ${gate.eventId}` });
          }
        });
      }
      edges.push({ target: gate.eventId, where: `${where}.eventId` });
    }
    graph.set(current.id, edges);
  }

  // Iterative DFS keeps this public validator non-throwing even for generated
  // documents with dependency chains far deeper than JavaScript's call stack.
  const visitState = new Map<string, 'visiting' | 'done'>();
  for (const root of graph.keys()) {
    if (visitState.get(root) !== undefined) continue;
    const path = [root];
    const pathIndex = new Map<string, number>([[root, 0]]);
    const frames: Array<{ node: string; nextEdge: number }> = [{ node: root, nextEdge: 0 }];
    visitState.set(root, 'visiting');
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const edges = graph.get(frame.node) ?? [];
      if (frame.nextEdge >= edges.length) {
        visitState.set(frame.node, 'done');
        frames.pop();
        pathIndex.delete(frame.node);
        path.pop();
        continue;
      }
      const edge = edges[frame.nextEdge]!;
      frame.nextEdge += 1;
      const targetState = visitState.get(edge.target);
      if (targetState === 'visiting') {
        const cycleStart = pathIndex.get(edge.target) ?? 0;
        const cycle = [...path.slice(cycleStart), edge.target].join(' -> ');
        problems.push({ where: edge.where, message: `event dependency cycle: ${cycle}` });
      } else if (targetState === undefined) {
        visitState.set(edge.target, 'visiting');
        pathIndex.set(edge.target, path.length);
        path.push(edge.target);
        frames.push({ node: edge.target, nextEdge: 0 });
      }
    }
  }

  // Only the first three edges matter to the depth contract. This explicit
  // stack is bounded by input size rather than the JavaScript call stack.
  for (const origin of graph.keys()) {
    const pending: Array<{ node: string; depth: number; trail: ReadonlySet<string> }> = [
      { node: origin, depth: 0, trail: new Set([origin]) },
    ];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const edge of graph.get(current.node) ?? []) {
        if (current.trail.has(edge.target)) continue;
        const nextDepth = current.depth + 1;
        if (nextDepth > 2) {
          problems.push({ where: edge.where, message: `dependency chain from ${origin} is deeper than two edges` });
          continue;
        }
        const trail = new Set(current.trail);
        trail.add(edge.target);
        pending.push({ node: edge.target, depth: nextDepth, trail });
      }
    }
  }
}

export type EventContentSchemaVersion = 1 | 2 | 3;

interface VersionedDefinitionReference {
  schemaVersion: EventContentSchemaVersion;
  def: Record<string, unknown>;
}

function validateV2CallbackReferences(
  document: Record<string, unknown>,
  documentSchemaVersion: EventContentSchemaVersion,
  problems: ContentProblem[],
): void {
  if (!Array.isArray(document.events)) return;
  const definitionsByIdAndVersion = new Map<string, Map<number, VersionedDefinitionReference>>();
  document.events.forEach((event) => {
    if (!isObj(event) || typeof event.id !== 'string' || !Array.isArray(event.versions)) return;
    const definitions = new Map<number, VersionedDefinitionReference>();
    event.versions.forEach((entry) => {
      if (isObj(entry) && isInt(entry.version) && isObj(entry.def)) {
        definitions.set(entry.version, {
          schemaVersion: eventSchemaVersionOfWrapper(documentSchemaVersion, entry),
          def: entry.def,
        });
      }
    });
    definitionsByIdAndVersion.set(event.id, definitions);
  });
  document.events.forEach((event) => {
    if (!isObj(event) || typeof event.id !== 'string' || !Array.isArray(event.versions)) return;
    event.versions.forEach((entry) => {
      if (!isObj(entry)
        || eventSchemaVersionOfWrapper(documentSchemaVersion, entry) !== 2
        || !isInt(entry.version)
        || !isObj(entry.def)
        || !Array.isArray(entry.def.choices)) return;
      entry.def.choices.forEach((choice, choiceIndex) => {
        if (!isObj(choice) || !isObj(choice.callback)) return;
        const where = `${event.id}@v${entry.version}.choices[${choiceIndex}].callback`;
        const eventId = choice.callback.eventId;
        const contentVersion = choice.callback.contentVersion;
        if (typeof eventId !== 'string' || !definitionsByIdAndVersion.has(eventId)) {
          problems.push({ where: `${where}.eventId`, message: `unknown callback event ${String(eventId)}` });
          return;
        }
        const target = isInt(contentVersion) ? definitionsByIdAndVersion.get(eventId)!.get(contentVersion) : undefined;
        if (target === undefined) {
          problems.push({ where: `${where}.contentVersion`, message: `unknown callback content version ${String(contentVersion)} for event ${eventId}` });
          return;
        }
        const targetDelivery = target.def.delivery;
        const targetEligibility = target.def.eligibility;
        const callbackId = choice.callback.callbackId;
        const exactQueuedEligibility = target.schemaVersion === 2
          && isObj(targetEligibility)
          && Object.keys(targetEligibility).length === 2
          && targetEligibility.fact === 'callback.queued'
          && isObj(targetEligibility.args)
          && Object.keys(targetEligibility.args).length === 1
          && targetEligibility.args.callbackId === callbackId;
        if (!isObj(targetDelivery) || targetDelivery.kind !== 'queued_callback' || !exactQueuedEligibility) {
          problems.push({
            where: `${where}.eventId`,
            message: 'callback target must be a v2 queued_callback event with exact matching callback.queued eligibility',
          });
        }
      });
    });
  });
}

/** Resolve the validator/runtime contract carried by one already-shaped wrapper. */
export function eventSchemaVersionOfWrapper(
  documentSchemaVersion: EventContentSchemaVersion,
  wrapper: Record<string, unknown>,
): EventContentSchemaVersion {
  if (wrapper.schemaVersion === 1 || wrapper.schemaVersion === 2 || wrapper.schemaVersion === 3) {
    return wrapper.schemaVersion;
  }
  return documentSchemaVersion;
}

function validateV3CallbackReferences(
  document: Record<string, unknown>,
  documentSchemaVersion: EventContentSchemaVersion,
  problems: ContentProblem[],
): void {
  if (!Array.isArray(document.events)) return;
  const definitions = new Map<string, Map<number, VersionedDefinitionReference>>();
  document.events.forEach((event) => {
    if (!isObj(event) || typeof event.id !== 'string' || !Array.isArray(event.versions)) return;
    const byVersion = new Map<number, VersionedDefinitionReference>();
    event.versions.forEach((wrapper) => {
      if (!isObj(wrapper) || !isInt(wrapper.version) || !isObj(wrapper.def)) return;
      byVersion.set(wrapper.version, {
        schemaVersion: eventSchemaVersionOfWrapper(documentSchemaVersion, wrapper),
        def: wrapper.def,
      });
    });
    definitions.set(event.id, byVersion);
  });

  document.events.forEach((event) => {
    if (!isObj(event) || typeof event.id !== 'string' || !Array.isArray(event.versions)) return;
    event.versions.forEach((wrapper) => {
      if (!isObj(wrapper) || !isInt(wrapper.version) || !isObj(wrapper.def)) return;
      if (eventSchemaVersionOfWrapper(documentSchemaVersion, wrapper) !== 3 || !isObj(wrapper.def.choiceSet)) return;
      const groups: Array<{ choices: unknown[]; where: string }> = [];
      if (Array.isArray(wrapper.def.choiceSet.fixed)) {
        groups.push({ choices: wrapper.def.choiceSet.fixed, where: `${event.id}@v${String(wrapper.version)}.choiceSet.fixed` });
      }
      if (isObj(wrapper.def.choiceSet.pool) && Array.isArray(wrapper.def.choiceSet.pool.entries)) {
        groups.push({ choices: wrapper.def.choiceSet.pool.entries, where: `${event.id}@v${String(wrapper.version)}.choiceSet.pool.entries` });
      }
      for (const group of groups) {
        group.choices.forEach((choice, choiceIndex) => {
          if (!isObj(choice) || !isObj(choice.callback)) return;
          const callback = choice.callback;
          const where = `${group.where}[${choiceIndex}].callback`;
          const targetByVersion = typeof callback.eventId === 'string' ? definitions.get(callback.eventId) : undefined;
          if (targetByVersion === undefined) {
            problems.push({ where: `${where}.eventId`, message: `unknown callback event ${String(callback.eventId)}` });
            return;
          }
          const target = isInt(callback.contentVersion) ? targetByVersion.get(callback.contentVersion) : undefined;
          if (target === undefined) {
            problems.push({ where: `${where}.contentVersion`, message: `unknown callback content version ${String(callback.contentVersion)} for event ${String(callback.eventId)}` });
            return;
          }
          const targetEligibility = target.def.eligibility;
          const exactQueuedEligibility = target.schemaVersion === 3
            && isObj(target.def.delivery)
            && target.def.delivery.kind === 'queued_callback'
            && isObj(targetEligibility)
            && Object.keys(targetEligibility).length === 2
            && targetEligibility.fact === 'callback.queued'
            && isObj(targetEligibility.args)
            && Object.keys(targetEligibility.args).length === 1
            && targetEligibility.args.callbackId === callback.callbackId;
          if (!exactQueuedEligibility) {
            problems.push({
              where: `${where}.eventId`,
              message: 'callback target must be a v3 queued_callback event with exact matching callback.queued eligibility',
            });
            return;
          }
          const acceptedSlots = Array.isArray(target.def.acceptsBindings)
            ? target.def.acceptsBindings.filter((slot): slot is string => typeof slot === 'string')
            : [];
          const accepted = new Set(acceptedSlots);
          const producedSlots: string[] = [];
          if (Array.isArray(callback.bind)) {
            callback.bind.forEach((binding, index) => {
              if (isObj(binding) && typeof binding.as === 'string') {
                producedSlots.push(binding.as);
                if (!accepted.has(binding.as)) {
                  problems.push({
                    where: `${where}.bind[${index}].as`,
                    message: `callback target does not require binding ${binding.as}`,
                  });
                }
              }
            });
          }
          const produced = new Set(producedSlots);
          const missing = acceptedSlots.filter((slot) => !produced.has(slot));
          if (missing.length > 0) {
            problems.push({
              where: `${where}.bind`,
              message: `callback is missing target-required binding${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`,
            });
          }
          if (Array.isArray(callback.destinationThemes)
            && typeof target.def.theme === 'string'
            && !callback.destinationThemes.includes(target.def.theme)) {
            problems.push({ where: `${where}.destinationThemes`, message: `callback target theme ${target.def.theme} is not a destination theme` });
          }
          const destinationBiomeIds = callback.destinationBiomeIds;
          const targetBiomeIds = target.def.biomeIds;
          if (Array.isArray(destinationBiomeIds) && Array.isArray(targetBiomeIds)
            && !targetBiomeIds.some((id) => destinationBiomeIds.includes(id))) {
            problems.push({ where: `${where}.destinationBiomeIds`, message: 'callback target biomes do not intersect destination biomes' });
          }
        });
      }
    });
  });
}

export interface EventDocumentValidationOptions {
  /**
   * Reference targets and dependency graphs require the complete catalog. Pack
   * compilation validates local shape first, then performs this phase after
   * its deterministic merge.
   */
  includeCrossEventReferences?: boolean;
}

/** Validate a versioned event document without throwing. */
export function validateEventDocument(
  document: unknown,
  { includeCrossEventReferences = true }: EventDocumentValidationOptions = {},
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (!isObj(document)) return [{ where: 'document', message: 'document must be an object' }];

  const isV2 = document.schemaVersion === 2;
  const isV3 = document.schemaVersion === 3;
  if (document.schemaVersion !== 1 && !isV2 && !isV3) {
    problems.push({ where: 'schemaVersion', message: `unsupported schemaVersion ${JSON.stringify(document.schemaVersion)} (this loader knows 1, 2, or 3)` });
  }
  if (isV3) {
    if (document.storyStateSchema === undefined) {
      problems.push({ where: 'schemaVersion', message: 'schema v3 requires storyStateSchema' });
    } else {
      validateV3StoryStateSchema(document.storyStateSchema, 'storyStateSchema', problems);
    }
    rejectUnknownFields(document, ['schemaVersion', 'storyStateSchema', 'events'], 'document', problems);
  } else if (isV2) {
    if (document.storyStateSchema === undefined) {
      problems.push({ where: 'schemaVersion', message: 'schema v2 requires storyStateSchema' });
    } else if (!isObj(document.storyStateSchema) || Object.keys(document.storyStateSchema).length !== 0) {
      problems.push({ where: 'storyStateSchema', message: 'schema v2 storyStateSchema must be exactly an empty object' });
    }
    rejectUnknownFields(document, ['schemaVersion', 'storyStateSchema', 'events'], 'document', problems);
  } else {
    if (document.notes !== undefined) validateNotes(document.notes, 'notes', problems);
    rejectUnknownFields(document, ['schemaVersion', 'notes', 'events'], 'document', problems);
  }
  if (!Array.isArray(document.events)) {
    problems.push({ where: 'events', message: 'events must be a non-empty array' });
    return problems;
  }
  if (document.events.length === 0) problems.push({ where: 'events', message: 'events must be a non-empty array' });

  const seenIds = new Set<string>();
  const currentById = new Map<string, CurrentDefinition>();
  const documentSchemaVersion: EventContentSchemaVersion = isV3 ? 3 : isV2 ? 2 : 1;
  document.events.forEach((event, eventIndex) => {
    const eventWhere = `events[${eventIndex}]`;
    if (!isObj(event)) {
      problems.push({ where: eventWhere, message: 'event must be an object' });
      return;
    }
    required(event, 'id', (v) => typeof v === 'string' && ID_PATTERN.test(v), 'a non-empty lowercase snake_case id that is not all numeric', eventWhere, problems);
    const id = typeof event.id === 'string' ? event.id : undefined;
    const base = id ?? eventWhere;
    if (id !== undefined) {
      if (seenIds.has(id)) problems.push({ where: id, message: `duplicate document for id ${id}` });
      seenIds.add(id);
    }
    rejectUnknownFields(event, ['id', 'versions'], base, problems);
    if (!Array.isArray(event.versions) || event.versions.length === 0) {
      problems.push({ where: `${base}.versions`, message: 'versions must be a non-empty array of { version, def }' });
      return;
    }
    const versionsSeen = new Set<number>();
    let current: CurrentDefinition | undefined;
    event.versions.forEach((entry, versionIndex) => {
      const entryWhere = `${base}.versions[${versionIndex}]`;
      if (!isObj(entry)) {
        problems.push({ where: entryWhere, message: 'version entry must be an object' });
        return;
      }
      required(entry, 'version', (v) => isInt(v) && v >= 1, 'an integer >= 1', entryWhere, problems);
      const version = isInt(entry.version) ? entry.version : undefined;
      const versionWhere = `${base}@v${String(entry.version)}`;
      if (version !== undefined) {
        if (versionsSeen.has(version)) problems.push({ where: `${versionWhere}.version`, message: `duplicate version ${version}` });
        versionsSeen.add(version);
      }
      optional(entry, 'schemaVersion', (value) => value === 1 || value === 2 || value === 3, '1|2|3', versionWhere, problems);
      rejectUnknownFields(entry, ['version', 'schemaVersion', 'def'], versionWhere, problems);
      if (!isObj(entry.def)) {
        problems.push({ where: `${versionWhere}.def`, message: 'def must be an object' });
        return;
      }
      const schemaVersion = eventSchemaVersionOfWrapper(documentSchemaVersion, entry);
      if (schemaVersion === 3) validateV3Definition(entry.def, versionWhere, problems);
      else if (schemaVersion === 2 && (entry.schemaVersion !== undefined || 'delivery' in entry.def)) validateV2Definition(entry.def, versionWhere, problems);
      // Untagged wrappers in the active v2 aggregate predate the closed-v2
      // definition shape. Keep its established structural branch while the
      // wrapper's resolved identity still correctly inherits envelope v2.
      else if (schemaVersion === 2) validateDefinition(entry.def, versionWhere, problems);
      else validateDefinition(entry.def, versionWhere, problems);
      if (id !== undefined && version !== undefined && (current === undefined || version > current.version)) {
        current = { id, version, schemaVersion, def: entry.def, where: versionWhere };
      }
    });
    if (current !== undefined && !currentById.has(current.id)) currentById.set(current.id, current);
  });

  if (includeCrossEventReferences && problems.length === 0) {
    validateReferencesAndGraph(currentById, problems);
    validateV2CallbackReferences(document, documentSchemaVersion, problems);
    validateV3CallbackReferences(document, documentSchemaVersion, problems);
  }
  return problems;
}

/**
 * Reconstruct a runtime definition from a payload whose owning document has
 * already passed `validateEventDocument` with zero problems. This helper does
 * not independently validate or coerce values. It projects only the declared
 * `EventDef` fields, so envelope-only and unknown top-level payload keys cannot
 * cross the loader boundary even if a caller violates that precondition.
 */
export function eventDefOfDocument(id: string, def: Record<string, unknown>): EventDef {
  const base: Record<string, unknown> = {
    id,
    title: def.title,
    theme: def.theme,
    ...(def.artId !== undefined ? { artId: def.artId } : {}),
    body: def.body,
    choices: def.choices,
    ...(def.rarity !== undefined ? { rarity: def.rarity } : {}),
    ...(def.biomeIds !== undefined ? { biomeIds: def.biomeIds } : {}),
    ...(def.requires !== undefined ? { requires: def.requires } : {}),
    ...(def.requiresTally !== undefined ? { requiresTally: def.requiresTally } : {}),
    ...(def.requiresAll !== undefined ? { requiresAll: def.requiresAll } : {}),
  };
  if (def.delivery !== undefined) {
    Object.assign(base, {
      story: def.story,
      eligibility: def.eligibility,
      delivery: def.delivery,
      visibility: def.visibility,
      priority: def.priority,
      once: def.once,
      cooldownNodes: def.cooldownNodes,
    });
    base.choices = def.choices;
  }
  return base as unknown as EventDef;
}
