import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';

const creatures = process.argv.includes('--creatures');
const enemyIds = creatures ? ['giant_rat', 'stone_beetle', 'ember_imp'] : ['pike_conscript', 'toxic_druid', 'cleric'];
const bossId = creatures ? 'wolf_king' : 'greenwood_sovereign';
const biomeId = creatures ? 'howlmoor' : 'arrowfell';
const out = resolve(process.argv[2]?.startsWith('--') ? `docs/screenshots/enemy-portraits${creatures ? '-creatures' : ''}`
  : process.argv[2] ?? 'docs/screenshots/enemy-portraits');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('enemy-portrait-audit') });
const results: unknown[] = [];
const alphaPage = await browser.newPage();
for (const name of [...enemyIds, bossId].map(id => id.replaceAll('_', '-'))) {
  for (const [folder, extension] of [['art-src', 'png'], ['public/game-art', 'webp']]) {
    const path = `${folder}/enemies/${name}-v1.${extension}`;
    const url = `data:image/${extension};base64,${readFileSync(path).toString('base64')}`;
    const stats = await alphaPage.evaluate(async (url) => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0, opaque = 0, partial = 0, solid = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i]! >= 240) solid += 1;
        if (pixels[i] === 0) transparent += 1;
        else if (pixels[i] === 255) opaque += 1;
        else partial += 1;
      }
      return { width: image.width, height: image.height, transparent, opaque, partial, solid };
    }, url);
    console.log(path, stats);
    if (stats.transparent === 0 || stats.solid === 0) throw new Error(`invalid cutout alpha: ${path}`);
    results.push({ path, ...stats });
  }
}
await alphaPage.close();
for (const compact of [false, true]) {
  const platform = compact ? 'mobile' : 'desktop';
  const viewport = compact ? { width: 412, height: 892 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript('globalThis.__name = (value) => value');
  const errors: string[] = [];
  const missingResources: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  page.on('response', response => { if (response.status() >= 400) missingResources.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${process.env.WORLD1_DEV_URL ?? 'http://localhost:5173'}/?scene=${compact ? 'mrunmap' : 'desktop-runmap'}&layoutAudit=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__game?.scene.scenes.some((s: any) => s.sys.isActive()));
  for (const boss of [false, true]) {
    const fixture = await page.evaluate(async ({ compact, boss, enemyIds, bossId, biomeId, creatures }) => {
      const loadedUrl = (path: string): string => performance.getEntriesByType('resource').find(entry => entry.name.includes(path))?.name ?? path;
      const dev = await import(loadedUrl('/src/game/devLaunch.ts'));
      const store = await import(loadedUrl('/src/game/runStore.ts'));
      const run = await import(loadedUrl('/src/run/runState.ts'));
      const map = await import(loadedUrl('/src/run/runMap.ts'));
      const rebuild = await import(loadedUrl('/src/game/sceneRebuild.ts'));
      let state = boss ? dev.buildDevBossFixture(1103) : dev.buildDevEquipmentTrackingFixture(1103, 'fight');
      if (creatures && !boss) {
        state.biomeChoices = { ...state.biomeChoices, 0: biomeId, 1: biomeId };
        state.map = map.ensureWavesThrough(state.map, 6, state.biomeChoices);
        state.depth = state.map.depths.flat().find((node: any) => node.kind === 'fight' && node.wave === 6)!.depth - 1;
      }
      if (boss || creatures) {
        state.biomeChoices = { ...state.biomeChoices, 0: biomeId };
        state.map.depths.flat().forEach((node: any) => { if (node.wave <= 6) node.biomeId = biomeId; });
      }
      if (boss) {
        const node = state.map.depths.flat().find((node: any) => node.kind === 'boss')!;
        for (let seed = 1; seed <= 3000; seed++) {
          node.encounterSeed = seed;
          const pack = run.rollEncounter({ ...state, currentNodeId: node.id });
          if (pack.units[0].enemyId === bossId) break;
          if (seed === 3000) throw new Error('boss fixture search failed');
        }
      } else {
        const nodes = state.map.depths.flat().filter((node: any) => node.depth === state.depth + 1);
        for (const [index, enemyId] of enemyIds.entries()) {
          const node = nodes[index]!;
          for (let seed = 1; seed <= 3000; seed++) {
            node.encounterSeed = seed;
            const pack = run.rollEncounter({ ...state, currentNodeId: node.id });
            if (pack.variant === 'solo' && pack.units[0].enemyId === enemyId) break;
            if (seed === 3000) throw new Error(`regular fixture search failed: ${enemyId}`);
          }
        }
      }
      store.installDevRunFixture(state);
      const scene = (window as any).__game.scene.getScene(compact ? 'MobileRunMap' : 'DesktopRunMap');
      if (scene.sys.isActive()) rebuild.rebuildScene(scene);
      else (window as any).__game.scene.scenes.find((s: any) => s.sys.isActive()).scene.start(compact ? 'MobileRunMap' : 'DesktopRunMap');
      return { depth: state.depth, nodes: (boss ? [store.currentNode()] : store.choices()).map((node: any) => ({ id: node.id, encounter: store.previewEncounter(node) })) };
    }, { compact, boss, enemyIds, bossId, biomeId, creatures });
    await page.waitForTimeout(900);
    const portraits = await page.evaluate((compact) => {
      const scene = (window as any).__game.scene.getScene(compact ? 'MobileRunMap' : 'DesktopRunMap');
      const stack = [...scene.children.list]; const found: any[] = [];
      while (stack.length) {
        const object = stack.pop(); if (object.list) stack.push(...object.list);
        if (/^run-(enemy|boss)-portrait-/.test(object.name ?? '')) {
          const bounds = object.getBounds(); found.push({ name: object.name, texture: object.texture.key,
            width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y });
        }
      }
      return found;
    }, compact);
    const path = `${out}/${platform}-${boss ? 'boss' : 'encounters'}.png`;
    await page.screenshot({ path });
    if (portraits.length !== (boss ? 1 : 3)) { console.log(fixture, errors); throw new Error(`${platform} ${boss ? 'boss' : 'regular'}: ${portraits.length} portraits`); }
    results.push({ platform, boss, viewport, fixture, portraits, errors: [...errors], missingResources: [...missingResources], screenshot: path });
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}/audit.json`, JSON.stringify(results, null, 2));
console.log(`Enemy portrait audit: 8 alpha checks, 4 paired screenshots; ${out}/audit.json`);
