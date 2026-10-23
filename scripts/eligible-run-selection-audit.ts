import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { pinPageAgainstHmr } from './pageHarness';
import { collectSceneTexts } from './sceneText';
import { auditExecutor, auditKey, auditRegistry, drafted } from './online-audit-fixtures';
import { createDurableCommunityState } from '../server/communityStoreFile';
import { createFileEligibleRunStore } from '../server/eligibleRunStoreFile';
import { createEligibleRunService } from '../src/service/runs/service';
import { loadedEventCatalogFromJson, eventContentMeta } from '../src/data/eventsContent';
import { isEventDefV3 } from '../src/data/eventContentV3';
import { materializeReachedEventV3 } from '../src/run/eventsV3';
import { gemBook } from '../src/data/gems';
import { equipmentDocument } from '../src/data/equipmentContent';
import { CONTENT_SHA } from '../src/data/contentBuild';
import type { RunState } from '../src/run/runState';
import type { EventDeferredOfferV3 } from '../src/run/eventV3Materialization';
import legacyDocument from '../src/data/content/events.v3.json';
import { eventDefAtVersion } from '../src/data/eventsContent';
import { reopenEventChoice } from '../src/run/events';

const out = process.argv[2] ?? 'tmp/community/eligible-selectors'; mkdirSync(out, { recursive: true });
const origin = process.env.ELIGIBLE_UI_ORIGIN ?? 'http://127.0.0.1:5191';
const api = process.env.ELIGIBLE_API_ORIGIN ?? 'http://127.0.0.1:8788';
const base = drafted(11), eventNode = base.map.depths.flat().find(node => node.kind === 'event')!;
const equipment = equipmentDocument.items.map((item, index) => ({ instanceId: `equipment-${index}`, itemId: item.id, itemVersion: item.versions.at(-1)!.version, setVersion: 1 }));
const fixtures = new Map<string, { state: RunState }>();
for (const tier of ['bronze', 'silver'] as const) for (const event of Object.values(loadedEventCatalogFromJson)) {
  if (!isEventDefV3(event)) continue;
  const instanceId = `event:${eventNode.id}`, contentVersion = eventContentMeta[event.id]!.version;
  const state: RunState = { ...base, currentNodeId: eventNode.id, depth: eventNode.depth, gold: 999, brokenEquipment: 999,
    pieces: Array.from({ length: 6 }, (_, slot) => ({ instanceId: `card-${slot}`, skillId: 'sword_slash', tier, slot })), bagSlots: [],
    gemInventory: Object.keys(gemBook).flatMap(id => [id, id]), ownedEquipment: equipment,
    eventInstances: { [eventNode.id]: { eventId: event.id, contentVersion, instanceId, drawnDepth: eventNode.depth } } };
  const materialized = materializeReachedEventV3(state, eventNode, event, contentVersion); if (!materialized.ok) continue;
  for (const choiceId of materialized.materialization.choiceIds) {
    try {
      const picked = auditExecutor.apply(materialized.state, { kind: 'eventChoice', instanceId, contentVersion, choiceId }, { runId: 'fixture', revision: 0, encounterId: 'fixture-encounter' }).state;
      const offer = picked.eventMaterializations[instanceId]?.deferredOffersByChoiceId[choiceId];
      if (offer?.status === 'pending' && !picked.activeChallengeFight && !fixtures.has(offer.kind)) fixtures.set(offer.kind, { state: picked });
    } catch {}
  }
}
for (const event of legacyDocument.events) for (const version of event.versions) {
  const definition = eventDefAtVersion(event.id, version.version); if (!definition || isEventDefV3(definition)) continue;
  const instanceId = `event:${eventNode.id}`, contentVersion = version.version;
  const state: RunState = { ...base, currentNodeId: eventNode.id, depth: eventNode.depth, gold: 999,
    pieces: Array.from({ length: 6 }, (_, slot) => ({ instanceId: `legacy-${slot}`, skillId: 'sword_slash', tier: 'bronze', slot })), bagSlots: [], gemInventory: Object.keys(gemBook),
    eventInstances: { [eventNode.id]: { eventId: event.id, contentVersion, instanceId, drawnDepth: eventNode.depth } } };
  for (const choice of definition.choices) try {
    const picked = auditExecutor.apply(state, { kind: 'eventChoice', instanceId, contentVersion, choiceId: choice.id }, { runId: 'fixture', revision: 0, encounterId: 'fixture-encounter' }).state;
    const reopened = reopenEventChoice(picked, (id, version) => { const event = eventDefAtVersion(id, version); return event && !isEventDefV3(event) ? event : undefined; });
    if (reopened && !fixtures.has(`legacy-${reopened.outcome.kind}`)) fixtures.set(`legacy-${reopened.outcome.kind}`, { state: picked });
  } catch {}
}
const browser = await chromium.launch({ executablePath: resolveChromiumPath('eligible-selectors'), headless: true });
const evidence: unknown[] = [];
async function ready(page: Page): Promise<void> { await page.waitForFunction(`window.__game?.registry.get('eligibleRunUi')?.ready`, undefined, { timeout: 60000 }); }
async function click(page: Page, label: string): Promise<boolean> {
  const state = await page.evaluate(`window.__game.registry.get('eligibleRunUi')`) as { pages: number; page: number };
  for (let attempt = 0; attempt < state.pages + 2; attempt++) {
    const rect = await page.evaluate(`(() => {const s=window.__game.scene.scenes.find(s=>s.sys.isActive()); const o=s.children.list.find(o=>o.getData?.('eligibleControl')===${JSON.stringify(label)}&&o.input?.enabled); if(!o)return null;const r=o.getBounds();return {x:r.centerX,y:r.centerY}})()` ) as { x: number; y: number } | null;
    if (rect) { await page.mouse.click(rect.x, rect.y); await page.waitForTimeout(200); await ready(page); return true; }
    const target = attempt === 0 && state.page > 0 ? 'PREVIOUS' : 'NEXT';
    const nav = await page.evaluate(`(() => {const s=window.__game.scene.scenes.find(s=>s.sys.isActive());const o=s.children.list.find(o=>o.getData?.('eligibleControl')===${JSON.stringify(target)}&&o.input?.enabled);const r=o.getBounds();return {x:r.centerX,y:r.centerY}})()` ) as { x: number; y: number };
    await page.mouse.click(nav.x, nav.y); await page.waitForTimeout(200);
  }
  return false;
}
try {
  for (const [platform, scene, width, height] of [['desktop', 'eligible', 1440, 900], ['mobile', 'meligible', 412, 892]] as const) {
    for (const [kind, fixture] of fixtures) {
      const registry = { ...auditRegistry, get: () => ({ ...auditExecutor, present: (state: RunState) => ({ ...auditExecutor.present(state), artBase: `/content/${CONTENT_SHA}/` }) }) };
      const store = createFileEligibleRunStore(run => ({ ...run, content: registry.get().present(run.state) }), createDurableCommunityState(`tmp/community/audits/selectors-${randomUUID()}.json`));
      const service = createEligibleRunService(store, registry, { lookupGhost: async () => null, deliverEffect: async () => undefined });
      const context = await browser.newContext({ viewport: { width, height } }); const page = await context.newPage(); await pinPageAgainstHmr(page);
      let accountId = ''; const runId = randomUUID(); const intents: unknown[] = [];
      page.on('requestfailed', request => { if (new URL(request.url()).pathname.startsWith('/runs')) console.error(`${platform}-${kind} request failed: ${request.failure()?.errorText}`); });
      await page.route('**/runs/**', async route => {
        const request = route.request(); const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (!accountId) {
          const response = await fetch(`${api}/account/me`, { headers: { authorization: request.headers().authorization ?? '' } });
          const account = await response.json() as { account: { id: string } }; accountId = account.account.id;
          await store.createOrReplace(accountId, { id: runId, accountId, revision: 0, key: auditKey, state: fixture.state, encounters: [] }, { operationId: randomUUID(), payloadHash: 'selector-fixture', now: Date.now(), replace: true });
        }
        const input = request.method() === 'POST' ? request.postDataJSON() : undefined; if (input?.intent) intents.push(input.intent);
        const reply = await service.handle(accountId, request.method(), new URL(request.url()).pathname, input);
        if (reply.status >= 400) console.error(`${platform}-${kind} fixture reply`, reply.status, reply.body);
        return route.fulfill({ status: reply.status, contentType: 'application/json', headers, body: JSON.stringify(reply.body) });
      });
      await page.goto(`${origin}/?scene=${scene}&layoutAudit=1`, { waitUntil: 'domcontentloaded' }); await ready(page);
      const ui = await page.evaluate(`window.__game.registry.get('eligibleRunUi')`) as any;
      assert.equal(ui.runId, runId, `${platform}-${kind}: fixture run must actually be loaded: ${JSON.stringify(ui)}`);
      await page.screenshot({ path: join(out, `${platform}-${kind}.png`) });
      const texts = await collectSceneTexts(page); for (const text of texts) assert(text.x >= -1 && text.y >= -1 && text.x + text.width <= width + 1 && text.y + text.height <= height + 1, `${platform}-${kind} overflow ${text.text}`);
      let label = kind === 'cardChoice' || kind === 'bonusDraft' || kind === 'legacy-bonusDraft' ? 'TAKE CARD' : kind === 'gemChoice' || kind === 'legacy-gemChoicePick' ? 'TAKE GEM' : kind === 'upgradeCard' || kind === 'upgradeCardTargeted' || kind === 'legacy-upgradeCardPick' ? 'UPGRADE' : kind === 'reshapeCard' || kind === 'rerollCard' || kind === 'rerollGem' ? 'CHOOSE' : kind === 'reshapeGem' ? 'TRANSFORM' : kind === 'mergeCards' || kind === 'legacy-mergeCardsPick' ? 'MERGE THREE' : kind === 'buyStatPick' ? 'Attack' : '';
      if (kind === 'legacy-upgradeCardPick') label = registry.get().present(fixture.state).skills.sword_slash!.name;
      if (kind === 'legacy-awardCardPointPick') label = 'ADD MERGE POINT';
      if (!label) {
        const pages = (await page.evaluate(`window.__game.registry.get('eligibleRunUi')`) as any).pages;
        for (let index = 0; index < pages && !label; index++) {
          label = await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.filter(o=>o.input?.enabled).map(o=>o.getData?.('eligibleControl')).find(x=>typeof x==='string'&&${kind === 'sellGem' || kind === 'legacy-sellGemPick' ? "x.startsWith('SELL ·')" : "x.includes(' PARTS')"})`) as string;
          if (!label) await click(page, 'NEXT');
        }
      }
      assert(label, `${kind}: a player-facing selection must be available`); assert(await click(page, label), `${kind}: choose offered target`);
      const run = await store.get(runId, accountId); assert.equal(run?.revision, 1, `${platform}-${kind}: actual closed executor accepted the UI intent`);
      assert.equal((intents[0] as any)?.kind, 'eventFinalize');
      evidence.push({ platform, selector: kind, serverRevision: run?.revision, intent: intents[0] }); await context.close();
    }
  }
  for (const required of ['cardChoice', 'gemChoice', 'upgradeCardTargeted', 'sellGem', 'legacy-mergeCardsPick', 'legacy-upgradeCardPick', 'buyStatPick', 'reshapeCard', 'reshapeGem', 'rerollCard', 'rerollGem', 'forgeEquipment', 'upgradeEquipment']) assert(fixtures.has(required), `missing ${required} authored offer`);
  writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`eligible selectors OK: ${fixtures.size} actual authored offer kinds on both Phaser profiles; every UI selection accepted by canonical executor; fixture server uses isolated file store and no points`);
} finally { await browser.close(); }
