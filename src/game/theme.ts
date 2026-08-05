import type { Archetype, Property, Rarity, SkillTier } from '../engine/types';
import { ACTIVE_PROFILE } from './layoutProfile';

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
  textSoft: '#8d724a',
  /** Bronze accent as a text color (string twin of `chip`). */
  textAccent: '#c69948',
  /** Dark ink for text sitting on a bronze chip/button fill. */
  textOnChip: '#1a1208',
  /** Mobile scenes' de-facto primary/heading text tone (cream, cooler than `text`). */
  textBright: '#e8e0c8',
  /** Secondary/informational muted text (mobile scenes). */
  textMuted: '#8a94a6',
  /** A second, slightly lighter muted tone used for stat/footnote lines (mobile scenes). */
  textFootnote: '#9aa4b6',
  /** Disabled-control text (mobile scenes). */
  textDisabled: '#5a6880',
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

// SCREEN reflects the ACTIVE layout profile's canvas (mobile-first). The old
// desktop scenes still read this; a dedicated desktop build comes later.
export const SCREEN = {
  width: ACTIVE_PROFILE.canvas.width,
  height: ACTIVE_PROFILE.canvas.height,
  safeX: ACTIVE_PROFILE.safe.x,
  safeTop: ACTIVE_PROFILE.safe.top,
  safeBottom: ACTIVE_PROFILE.safe.bottom,
};

export const FOOTER_ACTION_LAYOUT = {
  height: 44,
  y: SCREEN.height - SCREEN.safeBottom - 44,
  firstWidth: 164,
  secondX: 182,
  secondWidth: 152,
  thirdX: 352,
} as const;

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
