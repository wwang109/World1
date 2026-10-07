import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';
import { collectSceneTexts } from './sceneText';
const out = 'tmp/equipment-tracking'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('tracking'), headless: true });
async function click(page: Page, key: string, value: unknown) {
  const box = await page.evaluate(({ key, value }) => {
    const game = (window as any).__game, scene = game.scene.scenes.find((s: any) => s.sys.isActive());
    const flatten = (list: any[]): any[] => list.flatMap(o => [o, ...(o.list ? flatten(o.list) : [])]);
    const object = flatten(scene.children.list).find(o => o.getData(key) === value && o.input?.enabled);
    if (!object) return null;
    const b = object.getBounds(); return { x: key === 'equipmentPossibleLoot' ? b.x + 15 : b.centerX, y: b.centerY };
  }, { key, value });
  assert(box, `Missing ${key}: ${value}`); await page.mouse.click(box.x, box.y); await page.waitForTimeout(250);
}
async function label(page: Page, value: string) {
  const target = (await collectSceneTexts(page)).find(t => t.text === value); assert(target, `Missing ${value}`);
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2); await page.waitForTimeout(400);
}
try {
  for (const [platform, route, width, height, mapScene, prepScene] of [
    ['desktop', 'desktop-equipment', 1440, 900, 'DesktopRunMap', 'DesktopRunPrep'],
    ['mobile', 'mequipment', 412, 892, 'MobileRunMap', 'MobileRunPrep'],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } }); await pinPageAgainstHmr(page);
    await page.addInitScript('window.__name=(value)=>value');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:5174/?scene=${route}&equipmentFixture=1&equipmentTrackingFixture=fight&seed=5`;
    await page.goto(url); await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`); await page.waitForTimeout(450);
    await page.evaluate(`localStorage.removeItem('world1:equipment-tracking:v1')`);
    await click(page, 'equipmentButton', 'LOOT FROM');
    await click(page, 'equipmentTrack', 'enemies'); await click(page, 'equipmentTrack', 'events');
    let goal = await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel').tracking`) as any;
    assert(goal.enemies && goal.events);
    await page.screenshot({ path: `${out}/${platform}-tracking-controls.png` });
    for (const t of await collectSceneTexts(page)) assert(t.x >= -1 && t.y >= -1 && t.x + t.width <= width + 1 && t.y + t.height <= height + 1, `Outside: ${t.text}`);
    await page.reload(); await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`);
    await click(page, 'equipmentButton', 'LOOT FROM');
    goal = await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel').tracking`) as any;
    assert(goal.enemies && goal.events);
    await click(page, 'equipmentTrack', 'enemies');
    goal = await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel').tracking`) as any; assert(!goal.enemies && goal.events);
    await click(page, 'equipmentTrack', 'enemies'); await click(page, 'equipmentLootControl', 'CLOSE');
    await label(page, '\u2039 MAP'); await page.waitForFunction(`window.__game.scene.isActive('${mapScene}')`);
    if ((await collectSceneTexts(page)).some(t => t.text === 'CHOOSE REGION')) await label(page, 'CHOOSE REGION');
    await page.screenshot({ path: `${out}/${platform}-map-tracked.png` });
    const tracked = (await collectSceneTexts(page)).filter(t => t.text.includes('TRACKED')); assert(tracked.length, 'No matching map source');
    const trackedNode = await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());const f=list=>list.flatMap(o=>[o,...(o.list?f(o.list):[])]);return f(s.children.list).find(o=>o.getData('equipmentTrackedLoot'))?.getData('equipmentTrackedLoot')})()`);
    assert(trackedNode); await click(page, 'equipmentTrackedLoot', trackedNode);
    await page.screenshot({ path: `${out}/${platform}-tracked-chances.png` });
    await click(page, 'equipmentChanceControl', 'CLOSE');
    if (platform === 'mobile') { await page.mouse.move(220, 610); await page.mouse.wheel(0, 700); await page.waitForTimeout(250); }
    const fight = (await collectSceneTexts(page)).find(t => t.text === 'FIGHT \u203a' && t.y > 0 && t.y + t.height < height - (platform === 'mobile' ? 110 : 0)); assert(fight);
    await page.mouse.click(fight.x + fight.width / 2, fight.y + fight.height / 2); await page.waitForTimeout(500);
    await page.waitForFunction(`window.__game.scene.isActive('${prepScene}')`, undefined, { timeout: 10000 });
    await page.screenshot({ path: `${out}/${platform}-prep-loot.png` });
    await click(page, 'equipmentPossibleLoot', true);
    await page.screenshot({ path: `${out}/${platform}-possible-loot.png` });
    const loot = await page.evaluate(`window.__game.registry.get('equipmentChancePanel').items`) as any[];
    assert(loot.length); const missing = loot.find(item => !['duelist_coat','duelist_crest','duelist_knot','wind_charm','arcanist_robe'].includes(item.ref.itemId));
    assert(missing, 'Fixture needs unowned loot'); await click(page, 'equipmentChanceItem', missing.ref.itemId);
    await click(page, 'equipmentTrack', 'enemies');
    assert((await page.evaluate(`JSON.parse(localStorage.getItem('world1:equipment-tracking:v1'))`) as any[]).some(goal => goal.itemId === missing.ref.itemId && goal.enemies));
    await page.screenshot({ path: `${out}/${platform}-track-unowned.png` });
    await click(page, 'equipmentTrackManager', true);
    assert((await page.evaluate(`window.__game.registry.get('equipmentChancePanel').items`) as any[]).length >= 2);
    await page.screenshot({ path: `${out}/${platform}-tracked-manager.png` });
    assert.deepEqual(errors, []);
    await page.goto(url); await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`);
    await page.evaluate(`Storage.prototype.setItem=function(){throw new Error('quota')}`);
    await click(page, 'equipmentButton', 'LOOT FROM'); await click(page, 'equipmentTrack', 'enemies');
    assert.equal(await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel').tracking.enemies`), false);
    await click(page, 'equipmentTrack', 'events');
    assert.equal(await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel').tracking`), null);
    await page.goto(`http://127.0.0.1:5174/?scene=${route}&equipmentTrackingFixture=event&seed=5`);
    await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`);
    await page.waitForTimeout(450);
    await page.evaluate(`localStorage.removeItem('world1:equipment-tracking:v1')`);
    if (platform === 'mobile') { await page.mouse.move(220, 610); await page.mouse.wheel(0, 200); await page.waitForTimeout(250); }
    await page.screenshot({ path: `${out}/${platform}-set-pieces.png` });
    const pieces = await page.evaluate(`window.__game.registry.get('equipmentUiSetPieces')`) as any[];
    assert.equal(pieces.length, 3); assert(pieces.some(piece => piece.itemId === 'duelist_knot' && !piece.owned));
    await click(page, 'equipmentSetPiece', 'duelist_knot');
    assert.equal(await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel').item`), 'Duelist Knot');
    await page.screenshot({ path: `${out}/${platform}-missing-piece-sources.png` });
    await click(page, 'equipmentLootControl', 'CLOSE');
    await click(page, 'equipmentSetPiece', 'duelist_coat'); await click(page, 'equipmentTrack', 'events');
    await click(page, 'equipmentLootControl', 'CLOSE'); await label(page, '\u2039 MAP');
    await page.waitForFunction(`window.__game.scene.isActive('${mapScene}')`);
    assert((await collectSceneTexts(page)).some(t => t.text.includes('TRACKED') && t.text.includes('Duelist Coat 0%')));
    await page.screenshot({ path: `${out}/${platform}-event-zero-chance.png` });
    const eventNode = await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());const f=list=>list.flatMap(o=>[o,...(o.list?f(o.list):[])]);return f(s.children.list).find(o=>o.getData('equipmentTrackedLoot'))?.getData('equipmentTrackedLoot')})()`);
    await click(page, 'equipmentTrackedLoot', eventNode); await page.screenshot({ path: `${out}/${platform}-event-choice-odds.png` });
    await click(page, 'equipmentChanceControl', 'CLOSE');
    await label(page, 'BAG'); await click(page, 'bagTab', 'equipment');
    if (platform === 'mobile') { await page.mouse.move(220, 610); await page.mouse.wheel(0, 200); await page.waitForTimeout(250); }
    await click(page, 'equipmentSetPiece', 'duelist_coat'); await click(page, 'equipmentTrack', 'events');
    await click(page, 'equipmentLootControl', 'CLOSE'); await label(page, '\u2039 MAP');
    assert(!(await collectSceneTexts(page)).some(t => t.text.includes('TRACKED')));
    await page.screenshot({ path: `${out}/${platform}-event-tracking-disabled.png` });
    await page.close();
  }
} finally { await browser.close(); }
console.log('Equipment tracking UI: desktop/mobile controls, reload, independent disable, failed-write session fallback, tracked map odds, prep loot, missing-item tracking and goal manager passed.');
