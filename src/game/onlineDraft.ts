import type Phaser from 'phaser';
import { TIER_ORDER, type SkillDef, type SkillTier } from '../engine/types';
import type {DraftSetKey,StartDraft} from '../run/draft';
import {eligibleRunSession,resumeEligibleRun} from './eligibleRunSession';
import {selectRunMode} from './runMode';
import {pinnedArt,pinnedCardText,pinnedSkill} from './ui/runContentContext';
import type {CardDetailsOptions} from './ui/cardDetailsDrawer';
import type {RetainedCardPresentation} from './ui/retainedCardPresentation';
export class OnlineDraft {
  private bound=false;
  constructor(private scene:Phaser.Scene,private mobile:boolean,private refresh:()=>void){selectRunMode('online');}
  get view(){return eligibleRunSession.state.view;}
  get locked(){const state=eligibleRunSession.state;return state.busy||!!state.pending||!this.view;}
  get busy(){return eligibleRunSession.state.busy;}
  get notice(){const state=eligibleRunSession.state;return state.busy?'Confirming your choice…':state.pending?'Connection interrupted. Retry this choice.':state.error?'Unable to confirm. Refresh to check.':'';}
  get progress(){const state=this.view!.state,hud=this.view!.content.draftHud;return {day:state.depth,wave:state.map.depths.flat().find(node=>node.id===state.currentNodeId)?.wave??1,gold:state.gold,heroLevel:state.heroLevel,lives:state.lives,bossesCleared:state.bossesCleared,wins:state.wins,losses:state.losses,bankedPL:this.view!.content.economy?.bankedPL??0,...hud,...!hud?{heroStatRun:{segments:['LV','HP','ATK','MATK','DEF','MDEF','SPD'].map(label=>({label,value:label==='LV'?String(state.heroLevel):'—',kind:'stat' as const})),separator:''}}:{}};}
  get hand():StartDraft{return this.view!.content.draft!;}
  get picks(){return this.view?.content.draftPicks??{};}
  get recoveryLabel(){const state=eligibleRunSession.state;return state.pending?'RETRY ACTION':state.error?'REFRESH':null;}
  recover():void{this.perform(()=>eligibleRunSession.state.pending?eligibleRunSession.retry():resumeEligibleRun());}
  skill(id:string):SkillDef{return pinnedSkill(this.view!.content,id);}
  presentation(skill:SkillDef):RetainedCardPresentation{const face=this.view!.content.cardFaces?.[`${skill.id}:${skill.tier}`];return {body:pinnedCardText(this.view!.content,skill.id,skill.tier),artUrl:pinnedArt(this.view!,'cards',skill.id,this.mobile),rows:face?.rows,segments:this.mobile?face?.mobile:face?.desktop};}
  details(skill:SkillDef):NonNullable<CardDetailsOptions['retained']>{
    const tiers:Partial<Record<SkillTier,SkillDef>>={};for(const tier of TIER_ORDER){const def=this.view!.content.cardTiers?.[`${skill.id}:${tier}`];if(def)tiers[tier]=def;}tiers[skill.tier]??=skill;
    return {tiers,presentation:value=>this.presentation(value),rules:this.view!.content.keywordRules};
  }
  prepare():boolean{
    if(!this.bound){this.bound=true;const unsubscribe=eligibleRunSession.subscribe(()=>{if(this.scene.sys.isActive())this.scene.time.delayedCall(0,()=>this.refresh());});this.scene.events.once('shutdown',()=>{unsubscribe();selectRunMode('practice');});}
    if(this.view?.state.status!=='drafting'){this.scene.scene.start(this.mobile?'MobileEligibleRun':'DesktopEligibleRun');return false;}
    return !!this.view.content.draft&&!!this.view.content.art;
  }
  pick(set:DraftSetKey,skillId:string):void{if(!this.locked)this.perform(()=>eligibleRunSession.submit({kind:'draftPick',set,skillId}));}
  reroll():void{if(!this.locked)this.perform(()=>eligibleRunSession.submit({kind:'draftReroll'}));}
  apply():void{if(!this.locked)this.perform(()=>eligibleRunSession.submit({kind:'draftApply'}));}
  private perform(operation:()=>Promise<unknown>):void{void operation().catch(()=>{});}
  annotate(setIndex=0):void{
    const state=eligibleRunSession.state;
    this.scene.registry.set('onlineDraftUi',{ready:!state.busy,pending:!!state.pending,error:state.error,runId:this.view?.id,revision:this.view?.revision,status:this.view?.state.status,contentSha:this.view?.key.contentSha,picks:this.picks,offers:this.hand,platform:this.mobile?'mobile':'desktop',setIndex});
  }
}
