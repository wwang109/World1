import type { Archetype, SkillDef, SkillTier } from '../../engine/types';
import {
  ARCHETYPE_COLOR,
  ELEMENT_COLOR,
  PROPERTY_COLOR,
  PROPERTY_LABEL,
  TIER_COLOR,
  UI,
  WEAPON_COLOR,
} from '../theme';

export type CardIconKey =
  | 'axe'
  | 'bow'
  | 'dark'
  | 'fangs'
  | 'fire'
  | 'frost'
  | 'healing'
  | 'holy'
  | 'lance'
  | 'lightning'
  | 'nature'
  | 'offense'
  | 'physical'
  | 'defensive'
  | 'support'
  | 'sword'
  | 'true'
  | 'debuff'
  | 'magical';

export interface CardTypeBadge {
  color: number;
  iconKey: CardIconKey;
  label: string;
}

export interface ArchetypeBadge {
  archetype: Archetype;
  color: number;
  iconKey: CardIconKey;
}

export interface TierPlateStyle {
  edge: number;
  fill: number;
  highlight: number;
}

const TIER_PLATE_STYLE: Record<SkillTier, TierPlateStyle> = {
  bronze: { edge: 0xd4984d, fill: 0x3b210f, highlight: 0xf0c37a },
  silver: { edge: 0xc8d3de, fill: 0x273240, highlight: 0xf5f8fb },
  gold: { edge: 0xf0ca5c, fill: 0x44320b, highlight: 0xffeb9b },
  diamond: { edge: 0x58d7f4, fill: 0x0b3f54, highlight: 0xc7f7ff },
};

const ELEMENT_ICON_KEY: Record<string, CardIconKey> = {
  fire: 'fire',
  frost: 'frost',
  lightning: 'lightning',
  nature: 'nature',
  holy: 'holy',
  dark: 'dark',
};

const WEAPON_ICON_KEY: Record<string, CardIconKey> = {
  sword: 'sword',
  axe: 'axe',
  lance: 'lance',
  bow: 'bow',
  beast: 'fangs',
};

const ARCHETYPE_ICON_KEY: Record<Archetype, CardIconKey> = {
  offense: 'offense',
  defensive: 'defensive',
  healing: 'healing',
  support: 'support',
  debuff: 'debuff',
};

export function cardTypeBadge(skill: SkillDef): CardTypeBadge {
  if (skill.element) {
    return {
      color: ELEMENT_COLOR[skill.element] ?? PROPERTY_COLOR[skill.property],
      iconKey: ELEMENT_ICON_KEY[skill.element] ?? 'magical',
      label: skill.element.toUpperCase(),
    };
  }

  if (skill.weapon) {
    return {
      color: WEAPON_COLOR[skill.weapon] ?? PROPERTY_COLOR[skill.property],
      iconKey: WEAPON_ICON_KEY[skill.weapon] ?? 'physical',
      label: skill.weapon === 'beast' ? 'FANGS' : skill.weapon.toUpperCase(),
    };
  }

  return {
    color: PROPERTY_COLOR[skill.property],
    iconKey: skill.property,
    label: PROPERTY_LABEL[skill.property],
  };
}

export function archetypeBadges(skill: SkillDef): ArchetypeBadge[] {
  return skill.archetypes.slice(0, 3).map((archetype) => ({
    archetype,
    color: ARCHETYPE_COLOR[archetype] ?? UI.chip,
    iconKey: ARCHETYPE_ICON_KEY[archetype],
  }));
}

export function tierPlateColor(tier: SkillTier): number {
  return TIER_COLOR[tier];
}

export function tierPlateStyle(tier: SkillTier): TierPlateStyle {
  return TIER_PLATE_STYLE[tier];
}

const TEMPLATE_BADGE_TEXTURE_KEY: Partial<Record<CardIconKey, string>> = {
  sword: 'card-badge:template:sword',
  lance: 'card-badge:template:lance',
  axe: 'card-badge:template:axe',
  bow: 'card-badge:template:bow',
  fangs: 'card-badge:template:fangs',
  fire: 'card-badge:template:fire',
  frost: 'card-badge:template:frost',
  lightning: 'card-badge:template:lightning',
  nature: 'card-badge:template:nature',
  holy: 'card-badge:template:holy',
  dark: 'card-badge:template:dark',
  offense: 'card-badge:template:offense',
  defensive: 'card-badge:template:defensive',
  healing: 'card-badge:template:healing',
  support: 'card-badge:template:support',
  debuff: 'card-badge:template:debuff',
};

export function templateBadgeTextureKey(iconKey: CardIconKey): string | undefined {
  return TEMPLATE_BADGE_TEXTURE_KEY[iconKey];
}

/**
 * The look of a card's art region when there is no art to draw — either the
 * skill has no catalogue entry (94 of 166 skills today) or its texture is
 * still streaming in (`cardArtLoader.ts`). ONE style function serves both,
 * which is the point: "art not loaded yet" and "art does not exist" must not
 * be two different-looking states.
 *
 * It is derived, never authored: the tint is the card's own identity color
 * (element > weapon > property — the same precedence `cardTypeBadge` uses for
 * the badge), and the emblem is that badge's already-boot-loaded texture. So
 * a placeholder always reads as THIS card, not as a generic empty slab.
 */
export interface CardArtPlaceholderStyle {
  /** Identity color the panel is tinted with. */
  tint: number;
  /** Ghosted emblem drawn over the panel, when the badge art exists. */
  emblemTextureKey: string | undefined;
}

export function cardArtPlaceholderStyle(skill: SkillDef): CardArtPlaceholderStyle {
  const badge = cardTypeBadge(skill);
  return {
    tint: badge.color,
    emblemTextureKey: templateBadgeTextureKey(badge.iconKey),
  };
}
