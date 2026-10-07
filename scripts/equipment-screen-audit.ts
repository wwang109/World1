import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync}from'node:fs';
import{join}from'node:path';
import{chromium,type Page}from'playwright';
import{resolveChromiumPath}from'./chromiumPath';
import{collectSceneTexts}from'./sceneText';
import type{EquipmentResolution}from'../src/engine/equipment/types';
import{pinPageAgainstHmr}from'./pageHarness';
import{equipmentDocument}from'../src/data/equipmentContent';
import{equipmentLootSourcesFromJson}from'../src/data/equipmentLootSources';
const out='tmp/equipment-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromiumPath('equipment-ui'),headless:true});
async function click(page:Page,key:string,value:string){const box=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());const flatten=list=>list.flatMap(o=>[o,...(o.list?flatten(o.list):[])]);const o=flatten(s.children.list).find(o=>o.getData('${key}')==='${value}');if(!o)return null;const b=o.getBounds();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`) as {x:number;y:number}|null;assert(box,`${key}=${value}`);await page.mouse.click(box.x,box.y);await page.waitForTimeout(150)}
async function clickLabel(page:Page,label:string){const texts=await collectSceneTexts(page);const target=texts.find(t=>t.text===label);assert(target,`missing navigation: ${label}`);await page.mouse.click(target.x+target.width/2,target.y+target.height/2);await page.waitForTimeout(300)}
try{for(const[platform,scene,width,height]of[['desktop','desktop-equipment',1440,900],['mobile','mequipment',412,892]]as const){
 const page=await browser.newPage({viewport:{width,height}});await pinPageAgainstHmr(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:5174/?scene=${scene}&equipmentFixture=1&seed=5`);await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`,undefined,{timeout:15000}).catch(async error=>{await page.screenshot({path:join(out,`${platform}-error.png`)});throw new Error(`${error}\n${errors.join('\n')}`)});await page.waitForTimeout(500);
 const resolution=async()=>await page.evaluate(`window.__game.registry.get('equipmentUiResolution')`) as EquipmentResolution;
 const initial=await resolution();assert(initial.sets[0]);assert.equal(initial.sets[0].equippedPieces,2);assert.equal(initial.sets[0].requirementMet,true);assert.deepEqual(initial.sets[0].activeThresholds,[2]);
 const preview=await page.evaluate(`window.__game.registry.get('equipmentUiPreview')`) as {itemId:string;currentStats:{attack:number;armor:number};nextStats:{attack:number;armor:number}};assert.equal(preview.itemId,'duelist_knot');assert.equal(preview.currentStats.attack,4);assert.equal(preview.nextStats.attack,5);assert.equal(preview.currentStats.armor,2);assert.equal(preview.nextStats.armor,4);
 const artKeys=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.children.list.flatMap(o=>[o,...(o.list??[])]).filter(o=>o.getData('equipmentArt')).map(o=>({id:o.getData('equipmentArt'),key:o.texture.key}))})()`) as {id:string;key:string}[];assert(artKeys.length>=7);assert(artKeys.every((a:{id:string;key:string})=>a.key==='equipment-'+a.id));
 const tileSizes=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.children.list.flatMap(o=>[o,...(o.list??[])]).filter(o=>o.getData('equipmentBagTile')).map(o=>({width:o.width,height:o.height}))})()`) as {width:number;height:number}[];assert(tileSizes.length>=5);assert(tileSizes.every((size:{width:number;height:number})=>size.width===tileSizes[0]!.width&&size.height===tileSizes[0]!.height));
 const imageSizes=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.children.list.flatMap(o=>[o,...(o.list??[])]).filter(o=>o.getData('equipmentBagImageSize')).map(o=>o.getData('equipmentBagImageSize'))})()`) as number[];assert(imageSizes.length>=5);assert(imageSizes.every(size=>size===(platform==='mobile'?48:112)));
 const bagGeometry=await page.evaluate(`window.__game.registry.get('equipmentUiBagGeometry')`) as {x:number;y:number;width:number;height:number;tileWidth:number;tileHeight:number;columns:number;rows:number;tileGap:number};
 assert(Math.abs(bagGeometry.columns*bagGeometry.tileWidth+(bagGeometry.columns-1)*bagGeometry.tileGap-bagGeometry.width)<0.01);
 const bagBounds=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.children.list.flatMap(o=>[o,...(o.list??[])]).filter(o=>o.getData('equipmentBagTile')).map(o=>{const b=o.getBounds();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}})})()`) as {x:number;y:number;right:number;bottom:number}[];
 assert(Math.abs(Math.min(...bagBounds.map(b=>b.x))-bagGeometry.x)<0.01);assert(Math.abs(Math.max(...bagBounds.map(b=>b.right))-(bagGeometry.x+bagGeometry.width))<0.01);
 if(platform==='mobile'){const heights=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.children.list.flatMap(o=>[o,...(o.list??[])]).filter(o=>o.getData('equipmentButton')).map(o=>o.getBounds().height)})()`) as number[];assert(heights.every((height:number)=>height>=44))}
 await page.screenshot({path:join(out,`${platform}-two-piece.png`)});
 await click(page,'equipmentButton','LOOT FROM');
 const source=equipmentLootSourcesFromJson().sources.find(source=>source.ref.itemId==='duelist_knot'&&source.ref.itemVersion===1&&source.ref.setVersion===1)!;
 const expectedSources=[...source.locations.map(row=>`Location:${row.name}`),...source.enemies.map(row=>`Enemy:${row.name}`),...source.events.map(row=>`Event:${row.name}`)].sort();
 const shownSources=new Set<string>();
 for(let index=0;index<100;index++){
   const loot=await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel')`) as {page:number;pages:number;visibleRows:{kind:string;name:string}[]};
   assert.equal(loot.page,index);const sourceTexts=await collectSceneTexts(page);
   for(const row of loot.visibleRows){assert(sourceTexts.some(text=>text.text===row.name));shownSources.add(`${row.kind}:${row.name}`)}
   for(const t of sourceTexts)assert(t.x>=-1&&t.y>=-1&&t.x+t.width<=width+1&&t.y+t.height<=height+1,`loot outside: ${t.text}`);
   await page.screenshot({path:join(out,`${platform}-loot-from-${index}.png`)});
   if(index+1===loot.pages)break;await click(page,'equipmentLootControl','NEXT');
 }
 assert.deepEqual([...shownSources].sort(),expectedSources);await click(page,'equipmentLootControl','CLOSE');assert.deepEqual(await resolution(),initial);
 await page.evaluate(`(async()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());const panel=await import('/src/game/ui/equipmentLootPanel.ts');const rebuild=await import('/src/game/sceneRebuild.ts');panel.renderEquipmentLootPanel(s,${platform==='mobile'},{name:'Unassigned Equipment',slot:'armor',baseText:'',lootFrom:{title:'Loot From',locationCaption:'Often found in',locations:[],enemies:[],events:[],locationNote:'No known locations.'}},0,()=>{},()=>rebuild.rebuildScene(s))})()`);
 assert((await collectSceneTexts(page)).some(t=>t.text==='No named sources assigned yet.'));await page.screenshot({path:join(out,`${platform}-loot-unassigned.png`)});await click(page,'equipmentLootControl','CLOSE');
 await clickLabel(page,'\u2039 MAP');
 await page.waitForFunction(`window.__game.scene.isActive('${platform==='mobile'?'MobileRunMap':'DesktopRunMap'}')`);
 const mapText=await collectSceneTexts(page);assert(!mapText.some(t=>t.text==='EQUIPMENT'));
 await clickLabel(page,'BAG');
 await page.waitForFunction(`window.__game.scene.isActive('${platform==='mobile'?'MobileDeckBuild':'DesktopDeck'}')`);
 await page.screenshot({path:join(out,`${platform}-bag-cards-tab.png`)});
 await click(page,'bagTab','equipment');
 await page.waitForFunction(`window.__game.scene.isActive('${platform==='mobile'?'MobileEquipment':'DesktopEquipment'}')`);
 assert.deepEqual(await resolution(),initial);
 await page.screenshot({path:join(out,`${platform}-bag-equipment-tab.png`)});
 await click(page,'bagTab','cards');
 await page.waitForFunction(`window.__game.scene.isActive('${platform==='mobile'?'MobileDeckBuild':'DesktopDeck'}')`);
 await click(page,'bagTab','equipment');
 await page.waitForFunction(`window.__game.scene.isActive('${platform==='mobile'?'MobileEquipment':'DesktopEquipment'}')`);
 await page.evaluate(`(async()=>{const context=await import('/src/game/deckBuildContext.ts');context.setDeckBuildContext('run');const s=window.__game.scene.scenes.find(s=>s.sys.isActive());s.scene.start('${platform==='mobile'?'MobileDeckBuild':'DesktopDeck'}')})()`);await page.waitForTimeout(250);await page.screenshot({path:join(out,`${platform}-native-bag.png`)});
 await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());s.scene.start('${platform==='mobile'?'MobileEquipment':'DesktopEquipment'}')})()`);await page.waitForTimeout(250);
 await click(page,'equipmentItem','dev-equipment:duelist_knot');await page.screenshot({path:join(out,`${platform}-details.png`)});const modalTexts=await collectSceneTexts(page);for(const t of modalTexts)assert(t.x>=-1&&t.y>=-1&&t.x+t.width<=width+1&&t.y+t.height<=height+1,`modal outside: ${t.text}`);await click(page,'equipmentButton','EQUIP');const three=await resolution();assert.deepEqual(three.sets[0]!.activeThresholds,[2,3]);
 await page.screenshot({path:join(out,`${platform}-three-piece.png`)});
 await click(page,'equipmentItem','dev-equipment:wind_charm');await click(page,'equipmentButton','EQUIP');assert.deepEqual((await resolution()).sets[0]!.activeThresholds,[2]);
 await click(page,'equipmentItem','dev-equipment:duelist_knot');await click(page,'equipmentButton','EQUIP');await click(page,'equipmentItem','dev-equipment:arcanist_robe');await click(page,'equipmentButton','EQUIP');const off=await resolution();assert(off.sets.some((s:{requirementMet:boolean})=>!s.requirementMet));
 await page.screenshot({path:join(out,`${platform}-condition-inactive.png`)});
 await click(page,'equipmentItem','dev-equipment:arcanist_robe');await click(page,'equipmentButton','UNEQUIP');const saved=await resolution();
 const stored=await page.evaluate(`(async()=>{const scene=window.__game.scene.scenes.find(s=>s.sys.isActive());const meta=await import('/src/meta/runSave.ts');return meta.saveRun({get:key=>localStorage.getItem(key),set:(key,value)=>{localStorage.setItem(key,value);return true}},scene.data.get('equipmentUiRun'))})()`);assert.equal((stored as {ok:boolean}).ok,true);
 await page.goto(`http://127.0.0.1:5174/?scene=${scene}&seed=5`);await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`,undefined,{timeout:15000});const reloaded=await resolution();assert.deepEqual(reloaded,saved);
 const texts=await collectSceneTexts(page);for(const t of texts){assert(t.x>=-1&&t.y>=-1&&t.x+t.width<=width+1&&t.y+t.height<=height+1,`outside: ${t.text}`)}assert.deepEqual(errors,[]);
 await page.goto(`http://127.0.0.1:5174/?scene=${scene}&equipmentFixture=all&seed=5`);await page.waitForFunction(`window.__game?.registry.get('equipmentUiResolution')`,undefined,{timeout:15000});await page.waitForTimeout(300);
 await page.screenshot({path:join(out,`${platform}-full-bag.png`)});
 const seen=new Set<string>();
 const pageCount=Math.ceil(equipmentDocument.items.length/(platform==='mobile'?6:8));
 for(let i=0;i<pageCount;i++){
   const allText=await collectSceneTexts(page);for(const t of allText)assert(t.x>=-1&&t.y>=-1&&t.x+t.width<=width+1&&t.y+t.height<=height+1,`catalog outside: ${t.text}`);
   assert(allText.some(t=>t.text===`${i+1} / ${pageCount}`));
   assert(!allText.some(t=>t.text==='\u2039 BAG'||t.text==='BAG \u203a'));
   assert(!allText.some(t=>/SET COLLECTION|OTHER ITEMS|NO SET ITEMS/.test(t.text)));
   const state=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return {ids:s.children.list.flatMap(o=>[o,...(o.list??[])]).filter(o=>o.getData('equipmentItem')).map(o=>o.getData('equipmentItem')),next:!!s.children.list.flatMap(o=>[o,...(o.list??[])]).find(o=>o.getData('equipmentButton')==='›'&&o.input?.enabled)}})()`) as {ids:string[];next:boolean};
   for(const id of state.ids){seen.add(id);await click(page,'equipmentItem',id);if(id==='dev-equipment:bastion_plate')await page.screenshot({path:join(out,`${platform}-multi-stat.png`)});const itemTexts=await collectSceneTexts(page);for(const t of itemTexts)assert(t.x>=-1&&t.y>=-1&&t.x+t.width<=width+1&&t.y+t.height<=height+1,`item ${id} outside: ${t.text}`);
     if(id==='dev-equipment:huntsman_coat'||id==='dev-equipment:wind_charm'){
       await click(page,'equipmentButton','LOOT FROM');const loot=await page.evaluate(`window.__game.registry.get('equipmentUiLootPanel')`) as {rows:{kind:string;name:string}[]};
       if(id.endsWith('wind_charm'))assert(loot.rows.some(row=>row.kind==='Event'));
       const pin=equipmentDocument.items.find(item=>`dev-equipment:${item.id}`===id)!;
       const actualSource=equipmentLootSourcesFromJson().sources.find(source=>source.ref.itemId===pin.id&&source.ref.itemVersion===1);
       assert.deepEqual(loot.rows.map(({kind,name})=>({kind,name})),[...(actualSource?.locations??[]).map(row=>({kind:'Location',name:row.name})),...(actualSource?.enemies??[]).map(row=>({kind:'Enemy',name:row.name})),...(actualSource?.events??[]).map(row=>({kind:'Event',name:row.name}))]);
       await page.screenshot({path:join(out,`${platform}-loot-${id.endsWith('huntsman_coat')?'new-set':'event'}.png`)});await click(page,'equipmentLootControl','CLOSE');
     }
   }await page.screenshot({path:join(out,`${platform}-bag-${i}.png`)});
   if(!state.next)break;await click(page,'equipmentButton','›');
 }
 assert.equal(seen.size,equipmentDocument.items.length);await click(page,'equipmentButton','‹');
 const allLoaded=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.data.get('equipmentUiRun').ownedEquipment.every(item=>s.textures.exists('equipment-'+item.itemId))})()`);assert.equal(allLoaded,true);assert.deepEqual(errors,[]);
 const imageBounds=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive());return s.data.get('equipmentUiRun').ownedEquipment.map(item=>{const image=s.textures.get('equipment-'+item.itemId).source[0].image;const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height).data;let left=image.width,top=image.height,right=-1,bottom=-1;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(pixels[(y*image.width+x)*4+3]>=8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}return {id:item.itemId,width:image.width,height:image.height,left,right,top,bottom}})})()`) as {id:string;width:number;height:number;left:number;right:number;top:number;bottom:number}[];
 for(const b of imageBounds){assert.equal(b.width,512);assert.equal(b.height,512);assert(b.left>=38&&b.top>=38&&b.right<=473&&b.bottom<=473,`missing safe padding: ${b.id}`);assert(Math.abs((b.left+b.right)/2-255.5)<=2&&Math.abs((b.top+b.bottom)/2-255.5)<=2,`off center: ${b.id}`)}
 writeFileSync(join(out,`${platform}-evidence.json`),JSON.stringify({initial,three,off,reloaded,imageBounds,errors},null,2));await page.close();
 }}finally{await browser.close()}
console.log(`Equipment UI: Bag tabs, paired screens, all ${equipmentDocument.items.length} items, all-item paging, Loot From source pages and empty/event states, stat previews, equip/swap/unequip, requirements and reload checks passed.`);



