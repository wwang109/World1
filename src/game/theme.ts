import type { Archetype, Property } from '../engine/types';

export const PROPERTY_COLOR: Record<Property, number> = {
  physical: 0xd98a3d, // orange
  magical: 0x5a8dee, // blue
  true: 0xe8d5a0, // gold-white
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

export const ARCHETYPE_COLOR: Record<Archetype, number> = {
  offense: 0xcc4444,
  defensive: 0x4a7ab5,
  healing: 0x4caf6e,
  support: 0xc9a227,
  debuff: 0x9b59b6,
};

/** Combat-log/status-bar glyphs for buffs/debuffs/DoTs and the defensive keywords. */
export const STATUS_ICON: Record<string, string> = {
  poison: '☠',
  burn: '🔥',
  stun: '💫',
  buff: '▲',
  debuff: '▼',
  guard: '⛨',
  negate: '⦵',
};

export const UI = {
  bg: 0x0e0e12,
  panel: 0x1a1a22,
  panelLight: 0x24242e,
  slot: 0x2a2a36,
  slotHover: 0x3a3a4a,
  good: 0x4caf6e,
  bad: 0xcc4444,
  text: '#e8e8f0',
  textDim: '#8a8a9a',
  hp: 0x4caf6e,
  hpBack: 0x333340,
};
