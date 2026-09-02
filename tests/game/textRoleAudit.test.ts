import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  INK, ON_FILL_INK_ROLES, STAT_PAIR_ROLES, TEXT_GROUNDS, TEXT_ROLE_SPEC,
  TEXT_SHRINK_FLOOR_PX, UI, textRoleFor,
  type InkRole, type TextRole,
} from '../../src/game/theme';
import { DESKTOP_PROFILE, MOBILE_PROFILE, type LayoutProfile } from '../../src/game/layoutProfile';

/**
 * THE TYPE-SYSTEM GUARD — the hole that let 67 distinct raw text colours and
 * 360 inline `fontStyle: 'bold'` accumulate in `src/game`.
 *
 * Written in the idiom of `controlLayoutAudit.test.ts` (drive the real thing
 * from Node, no DOM) and `layoutProfile.test.ts` (read the ACTUAL source text
 * rather than a hand-retyped copy of it, so the test breaks when the code
 * drifts and not merely when someone forgets to update the test).
 *
 * Four things are held here:
 *
 *   1. CONTRAST. Every `INK` role is recomputed against every dark ground the
 *      game actually paints, with the WCAG relative-luminance formula, and
 *      held to 4.5:1. This game renders 9px type on a phone; "it looked fine
 *      on my monitor" is exactly the bug class. Two colours already failed
 *      when this test was written (`UI.textSoft` at 3.37, `UI.textDisabled` at
 *      2.71) and were fixed in the same commit.
 *   2. THE LADDER. A role may not invent a font size. Every role's px size
 *      must be a value that already exists in that profile's
 *      `LayoutProfile.font` ladder, so `layoutProfile.ts` stays the single
 *      owner of "how big is text on this device".
 *   3. THE PAIR. A `statValue` must actually be bigger and heavier than its
 *      `statLabel` — the entire hierarchy claim reduces to this inequality, on
 *      BOTH profiles, so it is asserted rather than eyeballed in a screenshot.
 *   4. THE RATCHET. A per-file CEILING on raw colour literals and inline
 *      `fontSize:` literals. A file not in the allowlist may have NONE, so a
 *      new scene cannot start the problem over; a listed file may not exceed
 *      its budget, so no converted file can regress; and a listed file that
 *      has reached ZERO must be REMOVED from the list, which is what makes the
 *      allowlist shrink instead of quietly becoming decoration.
 */

// ---------------------------------------------------------------------------
// 1. CONTRAST — recomputed, not trusted.
// ---------------------------------------------------------------------------

/** WCAG 2.x relative luminance of one 8-bit channel. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `'#rrggbb'` string or a `0xrrggbb` number. */
function relativeLuminance(color: string | number): number {
  const n = typeof color === 'number' ? color : Number.parseInt(color.replace('#', ''), 16);
  return 0.2126 * channelLuminance((n >> 16) & 255)
    + 0.7152 * channelLuminance((n >> 8) & 255)
    + 0.0722 * channelLuminance(n & 255);
}

export function contrastRatio(a: string | number, b: string | number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** AA for small text. Not 3.0 (the large-text allowance): the smallest role in
 * this system renders at 9px on a phone, which is never "large text". */
const AA_SMALL = 4.5;

describe('theme: every INK role is legible on every ground the game paints', () => {
  it('the contrast formula agrees with a known reference pair (black on white = 21:1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  const groundEntries = Object.entries(TEXT_GROUNDS);
  const darkGroundInks = (Object.keys(INK) as InkRole[]).filter((r) => !ON_FILL_INK_ROLES.includes(r));

  for (const role of darkGroundInks) {
    it(`INK.${role} clears AA (${AA_SMALL}:1) on bg / panel / panelAlt / panelMuted`, () => {
      for (const [groundName, ground] of groundEntries) {
        const ratio = contrastRatio(INK[role], ground);
        expect(ratio, `INK.${role} (${INK[role]}) on ${groundName}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_SMALL);
      }
    });
  }

  it('the two ON-FILL inks clear AA against the fills they are actually drawn on', () => {
    // These two are exempt from the dark-ground sweep above BECAUSE they are
    // dark ink — they would fail it by design. So they are checked against the
    // light fills they really sit on instead of being waved through.
    expect(contrastRatio(INK.onAccent, UI.chip)).toBeGreaterThanOrEqual(AA_SMALL);
    expect(contrastRatio(INK.onAlarm, UI.bad)).toBeGreaterThanOrEqual(AA_SMALL);
  });

  it('every text-coloured token in the UI block also clears AA — the palette this system grew out of', () => {
    // The regression this pins: `UI.textSoft` shipped at `#8d724a` (3.37:1 on
    // panelAlt) and was used for 8-9px footnotes; `UI.textDisabled` shipped at
    // `#5a6880` (2.71:1). Neither was reachable from any test.
    const textTokens = Object.entries(UI).filter(([, v]) => typeof v === 'string') as Array<[string, string]>;
    expect(textTokens.length).toBeGreaterThan(6);
    for (const [name, hex] of textTokens) {
      // `textOnChip` is the dark-on-bronze ink, checked above against its fill.
      if (name === 'textOnChip') continue;
      for (const [groundName, ground] of groundEntries) {
        const ratio = contrastRatio(hex, ground);
        expect(ratio, `UI.${name} (${hex}) on ${groundName}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_SMALL);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. THE LADDER — a role may not invent a size.
// ---------------------------------------------------------------------------

const PROFILES: Array<[LayoutProfile['id'], LayoutProfile]> = [
  ['mobile', MOBILE_PROFILE],
  ['desktop', DESKTOP_PROFILE],
];

describe('theme: every TEXT_ROLE size comes off its profile font ladder', () => {
  for (const [id, profile] of PROFILES) {
    const ladder = new Set(Object.values(profile.font));
    it(`${id}: no role invents a font size the ladder does not have`, () => {
      for (const [role, spec] of Object.entries(TEXT_ROLE_SPEC) as Array<[TextRole, typeof TEXT_ROLE_SPEC[TextRole]]>) {
        const size = spec.size[id];
        expect(ladder.has(size), `TEXT_ROLE_SPEC.${role} is ${size}px on ${id}, which is not in ${id}'s LayoutProfile.font ladder`).toBe(true);
      }
    });

    it(`${id}: no role renders below the global text floor (${TEXT_SHRINK_FLOOR_PX}px)`, () => {
      for (const [role, spec] of Object.entries(TEXT_ROLE_SPEC) as Array<[TextRole, typeof TEXT_ROLE_SPEC[TextRole]]>) {
        expect(spec.size[id], `TEXT_ROLE_SPEC.${role} on ${id}`).toBeGreaterThanOrEqual(TEXT_SHRINK_FLOOR_PX);
      }
    });

    it(`${id}: every role resolves to a complete, Phaser-shaped style`, () => {
      for (const role of Object.keys(TEXT_ROLE_SPEC) as TextRole[]) {
        const style = textRoleFor(id, role);
        expect(style.fontFamily.length, role).toBeGreaterThan(0);
        expect(style.fontSize, role).toMatch(/^\d+px$/);
        expect(style.fontStyle === 'bold' || style.fontStyle === 'normal', role).toBe(true);
        expect(style.color, role).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it(`${id}: desktop and mobile do NOT share absolute sizes where it would matter`, () => {
      // The whole reason roles resolve per profile. `statLabel` is the one role
      // allowed to coincide at the floor; everything above `body` must differ.
      const bigRoles: TextRole[] = ['display', 'title', 'section', 'statValue', 'body'];
      for (const role of bigRoles) {
        expect(TEXT_ROLE_SPEC[role].size.mobile, role).not.toBe(TEXT_ROLE_SPEC[role].size.desktop);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. THE PAIR — the hierarchy claim, as an inequality.
// ---------------------------------------------------------------------------

describe('theme: a stat VALUE always outranks its LABEL', () => {
  for (const [density, pair] of Object.entries(STAT_PAIR_ROLES)) {
    for (const [id] of PROFILES) {
      it(`${density}/${id}: the value is larger AND bolder than the label`, () => {
        const value = TEXT_ROLE_SPEC[pair.value];
        const label = TEXT_ROLE_SPEC[pair.label];
        expect(value.size[id], 'value px vs label px').toBeGreaterThan(label.size[id]);
        expect(value.bold, 'the value must be bold').toBe(true);
        expect(label.bold, 'the label must NOT be bold — that is what makes it a label').toBe(false);
      });
    }
  }

  it('the roomy pair leads the tight pair, so a `lead` segment really does lead', () => {
    for (const [id] of PROFILES) {
      expect(TEXT_ROLE_SPEC[STAT_PAIR_ROLES.roomy.value].size[id])
        .toBeGreaterThan(TEXT_ROLE_SPEC[STAT_PAIR_ROLES.tight.value].size[id]);
    }
  });

  it('a label never uses a value ink, and vice versa — the two halves cannot converge', () => {
    for (const pair of Object.values(STAT_PAIR_ROLES)) {
      expect(TEXT_ROLE_SPEC[pair.value].ink).not.toBe(TEXT_ROLE_SPEC[pair.label].ink);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. THE RATCHET — a shrinking per-file budget for raw literals.
// ---------------------------------------------------------------------------

const GAME_ROOT = join(process.cwd(), 'src', 'game');

/**
 * Files the ratchet does NOT police, and why each is not a loophole:
 *
 *   theme.ts            IS the palette. Every hex in the game is supposed to
 *                       end up here; policing it would invert the rule.
 *   layoutProfile.ts    IS the size ladder, for the same reason.
 */
const RATCHET_EXEMPT = new Set(['theme.ts', 'layoutProfile.ts']);

/**
 * A raw text/fill colour literal written in a renderer instead of taken from a
 * token. `'#rrggbb'`, `'#rgb'`, `'#rrggbbaa'`.
 */
const HEX_LITERAL = /'#[0-9a-fA-F]{3,8}'/g;

/**
 * An inline font size: `fontSize: '13px'` or `fontSize: \`${x}px\``. Both are
 * a call site deciding type size for itself, which is precisely what a role
 * exists to stop.
 */
const FONT_SIZE_LITERAL = /fontSize: (?:'[0-9]+px'|`\$\{[^}]*\}px`)/g;

/**
 * THE ALLOWLIST — grandfathered debt, one line per file, measured (not
 * guessed) at 2026-08-28. Rules, enforced by the tests below:
 *
 *   - a file NOT listed here may have ZERO of either kind;
 *   - a listed file may not EXCEED its budget (no regressions);
 *   - a listed file that has reached zero must be DELETED from this list,
 *     which is the mechanism that makes the list shrink.
 *
 * The `hex`/`fontSize` numbers are ceilings, not targets. Lower one whenever
 * you convert a file; the test will tell you the moment a number is stale.
 *
 * WHY SOME FILES ARE STILL HERE. Six of them were held by other agents while
 * this system landed (`RunProgressStrip.ts`, `RunRewardPanel.ts`,
 * `CardToken.ts`, `runScreenTemplate.ts`, `*RunEventScene.ts`,
 * `*DraftScene.ts`) — the system was deliberately shaped so those can adopt it
 * later without changing it. `RunProgressStrip.ts` has since done exactly that
 * (3 hex + 12 fontSize -> 0 + 2), which is what the mechanism is for. The rest
 * is honest backlog: battle, shop and wiki are the three biggest surfaces and
 * were not in this pass's scope.
 */
const ALLOWLIST: Record<string, { hex?: number; fontSize?: number }> = {
  'scenes/BootScene.ts': { fontSize: 1 },
  // Down from `{ hex: 32, fontSize: 31 }` (2026-09-02): `renderStatus` took
  // `UI.textMuted` — its literal was a stale pre-lift copy measuring 4.25:1 on
  // the new panelAlt — and the fontSize ceiling was re-measured to the actual
  // count (the 31 had gone stale above it).
  'scenes/DesktopBattleScene.ts': { hex: 31, fontSize: 30 },
  'scenes/DesktopDeckBuildScene.ts': { hex: 1, fontSize: 28 },
  'scenes/DesktopDraftScene.ts': { fontSize: 5 },
  'scenes/DesktopPrepScene.ts': { fontSize: 4 },
  'scenes/DesktopRunEventScene.ts': { fontSize: 3 },
  'scenes/DesktopRunMapScene.ts': { fontSize: 6 },
  'scenes/DesktopRunPrepScene.ts': { fontSize: 13 },
  // Down 1 hex apiece (2026-09-02): the `color === UI.good ? ... : ...` toast
  // idiom's positive green was a pasted `'#9ad17a'` — the exact literal
  // `UI.textGem` was canonicalised FROM (its doc comment cites this idiom).
  'scenes/DesktopShopScene.ts': { hex: 2, fontSize: 50 },
  'scenes/DesktopWikiScene.ts': { hex: 1, fontSize: 21 },
  // Down from `{ hex: 39, fontSize: 31 }` (2026-09-02): both ceilings had gone
  // stale above the measured counts — re-pinned to what the file actually
  // holds (37/30) so the ratchet grips again.
  'scenes/MobileBattleScene.ts': { hex: 37, fontSize: 30 },
  'scenes/MobileDeckBuildScene.ts': { hex: 12, fontSize: 33 },
  'scenes/MobileDraftScene.ts': { hex: 2, fontSize: 9 },
  'scenes/MobilePrepScene.ts': { hex: 9, fontSize: 5 },
  'scenes/MobileRunEventScene.ts': { fontSize: 3 },
  'scenes/MobileRunPrepScene.ts': { fontSize: 1 },
  // Down from `{ hex: 19, fontSize: 48 }` (2026-08-31, price chip into its
  // reserved gutter with a `label` ROLE), then to 13 hex (2026-09-02): the
  // three purchase/merge/sell toasts' pasted positive green took `UI.textGem`.
  'scenes/MobileShopScene.ts': { hex: 13, fontSize: 47 },
  // Down from `{ hex: 7, fontSize: 26 }` (2026-08-31, the `PL n` chip took the
  // `kicker` role), then to 3 hex (2026-09-02): two toast greens -> `UI.textGem`.
  'scenes/MobileWikiScene.ts': { hex: 3, fontSize: 25 },
  'scenes/StartScene.ts': { hex: 1, fontSize: 4 },
  'scenes/UiKitScene.ts': { hex: 5, fontSize: 31 },
  // hex retired (2026-09-02): the footer's on-gold/off-gold label pair were
  // pasted copies of `UI.textOnChip`/`UI.textBright` — now the tokens.
  'ui/ActionBar.ts': { fontSize: 1 },
  // hex retired (2026-09-02): the empty slot number was a stale `#8a94a6`
  // (pre-lift textMuted, 4.25:1 on the new panelAlt) — now `UI.textMuted`.
  'ui/BoardColumn.ts': { fontSize: 1 },
  // Down from `{ hex: 13 }` (2026-09-02): the face's name/compact-line cream
  // (4x), affinity footnote and cursor-badge dark ink were byte-identical
  // copies of `UI.textBright`/`UI.textFootnote`/`UI.textOnChip` — now tokens.
  'ui/CardToken.ts': { hex: 7, fontSize: 8 },
  'ui/DesktopNav.ts': { fontSize: 4 },
  'ui/FantasyCardTemplateV2.ts': { hex: 14, fontSize: 9 },
  'ui/RunChoicePanel.ts': { fontSize: 4 },
  // Down from `{ hex: 3, fontSize: 12 }`: the run HUD strip now takes its stat
  // run from `ui/statRunModel.ts` + `ui/statRunStrip.ts` and its kicker/title/
  // dialog type from roles. The two survivors are the action-slot label (its px
  // is a PER-SLOT argument — mobile primary is 13 against the row's 8) and the
  // mobile disclosure chevron sized off the stats row.
  'ui/RunProgressStrip.ts': { fontSize: 2 },
  'ui/RunRewardPanel.ts': { fontSize: 11 },
  'ui/RunRouteBoard.ts': { hex: 2, fontSize: 7 },
  'ui/RunStatPanel.ts': { fontSize: 2 },
  'ui/battleFxSpec.ts': { hex: 1 },
  'ui/brandMark.ts': { fontSize: 2 },
  'ui/cardDetailOverlay.ts': { hex: 1, fontSize: 3 },
  'ui/cardInfoBox.ts': { hex: 2, fontSize: 1 },
  // A colour DICTIONARY for card body markup, not a renderer — but listed
  // rather than exempted, because the honest place for those 24 entries is
  // eventually `INK`/`theme.ts` too. Count unchanged 2026-09-02, values not:
  // all 24 now clear 4.5:1 on both battle card fills (13 were under, worst
  // 2.46) — measured ratios recorded in the map's own comments.
  // 24 -> 25 (2026-09-02): `taunt` gained its first card (champions_challenge),
  // so the keyword map gained its 25th semantic colour. Growth here is a new
  // KEYWORD, never a stray literal — the map is the one legitimate place a new
  // hex appears when content grows.
  'ui/cardTextMarkup.ts': { hex: 25 },
  'ui/hoverTip.ts': { hex: 2, fontSize: 2 },
  // The stat-run renderer's own two `fontSize:` writes ARE the shrink-to-fit
  // pass applying a role's scaled size — the one place in the codebase that is
  // supposed to compute a px value, because every other call site delegates to
  // it. Budgeted, not exempted, so it cannot quietly grow a third.
  'ui/statRunStrip.ts': { fontSize: 2 },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface FileCounts { hex: number; fontSize: number }

function countFile(full: string): FileCounts {
  const src = readFileSync(full, 'utf8');
  return {
    hex: (src.match(HEX_LITERAL) ?? []).length,
    fontSize: (src.match(FONT_SIZE_LITERAL) ?? []).length,
  };
}

function scanGame(): Map<string, FileCounts> {
  const result = new Map<string, FileCounts>();
  for (const full of walk(GAME_ROOT)) {
    const key = relative(GAME_ROOT, full).split(/[\\/]/).join('/');
    if (RATCHET_EXEMPT.has(key)) continue;
    result.set(key, countFile(full));
  }
  return result;
}

describe('src/game: the type-system ratchet', () => {
  const counts = scanGame();

  it('the scan actually found the game source (a broken walk must not pass silently)', () => {
    expect(counts.size).toBeGreaterThan(40);
    // Sanity: the regexes must match SOMETHING today, or a typo in either one
    // would turn this whole section into a test that checks nothing.
    const totals = [...counts.values()].reduce((a, c) => ({ hex: a.hex + c.hex, fontSize: a.fontSize + c.fontSize }), { hex: 0, fontSize: 0 });
    expect(totals.hex).toBeGreaterThan(0);
    expect(totals.fontSize).toBeGreaterThan(0);
  });

  it('a file NOT on the allowlist has no raw colour literal and no inline fontSize', () => {
    const offenders: string[] = [];
    for (const [key, c] of counts) {
      if (key in ALLOWLIST) continue;
      if (c.hex > 0) offenders.push(`${key}: ${c.hex} raw colour literal(s) — take an INK role instead (theme.ts)`);
      if (c.fontSize > 0) offenders.push(`${key}: ${c.fontSize} inline fontSize — take a TEXT_ROLE instead (theme.ts)`);
    }
    expect(offenders).toEqual([]);
  });

  it('no allowlisted file EXCEEDS its budget', () => {
    const regressions: string[] = [];
    for (const [key, budget] of Object.entries(ALLOWLIST)) {
      const c = counts.get(key);
      if (!c) continue; // covered by the stale-entry test below
      const hexBudget = budget.hex ?? 0;
      const fontBudget = budget.fontSize ?? 0;
      if (c.hex > hexBudget) regressions.push(`${key}: ${c.hex} raw colours, budget ${hexBudget}`);
      if (c.fontSize > fontBudget) regressions.push(`${key}: ${c.fontSize} inline fontSize, budget ${fontBudget}`);
    }
    expect(regressions).toEqual([]);
  });

  it('the allowlist has no STALE entry — a file that reached zero must be removed from it', () => {
    // THIS is what makes the list shrink rather than become decoration: the
    // moment a file is fully converted, the test tells you to delete its line.
    const stale: string[] = [];
    for (const [key, budget] of Object.entries(ALLOWLIST)) {
      const c = counts.get(key);
      if (!c) { stale.push(`${key}: listed but no longer exists`); continue; }
      if (c.hex === 0 && c.fontSize === 0) stale.push(`${key}: fully converted — delete its ALLOWLIST line`);
      if (budget.hex !== undefined && c.hex === 0) stale.push(`${key}: hex budget is stale (0 remain) — drop \`hex\` from its line`);
      if (budget.fontSize !== undefined && c.fontSize === 0) stale.push(`${key}: fontSize budget is stale (0 remain) — drop \`fontSize\` from its line`);
    }
    expect(stale).toEqual([]);
  });

  it('the whole-codebase total is at or below the recorded high-water mark', () => {
    // One number to watch in review. It may only ever go DOWN — raise it and
    // you are consciously undoing the pass this test exists to protect.
    // 2026-09-02: hex 189 -> 170 (17 literals tokenised in the stale-copy
    // sweep, 2 stale ceiling points re-measured away), fontSize 410 -> 408
    // (two stale battle-scene ceilings re-pinned to measured counts).
    const HIGH_WATER = { hex: 171, fontSize: 408 }; // 170 -> 171: taunt keyword colour (see cardTextMarkup budget note)
    const totals = [...counts.values()].reduce((a, c) => ({ hex: a.hex + c.hex, fontSize: a.fontSize + c.fontSize }), { hex: 0, fontSize: 0 });
    expect(totals.hex, 'raw colour literals in src/game (excluding theme.ts)').toBeLessThanOrEqual(HIGH_WATER.hex);
    expect(totals.fontSize, 'inline fontSize literals in src/game').toBeLessThanOrEqual(HIGH_WATER.fontSize);
    // And the allowlist must SUM to the high-water mark, so a budget cannot be
    // padded on one line while the total silently stays put.
    const budgeted = Object.values(ALLOWLIST).reduce<{ hex: number; fontSize: number }>(
      (a, b) => ({ hex: a.hex + (b.hex ?? 0), fontSize: a.fontSize + (b.fontSize ?? 0) }),
      { hex: 0, fontSize: 0 },
    );
    expect(budgeted).toEqual(HIGH_WATER);
  });
});
