import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import frozenEventsV2 from '../../src/data/content/events.v2.json';
import currentEventsV3 from '../../src/data/content/events.v3.json';
import { isEventDefV3 } from '../../src/data/eventContentV3';
import {
  eventCatalogFromJson,
  loadedEventCatalogFromJson,
  loadEventContent,
} from '../../src/data/eventsContent';
import { compileEventPacks } from '../../scripts/eventPackCompiler';
import { renderEventCatalogWiki } from '../../scripts/generateEventCatalog';

const checkedInWiki = new URL('../../docs/generated/event-catalog.md', import.meta.url);
const discoveryFile = new URL('../../src/data/content/event-discoveries.v1.json', import.meta.url);
const packDirectory = new URL('../../src/data/content/event-packs/', import.meta.url);

function renderCurrentWiki(): string {
  return renderEventCatalogWiki(
    loadEventContent(currentEventsV3) as Parameters<typeof renderEventCatalogWiki>[0],
  );
}

function eventSection(rendered: string, eventId: string): string {
  const start = rendered.indexOf(`## \`${eventId}\` · current version`);
  expect(start, `missing ${eventId} section`).toBeGreaterThanOrEqual(0);
  const next = rendered.indexOf('\n## `', start + 1);
  return rendered.slice(start, next === -1 ? rendered.length : next);
}

function headingSection(rendered: string, heading: string, nextHeading: string): string {
  return rendered.slice(rendered.indexOf(heading), rendered.indexOf(nextHeading));
}

function unescapedPipeCount(line: string): number {
  let count = 0;
  let precedingBackslashes = 0;
  for (const character of line) {
    if (character === '\\') {
      precedingBackslashes += 1;
      continue;
    }
    if (character === '|' && precedingBackslashes % 2 === 0) count += 1;
    precedingBackslashes = 0;
  }
  return count;
}

function forbiddenRuntimeArtifacts(source: string): string[] {
  const normalized = source.replaceAll('\\', '/');
  return [
    ...(normalized.includes('event-discoveries.v1.json') ? ['event-discoveries.v1.json'] : []),
    ...(normalized.includes('event-catalog.md') ? ['docs/generated/event-catalog.md'] : []),
  ];
}

describe('script: event catalog wiki', () => {
  it('documents the active 66-event V3 catalog while preserving the frozen legacy facade', () => {
    const rendered = renderCurrentWiki();
    const materializedHeadings = rendered.match(/^## `[^`]+` · current version `/gm) ?? [];

    expect(materializedHeadings).toHaveLength(66);
    expect(rendered).toContain(
      'This developer wiki is generated from current live `src/data/content/events.v3.json`',
    );
    expect(rendered).toContain(
      'Live runtime selection uses the validated current `src/data/content/events.v3.json` aggregate.',
    );
    expect(rendered).toContain('## `feathered_cairn` · current version `2`');
    expect(rendered).toContain('## `gilded_detour` · current version `1`');
    expect(rendered).toContain('## `missing_road_destination` · current version `1`');
    expect(Object.keys(eventCatalogFromJson)).toHaveLength(44);
    expect(eventCatalogFromJson.gilded_detour).toBeUndefined();
    expect(Object.keys(loadedEventCatalogFromJson)).toHaveLength(66);
    expect(loadedEventCatalogFromJson.gilded_detour).toBeDefined();
    expect(frozenEventsV2.events).toHaveLength(44);
  });

  it('renders deterministically and matches the checked-in generated Markdown', () => {
    const first = renderCurrentWiki();
    const second = renderCurrentWiki();

    expect(first).toBe(second);
    expect(first).toBe(readFileSync(checkedInWiki, 'utf8'));
  });

  it('keeps all generated tables at their declared column count after escaping cell data', () => {
    const discoveries = JSON.parse(readFileSync(discoveryFile, 'utf8')) as {
      discoveries: Array<{ id: string; label: string }>;
    };
    discoveries.discoveries[0]!.label = 'North | South\\Trail\nSecond line';

    const rendered = renderEventCatalogWiki(
      loadEventContent(currentEventsV3) as Parameters<typeof renderEventCatalogWiki>[0],
      discoveries,
    );
    const discoveryRows = headingSection(
      rendered,
      '## Discovery metadata',
      '## Closed schema-v3 fact registry',
    ).split('\n').filter((line) => line.startsWith('|'));
    const factRows = headingSection(
      rendered,
      '## Closed schema-v3 fact registry',
      '## Graph edges',
    ).split('\n').filter((line) => line.startsWith('|'));
    const graphRows = headingSection(
      rendered,
      '## Graph edges',
      '## Materialized definitions',
    ).split('\n').filter((line) => line.startsWith('|'));
    const alteredDiscoveryRow = discoveryRows.find((line) => line.includes('far_sighted'));

    discoveryRows.forEach((line) => {
      expect(unescapedPipeCount(line), line).toBe(5);
    });
    [...factRows, ...graphRows].forEach((line) => {
      expect(unescapedPipeCount(line), line).toBe(4);
    });
    expect(alteredDiscoveryRow).toContain('North \\| South\\\\Trail<br>Second line');
  });

  it('renders validated enum story gates on one line and balances inline code containing backticks', () => {
    const document = structuredClone(currentEventsV3) as any;
    const wrapper = document.events.find((event: any) => event.id === 'gilded_detour');
    const current = wrapper.versions[wrapper.versions.length - 1].def;
    current.eligibility = {
      fact: 'story.flag',
      args: { key: 'grave_path', op: 'in', value: ['opened', 'answered'] },
    };
    const sources = Object.fromEntries(compileEventPacks(packDirectory).sourceFiles.flatMap((source) =>
      source.document.events.map((event) => [event.id, `src/data/content/event-packs/${source.name}`] as const),
    ));
    sources.gilded_detour = 'src/data/content/event-packs/strange`source.json';

    const rendered = renderEventCatalogWiki(
      loadEventContent(document) as Parameters<typeof renderEventCatalogWiki>[0],
      undefined,
      sources,
    );
    const gilded = eventSection(rendered, 'gilded_detour');
    const readable = gilded.split('\n').find((line) => line.startsWith('- Readable requirement:'));

    expect(readable).toBe('- Readable requirement: `story.flag(grave_path in ["opened","answered"])`');
    expect(readable?.match(/`/g)).toHaveLength(2);
    expect(gilded).toContain('- Source pack: `` src/data/content/event-packs/strange`source.json ``');
  });

  it('renders every contracted V3 field with readable gates and persisted dependencies', () => {
    const rendered = renderCurrentWiki();
    const gilded = rendered.slice(
      rendered.indexOf('## `gilded_detour` · current version `1`'),
      rendered.indexOf('## `last_hedge` · current version `1`'),
    );
    const mirror = rendered.slice(
      rendered.indexOf('## `mirror_of_the_board` · current version `1`'),
      rendered.indexOf('## `mirror_transformation` · current version `1`'),
    );

    expect(rendered).toContain('## Closed schema-v3 fact registry');
    expect(rendered).toContain('`combat.signatureReady`');
    expect(rendered).toContain('`RunState.signatureFactLedger`');
    expect(gilded).toContain('Story: `gilded_detour` · stage `payoff` · role `payoff`');
    expect(gilded).toContain('Theme `market` · art `theme fallback` · rarity `uncommon` · biome `any`');
    expect(gilded).toContain('Readable requirement: `ALL(wallet.current gte 15, run.tally.goldSpent gte 10)`');
    expect(gilded).toContain('Delivery `ambient` · visibility `visible` · priority `200` · once `run` · cooldown `0` nodes');
    expect(gilded).toContain('### Fixed choices (always materialized)');
    expect(gilded).toContain('### Seeded choice pool (draw `1`)');
    expect(gilded).toContain('#### Pool choice 1: `buy_gold_upgrade`');
    expect(gilded).toContain('- Cost: `8` gold');
    expect(gilded).toContain('"kind": "upgradeCard"');
    expect(gilded).toContain('`wallet.current` → `RunState.gold`');
    expect(gilded).toContain('`run.tally` → `RunState.stats.goldSpent`');
    expect(mirror).toContain('### Ambient bindings');
    expect(mirror).toContain('"source": "board.monoType"');
    expect(mirror).toContain('`board.monoType` → `RunState.pieces`');
    expect(mirror).toContain('Callback edge: `mirror_of_the_board/enter_mirror` → `mirror_transformation@v1`');
    expect(mirror).toContain('"expiresAfterNodes": 20');
    expect(rendered).toContain('### Accepted callback bindings');
    expect(rendered).toContain('"acceptsBindings"');
    expect(rendered).toContain('"op": "completeStory"');
  });

  it('names the exact signature, future-biome, and queued destination authorities', () => {
    const rendered = renderCurrentWiki();
    const signature = eventSection(rendered, 'card_that_remembered');
    const cartographer = eventSection(rendered, 'cartographers_missing_road');
    const missingRoad = eventSection(rendered, 'missing_road_destination');

    expect(rendered).toContain(
      '| `combat.signatureReady` | `{ winsAtLeast; bossFinisher: true }` | `RunState.signatureFactLedger` |',
    );
    expect(signature).toContain('`combat.signatureReady` → `RunState.signatureFactLedger`');
    expect(signature).not.toContain('combatFactLedger');
    expect(cartographer).toContain(
      '`journey.futureBiome` → `RunState.journeyFactLedger.visitedBiomeIds + RunState.map.seed + current node wave/biomeId + RunState.eventInstances[node.id].instanceId`',
    );
    expect(missingRoad).toContain(
      '- Theme `cache` · art `theme fallback` · rarity `rare` · biome bound persisted `destination_biome` singleton',
    );
    expect(missingRoad).not.toContain('· biome `any`');
  });

  it('renders every current definition field and every authored choice value', () => {
    const content = loadEventContent(currentEventsV3);
    const rendered = renderCurrentWiki();
    const ids = Object.keys(content.catalog).sort();

    ids.forEach((id, eventIndex) => {
      const event = content.catalog[id]!;
      const meta = content.meta[id]!;
      const start = rendered.indexOf(`## \`${id}\` · current version`);
      const nextId = ids[eventIndex + 1];
      const end = nextId === undefined ? rendered.length : rendered.indexOf(`## \`${nextId}\` · current version`);
      const section = rendered.slice(start, end);
      expect(section, id).toContain(`- Identity: \`${id}@v${String(meta.version)}\``);
      meta.versions.forEach((version) => {
        expect(section, `${id}@v${String(version)}`).toContain(`v${String(version)} (schema `);
      });
      expect(section, id).toContain(`- Presentation title: ${JSON.stringify(event.title)}`);
      expect(section, id).toContain(`- Presentation body: ${JSON.stringify(event.body)}`);
      const biomeSummary = isEventDefV3(event)
        && event.delivery.kind === 'queued_callback'
        && event.acceptsBindings?.includes('destination_biome') === true
        ? 'bound persisted `destination_biome` singleton'
        : `\`${event.biomeIds?.join(', ') ?? 'any'}\``;
      expect(section, id).toContain(
        `- Theme \`${event.theme}\` · art \`${event.artId ?? 'theme fallback'}\` · rarity \`${event.rarity ?? 'common (implicit legacy default)'}\` · biome ${biomeSummary}`,
      );

      if (isEventDefV3(event)) {
        expect(section, `${id} story`).toContain(
          `- Story: \`${event.story.storyId}\` · stage \`${event.story.stage}\` · role \`${event.story.role}\``,
        );
        expect(section, `${id} eligibility`).toContain(JSON.stringify(event.eligibility, null, 2));
        expect(section, `${id} selection`).toContain(
          `Delivery \`${event.delivery.kind}\` · visibility \`${event.visibility}\` · priority \`${String(event.priority)}\` · once \`${event.once}\` · cooldown \`${String(event.cooldownNodes)}\` nodes`,
        );
        if (event.bindings !== undefined) expect(section, `${id} bindings`).toContain(JSON.stringify({ bindings: event.bindings }, null, 2));
        if (event.acceptsBindings !== undefined) expect(section, `${id} accepted bindings`).toContain(JSON.stringify({ acceptsBindings: event.acceptsBindings }, null, 2));
      }

      const fixed = isEventDefV3(event) ? event.choiceSet.fixed : event.choices;
      const pool = isEventDefV3(event) ? event.choiceSet.pool?.entries ?? [] : [];
      fixed.forEach((choice, choiceIndex) => {
        expect(section, `${id}/${choice.id} fixed placement`).toContain(
          `#### Fixed choice ${String(choiceIndex + 1)}: \`${choice.id}\``,
        );
      });
      pool.forEach((choice, choiceIndex) => {
        expect(section, `${id}/${choice.id} pool placement`).toContain(
          `#### Pool choice ${String(choiceIndex + 1)}: \`${choice.id}\``,
        );
      });
      if (isEventDefV3(event) && event.choiceSet.pool !== undefined) {
        expect(section, `${id} pool draw`).toContain(
          `### Seeded choice pool (draw \`${String(event.choiceSet.pool.draw)}\`)`,
        );
      }
      for (const choice of [...fixed, ...pool]) {
        expect(section, `${id}/${choice.id}`).toContain(`\`${choice.id}\``);
        expect(section, `${id}/${choice.id}`).toContain(JSON.stringify(choice.label));
        expect(section, `${id}/${choice.id}`).toContain(`- Cost: \`${String(choice.cost ?? 0)}\` gold`);
        expect(section, `${id}/${choice.id}`).toContain(JSON.stringify(choice.outcome, null, 2));
        if ('mutations' in choice && choice.mutations !== undefined) {
          expect(section, `${id}/${choice.id} mutations`).toContain(JSON.stringify(choice.mutations, null, 2));
        }
        if ('callback' in choice && choice.callback !== undefined) {
          expect(section, `${id}/${choice.id} callback`).toContain(JSON.stringify(choice.callback, null, 2));
        }
      }
    });
  });

  it('renders exact weighted branches when a validated catalog authors them', () => {
    const document = structuredClone(currentEventsV3) as any;
    const event = document.events.find((entry: any) => entry.id === 'gilded_detour');
    const current = event.versions[event.versions.length - 1].def;
    current.choiceSet.fixed[0].outcome = {
      kind: 'weighted',
      branches: [
        { id: 'keep_everything', label: 'Keep everything (75%)', weight: 3, outcome: { kind: 'grantGold', amount: 2 } },
        { id: 'lose_a_coin', label: 'Lose a coin (25%)', weight: 1, outcome: { kind: 'grantGold', amount: 1 } },
      ],
    };

    const rendered = renderEventCatalogWiki(
      loadEventContent(document) as Parameters<typeof renderEventCatalogWiki>[0],
    );
    const gilded = rendered.slice(
      rendered.indexOf('## `gilded_detour` · current version `1`'),
      rendered.indexOf('## `last_hedge` · current version `1`'),
    );

    expect(gilded).toContain('"kind": "weighted"');
    expect(gilded).toContain('##### Weighted branch 1: `keep_everything` · weight `3`');
    expect(gilded).toContain('##### Weighted branch 2: `lose_a_coin` · weight `1`');
  });

  it('renders source labels and graph targets that resolve to real packs and headings', () => {
    const rendered = renderCurrentWiki();
    const compiled = compileEventPacks(packDirectory);
    const sourceById = new Map(compiled.sourceFiles.flatMap((source) =>
      source.document.events.map((event) => [event.id, source.name] as const),
    ));

    for (const event of compiled.document.events) {
      const source = sourceById.get(event.id);
      expect(source, event.id).toBeDefined();
      expect(existsSync(new URL(source!, packDirectory)), source).toBe(true);
      expect(rendered).toContain(`- Source pack: \`src/data/content/event-packs/${source}\``);
      expect(rendered).toContain(`## \`${event.id}\` · current version`);
    }

    for (const match of rendered.matchAll(/Callback edge: `[^`]+` → `([^@`]+)@v(\d+)`/g)) {
      const [, targetId, targetVersion] = match;
      expect(rendered).toContain(`## \`${targetId}\` · current version`);
      const target = compiled.document.events.find((event) => event.id === targetId);
      expect(target?.versions.some((version) => version.version === Number(targetVersion))).toBe(true);
    }
  });

  it('keeps discovery JSON and generated Markdown out of deployable runtime imports', () => {
    const sourceRoot = new URL('../../src/', import.meta.url);
    const runtimeFiles = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(name));
    const importers = runtimeFiles.flatMap((name) => {
      const artifacts = forbiddenRuntimeArtifacts(
        readFileSync(new URL(name.replaceAll('\\', '/'), sourceRoot), 'utf8'),
      );
      return artifacts.map((artifact) => `${name.replaceAll('\\', '/')}: ${artifact}`);
    });
    const practicalSpellings = [
      'import discoveries from "./data/content/event-discoveries.v1.json";',
      'import wiki from "../../docs/generated/event-catalog.md?raw";',
      'new URL("..\\..\\docs\\generated\\event-catalog.md", import.meta.url);',
    ];

    expect(importers).toEqual([]);
    expect(practicalSpellings.map(forbiddenRuntimeArtifacts)).toStrictEqual([
      ['event-discoveries.v1.json'],
      ['docs/generated/event-catalog.md'],
      ['docs/generated/event-catalog.md'],
    ]);
    expect(existsSync(discoveryFile)).toBe(true);
    expect(existsSync(checkedInWiki)).toBe(true);
  });
});
