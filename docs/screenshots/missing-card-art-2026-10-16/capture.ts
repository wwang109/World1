import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { resolveChromiumPath } from '../../../scripts/chromiumPath';
const out = 'docs/screenshots/missing-card-art-2026-10-16';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('missing-card-art') });
const evidence = [];
for (const compact of [false, true]) {
  const viewport = compact ? { width: 412, height: 892 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript('globalThis.__name = (value) => value');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:5191/?scene=${compact ? 'mwiki' : 'desktop-wiki'}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__game?.scene.scenes.some((scene: any) => scene.sys.isActive()));
  await page.evaluate(async (compact) => {
    const paths = ['/src/game/ui/FantasyCardTemplateV2.ts', '/src/data/skills.ts', '/src/game/ui/cardArtCatalog.ts'];
    const [{ FantasyCardTemplateV2 }, { skillBook }, { CARD_ART_CATALOG, cardArtUrl }] = await Promise.all(paths.map(path => import(path)));
    const scene = (window as any).__game.scene.scenes.find((scene: any) => scene.sys.isActive());
    scene.children.removeAll(true);
    scene.cameras.main.setBackgroundColor('#163248');
    const width = compact ? 184 : 330;
    const ids = ['waking_blade', 'honed_edge'];
    await Promise.all(ids.map((id) => new Promise<void>(resolve => {
      const entry = CARD_ART_CATALOG[id];
      scene.load.once(`filecomplete-image-${entry.textureKey}`, () => resolve());
      scene.load.image(entry.textureKey, cardArtUrl(entry));
      if (!scene.load.isLoading()) scene.load.start();
    })));
    ids.forEach((id, index) => {
      const card = new FantasyCardTemplateV2(scene, compact ? 108 + index * 196 : 510 + index * 420,
        compact ? 446 : 450, skillBook[id], { width, height: width * 690 / 420, finish: false });
      scene.add.existing(card);
    });
  }, compact);
  await page.waitForTimeout(600);
  const art = await page.evaluate(() => {
    const scene = (window as any).__game.scene.scenes.find((scene: any) => scene.sys.isActive());
    const stack = [...scene.children.list]; const textures: string[] = [];
    while (stack.length) { const object = stack.pop(); if (object.list) stack.push(...object.list);
      if (object.texture?.key?.startsWith('card-art:')) textures.push(object.texture.key); }
    return textures;
  });
  if (art.length !== 2 || errors.length) throw new Error(JSON.stringify({ compact, art, errors }));
  const path = `${out}/${compact ? 'mobile' : 'desktop'}.png`;
  await page.screenshot({ path });
  evidence.push({ compact, viewport, art, errors, screenshot: path });
  await context.close();
}
await browser.close();
writeFileSync(`${out}/audit.json`, JSON.stringify(evidence, null, 2));
console.log('Two-card art proof: 2 catalog textures on both desktop and mobile, no page errors');
