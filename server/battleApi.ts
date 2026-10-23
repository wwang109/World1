import { createServer } from 'node:http';
import { resolveBattle, type BattleRequest } from '../src/run/resolveBattle';
import { resolveDesignBattle, type DesignBattleRequest } from '../src/run/designBattle';
import { DESIGN_BATTLE_MAX_BYTES } from '../src/run/designProbe';
import { buildBattlePassiveExample } from '../src/data/battlePassiveExamples';
import { damagePerTurn, type DamageProfileOpts } from '../src/run/analysis';
import { skillBook } from '../src/data/skills';
import type { CombatantSetup } from '../src/engine/types';
import { validateGhostSubmission, type GhostSubmissionInput } from '../src/run/ghostValidate';
import { createFileGhostStore } from './ghostStoreFile';
import { ACCOUNT_BODY_MAX_BYTES, createAccountService, webCryptoRandomHex, webCryptoSha256Hex } from '../src/meta/account';
import { createGoogleIdentityVerifier } from '../src/meta/googleIdentity';
import { githubOAuthFor } from '../src/meta/githubIdentity';
import { accountEmailSender } from '../functions/accountEmail';
import { createFileAccountStore } from './accountStoreFile';
import { createDurableCommunityState, createFileCommunityStore } from './communityStoreFile';
import { createCommunityService } from '../src/service/community/service';
import { createGitHubReadPort } from '../src/service/community/github';
import { COMMUNITY_BODY_MAX_BYTES } from '../src/community/types';
import { CommunityError } from '../src/community/validate';
import { createFileEligibleRunStore } from './eligibleRunStoreFile';
import { createFileEligibleGhostPorts } from './eligibleGhostPorts';
import { createEligibleRunService } from '../src/service/runs/service';
import { executorRegistry, presentEligibleRun } from '../src/service/runs/executorRegistry';
import { createEligibleRunHttpHandler } from './eligibleRunHttp';
import { createGitHubTechnicalReadiness, trustedValidationConfig } from '../src/service/community/trustedValidation';

/**
 * Battle API — the only thing that may run combat.
 *
 * - `POST /battle`      prep info  → event log
 * - `POST /design-battle` a Card Designer draft → practice-fight event log
 * - `POST /damage-band` a setup    → sustained damage-per-turn band
 * - `POST /ghosts`      submit a ghost boss build
 * - `GET  /ghosts`      fetch a ghost for a band
 * - `POST /ghosts/:id/result` report a settled ghost fight's outcome
 * - `/account/*`        guest accounts, Steam and email linking (src/meta/account.ts)
 *
 * Both are thin wrappers; the logic lives in `src/run`. The client cannot
 * simulate at all (enforced by `scripts/check-boundaries.mjs`), so the prep
 * screen's DMG/turn preview has to come from here too.
 */

interface DamageBandRequest { setup: CombatantSetup; opts?: DamageProfileOpts }
const PORT = Number(process.env.PORT ?? 8787);
const ghostStore = process.env.GHOST_STORE_FILE
  ? createFileGhostStore(process.env.GHOST_STORE_FILE)
  : createFileGhostStore();
const accountStore = createFileAccountStore(process.env.ACCOUNT_STORE_FILE);
const accountService = createAccountService({
  store: accountStore,
  now: () => Date.now(),
  randomHex: webCryptoRandomHex,
  sha256Hex: webCryptoSha256Hex,
  fetch: (target, init) => fetch(target, init),
  sendEmail: process.env.ACCOUNT_EMAIL_PREVIEW === 'true' ? async (message) => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    const previewFile = process.env.ACCOUNT_EMAIL_PREVIEW_FILE ?? '.tmp/account-email-preview.json';
    mkdirSync(dirname(previewFile), { recursive: true });
    writeFileSync(previewFile, JSON.stringify(message, null, 2));
  } : accountEmailSender(process.env),
  google: process.env.GOOGLE_CLIENT_ID ? { clientId: process.env.GOOGLE_CLIENT_ID, verifyCredential: createGoogleIdentityVerifier(process.env.GOOGLE_CLIENT_ID) } : null,
  github: githubOAuthFor(process.env),
  allowReturnTo: (returnTo, apiOrigin) => returnTo.hostname === new URL(apiOrigin).hostname,
});
const communityRepositoryId = process.env.COMMUNITY_REPOSITORY_ID && /^\d+$/.test(process.env.COMMUNITY_REPOSITORY_ID) ? process.env.COMMUNITY_REPOSITORY_ID : null;
const eligibleCommunityState = createDurableCommunityState(process.env.ELIGIBLE_COMMUNITY_STORE_FILE);
const eligibleRunHandler = createEligibleRunHttpHandler(createEligibleRunService(createFileEligibleRunStore(presentEligibleRun, eligibleCommunityState), executorRegistry, createFileEligibleGhostPorts(eligibleCommunityState)), accountService.authenticate, process.env.ELIGIBLE_RUNS_ENABLED === 'true');
const communityStore = createFileCommunityStore(eligibleCommunityState);
const validationConfig = trustedValidationConfig(process.env);
const communityService = createCommunityService({
  store: communityStore,
  github: communityRepositoryId ? createGitHubReadPort({ repositoryId: communityRepositoryId, token: process.env.COMMUNITY_READER_TOKEN, lookupCachedProposal: key => communityStore.getProposal(key) }) : null,
  repositoryId: communityRepositoryId,
  authenticate: accountService.authenticate,
  linkedProvider: async accountId => (await accountStore.linksFor(accountId)).length > 0,
  moderators: (process.env.COMMUNITY_MODERATORS ?? '').split(',').map(value => value.trim()).filter(Boolean),
  now: () => Date.now(), hash: webCryptoSha256Hex,
  hashBytes: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))).map(value => value.toString(16).padStart(2, '0')).join(''),
  randomId: () => webCryptoRandomHex(16), rulesRevision: process.env.GAME_RULES_REVISION ?? '', contentApiVersion: Number(process.env.CONTENT_API_VERSION ?? 1), readiness: validationConfig ? createGitHubTechnicalReadiness(communityStore, validationConfig) : null,
  pointsEnabled: process.env.COMMUNITY_POINTS_ENABLED === 'true',
});

createServer((req, res) => {
  const json = (code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    });
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${String(PORT)}`}`);
  const route = url.pathname;

  if (route === '/runs' || route.startsWith('/runs/')) {
    res.setHeader('access-control-allow-origin', '*');
    eligibleRunHandler(req, res).catch(() => json(503, { error: 'eligible-run-unavailable' }));
    return;
  }

  if (route === '/community' || route.startsWith('/community/')) {
    const preview = /^\/community\/proposals\/([1-9]\d*)\/previews$/.exec(route);
    if (req.method === 'GET' && preview) {
      communityService.asset(Number(preview[1]), url.searchParams.get('sha') ?? '', url.searchParams.get('path') ?? '').then(asset => {
        if (!asset) { json(404, { error: 'preview-not-found' }); return; }
        res.writeHead(200, { 'content-type': asset.contentType, 'access-control-allow-origin': '*', 'cache-control': 'public,max-age=31536000,immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", etag: `"${asset.hash}"` });
        res.end(asset.bytes);
      }).catch((error: unknown) => json(error instanceof CommunityError ? error.status : 503, { error: error instanceof CommunityError ? error.message : 'community-unavailable' }));
      return;
    }
    let communityBody = ''; let bytes = 0; let rejected = false;
    req.on('data', (chunk: Buffer) => { if (rejected) return; bytes += chunk.length; if (bytes > COMMUNITY_BODY_MAX_BYTES) { rejected = true; json(413, { error: 'body-too-large' }); return; } communityBody += chunk.toString('utf8'); });
    req.on('end', () => { if (!rejected) communityService.handle({ method: req.method ?? 'GET', path: route, url, authorization: req.headers.authorization ?? null, body: communityBody }).then(result => json(result.status, result.body)).catch(() => json(503, { error: 'community-unavailable' })); });
    return;
  }

  if (route.startsWith('/account/')) {
    res.setHeader('cache-control', 'no-store');
    let accountBody = '';
    let accountBytes = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      accountBytes += chunk.length;
      if (accountBytes > ACCOUNT_BODY_MAX_BYTES) { rejected = true; json(413, { error: 'body-too-large' }); return; }
      accountBody += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (rejected) return;
      accountService.handle({
        method: req.method ?? 'GET',
        path: route,
        url,
        authorization: req.headers.authorization ?? null,
        body: accountBody,
      })
        .then((result) => {
          if (result.kind === 'redirect') {
            res.writeHead(302, { location: result.location, 'cache-control': 'no-store' });
            res.end();
            return;
          }
          json(result.status, result.body);
        })
        .catch(() => json(503, { error: 'account-unavailable' }));
    });
    return;
  }

  if (req.method === 'GET' && route === '/ghosts') {
    const band = Number(url.searchParams.get('band'));
    if (!Number.isInteger(band) || band < 0) {
      json(400, { error: 'GET /ghosts requires an integer ?band=' });
      return;
    }
    const exclude = url.searchParams.get('exclude') ?? undefined;
    ghostStore.fetchForBand(band, exclude)
      .then((record) => json(200, record))
      .catch((err: unknown) => json(400, { error: err instanceof Error ? err.message : String(err) }));
    return;
  }

  const resultMatch = /^\/ghosts\/([^/]+)\/result$/.exec(route);
  if (req.method === 'POST' && resultMatch) {
    let resultBody = '';
    req.on('data', (chunk) => { resultBody += chunk; });
    req.on('end', () => {
      try {
        const { ghostWon } = JSON.parse(resultBody) as { ghostWon: boolean };
        ghostStore.reportResult(resultMatch[1]!, Boolean(ghostWon))
          .then((outcome) => {
            if (outcome.ok) { json(200, { ok: true }); return; }
            json(404, { error: outcome.reason });
          })
          .catch((err: unknown) => json(400, { error: err instanceof Error ? err.message : String(err) }));
      } catch (err) {
        json(400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return;
  }

  if (req.method !== 'POST' || (route !== '/battle' && (route !== '/battle-example' || process.env.NODE_ENV === 'production') && route !== '/damage-band' && route !== '/design-battle' && route !== '/ghosts')) {
    json(404, { error: 'POST /battle, POST /damage-band, POST /design-battle, POST /ghosts, GET /ghosts, or POST /ghosts/:id/result' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      if (route === '/design-battle') {
        if (body.length > DESIGN_BATTLE_MAX_BYTES) {
          json(413, { error: 'body-too-large' });
          return;
        }
        json(200, resolveDesignBattle(JSON.parse(body) as DesignBattleRequest));
        return;
      }
      if (route === '/battle-example') {
        const input = JSON.parse(body) as Record<string, unknown>;
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).some(key => key !== 'exampleId' && key !== 'seed')
          || typeof input.exampleId !== 'string') throw new Error('Expected a registered exampleId and optional seed');
        const { request, preparation } = buildBattlePassiveExample(input.exampleId, input.seed as number | undefined);
        json(200, resolveBattle(request, preparation));
        return;
      }
      if (route === '/damage-band') {
        const { setup, opts } = JSON.parse(body) as DamageBandRequest;
        json(200, damagePerTurn(setup, skillBook, opts ?? {}));
        return;
      }
      if (route === '/ghosts') {
        const input = JSON.parse(body) as GhostSubmissionInput;
        accountService.authenticate(req.headers.authorization ?? null)
          .then(async (account) => {
            if (!account) {
              json(401, { error: 'missing-account' });
              return;
            }
            const result = validateGhostSubmission({ ...input, ownerLocalId: account.id });
            if (!result.ok) {
              json(400, { error: result.reason, detail: result.detail });
              return;
            }
            const record = await ghostStore.save(result.record);
            json(201, { id: record.id });
          })
          .catch((err: unknown) => json(400, { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
      json(200, resolveBattle(JSON.parse(body) as BattleRequest));
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}).listen(PORT, () => {
  console.log(`battle api: http://localhost:${PORT}/battle`);
});
