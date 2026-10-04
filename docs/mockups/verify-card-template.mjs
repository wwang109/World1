import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = process.env.CARD_TEMPLATE_URL ?? 'http://127.0.0.1:5182';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = base + '/docs/mockups/card-template-workbench.html';
await mkdir('docs/mockups/evidence', { recursive: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 412, height: 892 }]]) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await page.waitForSelector('#selected[data-ready="true"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.card-host')].every(h => h.previewCard?.scene));
    await page.waitForFunction(() => [...document.querySelectorAll('.card-host')].every(h => h.dataset.artReady === 'true' && h.dataset.chromeReady === 'true' && h.dataset.ready === 'true'));
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(name + ': horizontal overflow');
    await page.screenshot({ path: `docs/mockups/evidence/card-template-v2-${name}.png`, fullPage: true });
    await page.selectOption('#template','classic');
    await page.waitForSelector('#selected[data-template="classic"]');
    await page.selectOption('#template','printed-v2');
    await page.locator('#art-toggle').uncheck();
    await page.locator('#progress-toggle').check();
    await page.locator('#title').fill('An Exceptionally Long Card Title for Layout Review');
    await page.locator('#stress').check();
    await page.waitForSelector('#selected[data-truncated="true"]');
    const cue = await page.evaluate(() => document.querySelector('#selected').previewCard.getByName('fantasy-card-body').getAll().some(t => t.text?.endsWith('…')));
    if (!cue) throw new Error(name + ': dense rules lack ellipsis');
  }
  await page.goto(url);
  await page.waitForSelector('#selected[data-ready="true"]');
  const result = await page.evaluate(async () => {
    const { skillBook } = await import('/src/data/skills.ts');
    const { applyTier } = await import('/src/engine/cards.ts');
    const { renderSkillText, renderSkillClauses, cooldownClause } = await import('/src/engine/keywords/compose.ts');
    const { buildFantasyCardTemplateModel } = await import('/src/game/ui/fantasyCardTemplateModel.ts');
    const { FantasyCardTemplateV2 } = await import('/src/game/ui/FantasyCardTemplateV2.ts');
    const { resolveCardTemplateVariant } = await import('/src/game/ui/fantasyCardTemplateSpec.ts');
    const scene = document.querySelector('#selected').previewCard.scene;
    const snapshot = {};
    const failures = [];
    const stats = {};
    const optionalRows = { withoutAffinity: 0, withoutTiming: 0, archetypeCounts: {} };
    const widths = [140,150,187,200,220,260,307,336,420];
    for (const base of Object.values(skillBook)) for (const tier of ['bronze','silver','gold','diamond']) {
      const skill = applyTier(base,tier);
      const key = base.id + '@' + tier;
      const clauses = renderSkillClauses(skill);
      snapshot[key] = { body: renderSkillText(skill),clauses };
      const model = buildFantasyCardTemplateModel(skill,{ template: 'printed-v2' });
      if (JSON.stringify(model.rows.slice(0,clauses.length).map(r => r.text)) !== JSON.stringify(clauses)) failures.push(key + ': clause order/text drift');
      if (clauses.some((c,i) => c.startsWith('{{Affinity}}') !== model.rows[i].affinity)) failures.push(key + ': affinity lost');
      const affinityRows = model.rows.filter(row => row.category === 'affinity');
      const timingRows = model.rows.filter(row => row.category === 'timing');
      if (affinityRows.length !== clauses.filter(c => c.startsWith('{{Affinity}}')).length) failures.push(key + ': invented affinity row');
      if (timingRows.length !== (cooldownClause(skill) ? 1 : 0)) failures.push(key + ': invented timing row');
      if (!affinityRows.length) optionalRows.withoutAffinity++;
      if (!timingRows.length) optionalRows.withoutTiming++;
      const badgeCount = Math.min(model.archetypes.length, model.spec.archetypeStack.max);
      optionalRows.archetypeCounts[badgeCount] = (optionalRows.archetypeCounts[badgeCount] ?? 0) + 1;
      for (const width of widths) {
        const card = new FantasyCardTemplateV2(scene,5000,5000,skill,{ width,height: width * 690 / 420,template: 'printed-v2',artwork: false,glossary: false,progress: { tier,points: 1 } });
        const body = card.getByName('fantasy-card-body');
        const title = card.getByName('fantasy-card-title');
        const titleBounds = title.getBounds();
        const header = model.regions.header;
        const scale = width / model.spec.baseSize.width;
        if (titleBounds.y < card.y - card.height / 2 + header.y * scale - 1 || titleBounds.bottom > card.y - card.height / 2 + (header.y + header.h) * scale + 1) failures.push(`${key}/${width}: title outside header`);
        const badges = card.getByName('fantasy-card-badges').getAll().filter(child => child.type === 'Container');
        if (badges.length !== badgeCount + 1) failures.push(`${key}/${width}: wrong badge count`);
        const box = body.getData('bodyRegion');
        const words = body.getAll().filter(t => typeof t.text === 'string');
        const truncated = body.getData('truncated');
        if (!stats[width]) stats[width] = { variants: 0,truncated: 0 };
        stats[width].variants++; if (truncated) stats[width].truncated++;
        if (truncated && !words.some(w => w.text.endsWith('…'))) failures.push(`${key}/${width}: missing cue`);
        for (const word of words) {
          if (word.x < box.x - 1 || word.x + word.width > box.x + box.w + 1 || word.y < box.y - 1 || word.y + word.height > box.y + box.h + 1) failures.push(`${key}/${width}: rules out of bounds ${word.text}`);
        }
        if (tier === 'diamond' && card.getAll().some(c => typeof c.text === 'string' && /[●○]/.test(c.text))) failures.push(key + ': diamond progress visible');
        card.destroy();
      }
    }
    const threeBadgeSkill = { ...Object.values(skillBook)[0],archetypes: ['offense','defensive','support'] };
    const threeBadgeCard = new FantasyCardTemplateV2(scene,5000,5000,threeBadgeSkill,{ width: 420,height: 690,template: 'printed-v2',artwork: false,glossary: false });
    if (threeBadgeCard.getByName('fantasy-card-badges').getAll().filter(child => child.type === 'Container').length !== 4) failures.push('synthetic 3-archetype fixture: wrong badge count');
    threeBadgeCard.destroy();
    if (resolveCardTemplateVariant(undefined,'') !== 'classic') failures.push('default changed');
    if (resolveCardTemplateVariant(undefined,'?cardTemplate=printed-v2') !== 'printed-v2') failures.push('preview override failed');
    if (resolveCardTemplateVariant('classic','?cardTemplate=printed-v2') !== 'classic') failures.push('explicit override failed');
    return { snapshot,stats,optionalRows,failures };
  });
  if (process.argv[2]) {
    const previous = JSON.parse(await readFile(process.argv[2],'utf8'));
    if (JSON.stringify(result.snapshot) !== JSON.stringify(previous)) throw new Error('Generated text differs from pre-change snapshot');
  }
  if (result.failures.length) throw new Error(result.failures.slice(0,20).join('\n') + '\nTotal: ' + result.failures.length);
  if (errors.length) throw new Error(errors.join('\n'));
  const regions = await page.evaluate(async () => (await import('/src/game/ui/fantasyCardTemplateSpec.ts')).PRINTED_CARD_TEMPLATE_SPEC);
  const chromeAlpha = await page.evaluate(async () => {
    const img = new Image(); img.src = '/game-art/template/anime-relic-chrome.webp'; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const alphaAt = (x,y) => ctx.getImageData(Math.round(x * img.width),Math.round(y * img.height),1,1).data[3];
    return { width: img.width,height: img.height,middle: alphaAt(0.5,0.4),leftArtEdge: alphaAt(0.01,0.3),header: alphaAt(0.5,0.04),rules: alphaAt(0.5,0.8) };
  });
  if (chromeAlpha.middle !== 0 || chromeAlpha.leftArtEdge !== 0 || chromeAlpha.header < 250 || chromeAlpha.rules < 250) throw new Error('Chrome alpha contract failed: ' + JSON.stringify(chromeAlpha));
  const report = { status: 'candidate-unaccepted',beforeSnapshotCompared: Boolean(process.argv[2]),textVariants: Object.keys(result.snapshot).length,stats: result.stats,optionalRows: result.optionalRows,chromeAlpha,contractHash: createHash('sha256').update(JSON.stringify(regions)).digest('hex') };
  await writeFile('docs/mockups/evidence/card-template-v2-report.json',JSON.stringify(report,null,2));
  for (const [name, scene, viewport] of [['desktop','desktop-wiki',{ width: 1440,height: 900 }],['mobile','mwiki',{ width: 412,height: 892 }]]) {
    await page.setViewportSize(viewport);
    await page.goto(`${base}/?scene=${scene}&cardTemplate=printed-v2&layoutAudit=1`);
    await page.waitForFunction(() => window.__game?.scene.getScenes(true).length > 0);
    await page.waitForFunction(() => {
      const cards = [];
      const visit = object => { if (object?.getData?.('templateVariant') === 'printed-v2') cards.push(object); if (object?.list) object.list.forEach(visit); };
      window.__game.scene.getScenes(true).forEach(scene => scene.children.list.forEach(visit));
      return cards.length > 0 && cards.every(card => card.getByName('fantasy-card-chrome')?.getData('rasterReady') === true);
    });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `docs/mockups/evidence/card-template-v2-game-${name}.png`,fullPage: true });
  }
  console.log('Template V2 OK: desktop + mobile; 732 text variants unchanged; 6588 rendered faces inside rules bounds; preview switch; dense-rule cues; Diamond progress hidden.');
  console.log(JSON.stringify(result.stats));
  console.log('Optional rows: ' + JSON.stringify(result.optionalRows));
  console.log('Chrome alpha: ' + JSON.stringify(chromeAlpha));
} finally { await browser.close(); }
