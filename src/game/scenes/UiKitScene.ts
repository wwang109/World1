import Phaser from 'phaser';
import { playSfx } from '../audio/sfxSynth';
import { gemPowerLevel, powerLevel } from '../../engine/balance';
import { skillBook } from '../../data/skills';
import { gemBook, type GemDef } from '../../data/gems';
import {
  ARCHETYPE_COLOR,
  FONT,
  GEM_RARITY_COLOR,
  PROPERTY_COLOR,
  SCREEN,
  TIER_COLOR,
  UI,
} from '../theme';
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';
import { CardToken } from '../ui/CardToken';
import { BoardColumn } from '../ui/BoardColumn';
import { templateBadgeTextureKey } from '../ui/cardArtPresentation';
import type { SkillDef } from '../../engine/types';

type KitTab = 'system' | 'card' | 'tokens' | 'gem-a' | 'gem-b' | 'gem-c';

const TABS: Array<{ key: KitTab; label: string }> = [
  { key: 'system', label: 'SYSTEM' },
  { key: 'card', label: 'CARD & BADGES' },
  { key: 'tokens', label: 'CARD TOKENS' },
  { key: 'gem-a', label: 'GEM A' },
  { key: 'gem-b', label: 'GEM B' },
  { key: 'gem-c', label: 'GEM C' },
];

/**
 * Dev-only UI/UX library ("storybook") page: renders the design system's
 * colors, type, controls, badges, and card template — plus proposed layout
 * mockups (currently the three gem-picker candidates) as real screens.
 * Launch with `?view=uikit`. Nothing here mutates game state.
 */
export class UiKitScene extends Phaser.Scene {
  private tab: KitTab = 'system';
  private items: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('UiKit');
  }

  init(): void {
    this.items = [];
    this.tab = 'system';
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.bg);
    this.renderAll();
  }

  private keep<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.items.push(obj);
    return obj;
  }

  private renderAll(): void {
    for (const obj of this.items) obj.destroy();
    this.items = [];

    this.keep(this.add.text(SCREEN.safeX, 24, 'UI / UX LIBRARY', {
      fontSize: '26px',
      color: UI.text,
      fontFamily: FONT.display,
      fontStyle: 'bold',
    }));
    this.keep(this.add.text(SCREEN.safeX, 58, 'Dev view · design system reference & layout proposals · ?view=uikit', {
      fontSize: '11px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }));

    let tx = SCREEN.safeX;
    for (const { key, label } of TABS) {
      const active = key === this.tab;
      const w = 24 + label.length * 7;
      const chip = this.keep(this.add.rectangle(tx, 86, w, 30, active ? UI.chipDark : UI.panelMuted).setOrigin(0, 0));
      chip.setStrokeStyle(1, UI.border, active ? 1 : 0.6).setInteractive({ useHandCursor: true });
      chip.on('pointerdown', () => {
        playSfx('uiClick');
        this.tab = key;
        this.renderAll();
      });
      this.keep(this.add.text(tx + w / 2, 101, label, {
        fontSize: '10px',
        color: active ? '#ffffff' : UI.textDim,
        fontFamily: FONT.body,
        fontStyle: 'bold',
      }).setOrigin(0.5));
      tx += w + 8;
    }

    const top = 136;
    if (this.tab === 'system') this.renderSystem(top);
    else if (this.tab === 'card') this.renderCard(top);
    else if (this.tab === 'tokens') this.renderTokens(top);
    else this.renderGemPicker(this.tab, top);
  }

  /**
   * The shared mobile CardToken rendered from REAL skillBook data — two
   * mirrored columns (deck left / opponent right), the affinity + identity
   * "n/3" sub-line, per-type accent color and card art. Nothing hand-typed;
   * change skills.ts / theme.ts and this updates.
   */
  private renderTokens(top: number): void {
    const left = ['sword_slash', 'war_banner', 'iron_bulwark', 'second_wind', 'crushing_blow']
      .map((id) => skillBook[id]).filter((s): s is NonNullable<typeof s> => Boolean(s));
    const right = ['savage_bite', 'hunter_shot', 'armor_break', 'crippling_strike', 'fireball']
      .map((id) => skillBook[id]).filter((s): s is NonNullable<typeof s> => Boolean(s));

    const colW = 232;
    const gap = 24;
    const x0 = SCREEN.safeX;
    const rowH = 66;
    const label = (x: number, t: string): void => {
      this.keep(this.add.text(x + colW / 2, top, t, { fontSize: '11px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0));
    };
    label(x0, 'YOUR DECK · number top-right');
    label(x0 + colW + gap, 'OPPONENT · number top-left');

    // Both columns are just BoardColumn — the same helper the real screens use.
    const toPieces = (skills: SkillDef[]): { skill: SkillDef; slot: number; state?: 'none' | 'cursor' }[] => {
      const pieces: { skill: SkillDef; slot: number; state?: 'none' | 'cursor' }[] = [];
      let slot = 0;
      for (let i = 0; i < skills.length; i++) {
        pieces.push({ skill: skills[i]!, slot, state: i === 0 ? 'cursor' : 'none' });
        slot += Math.max(1, skills[i]!.size);
      }
      return pieces;
    };
    const colY = top + 24;
    const colH = rowH * 10 + 6 * 9;
    for (const t of new BoardColumn(this, { x: x0, y: colY, width: colW, height: colH, side: 'left', pieces: toPieces(left), deck: left }).tokens) this.keep(t);
    for (const t of new BoardColumn(this, { x: x0 + colW + gap, y: colY, width: colW, height: colH, side: 'right', pieces: toPieces(right), deck: right }).tokens) this.keep(t);
  }

  // ---------- shared little builders ----------

  private sectionLabel(y: number, label: string): number {
    this.keep(this.add.text(SCREEN.safeX, y, label, {
      fontSize: '13px',
      color: UI.text,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }));
    this.keep(this.add.rectangle(SCREEN.safeX, y + 20, SCREEN.width - SCREEN.safeX * 2, 1, UI.border, 0.4).setOrigin(0, 0));
    return y + 30;
  }

  private swatchRow(y: number, entries: Array<[string, number]>): number {
    let x = SCREEN.safeX;
    for (const [label, color] of entries) {
      this.keep(this.add.rectangle(x, y, 40, 28, color).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.5));
      this.keep(this.add.text(x + 20, y + 32, label, {
        fontSize: '8px',
        color: UI.textDim,
        fontFamily: FONT.body,
      }).setOrigin(0.5, 0));
      x += 54;
    }
    return y + 54;
  }

  private button(x: number, y: number, w: number, h: number, label: string, fill: number, color: string): void {
    this.keep(this.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.8));
    this.keep(this.add.text(x + w / 2, y + h / 2, label, {
      fontSize: '11px',
      color,
      fontFamily: FONT.body,
      fontStyle: 'bold',
    }).setOrigin(0.5));
  }

  private badgeSample(x: number, y: number, iconKey: string, label: string): void {
    const key = templateBadgeTextureKey(iconKey as never);
    if (key && this.textures.exists(key)) {
      this.keep(this.add.image(x + 20, y + 20, key).setDisplaySize(40, 40));
    } else {
      this.keep(this.add.circle(x + 20, y + 20, 18, 0x10151d).setStrokeStyle(1, UI.border));
    }
    this.keep(this.add.text(x + 20, y + 44, label, {
      fontSize: '8px',
      color: UI.textDim,
      fontFamily: FONT.body,
    }).setOrigin(0.5, 0));
  }

  // ---------- tabs ----------

  private renderSystem(top: number): void {
    let y = this.sectionLabel(top, 'PALETTE — surfaces & semantics');
    y = this.swatchRow(y, [
      ['bg', UI.bg], ['panel', UI.panel], ['panelAlt', UI.panelAlt], ['muted', UI.panelMuted],
      ['slot', UI.slot], ['chip', UI.chip], ['chipDark', UI.chipDark], ['border', UI.border],
      ['good', UI.good], ['bad', UI.bad], ['shield', UI.shield],
    ]);
    y = this.swatchRow(y, [
      ['bronze', TIER_COLOR.bronze], ['silver', TIER_COLOR.silver], ['gold', TIER_COLOR.gold], ['diamond', TIER_COLOR.diamond],
      ['phys', PROPERTY_COLOR.physical], ['mag', PROPERTY_COLOR.magical], ['true', PROPERTY_COLOR.true],
      ['off', ARCHETYPE_COLOR.offense], ['def', ARCHETYPE_COLOR.defensive], ['heal', ARCHETYPE_COLOR.healing],
      ['supp', ARCHETYPE_COLOR.support], ['debuff', ARCHETYPE_COLOR.debuff],
    ]);

    y = this.sectionLabel(y + 8, 'TYPE SCALE');
    const samples: Array<[string, string, string]> = [
      ['26px display bold', FONT.display, '26px'],
      ['18px display bold — panel titles', FONT.display, '18px'],
      ['13px body bold — section labels', FONT.body, '13px'],
      ['11px body — controls & copy', FONT.body, '11px'],
      ['9px body bold — chips & metadata', FONT.body, '9px'],
    ];
    for (const [label, family, size] of samples) {
      this.keep(this.add.text(SCREEN.safeX, y, label, {
        fontSize: size,
        color: UI.text,
        fontFamily: family,
        fontStyle: 'bold',
      }));
      y += parseInt(size, 10) + 14;
    }

    y = this.sectionLabel(y + 8, 'CONTROLS');
    this.button(SCREEN.safeX, y, 160, 40, 'PRIMARY', UI.chipDark, '#ffffff');
    this.button(SCREEN.safeX + 172, y, 160, 40, 'SECONDARY', UI.panelMuted, UI.text);
    this.button(SCREEN.safeX + 344, y, 160, 40, 'DANGER', UI.badSoft ?? UI.bad, UI.text);
    y += 56;
    this.button(SCREEN.safeX, y, 32, 28, '−', UI.panelMuted, UI.text);
    this.keep(this.add.rectangle(SCREEN.safeX + 36, y, 48, 28, UI.panel).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7));
    this.keep(this.add.text(SCREEN.safeX + 60, y + 14, '3', {
      fontSize: '12px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0.5));
    this.button(SCREEN.safeX + 88, y, 32, 28, '+', UI.panelMuted, UI.text);
    this.keep(this.add.text(SCREEN.safeX + 140, y + 14, 'stepper', {
      fontSize: '9px', color: UI.textDim, fontFamily: FONT.body,
    }).setOrigin(0, 0.5));
  }

  private renderCard(top: number): void {
    let y = this.sectionLabel(top, 'FULL-ART CARD TEMPLATE (V2, scale 0.62)');
    const skill = skillBook.fireball!;
    this.keep(new FantasyCardTemplateV2(this, SCREEN.safeX + 130, y + 214, skill, {
      width: 260,
      height: 428,
      tier: 'bronze',
      glossary: false,
    }));

    const bx = SCREEN.safeX + 300;
    this.keep(this.add.text(bx, y, 'WEAPON BADGES (hex)', {
      fontSize: '10px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
    }));
    ['sword', 'axe', 'lance', 'bow', 'fangs'].forEach((k, i) => this.badgeSample(bx + i * 62, y + 16, k, k));
    this.keep(this.add.text(bx, y + 84, 'ELEMENT BADGES (orbs)', {
      fontSize: '10px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
    }));
    ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'].forEach((k, i) => this.badgeSample(bx + i * 62, y + 100, k, k));
    this.keep(this.add.text(bx, y + 168, 'ARCHETYPE BADGES (octagon)', {
      fontSize: '10px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
    }));
    ['offense', 'defensive', 'healing', 'support', 'debuff'].forEach((k, i) => this.badgeSample(bx + i * 62, y + 184, k, k));

    y += 452;
    y = this.sectionLabel(y, 'NOTES');
    this.keep(this.add.text(SCREEN.safeX, y, [
      'Card geometry: docs/card-template-spec.md (regions, no-nudging contract).',
      'Badges carry their own plate shape; the template draws no chrome behind them.',
      'Tier shows in: trim line, footer diamond, divider color.',
    ].join('\n'), {
      fontSize: '11px', color: UI.textDim, fontFamily: FONT.body, lineSpacing: 6,
    }));
  }

  // ---------- gem picker mockups (static, real gem data) ----------

  private gems(): GemDef[] {
    return Object.values(gemBook);
  }

  private gemRowCore(x: number, y: number, gem: GemDef, w: number): void {
    this.keep(this.add.rectangle(x + 12, y + 12, 12, 12, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0, 0));
    this.keep(this.add.text(x + 32, y + 8, gem.name, {
      fontSize: '12px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
    }));
    this.keep(this.add.text(x + w - 12, y + 8, `+${gemPowerLevel(gem)} PL`, {
      fontSize: '11px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(1, 0));
    this.keep(this.add.text(x + 32, y + 26, `${gem.rarity.toUpperCase()} · ${gem.kind === 'stat' ? `${gem.scope} mod` : 'effect rider'}`, {
      fontSize: '9px', color: UI.textDim, fontFamily: FONT.body,
    }));
  }

  private renderGemPicker(tab: KitTab, top: number): void {
    const titles: Record<string, string> = {
      'gem-a': 'GEM PICKER A — grid + detail pane (tap to select, SOCKET to confirm)',
      'gem-b': 'GEM PICKER B — tall list, effect text inline (tap row sockets)',
      'gem-c': 'GEM PICKER C — master list + always-visible detail',
    };
    const y0 = this.sectionLabel(top, titles[tab]!);
    const gems = this.gems();
    const selected = gems.find((g) => g.kind === 'effect') ?? gems[0]!;
    const host = skillBook.venom_fang!;
    const hostPl = powerLevel(host);
    const px = SCREEN.safeX;
    const pw = SCREEN.width - SCREEN.safeX * 2;

    // shared modal shell
    this.keep(this.add.rectangle(px, y0, pw, 940, UI.panel).setOrigin(0, 0).setStrokeStyle(1.75, UI.border));
    this.keep(this.add.rectangle(px + 16, y0 + 14, 190, 30, UI.chipDark).setOrigin(0, 0));
    this.keep(this.add.text(px + 30, y0 + 22, 'SOCKET GEM', {
      fontSize: '14px', color: '#ffffff', fontFamily: FONT.body, fontStyle: 'bold',
    }));
    this.keep(this.add.text(px + 16, y0 + 56, `${host.name} · socket empty`, {
      fontSize: '12px', color: UI.textDim, fontFamily: FONT.body,
    }));
    const bodyY = y0 + 84;

    if (tab === 'gem-a') {
      gems.slice(0, 8).forEach((gem, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = px + 16 + col * ((pw - 44) / 2 + 12);
        const y = bodyY + row * 62;
        const w = (pw - 44) / 2;
        const active = gem.id === selected.id;
        this.keep(this.add.rectangle(x, y, w, 52, active ? UI.panelAlt : UI.panelMuted)
          .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, active ? UI.chip : UI.border, active ? 1 : 0.6));
        this.gemRowCore(x, y, gem, w);
      });
      const dy = bodyY + 4 * 62 + 16;
      this.keep(this.add.rectangle(px + 16, dy, pw - 32, 190, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(1.5, UI.chip, 0.9));
      this.keep(this.add.text(px + 32, dy + 14, `SELECTED · ${selected.name.toUpperCase()}`, {
        fontSize: '12px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
      }));
      this.keep(this.add.text(px + 32, dy + 38, `${selected.rarity.toUpperCase()} · ${selected.kind === 'stat' ? 'stat mod' : 'effect rider'} · +${gemPowerLevel(selected)} gem PL`, {
        fontSize: '10px', color: `#${GEM_RARITY_COLOR[selected.rarity].toString(16).padStart(6, '0')}`, fontFamily: FONT.body, fontStyle: 'bold',
      }));
      this.keep(this.add.text(px + 32, dy + 60, selected.text, {
        fontSize: '12px', color: UI.text, fontFamily: FONT.body, wordWrap: { width: pw - 80 },
      }));
      this.keep(this.add.text(px + 32, dy + 108, `${host.name}: PL ${hostPl} → ${hostPl + gemPowerLevel(selected)}`, {
        fontSize: '12px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold',
      }));
      this.button(px + pw / 2 - 110, dy + 136, 220, 40, `SOCKET ${selected.name.toUpperCase()}`, UI.chipDark, '#ffffff');
    }

    if (tab === 'gem-b') {
      gems.slice(0, 8).forEach((gem, index) => {
        const y = bodyY + index * 96;
        this.keep(this.add.rectangle(px + 16, y, pw - 32, 86, UI.panelMuted).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.6));
        this.gemRowCore(px + 16, y, gem, pw - 32);
        this.keep(this.add.text(px + 48, y + 44, gem.text, {
          fontSize: '11px', color: UI.text, fontFamily: FONT.body, wordWrap: { width: pw - 96 }, maxLines: 2,
        }));
      });
      this.keep(this.add.text(px + pw / 2, bodyY + 8 * 96 + 10, `▼ ${Math.max(0, gems.length - 8)} more (scroll)`, {
        fontSize: '10px', color: UI.textDim, fontFamily: FONT.body,
      }).setOrigin(0.5, 0));
    }

    if (tab === 'gem-c') {
      const listW = 250;
      gems.forEach((gem, index) => {
        const y = bodyY + index * 56;
        const active = gem.id === selected.id;
        this.keep(this.add.rectangle(px + 16, y, listW, 48, active ? UI.panelAlt : UI.panelMuted)
          .setOrigin(0, 0).setStrokeStyle(active ? 2 : 1, active ? UI.chip : UI.border, active ? 1 : 0.55));
        this.keep(this.add.rectangle(px + 26, y + 10, 10, 10, GEM_RARITY_COLOR[gem.rarity]).setOrigin(0, 0));
        this.keep(this.add.text(px + 44, y + 7, gem.name, {
          fontSize: '11px', color: UI.text, fontFamily: FONT.body, fontStyle: 'bold',
        }));
        this.keep(this.add.text(px + 44, y + 26, `+${gemPowerLevel(gem)} PL`, {
          fontSize: '9px', color: UI.textDim, fontFamily: FONT.body,
        }));
      });
      const dx = px + 16 + listW + 14;
      const dw = pw - 32 - listW - 14;
      this.keep(this.add.rectangle(dx, bodyY, dw, 420, UI.panelAlt).setOrigin(0, 0).setStrokeStyle(1.5, UI.chip, 0.9));
      this.keep(this.add.text(dx + 18, bodyY + 16, selected.name.toUpperCase(), {
        fontSize: '15px', color: UI.text, fontFamily: FONT.display, fontStyle: 'bold',
      }));
      this.keep(this.add.text(dx + 18, bodyY + 44, `${selected.rarity.toUpperCase()} · ${selected.kind === 'stat' ? 'stat mod' : 'effect rider'} · +${gemPowerLevel(selected)} gem PL`, {
        fontSize: '10px', color: `#${GEM_RARITY_COLOR[selected.rarity].toString(16).padStart(6, '0')}`, fontFamily: FONT.body, fontStyle: 'bold',
      }));
      this.keep(this.add.text(dx + 18, bodyY + 72, selected.text, {
        fontSize: '12px', color: UI.text, fontFamily: FONT.body, wordWrap: { width: dw - 36 }, lineSpacing: 4,
      }));
      this.keep(this.add.text(dx + 18, bodyY + 180, `${host.name}\nPL ${hostPl} → ${hostPl + gemPowerLevel(selected)}`, {
        fontSize: '12px', color: UI.textDim, fontFamily: FONT.body, fontStyle: 'bold', lineSpacing: 4,
      }));
      this.button(dx + 18, bodyY + 250, dw - 36, 40, 'SOCKET GEM', UI.chipDark, '#ffffff');
      this.button(dx + 18, bodyY + 300, dw - 36, 34, 'REMOVE CURRENT GEM', UI.panelMuted, UI.text);
    }
  }
}
