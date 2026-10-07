import Phaser from 'phaser';
import { skillBook } from '../../data/skills';
import type { OwnedBoardPiece } from '../demoState';
import { FONT, UI } from '../theme';
import { passiveTargetingPreview, passiveTargetingSources, passivePreviewEffect, selectPassivePreviewTarget, confirmPassivePreviewTarget, configurePassiveTargetingPreview, type PassivePreviewSourceId } from '../passiveTargetingPreviewState';

interface Layout { top:number; colH:number; colW:number; rowH:number; gap:number; deckX:number; bagX:number }
let burst: PassivePreviewSourceId | null = null;
export function passiveTargetingAcquiring(): boolean {
  return Boolean(import.meta.env.DEV && passiveTargetingPreview.mode && passiveTargetingPreview.mode !== 'effects');
}
function icon(scene:Phaser.Scene,x:number,y:number,kind:'talent'|'relic'|'seal',alpha=1):Phaser.GameObjects.Graphics {
  const color=kind==='talent'?0x70d5eb:kind==='relic'?0xffa86c:UI.chip;
  const g=scene.add.graphics().setPosition(x,y).lineStyle(1.5,color,alpha);
  if(kind==='talent')g.beginPath().moveTo(0,8).lineTo(0,-8).moveTo(-1,0).lineTo(-10,-8).lineTo(-7,3).lineTo(0,6).lineTo(7,3).lineTo(10,-8).lineTo(1,0).strokePath();
  else if(kind==='relic'){g.beginPath().moveTo(-10,-3).lineTo(4,-3).strokePath();g.arc(4,-7,4,Math.PI/2,Math.PI*2).strokePath();g.beginPath().moveTo(-10,4).lineTo(4,4).strokePath();g.arc(4,8,4,-Math.PI/2,Math.PI).strokePath()}
  else{g.strokeCircle(0,0,9).strokeCircle(0,0,5);g.beginPath().moveTo(0,-12).lineTo(3,-3).lineTo(12,0).lineTo(3,3).lineTo(0,12).lineTo(-3,3).lineTo(-12,0).lineTo(-3,-3).closePath().strokePath()}
  return g;
}
function motion(scene:Phaser.Scene,object:Phaser.GameObjects.Graphics,id:PassivePreviewSourceId):void {
  object.setData('passiveTargetMotion',id);
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const tween=scene.tweens.add({targets:object,alpha:{from:.4,to:1},scale:{from:id==='windbound_charm'?.6:.8,to:1.3},angle:id==='windbound_charm'?{from:-60,to:0}:0,duration:450,yoyo:true,ease:'Sine.easeOut'});
  object.once('destroy',()=>tween.remove());
}
export function renderPassiveTargetingPreview(scene:Phaser.Scene,opts:{pieces:readonly OwnedBoardPiece[];layout:Layout;holdingTop:number;holdingH:number;compact:boolean;rerender:()=>void}):void {
  const mode=passiveTargetingPreview.mode;
  if(!import.meta.env.DEV||!mode)return;
  const {layout:l,pieces,compact}=opts;
  const id:PassivePreviewSourceId=mode==='relic'?'windbound_charm':'quick_preparation';
  const source=passiveTargetingSources.find(s=>s.id===id)!;
  const panelX=compact?10:l.deckX+250,panelW=compact?l.bagX+l.colW-10:l.bagX+l.colW-panelX;
  const root=scene.add.container(0,0).setDepth(40).setData('nativePassiveControls',true);
  root.add(scene.add.rectangle(panelX,opts.holdingTop,panelW,opts.holdingH,UI.panel,1).setOrigin(0).setStrokeStyle(1,UI.chip,.8));
  const glyph=icon(scene,panelX+18,opts.holdingTop+opts.holdingH/2,mode==='relic'?'relic':'talent');root.add(glyph);
  const pending=passiveTargetingPreview.pendingTarget;
  const pendingCardId=pending?.target.kind==='card'?pending.target.instanceId:null;
  const selected=pendingCardId?pieces.find(p=>p.instanceId===pendingCardId):null;
  const title=mode==='effects'?'Saved effects':`${source.kind==='talent'?'Talent':'Relic'} · ${source.name}`;
  const detail=mode==='effects'?'Drag cards normally · effects follow their targets':selected?`${skillBook[selected.skillId]!.name} · Slot ${selected.slot+1} · WT −3`:pending?.target.kind==='slot'?`Slot ${pending.target.slot+1} · Attack cards: WT −3`:source.prompt+' · WT −3';
  const textW=panelW-(compact?138:240);
  root.add(scene.add.text(panelX+35,opts.holdingTop+4,title,{fontFamily:FONT.body,fontSize:compact?'11px':'15px',fontStyle:'bold',color:UI.textBright,wordWrap:{width:textW}}));
  root.add(scene.add.text(panelX+35,opts.holdingTop+(compact?18:27),detail,{fontFamily:FONT.body,fontSize:compact?'9px':'12px',color:UI.textMuted,wordWrap:{width:textW}}));
  const button=(x:number,label:string,onClick:()=>void,enabled=true)=>{
    const width=compact?45:90,height=compact?25:32,y=opts.holdingTop+opts.holdingH/2;
    const box=scene.add.rectangle(x,y,width,height,enabled?UI.chip:UI.panelMuted,1).setStrokeStyle(1,UI.chip,.7).setData('passiveButton',label);
    root.add(box);root.add(scene.add.text(x,y,label,{fontFamily:FONT.body,fontSize:compact?'9px':'12px',fontStyle:'bold',color:enabled?'#172235':UI.textMuted}).setOrigin(.5));
    if(enabled)box.setInteractive({useHandCursor:true}).on('pointerdown',(_p:unknown,_x:unknown,_y:unknown,e:Phaser.Types.Input.EventData)=>{e.stopPropagation();onClick()});
  };
  button(panelX+panelW-(compact?76:155),'Next',()=>{configurePassiveTargetingPreview(mode==='talent'?'relic':mode==='relic'?'effects':'talent');opts.rerender()});
  button(panelX+panelW-(compact?25:50),mode==='effects'?'Play':'Confirm',()=>{
    if(mode==='effects'){burst='quick_preparation';opts.rerender();return}
    if(confirmPassivePreviewTarget(id,pieces)){burst=id;configurePassiveTargetingPreview('effects');opts.rerender()}
  },mode==='effects'||Boolean(pending&&pending.sourceId===id));
  if(mode!=='effects'){
    for(let slot=0;slot<10;slot++){
      const p=pieces.find(p=>p.slot<=slot&&p.slot+(skillBook[p.skillId]?.size??1)>slot);
      const valid=mode==='relic'||Boolean(p&&skillBook[p.skillId]?.archetypes.includes('offense'));
      const zone=scene.add.zone(l.deckX,l.top+slot*(l.rowH+l.gap),l.colW,l.rowH).setOrigin(0).setDepth(35).setInteractive({useHandCursor:valid}).setData('passiveSelectSlot',slot);
      zone.on('pointerdown',(_p:unknown,_x:unknown,_y:unknown,e:Phaser.Types.Input.EventData)=>{e.stopPropagation();if(valid){selectPassivePreviewTarget(id,mode==='relic'?{kind:'slot',slot}:{kind:'card',instanceId:p!.instanceId});opts.rerender()}});
    }
  }
  for(const definition of passiveTargetingSources){
    const effect=passivePreviewEffect(definition.id,pieces);
    const target=effect.confirmedTarget;
    const slots=target?.kind==='slot'?[target.slot]:effect.targetSlots;
    for(const slot of slots){
      const marker=icon(scene,l.deckX+l.colW-35,l.top+slot*(l.rowH+l.gap)+12,definition.id==='quick_preparation'?'talent':'relic',effect.active?1:.3).setDepth(38).setData('passiveMarker',{sourceId:definition.id,slot,active:effect.active});
      if(burst===definition.id&&effect.active){motion(scene,marker,definition.id);const ring=scene.add.graphics().lineStyle(2,definition.kind==='talent'?0x70d5eb:0xffa86c,.9).strokeRect(l.deckX,l.top+slot*(l.rowH+l.gap),l.colW,l.rowH).setDepth(37);motion(scene,ring,definition.id)}
    }
  }
  if(burst)motion(scene,glyph,burst);
  burst=null;
}
