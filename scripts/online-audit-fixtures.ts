import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRunExecutor } from '../src/run/online/executor';
import { currentStartDraft, type RunState } from '../src/run/runState';
import { ensureDepthThrough } from '../src/run/runMap';
import type { EligibleRun, RevisionKey } from '../src/run/online/types';
import { createFileEligibleRunStore } from '../server/eligibleRunStoreFile';
import { createD1EligibleRunStore } from '../functions/eligibleRunStoreD1';
import { createDurableCommunityState, createFileCommunityStore } from '../server/communityStoreFile';
import { createD1CommunityStore } from '../functions/communityStoreD1';
import { AuditSqliteD1 } from './community-audit-fixtures';
export const auditKey: RevisionKey = { rulesRevision: 'audit-rules', contentSha: 'audit-content' };
export const auditExecutor = createRunExecutor(auditKey);
export const auditRegistry = { current: auditKey, get(key: RevisionKey) { if (JSON.stringify(key) !== JSON.stringify(auditKey)) throw new Error('Unknown audit executor'); return auditExecutor; } };
export const auditPresent = (run: EligibleRun) => ({ ...run, content: auditExecutor.present(run.state) });
export function drafted(seed = 1): RunState {
  let state = auditExecutor.create(seed);
  const inputs = { runId: 'audit', revision: 0, encounterId: 'encounter-audit' };
  const draft = currentStartDraft(state);
  for (const set of ['offense', 'defense', 'support', 'wildcard'] as const) state = auditExecutor.apply(state, { kind: 'draftPick', set, skillId: draft[set][0]!.skillId }, inputs).state;
  return auditExecutor.apply(state, { kind: 'draftApply' }, inputs).state;
}
export function bossFixture(): RunState {
  const base = drafted();
  const map = ensureDepthThrough(base.map, 40);
  const boss = map.depths.flat().find(node => node.kind === 'boss')!;
  return { ...base, map, depth: boss.depth, currentNodeId: boss.id, heroLevel: 30, heroAllocation: { attack: 30, maxHp: 30, speed: 10 },
    pieces: Array.from({ length: 10 }, (_, slot) => ({ instanceId: `audit-card-${slot}`, skillId: 'sword_slash', tier: 'diamond' as const, slot })), bagSlots: [], held: null };
}
export async function runStoreFixture(kind: 'file' | 'd1') {
  const durable = createDurableCommunityState(`tmp/community/audits/runs-${randomUUID()}.json`);
  if (kind === 'file') return { store: createFileEligibleRunStore(auditPresent, durable), community: createFileCommunityStore(durable), durable, db: undefined };
  const db = new AuditSqliteD1();
  for (const file of ['migrations/0003_community.sql', 'migrations/0004_eligible_runs.sql', 'migrations/0005_community_points.sql', 'migrations/0006_voting_rounds.sql']) db.sqlite.exec(readFileSync(file, 'utf8'));
  return { store: createD1EligibleRunStore(db, auditPresent), community: createD1CommunityStore(db), db, durable: undefined };
}
