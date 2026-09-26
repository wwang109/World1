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
import {
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
  effectsAt,
  exportGate,
  exportJsonText,
  resolvedAt,
  setCardField,
  setCardType,
  setEffectField,
  setEffectSelector,
  setTierUpgradeField,
  tierMeter,
  tierConfigurationAt,
  tierIsCustomized,
  toggleArchetype,
  toggleEffectFlag,
  validationProblems,
  hasEffectKind,
  withEffectAdded,
  withEffectRemoved,
  withEffectToggled,
  withStatDebuffAdded,
  type CardDesignerDraft,
  type NonBronzeTier,
} from '../ui/cardDesignerState';

const F = DESKTOP_PROFILE.font;
const TIERS: readonly SkillTier[] = TIER_ORDER;

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
  private jsonExpanded = false;

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
    this.jsonExpanded = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.closeDropdown?.());
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
  }

  private rerender(): void {
    this.closeDropdown?.();
    rebuildScene(this);
  }

  private toast(text: string, good: boolean): void {
    this.toastText = text;
    this.toastGood = good;
    this.rerender();
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
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    const menuLabel = this.add.text(SCREEN.width - GUTTER - menuW / 2, 41, '‹ MENU', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.label}px`, color: UI.textDim,
    }).setOrigin(0.5);
    attachButtonFeel(this, menu, {
      fill: UI.panelAlt, hover: UI.slotHover, follow: [menuLabel],
      sfx: 'uiBack',
      onPress: () => { this.scene.start('Start'); },
    });
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
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
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
      const chip = this.add.rectangle(x, y, chipW, 30, fill, reachable ? (customized ? 1 : 0.72) : 0.3)
        .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, TIER_COLOR[tier], reachable ? (customized ? 1 : 0.65) : 0.25);
      if (reachable) chip.setInteractive({ useHandCursor: true });
      this.add.text(x + 10, y + 6, tier.toUpperCase(), {
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
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8).setInteractive({ useHandCursor: true });
    this.add.text(x + 10, y + 27, this.draft.def.name, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textBright,
    }).setOrigin(0, 0.5);
    this.add.text(x + width - 10, y + 27, `id: ${this.draft.id}`, {
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
        this.draft = { ...this.draft, id: deriveDraftId(name), def: { ...this.draft.def, name } };
        this.draftEdited = true;
        this.rerender();
      });
    });
    return 46;
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
    this.add.text(x + 10, top + 22, `click to add/remove on ${this.selectedTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textMuted,
    });

    const listTop = top + 40;
    const listHeight = height - 48;
    const maskShape = this.make.graphics({}, false).fillStyle(0xffffff).fillRect(x, listTop, width, listHeight);
    const mask = maskShape.createGeometryMask();
    const rowH = 24;
    const list = this.add.container(x, listTop).setMask(mask);
    let scroll = 0;
    const paletteRows: Array<{ heading?: string; kind?: string }> = KEYWORD_KINDS
      .filter((kind) => !COMMON_EFFECT_KINDS.includes(kind))
      .map((kind) => ({ kind }));
    const maxScroll = Math.max(0, paletteRows.length * rowH - listHeight);

    paletteRows.forEach((entry, index) => {
      const rowY = index * rowH;
      if (entry.heading) {
        list.add(this.add.text(8, rowY + 10, entry.heading, {
          fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textAccent,
        }).setOrigin(0, 0.5));
        return;
      }
      const kind = entry.kind!;
      const active = hasEffectKind(this.draft, this.selectedTier, kind);
      const editor = (KEYWORD_EDITOR as Record<string, KeywordEditor>)[kind];
      const row = this.add.rectangle(6, rowY, width - 12, rowH - 4, active ? UI.chip : UI.panelAlt, active ? 1 : 0.9)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5).setInteractive({ useHandCursor: true });
      const label = this.add.text(12, rowY + (rowH - 4) / 2, editor?.label ?? kind, {
        fontFamily: FONT.body, fontStyle: active ? 'bold' : 'normal', fontSize: `${F.tiny}px`, color: active ? UI.textOnChip : UI.textBright,
      }).setOrigin(0, 0.5);
      row.on('pointerover', () => row.setFillStyle(UI.slotHover, 0.9));
      row.on('pointerout', () => row.setFillStyle(active ? UI.chip : UI.panelAlt, active ? 1 : 0.9));
      row.on('pointerdown', () => {
        playSfx('uiClick');
        if (!active) this.formScroll = Number.MAX_SAFE_INTEGER;
        this.updateDraft(withEffectToggled(this.draft, this.selectedTier, kind));
      });
      list.add([row, label]);
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.closeDropdown) return;
      if (pointer.worldX < x || pointer.worldX > x + width || pointer.worldY < listTop || pointer.worldY > listTop + listHeight) return;
      scroll = Phaser.Math.Clamp(scroll + dy, 0, maxScroll);
      list.setY(listTop - scroll);
    });
  }

  // ---------------------------------------------------------------------
  // FORM — current tier's effects + validation messages
  // ---------------------------------------------------------------------

  private updateDraft(next: CardDesignerDraft): void {
    this.draft = next;
    this.draftEdited = true;
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
      y += this.renderStepper(innerX, y, innerW, 'speedWeight', this.draft.def.speedWeight ?? this.draft.def.size * 10,
        CARD_FIELDS.speedWeight.min!, CARD_FIELDS.speedWeight.max!, CARD_FIELDS.speedWeight.step!,
        (v) => this.updateDraft(setCardField(this.draft, 'speedWeight', v)));
      y += this.renderStepper(innerX, y, innerW, 'cooldownTurns', this.draft.def.cooldownTurns ?? CARD_FIELDS.cooldownTurns.default!,
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
      y += this.renderStepper(innerX, y, innerW, `cooldownTurns${override?.cooldownTurns === undefined ? ' (inherited)' : ''}`, cdVal,
        TIER_UPGRADE_FIELDS.cooldownTurns.min!, TIER_UPGRADE_FIELDS.cooldownTurns.max!, TIER_UPGRADE_FIELDS.cooldownTurns.step!,
        (v) => this.updateDraft(setTierUpgradeField(this.draft, tier, 'cooldownTurns', v)));
      const swVal = configuration.speedWeight ?? this.draft.def.size * 10;
      y += this.renderStepper(innerX, y, innerW, `speedWeight${override?.speedWeight === undefined ? ' (inherited)' : ''}`, swVal,
        TIER_UPGRADE_FIELDS.speedWeight.min!, TIER_UPGRADE_FIELDS.speedWeight.max!, TIER_UPGRADE_FIELDS.speedWeight.step!,
        (v) => this.updateDraft(setTierUpgradeField(this.draft, tier, 'speedWeight', v)));
    }

    // ---- effects — generated per-kind fields/selectors/flags (KEYWORD_EDITOR) ----
    y += 6;
    this.add.text(innerX, y, `COMMON EFFECTS — ${this.selectedTier.toUpperCase()}`, {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
    });
    y += 18;

    const effects = effectsAt(this.draft, this.selectedTier);
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
        this.updateDraft(withEffectRemoved(this.draft, this.selectedTier, index));
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
          (next) => this.updateDraft(setEffectField(this.draft, this.selectedTier, index, field.key, next)));
      }
      for (const selector of selectorsFor(effect.kind as Action['kind'], ctx)) {
        const current = typeof effect[selector.key] === 'string' ? (effect[selector.key] as string) : selector.default;
        const optionLabel = selector.key === 'stat' ? statOptionLabel : undefined;
        y += this.renderCycle(innerX + 12, y, innerW - 12, selector.label, current, selector.options,
          (next) => this.updateDraft(setEffectSelector(this.draft, this.selectedTier, index, selector.key, next)), optionLabel);
      }
      for (const flag of editor.flags) {
        const active = effect[flag.key] === true;
        y += this.renderToggle(innerX + 12, y, innerW - 12, `${flag.label}${active ? ' ✓' : ''}`, active,
          () => this.updateDraft(toggleEffectFlag(this.draft, this.selectedTier, index, flag.key)));
      }
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
      if (matches.length === 0) {
        const previewDraft = withEffectAdded(this.draft, this.selectedTier, amount.kind);
        const previewEffects = effectsAt(previewDraft, this.selectedTier);
        const previewEffect = previewEffects[previewEffects.length - 1]!;
        const field = editableFieldsForEffect(previewDraft, this.selectedTier, previewEffect)
          .find((candidate) => candidate.key === amount.key)!;
        y += this.renderStepper(innerX + 12, y, innerW - 12, `${amount.label} (off)`, 0, 0, field.max, field.step, (next) => {
          if (next <= 0) return;
          let draft = withEffectAdded(this.draft, this.selectedTier, amount.kind);
          const index = effectsAt(draft, this.selectedTier).length - 1;
          draft = setEffectField(draft, this.selectedTier, index, amount.key, next);
          this.updateDraft(draft);
        });
      } else {
        matches.forEach(({ effect, index }, duplicateIndex) => {
          const field = editableFieldsForEffect(this.draft, this.selectedTier, effect)
            .find((candidate) => candidate.key === amount.key)!;
          const current = typeof effect[amount.key] === 'number' ? effect[amount.key] as number : field.default;
          const label = matches.length > 1 ? `${amount.label} ${duplicateIndex + 1}` : amount.label;
          const rowY = y;
          y += this.renderStepper(innerX + 12, rowY, innerW - 44, label, current, field.min, field.max, field.step,
            (next) => this.updateDraft(setEffectField(this.draft, this.selectedTier, index, amount.key, next)));
          const remove = this.add.rectangle(innerX + innerW - 24, rowY, 24, 24, UI.panelMuted, 1)
            .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
          this.add.text(innerX + innerW - 12, rowY + 12, '×', {
            fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: '#e8907a',
          }).setOrigin(0.5);
          remove.on('pointerdown', () => {
            playSfx('uiClick');
            this.updateDraft(withEffectRemoved(this.draft, this.selectedTier, index));
          });
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

    // ---- validation messages ----
    this.add.text(innerX, y, 'VALIDATION', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textAccent,
    });
    y += 18;
    const problems = validationProblems(this.draft);
    if (problems.length === 0) {
      const clean = this.add.text(innerX, y, 'schema valid — tier readiness is shown by PL.', {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textGem,
      });
      y += clean.height;
    } else {
      const lines = problems.slice(0, 8).map((p) => `${p.where}: ${p.message}`).join('\n');
      const validation = this.add.text(innerX, y, lines, {
        fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a',
        wordWrap: { width: innerW }, lineSpacing: 4,
      });
      y += validation.height;
    }

    const formChildren = this.children.list.slice(contentStart);
    formLayer.add(formChildren);
    const maskShape = this.make.graphics({}, false).fillStyle(0xffffff).fillRect(x + 2, top + 2, width - 4, bottom - top - 4);
    formLayer.setMask(maskShape.createGeometryMask());
    const maxScroll = Math.max(0, y + 10 - bottom);
    this.formScroll = Phaser.Math.Clamp(this.formScroll, 0, maxScroll);
    this.add.rectangle(x + width - 5, top + 6, 2, bottom - top - 12, UI.border, maxScroll > 0 ? 0.5 : 0).setOrigin(0.5, 0);
    const thumbH = maxScroll > 0 ? Math.max(36, (bottom - top - 12) * ((bottom - top) / (bottom - top + maxScroll))) : 0;
    const scrollThumb = this.add.rectangle(x + width - 5, top + 6, 4, thumbH, UI.chip, maxScroll > 0 ? 0.9 : 0).setOrigin(0.5, 0);
    const updateScroll = (): void => {
      formLayer.setY(-this.formScroll);
      for (const child of formChildren) {
        const object = child as Phaser.GameObjects.Text | Phaser.GameObjects.Rectangle;
        const bounds = object.getBounds();
        const overlaps = bounds.bottom > top + 2 && bounds.top < bottom - 2;
        object.setVisible(overlaps);
        if (object.input) object.input.enabled = overlaps && bounds.top >= top + 2 && bounds.bottom <= bottom - 2;
      }
      if (maxScroll > 0) scrollThumb.setY(top + 6 + (bottom - top - 12 - thumbH) * (this.formScroll / maxScroll));
    };
    updateScroll();
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.closeDropdown) return;
      if (pointer.worldX < x || pointer.worldX > x + width || pointer.worldY < top || pointer.worldY > bottom) return;
      this.formScroll = Phaser.Math.Clamp(this.formScroll + dy, 0, maxScroll);
      updateScroll();
    });
  }

  // ---------------------------------------------------------------------
  // Generic generated controls — stepper (number), cycle (enum), toggle
  // (flag/chip). Each returns the vertical space it consumed so callers
  // stack rows without hand-tracking every control's height twice.
  // ---------------------------------------------------------------------

  private renderStepper(
    x: number, y: number, width: number, label: string, value: number,
    min: number, max: number, step: number, onChange: (next: number) => void,
  ): number {
    const h = 24;
    this.add.text(x, y + h / 2, label, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
    }).setOrigin(0, 0.5);
    const ctrlW = 108;
    const ctrlX = x + width - ctrlW;
    const seg = 24;
    const minus = this.add.rectangle(ctrlX, y, seg, h, UI.panelMuted, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(ctrlX + seg / 2, y + h / 2, '−', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textBright,
    }).setOrigin(0.5);
    this.add.rectangle(ctrlX + seg, y, ctrlW - seg * 2, h, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
    this.add.text(ctrlX + ctrlW / 2, y + h / 2, String(value), {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: UI.textBright,
    }).setOrigin(0.5);
    const plus = this.add.rectangle(ctrlX + ctrlW - seg, y, seg, h, UI.panelMuted, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(ctrlX + ctrlW - seg / 2, y + h / 2, '+', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.small}px`, color: UI.textBright,
    }).setOrigin(0.5);
    minus.on('pointerdown', () => { playSfx('uiClick'); onChange(Math.max(min, value - step)); });
    plus.on('pointerdown', () => { playSfx('uiClick'); onChange(Math.min(max, value + step)); });
    return h + 4;
  }

  private renderCycle(
    x: number, y: number, width: number, label: string, value: string,
    options: readonly string[], onChange: (next: string) => void,
    optionLabel: (value: string) => string = (option) => option,
  ): number {
    const h = 24;
    this.add.text(x, y + h / 2, label, {
      fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: UI.textDim,
    }).setOrigin(0, 0.5);
    const ctrlW = 176;
    const ctrlX = x + width - ctrlW;
    const box = this.add.rectangle(ctrlX, y, ctrlW, h, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6).setInteractive({ useHandCursor: true });
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
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') this.closeDropdown?.();
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(focused); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focused = (focused + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        highlight();
      }
    };
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

    const choose = (index: number): void => {
      const template = filtered[index];
      if (!template) return;
      if (template.id === this.selectedTemplateId) {
        this.closeDropdown?.();
        return;
      }
      if (this.draftEdited && !window.confirm(`Replace the edited draft with ${template.name}?`)) return;
      this.closeDropdown?.();
      this.draft = draftFromTemplate(template.id);
      this.selectedTemplateId = template.id;
      this.selectedTier = this.draft.def.tier;
      this.draftEdited = false;
      this.formScroll = 0;
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
          choose(index);
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
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') this.closeDropdown?.();
      else if (event.key === 'Enter') { event.preventDefault(); choose(focused); }
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
    };
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
    const h = 22;
    const box = this.add.rectangle(x, y, width, h, active ? UI.chip : UI.panelAlt, active ? 1 : 0.7)
      .setOrigin(0, 0).setStrokeStyle(1, active ? UI.chip : UI.border, active ? 1 : 0.5).setInteractive({ useHandCursor: true });
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
    const jsonHeight = this.jsonExpanded ? 118 : 0;
    const gateReasonHeight = gate.ready ? 0 : 28;
    const controlsHeight = 74 + jsonHeight + gateReasonHeight;
    const previewTop = Math.max(y + 8, top + 104);
    const previewHeight = Math.max(260, bottom - previewTop - controlsHeight);
    const problems = validationProblems(this.draft);
    if (problems.length === 0) {
      try {
        const previewSkill = resolvedAt(this.draft, this.selectedTier);
        renderCardDesignerPreview(this, previewSkill, {
          x: x + 8,
          y: previewTop,
          width: width - 16,
          height: previewHeight,
        });
      } catch (err) {
        this.add.text(x + 12, previewTop + 8, `preview unavailable: ${err instanceof Error ? err.message : String(err)}`, {
          fontFamily: FONT.body, fontSize: `${F.tiny}px`, color: '#e8907a', wordWrap: { width: width - 24 },
        });
      }
    } else {
      this.add.rectangle(x + 8, previewTop, width - 16, previewHeight, UI.panelMuted, 0.6).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5);
      this.add.text(x + 20, previewTop + 16, 'Fix the VALIDATION errors on the left to preview the card.', {
        fontFamily: FONT.body, fontSize: `${F.small}px`, color: UI.textMuted, wordWrap: { width: width - 40 },
      });
    }

    const jsonToggleY = previewTop + previewHeight + 8;
    const jsonToggle = this.add.rectangle(x + 8, jsonToggleY, width - 16, 26, UI.panelAlt, 1)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7).setInteractive({ useHandCursor: true });
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

    let buttonsY = jsonToggleY + 34;
    if (this.jsonExpanded) {
      this.add.rectangle(x + 8, buttonsY, width - 16, jsonHeight, UI.panelMuted, 1)
        .setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6);
      const jsonMask = this.make.graphics({}, false).fillStyle(0xffffff).fillRect(x + 8, buttonsY, width - 16, jsonHeight);
      const mask = jsonMask.createGeometryMask();
      this.add.text(x + 16, buttonsY + 6, json, {
        fontFamily: 'Consolas, Menlo, monospace', fontSize: `${F.tiny}px`, color: UI.textDim, lineSpacing: 2,
      }).setOrigin(0, 0).setMask(mask);
      buttonsY += jsonHeight + 8;
    }

    const btnW = (width - 16 - 8) / 2;
    const copyBtn = this.add.rectangle(x + 8, buttonsY, btnW, 30, gate.ready ? UI.chip : UI.panelMuted, gate.ready ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, gate.ready ? 1 : 0.4);
    const copyLabel = this.add.text(x + 8 + btnW / 2, buttonsY + 15, 'COPY JSON', {
      fontFamily: FONT.body, fontStyle: 'bold', fontSize: `${F.tiny}px`, color: gate.ready ? UI.textOnChip : UI.textSoft,
    }).setOrigin(0.5);
    const downloadBtn = this.add.rectangle(x + 8 + btnW + 8, buttonsY, btnW, 30, gate.ready ? UI.chip : UI.panelMuted, gate.ready ? 1 : 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, UI.border, gate.ready ? 1 : 0.4);
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
