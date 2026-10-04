import { createServer } from 'node:http';
import { resolveBattle, type BattleRequest } from '../src/run/resolveBattle';
import { damagePerTurn, type DamageProfileOpts } from '../src/run/analysis';
import { skillBook } from '../src/data/skills';
import type { CombatantSetup } from '../src/engine/types';
import { validateGhostSubmission, type GhostSubmissionInput } from '../src/run/ghostValidate';
import { createFileGhostStore } from './ghostStoreFile';
import { createAccountService, webCryptoRandomHex, webCryptoSha256Hex } from '../src/meta/account';
import { createFileAccountStore } from './accountStoreFile';

/**
 * Battle API — the only thing that may run combat.
 *
 * - `POST /battle`      prep info  → event log
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
const accountService = createAccountService({
  store: createFileAccountStore(process.env.ACCOUNT_STORE_FILE),
  now: () => Date.now(),
  randomHex: webCryptoRandomHex,
  sha256Hex: webCryptoSha256Hex,
  fetch: (target, init) => fetch(target, init),
  sendEmail: async (message) => { console.log(`[account email] to ${message.to}\n${message.text}`); },
  allowReturnTo: (returnTo, apiOrigin) => returnTo.hostname === new URL(apiOrigin).hostname,
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

  if (route.startsWith('/account/')) {
    let accountBody = '';
    req.on('data', (chunk) => { accountBody += chunk; });
    req.on('end', () => {
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
        .catch((err: unknown) => json(500, { error: err instanceof Error ? err.message : String(err) }));
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

  if (req.method !== 'POST' || (route !== '/battle' && route !== '/damage-band' && route !== '/ghosts')) {
    json(404, { error: 'POST /battle, POST /damage-band, POST /ghosts, GET /ghosts, or POST /ghosts/:id/result' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
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
