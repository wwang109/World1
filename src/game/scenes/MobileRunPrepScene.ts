import Phaser from 'phaser';
import { applyTier, gemHeroStats, resolveDisplayHeroStats, resolveDisplaySkill } from '../../engine/cards';
import { skillBook } from '../../data/skills';
import type { SkillDef } from '../../engine/types';
import { buildAutoHeroSetup } from '../../run/encounter';
import { setBattleContext } from '../battleContext';
import { MOBILE_PROFILE } from '../layoutProfile';
import { FONT, SCREEN, UI } from '../theme';
import { BoardColumn, type ColumnPiece } from '../ui/BoardColumn';
import { renderRunStatPanel } from '../ui/RunStatPanel';
import { renderRetireConfirm, renderRunHud, snapshotRunProgress } from '../ui/RunProgressStrip';
import { runScreenLayoutRef } from '../ui/runScreenLayout';
import { addHoverTipZone } from '../ui/hoverTip';
import { STAT_LABELS, statHoverEntry } from '../ui/statGlossary';
import { gemStatSuffix, STAT_TOKEN } from '../ui/statLabels';
import { setDeckBuildContext } from '../deckBuildContext';
import { rebuildScene } from '../sceneRebuild';
import {
  currentEncounter, currentNode, enemyNameFor, getActiveRun, retireActiveRun, type RunNodeKind,
} from '../runStore';
import { truncateNameKeepingSuffix } from '../ui/controlLayoutAudit';

const F = MOBILE_PROFILE.font;
const ALL_STAT_ENTRIES = STAT_LABELS.map(statHoverEntry);
// LIVE reference: every `TEMPLATE.*` read below resolves against the
// CURRENT viewport (the canvas fills the window -- see game/viewport.ts).
const TEMPLATE = runScreenLayoutRef('mobile');

const KIND_COLOR: Record<RunNodeKind, number> = {
  fight: 0x4a7ab5, event: UI.chip, shop: UI.good, boss: UI.bad,
};
const KIND_LABEL: Record<RunNodeKind, string> = {
  fight: 'FIGHT', event: 'EVENT', shop: 'SHOP', boss: 'BOSS',
};

/**
 * Mobile Run Prep — the READ-ONLY pre-fight screen reached by picking a
 * fight/elite/boss node: the rolled foe (`currentEncounter`, no dials/foe
 * picker), your run deck (read-only), and a single FIGHT footer button. No
 * ‹ MAP — picking a node is a committed choice. Reachable at ?scene=mrunprep.
 */
export class MobileRunPrepScene extends Phaser.Scene {
  private W = SCREEN.width;
  private H = SCREEN.height;
  private statPanelOpen = false;
  private retireConfirmOpen = false;

  constructor() { super('MobileRunPrep'); }

  init(): void {
    this.statPanelOpen = false;
    this.retireConfirmOpen = false;
  }

  private rerender(): void { rebuildScene(this); }

  create(): void {
    this.W = SCREEN.width; this.H = SCREEN.height;
    this.cameras.main.setBackgroundColor(0x0b1420);

    const run = getActiveRun();
    const node = currentNode();
    const pack = currentEncounter();
    if (!run || !node || !pack) {
      this.scene.start('MobileRunMap');
      return;
    }

    this.renderHud(run, node.kind);
    let boardsTop = this.renderFoeCard(node.kind, pack);
    boardsTop = this.renderHeroBand(run, boardsTop);
    this.renderColumns(run, pack, boardsTop);
    if (this.statPanelOpen) {
      renderRunStatPanel(this, {
        compact: true,
        onCancel: () => { this.statPanelOpen = false; this.rerender(); },
        onConfirm: () => { this.statPanelOpen = false; this.rerender(); },
        onChanged: () => this.rerender(),
      });
    }
    if (this.retireConfirmOpen) {
      // REVIEWED AND LEFT (audit 2026-08): no scene-level generic pointerdown/pointerup listener at all in this file — grep-confirmed.
      // So `renderRetireConfirm`'s rebuild-on-close can never race a
      // stale-vs-fresh scene-level re-dispatch (see
      // `wasPointerConsumedByRebuild`'s doc comment, sceneRebuild.ts) — the
      // mechanism that guard exists for cannot manifest here. No guard
      // needed. (Contrast `MobileRunEventScene`, which DOES have one.)
      renderRetireConfirm(this, {
        compact: true,
        onCancel: () => { this.retireConfirmOpen = false; this.rerender(); },
        onConfirm: () => { retireActiveRun(); this.scene.start('MobileRunMap'); },
      });
    }
  }

  /** THE run HUD — identical header on every run screen; FIGHT is this
   * screen's primary go-forward action, so it sits in the HUD's fixed
   * primary slot (the bottom footer on mobile — thumb-reachable). */
  private renderHud(run: NonNullable<ReturnType<typeof getActiveRun>>, kind: RunNodeKind): void {
    renderRunHud(this, {
      screen: `PREP · ${KIND_LABEL[kind]}`,
      compact: true,
      snapshot: snapshotRunProgress(run),
      onOpenStatPanel: () => { this.statPanelOpen = true; this.rerender(); },
      actions: {
        secondary: { label: 'DECK/BAG', onPress: () => { setDeckBuildContext('run'); this.scene.start('MobileDeckBuild'); } },
        tertiary: { label: 'RETIRE', danger: true, onPress: () => { this.retireConfirmOpen = true; this.rerender(); } },
        primary: { label: 'FIGHT', onPress: () => { setBattleContext('run'); this.scene.start('MobileBattle'); } },
      },
    });
  }

  /** Compact foe summary card; returns the y the board columns start at.
   *
   * PACK FIGHTS: mobile has no room for a full roster list (see the desktop
   * scene's `packMemberLines`), so a pack's title chip becomes a "+N MORE"
   * suffix instead — count + shared level, same idea in less space. */
  private renderFoeCard(kind: RunNodeKind, pack: NonNullable<ReturnType<typeof currentEncounter>>): number {
    const encounter = pack.units[0]!;
    const isPack = pack.variant !== 'solo';
    const y = TEMPLATE.regions.content.y;
    const h = 62;
    const color = KIND_COLOR[kind];
    this.add.rectangle(10, y, this.W - 20, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(2, color, 0.9);
    const name = enemyNameFor(encounter.enemyId);
    const nameSuffix = isPack
      ? `   ·   LV ${encounter.effectiveLevel}   ·   +${pack.units.length - 1} MORE`
      : `   ·   ${encounter.title.toUpperCase()}   ·   LV ${encounter.effectiveLevel}`;
    const nameText = this.add.text(20, y + 8, `${name}${nameSuffix}`, {
      fontSize: `${F.body}px`, color: UI.textBright, fontFamily: FONT.display, fontStyle: 'bold',
    });
    // GUARD CONTRACT: enemy names (and future modifier-bearing titles) can be
    // arbitrarily long; this single Text object has no wordWrap and the card
    // is fixed-height, so an overlong string would otherwise run off the
    // canvas. Truncate ONLY the name with a trailing ellipsis so the
    // " · TITLE · LV n" suffix always stays fully visible. No-op
    // (byte-identical) while the combined string already fits — true for
    // every enemy name in the game today.
    truncateNameKeepingSuffix(nameText, name, nameSuffix, this.W - 40);
    const s = encounter.setup.stats;
    this.add.text(20, y + 26, `${STAT_TOKEN.maxHp} ${s.maxHp} · ${STAT_TOKEN.speed} ${s.speed} · ${STAT_TOKEN.attack} ${s.attack} · ${STAT_TOKEN.magicPower} ${s.magicPower}`, {
      fontSize: `${F.tiny}px`, color: UI.textFootnote, fontFamily: FONT.body, fontStyle: 'bold',
    });
    this.add.text(20, y + 40, `${STAT_TOKEN.armor} ${s.armor} · ${STAT_TOKEN.magicResist} ${s.magicResist} · ${encounter.setup.pieces.length} cards`, {
      fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body,
    });
    addHoverTipZone(this, { x: 10, y: y + 22, w: this.W - 20, h: 32 }, ALL_STAT_ENTRIES);
    return y + h + 8;
  }

  /** Slim hero counterpart to the foe card — SAME stat grammar, so the
   * matchup reads at a glance without a DECK/BAG detour (user ask). */
  private renderHeroBand(run: NonNullable<ReturnType<typeof getActiveRun>>, top: number): number {
    const h = 30;
    this.add.rectangle(10, top, this.W - 20, h, 0x101a2a, 0.94).setOrigin(0, 0).setStrokeStyle(1, UI.border, 0.7);
    const heroSetup = buildAutoHeroSetup(run.heroLevel, run.pieces.map((p) => ({ ...p })), run.heroAllocation).setup;
    // Hero-scope stat gems fold in here too (`resolveDisplayHeroStats`), each
    // bumped stat getting its own "(+N)" attribution (`gemStatSuffix`).
    const s = resolveDisplayHeroStats(heroSetup.stats, heroSetup.pieces);
    const gemAdds = gemHeroStats(heroSetup.pieces);
    this.add.text(20, top + h / 2, `YOU · LV ${run.heroLevel}`, {
      fontSize: `${F.tiny}px`, color: UI.textAccent, fontFamily: FONT.body, fontStyle: 'bold',
    }).setOrigin(0, 0.5);
    this.add.text(this.W - 20, top + h / 2,
      `${STAT_TOKEN.maxHp} ${s.maxHp} · ${STAT_TOKEN.attack} ${s.attack}${gemStatSuffix('attack', gemAdds)} · ${STAT_TOKEN.magicPower} ${s.magicPower}${gemStatSuffix('magicPower', gemAdds)} · ${STAT_TOKEN.armor} ${s.armor}${gemStatSuffix('armor', gemAdds)} · ${STAT_TOKEN.magicResist} ${s.magicResist}${gemStatSuffix('magicResist', gemAdds)} · ${STAT_TOKEN.speed} ${s.speed}${gemStatSuffix('speed', gemAdds)}`, {
        fontSize: `${F.tiny}px`, color: UI.textFootnote, fontFamily: FONT.body, fontStyle: 'bold',
      }).setOrigin(1, 0.5);
    addHoverTipZone(this, { x: 10, y: top, w: this.W - 20, h }, ALL_STAT_ENTRIES);
    return top + h + 8;
  }

  /** PACK FIGHTS: shows the PRIMARY member's board (same "keep it simple"
   * idiom as desktop) with a "(1 OF N)" count note on the column header. */
  private renderColumns(
    run: NonNullable<ReturnType<typeof getActiveRun>>,
    pack: NonNullable<ReturnType<typeof currentEncounter>>,
    top: number,
  ): void {
    const encounter = pack.units[0]!;
    const isPack = pack.variant !== 'solo';
    const footerTop = TEMPLATE.regions.footer.y - 8;
    const colH = footerTop - top;
    const gap = 8;
    const colW = (this.W - 20 - gap) / 2;
    const leftX = 10;
    const rightX = 10 + colW + gap;

    this.add.text(leftX + colW / 2, top - 14, 'YOUR DECK', { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.add.text(rightX + colW / 2, top - 14, `ENEMY SKILLS${isPack ? ` (1 OF ${pack.units.length})` : ''}`, { fontSize: `${F.tiny}px`, color: UI.textMuted, fontFamily: FONT.body, fontStyle: 'bold' }).setOrigin(0.5, 0);

    const heroSkills: SkillDef[] = [];
    const heroPieces: ColumnPiece[] = [];
    for (const p of run.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      // Tier + socketed-gem fold (resolver seam, display-only) so YOUR DECK's
      // face numbers match what the card actually casts — see `resolveDisplaySkill`.
      const skill = resolveDisplaySkill(base, p);
      heroPieces.push({ skill, slot: p.slot });
      heroSkills.push(skill);
    }
    const heroSetup = buildAutoHeroSetup(run.heroLevel, run.pieces.map((p) => ({ ...p })), run.heroAllocation).setup;
    // Hero-scope stat gems fold in here too — see `resolveDisplayHeroStats`.
    const heroStats = resolveDisplayHeroStats(heroSetup.stats, heroSetup.pieces);
    new BoardColumn(this, {
      x: leftX, y: top, width: colW, height: colH, side: 'left',
      pieces: heroPieces, deck: heroSkills, stats: { attack: heroStats.attack, magicPower: heroStats.magicPower, armor: heroStats.armor, magicResist: heroStats.magicResist },
    });

    const foeSkills: SkillDef[] = [];
    const foePieces: ColumnPiece[] = [];
    for (const p of encounter.setup.pieces) {
      const base = skillBook[p.skillId];
      if (!base) continue;
      const skill = p.tier ? applyTier(base, p.tier) : base;
      foePieces.push({ skill, slot: p.slot });
      foeSkills.push(skill);
    }
    const foeStats = encounter.setup.stats;
    new BoardColumn(this, {
      x: rightX, y: top, width: colW, height: colH, side: 'right',
      pieces: foePieces, deck: foeSkills, stats: { attack: foeStats.attack, magicPower: foeStats.magicPower, armor: foeStats.armor, magicResist: foeStats.magicResist },
    });
  }

}
