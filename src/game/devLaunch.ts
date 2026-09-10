import { enemies } from '../data/enemies';
import { skillBook } from '../data/skills';
import { cardOfferableAtTier } from '../engine/types';
import { defaultTitleFor, ELITE_AFFIX_IDS, ENEMY_TITLES, MODIFIER_PRESETS, TITLE_PRESETS, type EnemyTitle } from '../run/encounter';
import { DRAFT_SET_KEYS } from '../run/draft';
import { resolveEventChoice, rollEventForNode } from '../run/events';
import { applyDraftResult, createRun, currentStartDraft, type RunBagSlot, type RunNode, type RunState } from '../run/runState';
import { recordEventInstance } from '../run/eventInstances';
import { demoState, EMPTY_BOARD_OVERRIDES, MAX_FOES, MAX_GOLD, resetDemoState, type DemoState, type EnemyFightConfig, type PrepView } from './demoState';

export type LaunchScene = 'prep' | 'battle' | 'uikit' | 'mprep' | 'mdeck' | 'mbattle' | 'mwiki'
  | 'desktop-wiki' | 'desktop-prep' | 'desktop-deck' | 'desktop-battle'
  | 'desktop-shop' | 'mobile-shop' | 'desktop-draft' | 'mobile-draft'
  | 'desktop-runmap' | 'mrunmap' | 'desktop-runprep' | 'mrunprep'
  | 'desktop-runevent' | 'mrunevent';

export const DEV_EVENT_FIXTURE_IDS = [
  'bell_beneath_ice',
  'the_second_toll',
  'the_bell_unbound',
  'feathered_cairn',
  'far_sight_queued',
  'far_sight_due',
  'far_sight_reloaded',
  'far_sight_follow_mark',
  'far_sight_take_cache',
  'far_sight_ignore_mark',
  'map_intel_2',
  'map_intel_3',
  // The catalog's two mergeCards doors (schema-1) — see `withMergeableBronzeTrio`
  // below for why reaching either of these ALSO arms the board, or the rung
  // renders LOCKED and the merge confirm this fixture exists to reach is never seen.
  'ember_pit',
  'ruined_anvil',
] as const;
export type DevEventFixtureId = (typeof DEV_EVENT_FIXTURE_IDS)[number];

export interface DevLaunchConfig {
  scene: LaunchScene;
  board: 'default' | 'empty';
  enemyId: string;
  enemyIds: string[];
  enemyTeam: EnemyFightConfig[];
  prepView: PrepView;
  seed: number;
  heroLevel: number;
  enemyLevel: number;
  enemyTitle: EnemyTitle;
  enemyRank: number;
  enemyModifiers: string[];
  /** `?affix=braced` — the ELITE AFFIX dealt to the PRIMARY foe, or null.
   * The sandbox twin of the run's `eliteAffixIdFor` deal, so an affix can be
   * deep-linked into the prep screens (and the sandbox fight) without
   * clicking a chip. */
  affix: string | null;
  /** `?gold=N` dev override for the starting wallet, clamped 0..MAX_GOLD. */
  gold: number;
  /** Development-only `?eventFixture=<Bell id>` selector for reproducible
   * run-event screenshot routes. Production builds always resolve this null. */
  eventFixtureId: DevEventFixtureId | null;
}

const PREP_VIEW_MAP: Record<string, PrepView> = {
  prep: 'loadout',
  loadout: 'loadout',
  deck: 'bag',
  deckbuild: 'bag',
  'deck-build': 'bag',
  'deck/build': 'bag',
  bag: 'bag',
  wiki: 'codex',
  codex: 'codex',
  'wiki/card': 'codex',
  'wiki/cards': 'codex',
  opponents: 'opponents',
  'wiki/opponents': 'opponents',
  balance: 'balance',
  'wiki/balance': 'balance',
};

function readSearchParam(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

function parseScene(value: string | null, view: string | null): LaunchScene {
  if (view === 'uikit' || value === 'uikit') return 'uikit';
  if (view === 'mprep' || value === 'mprep') return 'mprep';
  if (view === 'mdeck' || value === 'mdeck') return 'mdeck';
  if (view === 'mbattle' || value === 'mbattle') return 'mbattle';
  if (view === 'mwiki' || value === 'mwiki') return 'mwiki';
  if (view === 'desktop-wiki' || value === 'desktop-wiki') return 'desktop-wiki';
  if (view === 'desktop-prep' || value === 'desktop-prep') return 'desktop-prep';
  if (view === 'desktop-deck' || value === 'desktop-deck') return 'desktop-deck';
  if (view === 'desktop-battle' || value === 'desktop-battle') return 'desktop-battle';
  if (view === 'desktop-shop' || value === 'desktop-shop') return 'desktop-shop';
  if (view === 'mobile-shop' || value === 'mobile-shop') return 'mobile-shop';
  if (view === 'desktop-draft' || value === 'desktop-draft') return 'desktop-draft';
  if (view === 'mobile-draft' || value === 'mobile-draft') return 'mobile-draft';
  if (view === 'desktop-runmap' || value === 'desktop-runmap') return 'desktop-runmap';
  if (view === 'mrunmap' || value === 'mrunmap') return 'mrunmap';
  if (view === 'desktop-runprep' || value === 'desktop-runprep') return 'desktop-runprep';
  if (view === 'mrunprep' || value === 'mrunprep') return 'mrunprep';
  if (view === 'desktop-runevent' || value === 'desktop-runevent') return 'desktop-runevent';
  if (view === 'mrunevent' || value === 'mrunevent') return 'mrunevent';
  return value === 'battle' || value === 'multi' ? 'battle' : 'prep';
}

function parsePrepView(value: string | null): PrepView {
  if (!value) return 'loadout';
  return PREP_VIEW_MAP[value.toLowerCase()] ?? 'loadout';
}

function parseBoard(value: string | null): DevLaunchConfig['board'] {
  return value === 'empty' ? 'empty' : 'default';
}

function parseEnemyId(value: string | null): string {
  if (value && value in enemies) return value;
  return demoState.enemyId;
}

function parseEnemyIds(value: string | null, fallback: string): string[] {
  if (!value) return [fallback];
  const valid = value
    .split(',')
    .map((id) => id.trim())
    // Dedupe is intentional (a deep-link naming the same foe twice is a typo),
    // but the cap tracks MAX_FOES so `?enemies=` can reach any team the + FOE
    // button can build — it was pinned at 2 from the original 2v1 support.
    .filter((id, index, ids) => id in enemies && ids.indexOf(id) === index)
    .slice(0, MAX_FOES);
  return valid.length > 0 ? valid : [fallback];
}

function parseSeed(value: string | null): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.floor(numeric)) : demoState.seed;
}

function parseLevel(value: string | null, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && value !== null ? Math.max(1, Math.floor(numeric)) : fallback;
}

/** `?gold=N` — clamped 0..MAX_GOLD; missing/invalid falls back to the current wallet. */
function parseGold(value: string | null): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && value !== null ? Math.max(0, Math.min(MAX_GOLD, Math.floor(numeric))) : demoState.gold;
}

function parseDevEventFixture(value: string | null): DevEventFixtureId | null {
  return DEV_EVENT_FIXTURE_IDS.find((id) => id === value) ?? null;
}

/**
 * Capture-only WebGL stability switch. Keeping the environment flag as an
 * explicit argument makes the production/default decision independently
 * testable and prevents a query string alone from changing renderer cost in
 * a shipped build.
 */
export function shouldPreserveDrawingBufferForLayoutAudit(isDev: boolean, search: string): boolean {
  return isDev && readSearchParam(search).get('layoutAudit') === '1';
}

function parseTitle(value: string | null, fallback: EnemyTitle): EnemyTitle {
  return value && (ENEMY_TITLES as string[]).includes(value.toLowerCase()) ? (value.toLowerCase() as EnemyTitle) : fallback;
}

/** `?mods=diamond,swift` — unknown ids are dropped (a dev deep-link should not crash boot). */
function parseModifiers(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id, index, ids) => id in MODIFIER_PRESETS && ids.indexOf(id) === index);
}

/** `?affix=braced` (with `&title=elite`) — an id from the ELITE AFFIX pool only. Anything else
 * (unknown, or a DEEP-RUN escalation modifier like `swift`, which is never
 * dealt to an elite) yields null rather than throwing: a dev deep-link must
 * not break boot, and `?mods=` is where escalation modifiers belong. */
function parseAffix(value: string | null): string | null {
  if (!value) return null;
  const id = value.trim().toLowerCase();
  return ELITE_AFFIX_IDS.includes(id) ? id : null;
}

function stateOverridesFromConfig(config: DevLaunchConfig): Partial<DemoState> {
  return {
    ...(config.board === 'empty' ? EMPTY_BOARD_OVERRIDES : {}),
    enemyId: config.enemyId,
    enemyIds: config.enemyIds,
    enemyTeam: config.enemyTeam,
    prepView: config.prepView,
    seed: config.seed,
    heroLevel: config.heroLevel,
    enemyLevel: config.enemyLevel,
    enemyTitle: config.enemyTitle,
    enemyRank: config.enemyRank,
    enemyModifiers: config.enemyModifiers,
    gold: config.gold,
  };
}

export function readDevLaunchConfig(search = window.location.search): DevLaunchConfig {
  const params = readSearchParam(search);
  const multiSample = params.get('scene') === 'multi';
  const enemyId = multiSample ? 'giant_rat' : parseEnemyId(params.get('enemy'));
  const enemyDef = enemies[enemyId];
  const enemyTitle = parseTitle(params.get('title'), enemyDef ? defaultTitleFor(enemyDef) : 'normal');
  const rankParam = params.get('rank');
  const enemyIds = multiSample ? ['giant_rat', 'ember_imp'] : parseEnemyIds(params.get('enemies'), enemyId);
  const enemyLevel = parseLevel(params.get('enemyLevel'), enemyDef?.baseDepth ?? 1);
  const enemyRank = rankParam !== null && Number.isFinite(Number(rankParam))
    ? Math.max(0, Math.floor(Number(rankParam)))
    : TITLE_PRESETS[enemyTitle].rank;
  const enemyModifiers = parseModifiers(params.get('mods'));
  const affix = parseAffix(params.get('affix'));
  const enemyTeam = enemyIds.map((id, index): EnemyFightConfig => {
    const definition = enemies[id]!;
    const title = index === 0 || params.has('title') ? enemyTitle : defaultTitleFor(definition);
    return {
      enemyId: id,
      level: index === 0 || params.has('enemyLevel') ? enemyLevel : Math.max(1, definition.baseDepth),
      title,
      rank: index === 0 || rankParam !== null ? enemyRank : TITLE_PRESETS[title].rank,
      modifiers: index === 0 ? [...enemyModifiers] : [],
      // Only an ELITE carries an affix, the same gate `rollEncounter` applies
      // (`unitAffix = memberTitle === 'elite' ? nodeAffix : null`), so
      // `?affix=` needs `&title=elite` — anything else would deep-link a fight
      // the prep screens deliberately do not show an affix row for.
      affix: index === 0 && title === 'elite' ? affix : null,
    };
  });
  return {
    scene: parseScene(params.get('scene'), params.get('view')),
    board: parseBoard(params.get('board')),
    enemyId,
    enemyIds,
    enemyTeam,
    prepView: parsePrepView(params.get('view')),
    seed: parseSeed(params.get('seed')),
    heroLevel: parseLevel(params.get('heroLevel'), 1),
    enemyLevel,
    enemyTitle,
    // Rank defaults to the title's preset rank unless explicitly overridden.
    enemyRank,
    enemyModifiers,
    affix,
    gold: parseGold(params.get('gold')),
    eventFixtureId: import.meta.env.DEV ? parseDevEventFixture(params.get('eventFixture')) : null,
  };
}

function draftedDevRun(seed: number): RunState {
  const drafted = createRun(seed);
  const hand = currentStartDraft(drafted);
  const picks = Object.fromEntries(DRAFT_SET_KEYS.map((key) => [key, hand[key][0]!.skillId]));
  return applyDraftResult(drafted, picks);
}

/** The smallest deterministic change that arms a `mergeCards` rung ENABLED
 * rather than LOCKED ("need 3 cards of one grade") — three owned BRONZE
 * copies of the same size-1 skill, in the bag's own first three slots (the
 * board is cleared so nothing else can also match and complicate which trio
 * gets read). No `Rng` involved: the skill id is a static catalog lookup.
 * `bagSlots` is PADDED to at least 3 entries rather than assumed to already
 * hold that many — a freshly drafted run's bag is sized to what the draft
 * actually placed there (as few as 0 slots, the rest of the picks landing on
 * the board), so mapping the existing array in place silently did nothing
 * when it was shorter than 3. Every `?eventFixture=` route reaching
 * `ember_pit` or `ruined_anvil` — the catalog's two mergeCards doors —
 * applies this so the merge confirm those fixtures exist to reach is never
 * hidden behind a locked row. */
function withMergeableBronzeTrio(state: RunState): RunState {
  const trioSkillId = Object.values(skillBook).find((skill) => skill.size === 1 && cardOfferableAtTier(skill, 'bronze'))?.id;
  if (trioSkillId === undefined) throw new Error('withMergeableBronzeTrio: no bronze-offerable size-1 skill in the catalog');
  const bagSlots: RunBagSlot[] = [...state.bagSlots];
  while (bagSlots.length < 3) bagSlots.push(null);
  for (let index = 0; index < 3; index += 1) {
    bagSlots[index] = { instanceId: `dev-merge-trio-${index}`, skillId: trioSkillId, tier: 'bronze' };
  }
  return { ...state, pieces: [], bagSlots };
}

/** Park a fixture on a node already present in its map. Keeping the scalar
 * depth aligned with `currentNodeId` matters to every source-relative run
 * reader (callbacks, forecasts, and normal map progression), not only the
 * event resolver. */
function parkDevRunOnEventNode(state: RunState, node: RunNode): RunState {
  return { ...state, depth: node.depth, currentNodeId: node.id };
}

/** Development-only copy of Task 4's concrete map-node installer. It replaces
 * no production map data: fixture state is strictly in-memory and its map
 * depths are cloned before the literal delivery node is installed. */
function installDevEventNode(state: RunState, node: RunNode): RunState {
  const depths = state.map.depths.map((column) => [...column]);
  while (depths.length <= node.depth) depths.push([]);
  depths[node.depth] = [node];
  return parkDevRunOnEventNode({ ...state, map: { ...state.map, depths } }, node);
}

function firstDevEventNode(state: RunState, seed: number): RunNode {
  const eventNode = state.map.depths.flat().find((node) => node.kind === 'event');
  if (!eventNode) throw new Error(`buildDevEventFixture: seed ${seed} has no event node`);
  return eventNode;
}

function featheredCairnSource(state: RunState, seed: number): RunState {
  const eventNode = firstDevEventNode(state, seed);
  return recordEventInstance(parkDevRunOnEventNode(state, eventNode), eventNode.id, {
    eventId: 'feathered_cairn',
    contentVersion: 1,
    instanceId: `event:${eventNode.id}`,
    drawnDepth: eventNode.depth,
  });
}

function farSightQueued(state: RunState, seed: number): RunState {
  return resolveEventChoice(featheredCairnSource(state, seed), 'feathered_cairn', 'read_feathers').state;
}

function farSightDue(state: RunState, seed: number): RunState {
  const queued = farSightQueued(state, seed);
  const source = firstDevEventNode(state, seed);
  const dueNode: RunNode = {
    id: 'dev-far-sight-due',
    depth: source.depth + 2,
    wave: source.wave + 2,
    kind: 'event',
    eventSeed: 0,
    eventTheme: 'omen',
    biomeId: 'arrowfell',
  };
  const installed = installDevEventNode(queued, dueNode);
  const delivered = rollEventForNode(installed, dueNode);
  if (delivered.event.id !== 'feathered_cairn_far_sight') {
    throw new Error(`buildDevEventFixture: expected Far Sight, got ${delivered.event.id}`);
  }
  return delivered.state;
}

/** Build the complete in-memory run needed to open one audited event state.
 * This is dev-launch data, never scene logic: fixture recipes call the same
 * create/draft/record/resolve/roll seams as a player run and never persist. */
export function buildDevEventFixture(eventId: DevEventFixtureId, seed = 1103): RunState {
  const active = draftedDevRun(seed);

  if (eventId === 'feathered_cairn') return featheredCairnSource(active, seed);
  if (eventId === 'far_sight_queued' || eventId === 'map_intel_2') return farSightQueued(active, seed);

  if (eventId === 'far_sight_due') return farSightDue(active, seed);
  if (eventId === 'far_sight_reloaded') return JSON.parse(JSON.stringify(farSightDue(active, seed))) as RunState;
  if (eventId === 'far_sight_follow_mark' || eventId === 'map_intel_3') {
    return resolveEventChoice(farSightDue(active, seed), 'feathered_cairn_far_sight', 'follow_mark').state;
  }
  if (eventId === 'far_sight_take_cache') {
    return resolveEventChoice(farSightDue(active, seed), 'feathered_cairn_far_sight', 'take_cache').state;
  }
  if (eventId === 'far_sight_ignore_mark') {
    return resolveEventChoice(farSightDue(active, seed), 'feathered_cairn_far_sight', 'ignore_mark').state;
  }

  // ember_pit / ruined_anvil each offer a mergeCards rung — arm the board
  // with a mergeable bronze trio before parking on the node, or the rung
  // renders LOCKED ("need 3 cards of one grade") and the merge confirm this
  // fixture exists to reach is never seen (see `withMergeableBronzeTrio`'s
  // own doc comment for why this is deterministic and Rng-free).
  const withBoard = eventId === 'ember_pit' || eventId === 'ruined_anvil'
    ? withMergeableBronzeTrio(active)
    : active;
  const eventNode = firstDevEventNode(withBoard, seed);

  // Only the bell chain's own two CALLBACK ids need a synthetic past-deed
  // resolution installed ahead of time (their content reads
  // `eventResolutions.stage1`/`stage2` to word the recap line and gate a
  // choice) — every other id reaching this fallback (`bell_beneath_ice`
  // itself, `ember_pit`, `ruined_anvil`) starts with none.
  const eventResolutions = eventId === 'the_second_toll' || eventId === 'the_bell_unbound'
    ? {
        stage1: { eventId: 'bell_beneath_ice', contentVersion: 1, instanceId: 'event:stage1', choiceId: 'prise_it_free' },
        ...(eventId === 'the_bell_unbound'
          ? { stage2: { eventId: 'the_second_toll', contentVersion: 1, instanceId: 'event:stage2', choiceId: 'answer_the_bell' } }
          : {}),
      }
    : {};

  return recordEventInstance({
    ...parkDevRunOnEventNode(withBoard, eventNode),
    eventResolutions,
  }, eventNode.id, {
    eventId,
    contentVersion: 1,
    instanceId: `event:${eventNode.id}`,
    drawnDepth: eventNode.depth,
  });
}

export function applyDevLaunchConfig(search = window.location.search): DevLaunchConfig {
  const config = readDevLaunchConfig(search);
  resetDemoState(stateOverridesFromConfig(config));
  return config;
}
