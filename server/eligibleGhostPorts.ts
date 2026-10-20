import type { RunPorts } from '../src/service/runs/service';
import type { GhostRecord } from '../src/run/ghost';
import { evictionCandidateId, nextRotationPick } from '../src/run/ghostPool';
import type { RevisionKey } from '../src/run/online/types';
import { createDurableCommunityState, type DurableCommunityState } from './communityStoreFile';
interface PinnedGhost extends GhostRecord { key: RevisionKey }
interface GhostState { records: PinnedGhost[]; cursors: Record<string, number>; delivered: string[] }
const sameKey = (a: RevisionKey | undefined, b: RevisionKey) => a?.contentSha === b.contentSha && a.rulesRevision === b.rulesRevision;
function ghosts(root: Record<string, unknown>): GhostState { return (root.eligibleGhosts ??= { records: [], cursors: {}, delivered: [] }) as GhostState; }
export function createFileEligibleGhostPorts(coordinator: DurableCommunityState = createDurableCommunityState()): RunPorts {
  return {
    async lookupGhost(accountId, band, key) { return coordinator.transaction(root => {
      const state = ghosts(root), records = state.records.filter(ghost => ghost.band === band && sameKey(ghost.key, key)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const partition = JSON.stringify([key.rulesRevision, key.contentSha, band]);
      const result = nextRotationPick(records, state.cursors[partition] ?? 0, accountId);
      state.cursors[partition] = result.nextCursor; return result.picked;
    }); },
    async deliverEffect(delivery, validatedGhost) { await coordinator.transaction(root => {
      const state = ghosts(root);
      if (state.delivered.includes(delivery.id)) return;
      const effect = delivery.effect;
      if (effect.kind === 'ghostSave') {
        if (!validatedGhost || validatedGhost.ownerLocalId !== delivery.accountId) throw new Error('Missing pinned ghost validation');
        const record: PinnedGhost = { ...validatedGhost, key: delivery.key, id: delivery.id, createdAt: Date.now(), defenseWins: 0, defenseLosses: 0 };
        state.records.push(record);
        const evict = evictionCandidateId(state.records.filter(ghost => ghost.band === record.band && sameKey(ghost.key, delivery.key)));
        if (evict) state.records = state.records.filter(ghost => ghost.id !== evict);
      } else {
        const ghost = state.records.find(ghost => ghost.id === effect.ghostId && sameKey(ghost.key, delivery.key));
        if (ghost) { if (effect.won) ghost.defenseWins = (ghost.defenseWins ?? 0) + 1; else ghost.defenseLosses = (ghost.defenseLosses ?? 0) + 1; }
      }
      state.delivered.push(delivery.id);
    }); },
  };
}
