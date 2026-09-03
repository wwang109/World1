import { describe, expect, it } from 'vitest';
import {
  DESKTOP_HP_BLOCK, MOBILE_HP_BLOCK, HP_BLOCK_LINE_BOX, STATUS_ROW_KEYS,
  desktopHpBlockLayout, mobileHpBlockLayout,
  legacyDesktopHpBlockLayout, legacyMobileHpBlockLayout,
  overlappingHpBlockLabels, statusLabelsOverBar,
  type DesktopHpBlockInput, type HpBlockGeometry, type HpBlockLabel,
  type LegacyDesktopHpBlockInput, type LegacyMobileHpBlockInput,
  type MobileHpBlockInput, type PlacedHpBlockLabel,
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
 * 2026-09-02, STATUS CHIPS: the expose/guard badges and the ailment pips were
 * superseded by the per-unit STATUS CHIP chain (`chipsByTurn`,
 * battleTimeline.ts) — every standing effect as a `PSN 8`-style token,
 * chained left→right along the same status row toward the right-aligned
 * shield total, overflowing into a `+N` marker when the row is full
 * (`chainChipsRow`). The block/strip HEIGHT BUDGETS did NOT move for this
 * (`blockHeight` 76 / `rowHeight` 48 unchanged): the chips reuse the row the
 * badges vacated, which is exactly why this audit's state matrix now drives
 * CHIP SETS — up to the full eleven-chip worst case — instead of the two
 * badges. The pre-fix predicates at the bottom still drive the LEGACY
 * geometry through the badge inputs it was written for.
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
/** Statlines are generated from one template — the widest is all-two-digit. */
const STAT_LINES = [
  'ATK 1 · MATK 1 · DEF 1 · MDEF 1 · SPD 10',
  'ATK 24 · MATK 31 · DEF 18 · MDEF 12 · SPD 14',
];
/**
 * Status-chip rows, exactly as `buildChips` (battleTimeline.ts) formats them,
 * in its fixed `CHIP_KIND_ORDER`. `EVERYTHING` is the full worst case — one of
 * every kind at wide magnitudes, eleven chips — which no row can hold, so it
 * is the case that proves the `+N` overflow path never collides either.
 */
const CHIP_SETS: readonly (readonly string[])[] = [
  [],
  ['PSN 8'],
  ['PSN 12', 'EXP +40%', 'GRD 75%P'],
  ['PSN 12', 'BRN 8', 'BLD 5', 'STN', 'EXP +150%', 'MATK −30%−12', 'GRD 75%P 40%M', 'NGT 3P', 'WRD 2', 'THR 6', 'ATK +30%+12'],
];
const EVERYTHING = CHIP_SETS[3]!;

interface State {
  name: string;
  hp: string;
  statLine: string;
  shield?: string;
  chips: readonly string[];
}

function states(): State[] {
  const out: State[] = [];
  for (const shield of SHIELDS) {
    for (const chips of CHIP_SETS) {
      for (let i = 0; i < NAMES.length; i++) {
        out.push({
          name: NAMES[i]!,
          hp: HP_TEXTS[i]!,
          statLine: STAT_LINES[i % STAT_LINES.length]!,
          shield, chips,
        });
      }
    }
  }
  return out;
}

function describeState(s: State): string {
  return [s.name, s.shield ? 'shield' : '—', `${s.chips.length} chips`].join(' / ');
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
    chips: s.chips.map((c) => label(c, DF.tiny)),
    // The scenes always pass the widest realistic sample ("+99") — the layout
    // reserves for it, the scene writes the real count in afterwards.
    chipsOverflow: label('+99', DF.tiny),
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
    chips: s.chips.map((c) => label(c, MF.tiny)),
    chipsOverflow: label('+99', MF.tiny),
  };
}

function offenders(geo: HpBlockGeometry): string[] {
  return [
    ...overlappingHpBlockLabels(geo.labels).map((o) => `${o.a} over ${o.b} (${o.area.toFixed(1)}px²)`),
    ...statusLabelsOverBar(geo).map((o) => `${o.a} over the HP BAR (${o.area.toFixed(1)}px²)`),
  ];
}

/** The placed chip chain (chip0..chipN, then chipMore if present), in order. */
function placedChips(geo: HpBlockGeometry): PlacedHpBlockLabel[] {
  return geo.labels.filter((l) => l.key.startsWith('chip'));
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

  /** The status row is the whole point: the chip chain and the shield total
   * share one row, grow toward each other, and never meet. */
  it('the chip chain and the shield share the status row cleanly, on both platforms', () => {
    const s: State = {
      name: 'THE WARDED SENTINEL', hp: '12000/18000', statLine: STAT_LINES[1]!,
      shield: SHIELDS[3], chips: EVERYTHING,
    };
    for (const geo of [
      desktopHpBlockLayout(desktopInput(s, DESKTOP_PANELS[0]!)),
      mobileHpBlockLayout(mobileInput(s, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!)),
    ]) {
      const shield = geo.byKey.shield!;
      const chain = placedChips(geo);
      expect(chain.length).toBeGreaterThan(0);
      // One row: every chip and the shield sit at the same y.
      for (const c of chain) expect(c.top).toBe(shield.top);
      // Left→right, ascending, with the shield beyond the chain's right end.
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i]!.left).toBeGreaterThanOrEqual(chain[i - 1]!.left + chain[i - 1]!.width);
      }
      const last = chain[chain.length - 1]!;
      expect(last.left + last.width).toBeLessThanOrEqual(shield.left);
      // Nothing else shares the row.
      const others = geo.labels.filter((l) => !l.key.startsWith('chip') && l.key !== 'shield');
      for (const o of others) {
        expect(
          o.top + o.height <= shield.top || o.top >= shield.top + shield.height,
          `${o.key} shares the status row`,
        ).toBe(true);
      }
    }
  });

  /**
   * OVERFLOW HONESTY: the eleven-chip worst case cannot fit beside the widest
   * shield on either platform — the chain must keep a PREFIX (chips arrive
   * most-important-first) and end in the `+N` marker, never silently drop or
   * reorder. If this state ever DOES fit, the matrix has stopped exercising
   * the overflow path and needs a wider case.
   */
  it('the worst-case chip row overflows into the +N marker, in order, on both platforms', () => {
    const s: State = {
      name: 'THE WARDED SENTINEL', hp: '12000/18000', statLine: STAT_LINES[1]!,
      shield: SHIELDS[3], chips: EVERYTHING,
    };
    const desktopChips = desktopInput(s, DESKTOP_PANELS[0]!).chips!;
    for (const geo of [
      desktopHpBlockLayout(desktopInput(s, DESKTOP_PANELS[0]!)),
      mobileHpBlockLayout(mobileInput(s, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!)),
    ]) {
      const chain = placedChips(geo);
      const more = chain[chain.length - 1]!;
      expect(more.key).toBe('chipMore');
      const kept = chain.slice(0, -1);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(EVERYTHING.length);
      // The kept chips are exactly the PREFIX of the input, in input order.
      kept.forEach((c, i) => expect(c.key).toBe(`chip${i}`));
      expect(kept.map((c) => c.text)).toEqual([...EVERYTHING.slice(0, kept.length)]);
    }
    void desktopChips;
  });

  /** A lone unfittable chip row with no shield still resolves: marker only,
   * never a chip painted past the row's right edge. */
  it('a chip chain with zero room keeps only the +N marker', () => {
    // A degenerate 60px-wide panel: nothing fits beside the reserve.
    const geo = desktopHpBlockLayout({
      panelX: 0, panelY: 0, panelW: 60,
      name: label('X', DF.name), hp: label('1/1', DF.name), statLine: label('ATK 1', DF.small),
      chips: EVERYTHING.map((c) => label(c, DF.tiny)),
      chipsOverflow: label('+99', DF.tiny),
    });
    const chain = placedChips(geo);
    expect(chain.map((c) => c.key)).toEqual(['chipMore']);
    expect(chain[0]!.left + chain[0]!.width).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// 2. THE TEETH — the same predicates, asked about the PRE-FIX geometry.
// The legacy layouts still take the pre-chip badge inputs (expose/guard);
// these builders reconstruct exactly the states the two bugs shipped with.
// ---------------------------------------------------------------------------

function legacyDesktopInput(
  s: State, panel: { panelX: number; panelY: number; panelW: number },
  expose?: string, guard?: string,
): LegacyDesktopHpBlockInput {
  return {
    ...desktopInput(s, panel),
    expose: expose ? label(expose, DF.tiny) : undefined,
    guard: guard ? label(guard, DF.tiny) : undefined,
  };
}

function legacyMobileInput(
  s: State, screenW: number, rowY: number,
  expose?: string, guard?: string,
): LegacyMobileHpBlockInput {
  return {
    ...mobileInput(s, screenW, rowY),
    expose: expose ? label(expose, MF.tiny) : undefined,
    guard: guard ? label(guard, MF.tiny) : undefined,
  };
}

describe('battle HP block: the audit still detects both shipped defects', () => {
  it('REJECTS the pre-fix DESKTOP badge row (barY + 20 == the statline\'s own y)', () => {
    const s: State = {
      name: 'THE HOLLOW CROWN', hp: '110/110', statLine: STAT_LINES[0]!, chips: [],
    };
    const legacy = legacyDesktopHpBlockLayout(legacyDesktopInput(s, DESKTOP_PANELS[0]!, 'EXPOSE +40%', 'GUARD 20%P'));
    // The badges and the statline were placed at literally the same y…
    expect(legacy.byKey.expose!.top).toBe(legacy.byKey.statLine!.top);
    expect(legacy.byKey.expose!.top).toBe(84 + DESKTOP_HP_BLOCK.statRowDy);
    // …and both badges cut straight through the stats.
    const found = overlappingHpBlockLabels(legacy.labels).map((o) => `${o.a}/${o.b}`);
    expect(found).toContain('statLine/expose');
    expect(found).toContain('statLine/guard');
    // The fix moves the statuses to their own chip row and the same predicate
    // goes quiet (same statuses, chip form).
    const fixed = desktopInput({ ...s, chips: ['EXP +40%', 'GRD 20%P'] }, DESKTOP_PANELS[0]!);
    expect(offenders(desktopHpBlockLayout(fixed))).toEqual([]);
  });

  it('REJECTS the pre-fix MOBILE head-row chain (it walks across the HP bar)', () => {
    const s: State = {
      name: 'HERO', hp: '100/100', statLine: STAT_LINES[0]!,
      shield: '+100 (54 P · 46 M)', chips: [],
    };
    const legacy = legacyMobileHpBlockLayout(legacyMobileInput(s, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!, 'EXPOSE +40%', 'GUARD 20%P'));
    // Every status label sat on the HEAD row, the bar's own row…
    for (const key of STATUS_ROW_KEYS) expect(legacy.byKey[key]!.top).toBe(MOBILE_ROWS[0]!);
    // …and the chain ran straight over the bar (120..328).
    const overBar = statusLabelsOverBar(legacy).map((o) => o.a);
    expect(overBar.length).toBeGreaterThan(0);
    expect(overBar).toContain('shield');
    // With all three up the chain reaches back past the bar's left edge.
    const leftmost = Math.min(...STATUS_ROW_KEYS.map((k) => legacy.byKey[k]!.left));
    expect(leftmost).toBeLessThan(MOBILE_HP_BLOCK.barX);
    // The fix moves the statuses to their own chip row and the same predicate
    // goes quiet (same statuses, chip form).
    const fixed = mobileInput({ ...s, chips: ['EXP +40%', 'GRD 20%P'] }, MOBILE_PROFILE.canvas.width, MOBILE_ROWS[0]!);
    expect(offenders(mobileHpBlockLayout(fixed))).toEqual([]);
  });

  /**
   * NOT one hand-picked case: the SAME matrix section 1 runs green, re-run
   * against the pre-fix geometry — every state dressed with the badges the
   * legacy layouts drew — must come back overwhelmingly red. This is the
   * number that says the audit would have caught the bug on the day it
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
        if (offenders(legacyDesktopHpBlockLayout(legacyDesktopInput(s, panel, 'EXPOSE +40%', 'GUARD 20%P'))).length) desktopBad += 1;
      }
      for (const screenW of MOBILE_WIDTHS) {
        for (const rowY of MOBILE_ROWS) {
          mobileTotal += 1;
          if (offenders(legacyMobileHpBlockLayout(legacyMobileInput(s, screenW, rowY, 'EXPOSE +40%', 'GUARD 20%P'))).length) mobileBad += 1;
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
