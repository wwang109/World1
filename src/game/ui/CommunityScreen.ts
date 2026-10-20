import Phaser from 'phaser';
import { COMMUNITY_CONTRIBUTION_URL, CommunityApiError, communityPreviewUrl, communitySourceUrl, fetchCommunityDetail, fetchCommunityMe, fetchCommunityPage, importCommunityProposal, reviewCommunityProposal, supportCommunityProposal, type CommunityMe, type CommunityPage, type PublicProposal, type SupportConfirmation, type ReviewConfirmation } from '../communityApi';
import { accountOwnerId, initAccount, onAccountChange } from '../accountSession';
import { rebuildScene } from '../sceneRebuild';
import { FONT, SCREEN, UI } from '../theme';
import { auditControlLabel } from './controlLayoutAudit';
import { communityErrorText, detailPages, proposalStateLabel, sourceIsStale, supportBlockReason, validationLabel } from './communityViewModel';
import { promptForBlock, promptForLine } from './textPrompt';

export class CommunityScreen extends Phaser.Scene {
  private page: CommunityPage | null = null;
  private me: CommunityMe | null = null;
  private selected: PublicProposal | null = null;
  private sort: 'supported' | 'newest' = 'supported';
  private cursors: (string | null)[] = [null];
  private pageIndex = 0;
  private detailPage = 0;
  private previewIndex = 0;
  private showArt = false;
  private started = false;
  private busy = false;
  private notice = '';
  private confirmation: SupportConfirmation | null = null;
  private retryBlocked = false;
  private showHistory = false;
  private historyOffset = 0;
  private reviewOpen = false;
  private pendingReview: ReviewConfirmation | null = null;
  private reviewBlocked = false;
  private reviewUncertain = false;
  private accountId = '';
  private requestVersion = 0;
  private previews = new Map<string, 'loading' | 'failed' | 'ready'>();
  private previewWaiters = new Map<string, { placeholder: Phaser.GameObjects.Text; ready: () => void }[]>();
  constructor(key: string, private readonly mobile: boolean) { super(key); }
  init(): void {
    for (const [key, status] of this.previews) if (status === 'loading') this.previews.delete(key);
    this.previewWaiters.clear();
    this.started = false; this.busy = false; this.page = null; this.me = null;
    this.selected = null; this.notice = ''; this.confirmation = null; this.retryBlocked = false;
    this.showHistory = false; this.accountId = accountOwnerId(); this.requestVersion++;
    this.reviewOpen = false; this.pendingReview = null; this.reviewBlocked = false; this.reviewUncertain = false;
    this.restoreConfirmation();
  }
  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    const pad = this.mobile ? 16 : 40;
    this.text(pad, 24, 'COMMUNITY', this.mobile ? 24 : 34, UI.textAccent, SCREEN.width - 130);
    this.button(SCREEN.width - pad - 42, this.mobile ? 36 : 40, 84, 'HOME', () => this.scene.start('Start'));
    const wallet = this.me ? `${this.me.wallet.balance} vote points` : 'Account points unavailable';
    this.text(pad, this.mobile ? 70 : 78, wallet, this.mobile ? 16 : 19, UI.text, SCREEN.width - 2 * pad);
    this.button(this.mobile ? SCREEN.width - 62 : 375, this.mobile ? 88 : 87, this.mobile ? 92 : 110, 'HISTORY', () => { this.showHistory = true; this.historyOffset = 0; this.render(); }, !!this.me);
    const round = this.page?.round;
    const deadline = round ? `Round closes ${new Date(round.closesAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : this.busy ? 'Loading voting round…' : 'Voting round unavailable';
    this.text(pad, this.mobile ? 110 : 113, deadline, 13, UI.textMuted, SCREEN.width - 2 * pad);
    if (!this.mobile) this.text(600, 84, 'Earn points from confirmed boss victories. Save them for ideas you want to play.', 15, UI.textMuted, SCREEN.width - 650);
    const status = this.busy ? 'Refreshing…' : this.page ? (!this.page.sourceAvailable ? 'GitHub unavailable · showing saved proposals' : `Checked ${new Date(this.page.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : 'Community service unavailable';
    this.text(pad, this.mobile ? 139 : 143, status, 12, UI.textMuted, SCREEN.width - 2 * pad);
    const y = this.mobile ? 193 : 205;
    this.button(pad + 68, y, 136, 'SUBMIT ON GITHUB', () => this.openExternal(COMMUNITY_CONTRIBUTION_URL));
    this.button(pad + 190, y, 92, 'IMPORT PR', () => { void this.importPr(); }, !this.busy);
    this.button(pad + 290, y, 92, 'REFRESH', () => { void this.refreshData(); }, !this.busy && !this.confirmation);
    this.text(pad, this.mobile ? 222 : 235, 'Submit with GitHub · vote with your game account.', 12, UI.textMuted, SCREEN.width - 2 * pad);
    if (this.showHistory) this.renderHistory(pad);
    else if (this.mobile && this.selected) this.renderDetail(pad, 270, SCREEN.width - 2 * pad);
    else {
      this.renderList(pad, this.mobile ? 270 : 284, this.mobile ? SCREEN.width - 2 * pad : 490);
      if (!this.mobile) this.renderDetail(570, 284, SCREEN.width - 610);
    }
    if (this.notice) this.text(pad, SCREEN.height - (this.mobile ? 66 : 58), this.notice, 12, UI.textAccent, SCREEN.width - 2 * pad);
    this.text(pad, SCREEN.height - 25, 'Winning content joins a future game deployment after review.', 11, UI.textMuted, SCREEN.width - 2 * pad);
    if (this.confirmation) this.renderConfirmation();
    if (this.reviewOpen && this.me?.canModerate && this.me.moderation?.canReview) this.renderReview();
    this.registry.set('communityUi', { ready: this.started && !this.busy, selected: this.selected?.key.number ?? null, balance: this.me?.wallet.balance ?? null, pointsEnabled: this.page?.pointsEnabled ?? false, confirmation: this.confirmation, retryBlocked: this.retryBlocked, sort: this.sort, page: this.pageIndex, sourceAvailable: this.page?.sourceAvailable ?? false, canModerate: Boolean(this.me?.canModerate && this.me.moderation?.canReview), historyOpen: this.showHistory, reviewOpen: this.reviewOpen, pendingReview: this.pendingReview ? { number: this.pendingReview.number, headSha: this.pendingReview.headSha, expectedRevision: this.pendingReview.expectedRevision, operationId: this.pendingReview.operationId, decision: this.pendingReview.decision, technicalReady: this.pendingReview.technicalReady } : null });
    this.time.delayedCall(30_000, () => this.render());
    if (!this.started) {
      this.started = true;
      const unsubscribe = onAccountChange(() => {
        if (accountOwnerId() !== this.accountId) {
          this.accountId = accountOwnerId(); this.me = null; this.confirmation = null; this.notice = ''; this.requestVersion++; this.busy = false;
          this.restoreConfirmation();
          this.reviewOpen = false; this.pendingReview = null; this.reviewBlocked = false; this.reviewUncertain = false;
          void this.refreshData();
        }
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { unsubscribe(); this.requestVersion++; });
      void initAccount().then(() => this.refreshData());
    }
  }
  private render(): void { if (this.sys.isActive()) rebuildScene(this); }
  private text(x: number, y: number, value: string, size: number, color: string, width: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, { fontFamily: FONT.body, fontSize: size, color, wordWrap: { width, useAdvancedWrap: true }, lineSpacing: 3 });
  }
  private button(x: number, y: number, width: number, label: string, press: () => void, enabled = true): void {
    const plate = this.add.rectangle(x, y, width, 44, enabled ? UI.chip : UI.panelAlt).setStrokeStyle(1, UI.border).setData('communityControl', label);
    const text = this.add.text(x, y, label, { fontFamily: FONT.body, fontSize: this.mobile ? 11 : 12, fontStyle: 'bold', color: enabled ? UI.textOnChip : UI.textMuted }).setOrigin(0.5);
    auditControlLabel(plate, text, { name: `community:${label}`, minFontSize: 10 });
    if (enabled) plate.setInteractive({ useHandCursor: true }).on('pointerdown', press);
  }
  private openExternal(url: string): void { window.open(url, '_blank', 'noopener,noreferrer'); }
  private async refreshData(): Promise<void> {
    if (this.busy || !this.sys.isActive()) return;
    for (const [key, status] of this.previews) if (status === 'failed') this.previews.delete(key);
    this.busy = true; this.render();
    const version = ++this.requestVersion;
    const [list, me] = await Promise.allSettled([fetchCommunityPage(this.sort, this.cursors[this.pageIndex] ?? null, this.mobile ? 4 : 5), fetchCommunityMe()]);
    if (version !== this.requestVersion || !this.sys.isActive()) return;
    this.busy = false;
    if (list.status === 'fulfilled') {
      this.page = list.value;
      if (this.selected) {
        try { const detail = await fetchCommunityDetail(this.selected.key.number); if (version === this.requestVersion) this.selected = detail.proposal; } catch { this.notice = 'Could not refresh this proposal. Voting is unavailable until it is checked.'; this.selected = { ...this.selected, sourceCheckedAt: 0 }; }
      }
    } else { this.notice = communityErrorText(list.reason); if (this.page) this.page = { ...this.page, sourceAvailable: false }; }
    if (version !== this.requestVersion || !this.sys.isActive()) return;
    this.me = me.status === 'fulfilled' ? me.value : null;
    if (!this.me?.canModerate || !this.me.moderation?.canReview) { this.reviewOpen = false; this.pendingReview = null; }
    else if (!this.pendingReview) await this.restoreReview();
    if (version !== this.requestVersion || !this.sys.isActive()) return;
    if (this.pendingReview && this.selected && (this.selected.headSha !== this.pendingReview.headSha || this.selected.sourceState !== 'open')) this.invalidateReview();
    this.render();
  }
  private renderList(x: number, y: number, width: number): void {
    this.button(x + 61, y, 122, 'MOST SUPPORTED', () => this.changeSort('supported'), !this.busy);
    this.button(x + 170, y, 80, 'NEWEST', () => this.changeSort('newest'), !this.busy);
    const rowHeight = this.mobile ? 100 : 88;
    const proposals = this.page?.proposals ?? [];
    if (!proposals.length) this.text(x, y + 65, this.busy ? 'Loading proposals…' : this.page ? 'No proposals yet. Share your first idea on GitHub.' : 'Proposals unavailable. Refresh when the service is back.', 17, UI.text, width);
    proposals.forEach((proposal, index) => {
      const top = y + 36 + index * rowHeight;
      this.add.rectangle(x, top, width, rowHeight - 8, this.selected?.key.number === proposal.key.number ? UI.panelAlt : UI.panelMuted).setOrigin(0).setStrokeStyle(1, UI.border).setData('communityProposal', proposal.key.number).setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.selected = proposal; this.detailPage = 0; this.previewIndex = 0; this.notice = ''; this.render(); });
      this.text(x + 12, top + 10, `#${proposal.key.number} · ${proposal.manifest.category.toUpperCase()} · ${proposal.supportTotal} votes`, 11, UI.textAccent, width - 24);
      const title = proposal.manifest.title.length > (this.mobile ? 25 : 28) ? `${proposal.manifest.title.slice(0, this.mobile ? 22 : 25)}…` : proposal.manifest.title;
      this.text(x + 12, top + 31, title, this.mobile ? 15 : 17, UI.text, width - 24);
      this.text(x + 12, top + rowHeight - 32, `${proposalStateLabel(proposal)} · ${validationLabel(proposal)}`, 11, UI.textMuted, width - 24);
    });
    const controlsY = this.mobile ? 750 : 808;
    this.button(x + 40, controlsY, 80, 'PREVIOUS', () => { this.pageIndex--; void this.refreshData(); }, !this.busy && this.pageIndex > 0);
    this.text(x + 96, controlsY - 8, `Page ${this.pageIndex + 1}`, 13, UI.textMuted, 90);
    this.button(x + width - 40, controlsY, 80, 'NEXT', () => { this.cursors[this.pageIndex + 1] = this.page!.nextCursor; this.pageIndex++; void this.refreshData(); }, !this.busy && !!this.page?.nextCursor);
  }
  private changeSort(sort: 'supported' | 'newest'): void { this.sort = sort; this.pageIndex = 0; this.cursors = [null]; this.notice = ''; void this.refreshData(); }
  private renderDetail(x: number, y: number, width: number): void {
    const proposal = this.selected;
    if (!proposal) { this.text(x + 20, y + 40, 'Choose a proposal to read its changes, artwork and review status.', 22, UI.textMuted, width - 40); return; }
    if (this.mobile) {
      this.button(x + 38, y, 76, '‹ BACK', () => { this.selected = null; this.notice = ''; this.render(); });
      if (this.me?.canModerate && this.me.moderation?.canReview) this.button(x + 178, y, 100, 'REVIEW', () => { this.reviewOpen = true; this.notice = ''; this.render(); });
      this.button(x + width - 48, y, 96, this.showArt ? 'READ' : 'ARTWORK', () => { this.showArt = !this.showArt; this.render(); });
    }
    const top = y + (this.mobile ? 38 : 0);
    if (!this.mobile && this.me?.canModerate && this.me.moderation?.canReview) this.button(SCREEN.width - 100, 205, 120, 'REVIEW', () => { this.reviewOpen = true; this.notice = ''; this.render(); });
    const titleLimit = this.mobile ? 32 : 50;
    const heading = this.text(x, top, proposal.manifest.title.length > titleLimit ? `${proposal.manifest.title.slice(0, titleLimit - 3)}…` : proposal.manifest.title, this.mobile ? 19 : 25, UI.textAccent, width);
    while (heading.height > 48 && heading.text.length > 4) heading.setText(`${heading.text.slice(0, -2)}…`);
    this.text(x, top + 60, `${proposalStateLabel(proposal)} · ${validationLabel(proposal)}`, 12, UI.text, width);
    this.text(x, top + 83, `Version ${proposal.headSha.slice(0, 8)} · reviewed ${proposal.reviewedHeadSha?.slice(0, 8) ?? 'pending'}`, 12, UI.textMuted, width);
    const sourceDate = new Date(proposal.sourceCheckedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const checked = sourceIsStale(proposal, this.page, Date.now()) ? `Saved ${sourceDate} · refresh needed` : `PR #${proposal.key.number} · ${proposal.supportTotal} votes · checked ${sourceDate}`;
    this.text(x, top + 105, checked, 11, UI.textMuted, width);
    const pages = detailPages(proposal, this.mobile ? 430 : 650);
    this.detailPage = Math.min(this.detailPage, pages.length - 1);
    const previewHeight = this.mobile ? 0 : 138;
    if (!this.mobile) this.renderPreview(proposal, x, top + 132, width, previewHeight);
    if (this.mobile && this.showArt) this.renderPreview(proposal, x, top + 140, width, 180);
    else this.text(x, top + 140 + previewHeight, pages[this.detailPage]!, this.mobile ? 13 : 15, UI.text, width);
    const controlsY = this.mobile ? 704 : 758;
    this.button(x + 30, controlsY, 60, '‹', () => { this.detailPage--; this.render(); }, this.detailPage > 0);
    this.text(x + 72, controlsY - 8, `${this.detailPage + 1} / ${pages.length}`, 12, UI.textMuted, 65);
    this.button(x + 154, controlsY, 60, '›', () => { this.detailPage++; this.render(); }, this.detailPage + 1 < pages.length);
    this.button(x + width - 60, controlsY, 120, 'VIEW GITHUB PR', () => this.openExternal(communitySourceUrl(proposal.key.number)));
    const reason = supportBlockReason(proposal, this.page, this.me?.wallet.balance ?? null, Date.now());
    const supportY = this.mobile ? 765 : 817;
    this.button(x + 60, supportY, 120, 'SUPPORT', () => { void this.chooseAmount(); }, !reason && !this.busy);
    this.text(x + 134, supportY - 15, reason ?? 'Spend saved vote points', 11, UI.textMuted, width - 134);
  }
  private renderPreview(proposal: PublicProposal, x: number, y: number, width: number, height: number): void {
    const path = proposal.manifest.previewPaths[this.previewIndex];
    if (!path) { this.text(x, y + 22, 'No preview supplied', 13, UI.textMuted, width); return; }
    const key = `community:${proposal.key.number}:${proposal.headSha}:${this.previewIndex}`;
    const showImage = (): void => {
      const image = this.add.image(x + (this.mobile ? width / 2 : 72), y + height / 2, key).setDepth(-1);
      image.setScale(Math.min((this.mobile ? width - 20 : 128) / image.width, (this.mobile ? height - 10 : 128) / image.height));
    };
    if (this.textures.exists(key)) showImage();
    else {
      const status = this.previews.get(key);
      const placeholder = this.text(x, y + 20, status === 'failed' ? 'Preview unavailable' : 'Loading preview…', 13, UI.textMuted, width);
      if (status !== 'failed') this.previewWaiters.set(key, [...(this.previewWaiters.get(key) ?? []).filter(waiter => waiter.placeholder.active), { placeholder, ready: showImage }]);
      if (!status) {
        this.previews.set(key, 'loading');
        this.load.image(key, communityPreviewUrl(proposal, path));
        const onError = (file: Phaser.Loader.File): void => {
          if (file.key !== key) return;
          this.load.off('loaderror', onError); this.previews.set(key, 'failed');
          for (const waiter of this.previewWaiters.get(key) ?? []) if (waiter.placeholder.active) waiter.placeholder.setText('Preview unavailable');
          this.previewWaiters.delete(key);
        };
        this.load.once(`filecomplete-image-${key}`, () => {
          this.load.off('loaderror', onError); this.previews.set(key, 'ready');
          for (const waiter of this.previewWaiters.get(key) ?? []) if (waiter.placeholder.active) { waiter.placeholder.destroy(); waiter.ready(); }
          this.previewWaiters.delete(key);
        });
        this.load.on('loaderror', onError);
        if (!this.load.isLoading()) this.load.start();
      }
    }
    if (proposal.manifest.previewPaths.length > 1) this.button(x + (this.mobile ? width / 2 : 220), y + (this.mobile ? height + 24 : 70), 130, 'NEXT PREVIEW', () => { this.previewIndex = (this.previewIndex + 1) % proposal.manifest.previewPaths.length; this.render(); });
  }
  private renderReview(): void {
    const proposal = this.selected; if (!proposal) return;
    const width = this.mobile ? SCREEN.width - 32 : 620;
    const left = (SCREEN.width - width) / 2; const top = (SCREEN.height - 560) / 2;
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, .9).setOrigin(0).setInteractive();
    this.add.rectangle(left, top, width, 560, UI.panelAlt).setOrigin(0).setStrokeStyle(2, UI.border).setInteractive();
    this.text(left + 20, top + 20, 'CONTENT REVIEW', 22, UI.textAccent, width - 40);
    this.text(left + 20, top + 64, `PR #${proposal.key.number} · version ${proposal.headSha.slice(0, 12)}\nReview revision ${proposal.moderationRevision}`, 14, UI.text, width - 40);
    const pending = this.pendingReview;
    if (pending) {
      const decision = pending.technicalReady ? 'Admit for winner selection' : pending.decision === 'open' ? 'Open this version for voting' : 'Decline this version';
      const note = pending.note.length > 70 ? `${pending.note.slice(0, 67)}…` : pending.note || '(No note)';
      this.text(left + 20, top + 123, `${decision}\n\nExact version ${pending.headSha.slice(0, 12)}\nExpected review ${pending.expectedRevision}\n${pending.technicalReady ? 'Four evidence references supplied.\nTrusted validation must also pass.\n' : ''}\nPrivate note: ${note}`, 14, UI.text, width - 40);
      this.button(left + width - 110, top + 515, 180, this.busy ? 'SENDING…' : this.reviewUncertain ? 'RETRY SAME REVIEW' : 'CONFIRM REVIEW', () => { void this.sendReview(); }, !this.busy && !this.reviewBlocked);
    } else {
      this.text(left + 20, top + 124, `${proposalStateLabel(proposal)} · ${validationLabel(proposal)}\n\nOpen voting after reviewing the idea and scope. Technical admission additionally requires implementation and evidence. Review notes stay private.`, 14, UI.text, width - 40);
      const fresh = !sourceIsStale(proposal, this.page, Date.now()) && proposal.sourceState === 'open' && !this.busy;
      this.button(left + 100, top + 275, 160, 'OPEN FOR VOTING', () => { void this.prepareReview('open', false); }, fresh);
      this.button(left + width - 82, top + 275, 124, 'DECLINE', () => { void this.prepareReview('declined', false); }, fresh);
      this.button(left + width / 2, top + 337, Math.min(width - 40, 260), 'ADMIT TECHNICAL READINESS', () => { void this.prepareReview('open', true); }, fresh && this.me?.moderation?.technicalValidationConfigured === true);
      this.text(left + 20, top + 377, this.me?.moderation?.technicalValidationConfigured ? 'Admission needs four evidence references and successful trusted validation. It does not merge or deploy content.' : 'Trusted technical validation is not configured. Technical admission is unavailable.', 13, UI.textMuted, width - 40);
    }
    if (this.notice) this.text(left + 20, top + 431, this.notice, 12, UI.textAccent, width - 40);
    this.button(left + 72, top + 515, 104, 'CLOSE', () => { this.reviewOpen = false; if (!this.reviewUncertain || this.reviewBlocked) { this.pendingReview = null; this.saveReview(); } this.notice = ''; this.render(); }, !this.busy);
  }
  private async prepareReview(decision: 'open' | 'declined', technical: boolean): Promise<void> {
    const proposal = this.selected; const caps = this.me?.moderation; const account = this.accountId;
    if (!proposal || !this.me?.canModerate || !caps?.canReview || (technical && !caps.technicalValidationConfigured)) return;
    const unchanged = (): boolean => this.sys.isActive() && this.accountId === account && this.selected?.headSha === proposal.headSha && this.selected.moderationRevision === proposal.moderationRevision && !!this.me?.canModerate;
    const noteLimit = Math.min(4000, caps.noteMaxLength);
    const note = await promptForBlock({ title: 'PRIVATE REVIEW NOTE', initial: '', rows: 4, hint: `Review PR #${proposal.key.number}, version ${proposal.headSha.slice(0, 12)}. Max ${noteLimit} characters. This note is private.`, applyLabel: 'NEXT', validate: value => value.length <= noteLimit ? null : `Use at most ${noteLimit} characters.` });
    if (note === null || !unchanged()) return;
    const evidence: NonNullable<ReviewConfirmation['technicalEvidence']> = { fightOnOff: '', determinism: '', pairedUi: '', keywordSurfaces: '' };
    if (technical) {
      const prompts = [ ['fightOnOff', 'FIGHT ON / OFF EVIDENCE', 'Reference the actual fight logs proving the effect and its control.'], ['determinism', 'DETERMINISM EVIDENCE', 'Reference matching same-seed logs and the byte-identical comparison.'], ['pairedUi', 'DESKTOP + MOBILE EVIDENCE', 'Reference both platform screenshots for the actual candidate content.'], ['keywordSurfaces', 'KEYWORD REVIEW EVIDENCE', 'Reference pricing, canonical text, face, details and token review.'] ] as const;
      for (const [key, title, hint] of prompts) {
        const min = Math.max(20, caps.evidenceMinLength); const max = Math.min(2000, caps.evidenceMaxLength);
        const value = await promptForBlock({ title, initial: '', rows: 4, hint: `${hint} ${min}–${max} characters.`, applyLabel: 'NEXT', validate: value => value.trim().length >= min && value.length <= max ? null : `Supply an evidence reference of ${min}–${max} characters.` });
        if (value === null || !unchanged()) return;
        evidence[key] = value.trim();
      }
    }
    const input: ReviewConfirmation = { number: proposal.key.number, headSha: proposal.headSha, expectedRevision: proposal.moderationRevision, decision, operationId: crypto.randomUUID(), note, ...(technical ? { technicalReady: true, technicalEvidence: evidence } : {}) };
    if (new TextEncoder().encode(JSON.stringify(input)).length > Math.min(16_384, caps.bodyMaxBytes)) { this.notice = 'Review evidence is too large. Use shorter references.'; this.render(); return; }
    this.busy = true; this.render();
    try {
      const current = await fetchCommunityDetail(proposal.key.number);
      this.busy = false;
      if (!unchanged()) { this.render(); return; }
      if (current.proposal.headSha !== input.headSha || current.proposal.moderationRevision !== input.expectedRevision || current.proposal.sourceState !== 'open') { this.selected = current.proposal; this.invalidateReview(); this.render(); return; }
      this.pendingReview = input; this.reviewBlocked = false; this.reviewUncertain = false; this.notice = ''; this.saveReview(); this.render();
    } catch (error) { this.busy = false; this.notice = communityErrorText(error); this.render(); }
  }
  private async sendReview(): Promise<void> {
    const input = this.pendingReview; const account = this.accountId;
    if (!input || this.busy || this.reviewBlocked || !this.me?.canModerate || !this.me.moderation?.canReview) return;
    this.busy = true; this.render();
    try {
      const current = await fetchCommunityDetail(input.number);
      if (account !== this.accountId || input !== this.pendingReview) return;
      if (current.proposal.headSha !== input.headSha || current.proposal.sourceState !== 'open') { this.selected = current.proposal; this.busy = false; this.invalidateReview(); this.render(); return; }
      const receipt = await reviewCommunityProposal(input);
      if (account !== this.accountId || input !== this.pendingReview) return;
      this.pendingReview = null; this.saveReview(); this.reviewOpen = false; this.reviewUncertain = false; this.busy = false;
      this.notice = `Review recorded for ${receipt.headSha.slice(0, 12)} · revision ${receipt.moderationRevision}.`; await this.refreshData();
    } catch (error) {
      if (account !== this.accountId) return;
      this.busy = false; this.reviewBlocked = error instanceof CommunityApiError && error.status >= 400 && error.status < 500; this.reviewUncertain = !this.reviewBlocked;
      this.notice = communityErrorText(error);
      if (error instanceof CommunityApiError && error.status === 403) { if (this.me) this.me = { ...this.me, canModerate: false }; this.reviewOpen = false; this.pendingReview = null; this.saveReview(); }
      this.render();
    }
  }
  private invalidateReview(): void { this.pendingReview = null; this.saveReview(); this.reviewBlocked = false; this.reviewUncertain = false; this.notice = 'The source version changed. Review the latest proposal again.'; }
  private saveReview(): void {
    try { const key = `wandering-hand:pending-review:${this.accountId}`; if (this.pendingReview) localStorage.setItem(key, JSON.stringify(this.pendingReview)); else localStorage.removeItem(key); } catch {}
  }
  private async restoreReview(): Promise<void> {
    const account = this.accountId;
    try {
      const input = JSON.parse(localStorage.getItem(`wandering-hand:pending-review:${account}`) ?? 'null') as ReviewConfirmation | null;
      if (!input || !Number.isSafeInteger(input.number) || input.number < 1 || !/^[a-f0-9]{40}$/.test(input.headSha) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !['open', 'declined'].includes(input.decision) || !/^[a-f0-9-]{36}$/.test(input.operationId) || typeof input.note !== 'string' || input.note.length > 4000 || new TextEncoder().encode(JSON.stringify(input)).length > 16_384) return;
      if (input.technicalReady && (!input.technicalEvidence || !['fightOnOff', 'determinism', 'pairedUi', 'keywordSurfaces'].every(key => { const value = input.technicalEvidence![key as keyof typeof input.technicalEvidence]; return typeof value === 'string' && value.trim().length >= 20 && value.length <= 2000; }))) return;
      const current = await fetchCommunityDetail(input.number);
      if (account !== this.accountId || !this.me?.canModerate || !this.sys.isActive()) return;
      if (current.proposal.headSha !== input.headSha || current.proposal.sourceState !== 'open') { localStorage.removeItem(`wandering-hand:pending-review:${account}`); return; }
      this.selected = current.proposal; this.pendingReview = input; this.reviewOpen = true; this.reviewUncertain = true; this.reviewBlocked = false; this.notice = 'Review was not confirmed. Retry the same operation safely.';
    } catch {}
  }
  private async importPr(): Promise<void> {
    const url = await promptForLine({ title: 'IMPORT A GITHUB PROPOSAL', initial: '', hint: 'Paste a pull request URL from wwang109/wandering-hand-content. Submissions stay on GitHub.', applyLabel: 'IMPORT', validate: value => /^https:\/\/github\.com\/wwang109\/wandering-hand-content\/pull\/[1-9]\d*\/?$/.test(value) ? null : 'Enter a content repository pull request URL.' });
    if (url === null || !this.sys.isActive()) return;
    try { const result = await importCommunityProposal(url); this.selected = result.proposal; this.detailPage = 0; this.notice = 'Proposal imported. Review is required before voting.'; await this.refreshData(); } catch (error) { this.notice = communityErrorText(error); this.render(); }
  }
  private async chooseAmount(): Promise<void> {
    const proposal = this.selected; const page = this.page; const balance = this.me?.wallet.balance;
    if (!proposal || !page || balance === undefined || supportBlockReason(proposal, page, balance, Date.now())) return;
    const amount = await promptForLine({ title: 'SUPPORT THIS PROPOSAL', initial: '1', hint: `You have ${balance} vote points. Spent points are final; they are not refunded if a proposal closes.`, applyLabel: 'REVIEW', validate: value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= balance ? null : `Enter a whole number from 1 to ${balance}.` });
    if (amount === null || !this.sys.isActive() || this.selected?.headSha !== proposal.headSha) return;
    this.confirmation = { number: proposal.key.number, title: proposal.manifest.title, expectedHeadSha: proposal.headSha, moderationRevision: proposal.moderationRevision, roundId: page.round.id, roundClosesAt: page.round.closesAt, amount: Number(amount), operationId: crypto.randomUUID() };
    this.saveConfirmation();
    this.retryBlocked = false; this.notice = ''; this.render();
  }
  private renderConfirmation(): void {
    const input = this.confirmation!; const width = this.mobile ? SCREEN.width - 32 : 600;
    const left = (SCREEN.width - width) / 2; const top = (SCREEN.height - 370) / 2;
    this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, UI.shadow, .88).setOrigin(0).setInteractive();
    this.add.rectangle(left, top, width, 370, UI.panelAlt).setOrigin(0).setStrokeStyle(2, UI.border).setInteractive();
    this.text(left + 20, top + 22, 'CONFIRM SUPPORT', 22, UI.textAccent, width - 40);
    const deadline = new Date(input.roundClosesAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    this.text(left + 20, top + 68, `Spend ${input.amount} vote point${input.amount === 1 ? '' : 's'} on PR #${input.number}?\n\nVersion ${input.expectedHeadSha.slice(0, 12)} · review ${input.moderationRevision}\nRound ends ${deadline}\nAvailable: ${this.me?.wallet.balance ?? '…'}\n\nSpending is final. If the proposal changes, your support does not move to the new version.`, this.mobile ? 14 : 16, UI.text, width - 40);
    if (this.notice) this.text(left + 20, top + 255, this.notice, 12, UI.textAccent, width - 40);
    this.button(left + 75, top + 330, 110, 'CANCEL', () => { this.confirmation = null; this.saveConfirmation(); this.notice = ''; this.render(); }, !this.busy && (!this.notice || this.retryBlocked));
    this.button(left + width - 100, top + 330, 160, this.busy ? 'SENDING…' : this.notice ? 'RETRY SAME VOTE' : 'SPEND POINTS', () => { void this.spend(); }, !this.busy && !this.retryBlocked);
  }
  private async spend(): Promise<void> {
    const input = this.confirmation; if (!input || this.busy || this.retryBlocked) return;
    this.busy = true; this.render(); const account = this.accountId;
    try {
      const receipt = await supportCommunityProposal(input);
      if (account !== this.accountId || this.confirmation !== input) return;
      if (this.me) this.me = { ...this.me, wallet: { ...this.me.wallet, balance: receipt.balance } };
      this.confirmation = null; this.busy = false;
      this.saveConfirmation();
      this.notice = `${receipt.amount} point${receipt.amount === 1 ? '' : 's'} spent on PR #${receipt.key.number}. Balance: ${receipt.balance}.`;
      await this.refreshData();
    } catch (error) {
      if (account !== this.accountId) return;
      this.busy = false; this.retryBlocked = error instanceof CommunityApiError && error.status >= 400 && error.status < 500;
      this.notice = communityErrorText(error); this.render();
    }
  }
  private saveConfirmation(): void {
    try {
      const key = `wandering-hand:pending-support:${this.accountId}`;
      if (this.confirmation) localStorage.setItem(key, JSON.stringify(this.confirmation));
      else localStorage.removeItem(key);
    } catch {}
  }
  private restoreConfirmation(): void {
    try {
      const value = JSON.parse(localStorage.getItem(`wandering-hand:pending-support:${this.accountId}`) ?? 'null') as SupportConfirmation | null;
      if (value && Number.isSafeInteger(value.number) && value.number > 0 && Number.isSafeInteger(value.amount) && value.amount > 0 && Number.isSafeInteger(value.moderationRevision) && value.moderationRevision >= 0 && /^[a-f0-9]{40}$/.test(value.expectedHeadSha) && /^[A-Za-z0-9:_-]{1,100}$/.test(value.roundId) && /^[a-f0-9-]{36}$/.test(value.operationId) && typeof value.title === 'string') {
        this.confirmation = value; this.notice = 'Support was not confirmed. Retry to check the same vote safely.';
      }
    } catch { this.confirmation = null; }
  }
  private renderHistory(x: number): void {
    this.text(x, 280, 'YOUR POINT HISTORY', 21, UI.textAccent, SCREEN.width - 2 * x);
    this.button(SCREEN.width - x - 42, 286, 84, 'CLOSE', () => { this.showHistory = false; this.render(); });
    const entries = this.me?.entries ?? [];
    if (!entries.length) this.text(x, 340, 'No points recorded yet.', 16, UI.textMuted, SCREEN.width - 2 * x);
    entries.forEach((entry, index) => this.text(x, 335 + index * 48, `${entry.delta > 0 ? '+' : ''}${entry.delta} · ${entry.reason === 'boss' ? 'Boss victory' : entry.reason === 'support' ? 'Proposal support' : 'Account adjustment'} · ${new Date(entry.createdAt).toLocaleDateString()}`, this.mobile ? 13 : 16, UI.text, SCREEN.width - 2 * x));
    this.button(x + 50, 770, 100, 'PREVIOUS', () => { void this.historyPage(-8); }, this.historyOffset > 0 && !this.busy);
    this.button(SCREEN.width - x - 50, 770, 100, 'NEXT', () => { void this.historyPage(8); }, entries.length === 8 && !this.busy);
  }
  private async historyPage(delta: number): Promise<void> {
    this.busy = true; this.render();
    const account = this.accountId;
    try { const result = await fetchCommunityMe(String(this.historyOffset + delta)); if (account !== this.accountId || !this.sys.isActive()) return; this.me = result; this.historyOffset += delta; } catch (error) { if (account !== this.accountId) return; this.notice = communityErrorText(error); }
    this.busy = false; this.render();
  }
}
