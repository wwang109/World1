import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventCatalog } from '../../src/data/events';
import { createRun, type RunNode } from '../../src/run/runState';
import * as runStore from '../../src/game/runStore';
import { DesktopRunMapScene } from '../../src/game/scenes/DesktopRunMapScene';
import { MobileRunMapScene } from '../../src/game/scenes/MobileRunMapScene';
import { activeRun } from '../fixtures/eventV2';
import * as routeUi from '../../src/game/ui/RunRouteBoard';
import { bandBannerForWave } from '../../src/game/ui/bandBannerViewModel';
import * as viewportModule from '../../src/game/viewport';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';

// Only the engine boundary is replaced; the scene planner, preview mapping,
// travel renderer and motion registration below are the production functions.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// Phaser scenes are wired statically in the node test environment. These
// contracts guard destination/preview/modal seams; real pixel and interaction
// verification is the separate exact-viewport Task 6 gate.
const source = (name: string) => readFileSync(join(process.cwd(), 'src/game/scenes', name), 'utf8');

describe.each([
  ['Desktop', 'DesktopRunMapScene.ts', 'DesktopDeck', false],
  ['Mobile', 'MobileRunMapScene.ts', 'MobileDeckBuild', true],
] as const)('%s travel map wiring', (profile, file, deck, compact) => {
  const src = source(file);

  it('previews actual event and encounter facts through the shared model before rendering', () => {
    expect(src).toMatch(/import\s*\{[^}]*buildRunTravelChoiceViewModel[^}]*\}\s*from ['"]\.\.\/ui\/runTravelChoiceViewModel/);
    expect(src).toContain('renderRunTravelChoiceCard');
    expect(src).toMatch(/buildRunTravelChoiceViewModel\(run, node, previewRunEvent\(node\), previewEncounter\(node\)\)/);
    expect(src).not.toMatch(/eventThemeBlurb\(|eventArtKey\(|shopCatalog\[/);
  });

  it('keeps the deck, ledger, and retire controls in the approved fixed action roles', () => {
    expect(src).toMatch(/back:\s*\{ label: 'DECK\/BAG'/);
    expect(src).toMatch(/secondary:\s*\{ label: 'RUN LEDGER', onPress: \(\) => \{ this\.statsOverlayOpen = true;/);
    expect(src).toMatch(/tertiary:\s*\{ label: 'RETIRE', danger: true/);
    expect(src).toContain(`this.scene.start('${deck}')`);
    expect(src).toMatch(new RegExp(`renderRunStatsOverlay\\(this, \\{\\s*compact: ${compact}`));
    expect(src).toContain('onClose: () => { this.statsOverlayOpen = false; this.rerender(); }');
  });

  it('keeps pending stops inside the same planner and passes the real model to the return card', () => {
    expect(src).toContain('regionName: band.name');
    expect(src).toContain('CHOOSE YOUR NEXT STOP');
    expect(src).toContain('CHOOSE 1 OF 3');
    expect(src).toMatch(/options\.length === 1 && options\[0\]\?\.kind === 'boss'\s*\? 'MANDATORY'/);
    expect(src).toContain('const pending = currentNode();');
    expect(src).toMatch(/pending\s*\?\s*\[pending\]\s*:\s*choices\(\)/);
    expect(src).toContain('pending: pending !== undefined');
    expect(src).toMatch(/if \(!pending\) pickNode\(node\.id\);/);
  });

  it('routes every original destination safely without an invented mixed column or boss mechanic', () => {
    expect(src).toMatch(new RegExp(`node\\.kind === 'shop' \\? '${profile}Shop' : node\\.kind === 'event' \\? '${profile}RunEvent' : '${profile}RunPrep'`));
    expect(src).not.toMatch(/rollEventForNode|chooseNode\(|generateRunMap|ensureWaves|eventToCombat|mixedChoices|\.splice\(/);
    expect(src).not.toMatch(/kind:\s*['"](?:fight|event|boss|shop)['"]/);
    expect(src).not.toMatch(/from ['"].*ShopScene/);
  });

  it('shows every ordinary event/shop stop together, replacing them only for a committed pending stop', () => {
    expect(src).toContain('const options = pending ? [pending] : choices();');
    expect(src).toContain('const models = options.map((node) => this.choiceViewModel(node));');
    expect(src).toMatch(/options\.forEach\(\(node, index\) => \{\s*renderRunTravelChoiceCard\(this, layout\.cards\[index\]!, models\[index\]!/);
    expect(src).not.toMatch(/choices\(\)\.(?:find|filter|slice)|options\.(?:find|filter|slice)|renderRunEventChoices|currentRunEventViewModel|resolveCurrentRunEvent/);
  });

  it('suppresses route text under true modals but keeps it visible for the embedded region read', () => {
    const flags = [...src.matchAll(/private (\w+Open) = false/g)].map((match) => match[1]!);
    const guard = src.match(/const modalOpen = ([^;]+);/)?.[1] ?? '';
    expect(flags).toContain('statsOverlayOpen');
    for (const flag of flags.filter((flag) => flag !== 'bandReadOpen')) expect(guard, flag).toContain(`this.${flag}`);
    expect(guard).not.toContain('this.bandReadOpen');
    expect(src).toContain('if (!modalOpen) this.renderTrail(run);');
    expect(src.match(/init\(\): void \{([\s\S]*?)\n  \}/)?.[1]).toContain('this.statsOverlayOpen = false;');
  });

  it('retains the existing region guide, earned intel, start/draft and end-run paths', () => {
    expect(src).toContain('bandBannerForWave(run, snapshotRunProgress(run).wave)');
    expect(src).toContain('this.bandReadOpen = true; this.rerender();');
    expect(src).toContain('renderEmbeddedBandRead(this,');
    expect(src).not.toContain('renderBandReadOverlay(this, this.band,');
    expect(src).toContain(compact ? 'renderMobileMapIntelOverlay(' : 'renderDesktopMapIntelRail(');
    expect(src).toContain('currentMapIntel()');
    expect(src).toContain("this.scene.start('Start')");
    expect(src).toContain(`this.scene.start('${profile}Draft')`);
    expect(src).toContain("run.status === 'defeat' || run.status === 'retired'");
    expect(src).toContain('retireActiveRun(); this.rerender();');
  });

  if (compact) it('keeps MAP INTEL on its mobile sheet when the compact profile fills a 900px window', () => {
    expect(src).toContain('const width = Math.min(this.W, 640);');
    expect(src).toContain('mapIntelLayoutModel(currentMapIntel(), { width, height: this.H })');
    expect(src).toContain('const dx = (this.W - width) / 2;');
    expect(src).toContain('this.mobileIntelLayout(),');
  });

  if (compact) it('reserves the 502px phone card stack above the footer while keeping a 40px region opener', () => {
    expect(src).toContain('const regionH = 88;');
    expect(src).toContain('const routeH = 72;');
    expect(src).toContain('y: top + 20, width: w, height: availableH - 20');
    expect(src).toContain('rectangle(textX, content.y + 44, textW, 40,');
  });

  if (!compact) it('uses the approved artwork-first region pane and distinct discovery footer instead of the old banner', () => {
    expect(src).not.toContain('renderRunBandBanner');
    expect(src).toContain('private renderRegionPane(');
    expect(src).toContain('addRunArt(this, band.artKey,');
    expect(src).toContain('fillGradientStyle(UI.panelMuted');
    expect(src).toContain('band.name');
    expect(src).toContain('`${band.leanChip} · ${band.waveRange}`');
    expect(src).toContain('`DESTINATION · ${band.boss.headline}`');
    expect(src).toContain('countdown.headline');
    expect(src).toContain('EXPLORE REGION ›');
    expect(src).toContain('NO DISCOVERIES YET');
    expect(src).toContain('`MAP INTEL · ${intelCount}`');
  });
});

describe('route progress leads the planner on every viewport', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([[false, 1440, 900], [true, 900, 900], [true, 412, 892]] as const)(
    'compact=%s at %i×%i: integrated regional track, then choices', (compact, width, height) => {
      vi.spyOn(viewportModule, 'viewport').mockReturnValue({ width, height });
      const run = createRun(404);
      vi.spyOn(runStore, 'currentMapIntel').mockReturnValue([]);
      const route = vi.spyOn(routeUi, 'renderRunRouteBoard').mockImplementation(() => undefined);
      const texts: Array<{ text: string; y: number }> = [];
      const shape = (x = 0, y = 0, width = 0, height = 0, text = '') => ({
        setOrigin() { return this; }, setStrokeStyle() { return this; }, setInteractive() { return this; },
        setData() { return this; }, on() { return this; }, setFontSize() { return this; },
        x, y, text, setText(value: string) { this.text = value; return this; },
        width, height, displayWidth: width, displayHeight: height, style: { fontSize: 9 },
      });
      const scene = compact ? new MobileRunMapScene() : new DesktopRunMapScene();
      Object.assign(scene, {
        textures: { exists: () => false },
        add: { rectangle: shape, text: (x: number, y: number, text: string) => { texts.push({ text, y }); return shape(x, y, 0, 0, text); } },
        renderRegionPane: () => undefined,
      });
      const internal = scene as unknown as {
        renderTrail: (run: ReturnType<typeof createRun>) => void;
        renderChoiceColumn: (x: number, y: number, w: number, h: number) => void;
        renderChoiceBlock: (x: number, y: number, w: number, h: number) => void;
      };
      const choices = vi.spyOn(internal, compact ? 'renderChoiceBlock' : 'renderChoiceColumn').mockImplementation(() => undefined);
      internal.renderTrail(run);
      const board = route.mock.calls[0]![1];
      expect(route.mock.calls[0]![3]).toMatchObject({
        mode: compact ? 'mobile' : 'desktop',
        regionName: expect.any(String),
      });
      expect(texts.some((text) => text.text === 'EXPEDITION ROUTE')).toBe(false);
      expect(board.y + board.h + 8).toBeLessThanOrEqual(choices.mock.calls[0]![1]);
      expect(board.y + board.h).toBeLessThan(height - 64);
    },
  );
});

describe('approved regional track renderer', () => {
  it.each(['desktop', 'mobile'] as const)('%s renders one compact five-day track with region context', (mode) => {
    const text: string[] = [];
    const circles: Array<{ fillColor: number; strokeWidth: number }> = [];
    const shape = (fillColor = 0) => ({
      x: 0, y: 0, width: 0, height: 0, displayWidth: 0, displayHeight: 0,
      fillColor, strokeWidth: 0, style: { fontSize: 9 },
      setOrigin() { return this; },
      setStrokeStyle(width: number) { this.strokeWidth = width; return this; },
      setFontSize() { return this; }, setData() { return this; },
    });
    const scene = {
      add: {
        rectangle: (_x: number, _y: number, _w: number, _h: number, fillColor = 0) => shape(fillColor),
        circle: (_x: number, _y: number, _radius: number, fillColor = 0) => {
          const circle = shape(fillColor);
          circles.push(circle);
          return circle;
        },
        text: (_x: number, _y: number, value: string) => {
          text.push(value);
          return shape();
        },
      },
    };
    const route = {
      columns: [{ depth: 9, wave: 3, nodeCount: 3, state: 'current' as const }],
      currentDepth: 8,
      nextDepth: 9,
    };
    routeUi.renderRunRouteBoard(scene as never, { x: 10, y: 20, w: mode === 'mobile' ? 268 : 820, h: 72 }, route, {
      mode,
      regionName: 'THE THORNWILD',
    });
    expect(text).toContain('EXPEDITION ROUTE · CROSSING THE THORNWILD');
    expect(text.filter((value) => /^DAY [1-5]$/.test(value))).toEqual(['DAY 3', 'DAY 1', 'DAY 2', 'DAY 3', 'DAY 4', 'DAY 5']);
    expect(text.some((value) => /^D\d+$/.test(value))).toBe(false);
    expect(circles.filter((circle) => circle.strokeWidth === 2)).toHaveLength(1);
  });
});

describe('embedded region read replaces only the choice contents', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])('compact=%s keeps the planner in place and BACK restores unchanged choices', (compact) => {
    const run = createRun(404);
    vi.spyOn(runStore, 'getActiveRun').mockReturnValue(run);
    vi.spyOn(runStore, 'currentNode').mockReturnValue(undefined);
    const destination = { id: 'cache', kind: 'event', depth: 1, wave: 1, eventTheme: 'cache' as const } satisfies RunNode;
    vi.spyOn(runStore, 'choices').mockReturnValue([destination]);
    const embedded = vi.spyOn(routeUi, 'renderEmbeddedBandRead').mockImplementation(() => undefined);
    const text: string[] = [];
    const make = (x = 0, y = 0, w = 0, h = 0, value = '') => ({
      x, y, alpha: 1, width: 0, height: 0, displayWidth: w, displayHeight: h,
      text: value, style: { fontSize: 12 },
      setOrigin() { return this; }, setStrokeStyle() { return this; }, setInteractive() { return this; },
      on() { return this; }, setFontSize() { return this; }, setData() { return this; },
      setText(next: string) { this.text = next; return this; },
    });
    const scene = compact ? new MobileRunMapScene() : new DesktopRunMapScene();
    const rerender = vi.fn();
    Object.assign(scene, {
      bandReadOpen: true,
      band: bandBannerForWave(run, 1),
      rerender,
      add: {
        rectangle: make,
        text: (x: number, y: number, value: string) => { text.push(value); return make(x, y, 0, 0, value); },
      },
    });
    const internal = scene as unknown as {
      band: ReturnType<typeof bandBannerForWave>;
      renderChoiceColumn: (x: number, y: number, w: number, h: number) => void;
      renderChoiceBlock: (x: number, y: number, w: number, h: number) => void;
    };
    if (!internal.band) throw new Error('region presenter missing');
    const before = JSON.stringify(runStore.getActiveRun());
    if (compact) internal.renderChoiceBlock(10, 286, 392, 542);
    else internal.renderChoiceColumn(526, 158, 866, 594);
    expect(text).toContain('CHOOSE YOUR NEXT STOP');
    expect(text).toContain('REGION VIEW');
    expect(embedded).toHaveBeenCalledOnce();
    expect(text).not.toContain('ABANDONED CACHE');
    const opts = embedded.mock.calls[0]![3];
    opts.onBack();
    expect(rerender).toHaveBeenCalledOnce();
    expect(JSON.stringify(runStore.getActiveRun())).toBe(before);
  });

  it.each([
    ['desktop', DESKTOP_PROFILE.minTap],
    ['mobile', MOBILE_PROFILE.minTap],
  ] as const)('the shared %s presenter exposes one BACK target at least as large as the profile minTap', (mode, minTap) => {
    const text: string[] = [];
    const interactive: Array<{ displayWidth: number; displayHeight: number }> = [];
    const shape = (x = 0, y = 0, width = 0, height = 0) => ({
      x, y, width, height, displayWidth: width, displayHeight: height, style: { fontSize: 9 },
      setOrigin() { return this; }, setStrokeStyle() { return this; },
      setInteractive() { interactive.push(this); return this; }, on() { return this; },
      setFontSize() { return this; }, setData() { return this; },
    });
    const scene = {
      add: {
        rectangle: (x: number, y: number, width: number, height: number) => shape(x, y, width, height),
        text: (x: number, y: number, value: string) => { text.push(value); return shape(x, y); },
      },
      tweens: { add: () => undefined },
    };
    const run = createRun(404);
    const band = bandBannerForWave(run, 1);
    routeUi.renderEmbeddedBandRead(scene as never, { x: 10, y: 20, w: 392, h: 500 }, band, { mode, onBack: () => undefined });
    expect(text.filter((value) => value === 'BACK')).toHaveLength(1);
    expect(interactive).toHaveLength(1);
    expect(interactive[0]!.displayWidth).toBeGreaterThanOrEqual(minTap);
    expect(interactive[0]!.displayHeight).toBeGreaterThanOrEqual(minTap);
  });
});

describe('actual scene planner stop composition', () => {
  afterEach(() => vi.restoreAllMocks());
  const nodes: RunNode[] = [
    { id: 'cache', kind: 'event', depth: 1, wave: 1, eventTheme: 'cache' },
    { id: 'shop', kind: 'shop', depth: 1, wave: 1, shopId: 'stormspire' },
    { id: 'training', kind: 'event', depth: 1, wave: 1, eventTheme: 'training' },
  ];
  function draw(compact: boolean, count: number, pending = false) {
    vi.spyOn(runStore, 'getActiveRun').mockReturnValue(createRun(404));
    vi.spyOn(runStore, 'currentNode').mockReturnValue(pending ? nodes[0] : undefined);
    vi.spyOn(runStore, 'choices').mockReturnValue(nodes.slice(0, count));
    vi.spyOn(runStore, 'previewRunEvent').mockImplementation((node) => node.kind !== 'event' ? null
      : node.id === 'cache' ? eventCatalog.abandoned_cache! : eventCatalog.wandering_tutor!);
    vi.spyOn(runStore, 'previewEncounter').mockReturnValue(null);
    const text: string[] = [];
    const targets: object[] = [];
    const make = (x: number, y: number, w = 0, h = 0, value = '') => ({
      x, y, alpha: 1, width: 0, height: 0, displayWidth: w, displayHeight: h,
      text: value, style: { fontSize: 12 },
      setOrigin() { return this; }, setStrokeStyle() { return this; }, setData() { return this; },
      setInteractive() { targets.push(this); return this; }, on() { return this; },
      setFontSize() { return this; }, setText(next: string) { this.text = next; return this; },
    });
    const scene = compact ? new MobileRunMapScene() : new DesktopRunMapScene();
    Object.assign(scene, {
      textures: { exists: () => false },
      add: {
        rectangle: make,
        text: (x: number, y: number, value: string) => { text.push(value); return make(x, y, 0, 0, value); },
        container: (x: number, y: number) => ({ x, y, alpha: 1 }),
      },
      tweens: { add: () => undefined },
    });
    const planner = scene as unknown as {
      renderChoiceColumn: (x: number, y: number, w: number, h: number) => void;
      renderChoiceBlock: (x: number, y: number, w: number, h: number) => void;
    };
    if (compact) planner.renderChoiceBlock(10, 286, 392, 542);
    else planner.renderChoiceColumn(526, 158, 866, 594);
    return { text, targets };
  }

  for (const compact of [false, true]) {
    it.each([2, 3])(`compact=${compact}: all %i ordinary event/shop cards share the planner`, (count) => {
      const result = draw(compact, count);
      expect(result.targets).toHaveLength(count);
      expect(result.text).toContain('ABANDONED CACHE');
      expect(result.text).toContain('STORMSPIRE');
      if (count === 3) expect(result.text).toContain('THE WANDERING TUTOR');
      expect(result.text.filter((value) => value === 'CHOOSE EVENT ›')).toHaveLength(count - 1);
      expect(result.text.filter((value) => value === 'VISIT SHOP ›')).toHaveLength(1);
      expect(result.text.some((value) => value.startsWith('RETURN TO EVENT'))).toBe(false);
      expect(result.text).not.toContain('EVENT OUTCOME');
    });

    it(`compact=${compact}: a committed event replaces the list with one return card, not outcome choices`, () => {
      const result = draw(compact, 3, true);
      expect(result.targets).toHaveLength(1);
      expect(result.text).toContain('RETURN TO EVENT · ABANDONED CACHE');
      expect(result.text).toContain('RETURN TO EVENT ›');
      expect(result.text).not.toContain('STORMSPIRE');
      expect(result.text).not.toContain('CHOOSE EVENT ›');
      expect(result.text).not.toContain('EVENT OUTCOME');
    });
  }
});

describe('actual boss arrival and prep navigation', () => {
  afterEach(() => { vi.restoreAllMocks(); runStore.clearRun(); });

  // The display/input boundary is a structural Phaser double. Store selection,
  // encounter lookup, scene create/planner, card/panel renderers and button
  // handlers remain real. The unchanged shared HUD is outside this probe.
  function sceneProbe(compact: boolean) {
    const text: string[] = [];
    const images: string[] = [];
    const actions: Array<{ press: () => void }> = [];
    const make = (x = 0, y = 0, w = 0, h = 0, value = '') => {
      const handlers: Record<string, () => void> = {};
      return {
        x, y, alpha: 1, width: 0, height: 0, displayWidth: w, displayHeight: h,
        text: value, style: { fontSize: 12 },
        setOrigin() { return this; }, setStrokeStyle() { return this; }, setStroke() { return this; },
        setData() { return this; }, setFillStyle() { return this; },
        setCrop() { return this; }, setScale() { return this; }, setAlpha() { return this; },
        setInteractive() { actions.push({ press: () => handlers.pointerdown?.() }); return this; },
        on(name: string, handler: () => void) { handlers[name] = handler; return this; },
        setFontSize() { return this; }, setText(next: string) { this.text = next; return this; },
      };
    };
    const scene = compact ? new MobileRunMapScene() : new DesktopRunMapScene();
    const start = vi.fn();
    Object.assign(scene, {
      cameras: { main: { setBackgroundColor() {} } },
      scene: { start },
      textures: { exists: () => true, get: () => ({ getSourceImage: () => ({ width: 1024, height: 1024 }) }) },
      add: {
        rectangle: make, ellipse: make,
        text: (x: number, y: number, value: string) => { text.push(value); return make(x, y, 0, 0, value); },
        image: (x: number, y: number, key: string) => { images.push(key); return make(x, y); },
        container: (x: number, y: number) => ({ x, y, alpha: 1 }),
        graphics: () => ({ fillGradientStyle() { return this; }, fillRect() { return this; } }),
      },
      tweens: { add: () => undefined, killTweensOf: () => undefined },
    });
    const internal = scene as unknown as {
      rerender: () => void; renderHud: () => void; renderTrail: () => void;
      renderChoiceColumn: (x: number, y: number, w: number, h: number) => void;
      renderChoiceBlock: (x: number, y: number, w: number, h: number) => void;
    };
    vi.spyOn(internal, 'renderHud').mockImplementation(() => undefined);
    vi.spyOn(internal, 'renderTrail').mockImplementation(() => { text.push('route planner'); });
    vi.spyOn(internal, 'rerender').mockImplementation(() => {
      text.length = 0; images.length = 0; actions.length = 0;
      scene.create();
    });
    const drawChoice = () => compact ? internal.renderChoiceBlock(10, 286, 392, 542)
      : internal.renderChoiceColumn(526, 158, 866, 594);
    return { scene, drawChoice, text, images, actions, start };
  }

  function installNode(kind: RunNode['kind'], fightOption?: RunNode['fightOption'], pending = false) {
    const node: RunNode = {
      id: `${kind}-${fightOption ?? 'single'}`, kind, depth: 1, wave: kind === 'boss' ? 5 : 4,
      fightNumber: kind === 'boss' ? 5 : 4, encounterSeed: 99, biomeId: 'thornwild', fightOption,
      ...(kind === 'shop' ? { shopId: 'stormspire' } : {}),
      ...(kind === 'event' ? { eventTheme: 'cache' as const } : {}),
    };
    const run = activeRun(404);
    runStore.installDevRunFixture({
      ...run, depth: pending ? 1 : 0, currentNodeId: pending ? node.id : null,
      map: { ...run.map, depths: [[], [node]] },
    });
    return node;
  }

  for (const compact of [false, true]) {
    const profile = compact ? 'Mobile' : 'Desktop';
    it(`${profile}: committing the single boss shows arrival; FACE goes to existing prep without another pick or roll`, () => {
      const node = installNode('boss');
      const pick = vi.spyOn(runStore, 'pickNode');
      const preview = vi.spyOn(runStore, 'previewEncounter');
      const current = vi.spyOn(runStore, 'currentEncounter');
      const probe = sceneProbe(compact);
      probe.drawChoice();
      expect(probe.actions).toHaveLength(1);
      probe.actions[0]!.press();
      expect(pick).toHaveBeenCalledExactlyOnceWith(node.id);
      expect(runStore.currentNode()?.id).toBe(node.id);
      expect(probe.start).not.toHaveBeenCalled();
      expect(probe.text).toContain('MANDATORY DESTINATION · DAY 5');
      expect(probe.text).toContain('FACE THE BOSS ›');
      expect(probe.text).not.toContain('route planner');
      expect(probe.text).not.toContain('CHOOSE YOUR NEXT STOP');
      expect(probe.images).toContain('run-art-biome-thornwild');
      expect(probe.actions).toHaveLength(1);
      const before = JSON.stringify(runStore.getActiveRun());
      const rolls = [preview.mock.calls.length, current.mock.calls.length];
      probe.actions[0]!.press();
      expect(probe.start).toHaveBeenCalledExactlyOnceWith(`${profile}RunPrep`);
      expect(pick).toHaveBeenCalledTimes(1);
      expect([preview.mock.calls.length, current.mock.calls.length]).toEqual(rolls);
      expect(JSON.stringify(runStore.getActiveRun())).toBe(before);
    });

    it(`${profile}: a fresh map instance restores arrival from the committed node without a transient flag`, () => {
      installNode('boss', undefined, true);
      const saved = JSON.stringify(runStore.getActiveRun());
      runStore.installDevRunFixture(JSON.parse(saved));
      const pick = vi.spyOn(runStore, 'pickNode');
      const preview = vi.spyOn(runStore, 'previewEncounter');
      const probe = sceneProbe(compact);
      probe.scene.init();
      probe.scene.create();
      expect(probe.text).toContain('MANDATORY DESTINATION · DAY 5');
      expect(probe.text).toContain('FACE THE BOSS ›');
      expect(probe.text).not.toContain('route planner');
      expect(probe.text.some((value) => /CLOSE|BACK|CHOOSE|SHOP|EVENT/.test(value))).toBe(false);
      expect(probe.actions).toHaveLength(1);
      expect(pick).not.toHaveBeenCalled();
      expect(preview).not.toHaveBeenCalled();
      probe.actions[0]!.press();
      expect(probe.start).toHaveBeenCalledExactlyOnceWith(`${profile}RunPrep`);
      expect(JSON.stringify(runStore.getActiveRun())).toBe(saved);
    });

    it.each(['easy', 'standard', 'hard'] as const)(`${profile}: %s fight selection still commits once and goes directly to prep`, (tier) => {
      const node = installNode('fight', tier);
      const pick = vi.spyOn(runStore, 'pickNode');
      const probe = sceneProbe(compact);
      probe.drawChoice();
      probe.actions[0]!.press();
      expect(pick).toHaveBeenCalledExactlyOnceWith(node.id);
      expect(runStore.currentNode()?.id).toBe(node.id);
      expect(probe.start).toHaveBeenCalledExactlyOnceWith(`${profile}RunPrep`);
      expect(probe.text).not.toContain('FACE THE BOSS ›');
    });

    it.each(['event', 'shop'] as const)(`${profile}: a pending %s return keeps its existing route without reselecting`, (kind) => {
      installNode(kind, undefined, true);
      const pick = vi.spyOn(runStore, 'pickNode');
      const probe = sceneProbe(compact);
      probe.drawChoice();
      const before = JSON.stringify(runStore.getActiveRun());
      probe.actions[0]!.press();
      expect(pick).not.toHaveBeenCalled();
      expect(probe.start).toHaveBeenCalledExactlyOnceWith(`${profile}${kind === 'shop' ? 'Shop' : 'RunEvent'}`);
      expect(JSON.stringify(runStore.getActiveRun())).toBe(before);
    });
  }
});
