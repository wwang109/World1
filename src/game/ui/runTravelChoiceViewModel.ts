import { enemies } from '../../data/enemies';
import type { LoadedEventDef } from '../../data/eventsContent';
import { shopCatalog } from '../../data/shopTypes';
import { skillBook } from '../../data/skills';
import { BAND_WAVES, biomeFor } from '../../run/biome';
import { battleGoldReward } from '../../run/shop';
import type { EncounterPack } from '../../run/encounter';
import { eventRequirementReceipt } from '../../run/eventRequirementReceipt';
import { summarizeEventReward } from '../../run/eventRewardSummary';
import type { RunNode, RunNodeKind, RunState } from '../../run/runState';
import { GEM_RARITY_COLOR, INK, UI, type InkRole } from '../theme';
import { counterTypeColor } from './bandBannerViewModel';
import { eventThemeBlurb } from './eventThemeBlurb';
import { biomeArtKey, eventArtKey, RUN_ART_KEYS, shopArtKey } from './runArtKeys';
import { shopMapFooter } from './shopMapFooter';

export interface RunTravelChoiceFooterSegment {
  text: string;
  /** Always an audited `INK` role value — legible on its own. */
  textColor: string;
  /** A small colour patch beside the text (never the text colour itself) —
   * the card-type or biome-lean identity, straight from `theme.ts`'s fill
   * palettes with no legibility obligation of its own. */
  swatchColor?: number;
}

export interface RunTravelChoiceViewModel {
  nodeId: string;
  kind: RunNodeKind;
  title: string;
  detail: string;
  footer?: string;
  footerInk?: InkRole;
  /** Present only for an event's reward/biome-exclusive callout — each
   * segment carries its own colour, so the renderer draws one `Text` per
   * segment instead of tinting `footer` as a single run. */
  footerSegments?: readonly RunTravelChoiceFooterSegment[];
  artKey?: string;
  accent: number;
  enabled: boolean;
  dossier?: {
    difficulty: string;
    roster: { name: string; level: number; tier: string; archetypes: string }[];
    danger: string;
    reward: string;
  };
  event?: {
    eventId: string;
    chainUnlocked: boolean;
    requirementLines: readonly string[];
  };
}

const KIND_COLOR: Record<RunNodeKind, number> = {
  fight: 0x4a7ab5,
  event: UI.chip,
  shop: UI.good,
  boss: UI.bad,
};

/** Destination context distinguishes the regional finale from an earlier
 * boss-titled roll without changing either encounter's mechanics. */
export function encounterDestinationLabel(node: RunNode, encounter: EncounterPack | null): string | null {
  if (node.kind === 'boss' && node.wave % BAND_WAVES === 0) return 'REGION BOSS';
  if (encounter?.units.some((unit) => unit.title === 'boss')) return 'MINIBOSS ENCOUNTER';
  return null;
}

/** The persisted middle tier remains `standard`; its player label is MEDIUM.
 * Re-exported by runStore for existing scene callers. */
export const FIGHT_TIER_LABEL: Record<'easy' | 'standard' | 'hard', string> = {
  easy: 'EASY',
  standard: 'MEDIUM',
  hard: 'HARD',
};

/** Shared map hint: a solo names its title, a pack leads with its count and
 * representative first foe. Optional risk-tier prefix preserves standalone
 * callers; bosses omit it. Re-exported by runStore for compatibility. */
export function encounterHintDetail(pack: EncounterPack, fightOption?: 'easy' | 'standard' | 'hard'): string {
  const primary = pack.units[0]!;
  const name = enemies[primary.enemyId]?.name ?? primary.enemyId;
  const tierPrefix = fightOption ? `${FIGHT_TIER_LABEL[fightOption]} · ` : '';
  if (pack.variant === 'solo') {
    return `${tierPrefix}${name} · LV ${primary.effectiveLevel} · ${primary.title.toUpperCase()}`;
  }
  return `${tierPrefix}PACK OF ${pack.units.length} · ${name} · LV ${primary.effectiveLevel}`;
}

/** Pure route-card data. Preview selection and encounter rolls belong to
 * their existing authorities; this model only presents the supplied facts. */
export function buildRunTravelChoiceViewModel(
  state: RunState,
  node: RunNode,
  previewEvent: LoadedEventDef | null,
  encounter: EncounterPack | null,
): RunTravelChoiceViewModel {
  const common = {
    nodeId: node.id,
    kind: node.kind,
    accent: KIND_COLOR[node.kind],
    enabled: true,
  };
  if (node.kind === 'shop') {
    const shop = node.shopId ? shopCatalog[node.shopId] : undefined;
    return {
      ...common,
      title: shop ? `SHOP · ${shop.name.toUpperCase()}` : 'SHOP',
      detail: shop?.tagline ?? '',
      footer: shop && node.shopId ? shopMapFooter(node.shopId) : undefined,
      artKey: shopArtKey(node.shopId ?? ''),
    };
  }
  if (node.kind === 'fight' || node.kind === 'boss') {
    const biome = biomeFor(state.seed, node.wave, node.biomeId);
    const dossier = node.kind === 'fight' && encounter ? {
      difficulty: node.fightOption ? FIGHT_TIER_LABEL[node.fightOption] : '',
      roster: encounter.units.map((unit) => {
        const cards = unit.setup.pieces.flatMap((piece) => skillBook[piece.skillId] ? [skillBook[piece.skillId]!] : []);
        const archetypes = [...new Set(cards.flatMap((card) => card.archetypes))];
        return {
          name: enemies[unit.enemyId]?.name ?? unit.enemyId,
          level: unit.effectiveLevel,
          tier: unit.title === 'boss' ? 'MINIBOSS' : unit.title.toUpperCase(),
          archetypes: archetypes.join(' / ').toUpperCase(),
        };
      }),
      danger: `${encounter.units.length} ${encounter.units.length === 1 ? 'FOE' : 'FOES'} · ${encounter.units.reduce((sum, unit) => sum + unit.setup.pieces.length, 0)} CARDS`,
      reward: (() => {
        const reward = battleGoldReward(encounter.units.map((unit) => ({
          level: unit.level, title: unit.title, rank: unit.baseRank, modifiers: unit.modifiers,
        })), state.heroLevel);
        return `VICTORY · +${reward.base + reward.winBonus} GOLD`;
      })(),
    } : undefined;
    return {
      ...common,
      title: encounterDestinationLabel(node, encounter)
        ?? (node.fightOption ? `FIGHT · ${FIGHT_TIER_LABEL[node.fightOption]}` : 'FIGHT'),
      detail: encounter ? encounterHintDetail(encounter, node.kind === 'fight' ? node.fightOption : undefined) : '',
      ...(dossier ? { dossier, artKey: biomeArtKey(biome.id) } : {}),
      ...(node.kind === 'boss' ? { artKey: RUN_ART_KEYS.icon.bossSkull } : {}),
    };
  }
  const detail = eventThemeBlurb(node.eventTheme);
  if (previewEvent) {
    const requirementLines = eventRequirementReceipt(state, previewEvent);
    const reward = summarizeEventReward(previewEvent);
    const footerSegments: RunTravelChoiceFooterSegment[] = [];
    if (reward.rewardChip) {
      footerSegments.push({ text: reward.rewardChip, textColor: INK.secondary });
    }
    if (reward.biomeExclusive) {
      const biome = biomeFor(state.seed, node.wave, node.biomeId);
      footerSegments.push({ text: 'BIOME EXCLUSIVE', textColor: INK.accent, swatchColor: counterTypeColor(biome.lean.type) });
    }
    if (reward.rare) {
      footerSegments.push({ text: 'RARE', textColor: INK.accent, swatchColor: GEM_RARITY_COLOR.rare });
    }
    return {
      ...common,
      title: `EVENT · ${previewEvent.title.toUpperCase()}`,
      detail,
      footer: footerSegments.length > 0 ? footerSegments.map((segment) => segment.text).join(' · ') : undefined,
      footerSegments: footerSegments.length > 0 ? footerSegments : undefined,
      artKey: eventArtKey(previewEvent.theme, previewEvent.artId),
      event: { eventId: previewEvent.id, chainUnlocked: requirementLines.length > 0, requirementLines },
    };
  }
  return {
    ...common,
    title: node.eventTheme ? `EVENT · ${node.eventTheme.toUpperCase()}` : 'EVENT',
    detail,
    artKey: eventArtKey(node.eventTheme ?? 'training'),
  };
}
