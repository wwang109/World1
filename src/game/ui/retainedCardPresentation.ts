import type Phaser from 'phaser';
import type { FantasyCardRulesRow, FantasyRulesCategory } from './fantasyCardRulesRows';
import { FANTASY_RULES_STYLES } from './fantasyCardRulesRows';
export interface RetainedCardPresentation { body: string; artUrl: string | null;rows?:FantasyCardRulesRow[];segments?:import('../../run/skillPresentation').EffectSegment[] }
const requested=new WeakMap<Phaser.Scene,Set<string>>();
export function retainedRulesRows(body:string):FantasyCardRulesRow[]{
  return body.split(' · ').map(text=>{
    const category:FantasyRulesCategory=text.includes('{{Affinity}}')?'affinity':/^Deal |^Hit /i.test(text)?'attack':/^Restore |^Heal /i.test(text)?'healing':/Shield|Ward|Guard|Thorns/.test(text)?'defense':/Passive:/.test(text)?'passive':'support';
    return {category,label:FANTASY_RULES_STYLES[category].label,text,display:text.replace(/\.$/,'').replace(/^\{\{Affinity\}\}\s*/,''),affinity:category==='affinity'};
  });
}
export function whenRetainedArtReady(scene:Phaser.Scene,url:string|null,ready:(key:string)=>void):void{
  if(!url)return;const key=`retained-art:${url}`;
  if(scene.textures.exists(key)){ready(key);return;}
  const completed=()=>{if(scene.sys.isActive())ready(key);};
  scene.load.once(`filecomplete-image-${key}`,completed);
  scene.events.once('shutdown',()=>scene.load.off(`filecomplete-image-${key}`,completed));
  let keys=requested.get(scene);if(!keys){keys=new Set();requested.set(scene,keys);}
  if(!keys.has(key)){keys.add(key);scene.load.image(key,url);}
  if(!scene.load.isLoading())scene.load.start();
}
