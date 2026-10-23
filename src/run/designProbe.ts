import { skillBook } from '../data/skills';
import { skillDefOfDocument, validateSkillDocument } from '../data/validateSkillContent';
import { TIER_ORDER, type BoardPiece, type CombatantSetup, type SkillDef, type SkillTier } from '../engine/types';
import type { Allocation } from './leveling';

export const DESIGN_PROBE_TURNS = 16;
export const DESIGN_PROBE_SEED = 1;
export const DESIGN_PROBE_HERO_LEVEL = 1;
export const DESIGN_PROBE_HERO_ALLOCATION: Allocation = {};
export const DESIGN_PROBE_FOE_CARD = 'sword_slash';
export const DESIGN_PROBE_FOE_HP = 30_000;
export const DESIGN_BATTLE_MAX_BYTES = 64_000;

export interface DesignBattleRequest {
  document: unknown;
  tier: SkillTier;
}

interface DocumentCard {
  id: string;
  versions: Array<{ version: number; def: Record<string, unknown> }>;
}

export function designProbeFoeSetup(): CombatantSetup {
  return {
    name: 'Training Dummy',
    stats: { maxHp: DESIGN_PROBE_FOE_HP, hp: DESIGN_PROBE_FOE_HP, attack: 1, magicPower: 0, armor: 0, magicResist: 0, speed: 10 },
    boardSize: 1,
    pieces: [{ skillId: DESIGN_PROBE_FOE_CARD, slot: 0 }],
  };
}

export function designProbeHeroPieces(skill: SkillDef, tier: SkillTier): BoardPiece[] {
  return [{ skillId: skill.id, slot: 0, tier }];
}

export function designProbeSkill(request: DesignBattleRequest): SkillDef {
  if (request === null || typeof request !== 'object' || !TIER_ORDER.includes(request.tier)) {
    throw new Error('design battle: expected { document, tier }');
  }
  const problems = validateSkillDocument(request.document);
  if (problems.length > 0) throw new Error(`draft card: ${problems[0]!.where}: ${problems[0]!.message}`);
  const cards = (request.document as { cards: DocumentCard[] }).cards;
  if (cards.length !== 1) throw new Error('draft card: send exactly one card');
  const card = cards[0]!;
  if (skillBook[card.id] !== undefined) throw new Error(`draft card: ${card.id} is already a catalog card`);
  let latest = card.versions[0]!;
  for (const version of card.versions) if (version.version > latest.version) latest = version;
  const skill = skillDefOfDocument(card.id, latest.def);
  if (TIER_ORDER.indexOf(request.tier) < TIER_ORDER.indexOf(skill.tier)) {
    throw new Error(`draft card: ${request.tier} is below the card's base tier ${skill.tier}`);
  }
  return skill;
}
