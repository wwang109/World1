import assert from 'node:assert/strict';
import{mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';
import{chromium,type Page}from'playwright';import{resolveChromiumPath}from'./chromiumPath';import{pinPageAgainstHmr}from'./pageHarness';import{collectSceneTexts}from'./sceneText';
import { gemBook } from '../src/data/gems';
const out='tmp/equipment-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromiumPath('equipment-rewards'),headless:true});
async function storeSnapshot(page:Page){return await page.evaluate(`(async()=>{const urls=[...new Set(performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname==='/src/game/runStore.ts').map(e=>e.name))];for(const url of urls){const store=await import(url);const run=store.getActiveRun();if(run)return{receipt:store.currentEquipmentDropReceipt(),inventory:store.currentEquipmentInventory(),run}}throw Error('Active run module missing')})()`) as {receipt:{id:string;sourceKind:string;item:{itemId:string}|null};inventory:unknown[];run:unknown}}
async function press(page:Page,text:string){const texts=await collectSceneTexts(page),t=texts.find(t=>t.text===text)||texts.find(t=>t.text.includes(text));assert(t,`Missing ${text}: ${texts.map(t=>t.text).join(' | ')}`);await page.mouse.click(t.x+t.width/2,t.y+t.height/2);await page.waitForTimeout(250)}
try{for(const[platform,prep,event,width,height]of[['desktop','desktop-runprep','desktop-runevent',1440,900],['mobile','mrunprep','mrunevent',412,892]]as const){
 for(const kind of ['battle','event']as const){const page=await browser.newPage({viewport:{width,height}});await pinPageAgainstHmr(page);const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 await page.goto(`http://127.0.0.1:5174/?scene=${kind==='battle'?prep:event}&equipmentFixture=${kind}&seed=7&layoutAudit=1`);await page.waitForTimeout(900);
 const before=await storeSnapshot(page);assert.equal(before.inventory.length,5);
 if(kind==='battle'){
   const response=page.waitForResponse(r=>r.url().endsWith('/battle')&&r.request().method()==='POST');await press(page,'FIGHT');const api=await response;assert.equal(api.status(),200);writeFileSync(join(out,`${platform}-battle-api.json`),JSON.stringify(await api.json(),null,2));
   await page.waitForFunction(`window.__game?.scene.scenes.some(s=>s.sys.isActive()&&s.steps?.length>3)`,undefined,{timeout:20000});
   await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive()&&s.steps?.length>3);s.stopPlayback();s.idx=s.steps.length-1;s.render()})()`);
 }else{
   await press(page,'Pry it open');
   await page.waitForTimeout(1000);
   await page.screenshot({path:join(out,`${platform}-event-picker.png`)});
   const gemId=await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()&&s.pane)?.pane.state.picker?.options[0]`) as string;
   assert(gemBook[gemId]);await press(page,gemBook[gemId]!.name);
 }
 await page.waitForTimeout(800);const after=await storeSnapshot(page);writeFileSync(join(out,`${platform}-${kind}-settlement.json`),JSON.stringify(after,null,2));assert.equal(after.inventory.length,6);
 assert.equal(after.receipt.sourceKind,kind==='battle'?'fight':'event');assert(after.receipt.item);
 const texts=await collectSceneTexts(page);assert.equal(texts.some(t=>/equipment found/i.test(t.text)),true);assert.deepEqual(errors,[]);
 await page.screenshot({path:join(out,`${platform}-${kind}-equipment-reward.png`)});writeFileSync(join(out,`${platform}-${kind}-settlement.json`),JSON.stringify(after,null,2));
 if(kind==='battle')await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive()&&s.steps?.length>3);s.render()})()`);
 const again=await storeSnapshot(page);assert.equal(again.inventory.length,after.inventory.length);assert.deepEqual(again.receipt,after.receipt);await page.close();
 }} }finally{await browser.close()}
console.log('Equipment rewards: battle/event awards and paired screens passed.');
