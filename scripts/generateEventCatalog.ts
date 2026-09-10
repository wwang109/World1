/**
 * Reproducible developer reference for the current live event catalog. Runtime code
 * never reads either this Markdown or the discovery metadata: validated event
 * JSON remains the authority, while V2 stays frozen for historical compatibility.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import discoveryDocument from '../src/data/content/event-discoveries.v1.json';
import currentEvents from '../src/data/content/events.v3.json';
import {
  isEventDefV3,
  type EventBindingSpecV3,
  type EventChoiceV3,
  type EventRequirementV3,
  type LoadedEventDefV3,
} from '../src/data/eventContentV3';
import { isEventDefV2, type EventChoiceV2 } from '../src/data/eventContentV2';
import {
  loadEventContent,
  type LoadedEventContent,
  type LoadedEventDef,
} from '../src/data/eventsContent';
import type { EventChoiceDef, EventDef } from '../src/data/eventTypes';
import { compileEventPacks } from './eventPackCompiler';

const OUTPUT_PATH = new URL('../docs/generated/event-catalog.md', import.meta.url);
const PACK_DIRECTORY = new URL('../src/data/content/event-packs/', import.meta.url);

type EventFactV3 = Extract<EventRequirementV3, { fact: string }>;
type EventChoice = EventChoiceDef | EventChoiceV2 | EventChoiceV3;

export interface EventDiscoveryMetadata {
  readonly id: string;
  readonly label: string;
  readonly eventId: string;
  readonly accountStatus: 'future';
}

export interface EventDiscoveryDocument {
  readonly schemaVersion: 1;
  readonly discoveries: readonly EventDiscoveryMetadata[];
}

export interface EventDiscoveryProblem {
  readonly where: string;
  readonly message: string;
}

const FACT_REGISTRY = [
  { fact: 'wallet.current', args: '{ op: eq | gte | lte; value: integer }', dependency: 'RunState.gold' },
  { fact: 'lives.current', args: '{ op: eq | gte | lte; value: integer }', dependency: 'RunState.lives' },
  { fact: 'node.depth', args: '{ op: eq | gte | lte; value: integer }', dependency: 'RunState.map + current event node' },
  { fact: 'node.wave', args: '{ op: eq | gte | lte; value: integer }', dependency: 'RunState.map + current event node' },
  { fact: 'run.tally', args: '{ stat; op: eq | gte | lte; value: integer }', dependency: 'RunState wins/losses/bossesCleared/stats' },
  { fact: 'event.choice', args: '{ eventId; choiceIds? }', dependency: 'RunState.eventResolutions' },
  { fact: 'story.flag', args: '{ key; op; value }', dependency: 'RunState.storyStateV3' },
  { fact: 'chain.completed', args: '{ storyId }', dependency: 'RunState.completedStoryIds' },
  { fact: 'biome.current', args: '{ ids }', dependency: 'RunState.map + current event node' },
  { fact: 'board.affinity', args: '{ affinityId }', dependency: 'RunState.pieces' },
  { fact: 'board.isMonoType', args: '{ typeKind: weapon | element }', dependency: 'RunState.pieces' },
  { fact: 'owned.card.count', args: '{ where; count; match; tierAtLeast? }', dependency: 'RunState.pieces/bagSlots/held' },
  { fact: 'owned.gem.count', args: '{ where; count; match }', dependency: 'RunState.gemInventory + socketed pieces' },
  { fact: 'combat.enemyDefeated', args: '{ enemyId | weaponAffinity; atLeast }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.biomeBossDefeated', args: '{ biomeId }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.affinityWin', args: '{ affinityId; atLeast; biomeId? }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.statusUsed', args: '{ status; result; biomeId? }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.actionKindUsed', args: '{ actionKind; result; biomeId? }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.fastWin', args: '{ maxTurns; element? }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.recentLoss', args: '{ withinDepth }', dependency: 'RunState.combatFactLedger + current event node' },
  { fact: 'combat.noLossesInBiome', args: '{ biomeId }', dependency: 'RunState.combatFactLedger' },
  { fact: 'combat.revengeReady', args: '{}', dependency: 'RunState.revengeFactLedger' },
  { fact: 'combat.signatureReady', args: '{ winsAtLeast; bossFinisher: true }', dependency: 'RunState.signatureFactLedger' },
  { fact: 'journey.visitedBiomes', args: '{ op: gte; value }', dependency: 'RunState.journeyFactLedger.visitedBiomeIds' },
  { fact: 'journey.completedChains', args: '{ op: gte; value }', dependency: 'RunState.completedStoryIds' },
  { fact: 'callback.queued', args: '{ callbackId }', dependency: 'RunState.eventCallbackQueue' },
] as const satisfies readonly {
  fact: EventFactV3['fact'];
  args: string;
  dependency: string;
}[];

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function codeBlock(value: unknown): string {
  return `\`\`\`json\n${json(value)}\n\`\`\``;
}

/**
 * Markdown policy for generated dynamic values:
 * - inline values are forced onto one line and fenced with a delimiter longer
 *   than any backtick run in their content;
 * - table values escape structural backslashes/pipes and encode newlines
 *   before they are rendered as plain text or inline code.
 */
function inlineCode(value: string | number): string {
  const content = String(value).replace(/\r\n?|\n/g, '\\n');
  const longestBacktickRun = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map((run) => run.length),
  );
  const delimiter = '`'.repeat(longestBacktickRun + 1);
  const padded = longestBacktickRun === 0 ? content : ` ${content} `;
  return `${delimiter}${padded}${delimiter}`;
}

type MarkdownTableCell =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'code'; readonly value: string | number };

function tableText(value: string): MarkdownTableCell {
  return { kind: 'text', value };
}

function tableCode(value: string | number): MarkdownTableCell {
  return { kind: 'code', value };
}

function escapeTableStructure(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r\n?|\n/g, '<br>');
}

function markdownTableRow(cells: readonly MarkdownTableCell[]): string {
  const rendered = cells.map((cell) => {
    const escaped = escapeTableStructure(String(cell.value));
    return cell.kind === 'code'
      ? inlineCode(escaped)
      : escaped.replaceAll('`', '&#96;');
  });
  return `| ${rendered.join(' | ')} |`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  problems: EventDiscoveryProblem[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) problems.push({ where: `${where}.${key}`, message: `unknown field ${key}` });
  }
}

/**
 * Validate future account metadata against the current live catalog. The
 * metadata deliberately has no runtime loader: this build-only validator is
 * its owner until account progression is implemented.
 */
export function validateEventDiscoveryDocument(
  raw: unknown,
  content: LoadedEventContent<LoadedEventDef>,
): readonly EventDiscoveryProblem[] {
  const problems: EventDiscoveryProblem[] = [];
  if (!isRecord(raw)) return [{ where: 'event discoveries', message: 'document must be an object' }];
  unknownFields(raw, ['schemaVersion', 'discoveries'], 'event discoveries', problems);
  if (raw.schemaVersion !== 1) {
    problems.push({ where: 'event discoveries.schemaVersion', message: 'schemaVersion must be 1' });
  }
  if (!Array.isArray(raw.discoveries)) {
    problems.push({ where: 'event discoveries.discoveries', message: 'discoveries must be an array' });
    return problems;
  }

  const seenIds = new Set<string>();
  const seenOwners = new Set<string>();
  for (let index = 0; index < raw.discoveries.length; index += 1) {
    const value = raw.discoveries[index];
    const where = `event discoveries.discoveries[${String(index)}]`;
    if (!isRecord(value)) {
      problems.push({ where, message: 'discovery must be an object' });
      continue;
    }
    unknownFields(value, ['id', 'label', 'eventId', 'accountStatus'], where, problems);
    const id = value.id;
    const label = value.label;
    const eventId = value.eventId;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) {
      problems.push({ where: `${where}.id`, message: 'id must be stable snake_case' });
    } else if (seenIds.has(id)) {
      problems.push({ where: `${where}.id`, message: `duplicate discovery id ${id}` });
    } else {
      seenIds.add(id);
    }
    if (typeof label !== 'string' || label.trim().length === 0 || label !== label.trim()) {
      problems.push({ where: `${where}.label`, message: 'label must be a trimmed non-empty label' });
    }
    if (value.accountStatus !== 'future') {
      problems.push({ where: `${where}.accountStatus`, message: 'accountStatus must be future' });
    }
    if (typeof eventId !== 'string' || !/^[a-z][a-z0-9_]*$/.test(eventId)) {
      problems.push({ where: `${where}.eventId`, message: 'eventId must be stable snake_case' });
      continue;
    }
    if (seenOwners.has(eventId)) {
      problems.push({ where: `${where}.eventId`, message: `owning event ${eventId} has more than one discovery` });
    } else {
      seenOwners.add(eventId);
    }
    const owner = content.catalog[eventId];
    if (owner === undefined) {
      problems.push({ where: `${where}.eventId`, message: `unknown owning event ${eventId}` });
    } else if (!isEventDefV3(owner) || owner.delivery.kind !== 'ambient') {
      problems.push({ where: `${where}.eventId`, message: `owning event ${eventId} must be a current schema-v3 ambient event` });
    }
  }
  return problems;
}

export function loadEventDiscoveryDocument(
  raw: unknown,
  content: LoadedEventContent<LoadedEventDef>,
): EventDiscoveryDocument {
  const problems = validateEventDiscoveryDocument(raw, content);
  if (problems.length > 0) {
    const detail = problems.map((problem) => `  ${problem.where}: ${problem.message}`).join('\n');
    throw new Error(`event discovery document failed validation with ${String(problems.length)} problem(s):\n${detail}`);
  }
  const document = raw as EventDiscoveryDocument;
  return Object.freeze({
    schemaVersion: 1,
    discoveries: Object.freeze(document.discoveries.map((entry) => Object.freeze({ ...entry }))),
  });
}

function sourceLabelsByEvent(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    compileEventPacks(PACK_DIRECTORY).sourceFiles.flatMap((source) =>
      source.document.events.map((event) => [event.id, `src/data/content/event-packs/${source.name}`] as const),
    ),
  );
}

function schemaOf(event: LoadedEventDef): 1 | 2 | 3 {
  if (isEventDefV3(event)) return 3;
  if (isEventDefV2(event)) return 2;
  return 1;
}

function readableRequirement(requirement: EventRequirementV3): string {
  if ('all' in requirement) return `ALL(${requirement.all.map(readableRequirement).join(', ')})`;
  if ('any' in requirement) return `ANY(${requirement.any.map(readableRequirement).join(', ')})`;
  if ('not' in requirement) return `NOT(${readableRequirement(requirement.not)})`;
  const { fact, args } = requirement;
  if (fact === 'wallet.current' || fact === 'lives.current' || fact === 'node.depth' || fact === 'node.wave') {
    return `${fact} ${args.op} ${String(args.value)}`;
  }
  if (fact === 'run.tally') return `run.tally.${args.stat} ${args.op} ${String(args.value)}`;
  if (fact === 'journey.visitedBiomes' || fact === 'journey.completedChains') {
    return `${fact} ${args.op} ${String(args.value)}`;
  }
  if (fact === 'event.choice') {
    return `event.choice(${args.eventId}${args.choiceIds === undefined ? '' : ` in [${args.choiceIds.join(', ')}]`})`;
  }
  if (fact === 'story.flag') return `story.flag(${args.key} ${args.op} ${JSON.stringify(args.value)})`;
  if (fact === 'chain.completed') return `chain.completed(${args.storyId})`;
  return `${fact}(${JSON.stringify(args)})`;
}

function requirementLeaves(requirement: EventRequirementV3): EventFactV3[] {
  if ('all' in requirement) return requirement.all.flatMap(requirementLeaves);
  if ('any' in requirement) return requirement.any.flatMap(requirementLeaves);
  if ('not' in requirement) return requirementLeaves(requirement.not);
  return [requirement];
}

function factDependency(requirement: EventFactV3): string {
  if (requirement.fact === 'run.tally') {
    const stat = requirement.args.stat;
    return stat === 'wins' || stat === 'losses' || stat === 'bossesCleared'
      ? `RunState.${stat}`
      : `RunState.stats.${stat}`;
  }
  if (requirement.fact === 'story.flag') return `RunState.storyStateV3.${requirement.args.key}`;
  return FACT_REGISTRY.find((entry) => entry.fact === requirement.fact)!.dependency;
}

function persistedDependencies(requirement: EventRequirementV3): string[] {
  const lines: string[] = [];
  for (const leaf of requirementLeaves(requirement)) {
    const line = `${inlineCode(leaf.fact)} → ${inlineCode(factDependency(leaf))}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

function bindingDependency(binding: EventBindingSpecV3): string {
  switch (binding.source) {
    case 'revenge.enemyId':
    case 'revenge.finisherCardId':
      return 'RunState.revengeFactLedger';
    case 'signature.cardId':
      return 'RunState.signatureFactLedger';
    case 'board.monoType':
      return 'RunState.pieces';
    case 'journey.futureBiome':
      return 'RunState.journeyFactLedger.visitedBiomeIds + RunState.map.seed + current node wave/biomeId + RunState.eventInstances[node.id].instanceId';
  }
}

function weightedBranchSections(choice: EventChoice, lines: string[]): void {
  if (choice.outcome.kind !== 'weighted') return;
  choice.outcome.branches.forEach((branch, index) => {
    lines.push(
      '',
      `##### Weighted branch ${String(index + 1)}: ${inlineCode(branch.id)} · weight ${inlineCode(branch.weight)}`,
      '',
      `- Presentation label: ${JSON.stringify(branch.label)}`,
      '- Typed branch outcome:',
      '',
      codeBlock(branch.outcome),
      '',
      branch.mutations === undefined ? '- Typed branch mutations: none' : '- Typed branch mutations:',
    );
    if (branch.mutations !== undefined) lines.push('', codeBlock(branch.mutations));
  });
}

function choiceSection(
  eventId: string,
  choice: EventChoice,
  index: number,
  source: 'Fixed' | 'Pool',
): string[] {
  const lines = [
    `#### ${source} choice ${String(index + 1)}: ${inlineCode(choice.id)}`,
    '',
    `- Presentation label: ${JSON.stringify(choice.label)}`,
    `- Cost: ${inlineCode(choice.cost ?? 0)} gold`,
    '- Typed outcome:',
    '',
    codeBlock(choice.outcome),
  ];
  weightedBranchSections(choice, lines);
  if ('mutations' in choice && choice.mutations !== undefined) {
    lines.push('', '- Typed mutations:', '', codeBlock(choice.mutations));
  } else {
    lines.push('', '- Typed mutations: none');
  }
  if ('callback' in choice && choice.callback !== undefined) {
    lines.push(
      '',
      `- Callback edge: ${inlineCode(`${eventId}/${choice.id}`)} → ${inlineCode(`${choice.callback.eventId}@v${String(choice.callback.contentVersion)}`)}`,
      '- Typed callback (including bindings and expiry/fallback):',
      '',
      codeBlock(choice.callback),
    );
  } else {
    lines.push('', '- Callback: none');
  }
  return lines;
}

const LEGACY_SELECTION_FIELDS = [
  'rarity',
  'biomeIds',
  'requires',
  'requiresTally',
  'requiresAll',
] as const satisfies readonly (keyof EventDef)[];

function legacyDefinitionSection(event: EventDef): string[] {
  const fields = LEGACY_SELECTION_FIELDS.filter((field) => event[field] !== undefined);
  const lines = [
    '- Story: legacy compatibility definition (no schema-v3 story role).',
    `- Theme ${inlineCode(event.theme)} · art ${inlineCode(event.artId ?? 'theme fallback')} · rarity ${inlineCode(event.rarity ?? 'common (implicit legacy default)')} · biome ${inlineCode(event.biomeIds?.join(', ') ?? 'any')}`,
    '- Delivery/selectability: legacy live-compatible selection fields.',
  ];
  if (fields.length > 0) {
    lines.push('', '### Typed legacy selection fields', '');
    for (const field of fields) lines.push(`- ${inlineCode(field)}:`, '', codeBlock(event[field]), '');
  }
  lines.push('', '### Fixed choices (authored order)', '');
  event.choices.forEach((choice, index) => lines.push(...choiceSection(event.id, choice, index, 'Fixed'), ''));
  return lines;
}

function v3BiomeSummary(event: LoadedEventDefV3): string {
  if (event.delivery.kind === 'queued_callback'
    && event.acceptsBindings?.includes('destination_biome') === true) {
    return `bound persisted ${inlineCode('destination_biome')} singleton`;
  }
  return inlineCode(event.biomeIds?.join(', ') ?? 'any');
}

function v3DefinitionSection(event: LoadedEventDefV3): string[] {
  const lines = [
    `- Story: ${inlineCode(event.story.storyId)} · stage ${inlineCode(event.story.stage)} · role ${inlineCode(event.story.role)}`,
    `- Theme ${inlineCode(event.theme)} · art ${inlineCode(event.artId ?? 'theme fallback')} · rarity ${inlineCode(event.rarity)} · biome ${v3BiomeSummary(event)}`,
    '',
    '### Eligibility',
    '',
    `- Readable requirement: ${inlineCode(readableRequirement(event.eligibility))}`,
    '- Typed requirement AST:',
    '',
    codeBlock(event.eligibility),
    '',
    '### Persisted fact dependencies',
    '',
    ...persistedDependencies(event.eligibility).map((dependency) => `- ${dependency}`),
    '',
    '### Delivery and selection',
    '',
    `- Delivery ${inlineCode(event.delivery.kind)} · visibility ${inlineCode(event.visibility)} · priority ${inlineCode(event.priority)} · once ${inlineCode(event.once)} · cooldown ${inlineCode(event.cooldownNodes)} nodes`,
  ];
  if (event.delivery.kind === 'ambient') {
    lines.push('', '### Ambient bindings', '');
    if (event.bindings === undefined || event.bindings.length === 0) {
      lines.push('- None.');
    } else {
      lines.push(codeBlock({ bindings: event.bindings }), '', '- Binding source dependencies:');
      for (const binding of event.bindings) {
        lines.push(`  - ${inlineCode(binding.source)} → ${inlineCode(bindingDependency(binding))}`);
      }
    }
  } else {
    lines.push('', '### Accepted callback bindings', '');
    lines.push(event.acceptsBindings === undefined || event.acceptsBindings.length === 0
      ? '- None.'
      : codeBlock({ acceptsBindings: event.acceptsBindings }));
  }
  lines.push('', '### Fixed choices (always materialized)', '');
  event.choiceSet.fixed.forEach((choice, index) => {
    lines.push(...choiceSection(event.id, choice, index, 'Fixed'), '');
  });
  if (event.choiceSet.pool !== undefined) {
    lines.push(`### Seeded choice pool (draw ${inlineCode(event.choiceSet.pool.draw)})`, '');
    event.choiceSet.pool.entries.forEach((choice, index) => {
      lines.push(...choiceSection(event.id, choice, index, 'Pool'), '');
    });
  } else {
    lines.push('### Seeded choice pool', '', '- None.');
  }
  return lines;
}

function eventChoices(event: LoadedEventDef): readonly EventChoice[] {
  return isEventDefV3(event)
    ? [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])]
    : event.choices;
}

function graphSection(content: LoadedEventContent<LoadedEventDef>): string[] {
  const edges: Array<[string, string, string]> = [];
  for (const eventId of Object.keys(content.catalog).sort()) {
    const event = content.catalog[eventId]!;
    for (const choice of eventChoices(event)) {
      if ('callback' in choice && choice.callback !== undefined) {
        edges.push(['callback', `${eventId}/${choice.id}`, `${choice.callback.eventId}@v${String(choice.callback.contentVersion)}`]);
      }
    }
    if (isEventDefV3(event)) {
      for (const leaf of requirementLeaves(event.eligibility)) {
        if (leaf.fact === 'event.choice') edges.push(['event choice', eventId, leaf.args.eventId]);
        if (leaf.fact === 'chain.completed') edges.push(['completed story', eventId, leaf.args.storyId]);
      }
    } else {
      const requires = [
        ...(event.requires === undefined ? [] : [event.requires]),
        ...(event.requiresAll ?? []).filter((entry) => entry.kind === 'resolution'),
      ];
      for (const requirement of requires) edges.push(['legacy choice', eventId, requirement.eventId]);
      for (const choice of event.choices) {
        if (choice.requires !== undefined) edges.push(['legacy choice', `${eventId}/${choice.id}`, choice.requires.eventId]);
      }
    }
  }
  return [
    '## Graph edges',
    '',
    markdownTableRow([tableText('Kind'), tableText('From'), tableText('To')]),
    markdownTableRow([tableText('---'), tableText('---'), tableText('---')]),
    ...edges.map(([kind, from, to]) => markdownTableRow([
      tableText(kind),
      tableCode(from),
      tableCode(to),
    ])),
  ];
}

/** Render the current, validated catalog in stable id order. */
export function renderEventCatalogWiki(
  content: LoadedEventContent<LoadedEventDef>,
  rawDiscoveries: unknown = discoveryDocument,
  sourceLabels: Readonly<Record<string, string>> = sourceLabelsByEvent(),
): string {
  const discoveries = loadEventDiscoveryDocument(rawDiscoveries, content).discoveries;
  const discoveryByEvent = Object.fromEntries(discoveries.map((entry) => [entry.eventId, entry] as const));
  const lines = [
    '# Event catalog',
    '',
    '> This developer wiki is generated from current live \`src/data/content/events.v3.json\` and \`src/data/content/event-discoveries.v1.json\`. Live runtime selection uses the validated current \`src/data/content/events.v3.json\` aggregate. Frozen \`src/data/content/events.v2.json\` remains the schema-2 compatibility artifact. Do not hand-edit.',
    '',
    'Presentation copy is shown for authoring context only. Runtime behavior dispatches on the structured requirement, choice, outcome, mutation, callback, and binding data shown below. Generated Markdown is never loaded at runtime.',
    '',
    '## Discovery metadata',
    '',
    'These are stable, account-ready labels only. \`accountStatus: future\` means no run or browser-global progression is written yet.',
    '',
    markdownTableRow([
      tableText('Discovery ID'),
      tableText('Label'),
      tableText('Owning ambient event'),
      tableText('Account status'),
    ]),
    markdownTableRow([tableText('---'), tableText('---'), tableText('---'), tableText('---')]),
    ...discoveries.map((entry) => markdownTableRow([
      tableCode(entry.id),
      tableText(entry.label),
      tableCode(entry.eventId),
      tableCode(entry.accountStatus),
    ])),
    '',
    '## Closed schema-v3 fact registry',
    '',
    markdownTableRow([
      tableText('Fact'),
      tableText('Structured arguments'),
      tableText('Persisted/derived dependency'),
    ]),
    markdownTableRow([tableText('---'), tableText('---'), tableText('---')]),
    ...FACT_REGISTRY.map((entry) => markdownTableRow([
      tableCode(entry.fact),
      tableCode(entry.args),
      tableCode(entry.dependency),
    ])),
    '',
    ...graphSection(content),
    '',
    '## Materialized definitions',
  ];

  for (const id of Object.keys(content.catalog).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    const event = content.catalog[id]!;
    const meta = content.meta[id]!;
    const retained = meta.versions.map((version) => {
      const definition = content.versions[id]?.[version];
      return `v${String(version)} (schema ${definition === undefined ? '?' : String(schemaOf(definition))})`;
    }).join(', ');
    lines.push(
      '',
      `## ${inlineCode(id)} · current version ${inlineCode(meta.version)}`,
      '',
      `- Source pack: ${inlineCode(sourceLabels[id] ?? 'unknown pack')}`,
      `- Identity: ${inlineCode(`${id}@v${String(meta.version)}`)}`,
      `- Retained versions: ${retained}`,
      `- Presentation title: ${JSON.stringify(event.title)}`,
      `- Presentation body: ${JSON.stringify(event.body)}`,
    );
    const discovery = discoveryByEvent[id];
    lines.push(
      `- Discovery: ${discovery === undefined
        ? 'none'
        : `${inlineCode(discovery.id)} · ${discovery.label} · account ${inlineCode(discovery.accountStatus)}`}`,
      '',
    );
    lines.push(...(isEventDefV3(event) ? v3DefinitionSection(event) : legacyDefinitionSection(event)));
  }

  return `${lines.join('\n')}\n`;
}

export function writeEventCatalogWiki(): void {
  writeFileSync(
    OUTPUT_PATH,
    renderEventCatalogWiki(loadEventContent(currentEvents)),
    'utf8',
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeEventCatalogWiki();
}
