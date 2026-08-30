import { describe, expect, it } from 'vitest';
import {
  DESKTOP_HP_BLOCK, MOBILE_HP_BLOCK, HP_BLOCK_LINE_BOX, STATUS_ROW_KEYS,
  desktopHpBlockLayout, mobileHpBlockLayout,
  legacyDesktopHpBlockLayout, legacyMobileHpBlockLayout,
  overlappingHpBlockLabels, statusLabelsOverBar,
  type DesktopHpBlockInput, type HpBlockGeometry, type HpBlockLabel,
  type MobileHpBlockInput,
} from '../../src/game/ui/battleHpBlockLayout';
import { DESKTOP_PROFILE, MOBILE_PROFILE } from '../../src/game/layoutProfile';

/**
 * BATTLE PANEL OVERLAP AUDIT — two drawn texts may never occupy the same box,
 * and no status label may be drawn across the HP bar, on EITHER platform.
 *
 * THE TWO SHIPPED BUGS THIS EXISTS TO CATCH (both found 2026-08-30, by two
 * independent audits, in one session):
 *
 *   DESKTOP. `DesktopBattleScene.hpBar` drew its EXPOSE/GUARD badges at
 *   `barY + 20` = `panelY + 46`. `DesktopBattleScene.render`, two hundred
 *   lines away, drew the full statline at `contentTop + 46` — the same y, the
 *   same x, the same panel. `"EXPOSE +50%"` rendered on top of
 *   `"ATK 1 · MATK 1 · DEF 1 · MDEF 1 · SPD 10"`, on the hero AND the foe
 *   panel, on every enemy, whenever a status stood. On screen it read
 *   `GUARD 20%PTK 1 · DEF 1 · …`.
 *
 *   MOBILE. `MobileBattleScene.hpBar` chained shield/expose/guard LEFTWARD
 *   from the screen edge along the head row, with nothing stopping the chain
 *   at the bar: `+100 (54 P · 46 M)` spanned 270..363 across a bar spanning
 *   120..328, and with all three standing the chain reached x≈121 and buried
 *   the bar completely.
 *
 * WHY BOTH SURVIVED. `ruleClearanceAudit.test.ts` (2026-08-28) closed exactly
 * this hole for a drawn RULE crossing a label. Nothing closed it for a LABEL
 * crossing a label — the suite could see that regions did not overlap and that
 * labels fit inside their own buttons, and neither of those can see two texts
 * at one coordinate. This is that audit's twin.
 *
 * HOW IT CHECKS. Same stance as `ruleClearanceAudit` and `controlLayoutAudit`:
 * drive the REAL placement from Node. `battleHpBlockLayout.ts` IS the placement
 * both scenes now use — the scenes create their texts unplaced, hand the layout
 * their measured widths, and draw exactly what comes back — so this is the
 * shipping arithmetic, not a retyped copy of it. Text width is modelled as
 * `chars × fontSize × TEXT_PX_PER_CHAR` with a deliberately GENEROUS ratio, and
 * the line box with the module's own generous `HP_BLOCK_LINE_BOX`, so every
 * modelled box is BIGGER than the real glyphs — the audit can only ever be
 * stricter than the screen, never looser. The pixel-exact side is covered by
 * the 1440x900 / 412x892 crops in `scratchpad/battleaudit/`.
 *
 * THE TEETH are at the bottom: the same predicates asked about the PRE-FIX
 * geometry, which both `battleHpBlockLayout.ts` still exports for the purpose.
 * If those two ever go quiet, this audit has stopped being able to see the
 * defect it was written for.
 */

/** Advance width per character / font size, for the bold body face. Generous
 * (real bold uppercase measures ≈0.55–0.62 at these sizes). */
const TEXT_PX_PER_CHAR = 0.62;

function label(text: string, fontSize: number): HpBlockLabel {
  return { text, width: text.length * fontSize * TEXT_PX_PER_CHAR, fontSize };
}

// ---------------------------------------------------------------------------
// The state matrix — every combination of status a block can be asked to draw,
// against the widest realistic content for each label.
// ---------------------------------------------------------------------------

/** Longest names shipped (`enemies.v1.json`) plus headroom. */
const NAMES = ['HERO', 'THE HOLLOW CROWN', 'THORNPIKE MARSHAL', 'THE WARDED SENTINEL'];
/** `hp/max` at run scale, up to five digits a side. */
const HP_TEXTS = ['100/100', '78/110', '1240/1580', '12000/18000'];
/** `+N` and the stacked-pool break-out (`shieldPoolsLabel`). */
const SHIELDS = [undefined, '+48', '+100 (54 P · 46 M)', '+312 (120 P · 96 M · 96 T)'];
/** `EXPOSE +N%` — the effective amplification. */
const EXPOSES = [undefined, 'EXPOSE +40%', 'EXPOSE +150%'];
/** `formatGuardBadge` output: one `pct%LETTER` token per mitigated property. */
const GUARDS = [undefined, 'GUARD 20%P', 'GUARD 75%P 40%M'];
/** Statlines are generated from one template — the widest is all-two-digit. */
const STAT_LINES = [
  'ATK 1 · MATK 1 · DEF 1 · MDEF 1 · SPD 10',
  'ATK 24 · MATK 31 · DEF 18 · MDEF 12 · SPD 14',
];
/** Ailment pips crowd the desktop stat row from the right (max = the palette). */
const PIP_COUNTS = [0, 1, 3, 6];

interface State {
  name: string;
  hp: string;
  statLine: string;
  shield?: string;
  expose?: string;
  guard?: string;
  pips: number;
}

function states(): State[] {
  const out: State[] = [];
  for (const shield of SHIELDS) {
    for (const expose of EXPOSES) {
      for (const guard of GUARDS) {
        for (let i = 0; i < NAMES.length; i++) {
          out.push({
            name: NAMES[i]!,
            hp: HP_TEXTS[i]!,
            statLine: STAT_LINES[i % STAT_LINES.length]!,
            shield, expose, guard,
            pips: PIP_COUNTS[i % PIP_COUNTS.length]!,
          });
        }
      }
    }
  }
  return out;
}

function describeState(s: State): string {
  return [
    s.name,
    s.shield ? 'shield' : '—',
    s.expose ? 'expose' : '—',
    s.guard ? 'guard' : '—',
    `${s.pips} pips`,
  ].join(' / ');
}

// ---------------------------------------------------------------------------
// Platform inputs — the exact numbers the two scenes pass.
// ---------------------------------------------------------------------------

const DF = DESKTOP_PROFILE.font;
const MF = MOBILE_PROFILE.font;

/** `DesktopBattleScene`: GUTTER 32, PANEL_W 380, hero panel at the content top. */
const DESKTOP_PANELS = [
  { panelX: 32, panelY: 84, panelW: 380 },   // hero
  { panelX: 1028, panelY: 84, panelW: 380 }, // foe 0
  { panelX: 1028, panelY: 438, panelW: 380 },// foe 1 (two-foe split)
  { panelX: 1028, panelY: 136, panelW: 380 },// focused foe under the 3+ tab strip
];

function desktopInput(s: State, panel: { panelX: number; panelY: number; panelW: number }): DesktopHpBlockInput {
  return {
    ...panel,
    name: label(s.name, DF.name),
    hp: label(s.hp, DF.name),
    statLine: label(s.statLine, DF.small),
    shield: s.shield ? label(s.shield, DF.tiny) : undefined,
    expose: s.expose ? label(s.expose, DF.tiny) : undefined,
    guard: s.guard ? label(s.guard, DF.tiny) : undefined,
    ailmentPips: s.pips,
  };
}

/** `MobileBattleScene`: hero strip then one per foe, `rowHeight` apart. */
const MOBILE_ROWS = [192, 192 + MOBILE_HP_BLOCK.rowHeight, 192 + MOBILE_HP_BLOCK.rowHeight * 2];
const MOBILE_WIDTHS = [MOBILE_PROFILE.canvas.width, 640];

function mobileInput(s: State, screenW: number, rowY: number): MobileHpBlockInput {
  return {
    screenW, rowY,
    name: label(s.name, MF.body),
    hp: label(s.hp, MF.body),
    statLine: label(s.statLine, MF.tiny),
    shield: s.shield ? label(s.shield, MF.label) : undefined,
    expose: s.expose ? label(s.expose, MF.tiny) : undefined,
    guard: s.guard ? label(s.guard, MF.tiny) : undefined,
  };
}

function offenders(geo: HpBlockGeometry): string[] {
  return [
    ...overlappingHpBlockLabels(geo.labels).map((o) => `${o.a} over ${o.b} (${o.area.toFixed(1)}px²)`),
    ...statusLabelsOverBar(geo).map((o) => `${o.a} over the HP BAR (${o.area.toFixed(1)}px²)`),
  ];
}

// ---------------------------------------------------------------------------
// 1. THE INVARIANT, on both platforms, over the whole matrix.
// ---------------------------------------------------------------------------

describe('battle HP block: no two labels share a box, and no status label crosses the bar', () => {
  it(`desktop: ${states().length * DESKTOP_PANELS.length} block states draw clean`, () => {
    const failures: string[] = [];
    for (const s of states()) {
      for (const panel of DESKTOP_PANELS) {
        const found = offenders(desktopHpBlockLayout(desktopInput(s, panel)));
        if (found.length) failures.push(`${describeState(s)} @ x${panel.panelX}: ${found.join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it(`mobile: ${states().length * MOBILE_ROWS.length * MOBILE_WIDTHS.length} strip states draw clean`, () => {
    const failures: string[] = [];
    for (const s of states()) {
      for (const screenW of MOBILE_WIDTHS) {
        for (const rowY of MOBILE_ROWS) {
          const found = offenders(mobileHpBlockLayout(mobileInput(s, screenW, rowY)));
          if (found.length) failures.push(`${describeState(s)} @ ${screenW}px row ${rowY}: ${found.join('; ')}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /** The block is a RESERVED band — the board column starts at its bottom edge,
   * so a label that spills out of it lands on a card. */
  it('desktop: every label stays inside the reserved block height', () => {
    const R = DESKTOP_HP_BLOCK;
    for (const s of states()) {
      const geo = desktopHpBlockLayout(desktopInput(s, DESKTOP_PANELS[0]!));
      for (const l of geo.labels) {
        expect(l.top, `${l.key} top / ${describeState(s)}`).toBeGreaterThanOrEqual(84);
        expect(l.top + l.height, `${l.key} bottom / ${describeState(s)}`).toBeLessThanOrEqual(84 + R.blockHeight);
        expect(l.left, `${l.key} left / ${describeState(s)}`).toBeGreaterThanOrEqual(32);
        expect(l.left + l.width, `${l.key} right / ${describeState(s)}`).toBeLessThanOrEqual(32 + 380);
      }
    }
  });

  it('mobile: every label stays inside the strip pitch and on screen', () => {
    for (const s of states()) {
      const geo = mobileHpBlockLayout(mobileInput(s, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!));
      for (const l of geo.labels) {
        expect(l.top, `${l.key} top / ${describeState(s)}`).toBeGreaterThanOrEqual(MOBILE_ROWS[0]!);
        expect(l.top + l.height, `${l.key} bottom / ${describeState(s)}`)
          .toBeLessThanOrEqual(MOBILE_ROWS[0]! + MOBILE_HP_BLOCK.rowHeight);
        expect(l.left, `${l.key} left / ${describeState(s)}`).toBeGreaterThanOrEqual(0);
        expect(l.left + l.width, `${l.key} right / ${describeState(s)}`)
          .toBeLessThanOrEqual(MOBILE_PROFILE.canvas.width);
      }
    }
  });

  /** The status row is the whole point: one chain, alone on its row. */
  it('the status row is a chain and nothing else is on it, on both platforms', () => {
    const s: State = {
      name: 'THE WARDED SENTINEL', hp: '12000/18000', statLine: STAT_LINES[1]!,
      shield: SHIELDS[3], expose: EXPOSES[2], guard: GUARDS[2], pips: 6,
    };
    for (const geo of [
      desktopHpBlockLayout(desktopInput(s, DESKTOP_PANELS[0]!)),
      mobileHpBlockLayout(mobileInput(s, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!)),
    ]) {
      const status = geo.labels.filter((l) => STATUS_ROW_KEYS.includes(l.key));
      expect(status.map((l) => l.key)).toEqual(['shield', 'expose', 'guard']);
      // One row, descending leftward, nothing else sharing it.
      const rowTop = status[0]!.top;
      for (const l of status) expect(l.top).toBe(rowTop);
      for (let i = 1; i < status.length; i++) {
        expect(status[i]!.left + status[i]!.width).toBeLessThanOrEqual(status[i - 1]!.left);
      }
      const others = geo.labels.filter((l) => !STATUS_ROW_KEYS.includes(l.key));
      for (const o of others) {
        expect(
          o.top + o.height <= rowTop || o.top >= rowTop + status[0]!.height,
          `${o.key} shares the status row`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. THE TEETH — the same predicates, asked about the PRE-FIX geometry.
// ---------------------------------------------------------------------------

describe('battle HP block: the audit still detects both shipped defects', () => {
  it('REJECTS the pre-fix DESKTOP badge row (barY + 20 == the statline\'s own y)', () => {
    const s: State = {
      name: 'THE HOLLOW CROWN', hp: '110/110', statLine: STAT_LINES[0]!,
      expose: 'EXPOSE +40%', guard: 'GUARD 20%P', pips: 1,
    };
    const legacy = legacyDesktopHpBlockLayout(desktopInput(s, DESKTOP_PANELS[0]!));
    // The badges and the statline were placed at literally the same y…
    expect(legacy.byKey.expose!.top).toBe(legacy.byKey.statLine!.top);
    expect(legacy.byKey.expose!.top).toBe(84 + DESKTOP_HP_BLOCK.statRowDy);
    // …and both badges cut straight through the stats.
    const found = overlappingHpBlockLabels(legacy.labels).map((o) => `${o.a}/${o.b}`);
    expect(found).toContain('statLine/expose');
    expect(found).toContain('statLine/guard');
    // The fix moves them to their own row and the same predicate goes quiet.
    expect(offenders(desktopHpBlockLayout(desktopInput(s, DESKTOP_PANELS[0]!)))).toEqual([]);
  });

  it('REJECTS the pre-fix MOBILE head-row chain (it walks across the HP bar)', () => {
    const s: State = {
      name: 'HERO', hp: '100/100', statLine: STAT_LINES[0]!,
      shield: '+100 (54 P · 46 M)', expose: 'EXPOSE +40%', guard: 'GUARD 20%P', pips: 0,
    };
    const input = mobileInput(s, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!);
    const legacy = legacyMobileHpBlockLayout(input);
    // Every status label sat on the HEAD row, the bar's own row…
    for (const key of STATUS_ROW_KEYS) expect(legacy.byKey[key]!.top).toBe(MOBILE_ROWS[0]!);
    // …and the chain ran straight over the bar (120..328).
    const overBar = statusLabelsOverBar(legacy).map((o) => o.a);
    expect(overBar.length).toBeGreaterThan(0);
    expect(overBar).toContain('shield');
    // With all three up the chain reaches back past the bar's left edge.
    const leftmost = Math.min(...STATUS_ROW_KEYS.map((k) => legacy.byKey[k]!.left));
    expect(leftmost).toBeLessThan(MOBILE_HP_BLOCK.barX);
    // The fix moves them to their own row and the same predicate goes quiet.
    expect(offenders(mobileHpBlockLayout(input))).toEqual([]);
  });

  /**
   * NOT one hand-picked case: the SAME matrix section 1 runs green, re-run
   * against the pre-fix geometry, must come back overwhelmingly red. This is
   * the number that says the audit would have caught the bug on the day it
   * shipped rather than only after someone pointed at it.
   */
  it('the whole state matrix is RED on both pre-fix geometries', () => {
    let desktopBad = 0;
    let desktopTotal = 0;
    let mobileBad = 0;
    let mobileTotal = 0;
    for (const s of states()) {
      for (const panel of DESKTOP_PANELS) {
        desktopTotal += 1;
        if (offenders(legacyDesktopHpBlockLayout(desktopInput(s, panel))).length) desktopBad += 1;
      }
      for (const screenW of MOBILE_WIDTHS) {
        for (const rowY of MOBILE_ROWS) {
          mobileTotal += 1;
          if (offenders(legacyMobileHpBlockLayout(mobileInput(s, screenW, rowY))).length) mobileBad += 1;
        }
      }
    }
    // Every state that draws a badge at all was broken on desktop; every state
    // that draws a shield or two badges was broken on mobile.
    expect(desktopBad / desktopTotal).toBeGreaterThan(0.6);
    expect(mobileBad / mobileTotal).toBeGreaterThan(0.6);
  });

  /** A modelled box that is SMALLER than the glyphs would make the audit lie by
   * being generous. Both ratios are pinned above the real measurements. */
  it('models text bigger than it renders, so the audit can only be strict', () => {
    expect(HP_BLOCK_LINE_BOX).toBeGreaterThanOrEqual(1.2);
    expect(TEXT_PX_PER_CHAR).toBeGreaterThanOrEqual(0.6);
  });
});
