import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';

const origin = process.env.ELIGIBLE_UI_ORIGIN ?? 'http://127.0.0.1:5191';
const out = process.argv[2] ?? 'tmp/community/eligible-ui';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('eligible-ui'), headless: true });
const evidence: unknown[] = [];
async function ready(page: Page): Promise<void> { await page.waitForFunction(`window.__game?.registry.get('eligibleRunUi')?.ready`, undefined, { timeout: 60_000 }); }
async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(out, `${name}.png`) });
  assert.equal(await page.evaluate(`document.querySelector('.eligible-run').scrollWidth > window.innerWidth`), false, `${name}: page overflow`);
  const labels = await page.locator('.eligible-run button:visible').evaluateAll(buttons => buttons.map(button => ({ label: button.textContent, width: button.clientWidth, scrollWidth: button.scrollWidth })));
  for (const label of labels) assert(label.scrollWidth <= label.width, `${name}: overflowing button ${label.label}`);
}
try {
  for (const [platform, route, width, height] of [['desktop', 'eligible', 1440, 900], ['mobile', 'meligible', 412, 892]] as const) {
    const context = await browser.newContext({ viewport: { width, height } }); const page = await context.newPage(); await pinPageAgainstHmr(page);
    const requests: { path: string; body: unknown }[] = []; const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'POST' && (url.pathname.startsWith('/runs') || url.pathname === '/battle')) requests.push({ path: url.pathname, body: request.postDataJSON() }); });
    await page.goto(`${origin}/?scene=${route}`, { waitUntil: 'domcontentloaded' }); await ready(page);
    await capture(page, `${platform}-entry`);
    await page.getByRole('button', { name: 'START RUN', exact: true }).click(); await ready(page);
    await page.getByRole('heading', { name: 'Choose your starting hand', exact: true }).waitFor();
    await capture(page, `${platform}-draft`);
    for (const group of ['OFFENSE', 'DEFENSE', 'SUPPORT', 'WILDCARD']) { await page.locator('.panel').filter({ has: page.getByRole('heading', { name: `${group} · Choose one`, exact: true }) }).getByRole('button', { name: 'CHOOSE', exact: true }).first().click(); await ready(page); }
    await page.getByRole('button', { name: 'BEGIN ADVENTURE', exact: true }).click(); await ready(page); await capture(page, `${platform}-region`);
    const region = page.getByRole('button', { name: 'TRAVEL HERE', exact: true }); if (await region.count()) { await region.first().click(); await ready(page); }
    await capture(page, `${platform}-map`);
    await page.getByRole('button', { name: 'DECK / BAG', exact: true }).click(); await capture(page, `${platform}-deck`);
    const slot = page.getByRole('button', { name: /^SLOT / }).first(); await slot.click(); await page.getByRole('button', { name: 'MOVE SELECTED TO HOLDING', exact: true }).click(); await ready(page); await capture(page, `${platform}-holding`);
    await page.getByRole('button', { name: 'SELECT', exact: true }).click(); await page.getByRole('button', { name: /^EMPTY / }).first().click(); await ready(page);
    await page.getByRole('button', { name: 'EQUIPMENT', exact: true }).click(); await capture(page, `${platform}-equipment`);
    await page.getByRole('button', { name: 'JOURNEY', exact: true }).click();
    let battle = false;
    for (let step = 0; step < 18 && !battle; step++) {
      const choose = page.getByRole('button', { name: 'CHOOSE STOP', exact: true });
      if (await choose.count()) { const shop = page.locator('.route').filter({ has: page.getByRole('heading', { name: 'SHOP', exact: true }) }).getByRole('button', { name: 'CHOOSE STOP', exact: true }); await (await shop.count() ? shop.first() : choose.first()).click(); await ready(page); continue; }
      const browse = page.getByRole('button', { name: 'BROWSE SHOP', exact: true }); if (await browse.count()) { await browse.click(); await ready(page); await capture(page, `${platform}-shop`); const buy = page.getByRole('button', { name: /^BUY ·/ }).first(); if (await buy.count()) { await buy.click(); await ready(page); } continue; }
      const leave = page.getByRole('button', { name: 'LEAVE SHOP', exact: true }); if (await leave.count()) { await leave.click(); await ready(page); continue; }
      const approach = page.getByRole('button', { name: 'APPROACH', exact: true }); if (await approach.count()) { await approach.click(); await ready(page); continue; }
      const choice = page.locator('.choice button:not(:disabled)').first(); if (await choice.count()) { await capture(page, `${platform}-event`); await choice.click(); await ready(page); continue; }
      const reward = page.getByRole('button', { name: /^(TAKE CARD|TAKE GEM|UPGRADE|CHOOSE|TRANSFORM|KEEP|MERGE THREE)$/ }).first(); if (await reward.count()) { await capture(page, `${platform}-event-choice`); await reward.click(); await ready(page); continue; }
      const continueJourney = page.getByRole('button', { name: 'CONTINUE JOURNEY', exact: true }); if (await continueJourney.count()) { await continueJourney.click(); await ready(page); continue; }
      const enter = page.getByRole('button', { name: 'ENTER BATTLE', exact: true }); if (await enter.count()) { await capture(page, `${platform}-prep`); await enter.click(); await ready(page); continue; }
      const fight = page.getByRole('button', { name: 'FIGHT', exact: true }); if (await fight.count()) { await fight.click(); await ready(page); await capture(page, `${platform}-battle-receipt`); battle = true; }
      else break;
    }
    assert(battle, `${platform}: live journey must reach canonical battle`);
    assert.equal(requests.some(request => request.path === '/battle'), false, 'eligible UI never sends client battle setup');
    const before = await page.evaluate(`window.__game.registry.get('eligibleRunUi')`) as { runId: string; revision: number };
    await page.reload(); await ready(page); const after = await page.evaluate(`window.__game.registry.get('eligibleRunUi')`) as { runId: string; revision: number };
    assert.equal(after.runId, before.runId); assert.equal(after.revision, before.revision); await capture(page, `${platform}-resumed`);
    const offline = await context.newPage(); await pinPageAgainstHmr(offline); await offline.route('**/runs/**', route => route.abort()); await offline.goto(`${origin}/?scene=${route}`, { waitUntil: 'domcontentloaded' }); await ready(offline); await capture(offline, `${platform}-offline`);
    assert.equal(await offline.getByRole('button', { name: 'BEGIN ADVENTURE', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    evidence.push({ platform, width, height, liveCanonicalBattle: battle, noClientBattleSetup: true, resumed: after, requests: requests.map(request => ({ path: request.path, intent: (request.body as any)?.intent?.kind ?? null })) });
    await context.close();
  }
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('eligible run screens OK: desktop 1440x900 and mobile 412x892; actual authenticated API draft/region/map/shop/deck holding/equipment/canonical battle; reload resume; offline no fallback; no /battle setup');
} finally { await browser.close(); }
