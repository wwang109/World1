import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveChromiumPath } from './chromiumPath';
const out='tmp/talent-relic-native-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromiumPath('native-targeting'),headless:true});
try{for(const [name,scene,width,height] of [['desktop','desktop-deck',1440,900],['mobile','mdeck',412,892]] as const){const page=await browser.newPage({viewport:{width,height}});await page.goto(`http://127.0.0.1:5174/?scene=${scene}&seed=5`);await page.waitForFunction(`window.__game?.scene.scenes.some(s=>s.sys.isActive()&&s.layout?.rowH)`);await page.waitForTimeout(600);const state=await page.evaluate(`(()=>{const s=window.__game.scene.scenes.find(s=>s.sys.isActive()&&s.layout?.rowH);return {layout:s.layout,holdingTop:s.holdingTop,holdingH:s.holdingH,trashTop:s.trashTop,trashH:s.trashH,cards:s.draggables.map(d=>({bounds:d.bounds,src:d.src}))}})()`);writeFileSync(join(out,`${name}-baseline.json`),JSON.stringify(state,null,2));await page.screenshot({path:join(out,`${name}-baseline.png`)});await page.close()}}finally{await browser.close()}
