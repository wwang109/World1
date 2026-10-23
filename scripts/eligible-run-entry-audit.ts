import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';
import { collectSceneTexts } from './sceneText';

const out = 'tmp/community/eligible-ui'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('eligible-entry'), headless: true });
try {
  for (const [platform, scene, width, height] of [['desktop', 'eligible', 1440, 900], ['mobile', 'meligible', 412, 892]] as const) {
    for (const offline of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height } }); const page = await context.newPage(); await pinPageAgainstHmr(page);
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      if (offline) await page.route('**/runs/**', route => route.abort());
      await page.goto(`${process.env.ELIGIBLE_UI_ORIGIN ?? 'http://127.0.0.1:5191'}/?scene=${scene}&layoutAudit=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(`window.__game?.registry.get('eligibleRunUi')?.ready`, undefined, { timeout: 60000 });
      assert.equal(await page.evaluate(`window.__game.registry.get('eligibleRunUi').runId`), null);
      assert.equal(await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.some(object=>object.texture?.key==='run-art-run-map')`), false, 'unbound entry must not borrow current global art');
      for (const text of await collectSceneTexts(page)) assert(text.x >= -1 && text.y >= -1 && text.x + text.width <= width + 1 && text.y + text.height <= height + 1, `${platform} entry viewport`);
      assert.deepEqual(await page.evaluate(`window.__layoutAudit?.failures() ?? []`), []); assert.deepEqual(errors, []);
      await page.screenshot({ path: `${out}/${platform}-${offline ? 'offline' : 'entry'}.png` }); await context.close();
    }
  }
  console.log('eligible entry OK: fresh desktop/mobile entry and offline fail-closed; no current-global art fallback; viewport and control clearance');
} finally { await browser.close(); }
