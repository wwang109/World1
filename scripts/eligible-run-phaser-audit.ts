import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';
import { collectSceneTexts } from './sceneText';

const origin = process.env.ELIGIBLE_UI_ORIGIN ?? 'http://127.0.0.1:5191';
const out = process.argv[2] ?? 'tmp/community/eligible-ui'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('eligible-ui'), headless: true });
const evidence: unknown[] = [];
async function ready(page: Page): Promise<void> { await page.waitForFunction(`window.__game?.registry.get('eligibleRunUi')?.ready`, undefined, { timeout: 60000 }); }
async function state(page: Page): Promise<any> { return page.evaluate(`window.__game.registry.get('eligibleRunUi')`); }
async function hit(page: Page, label: string): Promise<boolean> {
  await page.bringToFront();
  await page.waitForTimeout(90);
  const rect = await page.evaluate(`(() => { const scene=window.__game.scene.scenes.find(s=>s.sys.isActive());const item=scene.children.list.find(o=>o.getData?.('eligibleControl')===${JSON.stringify(label)}&&o.input?.enabled);if(!item)return null; const b=item.getBounds();return {x:b.centerX,y:b.centerY};})()` ) as { x: number; y: number } | null;
  if (!rect) return false; await page.mouse.click(rect.x, rect.y); await page.waitForTimeout(110); await ready(page); return true;
}
async function navigate(page: Page, label: 'NEXT' | 'PREVIOUS'): Promise<void> {
  const before = await state(page);
  const target = label === 'NEXT' ? Math.min(before.pages - 1, before.page + 1) : Math.max(0, before.page - 1);
  for (let attempt = 0; attempt < 4; attempt++) { await hit(page, label); if ((await state(page)).page === target) return; }
  assert.equal((await state(page)).page, target, 'page control must respond');
}
async function first(page: Page): Promise<void> { for (let index = 0; index < 30 && (await state(page)).page > 0; index++) await navigate(page, 'PREVIOUS'); }
async function click(page: Page, label: string, optional = false): Promise<boolean> {
  if (await hit(page, label)) return true;
  const target = await page.evaluate(`window.__game.registry.get('eligibleRunControls').find(control=>control.label===${JSON.stringify(label)}&&control.enabled)?.page`) as number | undefined;
  if (target !== undefined) {
    for (let index = 0; index < 40 && (await state(page)).page !== target; index++) await navigate(page, (await state(page)).page < target ? 'NEXT' : 'PREVIOUS');
    for (let attempt = 0; attempt < 3; attempt++) if (await hit(page, label)) return true;
  }
  if (!optional) {
    await page.screenshot({ path: join(out, `missing-${label.replaceAll(/[^a-z0-9]/gi, '-')}.png`) });
    console.error(await state(page), await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.map(o=>({control:o.getData?.('eligibleControl'),enabled:o.input?.enabled})).filter(o=>o.control)`));
    throw new Error(`Missing enabled ${label}`);
  } return false;
}
async function group(page: Page, name: string): Promise<void> {
  const target = await page.evaluate(`window.__game.registry.get('eligibleRunGroups').find(group=>group.title===${JSON.stringify(name)})?.page`) as number | undefined;
  assert(target !== undefined, `Missing group ${name}`);
  for (let index = 0; index < 40 && (await state(page)).page !== target; index++) await navigate(page, (await state(page)).page < target ? 'NEXT' : 'PREVIOUS');
  assert((await collectSceneTexts(page)).some(text => text.text === name), `Group rendered ${name}`);
}
async function capture(page: Page, name: string, width: number, height: number): Promise<void> {
  await page.waitForTimeout(150); await page.screenshot({ path: join(out, `${name}.png`) });
  assert.equal(await page.locator('[data-online-run]').count(), 0, 'earning UI must render in Phaser');
  const texts = await collectSceneTexts(page);
  for (const text of texts) assert(text.x >= -1 && text.y >= -1 && text.x + text.width <= width + 1 && text.y + text.height <= height + 1, `${name}: outside canvas ${text.text}`);
  const failures = await page.evaluate(`window.__layoutAudit?.failures() ?? []`); assert.deepEqual(failures, [], `${name}: control clearance`);
}
try {
  for (const [platform, route, width, height] of [['desktop', 'eligible', 1440, 900], ['mobile', 'meligible', 412, 892]] as const) {
    const context = await browser.newContext({ viewport: { width, height } }); const page = await context.newPage(); await pinPageAgainstHmr(page);
    const requests: { path: string; body: any }[] = []; const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'POST' && (url.pathname.startsWith('/runs') || url.pathname === '/battle')) requests.push({ path: url.pathname, body: request.postDataJSON() }); });
    page.on('pageerror', error => console.error(`${platform} browser: ${error.message}`));
    await page.goto(`${origin}/?scene=${route}&layoutAudit=1`, { waitUntil: 'domcontentloaded' }); await ready(page); await capture(page, `${platform}-entry`, width, height);
    await click(page, 'START RUN'); await capture(page, `${platform}-draft`, width, height);
    let lost = true;
    await page.route('**/runs/*/actions', async request => { if (lost) { lost = false; await request.fetch(); await request.abort('failed'); } else await request.continue(); });
    await group(page, 'OFFENSE · Choose one'); await click(page, 'CHOOSE'); assert((await state(page)).pending); await capture(page, `${platform}-lost-response`, width, height);
    console.log(`${platform}: lost response captured, reloading`);
    await page.reload(); await ready(page); console.log(`${platform}: resumed pending action`); assert((await state(page)).pending); await click(page, 'RETRY ACTION'); if ((await state(page)).pending) { await capture(page, `${platform}-retry-failure`, width, height); console.error('retry-state', await state(page)); } assert.equal((await state(page)).pending, false);
    console.log(`${platform}: exact retry confirmed`);
    const pickRequests = requests.filter(request => request.body?.intent?.kind === 'draftPick'); assert.deepEqual(pickRequests[0]?.body, pickRequests[1]?.body, 'lost action retries identical operation and revision');
    const stale = await context.newPage(); await pinPageAgainstHmr(stale); await stale.goto(`${origin}/?scene=${route}`, { waitUntil: 'domcontentloaded' }); await ready(stale);
    const priorRevision = (await state(page)).revision; await click(page, 'REROLL HAND'); if ((await state(page)).revision === priorRevision) await click(page, 'REROLL HAND'); assert.equal((await state(page)).revision, priorRevision + 1);
    await group(stale, 'OFFENSE · Choose one'); await click(stale, 'CHOOSE'); if ((await state(stale)).revision === priorRevision) await click(stale, 'CHOOSE'); assert.equal((await state(stale)).revision, (await state(page)).revision); await capture(stale, `${platform}-stale-tab`, width, height); await stale.close();
    for (const set of ['OFFENSE', 'DEFENSE', 'SUPPORT', 'WILDCARD']) { await group(page, `${set} · Choose one`); await click(page, 'CHOOSE'); }
    await click(page, 'BEGIN ADVENTURE'); await first(page); await capture(page, `${platform}-region`, width, height);
    await click(page, 'TRAVEL HERE', true); await capture(page, `${platform}-map`, width, height);
    await click(page, 'DECK / BAG'); await capture(page, `${platform}-deck`, width, height);
    const slot = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.children.list.map(o=>o.getData?.('eligibleControl')).find(x=>typeof x==='string'&&x.startsWith('SLOT '));})()` ) as string | null;
    assert(slot); await click(page, slot); if (!(await state(page)).selected) await click(page, slot); assert((await state(page)).selected); await click(page, 'MOVE SELECTED TO HOLDING'); assert((await state(page)).held); await capture(page, `${platform}-holding`, width, height);
    await click(page, 'SELECT'); if (!(await state(page)).selected) await click(page, 'SELECT'); assert.equal((await state(page)).selected?.kind, 'held');
    await click(page, `EMPTY ${slot.match(/\d+/)![0]}`); if ((await state(page)).held) { await capture(page, `${platform}-held-return-failure`, width, height); console.error('held-return', await state(page), requests.slice(-3)); }
    assert.equal((await state(page)).held, null);
    await click(page, 'EQUIPMENT'); await capture(page, `${platform}-equipment`, width, height); await click(page, 'JOURNEY');
    let battle = false;
    for (let step = 0; step < 60 && !battle; step++) {
      await first(page);
      if (await click(page, 'CHOOSE STOP', true)) continue;
      if (await click(page, 'BROWSE SHOP', true)) { await capture(page, `${platform}-shop`, width, height); continue; }
      if (await click(page, 'LEAVE SHOP', true)) continue;
      if (await click(page, 'APPROACH', true)) continue;
      if (await click(page, 'ENTER BATTLE', true)) { await capture(page, `${platform}-pending-encounter`, width, height); continue; }
      if (await click(page, 'FIGHT', true)) { await capture(page, `${platform}-battle-receipt`, width, height); battle = true; break; }
      if (await click(page, 'CONTINUE JOURNEY', true)) continue;
      const choices = await page.evaluate(`window.__game.registry.get('eligibleRunControls').filter(control=>control.enabled).map(control=>control.label)`) as string[];
      const action = choices.find(label => !['PREVIOUS', 'NEXT', 'JOURNEY', 'DECK / BAG', 'EQUIPMENT', 'REFRESH', 'REPLACE RUN', 'REOPEN CHOICE'].includes(label) && !label.startsWith('PAGE '));
      if (action) { await capture(page, `${platform}-event`, width, height); await click(page, action); } else break;
    }
    if (!battle) { await capture(page, `${platform}-journey-failure`, width, height); writeFileSync(join(out, `${platform}-failure-requests.json`), JSON.stringify(requests.map(request => ({ path: request.path, kind: request.body?.intent?.kind })), null, 2)); }
    assert(battle, `${platform}: live journey must reach canonical battle`); assert.equal(requests.some(request => request.path === '/battle'), false);
    const before = await state(page); await page.reload(); await ready(page); const after = await state(page); assert.equal(after.runId, before.runId); assert.equal(after.revision, before.revision); await capture(page, `${platform}-resumed`, width, height);
    const offline = await context.newPage(); await pinPageAgainstHmr(offline); await offline.route('**/runs/**', route => route.abort()); await offline.goto(`${origin}/?scene=${route}`, { waitUntil: 'domcontentloaded' }); await ready(offline); await capture(offline, `${platform}-offline`, width, height); assert.equal((await state(offline)).runId, null);
    assert.deepEqual(errors, []); evidence.push({ platform, width, height, liveCanonicalBattle: true, lostResponseSameOperation: true, staleTabAdoptsServer: true, noClientBattleSetup: true, resumed: after, requests: requests.map(request => ({ path: request.path, intent: request.body?.intent?.kind ?? null })) }); await context.close();
  }
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('eligible Phaser screens OK: desktop 1440x900 and mobile 412x892; actual account/API draft/region/map/deck holding/equipment/canonical battle; lost response reload exact operation; stale tab; resume; offline no fallback; no /battle setup');
} finally { await browser.close(); }
