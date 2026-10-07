import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { resolveChromiumPath } from './chromiumPath.ts';
import { pinPageAgainstHmr } from './pageHarness.ts';

const base = process.env.AUDIT_URL ?? 'http://127.0.0.1:5182';
const output = process.env.AUDIT_OUTPUT ?? 'tmp/event-card-reward-typography';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('event-card-reward-audit') });
const results = [];
try {
  for (const [platform, route, width, height, sceneKey] of [
    ['desktop', 'desktop-runevent', 1440, 900, 'DesktopRunEvent'],
    ['mobile', 'mrunevent', 412, 892, 'MobileRunEvent'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await pinPageAgainstHmr(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.text().includes('[layout-audit]')) errors.push(message.text());
    });
    await page.goto(`${base}/?scene=${route}&eventFixture=ruined_anvil&layoutAudit=1`);
    await page.waitForFunction(`window.__game?.scene.getScene('${sceneKey}')?.children.list.some(o => o.type === 'Text' && /Take the rough/i.test(o.text))`);
    await page.evaluate(`window.__rewardAuditScene = window.__game.scene.getScene('${sceneKey}')`);
    await page.evaluate(`(async () => {
      const resource = performance.getEntriesByType('resource').find(entry => /\\/src\\/game\\/runStore\\.ts(?:\\?|$)/.test(entry.name));
      if (!resource) throw new Error('Missing live runStore module');
      window.__rewardAuditStore = await import(resource.name);
    })()`);
    const click = async (condition) => {
      const point = await page.evaluate(`(() => {
        const object = window.__rewardAuditScene.children.list.find(o => ${condition});
        if (!object) throw new Error('Missing click target: ${condition.replaceAll("'", '')}');
        const bounds = object.getBounds(); const canvas = window.__game.canvas.getBoundingClientRect();
        return { x: canvas.left + bounds.centerX * canvas.width / window.__game.scale.gameSize.width,
          y: canvas.top + bounds.centerY * canvas.height / window.__game.scale.gameSize.height };
      })()`);
      await page.mouse.click(point.x, point.y);
    };
    const inspect = () => page.evaluate(`(async () => {
      const scene = window.__rewardAuditScene;
      const list = scene.children.list.find(o => o.name === 'run-card-reward-descriptions');
      const skill = scene.children.list.find(o => o.name === 'run-card-reward-card').getData('templateModel').skill;
      const { buildCardDetailsContent } = await import('/src/game/ui/cardDetailsContent.ts');
      const { getActiveRun } = window.__rewardAuditStore;
      const { layoutAuditFailures } = await import('/src/game/ui/controlLayoutAudit.ts');
      const viewport = list.getData('viewport');
      const rendered = [];
      const collect = (object, x, y) => {
        x += object.x; y += object.y;
        if (object.type === 'Text') rendered.push({ x, y, width:object.width, height:object.height, fontSize:object.style.fontSize });
        else for (const child of object.list ?? []) collect(child, x, y);
      };
      for (const child of list.list) collect(child, list.x, list.y);
      return { skill: { id: skill.id, name: skill.name, tier: skill.tier }, entries: list.getData('entries'),
        canonical: buildCardDetailsContent(skill).entries, viewport,
        typography: list.getData('typography'), renderedFontSizes:[...new Set(rendered.map(o => o.fontSize))],
        allLinesVisible: rendered.every(o => o.x >= viewport.x - 0.01 && o.y >= viewport.y - 0.01
          && o.x + o.width <= viewport.x + viewport.width + 0.01 && o.y + o.height <= viewport.y + viewport.height + 0.01),
        contentHeight: list.getData('contentHeight'), maxScroll: list.getData('maxScroll'),
        scroll: list.getData('scrollOffset'), run: JSON.stringify(getActiveRun()),
        failures: layoutAuditFailures().filter(f => /Run card reward|Run reward continue/.test(f.message)),
        texts: scene.children.list.filter(o => o.type === 'Text').map(o => o.text) };
    })()`);
    const rewardReady = () => page.waitForFunction(`window.__rewardAuditScene.children.list.some(o => o.name === 'run-card-reward-card')`);
    const drawerOpen = () => page.waitForFunction(`window.__rewardAuditScene.children.list.some(o => o.type === 'Text' && o.text === 'CARD DETAILS')`);
    const drawerClosed = () => page.waitForFunction(`!window.__rewardAuditScene.children.list.some(o => o.type === 'Text' && o.text === 'CARD DETAILS')`);
    const checkPresentation = (shown) => {
      assert.deepEqual(shown.entries, shown.canonical);
      assert.deepEqual(shown.failures, []);
      assert.deepEqual(shown.typography, { bodyFontSize:platform === 'desktop' ? 13 : 12,
        headingFontSize:platform === 'desktop' ? 11 : 10, lineSpacing:2, headingGap:3, entryGap:6 });
      assert(shown.renderedFontSizes.every(size => [shown.typography.bodyFontSize, shown.typography.headingFontSize].includes(parseFloat(size))));
      if (platform === 'desktop') {
        assert.equal(shown.maxScroll, 0, 'Desktop canonical descriptions and context must fit');
        assert(shown.allLinesVisible, 'Every desktop description line must be visible');
      }
    };
    await click("o.type === 'Text' && /Take the rough/i.test(o.text)");
    await rewardReady();
    await page.waitForTimeout(3000);
    const initial = await inspect();
    assert.notEqual(initial.run, 'null', 'Audit must read the live scene store, not an unversioned Vite duplicate');
    checkPresentation(initial);
    for (const label of ['TYPE', 'WEIGHT', 'SLOTS']) assert(initial.texts.includes(label));
    await page.screenshot({ path: `${output}/event-card-reward-${platform}.png` });
    await click("o.name === 'run-card-reward-expand'");
    await drawerOpen();
    await page.screenshot({ path: `${output}/event-card-reward-${platform}-expanded.png` });
    await click("o.type === 'Text' && o.text === '\u00d7' && o.depth > 2400");
    await drawerClosed();
    assert.equal((await inspect()).run, initial.run, 'Inspecting must not change the reward/run');
    await click("o.name === 'run-card-reward-card'");
    await drawerOpen();
    await click("o.type === 'Text' && o.text === '\u00d7' && o.depth > 2400");
    await drawerClosed();
    assert.equal((await inspect()).run, initial.run, 'Card click must not change the reward/run');

    // Presentation-only fixtures use the controller; no rewards are committed.
    const longCard = await page.evaluate(`(async () => {
      const { skillBook } = await import('/src/data/skills.ts');
      const { applyTier } = await import('/src/engine/cards.ts');
      const { buildCardDetailsContent } = await import('/src/game/ui/cardDetailsContent.ts');
      const { getActiveRun } = window.__rewardAuditStore;
      const candidates = Object.values(skillBook).flatMap(skill => ['bronze','silver','gold','diamond'].map(tier => {
        const shown = applyTier(skill, tier); const entries = buildCardDetailsContent(shown).entries;
        return { skill: shown, length: entries.reduce((n, e) => n + e.title.length + e.body.length, 0) };
      })).sort((a,b) => b.length - a.length);
      window.__rewardAuditCandidates = candidates;
      const skill = candidates[0].skill;
      window.__rewardAuditScene.pane.enter({ kind:'grantCard', skillId:skill.id, tier:skill.tier }, getActiveRun());
      window.__rewardAuditScene.rerender();
      return { id:skill.id, name:skill.name, tier:skill.tier, length:candidates[0].length, ranks:candidates.length };
    })()`);
    await rewardReady();
    await page.waitForTimeout(2000);
    const long = await inspect();
    checkPresentation(long);
    assert.equal(long.run, initial.run);
    assert.deepEqual(long.failures, []);
    await page.screenshot({ path: `${output}/event-card-reward-${platform}-long.png` });
    if (platform === 'mobile') {
      assert(long.maxScroll > 0, 'Longest mobile description must exercise readable fallback scrolling');
      const viewportPoint = await page.evaluate(`(() => {
        const viewport = window.__rewardAuditScene.children.list.find(o => o.name === 'run-card-reward-descriptions').getData('viewport');
        const canvas = window.__game.canvas.getBoundingClientRect();
        return { x: canvas.left + (viewport.x + viewport.width / 2) * canvas.width / window.__game.scale.gameSize.width,
          y: canvas.top + (viewport.y + viewport.height / 2) * canvas.height / window.__game.scale.gameSize.height };
      })()`);
      await page.mouse.move(viewportPoint.x, viewportPoint.y);
      await page.mouse.wheel(0, 10000);
      await page.waitForTimeout(300);
      const scrolled = await inspect();
      assert.equal(scrolled.scroll, scrolled.maxScroll);
      await page.screenshot({ path: `${output}/event-card-reward-${platform}-long-scrolled.png` });
      await page.mouse.wheel(0, -10000);
      await page.waitForTimeout(200);
      await page.mouse.down();
      await page.mouse.move(viewportPoint.x, viewportPoint.y - Math.min(60, long.viewport.height / 2), { steps: 5 });
      await page.mouse.up();
      assert((await inspect()).scroll > 0, 'Dragging must scroll long effects');
    }
    await click("o.name === 'run-card-reward-expand'");
    await drawerOpen();
    await click("o.type === 'Text' && o.text === '\u00d7' && o.depth > 2400");
    await drawerClosed();
    assert.equal((await inspect()).run, initial.run);
    const mergeContext = await page.evaluate(`(async () => {
      const { skillBook } = await import('/src/data/skills.ts');
      const { getActiveRun } = window.__rewardAuditStore;
      const scene = window.__rewardAuditScene;
      const skill = scene.children.list.find(o => o.name === 'run-card-reward-card').getData('templateModel').skill;
      const names = Object.values(skillBook).sort((a,b) => b.name.length - a.name.length).slice(0,3);
      const receipt = { from:'bronze', to:skill.tier, consumed:names.map((s,i) => ({
        instanceId:'audit-'+i, skillId:s.id, tier:'bronze', location:'bag', index:i })),
        taken:{ skillId:skill.id, tier:skill.tier } };
      scene.pane.enter({ kind:'grantCard', skillId:skill.id, tier:skill.tier }, getActiveRun(), receipt);
      scene.rerender();
      const context = scene.children.list.find(o => o.name === 'run-card-reward-descriptions').list.find(o => o.name === 'run-card-reward-context');
      return { text:context.text, height:context.height };
    })()`);
    const merged = await inspect();
    checkPresentation(merged);
    assert.equal(merged.viewport.height, long.viewport.height, 'Merge context must not steal the effects viewport');
    assert.equal(merged.run, initial.run);
    assert(mergeContext.text.includes('SPENT') && mergeContext.text.includes('ARRIVED'));
    assert.deepEqual(merged.failures, []);
    await page.screenshot({ path: `${output}/event-card-reward-${platform}-long-merge.png` });
    let catalog;
    if (platform === 'desktop') {
      catalog = await page.evaluate(`(async () => {
        const { buildCardDetailsContent } = await import('/src/game/ui/cardDetailsContent.ts');
        const { getActiveRun } = window.__rewardAuditStore;
        const scene = window.__rewardAuditScene;
        const receipt = scene.pane.state.mergeReceipt;
        let maxContentHeight = 0;
        const failures = [];
        for (const { skill } of window.__rewardAuditCandidates) {
          scene.pane.enter({ kind:'grantCard', skillId:skill.id, tier:skill.tier }, getActiveRun(),
            { ...receipt, to:skill.tier, taken:{ skillId:skill.id, tier:skill.tier } });
          scene.rerender();
          const list = scene.children.list.find(o => o.name === 'run-card-reward-descriptions');
          const viewport = list.getData('viewport');
          const contentHeight = list.getData('contentHeight');
          maxContentHeight = Math.max(maxContentHeight, contentHeight);
          if (list.getData('maxScroll') !== 0 || contentHeight > viewport.height
            || JSON.stringify(list.getData('entries')) !== JSON.stringify(buildCardDetailsContent(skill).entries)) {
            failures.push({ id:skill.id, tier:skill.tier, contentHeight, viewportHeight:viewport.height });
          }
        }
        scene.pane.enter({ kind:'grantCard', skillId:${JSON.stringify(longCard.id)}, tier:${JSON.stringify(longCard.tier)} }, getActiveRun(), receipt);
        scene.rerender();
        return { variants:window.__rewardAuditCandidates.length, maxContentHeight, failures };
      })()`);
      assert.deepEqual(catalog.failures, [], 'Every authored card tier must fit with long merge context');
      assert(catalog.variants > 0);
      assert.equal((await inspect()).run, initial.run, 'Catalog presentation must leave inventory unchanged');
    }
    await click("o.type === 'Text' && /^CONTINUE/.test(o.text)");
    await page.waitForFunction(`!window.__rewardAuditScene.sys.isActive()`);
    const afterContinue = await page.evaluate(`(async () => {
      const { getActiveRun } = window.__rewardAuditStore;
      return JSON.stringify(getActiveRun());
    })()`);
    const beforeRun = JSON.parse(initial.run);
    const afterRun = JSON.parse(afterContinue);
    for (const field of ['pieces', 'bagSlots', 'gold']) {
      assert.deepEqual(afterRun[field], beforeRun[field], `Continue must not award the reward again: ${field}`);
    }
    assert.deepEqual(errors, []);
    results.push({ platform, dimensions:{ width, height }, typography:long.typography, renderedFontSizes:long.renderedFontSizes,
      initial:{ viewport:initial.viewport, contentHeight:initial.contentHeight, maxScroll:initial.maxScroll },
      longCard, entries:long.entries.length, contentHeight:long.contentHeight,
      viewport:long.viewport, maxScroll:long.maxScroll, allLinesVisible:long.allLinesVisible, mergeContext,
      merged:{ contentHeight:merged.contentHeight, maxScroll:merged.maxScroll, allLinesVisible:merged.allLinesVisible }, catalog,
      checks:'canonical copy, wheel, drag, expand/card click, close, unchanged reward, merge context, Continue, no page/layout errors' });
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
  console.log('Totals: 2 platforms PASS; canonical copy, desktop fit, mobile fallback, inventory and interaction checks; 0 page/layout errors');
} finally {
  await browser.close();
}
