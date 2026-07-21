import Phaser from 'phaser';
import { gemPowerLevel, instancePowerLevelDeci, powerLevel } from '../../engine/balance';
import { weightOf, type SkillDef } from '../../engine/types';
import type { BoardPiece, Rarity } from '../../engine/types';
import type { GemDef } from '../../data/gems';
import { ARCHETYPE_ICON, DISPLAY_THEME, ELEMENT_ICON, FONT, GEM_RARITY_COLOR, PROPERTY_LABEL, TIER_COLOR, TYPE_SCALE, UI, WEAPON_ICON } from '../theme';
import { describeAura, isAuraSkill } from './skillPresentation';
import { presentCardActions } from './cardActionPresentation';

interface SkillDetailPanelOptions {
  title?: string;
  fillColor?: number;
  showChrome?: boolean;
  emptyMessage?: string;
}

interface SkillDetailOptions {
  piece?: BoardPiece;
  contextLabel?: string;
}

interface GemDetailOptions {
  hostSkill?: SkillDef;
  piece?: BoardPiece;
}

interface SummaryOptions {
  accentColor?: number;
}

function formatPower(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPowerDeci(value: number): string {
  return formatPower(value / 10);
}

function rarityColor(rarity: Rarity): string {
  return `#${GEM_RARITY_COLOR[rarity].toString(16).padStart(6, '0')}`;
}

function describeGem(gem: GemDef): string {
  if (gem.kind === 'effect') {
    return gem.actions
      .map((action) => {
        switch (action.kind) {
          case 'poison':
            return `poison ${action.stacks} (decays 1/turn)`;
          case 'burn':
            return `burn ${action.stacks} (2×/tick, halves each turn)`;
          case 'stun':
            return `stun for ${action.turns} turn${action.turns === 1 ? '' : 's'}`;
          case 'debuffStat':
          case 'buffStat':
            return `${action.kind === 'buffStat' ? 'buff' : 'debuff'} ${action.stat} ${action.pct}% for ${action.turns} turns`;
          default:
            return action.kind;
        }
      })
      .join(' · ');
  }

  if (gem.scope === 'hero' && gem.mods.hero) {
    return Object.entries(gem.mods.hero)
      .map(([stat, value]) => `${stat} +${value}`)
      .join(' · ');
  }

  if (gem.mods.card) {
    return Object.entries(gem.mods.card)
      .map(([stat, value]) => `${stat} ${value! >= 0 ? '+' : ''}${value}`)
      .join(' · ');
  }

  return 'No modifiers';
}

export class SkillDetailPanel extends Phaser.GameObjects.Container {
  private titleText: Phaser.GameObjects.Text | null;
  private nameText: Phaser.GameObjects.Text;
  private metaText: Phaser.GameObjects.Text;
  private statsText: Phaser.GameObjects.Text;
  private bodyText: Phaser.GameObjects.Text;
  private emptyMessage: string;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    opts: SkillDetailPanelOptions = {},
  ) {
    super(scene, x, y);
    const {
      title = 'SKILL DETAILS',
      fillColor = UI.panel,
      showChrome = true,
      emptyMessage = 'Tap a skill to inspect it.',
    } = opts;
    this.emptyMessage = emptyMessage;

    let contentTop = 0;
    const children: Phaser.GameObjects.GameObject[] = [];
    this.titleText = null;

    if (showChrome) {
      const headerH = DISPLAY_THEME.spacing.panelHeaderH;
      const inset = DISPLAY_THEME.spacing.panelHeaderInset;
      const bg = scene.add.rectangle(0, 0, width, height, fillColor, 0.42).setOrigin(0, 0);
      const line = scene.add.rectangle(0, headerH, width, 1, UI.border, DISPLAY_THEME.chrome.lineAlpha).setOrigin(0, 0);
      this.titleText = scene.add.text(inset, headerH / 2, title, {
        fontSize: TYPE_SCALE.small,
        color: UI.text,
        fontFamily: FONT.body,
        fontStyle: 'bold',
        letterSpacing: 1.2,
      }).setOrigin(0, 0.5);
      children.push(bg, line, this.titleText);
      contentTop = 56;
    }

    this.nameText = scene.add.text(18, contentTop, emptyMessage, {
      fontSize: '18px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
      wordWrap: { width: width - 36 },
    });
    this.metaText = scene.add.text(18, contentTop + 32, '', {
      fontSize: '12px',
      color: UI.textDim,
      fontFamily: FONT.body,
      wordWrap: { width: width - 36 },
    });
    this.statsText = scene.add.text(18, contentTop + 62, '', {
      fontSize: '12px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: width - 36 },
    });
    this.bodyText = scene.add.text(18, contentTop + 92, '', {
      fontSize: '13px',
      color: UI.text,
      fontFamily: FONT.body,
      wordWrap: { width: width - 36 },
      lineSpacing: 4,
    });
    children.push(this.nameText, this.metaText, this.statsText, this.bodyText);

    this.add(children);
    this.setSize(width, height);
    scene.add.existing(this);
  }

  setTitle(title: string): void {
    this.titleText?.setText(title);
  }

  clear(message = this.emptyMessage): void {
    this.setTitle('SKILL DETAILS');
    this.nameText.setText(message);
    this.nameText.setColor(UI.text);
    this.metaText.setText('');
    this.statsText.setText('');
    this.bodyText.setText('');
  }

  setSummary(title: string, headline: string, meta: string, stats: string, body: string, opts: SummaryOptions = {}): void {
    this.setTitle(title);
    this.nameText.setText(headline);
    this.nameText.setColor(UI.text);
    this.metaText.setText(meta);
    this.metaText.setColor(opts.accentColor ? `#${opts.accentColor.toString(16).padStart(6, '0')}` : UI.textDim);
    this.statsText.setText(stats);
    this.bodyText.setText(body);
  }

  setSkill(skill: SkillDef, opts: SkillDetailOptions = {}): void {
    this.setTitle('SKILL DETAILS');
    const kind = skill.element ? `${ELEMENT_ICON[skill.element]} ${skill.element}` : skill.weapon ? `${WEAPON_ICON[skill.weapon]} ${skill.weapon}` : 'neutral';
    const archetypes = skill.archetypes.map((a) => `${ARCHETYPE_ICON[a]} ${a}`).join('  ');
    const totalPl = opts.piece ? formatPowerDeci(instancePowerLevelDeci(skill, opts.piece)) : formatPower(powerLevel(skill));
    const socketLine = opts.piece?.gem
      ? `Socket: ${(opts.piece.gem as GemDef).name} · +${formatPower(gemPowerLevel(opts.piece.gem))} PL`
      : 'Socket: empty';
    const context = opts.contextLabel ? `${opts.contextLabel} · ` : '';
    const aura = describeAura(skill);
    const role = isAuraSkill(skill) ? 'AURA · ' : '';
    const actions = presentCardActions(skill)
      .map((action) => `${action.verb}: ${action.effect}`)
      .join(' · ');

    this.nameText.setText(skill.name);
    this.metaText.setText(`${context}${skill.tier.toUpperCase()} · PL${totalPl} · ${archetypes}`);
    this.metaText.setColor(`#${TIER_COLOR[skill.tier].toString(16).padStart(6, '0')}`);
    this.statsText.setText(`${role}${PROPERTY_LABEL[skill.property]} · ${kind} · size ${skill.size} · weight ${weightOf(skill)}${skill.size > 1 ? ` · spans ${skill.size} turns` : ''}`);
    this.bodyText.setText([actions, aura ? `Aura: ${aura}` : '', socketLine].filter(Boolean).join('\n'));
  }

  setGem(gem: GemDef, opts: GemDetailOptions = {}): void {
    this.setTitle('SKILL DETAILS');
    const total = opts.hostSkill && opts.piece ? ` · host total PL ${formatPowerDeci(instancePowerLevelDeci(opts.hostSkill, opts.piece))}` : '';
    const host = opts.hostSkill ? `Socketed in ${opts.hostSkill.name}` : gem.kind === 'stat' ? `${gem.scope === 'hero' ? 'Hero' : 'Card'} modifier` : 'Effect rider';

    this.nameText.setText(gem.name);
    this.metaText.setText(`${gem.rarity.toUpperCase()} GEM · +${formatPower(gemPowerLevel(gem))} PL${total}`);
    this.metaText.setColor(rarityColor(gem.rarity));
    this.statsText.setText(`${host} · ${describeGem(gem)}`);
    this.bodyText.setText(gem.text);
  }
}
