import {writeFileSync} from 'node:fs';
import * as r from '../../../../src/run/runState';
import {DRAFT_SET_KEYS} from '../../../../src/run/draft';
import {battleStatsFromEvents} from '../../../../src/run/logAnalysis';
import {mapFightGoldReward} from '../../../../src/run/shop';
const root='artifacts/promo/wandering-hand-2026-10-20/capture-battle';
for(const seed of [7,11,42,77,99,18,23,51])for(let variant=0;variant<3;variant++){
 let state=r.createRun(seed);const hand=r.currentStartDraft(state);const picks=Object.fromEntries(DRAFT_SET_KEYS.map((key,i)=>[key,hand[key][(variant+i)%5]!.skillId]));state=r.applyDraftResult(state,picks);let first:any=null;const history:any[]=[];
 for(let step=0;step<20&&state.status==='active';step++){
 const band=r.pendingBiomeBand(state);if(band!==null){const offers=r.biomeBandOffers(state,band);state=r.chooseBiome(state,band,offers.includes('swornhold')?'swornhold':offers[0]!);}
 const options=r.availableChoices(state);const node=options.find(n=>n.kind==='boss')??options.find(n=>n.kind==='fight'&&n.fightOption==='easy')??options.find(n=>n.kind==='fight')??options.find(n=>n.kind==='shop')??options[0];if(!node)break;state=r.chooseNode(state,node.id);
 if(node.kind==='shop'){state=r.ensureRunShopShelf(state,node.id);let bought=true;while(bought){bought=false;const offers=state.shopShelves[node.id]!.cards;for(let i=0;i<offers.length&&!bought;i++){if(state.pieces.filter(p=>p.skillId===offers[i]!.skillId).length>=1)continue;for(let slot=0;slot<10;slot++){const buy=r.buyRunCardTo(state,node.id,i,{where:'board',slot});if(buy.ok){state=buy.state;bought=true;break;}}}}state=r.leaveShop(state);continue;}if(node.kind==='event'){state=r.leaveEvent(state);continue;}
 const budget=(state.heroLevel-1)*3;state=r.setHeroAllocation(state,{attack:Math.ceil(budget/2),armor:Math.floor(budget/2)});
 const pack=r.rollEncounter(state);const request={pieces:state.pieces,heroLevel:state.heroLevel,heroAllocation:state.heroAllocation,foes:pack.units.map(u=>({enemyId:u.enemyId,level:u.level,title:u.title,rank:u.baseRank,growthLevel:u.growthLevel,fightNumber:node.fightNumber,modifiers:u.modifiers,affix:u.affix,bumped:u.bumped})),seed:node.encounterSeed};const res=await fetch('http://localhost:8787/battle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});if(!res.ok)throw Error(await res.text());const log=await res.json();history.push({nodeId:node.id,kind:node.kind,heroLevel:state.heroLevel,result:log.result,request});
 if(log.result==='win'&&!first){first=structuredClone(state);writeFileSync(`${root}/normal-state.json`,JSON.stringify(first));writeFileSync(`${root}/normal-provenance.json`,JSON.stringify({seed,picks,history},null,2));}
 if(node.kind==='boss'){console.log(seed,variant,log.result,picks);if(first && state.lives >= 2){writeFileSync(`${root}/normal-state.json`,JSON.stringify(first));writeFileSync(`${root}/boss-state.json`,JSON.stringify(state));writeFileSync(`${root}/fixture-provenance.json`,JSON.stringify({seed,picks,history,note:'Ephemeral capture save built using real draft offers, chooseBiome/chooseNode, skipped shops/events, API battle logs and recordBattleResult. Allocations respect earned level PL; no duplicate-card fixture, balance edits or user storage.'},null,2));process.exit(0);}break;}
 const reward=mapFightGoldReward(node.fightOption,node.kind==='boss');state=r.recordBattleResult(state,{won:log.result==='win',goldEarned:log.result==='win'?reward.base+reward.winBonus:0,...battleStatsFromEvents(log.events)}).state;
 }
}
throw Error('bounded viable boss scout exhausted');

