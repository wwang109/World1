import { TIER_ORDER, type SkillTier } from '../../engine/types';
import type { CardDesignerDraft } from './cardDesignerState';

export const CARD_DESIGNER_DRAFT_KEY = 'world1:card-designer-draft:v1';
const MAX_BYTES = 300_000;

export interface SavedCardDesignerDraft {
  version: 1;
  draft: CardDesignerDraft;
  selectedTier: SkillTier;
  templateId?: string;
  edited: boolean;
}

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Recovery = { status: 'recovered'; value: SavedCardDesignerDraft } | { status: 'empty' | 'corrupt' | 'unavailable' };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 2000 && value.every((entry) => safeJson(entry, depth + 1));
  return record(value) && Object.keys(value).length <= 1000
    && Object.entries(value).every(([key, entry]) => !['__proto__', 'constructor', 'prototype'].includes(key) && safeJson(entry, depth + 1));
}

function effectsShape(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => record(entry) && typeof entry.kind === 'string');
}

export function isSavedCardDesignerDraft(value: unknown): value is SavedCardDesignerDraft {
  if (!record(value) || value.version !== 1 || !record(value.draft) || !record(value.draft.def)) return false;
  const def = value.draft.def;
  return typeof value.draft.id === 'string' && value.draft.id.length <= 500
    && typeof def.name === 'string' && def.name.length <= 10_000
    && ['property', 'rarity'].every((key) => typeof def[key] === 'string')
    && typeof def.size === 'number' && Number.isFinite(def.size)
    && Array.isArray(def.archetypes) && def.archetypes.every((entry) => typeof entry === 'string')
    && effectsShape(def.effects) && (def.aura === undefined || record(def.aura))
    && (def.tierUpgrades === undefined || (record(def.tierUpgrades)
      && Object.entries(def.tierUpgrades).every(([tier, upgrade]) => TIER_ORDER.includes(tier as SkillTier) && record(upgrade)
        && (upgrade.effects === undefined || effectsShape(upgrade.effects)) && (upgrade.aura === undefined || record(upgrade.aura)))))
    && TIER_ORDER.includes(def.tier as SkillTier) && TIER_ORDER.includes(value.selectedTier as SkillTier)
    && TIER_ORDER.indexOf(value.selectedTier as SkillTier) >= TIER_ORDER.indexOf(def.tier as SkillTier)
    && typeof value.edited === 'boolean' && (value.templateId === undefined || typeof value.templateId === 'string')
    && safeJson(value);
}

export function recoverCardDesignerDraft(storage?: StoragePort): Recovery {
  try {
    const text = (storage ?? localStorage).getItem(CARD_DESIGNER_DRAFT_KEY);
    if (text === null) return { status: 'empty' };
    if (text.length > MAX_BYTES) return { status: 'corrupt' };
    let value: unknown;
    try { value = JSON.parse(text); } catch { return { status: 'corrupt' }; }
    return isSavedCardDesignerDraft(value) ? { status: 'recovered', value } : { status: 'corrupt' };
  } catch { return { status: 'unavailable' }; }
}

export function saveCardDesignerDraft(value: SavedCardDesignerDraft, storage?: StoragePort): boolean {
  try {
    const text = JSON.stringify(value);
    if (text.length > MAX_BYTES || !isSavedCardDesignerDraft(JSON.parse(text))) return false;
    (storage ?? localStorage).setItem(CARD_DESIGNER_DRAFT_KEY, text);
    return true;
  } catch { return false; }
}

export function clearCardDesignerDraft(storage?: StoragePort): boolean {
  try { (storage ?? localStorage).removeItem(CARD_DESIGNER_DRAFT_KEY); return true; }
  catch { return false; }
}
