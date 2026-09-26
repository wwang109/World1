import { hashSeed, Rng } from '../engine/rng';
import { nodeById, type RunState } from './runState';
import { ghostBandOf, type GhostRecord } from './ghost';

export const GHOST_SUBSTITUTE_CHANCE_PCT = 25;

// Own hash domain — spends no draw off rollEncounter's node Rng.
export function rollGhostSubstitute(seed: number, nodeId: string): boolean {
  const rng = new Rng(hashSeed('ghostSub', seed, nodeId));
  return rng.int(100) < GHOST_SUBSTITUTE_CHANCE_PCT;
}

export function shouldRollGhostSubstitute(state: RunState, nodeId: string): boolean {
  const active = state.activeGhostFight;
  if (active && active.nodeId === nodeId && active.role === 'substitute') return false;
  if ((state.ghostSubstituteMissNodeIds ?? []).includes(nodeId)) return false;
  return rollGhostSubstitute(state.seed, nodeId);
}

export function pinSubstituteGhost(state: RunState, nodeId: string, ghost: GhostRecord): RunState {
  return { ...state, activeGhostFight: { nodeId, ghost, role: 'substitute' } };
}

// A transient fetch failure must NOT call this — it stays retryable.
export function markGhostSubstituteMiss(state: RunState, nodeId: string): RunState {
  const ids = state.ghostSubstituteMissNodeIds ?? [];
  if (ids.includes(nodeId)) return state;
  return { ...state, ghostSubstituteMissNodeIds: [...ids, nodeId] };
}

export function canOfferExtraGhostFight(state: RunState, nodeId: string): boolean {
  if (state.ghostBossOffer != null) return false;
  if (state.activeGhostFight?.role === 'extra') return false;
  return !(state.ghostExtraDecidedNodeIds ?? []).includes(nodeId);
}

export function offerExtraGhostFight(state: RunState, nodeId: string, ghost: GhostRecord): RunState {
  return { ...state, ghostBossOffer: { nodeId, ghost } };
}

export function markExtraGhostUnavailable(state: RunState, nodeId: string): RunState {
  const ids = state.ghostExtraDecidedNodeIds ?? [];
  return {
    ...state,
    ghostBossOffer: null,
    ghostExtraDecidedNodeIds: ids.includes(nodeId) ? ids : [...ids, nodeId],
  };
}

export function acceptExtraGhostFight(state: RunState): RunState {
  const offer = state.ghostBossOffer;
  if (!offer) return state;
  return {
    ...state,
    ghostBossOffer: null,
    activeGhostFight: { nodeId: offer.nodeId, ghost: offer.ghost, role: 'extra' },
  };
}

export function declineExtraGhostFight(state: RunState): RunState {
  const offer = state.ghostBossOffer;
  if (!offer) return state;
  const ids = state.ghostExtraDecidedNodeIds ?? [];
  return {
    ...state,
    ghostBossOffer: null,
    ghostExtraDecidedNodeIds: ids.includes(offer.nodeId) ? ids : [...ids, offer.nodeId],
  };
}

// Never touches depth/wave/wins/losses/heroLevel.
export function recordExtraGhostFightResult(state: RunState, won: boolean): { state: RunState } {
  const active = state.activeGhostFight;
  if (!active || active.role !== 'extra') {
    throw new Error('recordExtraGhostFightResult: no extra ghost fight is active');
  }
  const lives = won ? state.lives : Math.max(0, state.lives - 1);
  const ids = state.ghostExtraDecidedNodeIds ?? [];
  let nextState: RunState = {
    ...state,
    status: lives <= 0 ? 'defeat' : state.status,
    lives,
    activeGhostFight: null,
    ghostExtraDecidedNodeIds: ids.includes(active.nodeId) ? ids : [...ids, active.nodeId],
    extraGhostFights: {
      won: (state.extraGhostFights?.won ?? 0) + (won ? 1 : 0),
      lost: (state.extraGhostFights?.lost ?? 0) + (won ? 0 : 1),
    },
    stats: {
      ...state.stats,
      livesLost: state.stats.livesLost + (state.lives - lives),
    },
  };
  if (won) {
    const fightNumber = nodeById(state, active.nodeId)?.fightNumber ?? 0;
    nextState = offerGhostSavePrompt(nextState, active.nodeId, fightNumber, ghostBandOf(fightNumber));
  }
  return { state: nextState };
}

export interface GhostSaveOffer {
  fightNumber: number;
  band: number;
}

export function offerGhostSavePrompt(state: RunState, nodeId: string, fightNumber: number, band: number): RunState {
  return { ...state, pendingGhostSavePrompt: { nodeId, fightNumber, band } };
}

export function ghostSavePromptOf(state: RunState): GhostSaveOffer | null {
  const prompt = state.pendingGhostSavePrompt;
  return prompt ? { fightNumber: prompt.fightNumber, band: prompt.band } : null;
}

export function clearGhostSavePrompt(state: RunState): RunState {
  if (!state.pendingGhostSavePrompt) return state;
  return { ...state, pendingGhostSavePrompt: null };
}

export function ghostResultReportKey(nodeId: string, role: 'substitute' | 'extra'): string {
  return `${nodeId}:${role}`;
}

export function hasReportedGhostResult(state: RunState, key: string): boolean {
  return (state.ghostResultReportedKeys ?? []).includes(key);
}

export function markGhostResultReported(state: RunState, key: string): RunState {
  const keys = state.ghostResultReportedKeys ?? [];
  if (keys.includes(key)) return state;
  return { ...state, ghostResultReportedKeys: [...keys, key] };
}
