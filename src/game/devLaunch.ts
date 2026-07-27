import { enemies } from '../data/enemies';
import { defaultTitleFor, ENEMY_TITLES, MODIFIER_PRESETS, TITLE_PRESETS, type EnemyTitle } from '../run/encounter';
import { demoState, EMPTY_BOARD_OVERRIDES, MAX_FOES, resetDemoState, type DemoState, type EnemyFightConfig, type PrepView } from './demoState';

export type LaunchScene = 'prep' | 'battle' | 'uikit' | 'mprep' | 'mdeck' | 'mbattle' | 'mwiki' | 'desktop-wiki' | 'desktop-prep' | 'desktop-deck' | 'desktop-battle';

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
  const enemyTeam = enemyIds.map((id, index): EnemyFightConfig => {
    const definition = enemies[id]!;
    const title = index === 0 || params.has('title') ? enemyTitle : defaultTitleFor(definition);
    return {
      enemyId: id,
      level: index === 0 || params.has('enemyLevel') ? enemyLevel : Math.max(1, definition.baseDepth),
      title,
      rank: index === 0 || rankParam !== null ? enemyRank : TITLE_PRESETS[title].rank,
      modifiers: index === 0 ? [...enemyModifiers] : [],
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
  };
}

export function applyDevLaunchConfig(search = window.location.search): DevLaunchConfig {
  const config = readDevLaunchConfig(search);
  resetDemoState(stateOverridesFromConfig(config));
  return config;
}
