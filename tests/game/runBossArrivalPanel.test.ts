import { describe, expect, it } from 'vitest';
import { buildEnemyEncounter, type EncounterPack } from '../../src/run/encounter';
import { createRun, type RunNode } from '../../src/run/runState';
import { bossArrivalEyebrow, bossArrivalViewModel, runBossArrivalPanelLayout } from '../../src/game/ui/RunBossArrivalPanel';
import { projectRunScreenTemplate } from '../../src/game/ui/runScreenLayout';
import { runScreenTemplate, type Rect } from '../../src/game/ui/runScreenTemplate';

const boss: RunNode = { id: 'boss-arrival', kind: 'boss', depth: 17, wave: 5, biomeId: 'thornwild' };
const encounter: EncounterPack = { variant: 'solo', units: [buildEnemyEncounter('bramble_matriarch', 1, 'boss')] };

describe('bossArrivalViewModel', () => {
  it.each(['fight', 'shop', 'event'] as const)('does not turn a %s into a boss arrival, even with a boss-titled encounter', (kind) => {
    expect(bossArrivalViewModel(createRun(404), { ...boss, kind }, encounter)).toBeNull();
  });

  it.each([null, { variant: 'solo', units: [] }] as const)('requires a primary encounter unit', (pack) => {
    expect(bossArrivalViewModel(createRun(404), boss, pack as EncounterPack | null)).toBeNull();
  });

  it('shows exact committed boss facts and stamped region art, using effective level', () => {
    expect(bossArrivalViewModel(createRun(404), boss, encounter)).toEqual({
      nodeId: 'boss-arrival', bossName: 'The Bramble Matriarch', level: 5,
      title: 'REGION BOSS', regionName: 'The Thornwild', leanLabel: 'NATURE',
      artKey: 'run-art-biome-thornwild', regionDay: 5,
    });
  });

  it('renders the mandatory boss as the fifth regional day, not a reset absolute day', () => {
    const model = bossArrivalViewModel(createRun(404), boss, encounter);
    expect(model).not.toBeNull();
    if (!model) return;
    expect(bossArrivalEyebrow(model)).toBe('MANDATORY DESTINATION · REGION DAY 5/5');
  });

  it('keeps the actual title and enemy ID fallback instead of inventing a catalog name', () => {
    const pack = structuredClone(encounter);
    pack.units[0]!.enemyId = 'missing-boss-id';
    pack.units[0]!.title = 'elite';
    expect(bossArrivalViewModel(createRun(404), boss, pack)).toMatchObject({ bossName: 'missing-boss-id', title: 'REGION BOSS' });
  });

  it('uses the run seed and wave when an old node has no biome stamp', () => {
    const run = createRun(404);
    const stamped = run.map.depths.flat()[0]!;
    const { biomeId: _stamp, ...unstamped } = { ...stamped, kind: 'boss' as const };
    expect(bossArrivalViewModel(run, unstamped, encounter)).toEqual(bossArrivalViewModel(run, { ...unstamped, biomeId: stamped.biomeId }, encounter));
  });

  it('is repeatable and leaves the run, node and encounter byte-identical', () => {
    const run = createRun(404);
    const before = JSON.stringify([run, boss, encounter]);
    const first = bossArrivalViewModel(run, boss, encounter);
    expect(bossArrivalViewModel(run, boss, encounter)).toEqual(first);
    expect(JSON.stringify([run, boss, encounter])).toBe(before);
  });
});

describe('boss arrival layout', () => {
  it.each([
    ['desktop', 1440, 900], ['mobile', 412, 892], ['mobile', 900, 900],
  ] as const)('keeps the %s %ix%i art, facts and action inside the content safe area', (profile, width, height) => {
    const content = projectRunScreenTemplate(runScreenTemplate(profile), { width, height }).regions.content;
    const layout = runBossArrivalPanelLayout(content, { compact: profile === 'mobile' });
    const blocks: Rect[] = [layout.eyebrow, layout.headline, layout.region, ...layout.chips, layout.action];
    expect(layout.art).toEqual(content);
    for (const rect of blocks) {
      expect(rect.x).toBeGreaterThanOrEqual(content.x);
      expect(rect.y).toBeGreaterThanOrEqual(content.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(content.x + content.width + 0.001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(content.y + content.height + 0.001);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
    const rows = [layout.eyebrow, layout.headline, layout.region, layout.chips[0]!, layout.action];
    rows.slice(1).forEach((rect, index) => expect(rect.y - rows[index]!.y - rows[index]!.height).toBeGreaterThanOrEqual(8));
    expect(layout.chips).toHaveLength(3);
    expect(layout.action.height).toBeGreaterThanOrEqual(40);
  });
});
