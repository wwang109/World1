import Phaser from 'phaser';
import type { CardSource, EligibleRunView as ServerRunView, EventSelection, RunIntent } from '../../run/online/types';
import type { RunCard, RunBoardPiece } from '../../run/runState';
import type { EventDeferredOfferV3 } from '../../run/eventV3Materialization';
import type { SkillTier } from '../../engine/types';
import { eligibleRunSession, resumeEligibleRun } from '../eligibleRunSession';
import { pinnedArt, pinnedCardText, pinnedSkill } from './runContentContext';
import { rebuildScene } from '../sceneRebuild';
import { selectRunMode } from '../runMode';
import { EligibleFlow, FlowNode, flowNode } from './eligibleFlow';
import { renderRunHud } from './RunProgressStrip';
import { runScreenLayout } from './runScreenLayout';
import { FONT, UI } from '../theme';
import { promptForLine } from './textPrompt';

const STAT_NAMES = { maxHp: 'Health', attack: 'Attack', magicPower: 'Magic', armor: 'Armor', magicResist: 'Resistance', speed: 'Speed' } as const;
type Tab = 'journey' | 'deck' | 'equipment';
type EligibleRunView = ServerRunView & { content: ServerRunView['content'] & Required<Pick<ServerRunView['content'], 'art' | 'draft' | 'draftPicks' | 'choices'>> };
const node = flowNode;
export class EligibleRunScreen extends Phaser.Scene {
  private flow?: EligibleFlow;
  private pageIndex = 0;
  private started = false;
  private loaded = false;
  private tab: Tab = 'journey';
  private selected: CardSource | null = null;
  private notice = '';
  private replaceConfirmation = false;
  private retireConfirmation = false;
  private playbackEncounter = '';
  private playbackStep = 0;
  private playing = false;
  constructor(key: string, private readonly mobile: boolean) { super(key); }
  init(): void { selectRunMode('online'); this.flow = undefined; this.started = false; this.loaded = false; this.pageIndex = 0; this.tab = 'journey'; this.notice = ''; this.selected = null; this.replaceConfirmation = false; this.retireConfirmation = false; }
  create(): void {
    if(eligibleRunSession.state.view?.state.status==='drafting'&&!eligibleRunSession.state.busy){this.scene.start(this.mobile?'MobileDraft':'DesktopDraft',{online:true});return;}
    this.cameras.main.setBackgroundColor(UI.bg);
    this.flow ??= new EligibleFlow(this, this.mobile, () => this.render());
    const state = eligibleRunSession.state, view = state.view as EligibleRunView | null;
    const background = view?.content.art?.assets.find(asset => asset.key === view.content.art.runKeys.runMap);
    this.flow.backdrop(background && view ? `${view.content.artBase}${background.path.replace(/^public\//, '')}` : null);
    const s = view?.state;
    renderRunHud(this, { screen: s?.status === 'drafting' ? 'DRAFT · ONLINE' : this.tab === 'deck' ? 'DECK · ONLINE' : this.tab === 'equipment' ? 'EQUIPMENT · ONLINE' : 'JOURNEY · ONLINE', compact: this.mobile,
      snapshot: { day: s?.depth ?? 0, wave: s?.map.depths.flat().find(n => n.id === s.currentNodeId)?.wave ?? s?.map.depths[s.depth + (s.status === 'active' ? 1 : 0)]?.[0]?.wave ?? 1, gold: s?.gold ?? 0, heroLevel: s?.heroLevel ?? 1, lives: s?.lives ?? 3, bossesCleared: s?.bossesCleared ?? 0, wins: s?.wins ?? 0, losses: s?.losses ?? 0 },
      actions: { back: { label: 'HOME', onPress: () => this.scene.start('Start') }, tertiary: { label: this.retireConfirmation ? 'CONFIRM RETIRE' : 'RETIRE', danger: true, disabled: !view || state.busy || !!state.pending, onPress: () => { if (!this.retireConfirmation) { this.retireConfirmation = true; this.render(); } else this.send({ kind: 'retire' }); } } } });
    const content = runScreenLayout(this.mobile ? 'mobile' : 'desktop').regions.content;
    const nav = node('nav'); nav.append(this.button('JOURNEY', () => this.switchTab('journey'), false, this.tab === 'journey'), this.button('DECK / BAG', () => this.switchTab('deck'), false, this.tab === 'deck'), this.button('EQUIPMENT', () => this.switchTab('equipment'), false, this.tab === 'equipment'));
    this.flow.draw(this.flow.rows(nav, content.width), content.x, content.y);
    this.add.text(content.x, content.y + 48, 'Boss victory: +1 vote point · Server saves your progress', { fontFamily: FONT.body, fontSize: this.mobile ? 10 : 13, color: UI.textMuted });
    const main = node('main');
    if (state.error || this.notice) main.append(node('p', state.error ?? this.notice, 'notice'));
    if (state.pending) {
      const panel = this.panel(main, state.busy ? 'Confirming your action…' : 'Action awaiting confirmation');
      panel.append(node('p', 'Your confirmed run is safe. Retry this action before making another choice.'));
      panel.append(this.button('RETRY ACTION', () => this.perform(() => eligibleRunSession.retry()), false));
    }
    if (!view) {
      const panel = this.panel(main, state.busy ? 'Connecting to your adventure…' : 'Begin an online adventure');
      panel.append(node('p', 'Your game account keeps one online run. Earn points by defeating bosses, then support community ideas.'));
      panel.append(this.button('START RUN', () => this.perform(() => eligibleRunSession.create()), true));
      panel.append(this.button('RECONNECT', () => this.perform(() => resumeEligibleRun()), false));
      panel.append(node('p', 'Practice runs and imported decks do not earn points.', 'muted'));
    } else if (!view.content.art || !view.content.choices || !('draft' in view.content)) {
      const panel = this.panel(main, 'This adventure needs its original display content');
      panel.append(node('p', 'Reconnect after the server restores this run’s content. Your run has not been changed.'));
    } else if (state.lastEncounter) this.battle(main, view);
    else if (!['active', 'drafting'].includes(view.state.status)) {
      const panel = this.panel(main, view.state.status === 'defeat' ? 'Your journey has ended' : 'Adventure retired');
      panel.append(node('p', `${view.state.wins} victories · ${view.state.bossesCleared} bosses defeated`));
      panel.append(this.button('NEW RUN', () => this.perform(() => eligibleRunSession.create()), true));
    } else if (this.tab === 'deck' && view.state.status === 'active') this.deck(main, view);
    else if (this.tab === 'equipment' && view.state.status === 'active') this.equipment(main, view);
    else this.journey(main, view);
    const footer = node('footer'); footer.append(this.button('REFRESH', () => this.perform(() => resumeEligibleRun()), false));
    if (view && ['active', 'drafting'].includes(view.state.status)) {
      footer.append(this.button(this.replaceConfirmation ? 'CONFIRM NEW RUN' : 'REPLACE RUN', () => { if (!this.replaceConfirmation) { this.replaceConfirmation = true; this.render(); } else this.perform(() => eligibleRunSession.create(true)); }, true));
    }
    main.append(footer);
    const pages = this.flow.pages(this.flow.rows(main, content.width), content.height - 146);
    const controlIndex: { label: string; enabled: boolean; page: number }[] = [];
    const groupIndex: { title: string; page: number }[] = [];
    pages.forEach((rows, page) => {
      const visit = (element: FlowNode): void => {
        if (element.tag === 'button') controlIndex.push({ label: element.textContent, enabled: !element.disabled, page });
        if (element.tag === 'h2') groupIndex.push({ title: element.textContent, page });
        element.children.forEach(visit);
      };
      rows.forEach(row => row.nodes.forEach(visit));
    });
    this.registry.set('eligibleRunControls', controlIndex); this.registry.set('eligibleRunGroups', groupIndex);
    this.pageIndex = Math.min(this.pageIndex, pages.length - 1);
    this.flow.draw(pages[this.pageIndex]!, content.x, content.y + 78);
    const controls = node('nav'); controls.append(this.button('PREVIOUS', () => { this.pageIndex = Math.max(0, this.pageIndex - 1); this.render(); }, false), this.button(`PAGE ${this.pageIndex + 1} / ${pages.length}`, () => {}, false), this.button('NEXT', () => { this.pageIndex = Math.min(pages.length - 1, this.pageIndex + 1); this.render(); }, false));
    this.flow.draw(this.flow.rows(controls, content.width), content.x, content.y + content.height - 62);
    this.registry.set('eligibleRunUi', { ready: this.loaded && !state.busy && !this.flow.loadingArt, pending: !!state.pending, runId: view?.id ?? null, revision: view?.revision ?? null, contentSha: view?.key.contentSha ?? null, tab: this.tab, accountId: state.accountId, page: this.pageIndex, pages: pages.length, selected: this.selected, held: view?.state.held?.instanceId ?? null, error: state.error ?? this.notice });
    if (!this.started) {
      this.started = true;
      const unsubscribe = eligibleRunSession.subscribe(() => { if (this.sys.isActive()) this.render(); });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { selectRunMode('practice'); unsubscribe(); });
      void resumeEligibleRun().finally(() => { this.loaded = true; this.render(); });
    }
  }
  private switchTab(tab: Tab): void { this.tab = tab; this.pageIndex = 0; this.render(); }
  private render(): void {
    if (!this.sys.isActive()) return;
    if (this.input.activePointer.isDown) { this.time.delayedCall(50, () => this.render()); return; }
    rebuildScene(this);
  }
  private button(label: string, press: () => void, mutation = true, selected = false): FlowNode {
    const button = node('button', label, selected ? 'selected' : ''); button.type = 'button';
    const state = eligibleRunSession.state; button.disabled = state.busy || (mutation && !!state.pending);
    button.addEventListener('click', press); return button;
  }
  private perform(action: () => Promise<unknown>): void { this.notice = ''; void action().catch(error => { this.notice = error instanceof Error ? error.message : 'Please reconnect and retry.'; this.render(); }); }
  private send(intent: RunIntent): void { this.perform(() => eligibleRunSession.submit(intent)); }
  private panel(parent: FlowNode, title: string): FlowNode { const section = node('section', undefined, 'panel'); section.append(node('h2', title)); parent.append(section); return section; }
  private card(view: EligibleRunView, id: string, tier: SkillTier, label?: string, press?: () => void, selected = false): FlowNode {
    const skill = pinnedSkill(view.content, id); const card = node('article', undefined, `card ${tier}${selected ? ' picked' : ''}`);
    card.card = { skill, tier, body: pinnedCardText(view.content, id, tier), artUrl: pinnedArt(view, 'cards', id, this.mobile) };
    const art = pinnedArt(view, 'cards', id, this.mobile); if (art) { const image = node('img'); image.src = art; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => { image.remove(); }, { once: true }); card.append(image); }
    card.append(node('div', tier.toUpperCase(), 'tier'), node('h3', skill.name), node('p', pinnedCardText(view.content, id, tier), 'effect'), node('small', `Size ${skill.size} · ${skill.property}${skill.weapon ? ` · ${skill.weapon}` : ''}`));
    if (label && press) card.append(this.button(label, press, true, selected)); return card;
  }
  private gem(view: EligibleRunView, id: string, label: string, press: () => void): FlowNode {
    const panel = node('article', undefined, 'gem'); const art = pinnedArt(view, 'gems', id, this.mobile);
    if (art) { const image = node('img'); image.src = art; image.alt = ''; panel.append(image); }
    panel.append(node('h3', view.content.gems[id]?.name ?? 'Gem'), node('p', view.content.gemText[id] ?? ''), this.button(label, press)); return panel;
  }
  private journey(parent: FlowNode, view: EligibleRunView): void {
    const s = view.state;
    if (s.status === 'drafting') {
      const picks = view.content.draftPicks;
      for (const set of ['offense', 'defense', 'support', 'wildcard'] as const) {
        const panel = this.panel(parent, `${set.toUpperCase()} · Choose one`); const grid = node('div', undefined, 'cards');
        for (const offer of view.content.draft?.[set] ?? []) grid.append(this.card(view, offer.skillId, offer.tier, picks[set] === offer.skillId ? 'SELECTED' : 'CHOOSE', () => this.send({ kind: 'draftPick', set, skillId: offer.skillId }), picks[set] === offer.skillId)); panel.append(grid);
      }
      const bar = this.panel(parent, 'Ready to begin?'); bar.append(this.button('REROLL HAND', () => this.send({ kind: 'draftReroll' })), this.button('BEGIN ADVENTURE', () => this.send({ kind: 'draftApply' }))); return;
    }
    if (s.pendingGhostSavePrompt) {
      const panel = this.panel(parent, 'Share your boss-winning build');
      panel.append(this.button('SAVE BUILD', () => { void promptForLine({ title: 'Name your build', initial: '', applyLabel: 'SAVE' }).then(name => { if (name) this.send({ kind: 'ghostSave', name: name.slice(0, 10) }); }); }), this.button('SKIP', () => this.send({ kind: 'ghostSkip' })));
    }
    if (s.ghostBossOffer) { const panel = this.panel(parent, 'A challenger approaches'); panel.append(node('p', 'Take an optional fight against a community build.'), this.button('ACCEPT FIGHT', () => this.send({ kind: 'ghostAccept' })), this.button('CONTINUE JOURNEY', () => this.send({ kind: 'ghostDecline' }))); return; }
    const pending = view.encounters.find(encounter => encounter.status === 'pending');
    if (pending) {
      const panel = this.panel(parent, pending.rewardClass === 'boss' ? 'Boss encounter ready' : 'Battle ready');
      for (const foe of pending.preparation.request.foes) {
        const tile = node('article', undefined, 'route');
        tile.append(node('h3', foe.enemyId.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')), node('p', `Level ${foe.level} · ${foe.title.toUpperCase()}`));
        const artKey = view.content.art.runKeys.enemy[foe.enemyId as keyof typeof view.content.art.runKeys.enemy];
        const asset = view.content.art.assets.find(asset => asset.key === artKey);
        if (asset) { const image = node('img'); image.src = `${view.content.artBase}${asset.path.replace(/^public\//, '')}`; tile.append(image); }
        panel.append(tile);
      }
      panel.append(node('p', 'Your deck is locked for this encounter. Reconnecting keeps the same battle.'));
      panel.append(this.button('FIGHT', () => this.perform(() => eligibleRunSession.resolve(pending.id)))); return;
    }
    const current = s.map.depths.flat().find(n => n.id === s.currentNodeId);
    if (s.activeChallengeFight || s.activeGhostFight?.role === 'extra' || current?.kind === 'fight' || current?.kind === 'boss') {
      const panel = this.panel(parent, current?.kind === 'boss' ? 'Prepare for the boss' : 'Prepare for battle');
      panel.append(node('p', 'Arrange your hand before entering. The server confirms the encounter and its rewards.'), this.button('OPEN DECK', () => { this.tab = 'deck'; this.render(); }, false), this.button('ENTER BATTLE', () => this.send({ kind: 'issueEncounter' })));
      const cards = node('div', undefined, 'cards'); for (const piece of s.pieces) cards.append(this.card(view, piece.skillId, piece.tier)); panel.append(cards); return;
    }
    if (current?.kind === 'shop') { this.shop(parent, view); return; }
    if (current?.kind === 'event') { this.event(parent, view); return; }
    if (view.content.biomePick) {
      const panel = this.panel(parent, 'Choose your next region'); const grid = node('div', undefined, 'options');
      for (const option of view.content.biomePick.options) { const tile = node('article', undefined, 'route'); tile.append(node('h3', option.forecast.name), node('p', option.forecast.tagline), node('p', `Boss: ${option.forecast.boss?.name ?? 'Unknown'}`), this.button('TRAVEL HERE', () => this.send({ kind: 'chooseBiome', biomeId: option.biomeId }))); grid.append(tile); } panel.append(grid); return;
    }
    const panel = this.panel(parent, 'Choose your next stop'); const options = node('div', undefined, 'options');
    for (const choice of view.content.choices) {
      const tile = node('article', undefined, 'route'); const label = choice.kind === 'fight' ? `${choice.fightOption === 'standard' ? 'MEDIUM' : choice.fightOption?.toUpperCase() ?? ''} FIGHT` : choice.kind.toUpperCase();
      tile.append(node('h3', label), node('p', choice.eventTheme?.replaceAll('_', ' ') ?? choice.shopId?.replaceAll('_', ' ') ?? `Day ${choice.wave}`), this.button('CHOOSE STOP', () => this.send({ kind: 'chooseNode', nodeId: choice.id }))); options.append(tile);
    }
    panel.append(options);
  }
  private shop(parent: FlowNode, view: EligibleRunView): void {
    const shelf = view.state.shopShelves[view.state.currentNodeId!]; const panel = this.panel(parent, 'Shop');
    if (!shelf) { panel.append(this.button('BROWSE SHOP', () => this.send({ kind: 'shopMaterialize' }))); return; }
    const cards = node('div', undefined, 'cards'); shelf.cards.forEach((offer, index) => {
      const card = this.card(view, offer.skillId, offer.tier, `BUY · ${offer.price} GOLD`, () => this.send({ kind: 'buyCard', index }));
      const matching = [...view.state.pieces, ...view.state.bagSlots.filter((value): value is RunCard => value !== null)].filter(c => c.skillId === offer.skillId);
      for (const owned of matching) card.append(this.button(`MERGE ${owned.tier.toUpperCase()} · ${offer.price} GOLD`, () => this.send({ kind: 'mergeCard', index, targetInstanceId: owned.instanceId })));
      cards.append(card);
    }); panel.append(cards);
    const gems = node('div', undefined, 'options'); shelf.gems.forEach((offer, index) => gems.append(this.gem(view, offer.gemId, `BUY · ${offer.price} GOLD`, () => this.send({ kind: 'buyGem', index })))); panel.append(gems);
    const reroll = this.button(`REROLL · ${view.content.economy?.shopReroll ?? '?'} GOLD`, () => this.send({ kind: 'shopReroll' })); reroll.disabled ||= view.content.economy?.shopReroll == null || view.state.gold < view.content.economy.shopReroll;
    panel.append(reroll, this.button('LEAVE SHOP', () => this.send({ kind: 'leaveShop' })));
    const merge = this.panel(parent, `Add a merge point · ${view.content.economy?.mergeSlot ?? '?'} gold`); for (const owned of [...view.state.pieces, ...view.state.bagSlots.filter((value): value is RunCard => value !== null)]) { const button = this.button(pinnedSkill(view.content, owned.skillId).name, () => this.send({ kind: 'buyMergeSlot', targetInstanceId: owned.instanceId })); button.disabled ||= !view.content.economy?.mergeSlotAvailable || view.content.economy.mergeSlot === null || view.state.gold < view.content.economy.mergeSlot; merge.append(button); }
  }
  private event(parent: FlowNode, view: EligibleRunView): void {
    const event = view.content.event;
    if (!event) { this.panel(parent, 'An encounter on the road').append(this.button('APPROACH', () => this.send({ kind: 'eventMaterialize' }))); return; }
    const panel = this.panel(parent, event.title); const url = pinnedArt(view, event.art.kind === 'event' ? 'events' : 'themes', event.art.kind === 'event' ? event.art.artId : event.art.theme, this.mobile);
    if (url) { const image = node('img', undefined, 'event-art'); image.src = url; image.alt = ''; panel.append(image); }
    panel.append(node('p', event.body)); if (event.recap) panel.append(node('p', event.recap, 'muted'));
    if (event.phase.kind === 'pending') {
      panel.append(node('h3', 'Choose your reward'));
      if (event.phase.offer) this.offer(panel, view, event.phase.offer);
      else this.legacyOffer(panel, view);
      panel.append(this.button('REOPEN CHOICE', () => this.send({ kind: 'eventReopen', instanceId: event.instanceId, contentVersion: event.contentVersion })));
      if (event.phase.offer?.kind === 'buyStatPick') panel.append(this.button('CANCEL', () => this.send({ kind: 'eventCancel', instanceId: event.instanceId, contentVersion: event.contentVersion })));
    } else {
      for (const choice of event.choices) {
        const row = node('div', undefined, 'choice'); const button = this.button(`${choice.label}${choice.cost ? ` · ${choice.cost} GOLD` : ''}`, () => this.send({ kind: 'eventChoice', instanceId: event.instanceId, contentVersion: event.contentVersion, choiceId: choice.id }));
        button.disabled ||= choice.locked || !choice.affordable; row.append(button); if (choice.lockReason) row.append(node('p', choice.lockReason, 'muted')); panel.append(row);
      }
      if (event.phase.kind === 'terminal') panel.append(this.button('CONTINUE JOURNEY', () => this.send({ kind: 'leaveEvent' })));
    }
  }
  private finalize(view: EligibleRunView, selection: EventSelection): void { const event = view.content.event!; this.send({ kind: 'eventFinalize', instanceId: event.instanceId, contentVersion: event.contentVersion, selection }); }
  private offer(parent: FlowNode, view: EligibleRunView, offer: EventDeferredOfferV3): void {
    if (offer.status !== 'pending') return;
    const cards = node('div', undefined, 'cards'); parent.append(cards);
    const owned = [...view.state.pieces, ...view.state.bagSlots.filter((c): c is RunCard => c !== null)];
    switch (offer.kind) {
      case 'cardChoice': case 'bonusDraft': for (const card of offer.options) cards.append(this.card(view, card.skillId, card.tier, 'TAKE CARD', () => this.finalize(view, { kind: 'card', skillId: card.skillId }))); break;
      case 'gemChoice': for (const id of offer.optionGemIds) cards.append(this.gem(view, id, 'TAKE GEM', () => this.finalize(view, { kind: 'gem', gemId: id }))); break;
      case 'upgradeCard': case 'upgradeCardTargeted': for (const id of offer.optionInstanceIds) { const card = owned.find(c => c.instanceId === id); if (card) cards.append(this.card(view, card.skillId, card.tier, 'UPGRADE', () => this.finalize(view, { kind: 'upgrade', instanceId: id }))); } break;
      case 'sellGem': for (const option of offer.options) cards.append(this.gem(view, option.gemId, `SELL · ${option.price} GOLD`, () => this.finalize(view, { kind: 'sellGem', pouchIndex: option.pouchIndex }))); break;
      case 'mergeCards': parent.append(node('p', `Trade these three cards: ${offer.consumed.map(card => pinnedSkill(view.content, card.skillId).name).join(', ')}.`)); for (const option of offer.candidates) cards.append(this.card(view, option.skillId, option.tier, 'MERGE THREE', () => this.finalize(view, { kind: 'mergeCards', skillId: option.skillId, consumedIds: offer.consumed.map(c => c.instanceId) }))); break;
      case 'buyStatPick': for (const [stat, label] of Object.entries(STAT_NAMES)) parent.append(this.button(label, () => this.finalize(view, { kind: 'statPick', stat: stat as keyof typeof STAT_NAMES }))); break;
      case 'reshapeCard': for (const option of offer.options) cards.append(this.card(view, option.resultSkillId ?? option.skillId, option.resultTier ?? option.tier, 'CHOOSE', () => this.finalize(view, { kind: 'reshape', instanceId: option.instanceId }))); break;
      case 'reshapeGem': for (const option of offer.options) cards.append(this.gem(view, option.resultGemId, 'TRANSFORM', () => this.finalize(view, { kind: 'reshapeGem', optionId: option.id }))); break;
      case 'rerollCard': case 'rerollGem':
        if (offer.rolled) {
          parent.append(node('p', offer.kind === 'rerollCard' ? pinnedSkill(view.content, offer.rolled.skillId).name : view.content.gems[offer.rolled.gemId]?.name ?? 'Gem'));
          parent.append(this.button('ROLL AGAIN', () => this.finalize(view, { kind: 'reroll', target: offer.kind, step: { kind: 'reroll' } })), this.button('KEEP', () => this.finalize(view, { kind: 'reroll', target: offer.kind, step: { kind: 'keep' } })));
        } else if (offer.kind === 'rerollCard') for (const option of offer.options) cards.append(this.card(view, option.skillId, option.tier, 'CHOOSE', () => this.finalize(view, { kind: 'reroll', target: offer.kind, step: { kind: 'pick', id: option.instanceId } })));
        else for (const option of offer.options) cards.append(this.gem(view, option.gemId, 'CHOOSE', () => this.finalize(view, { kind: 'reroll', target: offer.kind, step: { kind: 'pick', id: String(option.pouchIndex) } })));
        break;
      case 'forgeEquipment': for (const item of view.content.equipment.items) { const def = item.versions.at(-1)?.def; if (def && ((offer.items ?? []).includes(item.id) || (def.setId && offer.sets.includes(def.setId)))) { const button = this.button(`${def.name} · ${view.content.economy?.forgeCost ?? '?'} PARTS`, () => this.finalize(view, { kind: 'forgeEquipment', itemId: item.id })); button.disabled ||= !view.content.economy || (view.state.brokenEquipment ?? 0) < view.content.economy.forgeCost; parent.append(button); } } break;
      case 'upgradeEquipment': for (const item of view.state.ownedEquipment ?? []) { const def = view.content.equipment.items.find(def => def.id === item.itemId)?.versions.find(v => v.version === item.itemVersion)?.def; if (def && ((offer.items ?? []).includes(item.itemId) || (def.setId && offer.sets.includes(def.setId)))) { const price = view.content.economy?.upgrades[item.instanceId]; const button = this.button(`${def.name} · ${price?.cost ?? '?'} PARTS`, () => this.finalize(view, { kind: 'upgradeEquipment', instanceId: item.instanceId })); button.disabled ||= !price || price.maxed || (view.state.brokenEquipment ?? 0) < price.cost; parent.append(button); } } break;
      case 'grantCard': case 'grantGem': break;
    }
  }
  private legacyOffer(parent: FlowNode, view: EligibleRunView): void {
    const offer = view.content.legacyOffer; if (!offer) return;
    const cards = node('div', undefined, 'cards'); parent.append(cards);
    if (offer.kind === 'bonusDraft') for (const card of offer.cards) cards.append(this.card(view, card.skillId, card.tier, 'TAKE CARD', () => this.finalize(view, { kind: 'card', skillId: card.skillId })));
    if (offer.kind === 'upgradeCardPick') for (const option of offer.options) cards.append(this.button(pinnedSkill(view.content, option.skillId).name, () => this.finalize(view, { kind: 'upgrade', instanceId: option.instanceId })));
    if (offer.kind === 'awardCardPointPick') for (const option of offer.options) cards.append(this.card(view, option.skillId, option.tier, 'ADD MERGE POINT', () => this.finalize(view, { kind: 'awardCardPoint', instanceId: option.instanceId })));
    if (offer.kind === 'gemChoicePick') for (const id of offer.options) cards.append(this.gem(view, id, 'TAKE GEM', () => this.finalize(view, { kind: 'gem', gemId: id })));
    if (offer.kind === 'sellGemPick') for (const option of offer.options) cards.append(this.gem(view, option.gemId, `SELL · ${option.price} GOLD`, () => this.finalize(view, { kind: 'sellGem', pouchIndex: option.pouchIndex })));
    if (offer.kind === 'mergeCardsPick') { parent.append(node('p', `Trade these three cards: ${offer.consumed.map(card => pinnedSkill(view.content, card.skillId).name).join(', ')}.`)); for (const option of offer.candidates) cards.append(this.card(view, option.skillId, option.tier, 'MERGE THREE', () => this.finalize(view, { kind: 'mergeCards', skillId: option.skillId, consumedIds: offer.consumed.map(c => c.instanceId) }))); }
  }
  private deck(parent: FlowNode, view: EligibleRunView): void {
    const panel = this.panel(parent, 'Arrange your hand'); panel.append(node('p', 'Select a card, then an empty slot or another card to swap. Only confirmed changes are saved.', 'muted'));
    for (const area of ['board', 'bag'] as const) {
      const section = this.panel(panel, area === 'board' ? 'ACTIVE BOARD' : 'BAG'); const grid = node('div', undefined, 'cards');
      const cards = area === 'board' ? view.state.pieces : view.state.bagSlots;
      for (let slot = 0; slot < (view.content.boardSlots ?? view.state.bagSlots.length); slot++) {
        const card = area === 'board' ? view.state.pieces.find(c => c.slot === slot) : view.state.bagSlots[slot];
        if (card) {
          const source: CardSource = { kind: area, instanceId: card.instanceId };
          const tile = this.card(view, card.skillId, card.tier, `SLOT ${slot + 1}${this.selected?.instanceId === card.instanceId ? ' · SELECTED' : ''}`, () => { if (this.selected && this.selected.instanceId !== card.instanceId) { this.send({ kind: 'swapCards', source: this.selected, other: source }); this.selected = null; } else { this.selected = source; this.render(); } }, this.selected?.instanceId === card.instanceId);
          tile.draggable = true; tile.addEventListener('dragstart', event => { this.selected = source; event.dataTransfer?.setData('text/plain', card.instanceId); }); tile.addEventListener('dragover', event => event.preventDefault()); tile.addEventListener('drop', event => { event.preventDefault(); if (this.selected && this.selected.instanceId !== card.instanceId) this.send({ kind: 'swapCards', source: this.selected, other: source }); this.selected = null; });
          const socket = area === 'board' ? (card as RunBoardPiece).gem : null;
          if (socket) tile.append(node('p', `Socket: ${view.content.gems[socket.id]?.name ?? 'Gem'}`), this.button('REMOVE GEM', () => this.send({ kind: 'detachGem', instanceId: card.instanceId })));
          grid.append(tile);
        } else {
          const covering = area === 'board' ? view.state.pieces.find(piece => piece.slot < slot && piece.slot + pinnedSkill(view.content, piece.skillId).size > slot) : view.state.bagSlots.find((piece, index) => piece !== null && index < slot && index + pinnedSkill(view.content, piece.skillId).size > slot);
          if (covering) { const occupied = this.button('OCCUPIED', () => {}); occupied.disabled = true; occupied.classList.add('empty'); grid.append(occupied); continue; }
          const empty = this.button(`EMPTY ${slot + 1}`, () => { if (this.selected) { this.send({ kind: 'moveCard', source: this.selected, destination: { kind: area, slot } }); this.selected = null; } }); empty.classList.add('empty');
          empty.addEventListener('dragover', event => event.preventDefault()); empty.addEventListener('drop', event => { event.preventDefault(); if (this.selected) this.send({ kind: 'moveCard', source: this.selected, destination: { kind: area, slot } }); this.selected = null; }); grid.append(empty);
        }
      }
      section.append(grid); void cards;
    }
    const holding = this.panel(panel, 'TEMP HOLDING'); if (view.state.held) holding.append(this.card(view, view.state.held.skillId, view.state.held.tier, this.selected?.kind === 'held' ? 'HELD · SELECTED' : 'SELECT', () => { this.selected = { kind: 'held', instanceId: view.state.held!.instanceId }; this.render(); }, this.selected?.kind === 'held'));
    else holding.append(this.button('MOVE SELECTED TO HOLDING', () => { if (this.selected) this.send({ kind: 'moveCard', source: this.selected, destination: { kind: 'held' } }); this.selected = null; }));
    if (this.selected && this.selected.kind !== 'held') { const source = this.selected; const price = view.content.economy?.cardSales[source.instanceId]; const button = this.button(`SELL SELECTED · ${price ?? '?'} GOLD`, () => { this.send({ kind: 'sellCard', source }); this.selected = null; }); button.disabled ||= price === undefined; panel.append(button); }
    const gems = this.panel(parent, 'GEM POUCH'); const grid = node('div', undefined, 'options');
    view.state.gemInventory.forEach((id, index) => { const gem = this.gem(view, id, this.selected?.kind === 'board' ? 'ATTACH TO SELECTED' : 'SELECT A BOARD CARD', () => { if (this.selected?.kind === 'board') this.send({ kind: 'attachGem', instanceId: this.selected.instanceId, pouchIndex: index }); }); const price = view.content.economy?.gemSales[index]; const sell = this.button(`SELL · ${price ?? '?'} GOLD`, () => this.send({ kind: 'sellGem', pouchIndex: index })); sell.disabled ||= price === undefined; gem.append(sell); grid.append(gem); }); gems.append(grid);
    const stats = this.panel(parent, `Hero training · ${view.content.economy?.bankedPL ?? '?'} PL available`);
    for (const [stat, label] of Object.entries(STAT_NAMES)) {
      const allocation = view.state.heroAllocation; const key = stat as keyof typeof STAT_NAMES; const value = allocation[key] ?? 0; const price = view.content.economy?.statCosts[key];
      const row = node('div', undefined, 'stat'); row.append(node('span', `${label}: ${value} buys${price ? ` · +${price.gain} per buy` : ''}`));
      const train = this.button(`TRAIN · ${price?.pl ?? '?'} PL`, () => this.send({ kind: 'buyStat', stat: key })); train.disabled ||= !price || (view.content.economy?.bankedPL ?? 0) < price.pl;
      const refund = this.button(`REFUND · ${price?.pl ?? '?'} PL`, () => this.send({ kind: 'allocateStats', allocation: { ...allocation, [stat]: value - 1 } })); refund.disabled ||= value <= 0 || !price;
      row.append(train, refund); stats.append(row);
    }
  }
  private equipment(parent: FlowNode, view: EligibleRunView): void {
    const panel = this.panel(parent, 'Your equipment');
    if (!view.state.ownedEquipment?.length) panel.append(node('p', 'Equipment earned on this journey appears here.', 'muted'));
    for (const item of view.state.ownedEquipment ?? []) {
      const def = view.content.equipment.items.find(def => def.id === item.itemId)?.versions.find(v => v.version === item.itemVersion)?.def;
      const row = node('article', undefined, 'route'); const art = pinnedArt(view, 'items', item.itemId, this.mobile);
      if (art) { const image = node('img', undefined, 'equipment-art'); image.src = art; image.alt = ''; row.append(image); }
      row.append(node('h3', def?.name ?? 'Equipment'), node('p', `Level ${item.level ?? 0} · ${def?.slot ?? ''}`));
      const equipped = view.state.equippedEquipment?.find(ref => ref.instanceId === item.instanceId);
      const gain = view.content.economy?.salvageGains[item.instanceId]; const salvage = this.button(`SALVAGE · +${gain ?? '?'} PARTS`, () => this.send({ kind: 'salvage', instanceId: item.instanceId })); salvage.disabled ||= !gain;
      row.append(equipped ? this.button('UNEQUIP', () => this.send({ kind: 'unequip', slot: equipped.slot })) : this.button('EQUIP', () => this.send({ kind: 'equip', instanceId: item.instanceId })), salvage); panel.append(row);
    }
  }
  private battle(parent: FlowNode, view: EligibleRunView): void {
    const receipt = eligibleRunSession.state.lastEncounter!;
    if (this.playbackEncounter !== receipt.encounterId) { this.playbackEncounter = receipt.encounterId; this.playbackStep = 0; this.playing = false; this.pageIndex = 0; }
    const panel = this.panel(parent, receipt.log.result === 'win' ? 'VICTORY' : 'BATTLE COMPLETE');
    panel.append(node('p', `${receipt.log.turns} turns · Progress saved`));
    if (receipt.points) panel.append(node('p', `+1 VOTE POINT · Balance ${receipt.points.balance}`, 'earned'));
    panel.append(this.button('CONTINUE JOURNEY', () => { eligibleRunSession.dismissEncounter(); this.switchTab('journey'); }));
    const events = receipt.log.events.filter(event => ['play', 'damage', 'heal', 'shieldGain'].includes(event.kind));
    this.playbackStep = Math.min(this.playbackStep, Math.max(0, events.length - 1));
    const event = events[this.playbackStep];
    const replay = this.panel(parent, `BATTLE REPLAY · TURN ${event?.turn ?? 1}`);
    replay.append(this.button(this.playing ? 'PAUSE' : 'PLAY', () => { this.playing = !this.playing; this.render(); }, false), this.button('NEXT ACTION', () => { this.playing = false; this.playbackStep = Math.min(events.length - 1, this.playbackStep + 1); this.render(); }, false), this.button('REPLAY', () => { this.playbackStep = 0; this.playing = true; this.render(); }, false));
    if (event && 'side' in event) {
      const actor = event.side === 'player' ? 'Hero' : `Enemy ${event.unit + 1}`;
      if (event.kind === 'play') {
        replay.append(node('h3', `${actor} · ${view.content.skills[event.skillId]?.name ?? 'Card'}`));
        const encounter = view.encounters.find(encounter => encounter.id === receipt.encounterId);
        const piece = event.side === 'player' ? encounter?.preparation.request.pieces.find(piece => piece.slot === event.slot) : undefined;
        if (piece) { const cards = node('div', undefined, 'cards'); cards.append(this.card(view, piece.skillId, piece.tier ?? view.content.skills[piece.skillId]!.tier)); replay.append(cards); }
      } else if (event.kind === 'damage') replay.append(node('h3', `${actor} takes ${event.amount} damage`), node('p', `${event.hpAfter} HP remaining`));
      else if (event.kind === 'heal') replay.append(node('h3', `${actor} restores ${event.amount} HP`), node('p', `${event.hpAfter} HP`));
      else if (event.kind === 'shieldGain') replay.append(node('h3', `${actor} gains ${event.amount} ${event.property} Shield`));
    }
    if (this.playing && this.playbackStep < events.length - 1) this.time.delayedCall(650, () => { this.playbackStep++; this.render(); });
    else if (this.playbackStep >= events.length - 1) this.playing = false;
  }
}
