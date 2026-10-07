import type { MarketStat } from '../data/eventTypes';
import type { Gem, SkillTier } from '../engine/types';
import { biomeFor } from './biome';
import { LEVEL_STAT_COST } from './leveling';
import type { RunCard, RunNodeKind, RunState } from './runState';

export type RunHistoryChange =
  | { kind: 'gold' | 'life' | 'level' | 'reroll'; amount: number }
  | { kind: 'card' | 'cardPoint'; skillId: string; tier: SkillTier; amount: number }
  | { kind: 'gem'; gemId: string; amount: number }
  | { kind: 'stat'; stat: MarketStat; amount: number }
  | { kind: 'intel'; band: number; amount: number };

export interface RunHistoryStep {
  choiceId?: string;
  result?: 'win' | 'loss';
  changes: readonly RunHistoryChange[];
}

export interface RunHistoryEntry {
  entryId?: string;
  nodeId: string;
  depth: number;
  wave: number;
  biomeId: string;
  kind: RunNodeKind;
  shopId?: string;
  eventId?: string;
  contentVersion?: number;
  choiceId?: string;
  enemyIds?: readonly string[];
  opponentName?: string;
  battleSource?: 'ghost-extra' | 'ghost-substitute';
  result?: 'win' | 'loss';
  status: 'pending' | 'completed';
  changes: readonly RunHistoryChange[];
  steps: readonly RunHistoryStep[];
}

export function runHistoryEntries(run: RunState): readonly RunHistoryEntry[] {
  return run.history ?? [];
}

function ownedCards(run: RunState): readonly RunCard[] {
  return [...run.pieces, ...run.bagSlots.filter((card): card is RunCard => card !== null), ...(run.held ? [run.held] : [])];
}

function ownedGemIds(run: RunState): readonly string[] {
  return [...run.gemInventory, ...ownedCards(run).flatMap((card) => {
    const gem = (card as RunCard & { gem?: Gem | null }).gem;
    return gem ? [gem.id] : [];
  })];
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function changesBetween(previous: RunState, next: RunState): RunHistoryChange[] {
  const changes: RunHistoryChange[] = [];
  const add = (change: RunHistoryChange): void => { if (change.amount !== 0) changes.push(change); };
  const earned = next.stats.goldEarned - previous.stats.goldEarned;
  const spent = next.stats.goldSpent - previous.stats.goldSpent;
  add({ kind: 'gold', amount: earned });
  add({ kind: 'gold', amount: -spent });
  add({ kind: 'gold', amount: next.gold - previous.gold - earned + spent });
  add({ kind: 'life', amount: next.lives - previous.lives });
  add({ kind: 'level', amount: next.heroLevel - previous.heroLevel });
  add({ kind: 'reroll', amount: (next.freeShopRerolls ?? 0) - (previous.freeShopRerolls ?? 0) });
  const beforeCards = ownedCards(previous);
  const afterCards = ownedCards(next);
  const cardKey = (card: RunCard): string => `${card.skillId}:${card.tier}`;
  const beforeCounts = countBy(beforeCards, cardKey);
  const afterCounts = countBy(afterCards, cardKey);
  const seenCards = new Set<string>();
  for (const card of [...beforeCards, ...afterCards]) {
    const key = cardKey(card);
    if (seenCards.has(key)) continue;
    seenCards.add(key);
    add({ kind: 'card', skillId: card.skillId, tier: card.tier, amount: (afterCounts.get(key) ?? 0) - (beforeCounts.get(key) ?? 0) });
  }
  for (const card of afterCards) {
    const before = beforeCards.find((candidate) => candidate.instanceId === card.instanceId);
    if (before?.skillId === card.skillId && before.tier === card.tier) {
      add({ kind: 'cardPoint', skillId: card.skillId, tier: card.tier, amount: (card.points ?? 0) - (before.points ?? 0) });
    }
  }
  const beforeGems = countBy(ownedGemIds(previous), (id) => id);
  const afterGems = countBy(ownedGemIds(next), (id) => id);
  const gemIds = new Set([...beforeGems.keys(), ...afterGems.keys()]);
  for (const gemId of gemIds) add({ kind: 'gem', gemId, amount: (afterGems.get(gemId) ?? 0) - (beforeGems.get(gemId) ?? 0) });
  const stats: readonly MarketStat[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'];
  for (const stat of stats) add({ kind: 'stat', stat, amount: ((next.purchasedStats?.[stat] ?? 0) - (previous.purchasedStats?.[stat] ?? 0)) * LEVEL_STAT_COST[stat].gain });
  for (const record of Object.values(next.mapIntelByBand)) {
    if (!previous.mapIntelByBand[String(record.band)]) add({ kind: 'intel', band: record.band, amount: 1 });
  }
  return changes;
}

export function recordRunHistoryTransition(previous: RunState | null, next: RunState): RunState {
  if (!previous || previous.seed !== next.seed || previous === next || next.status === 'drafting') return next;
  const extraGhost = next.activeGhostFight?.role === 'extra' ? next.activeGhostFight
    : previous.activeGhostFight?.role === 'extra' ? previous.activeGhostFight : undefined;
  const nodeId = extraGhost?.nodeId ?? next.currentNodeId ?? previous.currentNodeId;
  if (!nodeId) return next;
  const node = next.map.depths.flat().find((candidate) => candidate.id === nodeId);
  if (!node) return next;
  const history = [...runHistoryEntries(previous)];
  const entryId = extraGhost ? `ghost-extra:${nodeId}` : undefined;
  const index = history.findIndex((entry) => entry.nodeId === nodeId && entry.entryId === entryId);
  const existing = history[index];
  const selected = extraGhost ? previous.activeGhostFight?.role !== 'extra' && next.activeGhostFight?.role === 'extra'
    : previous.currentNodeId !== nodeId && next.currentNodeId === nodeId;
  const changes = changesBetween(previous, next);
  const resolution = next.eventResolutions?.[nodeId];
  const previousResolution = previous.eventResolutions?.[nodeId];
  const choiceChanged = resolution !== undefined && (resolution.choiceId !== previousResolution?.choiceId
    || (resolution.marketVisits ?? 0) !== (previousResolution?.marketVisits ?? 0));
  const fact = extraGhost ? undefined : next.combatFactLedger.find((entry) => entry.nodeId === nodeId);
  const challengeSettled = previous.activeChallengeFight?.nodeId === nodeId && !next.activeChallengeFight;
  const challengeResult = challengeSettled
    ? (next.challengeFights?.won ?? 0) > (previous.challengeFights?.won ?? 0) ? 'win' : 'loss'
    : undefined;
  const extraSettled = previous.activeGhostFight?.role === 'extra' && next.activeGhostFight?.role !== 'extra';
  const extraResult = extraSettled ? (next.extraGhostFights?.won ?? 0) > (previous.extraGhostFights?.won ?? 0) ? 'win' : 'loss' : undefined;
  const result = extraResult ?? challengeResult ?? fact?.result;
  const resultChanged = result !== undefined && result !== existing?.result;
  const completed = extraGhost ? next.activeGhostFight?.role !== 'extra' : next.currentNodeId !== nodeId;
  const instance = next.eventInstances[nodeId];
  if (!selected && !existing && changes.length === 0 && !choiceChanged && !resultChanged) return next;
  const step: RunHistoryStep = {
    ...(resolution ? { choiceId: resolution.choiceId } : {}),
    ...(resultChanged ? { result } : {}),
    changes,
  };
  const entry: RunHistoryEntry = {
    ...(entryId ? { entryId } : {}),
    nodeId, depth: node.depth, wave: node.wave, kind: extraGhost ? 'fight' : node.kind,
    biomeId: biomeFor(next.map.seed, node.wave, node.biomeId).id,
    ...(node.shopId ? { shopId: node.shopId } : {}),
    ...(instance ? { eventId: instance.eventId, contentVersion: instance.contentVersion } : {}),
    ...(resolution ? { choiceId: resolution.choiceId } : {}),
    ...(extraGhost ? { opponentName: extraGhost.ghost.displayName, battleSource: 'ghost-extra' as const }
      : (next.activeGhostFight ?? previous.activeGhostFight)?.nodeId === nodeId
        ? { opponentName: (next.activeGhostFight ?? previous.activeGhostFight)!.ghost.displayName, battleSource: 'ghost-substitute' as const }
        : existing?.opponentName ? { opponentName: existing.opponentName, battleSource: existing.battleSource } : {}),
    ...(fact ? { enemyIds: fact.enemyIds } : previous.activeChallengeFight?.nodeId === nodeId ? { enemyIds: [previous.activeChallengeFight.enemyId] } : existing?.enemyIds ? { enemyIds: existing.enemyIds } : {}),
    ...(result ? { result } : existing?.result ? { result: existing.result } : {}),
    status: completed ? 'completed' : 'pending',
    changes: [...(existing?.changes ?? []), ...changes],
    steps: changes.length > 0 || choiceChanged || resultChanged ? [...(existing?.steps ?? []), step] : existing?.steps ?? [],
  };
  if (existing) history[index] = entry;
  else history.push(entry);
  return { ...next, history };
}

export function isRunHistory(value: unknown): value is readonly RunHistoryEntry[] {
  const record = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item);
  const integer = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item);
  const result = (item: unknown): boolean => item === undefined || item === 'win' || item === 'loss';
  const change = (item: unknown): boolean => {
    if (!record(item) || !integer(item.amount) || item.amount === 0) return false;
    switch (item.kind) {
      case 'gold': case 'life': case 'level': case 'reroll': return true;
      case 'card': case 'cardPoint': return typeof item.skillId === 'string' && ['bronze', 'silver', 'gold', 'diamond'].includes(String(item.tier));
      case 'gem': return typeof item.gemId === 'string';
      case 'stat': return ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'].includes(String(item.stat));
      case 'intel': return integer(item.band) && item.band >= 0;
      default: return false;
    }
  };
  const seen = new Set<string>();
  return Array.isArray(value) && value.every((item) => {
    if (!record(item) || typeof item.nodeId !== 'string') return false;
    const entryKey = typeof item.entryId === 'string' ? item.entryId : item.nodeId;
    if (seen.has(entryKey)) return false;
    seen.add(entryKey);
    return integer(item.depth) && item.depth > 0 && integer(item.wave) && item.wave > 0
      && typeof item.biomeId === 'string' && ['event', 'shop', 'fight', 'boss'].includes(String(item.kind))
      && (item.status === 'pending' || item.status === 'completed')
      && ['entryId', 'shopId', 'eventId', 'choiceId', 'opponentName'].every((key) => item[key] === undefined || typeof item[key] === 'string')
      && (item.battleSource === undefined || item.battleSource === 'ghost-extra' || item.battleSource === 'ghost-substitute')
      && (item.contentVersion === undefined || (integer(item.contentVersion) && item.contentVersion > 0))
      && (item.enemyIds === undefined || (Array.isArray(item.enemyIds) && item.enemyIds.every((id) => typeof id === 'string')))
      && result(item.result) && Array.isArray(item.changes) && item.changes.every(change)
      && Array.isArray(item.steps) && item.steps.every((step) => record(step)
        && (step.choiceId === undefined || typeof step.choiceId === 'string') && result(step.result)
        && Array.isArray(step.changes) && step.changes.every(change));
  });
}
