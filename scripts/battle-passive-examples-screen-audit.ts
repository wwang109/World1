import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { battlePassiveExamples } from '../src/data/battlePassiveExamples';
import type { BattleLog } from '../src/run/resolveBattle';
import { resolveChromiumPath } from './chromiumPath';
import { collectSceneTexts } from './sceneText';

const out = process.argv[2] ?? 'tmp/battle-passive-examples';
const base = process.env.WORLD1_DEV_URL ?? 'http://127.0.0.1:5174';
const api = process.env.WORLD1_BATTLE_API ?? 'http://localhost:8788';
mkdirSync(out, { recursive: true });
for (const example of battlePassiveExamples) {
  const request = () => fetch(`${api}/battle-example`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exampleId: example.id, seed: 5 }) });
  const first = await request(), second = await request();
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const one = await first.text(), two = await second.text();
  assert.equal(one, two, `${example.id} same-seed service result`);
  writeFileSync(join(out, `${example.id}-api.json`), JSON.stringify(JSON.parse(one), null, 2));
}
const browser = await chromium.launch({ executablePath: resolveChromiumPath('battle-passive-examples-screen-audit'), headless: true });
let cases = 0;
try {
  for (const [platform, scene, width, height] of [['desktop', 'desktop-battle', 1440, 900], ['mobile', 'mbattle', 412, 892]] as const) {
    for (const example of battlePassiveExamples) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const result = page.waitForResponse(response => response.url() === `${api}/battle-example` && response.request().method() === 'POST');
      await page.goto(`${base}/?scene=${scene}&battleExample=${example.id}&seed=5&layoutAudit=1`);
      const response = await result;
      assert.equal(response.status(), 200);
      assert.deepEqual(response.request().postDataJSON(), { exampleId: example.id, seed: 5 });
      const log = await response.json() as BattleLog;
      const receipt = log.events.find(event => event.kind === 'preBattleEffect');
      assert(receipt?.kind === 'preBattleEffect');
      await page.waitForFunction(`window.__game?.scene.scenes.some(s=>s.sys.isActive() && s.steps?.length>3)`);
      await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3);s.stopPlayback();s.idx=1;s.render();})()`);
      await page.waitForTimeout(900);
      const state = await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3);const cue=s.children.list.find(o=>o.getData('battlePassiveCue'));return {active:cue?.getData('activePassive'),targets:s.children.list.filter(o=>o.getData('battlePassiveTarget')).map(o=>o.getData('battlePassiveTarget')),texts:cue?.list.filter(o=>o.type==='Text').map(o=>({text:o.text,alpha:o.alpha,b:o.getBounds()}))};})()`) as { active: boolean; targets: Array<{slot:number;size:number}>; texts: Array<{text:string;alpha:number;b:{x:number;y:number;width:number;height:number}}> };
      assert.equal(state.active, receipt.active);
      assert.deepEqual(state.targets.map(({slot,size})=>({slot,size})), receipt.active ? receipt.targets.map(({slot,size})=>({slot,size})) : []);
      for (const text of state.texts) {
        assert.equal(text.alpha, 1); assert(text.b.x >= 0 && text.b.y >= 0 && text.b.x + text.b.width <= width + 1 && text.b.y + text.b.height <= height + 1);
        assert(!/fixture|anchor|authored action|selected active card|example[-_]/i.test(text.text), text.text);
      }
      const texts = await collectSceneTexts(page);
      assert(texts.some(text => text.text.includes(receipt.source.displayName!)), 'canonical source name visible');
      if (example.id === 'quick_preparation') {
        assert(texts.some(text => text.text.includes('WT 10 → 7')));
        assert(texts.some(text => text.text === 'W7'));
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(out, `${platform}-${example.id}.png`) });
      writeFileSync(join(out, `${platform}-${example.id}-layout.json`), JSON.stringify(state, null, 2));
      await page.close(); cases++;
    }
  }
} finally { await browser.close(); }
console.log(`Battle examples: 4 deterministic real HTTP results, ${cases} desktop/mobile screens passed.`);
