import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { resolveBattle, type BattleRequest } from '../src/run/resolveBattle';
import type { PassiveRecipe } from '../src/engine/passives/types';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';
import { collectSceneTexts } from './sceneText';

const out = process.argv[2] ?? 'tmp/battle-passives-evidence';
mkdirSync(out, { recursive: true });
const recipe: PassiveRecipe = { schemaVersion: 1, sources: [{
  source: { kind: 'relic', id: 'fixture_ward', version: 1 },
  effects: [
    { id: 'opening_shield', targetBinding: 'automatic', conditions: { slotRange: { min: 1, max: 2, match: 'occupies' } }, effect: { kind: 'setupShield', property: 'physical', amount: 8 } },
    { id: 'unassigned_card', targetBinding: 'playerCard', conditions: { slotRange: { min: 1, max: 2, match: 'anchor' } }, effect: { kind: 'cardShieldPower', amount: 5 } },
  ],
}] };
const browser = await chromium.launch({ executablePath: resolveChromiumPath('battle-passives-screen-audit'), headless: true });
const reports: unknown[] = [];
const floorEvidence = process.env.PASSIVE_SCREEN_EFFECT === 'weight-floor';
const weightEvidence = floorEvidence || process.env.PASSIVE_SCREEN_EFFECT === 'weight';
try {
  for (const [platform, scene, width, height] of [['desktop', 'desktop-battle', 1440, 900], ['mobile', 'mbattle', 412, 892]] as const) {
   for (const mode of (floorEvidence ? ['reduced'] : ['relic', 'talent', 'reduced']) as Array<'relic'|'talent'|'reduced'>) {
    const name = `${platform}-${mode}${floorEvidence ? '-weight-floor' : weightEvidence ? '-weight' : ''}`;
    const reduced = mode === 'reduced';
    const currentRecipe = structuredClone(recipe);
    currentRecipe.sources[0]!.source.kind = mode === 'talent' ? 'talent' : 'relic';
    if (weightEvidence) {
      const effect = currentRecipe.sources[0]!.effects[0]!;
      effect.id = 'prepared_weight';
      effect.effect = { kind: 'cardWeightReduction', amount: floorEvidence ? 12 : 3 };
      effect.targetBinding = 'playerCard';
      effect.conditions = { slotRange: { min: 1, max: 2, match: 'occupies' }, boardCount: { selector: { property: 'physical' }, min: 2 } };
      currentRecipe.sources[0]!.effects[1]!.effect = { kind: 'cardWeightReduction', amount: 3 };
    }
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference', recordVideo: { dir: out, size: { width, height } } });
    await pinPageAgainstHmr(page);
    const errors: string[] = [];
    let expectedTargets: Array<{slot:number;size:number}> = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/battle', async route => {
      const request = route.request().postDataJSON() as BattleRequest;
      const source = currentRecipe.sources[0]!.source;
      const log = weightEvidence
        ? resolveBattle({ ...request, preBattle: { schemaVersion: 1, sources: [source], bindings: [{source,effectId:currentRecipe.sources[0]!.effects[0]!.id,binding:{pieceRef:'fixture-owned-card'}}] } }, {sourceCatalog:currentRecipe.sources,heroPieceRefs:[{slot:2,pieceRef:'fixture-owned-card'}]})
        : resolveBattle(request, { heroPassives: currentRecipe });
      const active = log.events.find(event => event.kind === 'preBattleEffect' && event.active)!;
      assert(active.kind === 'preBattleEffect');
      expectedTargets = active.targets.map(({slot,size})=>({slot,size}));
      writeFileSync(join(out, `${name}-api.json`), JSON.stringify(log, null, 2));
      await route.fulfill({ json: log, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(`${process.env.WORLD1_DEV_URL ?? 'http://localhost:5173'}/?scene=${scene}&seed=5&enemy=${floorEvidence ? 'warbreaker' : 'bandit_duelist'}&layoutAudit=1`);
    await page.waitForFunction(`window.__game?.scene.scenes.some(s => s.sys.isActive() && s.steps?.length > 3)`, { timeout: 30000 });
    await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); s.stopPlayback(); s.idx=0; s.render(); s.playing=true; s.idx=1; s.render(); s.stopPlayback(); })()`);
    await page.waitForTimeout(80);
    const motionState = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); return { animated:s.children.list.find(o=>o.getData('battlePassiveCue'))?.getData('passiveAnimated'), targets:s.children.list.filter(o=>o.getData('battlePassiveTarget')).map(o=>o.getData('battlePassiveTarget')), sweep:s.children.list.some(o=>o.getData('battlePassiveSweep')) }; })()`) as { animated: boolean; targets: Array<{slot:number;size:number}>; sweep:boolean };
    assert.equal(motionState.animated, !reduced);
    assert.deepEqual(motionState.targets.map(({slot,size})=>({slot,size})), expectedTargets);
    assert.equal(motionState.sweep, mode === 'talent');
    await page.screenshot({ path: join(out, `${name}-passive-live.png`) });
    await page.waitForTimeout(900);
    const activeTexts = await collectSceneTexts(page);
    assert.match(activeTexts.map(text => text.text).join(' '), /Active/);
    if (weightEvidence) {
      assert.match(activeTexts.map(text=>text.text).join(' '), floorEvidence ? /WT 10→1/ : /WT 10→7/);
      assert(activeTexts.some(text=>text.text===(floorEvidence ? 'W1' : 'W7')));
      const card = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); const p=s.heroPieces.find(p=>p.slot===2); return {prepared:p.preparedWeight,authored:p.skill.speedWeight??p.skill.size*10}; })()`);
      assert.deepEqual(card,{prepared:floorEvidence ? -2 : 7,authored:10});
    }
    await page.screenshot({ path: join(out, `${name}-prebattle-active.png`) });
    await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); s.idx=2; s.render(); })()`);
    await page.waitForTimeout(900);
    const texts = await collectSceneTexts(page);
    const logText = texts.map(text => text.text).join(' ');
    assert.match(logText, /fixture ward/);
    assert.match(logText, /Slots 2–3/);
    assert.match(logText, /Choose a target/);
    assert.deepEqual(errors, []);
    const rows = [...activeTexts, ...texts].filter(text => text.text.includes('fixture ward') || text.text.includes('Slots 2–3') || text.text.includes('Choose a target'));
    for (const row of rows) {
      assert(!row.clipped && !row.unresolvedMask, `${name}: clipped summary ${row.text}`);
      assert(row.x >= 0 && row.y >= 0 && row.x + row.width <= width + 1 && row.y + row.height <= height + 1, `${name}: summary outside viewport`);
    }
    for (const frame of [activeTexts, texts]) {
      for (const row of frame.filter(text => text.text.includes('fixture ward') || text.text.includes('Slots 2–3'))) {
        for (const other of frame) {
          if (row === other) continue;
          const overlapWidth = Math.min(row.x + row.width, other.x + other.width) - Math.max(row.x, other.x);
          const overlapHeight = Math.min(row.y + row.height, other.y + other.height) - Math.max(row.y, other.y);
          assert(overlapWidth <= 1 || overlapHeight <= 1, `${name}: summary overlaps ${other.text}`);
        }
      }
    }
    const settled = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); return s.children.list.filter(o=>o.type==='Text' && /fixture ward|Slots 2–3/.test(o.text)).map(o=>o.alpha); })()`) as number[];
    assert(settled.length > 0 && settled.every((alpha: number) => alpha === 1), `${name}: summary capture during entrance animation`);
    await page.screenshot({ path: join(out, `${name}-prebattle.png`) });
    const inactive = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); return { animated:s.children.list.find(o=>o.getData('battlePassiveCue'))?.getData('passiveAnimated'), targets:s.children.list.filter(o=>o.getData('battlePassiveTarget')).length }; })()`) as { animated:boolean;targets:number };
    assert.deepEqual(inactive, {animated:false,targets:0});
    const cleanup = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); s.idx=1; s.render(); s.render(); const staticCue=s.children.list.find(o=>o.getData('battlePassiveCue')); const repeated=staticCue?.getData('passiveAnimated'); s.idx=0; s.render(); const cleared=s.children.list.every(o=>!o.getData('battlePassiveCue')&&!o.getData('battlePassiveTarget')&&!o.getData('battlePassiveSweep')); s.playing=true;s.idx=1;s.render();s.stopPlayback();const replayed=s.children.list.find(o=>o.getData('battlePassiveCue'))?.getData('passiveAnimated'); return {repeated,cleared,replayed}; })()`) as {repeated:boolean;cleared:boolean;replayed:boolean};
    assert.deepEqual(cleanup, {repeated:false,cleared:true,replayed:!reduced});
    if (floorEvidence) {
      const tax = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); s.stopPlayback(); const found=[...s.slotModsByTurn].find(([turn,mods])=>(mods['player:0:2']?.burden??0)>0); if(!found)return null;const [turn,mods]=found; s.idx=s.steps.findIndex(step=>step.turn===turn);s.render();return {raw:s.heroPieces.find(p=>p.slot===2).preparedWeight,burden:mods['player:0:2'].burden}; })()`) as {raw:number;burden:number}|null;
      assert(tax, `${name}: real encounter must leave a positive burden on selected card`);
      const expected=Math.max(1,tax.raw+tax.burden);
      const taxTexts=await collectSceneTexts(page);
      assert(taxTexts.some(text=>text.text===`W${expected}`));
      assert.notEqual(expected,Math.max(1,tax.raw)+tax.burden);
      await page.screenshot({path:join(out,`${name}-burden.png`)});
    }
    const replay = (await collectSceneTexts(page)).find(text => text.text === 'REPLAY')!;
    await page.mouse.click(replay.x + replay.width / 2, replay.y + replay.height / 2);
    await page.waitForFunction(`window.__game.scene.scenes.some(s=>s.sys.isActive() && s.children.list.some(o=>o.getData('battlePassiveCue') && o.getData('activePassive')))`, { timeout: 5000 });
    const replayMotion = await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); s.stopPlayback(); return s.children.list.find(o=>o.getData('battlePassiveCue'))?.getData('passiveAnimated'); })()`);
    assert.equal(replayMotion, !reduced);
    if (name === 'desktop-relic') {
      await page.evaluate(`(() => { const s=window.__game.scene.scenes.find(s=>s.sys.isActive() && s.steps?.length>3); window.__passiveShutdownRefs=s.children.list.filter(o=>o.getData('battlePassiveCue')||o.getData('battlePassiveTarget')||o.getData('battlePassiveSweep')); s.scene.stop(); })()`);
      await page.waitForFunction(`window.__passiveShutdownRefs.length>0 && window.__passiveShutdownRefs.every(o=>!o.active)`, { timeout: 3000 });
    }
    reports.push({ name, width, height, route: scene, rows, errors, texts });
    const video = page.video()!;
    await page.close();
    await video.saveAs(join(out, `${name}-passive-animation.webm`));
    console.log(`ok ${name} real-engine summaries, source motion, exact footprints, inactive, reduced motion, scrub cleanup, replay, and bounds`);
   }
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'screen-audit.json'), JSON.stringify(reports, null, 2));
console.log(`battle passive screen audit passed: ${reports.length} cases across 2 viewports`);
