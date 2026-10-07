import { eventDefAtVersion, loadedEventCatalogFromJson } from '../../data/eventsContent';
import { isEventDefV3 } from '../../data/eventContentV3';
import { enemies } from '../../data/enemies';
import { skillBook } from '../../data/skills';
import { gemBook } from '../../data/gems';
import { shopCatalog } from '../../data/shopTypes';
import { biomeFor } from '../../run/biome';
import type { RunState } from '../../run/runState';
import { runHistoryEntries, type RunHistoryChange, type RunHistoryEntry, type RunHistoryStep } from '../../run/runHistory';
import { biomeArtKey, eventArtKey, shopArtKey, RUN_ART_KEYS } from './runArtKeys';
import { STAT_TOKEN } from './statLabels';
import { isEquipmentEvent } from './equipmentEventCategory';

export interface RunHistoryRow {
  nodeId: string;
  wave: number;
  region: string;
  title: string;
  choice?: string;
  receipt: string;
  result?: 'win' | 'loss';
  artKey: string;
}

const signed = (amount: number): string => `${amount > 0 ? '+' : '−'}${Math.abs(amount)}`;

function changeText(change: RunHistoryChange): string {
  switch (change.kind) {
    case 'gold': return `${signed(change.amount)} Gold`;
    case 'life': return `${signed(change.amount)} ${Math.abs(change.amount) === 1 ? 'Life' : 'Lives'}`;
    case 'level': return `${signed(change.amount)} Level`;
    case 'reroll': return `${signed(change.amount)} Free Rerolls`;
    case 'card': return `${signed(change.amount)} ${skillBook[change.skillId]?.name ?? 'Card'} (${change.tier})`;
    case 'gem': return `${signed(change.amount)} ${gemBook[change.gemId]?.name ?? 'Gem'}`;
    case 'cardPoint': return `${signed(change.amount)} Progress · ${skillBook[change.skillId]?.name ?? 'Card'}`;
    case 'intel': return `${signed(change.amount)} Region ${change.band + 1} Intel`;
    case 'stat': return `${signed(change.amount)} ${STAT_TOKEN[change.stat]}`;
    default: return '';
  }
}

function groupedChanges(changes: readonly RunHistoryChange[]): readonly RunHistoryChange[] {
  const groups = new Map<string, RunHistoryChange>();
  for (const change of changes) {
    const subject = change.kind === 'card' || change.kind === 'cardPoint' ? `${change.skillId}:${change.tier}`
      : change.kind === 'gem' ? change.gemId : change.kind === 'stat' ? change.stat : change.kind === 'intel' ? String(change.band) : '';
    const key = `${change.kind}:${subject}:${Math.sign(change.amount)}`;
    groups.set(key, { ...change, amount: (groups.get(key)?.amount ?? 0) + change.amount });
  }
  return [...groups.values()];
}

export function runHistoryRow(state: Readonly<RunState>, entry: RunHistoryEntry): RunHistoryRow {
  const node = state.map.depths[entry.depth]?.find((candidate) => candidate.id === entry.nodeId);
  const biome = biomeFor(state.seed, entry.wave, entry.biomeId);
  const event = entry.eventId ? entry.contentVersion === undefined
    ? loadedEventCatalogFromJson[entry.eventId]
    : eventDefAtVersion(entry.eventId, entry.contentVersion) : undefined;
  const eventChoices = event ? isEventDefV3(event)
    ? [...event.choiceSet.fixed, ...(event.choiceSet.pool?.entries ?? [])] : event.choices : [];
  const choice = eventChoices.find((candidate) => candidate.id === entry.choiceId)?.label;
  const title = entry.battleSource === 'ghost-extra' ? 'Ghost Battle' : event?.title ?? (entry.kind === 'shop'
    ? shopCatalog[entry.shopId ?? node?.shopId ?? '']?.name ?? 'Shop'
    : entry.kind === 'boss' ? 'Region Boss' : entry.kind === 'fight' ? 'Battle' : 'Event');
  const artKey = entry.kind === 'event' ? eventArtKey(event?.theme ?? node?.eventTheme ?? 'training', event?.artId)
    : entry.kind === 'shop' ? shopArtKey(entry.shopId ?? node?.shopId ?? '')
      : entry.kind === 'boss' ? RUN_ART_KEYS.icon.bossSkull : biomeArtKey(biome.id);
  const battleNames = entry.enemyIds?.map((id) => enemies[id]?.name ?? 'Enemy').join(' · ');
  return {
    nodeId: entry.nodeId, wave: entry.wave, region: biome.name, title,
    choice: choice ?? entry.opponentName ?? battleNames,
    receipt: groupedChanges(entry.changes).map(changeText).filter(Boolean).join(' · ')
      || (entry.status === 'pending' ? 'IN PROGRESS' : ''),
    result: entry.result, artKey,
  };
}

export function runHistoryRows(state: Readonly<RunState>): readonly RunHistoryRow[] {
  return [...runHistoryEntries(state)].reverse().flatMap((entry) => {
    if (entry.kind === 'fight' || entry.kind === 'boss') {
      return [runHistoryRow(state, { ...entry, changes: entry.steps.length > 0 ? entry.steps.flatMap((step) => step.changes) : entry.changes })];
    }
    const steps = entry.steps.filter((step) => step.choiceId || step.result || step.changes.length > 0);
    const choices: RunHistoryStep[] = [];
    let selectionChanges: readonly RunHistoryChange[] = [];
    for (const step of steps) {
      if (step.choiceId || step.result) {
        choices.push({ ...step, changes: [...selectionChanges, ...step.changes] });
        selectionChanges = [];
      } else if (choices.length > 0) {
        const previous = choices[choices.length - 1]!;
        choices[choices.length - 1] = { ...previous, changes: [...previous.changes, ...step.changes] };
      } else selectionChanges = [...selectionChanges, ...step.changes];
    }
    if (choices.length === 0) {
      const row = runHistoryRow(state, entry);
      if (entry.status === 'pending' && row.receipt !== 'IN PROGRESS') row.receipt = `IN PROGRESS · ${row.receipt}`;
      return [row];
    }
    return [...choices].reverse().map((step) =>
      runHistoryRow(state, { ...entry, choiceId: step.choiceId, result: step.result, changes: step.changes }));
  });
}

export function runRouteSelectedStops(state: Readonly<RunState>): readonly { nodeId: string; wave: number; artKey: string; iconKey?: string; kind: 'event' | 'shop' | 'fight' | 'boss'; status: 'pending' | 'completed' }[] {
  return runHistoryEntries(state).filter((entry) => !entry.entryId).map((entry) => {
    const row = runHistoryRow(state, entry);
    return { nodeId: row.nodeId, wave: row.wave, artKey: row.artKey, kind: entry.kind, status: entry.status,
      ...(entry.kind === 'event' && isEquipmentEvent(entry.eventId, entry.contentVersion)
        ? { iconKey: RUN_ART_KEYS.icon.routeEquipment } : {}),
    };
  });
}
