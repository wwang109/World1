import type { Archetype, Property, Rarity, SkillTier } from '../engine/types';
import { ACTIVE_PROFILE } from './layoutProfile';
import { viewport } from './viewport';

export const PROPERTY_COLOR: Record<Property, number> = {
  physical: 0xd98a3d,
  magical: 0x5a8dee,
  true: 0xe8d5a0,
};

export const PROPERTY_LABEL: Record<Property, string> = {
  physical: 'PHYS',
  magical: 'MAG',
  true: 'TRUE',
};

export const ARCHETYPE_ICON: Record<Archetype, string> = {
  offense: '⚔',
  defensive: '🛡',
  healing: '✚',
  support: '♦',
  debuff: '☠',
};

export const ELEMENT_ICON: Record<string, string> = {
  fire: '🔥',
  frost: '❄',
  lightning: '⚡',
  nature: '🌿',
  holy: '☀',
  dark: '🌑',
};

export const WEAPON_ICON: Record<string, string> = {
  sword: '🗡',
  axe: '🪓',
  lance: '🔱',
  bow: '🏹',
  beast: '🐾',
};

export const ELEMENT_COLOR: Record<string, number> = {
  fire: 0xc95f47,
  frost: 0x5d91b3,
  lightning: 0xc99b2f,
  nature: 0x5f8755,
  holy: 0xb99d43,
  dark: 0x725f86,
};

export const WEAPON_COLOR: Record<string, number> = {
  sword: 0x587a9b,
  axe: 0xaa6645,
  lance: 0x4e8b83,
  bow: 0x65854c,
  beast: 0x8a6247,
};

export const ARCHETYPE_COLOR: Record<Archetype, number> = {
  offense: 0xcc4444,
  defensive: 0x4a7ab5,
  healing: 0x4caf6e,
  support: 0xc9a227,
  debuff: 0x9b59b6,
};

export const CARD_ACTION_COLOR = {
  attack: 0xc95f47,
  defense: 0x557da5,
  healing: 0x3f8f4e,
  buff: 0xb27c22,
  debuff: 0x8b5a8f,
  tempo: 0xc58b2a,
  utility: 0x4e8378,
} as const;

export const STATUS_ICON: Record<string, string> = {
  poison: '☠',
  burn: '🔥',
  stun: '💫',
  buff: '▲',
  debuff: '▼',
  guard: '⛨',
  negate: '⦵',
};

export const TIER_COLOR: Record<SkillTier, number> = {
  bronze: 0xc78338,
  silver: 0x6c7ea0,
  gold: 0xd7b346,
  diamond: 0x5bb1f2,
};

export const GEM_RARITY_COLOR: Record<Rarity, number> = {
  common: 0x6e8aa3,
  rare: 0x3f79dd,
  epic: 0xb56ad8,
  legendary: 0xdf9a33,
};

export const UI = {
  bg: 0x07131d,
  bgBlobA: 0x14314a,
  bgBlobB: 0x251a11,
  bgBlobC: 0x102739,
  panel: 0x10202f,
  panelAlt: 0x142738,
  panelMuted: 0x0d1b28,
  battleFrame: 0x0f1d2b,
  battleLog: 0x0b1620,
  battlePlayer: 0xb78a46,
  battleEnemy: 0x995f3f,
  /** Board card token fills: DARK so the cream text reads; side identity stays in the chip/accent colors. */
  battlePlayerCard: 0x2c3e58,
  battleEnemyCard: 0x45291f,
  battlePlayerSlot: 0x172739,
  battleEnemySlot: 0x1b2431,
  battleOutline: 0xb78a46,
  lanePlayer: 0x182b22,
  laneLog: 0x13202d,
  laneEnemy: 0x2b1d17,
  slot: 0x132536,
  slotHover: 0x1d3950,
  playerCard: 0x23384b,
  enemyCard: 0x412e24,
  playsCard: 0x122130,
  chip: 0xc69948,
  chipDark: 0x1c3144,
  border: 0xb88a45,
  shadow: 0x02060b,
  good: 0x7cab63,
  waiting: 0xc59a45,
  bad: 0xc36a57,
  goodSoft: 0x1b3123,
  badSoft: 0x352019,
  text: '#ecd7a4',
  textDim: '#b89460',
  /**
   * LEGIBILITY FIX (2026-08-28 type pass): was `#8d724a`, which measures 3.37:1
   * against `panelAlt` — below WCAG AA (4.5) for the 8-9px footnotes it is used
   * for, on a phone, and it was the WORST text colour in the whole palette.
   * `#a68a5c` is the same bronze-grey at 4.66:1 worst-ground. Verified by
   * `tests/game/textRoleAudit.test.ts`, which now holds every text colour in
   * this block to the floor.
   */
  textSoft: '#a68a5c',
  /** Bronze accent as a text color (string twin of `chip`). */
  textAccent: '#c69948',
  /**
   * Hero-scope stat-gem bonus attribution — reuses the existing "good/
   * positive" green (see the `color === UI.good ? '#9ad17a' : ...` toast
   * idiom) so a gem-boosted stat's "+N" reads as a DIFFERENT kind of bonus
   * than `textAccent`'s level-buy "+N", wherever both can appear side by
   * side (the HERO stat-allocation grid) or a stat total needs its gem
   * contribution called out (a hero statline / deck-build header).
   */
  textGem: '#9ad17a',
  /** Dark ink for text sitting on a bronze chip/button fill. */
  textOnChip: '#1a1208',
  /** Mobile scenes' de-facto primary/heading text tone (cream, cooler than `text`). */
  textBright: '#e8e0c8',
  /** Secondary/informational muted text (mobile scenes). */
  textMuted: '#8a94a6',
  /** A second, slightly lighter muted tone used for stat/footnote lines (mobile scenes). */
  textFootnote: '#9aa4b6',
  /**
   * Disabled-control text (mobile scenes). LEGIBILITY FIX (2026-08-28): was
   * `#5a6880` at 2.71:1 — WCAG exempts an inactive control from AA, but at 9px
   * on a phone 2.71 is not "demoted", it is gone. `#8290aa` reads at 4.73:1
   * and is still unmistakably subordinate: it clears the same floor as every
   * other text tone (so the guard test needs no carve-out for it) while
   * staying cooler and 5 steps below `textBright`'s 11.6. Demotion here is
   * carried by hue and weight, not by making the text unreadable.
   */
  textDisabled: '#8290aa',
  /**
   * THE danger/alarm text tone — the string twin of `bad`. Canonicalises the
   * raw `'#e0654a'` that had been hand-pasted into `RunProgressStrip` (last
   * life), `RunStatsPanel` (BOSS THIS WAVE) and `bandBannerViewModel`
   * (`claimTextColor('none')`). Nudged from `#e0654a` (4.45:1 on `panelAlt`,
   * a hair under AA) to `#e8785e` (5.29:1) in the same pass.
   */
  textAlarm: '#e8785e',
  hp: 0x3f8f4e,
  hpBack: 0xcbb894,
  shield: 0x5f83a6,
};

export const TYPE_SCALE = {
  display: '34px',
  heading: '18px',
  body: '14px',
  small: '12px',
};

/* ==========================================================================
 * THE TYPE SYSTEM — INK (what a colour MEANS) + TEXT_ROLE (size+weight+ink,
 * bound together as one token).
 *
 * WHY IT EXISTS. Before this block, `src/game` carried 360 inline
 * `fontStyle: 'bold'` and 67 distinct raw `'#rrggbb'` text colours. That is
 * not a missing palette — `UI` above has been here the whole time — it is a
 * missing SCALE: every scene invented its own size and its own hue, so no
 * screen had a first thing to read. Adding more colours on top of that would
 * have made it worse. So: colour is chosen by what the text MEANS, and size
 * and weight travel WITH it, in one lookup a call site cannot mix wrongly.
 *
 * PRECEDENT, deliberately extended rather than competed with. `3c20c98` moved
 * the band banner's `counterTypeColor` / `leanColor` / `claimTextColor` /
 * `claimBarColor` into `ui/bandBannerViewModel.ts` specifically so the
 * renderer could not re-derive them. Same idea, one level down: a scene asks
 * for a ROLE, and the role decides the pixels. `ui/statRunModel.ts` is the
 * stat-run twin of `bandBannerViewModel` — it decides which INK a number gets
 * from what the number IS, and the Phaser renderer cannot second-guess it.
 * ========================================================================== */

/**
 * The dark grounds text actually lands on in this game. Exported because
 * "readable" is a claim about a PAIR, and the guard test
 * (`tests/game/textRoleAudit.test.ts`) checks every INK role against every one
 * of them — not against the one background that happened to look fine.
 */
export const TEXT_GROUNDS = {
  bg: UI.bg,
  panel: UI.panel,
  panelAlt: UI.panelAlt,
  panelMuted: UI.panelMuted,
} as const;

/**
 * SEMANTIC TEXT COLOUR ROLES. Pick by what the text MEANS, never by hue.
 *
 * Each comment carries the role's WORST contrast ratio across every
 * `TEXT_GROUNDS` entry, measured with the WCAG relative-luminance formula (see
 * the guard test, which recomputes them — these numbers are not decoration,
 * they are the reason each hex is the hex it is). AA for small text is 4.5:1,
 * and this game renders 9px type on a phone, so the floor here is 4.5 for
 * everything that is not on an accent fill — including `disabled`, which WCAG
 * exempts but a phone does not.
 */
export const INK = {
  /** The ONE thing that leads a screen or a block. Nothing else gets this. */
  primary: '#f2e4c0',
  /** Foreground copy that supports the lead — a title's second line, a
   * value that is real information but not the point of the screen. 11.57 */
  secondary: '#e8e0c8',
  /** A LABEL: the word that says WHICH fact this is. Never a value — the
   * whole point of the label/value split is that these two differ. 5.96 */
  label: '#95a3b8',
  /** Running prose, footnotes, hints. 6.07 */
  faint: '#9aa4b6',
  /** Text on a control the player cannot use right now — and the separator
   * between stat segments, which is exactly as important as a disabled
   * control. 4.73 */
  disabled: '#8290aa',
  /** Brand/section identity (bronze) — kickers, "CHOOSE YOUR NEXT STOP". 5.85 */
  accent: '#c69948',
  /** A SPENDABLE resource's amount: gold. The number the player watches. 8.15 */
  resource: '#e0b866',
  /** What keeps the run alive: LIVES, HP. 7.68 */
  vital: '#7cc98a',
  /**
   * A price, an outlay, a thing taken from you: PL cost, GOLD SPENT, DAMAGE
   * TAKEN, FIGHTS LOST. Distinct from `alarm`, which means ACT NOW. 6.02
   *
   * PUSHED ORANGE deliberately (was `#e0a94a`): at that value GOLD EARNED
   * (`resource`) and GOLD SPENT (`cost`) sat 32 apart in RGB and read as the
   * same amber in the ledger, so the two halves of the row it is meant to
   * separate still looked alike on the phone. `#e0913f` is 55 from `resource`
   * and still 41 from `alarm` — a cost must not be mistaken for either the
   * money you have or an emergency.
   */
  cost: '#e0913f',
  /** A positive delta: a gem's `+N`, a level buy, HEALING DONE. 8.55 */
  gain: '#9ad17a',
  /** ACT NOW: the last life, BOSS THIS WAVE. Reserved — if everything is an
   * alarm nothing is. String twin of `UI.textAlarm`. 5.29 */
  alarm: '#e8785e',
  /** How much ROOM there is: deck slots, gem sockets, card counts. 6.73 */
  capacity: '#7fb2d9',
  /** Dark ink for text sitting ON a bronze/accent fill. 7.10 on `UI.chip`. */
  onAccent: '#1a1208',
  /** Dark ink for text sitting ON a danger fill. 4.76 on `UI.bad`. */
  onAlarm: '#2a0d06',
} as const;

export type InkRole = keyof typeof INK;

/** Ink roles that are only ever drawn on a light accent/danger FILL, so the
 * dark-ground floor does not apply to them (they would fail it by design). */
export const ON_FILL_INK_ROLES: readonly InkRole[] = ['onAccent', 'onAlarm'];

/**
 * THE TYPE ROLES. Eleven, and each one earns its place from something the
 * screens genuinely do today — this set was read off the scenes, not invented:
 *
 *   display     the one word a full-screen moment is about (DEFEAT / RUN
 *               RETIRED). Serif, the biggest thing in the game.
 *   title       the screen's name in the run header (RUN / PREP · FIGHT).
 *   section     a panel's own header inside a screen (RUN LEDGER, RUN STATS,
 *               STAT ALLOCATION) — subordinate to `title` on purpose, because
 *               a panel is never the screen.
 *   kicker      the small all-caps accent line that introduces a block
 *               (WORLD1 / RUN MODE, CHOOSE YOUR NEXT STOP, MANDATORY).
 *   statValue   a NUMBER THAT MATTERS. Bold, and 1.4x its label.
 *   statLabel   which number it is. NOT bold, muted, small. The label exists
 *               to be skipped once the player knows the layout.
 *   statValueTight / statLabelTight
 *               the same pair for a row that physically cannot hold the big
 *               one (the prep hero band is 30px tall and carries six stats).
 *               The ratio drops to ~1.25 and the WEIGHT and INK carry the
 *               rest — this is the honest compromise, not a second opinion.
 *   body        running prose (a choice panel's detail line, dialog copy).
 *   label       a control's own text (BUTTON LABELS, tabs).
 *   micro       footnotes, disclosure hints, the smallest legible thing.
 *
 * Sizes are REAL CSS px on that profile's canvas — mobile and desktop cannot
 * share absolute sizes, which is why every role resolves per profile. Every
 * size below is a value from that profile's `LayoutProfile.font` ladder
 * (`layoutProfile.ts`), and the guard test asserts it: a role may not invent a
 * size the ladder does not already have.
 */
export type TextRole =
  | 'display' | 'title' | 'section' | 'kicker'
  | 'statValue' | 'statLabel' | 'statValueTight' | 'statLabelTight'
  | 'body' | 'label' | 'micro';

export interface TextRoleSpec {
  family: 'display' | 'body';
  /** Real CSS px per profile. Both must exist in that profile's font ladder. */
  size: { mobile: number; desktop: number };
  bold: boolean;
  ink: InkRole;
}

export const TEXT_ROLE_SPEC: Record<TextRole, TextRoleSpec> = {
  display:        { family: 'display', size: { mobile: 26, desktop: 56 }, bold: true,  ink: 'primary' },
  title:          { family: 'display', size: { mobile: 16, desktop: 26 }, bold: true,  ink: 'primary' },
  section:        { family: 'display', size: { mobile: 15, desktop: 19 }, bold: true,  ink: 'primary' },
  kicker:         { family: 'body',    size: { mobile: 9,  desktop: 12 }, bold: true,  ink: 'accent' },
  statValue:      { family: 'body',    size: { mobile: 13, desktop: 16 }, bold: true,  ink: 'primary' },
  statLabel:      { family: 'body',    size: { mobile: 9,  desktop: 11 }, bold: false, ink: 'label' },
  statValueTight: { family: 'body',    size: { mobile: 11, desktop: 14 }, bold: true,  ink: 'primary' },
  statLabelTight: { family: 'body',    size: { mobile: 9,  desktop: 11 }, bold: false, ink: 'label' },
  body:           { family: 'body',    size: { mobile: 12, desktop: 14 }, bold: false, ink: 'secondary' },
  label:          { family: 'body',    size: { mobile: 11, desktop: 12 }, bold: true,  ink: 'primary' },
  micro:          { family: 'body',    size: { mobile: 9,  desktop: 11 }, bold: false, ink: 'faint' },
};

/** The value/label PAIRS, so a caller asks for a density and cannot
 * accidentally pair a big value with a big label (which would erase the
 * hierarchy the pair exists to create). */
export const STAT_PAIR_ROLES = {
  /** A ROW with room: `lead` segments take these, the rest drop to `tight`, so
   * the lead really is bigger and not merely re-tinted. */
  roomy: { value: 'statValue', label: 'statLabel' },
  /** A ROW that cannot hold two value sizes without going ragged (the prep
   * hero band is 30px tall and carries six stats). Weight and ink carry the
   * hierarchy on their own here. */
  tight: { value: 'statValueTight', label: 'statLabelTight' },
  /**
   * A GRID of boxed cells (the run ledger). Same pair as `roomy`, but applied
   * UNIFORMLY regardless of tone — a cell already has its own box to mark it
   * out, so rank inside a grid is carried by INK alone and mixing 13px and
   * 11px values down a column just reads as a mistake.
   */
  grid: { value: 'statValue', label: 'statLabel' },
} as const satisfies Record<string, { value: TextRole; label: TextRole }>;

export type StatDensity = keyof typeof STAT_PAIR_ROLES;

/** What a resolved role hands a Phaser `add.text` call. Deliberately the exact
 * shape Phaser wants, so a call site is `textRole('title')` and nothing else —
 * no second lookup for the family, no third for the colour. */
export interface ResolvedTextStyle {
  fontFamily: string;
  fontSize: string;
  fontStyle: string;
  color: string;
}

/** Per-role overrides a call site may legitimately need. There is NO size
 * override on purpose: a call site that wants a different size wants a
 * different ROLE, and letting it pass px here is exactly how the 67 hexes and
 * 360 inline bolds accumulated. `ink` IS overridable — a number's colour is
 * decided by what it means (see `ui/statRunModel.ts`), which the role alone
 * cannot know. */
export interface TextRoleOverrides {
  ink?: InkRole;
}

export function textRoleFor(
  profile: 'mobile' | 'desktop',
  role: TextRole,
  overrides?: TextRoleOverrides,
): ResolvedTextStyle {
  const spec = TEXT_ROLE_SPEC[role];
  return {
    fontFamily: spec.family === 'display' ? FONT.display : FONT.body,
    fontSize: `${spec.size[profile]}px`,
    fontStyle: spec.bold ? 'bold' : 'normal',
    color: INK[overrides?.ink ?? spec.ink],
  };
}

/** The resolved style for the LIVE profile — what a scene calls. */
export function textRole(role: TextRole, overrides?: TextRoleOverrides): ResolvedTextStyle {
  return textRoleFor(ACTIVE_PROFILE.id, role, overrides);
}

/** A role's px size on the live profile — for the callers that must do their
 * own vertical arithmetic (row pitch, block height) before drawing. */
export function textRoleSize(role: TextRole): number {
  return TEXT_ROLE_SPEC[role].size[ACTIVE_PROFILE.id];
}

/**
 * Hard floor for the shared layout-audit auto-shrink helpers
 * (`auditControlLabel`/`auditTextBlock` in `ui/controlLayoutAudit.ts`).
 * Policy (2026-08, user-approved): text must never render smaller than this
 * — a call site's own `minFontSize` is now just a (possibly higher)
 * preference, this floor always wins. Once a label hits the floor and still
 * overflows, the helpers truncate with a trailing '…' instead of shrinking
 * further, so copy never drops to an unreadable 7-8px.
 */
export const TEXT_SHRINK_FLOOR_PX = 9;

export const DISPLAY_THEME = {
  spacing: {
    page: 18,
    panelHeaderH: 44,
    panelHeaderInset: 18,
    panelControlH: 24,
    panelToolbarGap: 12,
    panelToolbarPitch: 30,
    blockGap: 12,
    rowGap: 8,
    chipGap: 6,
  },
  chrome: {
    shadowAlpha: 0.28,
    panelAlpha: 0.92,
    lineAlpha: 0.42,
    frameInset: 7,
  },
  typography: {
    title: '13px',
    body: TYPE_SCALE.body,
    small: TYPE_SCALE.small,
    compact: '11px',
  },
  palette: {
    panel: UI.panel,
    panelAlt: UI.panelAlt,
    panelMuted: UI.panelMuted,
    chip: UI.chip,
    chipDark: UI.chipDark,
    border: UI.border,
    text: UI.text,
    textDim: UI.textDim,
    textSoft: UI.textSoft,
    good: UI.good,
    waiting: UI.waiting,
    bad: UI.bad,
  },
} as const;

export const FONT = {
  display: 'Georgia, Cambria, Times New Roman, serif',
  body: 'Verdana, Segoe UI, sans-serif',
};

/**
 * SCREEN — the drawable area, in design coordinates.
 *
 * `width`/`height` are LIVE GETTERS onto `viewport()`, not constants: the game
 * runs `Phaser.Scale.EXPAND` (see `viewport.ts`), so the canvas fills the
 * browser window and whichever axis has slack grows PAST the profile canvas.
 * They are floored at the profile's canvas size, so every layout that fits
 * today still fits — the extra space is a bonus, never a deficit.
 *
 * THE ONE RULE: read `SCREEN.width`/`SCREEN.height` at LAYOUT time (inside
 * `create()` / a render method). Capturing either into a module-level `const`
 * freezes it at the design size and silently opts that geometry out of ever
 * following the window.
 *
 * `safeX`/`safeTop`/`safeBottom` stay plain constants — insets are a property
 * of the device, not of the window size.
 */
export const SCREEN = {
  get width(): number { return viewport().width; },
  get height(): number { return viewport().height; },
  safeX: ACTIVE_PROFILE.safe.x,
  safeTop: ACTIVE_PROFILE.safe.top,
  safeBottom: ACTIVE_PROFILE.safe.bottom,
};

export const FOOTER_ACTION_LAYOUT = {
  height: 44,
  /** Bottom-anchored, so it must be a getter for the same reason `SCREEN.height` is. */
  get y(): number { return SCREEN.height - SCREEN.safeBottom - 44; },
  firstWidth: 164,
  secondX: 182,
  secondWidth: 152,
  thirdX: 352,
};

/** Shared geometry for the hero/enemy information blocks in Battle. */
export const BATTLE_SIDE_LAYOUT = {
  /**
   * THE shared left/right text inset for a battle side column — roster chip
   * text, the stat block, and the HP bar all align to this single value.
   * Never hardcode a per-text padding in BattleScene.
   */
  contentInset: 10,
  nameOffsetY: 12,
  summaryOffsetY: 32,
  attackOffsetY: 50,
  defenseOffsetY: 66,
  /** Shifted down (was 82) so the shield strip above the bar clears the DEF/MDEF line. */
  hpBarOffsetY: 90,
  hpTextOffsetY: 14,
  scoreOffsetY: 30,
  /**
   * Status icons share the score row (left-aligned; the score is
   * right-aligned) — one row lower collides with the first board slot.
   */
  statusOffsetY: 30,
  boardTopOffsetY: 136,
} as const;

/** Shared geometry and styling for the editable Deck Build rail. */
export const DECK_BUILD_LAYOUT = {
  panel: {
    boardHeight: 322,
    transferY: 526,
    transferHeight: 148,
    bagY: 698,
    bagHeight: 488,
  },
  rail: {
    boardOffsetY: 184,
    bagOffsetY: 168,
    slotNumberGap: 18,
  },
  socket: {
    size: 14,
    rotation: Math.PI / 4,
    strokeAlpha: 0.82,
    labelFontSize: '10px',
  },
} as const;

export const PREP_FIGHT_LAYOUT = {
  enemySkillRailOffsetY: 244,
  activeDeckRailOffsetY: 430,
  activeDeckIdentityOffsetY: 108,
  activeDeckPanelBottomInset: 18,
  identityStackRowGap: 18,
  identityStackTailGap: 8,
  railLabelGap: 58,
  activeDeckDividerGap: 18,
} as const;
