import assert from 'node:assert/strict';
import { runStoreFixture, drafted, auditExecutor, auditKey } from './online-audit-fixtures';
import { ghostCodeOf } from '../src/run/ghost';
import { createFileEligibleGhostPorts } from '../server/eligibleGhostPorts';
import { createD1EligibleGhostPorts } from '../functions/eligibleGhostPorts';
import type { EffectDelivery } from '../src/service/runs/store';

for (const kind of ['file', 'd1'] as const) {
  const fixture = await runStoreFixture(kind);
  const ports = fixture.db ? createD1EligibleGhostPorts(fixture.db) : createFileEligibleGhostPorts(fixture.durable);
  const code = ghostCodeOf(drafted());
  const validated = auditExecutor.validateGhost({ code, displayName: 'Pinned', fightNumber: 10, ownerLocalId: 'owner' });
  assert(validated.ok);
  const delivery: EffectDelivery = { id: `save-${kind}`, accountId: 'owner', runId: 'run', key: auditKey, effect: { kind: 'ghostSave', code, name: 'Pinned', fightNumber: 10 } };
  await assert.rejects(ports.deliverEffect(delivery), /pinned ghost validation/);
  await ports.deliverEffect(delivery, validated.record);
  await ports.deliverEffect(delivery, validated.record);
  assert.equal((await ports.lookupGhost('visitor', validated.record.band, auditKey))?.id, delivery.id);
  assert.equal(await ports.lookupGhost('owner', validated.record.band, auditKey), null);
  const other = { ...auditKey, contentSha: 'other-content' };
  assert.equal(await ports.lookupGhost('visitor', validated.record.band, other), null);
  await ports.deliverEffect({ ...delivery, id: 'wrong-context-report', key: other, effect: { kind: 'ghostReport', ghostId: delivery.id, won: true, sourceKey: 'encounter' } });
  assert.equal((await ports.lookupGhost('visitor', validated.record.band, auditKey))?.defenseWins, 0);
  await ports.deliverEffect({ ...delivery, id: 'right-context-report', effect: { kind: 'ghostReport', ghostId: delivery.id, won: true, sourceKey: 'encounter' } });
  assert.equal((await ports.lookupGhost('visitor', validated.record.band, auditKey))?.defenseWins, 1);
  console.log(`eligible ghost OK ${kind}: pinned validation, revision-isolated lookup/report, idempotent save, own-account exclusion`);
}
