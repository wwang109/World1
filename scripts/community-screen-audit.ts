import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { resolveChromiumPath } from './chromiumPath';
import { collectSceneTexts } from './sceneText';
import { pinPageAgainstHmr } from './pageHarness';
import { candidateFor, roundAt } from '../src/community/rounds';
import type { ProposalSnapshot } from '../src/community/types';

const out = process.argv[2] ?? 'tmp/community/ui';
const origin = process.env.COMMUNITY_UI_ORIGIN ?? 'http://127.0.0.1:5191';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: resolveChromiumPath('community-ui'), headless: true });
const now = Date.now();
const proposal: ProposalSnapshot = {
  key: { repositoryId: '1426486653', number: 12 }, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), manifestPath: 'proposals/12/proposal.json', manifestSha256: 'c'.repeat(64),
  manifest: { version: 1, title: 'Lantern Festival', category: 'event', description: 'A community proposal for a quiet festival stop. Travelers exchange stories beneath the lanterns. '.repeat(35), attribution: 'Community artist', contentPaths: ['src/data/content/event-packs/lantern-festival.json'], previewPaths: ['public/game-art/lantern-festival.webp'] },
  moderationRevision: 3, state: 'open', sourceState: 'open', sourceUrl: 'https://github.com/wwang109/wandering-hand-content/pull/12', sourceCheckedAt: now, importedAt: now - 1000, mergedCommitSha: null, reviewedHeadSha: 'a'.repeat(40),
  technical: { key: { repositoryId: '1426486653', number: 12 }, headSha: 'a'.repeat(40), rulesRevision: 'fixture', contentApiVersion: 1, evidenceHash: 'd'.repeat(64), reviewerId: 'not-public', admittedAt: now - 1000 }, validation: 'ready', supportTotal: 7,
};
assert.equal(candidateFor({ ...proposal, validation: 'needs_implementation' }, 'fixture', 1), null);
async function click(page: Page, key: string, value: string | number): Promise<void> {
  const marker = `${Date.now()}:${Math.random()}`;
  const box = await page.evaluate(({ key, value, marker }) => {
    const game = (window as any).__game;
    const scene = game.scene.scenes.find((s: any) => s.sys.isActive());
    const objects = scene.children.list.filter((o: any) => o.getData?.(key) === value && o.input?.enabled);
    const object = objects.at(-1); if (!object) return null;
    object.setData('communityAuditClick', marker);
    const bounds = object.getBounds(); return { x: bounds.centerX, y: bounds.centerY, frame: game.loop.frame };
  }, { key, value, marker });
  assert(box, `Missing enabled ${key}: ${value}`);
  await page.mouse.move(box.x, box.y); await page.mouse.down();
  await page.waitForFunction(frame => (window as any).__game.loop.frame >= frame + 2, box.frame, { timeout: 20_000 });
  await page.mouse.up();
  if (['SUBMIT ON GITHUB', 'VIEW GITHUB PR'].includes(String(value))) await page.waitForFunction(frame => (window as any).__game.loop.frame >= frame + 2, box.frame, { timeout: 20_000 });
  else await page.waitForFunction(marker => {
    const scene = (window as any).__game.scene.scenes.find((scene: any) => scene.sys.isActive());
    return document.querySelector('input,textarea') || !scene.children.list.some((object: any) => object.getData?.('communityAuditClick') === marker);
  }, marker, { timeout: 30_000 });
}
async function ready(page: Page): Promise<void> { await page.waitForFunction(`window.__game?.registry.get('communityUi')?.ready`, undefined, { timeout: 60_000 }); }
async function capture(page: Page, name: string, width: number, height: number): Promise<void> {
  await page.screenshot({ path: join(out, `${name}.png`) });
  const texts = await collectSceneTexts(page);
  for (const text of texts) assert(text.x >= -1 && text.y >= -1 && text.x + text.width <= width + 1 && text.y + text.height <= height + 1, `${name}: outside canvas ${text.text}`);
  if (!/confirm|retry|review/.test(name)) for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i]!; const b = texts[j]!;
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert(overlapX <= 1 || overlapY <= 1, `${name}: text overlap ${a.text} / ${b.text}`);
  }
  const failures = await page.evaluate(`window.__layoutAudit?.failures() ?? []`);
  assert.deepEqual(failures, [], `${name}: layout controls`);
}
const evidence: unknown[] = [];
try {
  for (const [platform, scene, width, height] of [['desktop', 'community', 1440, 900], ['mobile', 'mcommunity', 412, 892]] as const) {
    const page = await browser.newPage({ viewport: { width, height } }); await pinPageAgainstHmr(page);
    let mode: 'ready' | 'stale' | 'empty' | 'disabled' | 'needs' | 'missing-art' | 'error' | 'long' | 'head-changed' = 'ready';
    let balance = 4; let requests: unknown[] = []; let lostSuccess = true; let savedReceipt: unknown = null;
    let isModerator = false; let denyReview = false; let reviewLostSuccess = true; let reviewRevision = 3;
    const reviewRequests: any[] = []; const reviewReceipts = new Map<string, unknown>();
    const opened: string[] = [];
    await page.exposeFunction('__captureCommunityOpen', (url: string) => opened.push(url));
    await page.addInitScript(`window.open=(url)=>{window.__captureCommunityOpen(String(url));return null}`);
    await page.route('**/community/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const visible = { ...proposal, technical: mode === 'needs' ? null : proposal.technical, moderationRevision: reviewRevision, headSha: mode === 'head-changed' ? 'e'.repeat(40) : proposal.headSha, ...(mode === 'long' ? { manifest: { ...proposal.manifest, title: 'W'.repeat(100), description: `${'W'.repeat(500)}\n${'\n'.repeat(50)}${'A long contribution. '.repeat(200)}` } } : {}), sourceCheckedAt: mode === 'stale' ? 1 : Date.now(), validation: mode === 'needs' ? 'needs_implementation' : 'ready' };
      if (mode === 'error') return json({ error: 'github-source-unavailable' }, 503);
      if (url.pathname.endsWith('/previews')) return mode === 'missing-art' ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ contentType: 'image/webp', body: readFileSync('public/game-art/placeholders/start-background-desktop.webp') });
      if (url.pathname.endsWith('/moderation/review')) {
        const body = request.postDataJSON(); reviewRequests.push(body);
        if (denyReview) { isModerator = false; return json({ error: 'moderator-required' }, 403); }
        if (body.technicalReady && mode === 'needs') return json({ error: 'needs-implementation' }, 409);
        if (!reviewReceipts.has(body.operationId)) { reviewRevision++; reviewReceipts.set(body.operationId, { operationId: body.operationId, headSha: body.headSha, moderationRevision: reviewRevision }); }
        if (reviewLostSuccess) { reviewLostSuccess = false; return route.abort('failed'); }
        return json(reviewReceipts.get(body.operationId));
      }
      if (url.pathname.endsWith('/support')) {
        const body = request.postDataJSON(); requests.push(body);
        if (!savedReceipt) { balance -= body.amount; savedReceipt = { entryId: 'receipt-1', key: proposal.key, headSha: proposal.headSha, amount: body.amount, balance, roundId: body.roundId, operationId: body.operationId }; }
        if (lostSuccess) { lostSuccess = false; return route.abort('failed'); }
        return json(savedReceipt);
      }
      if (url.pathname.endsWith('/me')) return json({ wallet: { accountId: 'account', balance, revision: 0 }, entries: [], pointsEnabled: mode !== 'disabled', canModerate: isModerator, moderation: { canReview: isModerator, canCorrectPoints: isModerator, technicalValidationConfigured: isModerator, reviewEndpoint: '/community/moderation/review', decisions: ['open', 'accepted', 'declined'], evidenceFields: ['fightOnOff', 'determinism', 'pairedUi', 'keywordSurfaces'], noteMaxLength: 4000, evidenceMinLength: 20, evidenceMaxLength: 2000, bodyMaxBytes: 16384 } });
      if (/\/proposals\/\d+$/.test(url.pathname)) return json({ proposal: visible, checkedAt: now, staleAfterMs: 300000 });
      return json({ proposals: mode === 'empty' ? [] : [visible], nextCursor: null, contributionUrl: 'https://evil.example/ignored', sourceAvailable: true, pointsEnabled: mode !== 'disabled', round: roundAt(Date.now()), checkedAt: Date.now(), staleAfterMs: 300000 });
    });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?scene=${scene}&layoutAudit=1`, { waitUntil: 'domcontentloaded', timeout: 45_000 }); await ready(page);
    await capture(page, `${platform}-board`, width, height);
    await click(page, 'communityControl', 'SUBMIT ON GITHUB');
    assert.deepEqual(opened, ['https://github.com/wwang109/wandering-hand-content/blob/main/CONTRIBUTING.md']);
    await click(page, 'communityControl', 'NEWEST'); await ready(page);
    assert.equal(await page.evaluate(`window.__game.registry.get('communityUi').sort`), 'newest');
    await click(page, 'communityProposal', 12);
    await capture(page, `${platform}-detail`, width, height);
    await click(page, 'communityControl', '›');
    await capture(page, `${platform}-detail-page2`, width, height);
    if (platform === 'mobile') await click(page, 'communityControl', 'ARTWORK');
    await page.waitForTimeout(500); await capture(page, `${platform}-artwork`, width, height);
    if (platform === 'mobile') await click(page, 'communityControl', 'READ');
    await click(page, 'communityControl', 'VIEW GITHUB PR'); assert.equal(opened.at(-1), 'https://github.com/wwang109/wandering-hand-content/pull/12');
    await click(page, 'communityControl', 'SUPPORT');
    await page.locator('input').fill('2'); await page.getByRole('button', { name: 'REVIEW', exact: true }).click();
    await capture(page, `${platform}-confirm`, width, height);
    await click(page, 'communityControl', 'SPEND POINTS');
    await capture(page, `${platform}-retry`, width, height);
    await page.reload(); await ready(page);
    await capture(page, `${platform}-retry-after-reload`, width, height);
    await click(page, 'communityControl', 'RETRY SAME VOTE'); await ready(page);
    assert.equal(balance, 2); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    assert.equal(await page.evaluate(`window.__game.registry.get('communityUi').balance`), 2);
    await capture(page, `${platform}-receipt`, width, height);
    await click(page, 'communityProposal', 12);
    await click(page, 'communityControl', 'HISTORY');
    assert.equal(await page.evaluate(`window.__game.registry.get('communityUi').historyOpen`), true, JSON.stringify(await page.evaluate(`window.__game.registry.get('communityUi')`)));
    await capture(page, `${platform}-history`, width, height); await click(page, 'communityControl', 'CLOSE');
    for (const state of ['stale', 'disabled'] as const) {
      mode = state; await click(page, 'communityControl', 'REFRESH'); await ready(page);
      await capture(page, `${platform}-${state}`, width, height);
      const supportEnabled = await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.some(o=>o.getData?.('communityControl')==='SUPPORT'&&o.input?.enabled)`);
      assert.equal(supportEnabled, false, `${state}: support must be disabled`);
    }
    mode = 'needs'; await click(page, 'communityControl', 'REFRESH'); await ready(page); await capture(page, `${platform}-needs-votable`, width, height);
    assert.equal(await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.some(o=>o.getData?.('communityControl')==='SUPPORT'&&o.input?.enabled)`), true);
    assert.equal(await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.some(o=>o.getData?.('communityControl')==='REVIEW')`), false);
    isModerator = true; await click(page, 'communityControl', 'REFRESH'); await ready(page);
    await click(page, 'communityControl', 'REVIEW'); await capture(page, `${platform}-review-panel`, width, height);
    await click(page, 'communityControl', 'OPEN FOR VOTING'); await page.locator('textarea').fill('Reviewed scope and attribution. <script>never executes</script>'); await page.getByRole('button', { name: 'NEXT', exact: true }).click();
    await page.waitForFunction(`window.__game.registry.get('communityUi').pendingReview`);
    await capture(page, `${platform}-review-confirm`, width, height);
    await click(page, 'communityControl', 'CONFIRM REVIEW'); await ready(page); await capture(page, `${platform}-review-retry`, width, height);
    await page.reload(); await ready(page); await capture(page, `${platform}-review-retry-reload`, width, height);
    await click(page, 'communityControl', 'RETRY SAME REVIEW'); await ready(page);
    assert.equal(reviewRequests.length, 2); assert.deepEqual(reviewRequests[0], reviewRequests[1]); assert.equal(reviewRevision, 4);
    await capture(page, `${platform}-review-receipt`, width, height);
    await click(page, 'communityControl', 'REVIEW'); await click(page, 'communityControl', 'ADMIT TECHNICAL READINESS');
    await page.locator('textarea').fill('Technical review for the exact candidate version.'); await page.getByRole('button', { name: 'NEXT', exact: true }).click();
    for (const field of ['fightOnOff', 'determinism', 'pairedUi', 'keywordSurfaces']) { await page.locator('textarea').fill(`Evidence reference for ${field}: trusted logs and screenshots for candidate ${'a'.repeat(40)}.`); await page.getByRole('button', { name: 'NEXT', exact: true }).click(); }
    await page.waitForFunction(`window.__game.registry.get('communityUi').pendingReview`);
    await click(page, 'communityControl', 'CONFIRM REVIEW'); await ready(page); await capture(page, `${platform}-review-technical-blocked`, width, height);
    assert.equal(reviewRevision, 4); assert.equal(Object.keys(reviewRequests.at(-1).technicalEvidence).length, 4);
    await click(page, 'communityControl', 'CLOSE');
    mode = 'ready'; await click(page, 'communityControl', 'REFRESH'); await ready(page);
    await click(page, 'communityControl', 'REVIEW'); await click(page, 'communityControl', 'ADMIT TECHNICAL READINESS');
    await page.locator('textarea').fill('Implemented candidate with all trusted evidence reviewed.'); await page.getByRole('button', { name: 'NEXT', exact: true }).click();
    for (const field of ['fightOnOff', 'determinism', 'pairedUi', 'keywordSurfaces']) { await page.locator('textarea').fill(`Verified ${field} evidence reference for exact candidate ${'a'.repeat(40)}.`); await page.getByRole('button', { name: 'NEXT', exact: true }).click(); }
    await page.waitForFunction(`window.__game.registry.get('communityUi').pendingReview`); await capture(page, `${platform}-review-technical-confirm`, width, height);
    await click(page, 'communityControl', 'CONFIRM REVIEW'); await ready(page); assert.equal(reviewRevision, 5); await capture(page, `${platform}-review-admitted`, width, height);
    await click(page, 'communityControl', 'REVIEW'); await click(page, 'communityControl', 'OPEN FOR VOTING'); await page.locator('textarea').fill('Exact head reviewed before a concurrent source change.'); await page.getByRole('button', { name: 'NEXT', exact: true }).click();
    await page.waitForFunction(`window.__game.registry.get('communityUi').pendingReview`);
    mode = 'head-changed'; const reviewCount = reviewRequests.length; await click(page, 'communityControl', 'CONFIRM REVIEW'); await ready(page); await capture(page, `${platform}-review-head-race`, width, height); assert.equal(reviewRequests.length, reviewCount);
    await click(page, 'communityControl', 'CLOSE'); mode = 'ready'; await click(page, 'communityControl', 'REFRESH'); await ready(page);
    await click(page, 'communityControl', 'REVIEW'); await click(page, 'communityControl', 'DECLINE'); await page.locator('textarea').fill('Permission changed after the form was opened.'); await page.getByRole('button', { name: 'NEXT', exact: true }).click(); denyReview = true;
    await page.waitForFunction(`window.__game.registry.get('communityUi').pendingReview`);
    await click(page, 'communityControl', 'CONFIRM REVIEW'); await ready(page); await capture(page, `${platform}-review-permission-denied`, width, height);
    assert.equal(await page.evaluate(`window.__game.registry.get('communityUi').canModerate`), false);
    assert.equal(await page.evaluate(`window.__game.scene.scenes.find(s=>s.sys.isActive()).children.list.some(o=>o.getData?.('communityControl')==='REVIEW')`), false);
    if (platform === 'mobile') await click(page, 'communityControl', '‹ BACK');
    mode = 'long'; await click(page, 'communityControl', 'REFRESH'); await ready(page); await click(page, 'communityProposal', 12); await capture(page, `${platform}-long-contribution`, width, height);
    mode = 'missing-art'; await page.reload(); await ready(page); await click(page, 'communityProposal', 12);
    if (platform === 'mobile') await click(page, 'communityControl', 'ARTWORK');
    await page.waitForTimeout(400); await capture(page, `${platform}-missing-preview`, width, height);
    if (platform === 'mobile') await click(page, 'communityControl', '‹ BACK');
    mode = 'empty'; await click(page, 'communityControl', 'REFRESH'); await ready(page); await capture(page, `${platform}-empty`, width, height);
    mode = 'error'; await click(page, 'communityControl', 'REFRESH'); await ready(page); await capture(page, `${platform}-unavailable`, width, height);
    assert.equal(await page.locator('input[type=file],textarea').count(), 0);
    await page.goto(`${origin}/?ui=${platform}&layoutAudit=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(`window.__game?.scene.isActive('Start')`, undefined, { timeout: 60_000 });
    await page.waitForTimeout(250);
    await capture(page, `${platform}-start`, width, height);
    const startTexts = await collectSceneTexts(page);
    for (const label of ['PLAY  ›', 'PRACTICE  ›', 'SANDBOX ›', 'COMMUNITY ›']) assert(startTexts.some(text => text.text === label), `${platform}: missing ${label}`);
    assert.deepEqual(errors, []);
    evidence.push({ platform, viewport: { width, height }, opened, supportRequests: requests, reviewRequests, reviewRevision, balance, errors });
    await page.close();
    if (process.env.COMMUNITY_UI_LIVE === '1') {
      const live = await browser.newPage({ viewport: { width, height } }); await pinPageAgainstHmr(live);
      const responses: { status: number; path: string }[] = [];
      live.on('response', response => { const url = new URL(response.url()); if (url.pathname.startsWith('/community/')) responses.push({ status: response.status(), path: url.pathname }); });
      await live.goto(`${origin}/?scene=${scene}&layoutAudit=1`, { waitUntil: 'domcontentloaded' }); await ready(live);
      await capture(live, `${platform}-live-board`, width, height);
      assert(responses.some(response => response.path === '/community/proposals' && response.status === 200), `${platform}: live public board must return 200`);
      const liveState = await live.evaluate(`window.__game.registry.get('communityUi')`);
      evidence.push({ live: true, platform, liveState, responses });
      await live.close();
    }
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log('Community UI Totals: 2 platforms; board/art/history, SHA-pinned support and review retries after reload, reviewed unimplemented voting, four-reference technical admission/rejection, stale-head no-POST, permission403, long-text bounds and unavailable states passed.');
