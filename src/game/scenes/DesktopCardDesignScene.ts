import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { TIER_ORDER, type Action, type SkillTier } from '../../engine/types';
import { additionalStatCount, PRICE } from '../../engine/balance';
import { DESKTOP_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, TIER_COLOR, UI } from '../theme';
import { renderDesktopBackground } from '../ui/DesktopNav';
import { attachButtonFeel } from '../ui/motion';
import { rebuildScene } from '../sceneRebuild';
import { renderCardDesignerPreview } from '../ui/cardDesignerPreview';
import { copyTextToClipboard } from '../ui/codePrompt';
import { promptForLine } from '../ui/textPrompt';
import { confirmCardDesignerAction } from '../ui/cardDesignerConfirm';
import { clearCardDesignerDraft, recoverCardDesignerDraft, saveCardDesignerDraft } from '../ui/cardDesignerDraftStorage';
import {
  ACTION_MODIFIER_FIELDS,
  CARD_FIELDS,
  CARD_TYPE_OPTIONS,
  ELEMENT_OPTIONS,
  TIER_UPGRADE_FIELDS,
  WEAPON_OPTIONS,
  KEYWORD_EDITOR,
  selectorsFor,
  type CardFieldDef,
  type KeywordEditor,
} from '../../engine/keywords/editor';
import { STAT_TOKEN } from '../../engine/keywords/text';
import {
  KEYWORD_KINDS,
  cardDesignerTemplates,
  defaultCardDesignerDraft,
  deriveDraftId,
  draftFromTemplate,
  editableFieldsForEffect,
  editorContextForEffect,
  effectTierFor,
  effectsForEditing,
  exportGate,
  exportJsonText,
  resolvedAt,
  setCardField,
  setCardType,
  setEffectField,
  setEffectSelector,
  setEffectMinTier,
  setTierUpgradeField,
  tierMeter,
  tierConfigurationAt,
  tierIsCustomized,
  toggleArchetype,
  toggleEffectFlag,
  cardDesignerDocument,
  hasEffectKind,
  withEffectAdded,
  withEffectRemoved,
  withEffectToggled,
  withStatDebuffAdded,
  type CardDesignerDraft,
  type NonBronzeTier,
} from '../ui/cardDesignerState';
import type { ContentProblem } from '../../data/validateSkillContent';
import { skillBook } from '../../data/skills';
import type { BattleLog } from '../../run/resolveBattle';
import {
  DESIGN_PROBE_FOE_CARD,
  DESIGN_PROBE_FOE_HP,
  DESIGN_PROBE_HERO_ALLOCATION,
  DESIGN_PROBE_HERO_LEVEL,
  DESIGN_PROBE_SEED,
  DESIGN_PROBE_TURNS,
  designProbeFoeSetup,
  designProbeHeroPieces,
  designProbeSkill,
  type DesignBattleRequest,
} from '../../run/designProbe';
import { fetchDesignBattle } from '../battleApi';
import { buildBattleTimeline, type LogLine } from '../battleTimeline';
import {
  BATTLE_LOG_TAG_COLOR,
  LOG_GROUP_BAND,
  LOG_GROUP_STRIPE,
  drawBattleLogLines,
  wrapBattleLogSegments,
} from '../ui/battleLogLine';
import { createStatusIconChip, statusIconTileSize } from '../ui/statusIcon';

const F = { ...DESKTOP_PROFILE.font, tiny: 12, small: 12 };
const TIERS: readonly SkillTier[] = TIER_ORDER;

type PreviewMode = 'card' | 'log';
type ProbeLine = { turn: number; line: LogLine };
type ProbeEntry =
  | { status: 'pending' }
  | { status: 'ready'; lines: ProbeLine[] }
  | { status: 'error'; message: string };

const PROBE_CACHE_LIMIT = 24;
const probeCache = new Map<string, ProbeEntry>();

function probeLines(request: DesignBattleRequest, log: BattleLog): ProbeLine[] {
  const skill = designProbeSkill(request);
  const pieces = designProbeHeroPieces(skill, request.tier)
    .map((piece) => ({ ...piece, tier: request.tier, instanceId: 'design-probe' }));
  const timeline = buildBattleTimeline({
    pieces,
    heroLevel: DESIGN_PROBE_HERO_LEVEL,
    heroAllocation: DESIGN_PROBE_HERO_ALLOCATION,
    enemyId: '',
    enemyLevel: 1,
    enemyTitle: 'normal',
    enemyRank: 0,
    seed: DESIGN_PROBE_SEED,
  }, log, { skills: { [skill.id]: skill }, foeSetups: [designProbeFoeSetup()] });
  const lines: ProbeLine[] = [];
  for (const turn of timeline.turns) {
    for (const line of timeline.linesByTurn.get(turn) ?? []) if (line.tag !== 'RESULT') lines.push({ turn, line });
  }
  return lines;
}

interface ScrollArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

function keywordLabel(kind: string): string {
  return (KEYWORD_EDITOR as Record<string, KeywordEditor>)[kind]?.label ?? kind;
}

function stringOptions(def: Pick<CardFieldDef, 'options'>): readonly string[] {
  return (def.options ?? []).map(String);
}

const ARCHETYPE_LABELS: readonly string[] = stringOptions(CARD_FIELDS.archetypes);

const GUTTER = 32;
const CONTENT_TOP = 170;
const COMMON_EFFECT_KINDS: readonly string[] = ['damage', 'shield', 'heal', 'buffStat', 'debuffStat'];

function effectFieldLabel(kind: string, key: string, fallback: string): string {
  if (key === 'power' && kind === 'damage') return 'Damage amount';
  if (key === 'power' && kind === 'shield') return 'Shield amount';
  if (key === 'power' && kind === 'heal') return 'Heal amount';
  if (key === 'pct' && kind === 'buffStat') return 'Bonus (%)';
  if (key === 'pct' && kind === 'debuffStat') return 'Reduction (%)';
  if (key === 'turns' && (kind === 'buffStat' || kind === 'debuffStat')) return 'Duration (turns)';
  return fallback;
}

function statOptionLabel(value: string): string {
  return STAT_TOKEN[value as keyof typeof STAT_TOKEN] ?? value;
}

// Phaser 3.90 re-emits every queued key event on each new DOM key until the next frame.
function oncePerKeyEvent(handler: (event: KeyboardEvent) => void): (event: KeyboardEvent) => void {
  const seen = new WeakSet<KeyboardEvent>();
  return (event) => {
    if (seen.has(event)) return;
    seen.add(event);
    handler(event);
  };
}

function downloadJsonFile(filename: string, text: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * CARD DESIGNER — a desktop-only sandbox that composes a `SkillDef` against
 * the REAL pricer/validator/preview (never a re-implementation of any of the
 * three): `src/engine/balance.ts`'s pricing functions, `applyTier`
 * (`src/engine/cards.ts`), `validateSkillDocument`
 * (`src/data/validateSkillContent.ts`) and `renderCardDetailsDrawer`
 * (`src/game/ui/cardDetailsDrawer.ts`). This scene is a DUMB HOST over
 * `src/game/ui/cardDesignerState.ts` — it owns layout and input only; every
 * number and every validation message shown here comes from that module's
 * real-function calls.
 *
 * NOT PART OF THE RUN NAVIGATION (no `DesktopNav` tab bar) — it is reached
 * from the Start screen's third door and returns there, same as the Sandbox
 * Prep door, but is a standalone authoring tool rather than a run screen.
 *
 * DESKTOP ONLY, by explicit user decision (2026-09-16): the Start screen adds
 * this door only in its non-mobile branch, and `layoutProfile.ts` forces the
 * desktop profile for `?scene=card-design` regardless of device, the same way
 * every other `desktop-*` dev route already does.
 */
export class DesktopCardDesignScene extends Phaser.Scene {
  private draft: CardDesignerDraft = defaultCardDesignerDraft();
  private selectedTier: SkillTier = 'bronze';
  private toastText = '';
  private toastGood = true;
  private closeDropdown: (() => void) | undefined;
  private selectedTemplateId: string | undefined;
  private draftEdited = false;
  private formScroll = 0;
  private paletteScroll = 0;
  private previewScroll = 0;
  private jsonScroll = 0;
  private logScroll = 0;
  private previewMode: PreviewMode = 'card';
  private probeKey = '';
  private jsonExpanded = false;
  private hasSavedDraft = false;
  private recoveredDraft = false;
  private storageStatus: 'new' | 'saved' | 'unavailable' | 'corrupt' = 'new';
  private confirmation: AbortController | undefined;

  constructor() {
    super('DesktopCardDesign');
  }

  init(): void {
    this.draft = defaultCardDesignerDraft();
    this.selectedTier = 'bronze';
    this.toastText = '';
    this.toastGood = true;
    this.selectedTemplateId = undefined;
    this.draftEdited = false;
    this.formScroll = 0;
    this.paletteScroll = 0;
    this.previewScroll = 0;
    this.jsonScroll = 0;
    this.logScroll = 0;
    this.previewMode = 'card';
    this.probeKey = '';
    this.jsonExpanded = false;
    this.hasSavedDraft = false;
    this.recoveredDraft = false;
    const recovered = recoverCardDesignerDraft();
    this.storageStatus = recovered.status === 'empty' ? 'new' : recovered.status === 'recovered' ? 'saved' : recovered.status;
    if (recovered.status === 'recovered') {
      this.draft = recovered.value.draft;
      this.selectedTier = recovered.value.selectedTier;
      this.selectedTemplateId = recovered.value.templateId;
      this.draftEdited = recovered.value.edited;
      this.hasSavedDraft = true;
      this.recoveredDraft = true;
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.closeDropdown?.(); this.confirmation?.abort(); });
  }

  create(): void {
    renderDesktopBackground(this);
    this.renderHeader();
    this.renderTemplateRow();
    this.renderTierTabs();
    this.renderPalette();
    this.renderForm();
    this.renderMeterAndFace();
    if (this.toastText) this.renderToast();
    this.registry.set('cardDesignerUi', { draft: this.draft, selectedTier: this.selectedTier, templateId: this.selectedTemplateId,
      edited: this.draftEdited, storageStatus: this.storageStatus, recovered: this.recoveredDraft, formScroll: this.formScroll });
  }

  private rerender(): void {
    this.closeDropdown?.();
    if (this.hasSavedDraft) this.persistDraft();
    rebuildScene(this);
  }

  private persistDraft(): boolean {
    const saved = saveCardDesignerDraft({ version: 1, draft: this.draft, selectedTier: this.selectedTier,
      templateId: this.selectedTemplateId, edited: this.draftEdited });
    this.storageStatus = saved ? 'saved' : 'unavailable';
    return saved;
  }

  private async confirmDraft(title: string, body: string, confirmLabel: string, cancelLabel = 'CANCEL'): Promise<boolean> {
    if (this.confirmation) return false;
    const controller = new AbortController();
    this.confirmation = controller;
    const result = await confirmCardDesignerAction({ title, body, confirmLabel, cancelLabel, signal: controller.signal });
    if (this.confirmation === controller) this.confirmation = undefined;
    return result && this.scene.isActive();
  }

  private async leaveDesigner(): Promise<void> {
    if (this.draftEdited) {
      const saved = this.persistDraft();
      const leave = await this.confirmDraft('LEAVE CARD DESIGNER?', saved
        ? 'Your draft is saved on this device. You can continue it when you return.'
        : 'This browser could not save your draft. Leaving will discard these edits. Stay to continue editing.',
      saved ? 'LEAVE' : 'DISCARD AND LEAVE', 'STAY');
      if (!leave) { this.rerender(); return; }
    }
    this.scene.start('Start');
  }

  private async discardDraft(): Promise<void> {
    if (!await this.confirmDraft('DISCARD DRAFT?', 'Replace this draft with a new empty card? This cannot be undone.', 'DISCARD', 'KEEP DRAFT')) return;
    const cleared = clearCardDesignerDraft();
    this.draft = defaultCardDesignerDraft(); this.selectedTier = 'bronze'; this.selectedTemplateId = undefined;
    this.draftEdited = false; this.hasSavedDraft = false; this.recoveredDraft = false;
    this.formScroll = 0; this.previewScroll = 0; this.jsonScroll = 0; this.logScroll = 0;
    this.storageStatus = cleared ? 'new' : 'unavailable';
    this.toastText = cleared ? 'DRAFT DISCARDED' : 'Draft cleared here; browser storage could not be cleared. Old recovery data may remain.';
    this.toastGood = cleared; this.rerender();
  }

  private toast(text: string, good: boolean): void {
    this.toastText = text;
    this.toastGood = good;
    this.rerender();
  }

  private wheelScroll(
    area: ScrollArea,
    content: Phaser.GameObjects.Container,
    contentHeight: number,
    scroll: number,
    onScroll: (current: number) => void,
  ): void {
    content.setMask(this.make.graphics({}, false).fillStyle(0xffffff).fillRect(area.x, area.y, area.w, area.h).createGeometryMask());
    const maxScroll = Math.max(0, Math.ceil(contentHeight - area.h));
    const baseY = content.y;
    const thumbH = maxScroll > 0 ? Math.max(28, area.h * (area.h / contentHeight)) : 0;
    let current = Phaser.Math.Clamp(scroll, 0, maxScroll);
    let thumb: Phaser.GameObjects.Rectangle | undefined;
    if (maxScroll > 0) {
      this.add.rectangle(area.x + area.w - 3, area.y, 2, area.h, UI.border, 0.5).setOrigin(0.5, 0);
      thumb = this.add.rectangle(area.x + area.w - 3, area.y, 4, thumbH, UI.chip, 0.9).setOrigin(0.5, 0);
    }
    const apply = (): void => {
      content.setY(baseY - current);
      thumb?.setY(area.y + (area.h - thumbH) * (current / maxScroll));
      onScroll(current);
    };
    apply();
    if (maxScroll === 0) return;
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.closeDropdown) return;
      if (pointer.worldX < area.x || pointer.worldX > area.x + area.w || pointer.worldY < area.y || pointer.worldY > area.y + area.h) return;
      current = Phaser.Math.Clamp(current + dy, 0, maxScroll);
      apply();
    });
  }

  private gateToArea(objects: readonly Phaser.GameObjects.GameObject[], area: ScrollArea): void {
    for (const child of objects) {
      const object = child as Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle;
      const bounds = object.getBounds();
      object.setVisible(bounds.bottom > area.y && bounds.top < area.y + area.h);
      if (object.input) object.input.enabled = bounds.top >= area.y && bounds.bottom <= area.y + area.h;
    }
  }

  // ---------------------------------------------------------------------
  // Header / template / tier tabs
  // ---------------------------------------------------------------------

  private renderHeader(): void {
    this.add.text(GUTTER, 20, 'WORLD1 / CARD DESIGNER', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textAccent,
    });
    this.add.text(GUTTER, 40, 'CARD DESIGNER', {
      fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.big}px`, color: UI.text,
    });
    const menuW = 96;
    const menu = this.add.rectangle(SCREEN.width - GUTTER - menuW, 24, menuW, 34, UI.panelAlt)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true }).setData('designerControl', 'MENU');
    const menuLabel = this.add.text(SCREEN.width - GUTTER - menuW / 2, 41, '‹ MENU', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textDim,
    }).setOrigin(0.5);
    attachButtonFeel(this, menu, {
      fill: UI.panelAlt, hover: UI.slotHover, follow: [menuLabel],
      sfx: 'uiBack',
      onPress: () => { void this.leaveDesigner(); },
    });
    const discard = this.add.rectangle(SCREEN.width - GUTTER - menuW - 132, 24, 120, 34, UI.panelAlt)
      .setOrigin(0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true }).setData('designerControl', 'DISCARD DRAFT');
    const discardLabel = this.add.text(discard.x + 60, 41, 'DISCARD DRAFT', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
    }).setOrigin(0.5);
    attachButtonFeel(this, discard, { fill: UI.panelAlt, hover: UI.slotHover, follow: [discardLabel], onPress: () => { void this.discardDraft(); } });
    const status = this.storageStatus === 'saved' ? `${this.recoveredDraft ? 'Recovered draft · ' : ''}Saved on this device`
      : this.storageStatus === 'unavailable' ? 'Draft not saved · browser storage unavailable'
        : this.storageStatus === 'corrupt' ? 'Saved draft could not be recovered · new draft opened'
          : 'Drafts save automatically on this device';
    this.add.text(450, 44, status, { fontFamily: FONT.body, fontSize: `${F.tiny}px`,
      color: this.storageStatus === 'unavailable' || this.storageStatus === 'corrupt' ? '#e8907a' : UI.textMuted,
      wordWrap: { width: Math.max(200, SCREEN.width - 450 - 300) } });
  }

  private renderTemplateRow(): void {
    const y = 84;
    const templateX = GUTTER;
    const templateW = 676;
    this.add.text(templateX, y, 'START FROM CARD', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
    });
    const template = cardDesignerTemplates.find((entry) => entry.id === this.selectedTemplateId);
    const templateField = this.add.rectangle(templateX, y + 14, templateW, 26, UI.panelMuted, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setData('designerControl', 'START FROM CARD');
    this.add.text(templateX + 10, y + 27, template ? `${template.name}  ·  ${template.id}` : 'Select a card to edit…', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: template ? UI.textBright : UI.textMuted,
    }).setOrigin(0, 0.5);
    this.add.text(templateX + templateW - 12, y + 27, '▾', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5);
    templateField.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      playSfx('uiClick');
      this.openTemplatePicker(templateX, y + 44, templateW);
    });
  }

  private renderTierTabs(): void {
    const y = 132;
    const chipW = 110;
    let x = GUTTER;
    for (const tier of TIERS) {
      const active = tier === this.selectedTier;
      const reachable = TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(this.draft.def.tier);
      let onBudget = false;
      let plLabel = reachable ? 'ERR' : 'N/A';
      try {
        if (!reachable) throw new Error('tier below card minimum');
        const meter = tierMeter(this.draft, tier);
        onBudget = meter.onBudget && meter.violations.length === 0;
        plLabel = `${(meter.plDeci / 10).toFixed(1)}/${meter.budgetDeci / 10}`;
      } catch { /* transient invalid draft — shown as ERR */ }
      const customized = tierIsCustomized(this.draft, tier);
      const fill = active ? TIER_COLOR[tier] : UI.panelAlt;
      const chip = this.add.rectangle(x, y, chipW, 34, fill, reachable ? (customized ? 1 : 0.72) : 0.3)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, TIER_COLOR[tier], reachable ? (customized ? 1 : 0.65) : 0.25);
      if (reachable) chip.setInteractive({ useHandCursor: true }).setData('designerControl', tier.toUpperCase());
      this.add.text(x + 10, y + 3, tier.toUpperCase(), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`,
        color: active ? UI.textOnChip : UI.textDim,
      });
      this.add.text(x + 10, y + 18, plLabel, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`,
        color: active ? UI.textOnChip : onBudget ? UI.textGem : '#e8907a',
      });
      chip.on('pointerdown', () => {
        if (!reachable) return;
        if (this.selectedTier === tier) return;
        playSfx('uiClick');
        this.selectedTier = tier;
        this.formScroll = 0;
        this.previewScroll = 0;
        this.rerender();
      });
      x += chipW + 8;
    }
    const customized = tierIsCustomized(this.draft, this.selectedTier);
    const previousIndex = TIER_ORDER.indexOf(this.selectedTier) - 1;
    this.add.text(x + 10, y + 8, this.selectedTier === this.draft.def.tier
      ? `${this.selectedTier.toUpperCase()} is this card's base definition.`
      : customized
        ? `${this.selectedTier.toUpperCase()} has customized fields; untouched fields still inherit.`
        : `${this.selectedTier.toUpperCase()} starts from ${TIER_ORDER[previousIndex]!.toUpperCase()} until edited.`, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted, wordWrap: { width: 380 },
    });
  }

  private renderNameControl(x: number, y: number, width: number): number {
    this.add.text(x, y, 'name', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
    });
    const field = this.add.rectangle(x, y + 14, width, 26, UI.panelMuted, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true }).setData('designerControl', 'NAME');
    this.add.text(x + 10, y + 27, this.draft.def.name.length > 38 ? `${this.draft.def.name.slice(0, 35)}…` : this.draft.def.name, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textBright,
    }).setOrigin(0, 0.5);
    this.add.text(x + width - 10, y + 44, `id: ${this.draft.id.length > 52 ? `${this.draft.id.slice(0, 49)}…` : this.draft.id}`, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    }).setOrigin(1, 0.5);
    field.on('pointerdown', () => {
      playSfx('uiClick');
      void promptForLine({
        title: 'CARD NAME',
        initial: this.draft.def.name,
        hint: 'The card face and JSON name field. The draft id auto-derives from this name.',
        validate: (value) => (value.trim() === '' ? 'name cannot be empty' : null),
      }).then((value) => {
        if (value === null) return;
        const name = value.trim();
        this.updateDraft({ ...this.draft, id: deriveDraftId(name), def: { ...this.draft.def, name } });
      });
    });
    return 64;
  }

  // ---------------------------------------------------------------------
  // PALETTE — special Action kinds, generated from KEYWORD_TEXT
  // ---------------------------------------------------------------------

  private renderPalette(): void {
    const x = GUTTER;
    const width = 200;
    const top = CONTENT_TOP;
    const bottom = SCREEN.height - GUTTER;
    const height = bottom - top;
    this.add.rectangle(x, top, width, height, UI.panel, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    this.add.text(x + 10, top + 8, 'SPECIAL EFFECTS', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    });
    this.add.text(x + 10, top + 22, `Add/remove on ${this.selectedTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    });

    const area: ScrollArea = { x, y: top + 40, w: width, h: height - 48 };
    const rowH = 32;
    const list = this.add.container(x, area.y);
    const kinds = KEYWORD_KINDS
      .filter((kind) => !COMMON_EFFECT_KINDS.includes(kind))
      .sort((a, b) => keywordLabel(a).localeCompare(keywordLabel(b)) || a.localeCompare(b));
    const rows: Phaser.GameObjects.Rectangle[] = [];
    const restFills: Array<() => void> = [];

    kinds.forEach((kind, index) => {
      const rowY = index * rowH;
      const targetTier = effectTierFor(this.selectedTier, kind);
      const active = hasEffectKind(this.draft, this.selectedTier, kind);
      const row = this.add.rectangle(6, rowY, width - 12, rowH - 4, active ? UI.chip : UI.panelAlt, active ? 1 : 0.9)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5).setInteractive({ useHandCursor: true }).setData('designerControl', `EFFECT ${kind}`);
      const label = this.add.text(12, rowY + (rowH - 4) / 2, keywordLabel(kind), {
        fontFamily: FONT.body, fontStyle: active ? 'bold' : 'normal', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textBright,
      }).setOrigin(0, 0.5);
      list.add([row, label]);
      const sharesLabel = kinds.some((other) => other !== kind && keywordLabel(other) === keywordLabel(kind));
      const note = targetTier !== this.selectedTier ? `${targetTier.toUpperCase()}+` : sharesLabel ? kind : '';
      if (note !== '') {
        list.add(this.add.text(width - 14, rowY + (rowH - 4) / 2, note, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textMuted,
        }).setOrigin(1, 0.5));
      }
      const rest = (): void => { row.setFillStyle(active ? UI.chip : UI.panelAlt, active ? 1 : 0.9); };
      row.on('pointerover', () => row.setFillStyle(UI.slotHover, 0.9));
      row.on('pointerout', rest);
      restFills.push(rest);
      row.on('pointerdown', () => {
        playSfx('uiClick');
        if (targetTier !== this.selectedTier) {
          this.addOnTier(targetTier, kind);
          return;
        }
        if (!active) this.formScroll = Number.MAX_SAFE_INTEGER;
        this.updateDraft(withEffectToggled(this.draft, this.selectedTier, kind));
      });
      rows.push(row);
    });

    this.wheelScroll(area, list, kinds.length * rowH, this.paletteScroll, (current) => {
      this.paletteScroll = current;
      for (const rest of restFills) rest();
      this.gateToArea(rows, area);
    });
  }

  private addOnTier(tier: SkillTier, kind: string): void {
    const present = hasEffectKind(this.draft, tier, kind);
    this.selectedTier = tier;
    this.formScroll = Number.MAX_SAFE_INTEGER;
    this.previewScroll = 0;
    this.toastText = `${keywordLabel(kind).toUpperCase()} IS ${tier.toUpperCase()}+ · ${present ? 'ALREADY' : 'ADDED'} ON ${tier.toUpperCase()}`;
    this.toastGood = true;
    if (present) this.rerender();
    else this.updateDraft(withEffectAdded(this.draft, tier, kind));
  }

  // ---------------------------------------------------------------------
  // FORM — current tier's effects
  // ---------------------------------------------------------------------

  private updateDraft(next: CardDesignerDraft): void {
    this.draft = next;
    this.draftEdited = true;
    this.hasSavedDraft = true;
    this.recoveredDraft = false;
    this.rerender();
  }

  private renderForm(): void {
    const x = 248;
    const width = 460;
    const top = CONTENT_TOP;
    const bottom = SCREEN.height - GUTTER;
    this.add.rectangle(x, top, width, bottom - top, UI.panel, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    const formLayer = this.add.container(0, 0);
    const contentStart = this.children.list.length;
    const innerX = x + 12;
    const innerW = width - 24;
    let y = top + 10;

    // ---- card definition (base tier) / inherited tier fields (else) — both
    // GENERATED from src/engine/keywords/editor.ts (CARD_FIELDS /
    // TIER_UPGRADE_FIELDS), never a hand-listed table. ----
    if (this.selectedTier === this.draft.def.tier) {
      this.add.text(innerX, y, 'CARD DEFINITION', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
      });
      y += 18;
      y += this.renderNameControl(innerX, y, innerW);
      y += this.renderCycle(innerX, y, innerW, 'property', this.draft.def.property, stringOptions(CARD_FIELDS.property),
        (v) => this.updateDraft(setCardField(this.draft, 'property', v)));
      const typeOptions = this.draft.def.property === 'physical'
        ? WEAPON_OPTIONS
        : this.draft.def.property === 'magical'
          ? ELEMENT_OPTIONS
          : CARD_TYPE_OPTIONS;
      const typeLabel = this.draft.def.property === 'physical'
        ? 'weapon'
        : this.draft.def.property === 'magical'
          ? 'element'
          : 'type (weapon/element)';
      const currentType = this.draft.def.weapon ?? this.draft.def.element ?? typeOptions[0]!;
      y += this.renderCycle(innerX, y, innerW, typeLabel, currentType, typeOptions,
        (v) => this.updateDraft(setCardType(this.draft, v)));
      y += this.renderCycle(innerX, y, innerW, 'size', String(this.draft.def.size), stringOptions(CARD_FIELDS.size),
        (v) => this.updateDraft(setCardField(this.draft, 'size', Number(v))));
      y += this.renderCycle(innerX, y, innerW, 'rarity', this.draft.def.rarity, stringOptions(CARD_FIELDS.rarity),
        (v) => this.updateDraft(setCardField(this.draft, 'rarity', v)));
      this.add.text(innerX, y, 'archetypes', { fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim });
      y += 14;
      let ax = innerX;
      const chipW = Math.floor(innerW / ARCHETYPE_LABELS.length) - 4;
      for (const a of ARCHETYPE_LABELS) {
        this.renderToggle(ax, y, chipW, a, this.draft.def.archetypes.includes(a), () => this.updateDraft(toggleArchetype(this.draft, a)));
        ax += chipW + 4;
      }
      y += 30;
      y += this.renderCycle(innerX, y, innerW, 'scope', this.draft.def.scope ?? 'one', stringOptions(CARD_FIELDS.scope),
        (v) => this.updateDraft(setCardField(this.draft, 'scope', v === 'one' ? undefined : v)));

      y += 6;
      this.add.text(innerX, y, `TIER STATS — ${this.selectedTier.toUpperCase()}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
      });
      y += 18;
      y += this.renderStepper(innerX, y, innerW, 'Weight', this.draft.def.speedWeight ?? this.draft.def.size * 10,
        CARD_FIELDS.speedWeight.min!, CARD_FIELDS.speedWeight.max!, CARD_FIELDS.speedWeight.step!,
        (v) => this.updateDraft(setCardField(this.draft, 'speedWeight', v)));
      y += this.renderStepper(innerX, y, innerW, 'Cooldown (turns)', this.draft.def.cooldownTurns ?? CARD_FIELDS.cooldownTurns.default!,
        CARD_FIELDS.cooldownTurns.min!, CARD_FIELDS.cooldownTurns.max!, CARD_FIELDS.cooldownTurns.step!,
        (v) => this.updateDraft(setCardField(this.draft, 'cooldownTurns', v)));
    } else {
      const tier = this.selectedTier as NonBronzeTier;
      const override = this.draft.def.tierUpgrades?.[tier];
      const configuration = tierConfigurationAt(this.draft, tier);
      this.add.text(innerX, y, `TIER STATS — ${tier.toUpperCase()}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
      });
      y += 18;
      this.add.text(innerX, y, 'unset fields inherit from the previous tier.', {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted, wordWrap: { width: innerW },
      });
      y += 16;
      const scopeVal = configuration.scope ?? 'one';
      y += this.renderCycle(innerX, y, innerW, `scope${override?.scope === undefined ? ' (inherited)' : ''}`, scopeVal, stringOptions(TIER_UPGRADE_FIELDS.scope),
        (v) => this.updateDraft(setTierUpgradeField(this.draft, tier, 'scope', v)));
      const cdVal = configuration.cooldownTurns ?? CARD_FIELDS.cooldownTurns.default!;
      y += this.renderStepper(innerX, y, innerW, `Cooldown${override?.cooldownTurns === undefined ? ' (inherited)' : ''}`, cdVal,
        TIER_UPGRADE_FIELDS.cooldownTurns.min!, TIER_UPGRADE_FIELDS.cooldownTurns.max!, TIER_UPGRADE_FIELDS.cooldownTurns.step!,
        (v) => this.updateDraft(setTierUpgradeField(this.draft, tier, 'cooldownTurns', v)));
      const swVal = configuration.speedWeight ?? this.draft.def.size * 10;
      y += this.renderStepper(innerX, y, innerW, `Weight${override?.speedWeight === undefined ? ' (inherited)' : ''}`, swVal,
        TIER_UPGRADE_FIELDS.speedWeight.min!, TIER_UPGRADE_FIELDS.speedWeight.max!, TIER_UPGRADE_FIELDS.speedWeight.step!,
        (v) => this.updateDraft(setTierUpgradeField(this.draft, tier, 'speedWeight', v)));
    }

    // ---- effects — generated per-kind fields/selectors/flags (KEYWORD_EDITOR) ----
    y += 6;
    this.add.text(innerX, y, `COMMON EFFECTS — ${this.selectedTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
    });
    y += 18;

    const effects = effectsForEditing(this.draft, this.selectedTier);
    const additionalStatCost = (kind: Action['kind']): number => {
      const actions = effects as readonly Action[];
      return (additionalStatCount([...actions, { kind } as Action]) - additionalStatCount(actions))
        * PRICE.additionalStatPremium / 10;
    };
    const renderEffectEditor = (effect: (typeof effects)[number], index: number, title?: string): void => {
      const editor = (KEYWORD_EDITOR as Record<string, KeywordEditor>)[effect.kind];
      this.add.rectangle(innerX, y, innerW, 20, UI.panelAlt, 0.9).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
      this.add.text(innerX + 6, y + 10, title ?? (editor ? editor.label : effect.kind), {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textBright,
      }).setOrigin(0, 0.5);
      const remove = this.add.rectangle(innerX + innerW - 20, y, 20, 20, UI.panelMuted, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6).setInteractive({ useHandCursor: true });
      this.add.text(innerX + innerW - 10, y + 10, '×', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: '#e8907a',
      }).setOrigin(0.5);
      remove.on('pointerdown', () => {
        playSfx('uiClick');
        this.updateDraft(withEffectRemoved(this.draft, this.selectedTier, index, true));
      });
      y += 24;
      if (!editor) {
        this.add.text(innerX + 6, y, `unknown kind "${effect.kind}" — no editor metadata (typo? case?)`, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a', wordWrap: { width: innerW - 6 },
        });
        y += 18;
        return;
      }
      const ctx = editorContextForEffect(this.draft, this.selectedTier, effect);
      for (const field of editableFieldsForEffect(this.draft, this.selectedTier, effect)) {
        const current = typeof effect[field.key] === 'number' ? (effect[field.key] as number) : field.default;
        y += this.renderStepper(innerX + 12, y, innerW - 12, effectFieldLabel(effect.kind, field.key, field.label), current, field.min, field.max, field.step,
          (next) => this.updateDraft(setEffectField(this.draft, this.selectedTier, index, field.key, next, true)));
      }
      for (const selector of selectorsFor(effect.kind as Action['kind'], ctx)) {
        const current = typeof effect[selector.key] === 'string' ? (effect[selector.key] as string) : selector.default;
        const optionLabel = selector.key === 'stat' ? statOptionLabel : undefined;
        y += this.renderCycle(innerX + 12, y, innerW - 12, selector.label, current, selector.options,
          (next) => this.updateDraft(setEffectSelector(this.draft, this.selectedTier, index, selector.key, next, true)), optionLabel);
      }
      for (const flag of editor.flags) {
        const active = effect[flag.key] === true;
        y += this.renderToggle(innerX + 12, y, innerW - 12, `${flag.label}${active ? ' ✓' : ''}`, active,
          () => this.updateDraft(toggleEffectFlag(this.draft, this.selectedTier, index, flag.key, true)));
      }
      y += this.renderActionModifiers(innerX + 12, y, innerW - 12, effect, index);
      y += 4;
    };

    const amountKinds: ReadonlyArray<{ kind: 'damage' | 'shield' | 'heal'; key: 'power'; label: string }> = [
      { kind: 'damage', key: 'power', label: 'Damage amount' },
      { kind: 'shield', key: 'power', label: 'Shield amount' },
      { kind: 'heal', key: 'power', label: 'Heal amount' },
    ];
    for (const amount of amountKinds) {
      const matches = effects
        .map((effect, index) => ({ effect, index }))
        .filter(({ effect }) => effect.kind === amount.kind);
      if (matches.length > 0) {
        matches.forEach(({ effect, index }, duplicateIndex) => {
          const field = editableFieldsForEffect(this.draft, this.selectedTier, effect)
            .find((candidate) => candidate.key === amount.key)!;
          const current = typeof effect[amount.key] === 'number' ? effect[amount.key] as number : field.default;
          const label = matches.length > 1 ? `${amount.label} ${duplicateIndex + 1}` : amount.label;
          const rowY = y;
          y += this.renderStepper(innerX + 12, rowY, innerW - 44, label, current, field.min, field.max, field.step,
            (next) => this.updateDraft(setEffectField(this.draft, this.selectedTier, index, amount.key, next, true)));
          const remove = this.add.rectangle(innerX + innerW - 28, rowY, 28, 28, UI.panelMuted, 1)
            .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
          this.add.text(innerX + innerW - 14, rowY + 14, '×', {
            fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: '#e8907a',
          }).setOrigin(0.5);
          remove.on('pointerdown', () => {
            playSfx('uiClick');
            this.updateDraft(withEffectRemoved(this.draft, this.selectedTier, index, true));
          });
          y += this.renderActionModifiers(innerX + 12, y, innerW - 12, effect, index);
        });
      }
      const addY = y;
      const addW = innerW - 12;
      const add = this.add.rectangle(innerX + 12, addY, addW, 26, UI.panelAlt, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(innerX + 22, addY + 13, `+ ADD ${amount.kind.toUpperCase()}`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      }).setOrigin(0, 0.5);
      const additionalCost = additionalStatCost(amount.kind);
      if (additionalCost > 0) {
        this.add.text(innerX + innerW - 10, addY + 13, `Additional Stat +${additionalCost} PL`, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
        }).setOrigin(1, 0.5);
      }
      add.on('pointerdown', () => {
        playSfx('uiClick');
        this.updateDraft(withEffectAdded(this.draft, this.selectedTier, amount.kind));
      });
      y += 34;
    }

    const renderStatSection = (kind: 'buffStat' | 'debuffStat', title: string): void => {
      y += 4;
      this.add.text(innerX + 12, y + 11, title, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textBright,
      }).setOrigin(0, 0.5);
      const additionalCost = additionalStatCost(kind);
      const addW = additionalCost > 0 ? 230 : 74;
      const add = this.add.rectangle(innerX + innerW - addW, y, addW, 22, UI.panelAlt, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(innerX + innerW - addW / 2, y + 11,
        additionalCost > 0 ? `+ ADD · Additional Stat +${additionalCost} PL` : '+ ADD', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      }).setOrigin(0.5);
      add.on('pointerdown', () => {
        playSfx('uiClick');
        this.formScroll = Number.MAX_SAFE_INTEGER;
        this.updateDraft(kind === 'debuffStat'
          ? withStatDebuffAdded(this.draft, this.selectedTier)
          : withEffectAdded(this.draft, this.selectedTier, kind));
      });
      y += 28;
      const matches = effects
        .map((effect, index) => ({ effect, index }))
        .filter(({ effect }) => effect.kind === kind);
      if (matches.length === 0) {
        this.add.text(innerX + 12, y, 'None on this tier.', {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
        });
        y += 18;
      } else {
        matches.forEach(({ effect, index }, entryIndex) => renderEffectEditor(effect, index, `${title} ${entryIndex + 1}`));
      }
    };
    renderStatSection('buffStat', 'STAT BUFF');
    renderStatSection('debuffStat', 'STAT DEBUFF');

    y += 6;
    this.add.text(innerX, y, `SPECIAL EFFECTS — ${this.selectedTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
    });
    y += 18;
    const specialEffects = effects
      .map((effect, index) => ({ effect, index }))
      .filter(({ effect }) => !COMMON_EFFECT_KINDS.includes(effect.kind));
    if (specialEffects.length === 0) {
      this.add.text(innerX, y, 'None on this tier — choose one from the left.', {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
      });
      y += 20;
    } else {
      specialEffects.forEach(({ effect, index }) => renderEffectEditor(effect, index));
    }

    const formChildren = this.children.list.slice(contentStart);
    formLayer.add(formChildren);
    const area: ScrollArea = { x: x + 2, y: top + 2, w: width - 4, h: bottom - top - 4 };
    this.wheelScroll(area, formLayer, y + 10 - area.y, this.formScroll, (current) => {
      this.formScroll = current;
      this.gateToArea(formChildren, area);
    });
  }

  // ---------------------------------------------------------------------
  // Generic generated controls — stepper (number), cycle (enum), toggle
  // (flag/chip). Each returns the vertical space it consumed so callers
  // stack rows without hand-tracking every control's height twice.
  // ---------------------------------------------------------------------

  private renderActionModifiers(x: number, y: number, width: number, effect: { kind: string; [key: string]: unknown }, index: number): number {
    const top = y;
    const start = this.children.list.length;
    for (const field of ACTION_MODIFIER_FIELDS) {
      if (field.key === 'affinity') {
        const active = effect.affinity === true;
        y += this.renderToggle(x, y, width, `Affinity: ${active ? 'ON' : 'OFF'}`, active,
          () => this.updateDraft(toggleEffectFlag(this.draft, this.selectedTier, index, field.key, true)));
      } else if (field.key === 'minTier' && 'options' in field) {
        const intrinsic = effectTierFor(this.draft.def.tier, effect.kind);
        const options = ['', ...field.options.filter((tier) => TIER_ORDER.indexOf(tier as SkillTier) >= TIER_ORDER.indexOf(intrinsic))];
        const current = typeof effect.minTier === 'string' ? effect.minTier : '';
        y += this.renderCycle(x, y, width, 'Unlock tier', current, options,
          (value) => this.updateDraft(setEffectMinTier(this.draft, this.selectedTier, index, value === '' ? undefined : value as SkillTier)),
          (value) => value === '' ? (intrinsic === this.draft.def.tier ? 'No extra lock' : `Automatic (${intrinsic}+)`) : value.toUpperCase());
        const lock = typeof effect.minTier === 'string' ? effect.minTier as SkillTier : intrinsic;
        if (TIER_ORDER.indexOf(lock) > TIER_ORDER.indexOf(this.selectedTier)) {
          this.add.text(x, y, `Inactive on ${this.selectedTier}; unlocks on ${lock}.`, {
            fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted, wordWrap: { width },
          });
          y += 20;
        }
      }
    }
    for (const child of this.children.list.slice(start)) child.setData('designerEffectIndex', index);
    return y - top + 4;
  }

  private renderStepper(
    x: number, y: number, width: number, label: string, value: number,
    min: number, max: number, step: number, onChange: (next: number) => void,
  ): number {
    const h = 28;
    this.add.text(x, y + h / 2, label, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
    }).setOrigin(0, 0.5);
    const ctrlW = 120;
    const ctrlX = x + width - ctrlW;
    const seg = 28;
    const minus = this.add.rectangle(ctrlX, y, seg, h, UI.panelMuted, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true }).setData('designerControl', `${label} -`);
    this.add.text(ctrlX + seg / 2, y + h / 2, '−', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textBright,
    }).setOrigin(0.5);
    this.add.rectangle(ctrlX + seg, y, ctrlW - seg * 2, h, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    this.add.text(ctrlX + ctrlW / 2, y + h / 2, String(value), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textBright,
    }).setOrigin(0.5);
    const plus = this.add.rectangle(ctrlX + ctrlW - seg, y, seg, h, UI.panelMuted, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true }).setData('designerControl', `${label} +`);
    this.add.text(ctrlX + ctrlW - seg / 2, y + h / 2, '+', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textBright,
    }).setOrigin(0.5);
    minus.on('pointerdown', () => {
      if (value <= min) return;
      playSfx('uiClick');
      onChange(Math.max(min, value - step));
    });
    plus.on('pointerdown', () => {
      if (value >= max) return;
      playSfx('uiClick');
      onChange(Math.min(max, Math.max(min, value + step)));
    });
    return h + 4;
  }

  private renderCycle(
    x: number, y: number, width: number, label: string, value: string,
    options: readonly string[], onChange: (next: string) => void,
    optionLabel: (value: string) => string = (option) => option,
  ): number {
    const h = 28;
    this.add.text(x, y + h / 2, label, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
    }).setOrigin(0, 0.5);
    const ctrlW = 176;
    const ctrlX = x + width - ctrlW;
    const box = this.add.rectangle(ctrlX, y, ctrlW, h, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6).setInteractive({ useHandCursor: true }).setData('designerControl', label);
    this.add.text(ctrlX + 10, y + h / 2, optionLabel(value), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textBright,
    }).setOrigin(0, 0.5);
    this.add.text(ctrlX + ctrlW - 12, y + h / 2, '▾', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0.5);
    box.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      playSfx('uiClick');
      const bounds = box.getBounds();
      this.openDropdown(bounds.x, bounds.bottom + 4, ctrlW, value, options, onChange, optionLabel);
    });
    return h + 4;
  }

  private openDropdown(
    x: number, y: number, width: number, value: string,
    options: readonly string[], onChange: (next: string) => void,
    optionLabel: (value: string) => string = (option) => option,
  ): void {
    this.closeDropdown?.();
    if (options.length === 0) return;
    const rowH = 28;
    const height = options.length * rowH + 8;
    const top = Phaser.Math.Clamp(y, GUTTER, SCREEN.height - GUTTER - height);
    const overlay = this.add.container(0, 0).setDepth(5000);
    const blocker = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, 0x000000, 0.08)
      .setOrigin(0).setInteractive();
    const panel = this.add.rectangle(x, top, width, height, UI.panelMuted, 1)
      .setOrigin(0).setStrokeStyle(1, UI.border, 1).setInteractive();
    overlay.add([blocker, panel]);
    let focused = Math.max(0, options.indexOf(value));
    const rows: Phaser.GameObjects.Rectangle[] = [];
    const highlight = (): void => rows.forEach((row, i) => row.setFillStyle(i === focused ? UI.slotHover : UI.panelAlt, 1));
    const choose = (index: number): void => {
      const next = options[index];
      this.closeDropdown?.();
      if (next !== undefined && next !== value) {
        playSfx('uiClick');
        onChange(next);
      }
    };
    const onKey = oncePerKeyEvent((event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') this.closeDropdown?.();
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(focused); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focused = (focused + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        highlight();
      }
    });
    this.closeDropdown = () => {
      this.closeDropdown = undefined;
      this.input.keyboard?.off('keydown', onKey);
      overlay.destroy();
    };
    blocker.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.closeDropdown?.();
    });
    panel.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    options.forEach((option, i) => {
      const rowY = top + 4 + i * rowH;
      const row = this.add.rectangle(x + 4, rowY, width - 8, rowH, UI.panelAlt, 1)
        .setOrigin(0).setInteractive({ useHandCursor: true });
      const label = this.add.text(x + 12, rowY + rowH / 2, `${option === value ? '✓ ' : ''}${optionLabel(option)}`, {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: option === value ? UI.textAccent : UI.textBright,
      }).setOrigin(0, 0.5);
      row.on('pointerover', () => { focused = i; highlight(); });
      row.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        choose(i);
      });
      rows.push(row);
      overlay.add([row, label]);
    });
    highlight();
    this.input.keyboard?.on('keydown', onKey);
  }

  private openTemplatePicker(x: number, y: number, width: number): void {
    this.closeDropdown?.();
    const rowH = 30;
    const maxRows = 12;
    const top = Phaser.Math.Clamp(y, GUTTER, SCREEN.height - GUTTER - (maxRows * rowH + 78));
    const height = maxRows * rowH + 78;
    const overlay = this.add.container(0, 0).setDepth(5000);
    const blocker = this.add.rectangle(0, 0, SCREEN.width, SCREEN.height, 0x000000, 0.12)
      .setOrigin(0).setInteractive();
    const panel = this.add.rectangle(x, top, width, height, UI.panelMuted, 1)
      .setOrigin(0).setStrokeStyle(1, UI.border, 1).setInteractive();
    const searchBox = this.add.rectangle(x + 8, top + 8, width - 16, 30, UI.panelAlt, 1)
      .setOrigin(0).setStrokeStyle(1, UI.border, 0.8).setInteractive();
    const searchText = this.add.text(x + 18, top + 23, 'Search by card name or id…', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    }).setOrigin(0, 0.5);
    const countText = this.add.text(x + 10, top + height - 24, '', {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    });
    const rowsLayer = this.add.container(0, 0);
    overlay.add([blocker, panel, searchBox, searchText, rowsLayer, countText]);

    let query = '';
    let filtered = [...cardDesignerTemplates];
    let focused = Math.max(0, filtered.findIndex((entry) => entry.id === this.selectedTemplateId));
    let first = Math.max(0, focused - Math.floor(maxRows / 2));

    const choose = async (index: number): Promise<void> => {
      const template = filtered[index];
      if (!template) return;
      if (template.id === this.selectedTemplateId) {
        this.closeDropdown?.();
        return;
      }
      if (this.draftEdited) {
        this.closeDropdown?.();
        if (!await this.confirmDraft('REPLACE DRAFT?', `Replace your current draft with ${template.name}? Your current draft will be discarded.`, 'REPLACE', 'KEEP DRAFT')) return;
      }
      this.closeDropdown?.();
      this.draft = draftFromTemplate(template.id);
      this.selectedTemplateId = template.id;
      this.selectedTier = this.draft.def.tier;
      this.draftEdited = false;
      this.hasSavedDraft = true;
      this.recoveredDraft = false;
      this.formScroll = 0;
      this.previewScroll = 0;
      this.jsonScroll = 0;
      this.logScroll = 0;
      playSfx('uiClick');
      this.rerender();
    };

    const renderRows = (): void => {
      rowsLayer.removeAll(true);
      if (filtered.length === 0) {
        focused = 0;
        first = 0;
      } else {
        focused = Phaser.Math.Clamp(focused, 0, filtered.length - 1);
        first = Phaser.Math.Clamp(first, 0, Math.max(0, filtered.length - maxRows));
        if (focused < first) first = focused;
        if (focused >= first + maxRows) first = focused - maxRows + 1;
      }
      searchText.setText(query === '' ? 'Search by card name or id…' : `Search: ${query}`)
        .setColor(query === '' ? UI.textMuted : UI.textBright);
      countText.setText(`${filtered.length} card${filtered.length === 1 ? '' : 's'} · type to filter · Esc closes`);
      filtered.slice(first, first + maxRows).forEach((template, visibleIndex) => {
        const index = first + visibleIndex;
        const rowY = top + 44 + visibleIndex * rowH;
        const active = template.id === this.selectedTemplateId;
        const row = this.add.rectangle(x + 8, rowY, width - 16, rowH - 2,
          index === focused ? UI.slotHover : active ? UI.chip : UI.panelAlt, 1)
          .setOrigin(0).setInteractive({ useHandCursor: true });
        const label = this.add.text(x + 18, rowY + (rowH - 2) / 2,
          `${active ? '✓ ' : ''}${template.name}  ·  ${template.id}`, {
            fontFamily: FONT.body, fontStyle: active ? 'bold' : 'normal', fontSize: `${F.tiny}px`,
            color: active ? UI.textOnChip : UI.textBright,
          }).setOrigin(0, 0.5);
        row.on('pointerover', () => { focused = index; row.setFillStyle(UI.slotHover, 1); });
        row.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          void choose(index);
        });
        rowsLayer.add([row, label]);
      });
    };

    const applyQuery = (): void => {
      const needle = query.trim().toLowerCase();
      filtered = cardDesignerTemplates.filter((entry) => needle === ''
        || entry.name.toLowerCase().includes(needle)
        || entry.id.toLowerCase().includes(needle));
      focused = 0;
      first = 0;
      renderRows();
    };
    const onKey = oncePerKeyEvent((event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') this.closeDropdown?.();
      else if (event.key === 'Enter') { event.preventDefault(); void choose(focused); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (filtered.length > 0) focused = (focused + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length;
        renderRows();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        query = query.slice(0, -1);
        applyQuery();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        query += event.key;
        applyQuery();
      }
    });
    const onWheel = (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number): void => {
      if (pointer.worldX < x || pointer.worldX > x + width || pointer.worldY < top || pointer.worldY > top + height) return;
      first = Phaser.Math.Clamp(first + Math.sign(dy), 0, Math.max(0, filtered.length - maxRows));
      focused = Phaser.Math.Clamp(focused, first, Math.min(filtered.length - 1, first + maxRows - 1));
      renderRows();
    };
    this.closeDropdown = () => {
      this.closeDropdown = undefined;
      this.input.keyboard?.off('keydown', onKey);
      this.input.off('wheel', onWheel);
      overlay.destroy();
    };
    blocker.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.closeDropdown?.();
    });
    panel.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    searchBox.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    this.input.keyboard?.on('keydown', onKey);
    this.input.on('wheel', onWheel);
    renderRows();
  }

  private renderToggle(x: number, y: number, width: number, label: string, active: boolean, onChange: () => void): number {
    const h = 28;
    const box = this.add.rectangle(x, y, width, h, active ? UI.chip : UI.panelAlt, active ? 1 : 0.7)
      .setOrigin(0, 0).setStrokeStyle(1, active ? UI.chip : UI.border, active ? 1 : 0.5).setInteractive({ useHandCursor: true }).setData('designerControl', label);
    this.add.text(x + width / 2, y + h / 2, label, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textDim,
    }).setOrigin(0.5);
    box.on('pointerdown', () => { playSfx('uiClick'); onChange(); });
    return h + 4;
  }

  // ---------------------------------------------------------------------
  // METER + FACE — spend/budget/breakdown, live preview, JSON out
  // ---------------------------------------------------------------------

  private renderMeterAndFace(): void {
    const x = 724;
    const width = SCREEN.width - GUTTER - x;
    const top = CONTENT_TOP;
    const bottom = SCREEN.height - GUTTER;
    this.add.rectangle(x, top, width, bottom - top, UI.panel, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);

    let y = top + 12;
    let meterOk = false;
    try {
      const meter = tierMeter(this.draft, this.selectedTier);
      meterOk = meter.onBudget && meter.violations.length === 0;
      const pl = (meter.plDeci / 10).toFixed(1);
      const budget = (meter.budgetDeci / 10).toFixed(0);
      const deltaPl = meter.deltaDeci / 10;
      const barColor = meterOk ? UI.good : UI.bad;
      this.add.text(x + 12, y, `${pl} / ${budget} PL  ·  ${this.selectedTier.toUpperCase()}`, {
        fontFamily: FONT.display, fontStyle: 'bold', fontSize: `${F.label}px`, color: meterOk ? UI.textGem : '#e8907a',
      });
      this.add.text(x + width - 12, y + 2, meterOk ? 'EXACT BUDGET' : `${deltaPl > 0 ? '+' : ''}${deltaPl.toFixed(1)} PL OFF`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: meterOk ? UI.textGem : '#e8907a',
      }).setOrigin(1, 0);
      y += 22;
      const barW = width - 24;
      this.add.rectangle(x + 12, y, barW, 8, UI.panelMuted, 1).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
      const fillW = Math.max(0, Math.min(barW, (meter.plDeci / Math.max(1, meter.budgetDeci)) * barW));
      this.add.rectangle(x + 12, y, fillW, 8, barColor, 1).setOrigin(0, 0);
      y += 14;
      const additionalStat = meter.breakdown.find((part) => part.label === 'Additional Stat');
      const additionalStatLine = this.add.text(x + 12, y,
        `Additional Stat: ${((additionalStat?.deci ?? 0) / 10).toFixed(1)} PL included · ${PRICE.additionalStatPremium / 10} PL per repeat`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
          wordWrap: { width: width - 24, useAdvancedWrap: true },
        });
      y += additionalStatLine.height + 6;
      const breakdownWidth = (width - 32) / 2;
      const breakdown = meter.breakdown.filter((part) => part !== additionalStat);
      for (let index = 0; index < breakdown.length; index += 2) {
        let rowHeight = 14;
        for (let column = 0; column < 2; column += 1) {
          const part = breakdown[index + column];
          if (!part) continue;
          const line = this.add.text(x + 12 + column * (breakdownWidth + 8), y, `${part.label}: ${(part.deci / 10).toFixed(1)} PL`, {
            fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
            wordWrap: { width: breakdownWidth, useAdvancedWrap: true },
          });
          rowHeight = Math.max(rowHeight, line.height + 2);
        }
        y += rowHeight;
      }
      for (const violation of meter.violations) {
        const line = this.add.text(x + 12, y, violation, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a', wordWrap: { width: width - 24 },
        });
        y += line.height + 3;
      }
    } catch (err) {
      const line = this.add.text(x + 12, y, `could not price this draft: ${err instanceof Error ? err.message : String(err)}`, {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a', wordWrap: { width: width - 24 },
      });
      y += line.height + 8;
    }

    const json = exportJsonText(this.draft);
    const gate = exportGate(this.draft);
    const gateReasonHeight = gate.ready ? 0 : 28;
    const toggleHeight = 26;
    const buttonsTop = bottom - 10 - gateReasonHeight - 30;
    const modeTop = Math.max(y + 8, top + 104);
    this.renderPreviewModes(x + 8, modeTop, width - 16, toggleHeight);
    const previewTop = modeTop + toggleHeight + 8;
    const stackRoom = buttonsTop - 8 - toggleHeight - 8 - previewTop;
    const jsonHeight = this.jsonExpanded
      ? Math.max(0, Math.min(Math.floor(stackRoom * 0.45), stackRoom - 8 - 140))
      : 0;
    const previewHeight = stackRoom - (jsonHeight > 0 ? jsonHeight + 8 : 0);
    const previewArea = { x: x + 8, y: previewTop, w: width - 16, h: previewHeight };
    if (gate.problems.length > 0) {
      this.renderProblems(previewArea, gate.problems);
    } else if (this.previewMode === 'log') {
      this.renderCombatLog(previewArea);
    } else {
      try {
        const preview = renderCardDesignerPreview(this, resolvedAt(this.draft, this.selectedTier), {
          x: previewArea.x,
          y: previewArea.y,
          width: previewArea.w,
          height: previewArea.h,
        });
        this.wheelScroll(preview.viewport, preview.content, preview.contentHeight, this.previewScroll, (current) => {
          this.previewScroll = current;
        });
      } catch (err) {
        this.add.text(x + 12, previewTop + 8, `preview unavailable: ${err instanceof Error ? err.message : String(err)}`, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a', wordWrap: { width: width - 24 },
        });
      }
    }

    const jsonToggleY = previewTop + previewHeight + 8;
    const jsonToggle = this.add.rectangle(x + 8, jsonToggleY, width - 16, toggleHeight, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true }).setData('designerControl', 'SHOW JSON');
    this.add.text(x + 18, jsonToggleY + 13, `${this.jsonExpanded ? 'HIDE' : 'SHOW'} JSON`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
    }).setOrigin(0, 0.5);
    this.add.text(x + width - 18, jsonToggleY + 13, `${json.length.toLocaleString()} bytes  ${this.jsonExpanded ? '▴' : '▾'}`, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    }).setOrigin(1, 0.5);
    jsonToggle.on('pointerdown', () => {
      playSfx('uiClick');
      this.jsonExpanded = !this.jsonExpanded;
      this.rerender();
    });

    const buttonsY = buttonsTop;
    if (jsonHeight > 0) {
      const jsonY = jsonToggleY + toggleHeight + 8;
      this.add.rectangle(x + 8, jsonY, width - 16, jsonHeight, UI.panelMuted, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
      const jsonText = this.add.text(0, 0, json, {
        fontFamily: 'Consolas, Menlo, monospace', fontSize: `${F.tiny}px`, color: UI.textDim, lineSpacing: 2,
      });
      const jsonContent = this.add.container(x + 16, jsonY + 6, [jsonText]);
      this.wheelScroll({ x: x + 10, y: jsonY + 2, w: width - 20, h: jsonHeight - 4 }, jsonContent, jsonText.height + 10,
        this.jsonScroll, (current) => { this.jsonScroll = current; });
    }

    const btnW = (width - 16 - 8) / 2;
    const copyBtn = this.add.rectangle(x + 8, buttonsY, btnW, 30, gate.ready ? UI.chip : UI.panelMuted, gate.ready ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, gate.ready ? 1 : 0.4).setData('designerControl', 'COPY JSON');
    const copyLabel = this.add.text(x + 8 + btnW / 2, buttonsY + 15, 'COPY JSON', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: gate.ready ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    const downloadBtn = this.add.rectangle(x + 8 + btnW + 8, buttonsY, btnW, 30, gate.ready ? UI.chip : UI.panelMuted, gate.ready ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, gate.ready ? 1 : 0.4).setData('designerControl', 'DOWNLOAD JSON');
    const downloadLabel = this.add.text(x + 8 + btnW + 8 + btnW / 2, buttonsY + 15, 'DOWNLOAD .JSON', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: gate.ready ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    if (gate.ready) {
      copyBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        playSfx('uiClick');
        void copyTextToClipboard(json).then((ok) => this.toast(ok ? 'COPIED' : 'clipboard blocked — use DOWNLOAD', ok));
      });
      downloadBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        playSfx('uiClick');
        downloadJsonFile(`${this.draft.id}.json`, json);
        this.toast('DOWNLOADED', true);
      });
    } else {
      const reason = gate.problems.length > 0
        ? `${gate.problems.length} schema problem(s)`
        : gate.failingTiers.length === 1
          ? `${gate.failingTiers[0]!.tier} ${gate.failingTiers[0]!.reason}`
          : `${gate.failingTiers.length} tier issues — ${gate.failingTiers.map((f) => f.tier.toUpperCase()).join(', ')}`;
      this.add.text(x + 8, buttonsY + 32, `disabled — ${reason}`, {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a', wordWrap: { width: width - 16 },
      });
    }
  }

  private renderPreviewModes(x: number, y: number, width: number, height: number): void {
    const modes: ReadonlyArray<{ id: PreviewMode; label: string }> = [
      { id: 'card', label: 'CARD PREVIEW' },
      { id: 'log', label: 'COMBAT LOG' },
    ];
    const segmentW = (width - 8) / modes.length;
    modes.forEach((mode, index) => {
      const active = this.previewMode === mode.id;
      const segmentX = x + index * (segmentW + 8);
      const box = this.add.rectangle(segmentX, y, segmentW, height, active ? UI.chip : UI.panelAlt, active ? 1 : 0.9)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true }).setData('designerControl', mode.label);
      this.add.text(segmentX + segmentW / 2, y + height / 2, mode.label, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textAccent,
      }).setOrigin(0.5);
      box.on('pointerdown', () => {
        if (active) return;
        playSfx('uiClick');
        this.previewMode = mode.id;
        this.rerender();
      });
    });
  }

  private renderCombatLog(area: ScrollArea): void {
    this.add.rectangle(area.x, area.y, area.w, area.h, UI.panelMuted, 0.78).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);
    const request: DesignBattleRequest = { document: cardDesignerDocument(this.draft), tier: this.selectedTier };
    const key = JSON.stringify(request);
    this.probeKey = key;
    const foeCard = skillBook[DESIGN_PROBE_FOE_CARD]?.name ?? DESIGN_PROBE_FOE_CARD;
    const heading = this.add.text(area.x + 12, area.y + 10,
      `PRACTICE FIGHT · ${this.selectedTier.toUpperCase()} · ${DESIGN_PROBE_TURNS} turns vs Training Dummy (${DESIGN_PROBE_FOE_HP.toLocaleString()} HP, ${foeCard})`, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent, wordWrap: { width: area.w - 24 },
      });
    const body: ScrollArea = { x: area.x + 2, y: area.y + 18 + heading.height, w: area.w - 4, h: area.h - 20 - heading.height };
    const entry = probeCache.get(key);
    if (entry === undefined || entry.status === 'pending') {
      this.add.text(body.x + 12, body.y + 8, 'Running the practice fight…', {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textMuted,
      });
      if (entry === undefined) this.time.delayedCall(250, () => this.requestProbe(key, request));
      return;
    }
    if (entry.status === 'error') {
      const message = this.add.text(body.x + 12, body.y + 8,
        `Combat log unavailable: ${entry.message}. The practice fight runs on the battle service (npm run api in development).`, {
          fontFamily: FONT.body, fontSize: `${F.small}px`, color: '#e8907a', wordWrap: { width: body.w - 24 },
        });
      const retryY = message.y + message.height + 10;
      const retry = this.add.rectangle(body.x + 12, retryY, 96, 26, UI.panelAlt, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(body.x + 60, retryY + 13, 'RETRY', {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
      }).setOrigin(0.5);
      retry.on('pointerdown', () => {
        playSfx('uiClick');
        probeCache.delete(key);
        this.rerender();
      });
      return;
    }

    const content = this.add.container(0, 0);
    const turnX = body.x + 12;
    const tagX = turnX + 30;
    const textX = tagX + 56;
    const textWidth = body.x + body.w - textX - 16;
    const rowH = 17;
    const bodyStyle = { fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.text };
    const measureText = this.add.text(-10_000, -10_000, '', bodyStyle).setVisible(false);
    const measure = (text: string): number => { measureText.setText(text); return measureText.width; };
    const iconTile = statusIconTileSize(F.tiny);
    const tipZones: Phaser.GameObjects.Rectangle[] = [];
    let ly = body.y + 8;
    let prevTurn = -1;
    let prevGroup: number | undefined;
    for (const { turn, line } of entry.lines) {
      const iconW = line.chip ? iconTile + 4 : 0;
      const rowWidth = textWidth - iconW;
      const wrapped = wrapBattleLogSegments(line.segments ?? [{ text: line.text, role: 'neutral' }], rowWidth, measure);
      for (const note of line.notes ?? []) wrapped.push(...wrapBattleLogSegments([{ text: note, role: 'note' }], rowWidth, measure));
      if (line.detail) wrapped.push(...wrapBattleLogSegments([{ text: line.detail, role: 'note' }], rowWidth, measure));
      const rowsHeight = wrapped.length * rowH;
      const sameGroup = line.group !== undefined && line.group.id === prevGroup;
      prevGroup = line.group?.id;
      if (line.group) {
        content.add(this.add.rectangle(body.x + 6, ly - 2, body.w - 18, rowsHeight, LOG_GROUP_BAND[line.group.side], 1).setOrigin(0, 0));
        content.add(this.add.rectangle(body.x + 6, ly - 2, 3, rowsHeight, LOG_GROUP_STRIPE[line.group.side], 1).setOrigin(0, 0));
      }
      if (!sameGroup) content.add(this.add.rectangle(body.x + 10, ly - 2, body.w - 26, 1, UI.border, 0.35).setOrigin(0, 0));
      if (turn !== prevTurn) {
        content.add(this.add.text(turnX, ly + 1, `T${turn}`, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textDim,
        }));
      }
      prevTurn = turn;
      content.add(this.add.text(tagX, ly + 1, line.tag, {
        fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: BATTLE_LOG_TAG_COLOR[line.tag] ?? UI.textDim,
      }));
      content.add(drawBattleLogLines(this, textX + iconW, ly, wrapped, bodyStyle, rowH).objects);
      if (line.chip) {
        const icon = createStatusIconChip(this, { ...line.chip, value: undefined }, F.tiny);
        const zone = icon.place(textX, ly, { followTarget: true });
        content.add(icon.container);
        if (zone) {
          content.add(zone);
          tipZones.push(zone);
        }
      }
      ly += rowsHeight;
    }
    measureText.destroy();
    this.wheelScroll(body, content, ly + 8 - body.y, this.logScroll, (current) => {
      this.logScroll = current;
      this.gateToArea(tipZones, body);
    });
  }

  private requestProbe(key: string, request: DesignBattleRequest): void {
    if (probeCache.has(key)) return;
    probeCache.set(key, { status: 'pending' });
    while (probeCache.size > PROBE_CACHE_LIMIT) {
      const oldest = probeCache.keys().next().value;
      if (oldest === undefined) break;
      probeCache.delete(oldest);
    }
    fetchDesignBattle(request)
      .then((log) => { probeCache.set(key, { status: 'ready', lines: probeLines(request, log) }); })
      .catch((err: unknown) => { probeCache.set(key, { status: 'error', message: err instanceof Error ? err.message : String(err) }); })
      .finally(() => {
        if (this.scene.isActive() && !this.closeDropdown && this.previewMode === 'log' && this.probeKey === key) this.rerender();
      });
  }

  private renderProblems(area: ScrollArea, problems: readonly ContentProblem[]): void {
    const pad = 12;
    this.add.rectangle(area.x, area.y, area.w, area.h, UI.panelMuted, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    const content = this.add.container(area.x + pad, area.y + pad);
    const textWidth = area.w - pad * 2 - 8;
    let cy = 0;
    const line = (text: string, size: number, color: string, bold: boolean, gap: number): void => {
      const item = this.add.text(0, cy, text, {
        fontFamily: FONT.body, fontStyle: bold ? 'bold' : 'normal', fontSize: `${size}px`, color,
        wordWrap: { width: textWidth, useAdvancedWrap: true }, lineSpacing: 2,
      });
      content.add(item);
      cy += item.height + gap;
    };
    line('NOT READY TO PREVIEW', F.small, UI.textAccent, true, 8);
    if (this.draft.def.effects.length === 0 && this.draft.def.aura === undefined && this.draft.def.tierUpgrades === undefined) {
      line('Add an effect to start: + ADD DAMAGE, SHIELD or HEAL in the middle column, or a special effect from the list on the left.',
        F.small, UI.textBright, false, 12);
    }
    for (const problem of problems) {
      line(problem.where, F.tiny, UI.textMuted, false, 2);
      line(problem.message, F.small, '#e8907a', false, 10);
    }
    this.wheelScroll({ x: area.x + 2, y: area.y + 2, w: area.w - 4, h: area.h - 4 }, content, cy + pad * 2 - 4,
      this.previewScroll, (current) => { this.previewScroll = current; });
  }

  private renderToast(): void {
    const centerX = SCREEN.width - GUTTER - 200;
    const y = CONTENT_TOP - 20;
    const label = this.add.text(centerX, y, this.toastText, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`,
      color: this.toastGood ? UI.textGem : '#e8907a',
    }).setOrigin(0.5).setDepth(4001);
    const bg = this.add.rectangle(centerX, y, label.width + 24, label.height + 14, UI.panelMuted, 0.94)
      .setOrigin(0.5).setDepth(4000).setStrokeStyle(1, UI.border, 0.8);
    this.tweens.add({
      targets: [label, bg], alpha: 0, delay: 1200, duration: 500,
      onComplete: () => { label.destroy(); bg.destroy(); this.toastText = ''; },
    });
  }
}
