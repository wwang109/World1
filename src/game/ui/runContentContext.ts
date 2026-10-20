import type { EligibleRunView, RunContentView } from '../../run/online/types';
import type { SkillTier } from '../../engine/types';
export function pinnedSkill(content: RunContentView, id: string) { const skill = content.skills[id]; if (!skill) throw new Error('This run needs its original card definitions.'); return skill; }
export function pinnedCardText(content: RunContentView, id: string, tier: SkillTier): string { return content.cardText[`${id}:${tier}`] ?? 'Card text unavailable for this run.'; }
export function pinnedArt(view: EligibleRunView, kind: 'cards' | 'gems' | 'items' | 'events' | 'themes', id: string, mobile: boolean): string | null {
  const manifest = view.content.art;
  if (!manifest) return null;
  const lookup = kind === 'gems' ? view.content.gems[id]?.rarity ?? id : id;
  const logical = manifest[kind][lookup];
  if (!logical) return null;
  const platform = manifest.platforms[logical]?.[mobile ? 'mobile' : 'desktop'] ?? logical;
  const asset = manifest.assets.find(asset => asset.id === platform);
  return asset ? `${view.content.artBase.replace(/\/$/, '')}/${asset.path.replace(/^public\//, '')}` : null;
}
