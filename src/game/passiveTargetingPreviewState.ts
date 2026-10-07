import { skillBook } from '../data/skills';
import { HERO_BOARD_SLOTS } from '../data/heroes';
import type { OwnedBoardPiece } from './demoState';

export type PassiveTargetingMode = 'talent' | 'relic' | 'effects';
export type PassivePreviewSourceId = 'quick_preparation' | 'windbound_charm' | 'fortified_position' | 'guardians_seal';
export type PassivePreviewTarget = { kind: 'card'; instanceId: string } | { kind: 'slot'; slot: number };
export const passiveTargetingSources = Object.freeze([
  { id: 'quick_preparation', kind: 'talent', name: 'Quick Preparation', targetKind: 'card', value: 'WT −3',
    prompt: 'Choose an attack card', rule: 'Your chosen attack card gets WT −3 in combat.',
    iconId: 'source.quick_preparation.wings', attachAnimationId: 'motion.wing_sweep', activateAnimationId: 'motion.wing_sweep' },
  { id: 'windbound_charm', kind: 'relic', name: 'Windbound Charm', targetKind: 'slot', value: 'WT −3',
    prompt: 'Choose a slot', rule: 'Attack cards in your chosen slot get WT −3 in combat.',
    iconId: 'source.windbound_charm.spiral', attachAnimationId: 'motion.wind_spiral', activateAnimationId: 'motion.wind_spiral' },
  { id: 'fortified_position', kind: 'talent', name: 'Fortified Position', targetKind: 'slot', value: 'Shield power +5',
    prompt: 'Choose a slot', rule: 'Defensive cards in your chosen slot gain 5 shield power in combat.',
    iconId: 'source.fortified_position.bastion', attachAnimationId: 'motion.seal_pulse', activateAnimationId: 'motion.seal_pulse' },
  { id: 'guardians_seal', kind: 'relic', name: "Guardian's Seal", targetKind: 'automatic', value: 'Shield +8',
    prompt: '', rule: 'Start with 8 physical shield if your board has a defensive card.',
    iconId: 'source.guardians_seal.seal', attachAnimationId: 'motion.seal_pulse', activateAnimationId: 'motion.seal_pulse' },
] as const);
export const passiveTargetingPreviewBoard: readonly OwnedBoardPiece[] = [
  { instanceId: 'card_002', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
  { instanceId: 'card_001', skillId: 'war_banner', tier: 'bronze', slot: 1 },
  { instanceId: 'card_011', skillId: 'sword_slash', tier: 'bronze', slot: 2 },
  { instanceId: 'card_005', skillId: 'second_wind', tier: 'bronze', slot: 3 },
  { instanceId: 'card_004', skillId: 'iron_bulwark', tier: 'bronze', slot: 4 },
];
export const passiveTalentNodes = Object.freeze([
  { id: 'foundation', name: 'Foundation', cost: 0, requires: [], sourceId: null, targetKind: null },
  { id: 'quick_preparation', name: 'Quick Preparation', cost: 1, requires: ['foundation'], sourceId: 'quick_preparation', targetKind: 'card' },
  { id: 'fortified_position', name: 'Fortified Position', cost: 1, requires: ['foundation'], sourceId: 'fortified_position', targetKind: 'slot' },
] as const);
interface ConfirmedTarget { sourceId: PassivePreviewSourceId; target: PassivePreviewTarget }
export const passiveTargetingPreview: {
  mode: PassiveTargetingMode | null;
  pendingTarget: ConfirmedTarget | null;
  confirmedTargets: ConfirmedTarget[];
  stage: 'tree' | 'targeting' | 'effects' | 'relic';
  talentPoints: number;
  unlockedNodeIds: string[];
  pendingUnlockNodeId: string | null;
} = { mode: null, stage: 'tree', pendingTarget: null, confirmedTargets: [], talentPoints: 1, unlockedNodeIds: ['foundation'], pendingUnlockNodeId: null };
const STORAGE_KEY = 'world1.dev.passive-targeting.v2';
function validTarget(sourceId: PassivePreviewSourceId, value: unknown): value is PassivePreviewTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (sourceId === 'quick_preparation') return Object.keys(target).every(key => key === 'kind' || key === 'instanceId')
    && target.kind === 'card' && typeof target.instanceId === 'string' && target.instanceId.trim().length > 0 && target.instanceId.length <= 120;
  return (sourceId === 'windbound_charm' || sourceId === 'fortified_position') && Object.keys(target).every(key => key === 'kind' || key === 'slot')
    && target.kind === 'slot' && Number.isSafeInteger(target.slot) && (target.slot as number) >= 0 && (target.slot as number) < HERO_BOARD_SLOTS;
}
function restore(): { confirmedTargets: ConfirmedTarget[]; talentPoints: number; unlockedNodeIds: string[] } {
  const empty = { confirmedTargets: [] as ConfirmedTarget[], talentPoints: 1, unlockedNodeIds: ['foundation'] };
  try {
    if (typeof sessionStorage === 'undefined') return empty;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return empty;
    const doc = JSON.parse(saved) as Record<string, unknown>;
    if (!doc || doc.schemaVersion !== 2 || Object.keys(doc).some(key => !['schemaVersion', 'confirmedTargets', 'talentPoints', 'unlockedNodeIds'].includes(key)) || !Array.isArray(doc.confirmedTargets)
      || !Number.isSafeInteger(doc.talentPoints) || (doc.talentPoints as number) < 0 || (doc.talentPoints as number) > 999
      || !Array.isArray(doc.unlockedNodeIds) || !doc.unlockedNodeIds.includes('foundation') || new Set(doc.unlockedNodeIds).size !== doc.unlockedNodeIds.length
      || doc.unlockedNodeIds.some(id => !passiveTalentNodes.some(node => node.id === id))) return empty;
    const ids = new Set<string>();
    for (const raw of doc.confirmedTargets) {
      if (!raw || typeof raw !== 'object' || Object.keys(raw).some(key => key !== 'sourceId' && key !== 'target') || ids.has(raw.sourceId) || !validTarget(raw.sourceId, raw.target)) return empty;
      if ((raw.sourceId === 'quick_preparation' || raw.sourceId === 'fortified_position') && !doc.unlockedNodeIds.includes(raw.sourceId)) return empty;
      ids.add(raw.sourceId);
    }
    for (const id of doc.unlockedNodeIds) if (id !== 'foundation' && !ids.has(id)) return empty;
    return { confirmedTargets: doc.confirmedTargets as ConfirmedTarget[], talentPoints: doc.talentPoints as number, unlockedNodeIds: doc.unlockedNodeIds as string[] };
  } catch { return empty; }
}
function persist(): void {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, confirmedTargets: passiveTargetingPreview.confirmedTargets, talentPoints: passiveTargetingPreview.talentPoints, unlockedNodeIds: passiveTargetingPreview.unlockedNodeIds })); }
  catch { /* Preview state still works in memory when browser storage is unavailable. */ }
}
export function configurePassiveTargetingPreview(mode: PassiveTargetingMode | null, reset = false): void {
  passiveTargetingPreview.mode = mode;
  passiveTargetingPreview.pendingTarget = null;
  passiveTargetingPreview.stage = mode === 'effects' ? 'effects' : mode === 'relic' ? 'relic' : 'tree';
  passiveTargetingPreview.pendingUnlockNodeId = null;
  const saved = reset ? { confirmedTargets: [], talentPoints: 1, unlockedNodeIds: ['foundation'] } : restore();
  passiveTargetingPreview.confirmedTargets = saved.confirmedTargets;
  passiveTargetingPreview.talentPoints = saved.talentPoints;
  passiveTargetingPreview.unlockedNodeIds = saved.unlockedNodeIds;
  if (reset) persist();
}
export function selectPassivePreviewTarget(sourceId: PassivePreviewSourceId, target: PassivePreviewTarget): boolean {
  if (!passiveTargetingPreview.mode || (passiveTargetingPreview.stage !== 'targeting' && passiveTargetingPreview.mode !== 'relic') || !validTarget(sourceId, target)) return false;
  passiveTargetingPreview.pendingTarget = { sourceId, target: { ...target } };
  return true;
}
export function confirmPassivePreviewTarget(sourceId: PassivePreviewSourceId, pieces: readonly OwnedBoardPiece[]): boolean {
  const pending = passiveTargetingPreview.pendingTarget;
  if (!pending || pending.sourceId !== sourceId || !validTarget(sourceId, pending.target)) return false;
  if (pending.target.kind === 'card') {
    const instanceId = pending.target.instanceId;
    const piece = pieces.find(piece => piece.instanceId === instanceId);
    if (!piece || !skillBook[piece.skillId]?.archetypes.includes('offense')) return false;
  }
  const node = passiveTalentNodes.find(node => node.id === passiveTargetingPreview.pendingUnlockNodeId);
  if (passiveTargetingPreview.mode === 'talent') {
    if (!node || node.sourceId !== sourceId || passiveTalentNodeStatus(node.id) !== 'available') return false;
    passiveTargetingPreview.talentPoints -= node.cost;
    passiveTargetingPreview.unlockedNodeIds.push(node.id);
  }
  passiveTargetingPreview.confirmedTargets = [
    ...passiveTargetingPreview.confirmedTargets.filter(entry => entry.sourceId !== sourceId),
    { sourceId, target: { ...pending.target } },
  ];
  passiveTargetingPreview.pendingTarget = null;
  passiveTargetingPreview.pendingUnlockNodeId = null;
  passiveTargetingPreview.stage = passiveTargetingPreview.mode === 'talent' ? 'tree' : 'effects';
  persist();
  return true;
}
export function cancelPassivePreviewTarget(): void {
  passiveTargetingPreview.pendingTarget = null; passiveTargetingPreview.pendingUnlockNodeId = null;
  passiveTargetingPreview.stage = passiveTargetingPreview.mode === 'talent' ? 'tree' : 'relic';
}
export function passiveTalentNodeStatus(id: string): 'unlocked' | 'available' | 'locked' | 'unaffordable' {
  const node = passiveTalentNodes.find(node => node.id === id);
  if (!node) return 'locked';
  if (passiveTargetingPreview.unlockedNodeIds.includes(node.id)) return 'unlocked';
  if (node.requires.some(id => !passiveTargetingPreview.unlockedNodeIds.includes(id))) return 'locked';
  return passiveTargetingPreview.talentPoints >= node.cost ? 'available' : 'unaffordable';
}
export function grantPassivePreviewTalentPoint(_kind: 'levelUp' | 'skillSphere'): void {
  if (passiveTargetingPreview.mode && passiveTargetingPreview.talentPoints < 999) { passiveTargetingPreview.talentPoints++; persist(); }
}
export function beginPassiveTalentUnlock(nodeId: string): boolean {
  const node = passiveTalentNodes.find(node => node.id === nodeId);
  if (passiveTargetingPreview.mode !== 'talent' || !node?.sourceId || passiveTalentNodeStatus(nodeId) !== 'available') return false;
  passiveTargetingPreview.pendingUnlockNodeId = nodeId; passiveTargetingPreview.pendingTarget = null; passiveTargetingPreview.stage = 'targeting';
  return true;
}
export function passivePreviewEffect(sourceId: PassivePreviewSourceId, pieces: readonly OwnedBoardPiece[]) {
  const confirmedTarget = passiveTargetingPreview.confirmedTargets.find(entry => entry.sourceId === sourceId)?.target ?? null;
  if (sourceId === 'guardians_seal') {
    const active = pieces.some(piece => skillBook[piece.skillId]?.archetypes.includes('defensive'));
    return { active, reason: active ? '' : 'No defensive card on your board.', targetSlots: [] as number[], targetName: 'Your shield',
      summary: active ? 'Physical shield +8 at battle start.' : 'No defensive card on your board.', confirmedTarget };
  }
  if (!confirmedTarget) return { active: false, reason: 'No target chosen.', targetSlots: [] as number[], targetName: '', summary: 'No target chosen.', confirmedTarget };
  const piece = confirmedTarget.kind === 'card'
    ? pieces.find(piece => piece.instanceId === confirmedTarget.instanceId)
    : pieces.find(piece => piece.slot <= confirmedTarget.slot && piece.slot + (skillBook[piece.skillId]?.size ?? 0) > confirmedTarget.slot);
  const family = sourceId === 'fortified_position' ? 'defensive' : 'offense';
  const active = !!piece && !!skillBook[piece.skillId]?.archetypes.includes(family);
  const targetName = confirmedTarget.kind === 'slot' ? `Slot ${confirmedTarget.slot + 1}` : piece ? skillBook[piece.skillId]!.name : 'Chosen card';
  const reason = active ? '' : confirmedTarget.kind === 'card' ? 'Chosen card is not on the board.' : `No ${family === 'offense' ? 'attack' : 'defensive'} card in ${targetName}.`;
  return { active, reason, targetSlots: active && piece ? [piece.slot] : [] as number[], targetName,
    summary: active && piece ? `${skillBook[piece.skillId]!.name} · Slot ${piece.slot + 1} · ${sourceId === 'fortified_position' ? 'Shield power +5' : 'WT −3'}` : reason, confirmedTarget };
}
