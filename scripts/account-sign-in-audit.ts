import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountService, webCryptoRandomHex, webCryptoSha256Hex, type AccountSessionPayload, type EmailMessage, type AccountStore } from '../src/meta/account';
import { createFileAccountStore } from '../server/accountStoreFile';
import { createD1AccountStore } from '../functions/accountStoreD1';
import { accountEmailSender } from '../functions/accountEmail';
import { createGoogleIdentityVerifier, GOOGLE_JWKS_URL } from '../src/meta/googleIdentity';
import { AuditSqliteD1 } from './community-audit-fixtures';
import { githubOAuthFor, GITHUB_AUTHORIZE_URL, GITHUB_TOKEN_URL, GITHUB_USER_URL } from '../src/meta/githubIdentity';

let now = 1_792_512_000_000;
const clientId = 'fixture-client.apps.googleusercontent.com';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const forgedPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
const encoded = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
async function signed(nonce: string, sub = 'google-subject', claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = pair.privateKey): Promise<string> {
  const head = encoded({ alg: 'RS256', kid: jwk.kid, ...header });
  const body = encoded({ iss: 'https://accounts.google.com', aud: clientId, exp: Math.floor(now / 1000) + 3600, sub, nonce, ...claims });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
}
let keyRequests = 0;
const fixtureFetch: typeof fetch = async input => {
  assert.equal(String(input), GOOGLE_JWKS_URL);
  keyRequests++;
  return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } });
};
const verify = createGoogleIdentityVerifier(clientId, { fetch: fixtureFetch, now: () => now });
assert.equal(await verify(await signed('nonce'), 'nonce'), 'google-subject');
for (const [name, credential] of [
  ['forged', await signed('nonce', 'subject', {}, {}, forgedPair.privateKey)],
  ['wrong audience', await signed('nonce', 'subject', { aud: 'wrong' })],
  ['wrong issuer', await signed('nonce', 'subject', { iss: 'https://attacker.invalid' })],
  ['expired', await signed('nonce', 'subject', { exp: Math.floor(now / 1000) })],
  ['wrong nonce', await signed('different')],
  ['missing nonce', await signed('nonce', 'subject', { nonce: undefined })],
  ['missing expiration', await signed('nonce', 'subject', { exp: undefined })],
  ['malformed expiration', await signed('nonce', 'subject', { exp: '9999999999' })],
  ['future nbf', await signed('nonce', 'subject', { nbf: Math.floor(now / 1000) + 60 })],
  ['empty subject', await signed('nonce', '')],
  ['wrong authorized party', await signed('nonce', 'subject', { azp: 'wrong' })],
  ['multi audience without authorized party', await signed('nonce', 'subject', { aud: [clientId, 'other'] })],
  ['unknown key', await signed('nonce', 'subject', {}, { kid: 'unknown' })],
  ['unsigned algorithm', await signed('nonce', 'subject', {}, { alg: 'none' })],
  ['critical header', await signed('nonce', 'subject', {}, { crit: ['unexpected'] })],
  ['malformed token', 'abc.def.ghi'],
  ['unsigned token', `${encoded({ alg: 'none' })}.${encoded({ sub: 'attacker' })}.`],
] as const) await assert.rejects(verify(credential, 'nonce'), Error, name);
assert.equal(keyRequests, 1, 'unknown keys cannot force unbounded fetches');
now += 30_001;
await assert.rejects(verify(await signed('nonce', 'subject', {}, { kid: 'unknown' }), 'nonce'));
assert.equal(keyRequests, 2, 'unknown key refresh after bounded cooldown');
assert.equal(await verify(await signed('nonce', 'subject', { iss: 'accounts.google.com', aud: [clientId, 'other'], azp: clientId }), 'nonce'), 'subject');
const unavailableVerifier = createGoogleIdentityVerifier(clientId, { now: () => now, fetch: async () => { throw new Error('fixture network outage'); } });
await assert.rejects(unavailableVerifier(await signed('nonce'), 'nonce'));
console.log('OK Google native verifier: signed/forged/issuer/audience/expiry/nonce/subject/nbf/azp/algorithm/structure/key cache and outage');

for (const kind of ['file', 'd1'] as const) {
  let store: AccountStore;
  let db: AuditSqliteD1 | null = null;
  let filePath: string | null = null;
  if (kind === 'file') {
    filePath = join(mkdtempSync(join(tmpdir(), 'account-audit-')), 'accounts.json');
    store = createFileAccountStore(filePath);
  }
  else {
    db = new AuditSqliteD1();
    db.sqlite.exec(readFileSync('migrations/0002_accounts.sql', 'utf8'));
    store = createD1AccountStore(db);
  }
  const emails: EmailMessage[] = [];
  let failEmail = false;
  const githubConfig = { GITHUB_OAUTH_CLIENT_ID: 'fixture-oauth-client', GITHUB_OAUTH_CLIENT_SECRET: 'fixture-server-only-secret' };
  const githubAccessToken = 'fixture_temporary_access_token';
  let githubProfile: unknown = { id: 2468, login: 'original-name', email: 'player@example.com' };
  let githubFailure: 'none' | 'token-http' | 'token-error' | 'profile-http' | 'network' | 'scopes' = 'none';
  let githubFetches = 0;
  const githubAuthorizations: URL[] = [];
  const githubCodeChallenges = new Map<string, string>();
  const github = githubOAuthFor(githubConfig, async (input, init) => {
    githubFetches++;
    assert.equal(init?.redirect, 'error');
    assert(init?.signal);
    if (githubFailure === 'network') throw new Error('private upstream credential detail');
    if (String(input) === GITHUB_TOKEN_URL) {
      assert.equal(init?.method, 'POST');
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get('client_id'), githubConfig.GITHUB_OAUTH_CLIENT_ID);
      assert.equal(params.get('client_secret'), githubConfig.GITHUB_OAUTH_CLIENT_SECRET);
      assert.equal(params.get('redirect_uri'), 'https://game.example/account/github/callback');
      assert.match(params.get('code_verifier') ?? '', /^[0-9a-f]{64}$/);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(params.get('code_verifier')!));
      const actualChallenge = Buffer.from(digest).toString('base64url');
      assert(githubAuthorizations.some(url => url.searchParams.get('code_challenge') === actualChallenge), 'PKCE exchange matches issued authorization challenge');
      if (githubCodeChallenges.get(params.get('code')!) !== actualChallenge) return Response.json({ error: 'bad_verification_code' });
      if (githubFailure === 'token-http') return Response.json({ error: 'fixture-private-error' }, { status: 403 });
      if (githubFailure === 'token-error') return Response.json({ error: 'bad_verification_code' });
      return Response.json({ access_token: githubAccessToken, token_type: 'bearer', scope: githubFailure === 'scopes' ? 'repo' : '' });
    }
    assert.equal(String(input), GITHUB_USER_URL);
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${githubAccessToken}`);
    return githubFailure === 'profile-http' ? Response.json({ message: 'fixture-profile-failure' }, { status: 401 }) : Response.json(githubProfile);
  })!;
  const deps = {
    store, now: () => now, randomHex: webCryptoRandomHex, sha256Hex: webCryptoSha256Hex,
    fetch: async () => ({ text: async () => 'is_valid:true\n' }),
    sendEmail: async (message: EmailMessage) => { if (failEmail) throw new Error('private upstream detail'); emails.push(message); },
    google: { clientId, verifyCredential: verify },
    github,
    allowReturnTo: (url: URL, origin: string) => url.origin === origin,
  };
  const service = createAccountService(deps);
  async function request(path: string, token?: string, body: unknown = {}) {
    const result = await service.handle({ method: 'POST', path, url: new URL(`https://game.example${path}`), authorization: token ? `Bearer ${token}` : null, body: JSON.stringify(body) });
    assert.equal(result.kind, 'json');
    if (result.kind !== 'json') throw new Error('expected JSON');
    return result;
  }
  const register = async (): Promise<AccountSessionPayload> => (await request('/account/register')).body as AccountSessionPayload;
  const challengeFor = async (token: string): Promise<string> => {
    const response = await request('/account/google/start', token);
    assert.equal(response.status, 200);
    const start = response.body as { challenge: string; nonce: string; clientId: string };
    assert.equal(start.challenge, start.nonce);
    assert.equal(start.clientId, clientId);
    return start.challenge;
  };
  const googleSignIn = async (token: string, sub: string) => {
    const challenge = await challengeFor(token);
    return request('/account/google/redeem', token, { challenge, credential: await signed(challenge, sub) });
  };
  const guest = await register();
  assert.deepEqual(guest.features, { google: true, email: true, github: true });
  assert.equal((await request('/account/google/start')).status, 401);
  const firstChallenge = await challengeFor(guest.token);
  const linked = await request('/account/google/redeem', guest.token, { challenge: firstChallenge, credential: await signed(firstChallenge) });
  assert.equal(linked.status, 200);
  const linkedSession = linked.body as AccountSessionPayload;
  assert.equal(linkedSession.account.id, guest.account.id, 'link preserves ownership id');
  assert.equal(linkedSession.notice, 'google-linked');
  assert.equal(await service.authenticate(`Bearer ${guest.token}`), null);
  assert.equal((await request('/account/google/redeem', linkedSession.token, { challenge: firstChallenge, credential: await signed(firstChallenge) })).status, 400);
  const other = await register();
  const switched = (await googleSignIn(other.token, 'google-subject')).body as AccountSessionPayload;
  assert.equal(switched.account.id, guest.account.id);
  assert.equal(switched.notice, 'google-signed-in');
  assert.equal((await store.linksFor(other.account.id)).length, 0, 'switch does not merge account links');
  const attackGuest = await register();
  const wrongAccountChallenge = await challengeFor(linkedSession.token);
  assert.equal((await request('/account/google/redeem', attackGuest.token, { challenge: wrongAccountChallenge, credential: await signed(wrongAccountChallenge) })).status, 400);
  assert.equal((await request('/account/google/redeem', linkedSession.token, { challenge: wrongAccountChallenge, credential: await signed(wrongAccountChallenge) })).status, 400);
  const expiredChallenge = await challengeFor(attackGuest.token);
  now += 300_001;
  assert.equal((await request('/account/google/redeem', attackGuest.token, { challenge: expiredChallenge, credential: await signed(expiredChallenge) })).status, 400);
  const badChallenge = await challengeFor(attackGuest.token);
  assert.equal((await request('/account/google/redeem', attackGuest.token, { challenge: badChallenge, credential: await signed('wrong-nonce') })).status, 400);
  const concurrent = await Promise.all([register(), register()]);
  const raced = await Promise.all(concurrent.map(entry => googleSignIn(entry.token, 'concurrent-sub')));
  assert(raced.every(response => response.status === 200));
  const racedSessions = raced.map(response => response.body as AccountSessionPayload);
  assert.equal(racedSessions[0]!.account.id, racedSessions[1]!.account.id, 'atomic identity claim has one winner');
  assert.equal((await Promise.all(concurrent.map(entry => store.linksFor(entry.account.id)))).flat().filter(link => link.subject === 'concurrent-sub').length, 1);

  const sendEmail = async (email: string, token?: string) => request('/account/email', token, { email, returnTo: 'https://game.example/?one=1&two=2' });
  const latestEmailCode = (): string => new URL(emails[emails.length - 1]!.text.split('\n\n')[1]!).hash.slice('#account-email='.length);
  const emailGuest = await register();
  assert.equal((await sendEmail('player@example.com', emailGuest.token)).status, 202);
  const emailCode = latestEmailCode();
  assert(emails[emails.length - 1]!.subject.includes('Wandering Hand'));
  assert(emails[emails.length - 1]!.html.includes('&amp;two=2'));
  const emailLinked = (await request('/account/redeem', emailGuest.token, { code: emailCode })).body as AccountSessionPayload;
  assert.equal(emailLinked.account.id, emailGuest.account.id);
  assert.equal(emailLinked.notice, 'email-linked');
  assert.equal((await request('/account/redeem', emailLinked.token, { code: emailCode })).status, 400);
  now += 61_000;
  await sendEmail('player@example.com', attackGuest.token);
  const recovered = (await request('/account/redeem', undefined, { code: latestEmailCode() })).body as AccountSessionPayload;
  assert.equal(recovered.account.id, emailLinked.account.id, 'cross-device recovery keeps established account');
  await sendEmail('expired@example.com', attackGuest.token);
  const expiredEmail = latestEmailCode();
  now += 900_001;
  assert.equal((await request('/account/redeem', undefined, { code: expiredEmail })).status, 400);
  await sendEmail('victim@example.com', attackGuest.token);
  const victim = (await request('/account/redeem', undefined, { code: latestEmailCode() })).body as AccountSessionPayload;
  assert.notEqual(victim.account.id, attackGuest.account.id, 'email request initiator cannot pre-hijack redeemer');
  assert.equal((await store.linksFor(attackGuest.account.id)).length, 0);
  assert.equal((await service.authenticate(`Bearer ${attackGuest.token}`))?.id, attackGuest.account.id);
  const unrelatedRedeemer = await register();
  await sendEmail('other-browser@example.com', attackGuest.token);
  const otherBrowser = (await request('/account/redeem', unrelatedRedeemer.token, { code: latestEmailCode() })).body as AccountSessionPayload;
  assert.notEqual(otherBrowser.account.id, attackGuest.account.id);
  assert.notEqual(otherBrowser.account.id, unrelatedRedeemer.account.id, 'cross-account link cannot attach a foreign identity to the redeemer');
  assert.equal((await store.linksFor(unrelatedRedeemer.account.id)).length, 0);
  failEmail = true;
  const failedEmail = await sendEmail('failed@example.com', attackGuest.token);
  assert.equal(failedEmail.status, 503);
  assert.deepEqual(failedEmail.body, { error: 'email-send-failed' });
  failEmail = false;

  const steamGuest = await register();
  async function steamCallback(token: string, steamId: string, alterReturn = false) {
    const started = await request('/account/steam/start', token, { returnTo: 'https://game.example/' });
    const login = new URL((started.body as { url: string }).url);
    const callback = new URL(login.searchParams.get('openid.return_to')!);
    const expectedReturn = callback.toString();
    callback.searchParams.set('openid.mode', 'id_res');
    callback.searchParams.set('openid.op_endpoint', 'https://steamcommunity.com/openid/login');
    callback.searchParams.set('openid.return_to', alterReturn ? expectedReturn.replace(/state=./, 'state=f') + '&changed=1' : expectedReturn);
    callback.searchParams.set('openid.claimed_id', `https://steamcommunity.com/openid/id/${steamId}`);
    callback.searchParams.set('openid.identity', `https://steamcommunity.com/openid/id/${steamId}`);
    callback.searchParams.set('openid.signed', 'op_endpoint,claimed_id,identity,return_to,response_nonce');
    callback.searchParams.set('openid.response_nonce', new Date(now).toISOString());
    return service.handle({ method: 'GET', path: callback.pathname, url: callback, authorization: null, body: '' });
  }
  function handoff(result: Awaited<ReturnType<typeof steamCallback>>): string {
    if (result.kind !== 'redirect') throw new Error('Steam callback must redirect');
    return new URL(result.location).hash.slice('#account-handoff='.length);
  }
  const callback = await steamCallback(steamGuest.token, '76561198000000001');
  assert.equal((await store.linksFor(steamGuest.account.id)).length, 0, 'callback defers linking to authenticated redemption');
  const steamCode = handoff(callback);
  const steamLinked = (await request('/account/redeem', steamGuest.token, { code: steamCode })).body as AccountSessionPayload;
  assert.equal(steamLinked.account.id, steamGuest.account.id);
  assert.equal(steamLinked.notice, 'steam-linked');
  assert.equal((await request('/account/redeem', steamLinked.token, { code: steamCode })).status, 400);
  const steamRecovery = (await request('/account/redeem', undefined, { code: handoff(await steamCallback(attackGuest.token, '76561198000000001')) })).body as AccountSessionPayload;
  assert.equal(steamRecovery.account.id, steamGuest.account.id);
  const steamVictim = (await request('/account/redeem', undefined, { code: handoff(await steamCallback(attackGuest.token, '76561198000000002')) })).body as AccountSessionPayload;
  assert.notEqual(steamVictim.account.id, attackGuest.account.id, 'Steam initiator cannot pre-hijack redeemer');
  const badCallback = await steamCallback(attackGuest.token, '76561198000000003', true);
  assert(badCallback.kind === 'redirect' && badCallback.location.endsWith('#account=steam-failed'));
  const expiredSteam = handoff(await steamCallback(attackGuest.token, '76561198000000004'));
  now += 120_001;
  assert.equal((await request('/account/redeem', undefined, { code: expiredSteam })).status, 400);
  const emailClaimGuest = await register();
  const emailClaimChallenge = await challengeFor(emailClaimGuest.token);
  const independentIdentity = (await request('/account/google/redeem', emailClaimGuest.token, {
    challenge: emailClaimChallenge, credential: await signed(emailClaimChallenge, 'independent-google-sub', { email: 'player@example.com', email_verified: true }),
  })).body as AccountSessionPayload;
  assert.equal(independentIdentity.account.id, emailClaimGuest.account.id);
  assert.notEqual(independentIdentity.account.id, emailLinked.account.id, 'matching Google email never merges identities');

  async function githubStart(token: string): Promise<URL> {
    const result = await request('/account/github/start', token, { returnTo: 'https://game.example/?ui=desktop' });
    assert.equal(result.status, 200);
    const raw = JSON.stringify(result.body);
    assert(!raw.includes(githubConfig.GITHUB_OAUTH_CLIENT_SECRET) && !raw.includes(githubAccessToken));
    const url = new URL((result.body as { url: string }).url);
    assert.equal(url.origin + url.pathname, GITHUB_AUTHORIZE_URL);
    assert.equal(url.searchParams.get('client_id'), githubConfig.GITHUB_OAUTH_CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://game.example/account/github/callback');
    assert.equal(url.searchParams.get('scope'), '');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url.searchParams.get('code_challenge')!, /^[A-Za-z0-9_-]{43}$/);
    assert.match(url.searchParams.get('state')!, /^[0-9a-f]{64}$/);
    assert(!url.searchParams.has('code_verifier') && !url.searchParams.has('client_secret'));
    githubAuthorizations.push(url);
    return url;
  }
  async function githubCallback(authorization: URL, params: Record<string, string> = { code: `fixture-${authorization.searchParams.get('state')!}` }, origin = 'https://game.example') {
    const url = new URL('/account/github/callback', origin);
    url.searchParams.set('state', authorization.searchParams.get('state')!);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (params.code && !githubCodeChallenges.has(params.code)) githubCodeChallenges.set(params.code, authorization.searchParams.get('code_challenge')!);
    const result = await service.handle({ method: 'GET', path: url.pathname, url, authorization: null, body: '' });
    const raw = JSON.stringify(result);
    assert(!raw.includes(githubConfig.GITHUB_OAUTH_CLIENT_SECRET) && !raw.includes(githubAccessToken), 'provider secrets never enter responses');
    return result;
  }
  async function githubHandoff(token: string): Promise<string> { return handoff(await githubCallback(await githubStart(token))); }
  assert.equal((await request('/account/github/start', undefined, { returnTo: 'https://game.example/' })).status, 401);
  assert.equal((await request('/account/github/start', attackGuest.token, { returnTo: 'https://attacker.invalid/' })).status, 400);
  const forgedState = await githubCallback(new URL(`${GITHUB_AUTHORIZE_URL}?state=${'0'.repeat(64)}`));
  assert(forgedState.kind === 'json' && forgedState.status === 400);
  const githubGuest = await register();
  const authorization = await githubStart(githubGuest.token);
  const githubCallbackResult = await githubCallback(authorization);
  assert.equal((await store.linksFor(githubGuest.account.id)).length, 0, 'GitHub callback verifies identity without linking');
  const githubCode = handoff(githubCallbackResult);
  const githubLinked = (await request('/account/redeem', githubGuest.token, { code: githubCode })).body as AccountSessionPayload;
  assert.equal(githubLinked.account.id, githubGuest.account.id);
  assert.equal(githubLinked.notice, 'github-linked');
  assert.deepEqual(githubLinked.account.links, [{ provider: 'github', label: 'GitHub' }]);
  assert.equal((await request('/account/redeem', githubLinked.token, { code: githubCode })).status, 400);
  const callbackReplay = await githubCallback(authorization);
  assert(callbackReplay.kind === 'json' && callbackReplay.status === 400);
  githubProfile = { id: 2468, login: 'renamed-user', email: 'changed@example.com' };
  const githubSwitchGuest = await register();
  const githubSwitched = (await request('/account/redeem', githubSwitchGuest.token, { code: await githubHandoff(githubSwitchGuest.token) })).body as AccountSessionPayload;
  assert.equal(githubSwitched.account.id, githubLinked.account.id, 'stable numeric id survives username/email changes');
  assert.equal(githubSwitched.notice, 'github-signed-in');
  assert.equal((await store.linksFor(githubSwitchGuest.account.id)).length, 0, 'GitHub switch preserves independent account ownership');
  const recovery = (await request('/account/redeem', undefined, { code: await githubHandoff(attackGuest.token) })).body as AccountSessionPayload;
  assert.equal(recovery.account.id, githubLinked.account.id, 'GitHub cross-device recovery resolves linked id');
  githubProfile = { id: 2469, login: 'first-victim' };
  const githubVictim = (await request('/account/redeem', undefined, { code: await githubHandoff(attackGuest.token) })).body as AccountSessionPayload;
  assert.notEqual(githubVictim.account.id, attackGuest.account.id, 'GitHub initiation cannot pre-hijack victim');
  assert.equal((await service.authenticate(`Bearer ${attackGuest.token}`))?.id, attackGuest.account.id);
  const foreignRedeemer = await register();
  githubProfile = { id: 2470, login: 'foreign-identity' };
  const foreignGithub = (await request('/account/redeem', foreignRedeemer.token, { code: await githubHandoff(attackGuest.token) })).body as AccountSessionPayload;
  assert.notEqual(foreignGithub.account.id, foreignRedeemer.account.id, 'foreign GitHub identity cannot attach to a different redeeming account');
  assert.notEqual(foreignGithub.account.id, attackGuest.account.id);
  assert.equal((await store.linksFor(foreignRedeemer.account.id)).length, 0);
  githubProfile = { id: 2471, login: 'email-match', email: 'player@example.com' };
  const githubEmailGuest = await register();
  const githubEmail = (await request('/account/redeem', githubEmailGuest.token, { code: await githubHandoff(githubEmailGuest.token) })).body as AccountSessionPayload;
  assert.equal(githubEmail.account.id, githubEmailGuest.account.id, 'GitHub email never auto-merges');
  assert.notEqual(githubEmail.account.id, emailLinked.account.id);
  const deniedAuthorization = await githubStart(attackGuest.token);
  const beforeDenied = githubFetches;
  const denied = await githubCallback(deniedAuthorization, { error: 'access_denied' });
  assert(denied.kind === 'redirect' && denied.location.endsWith('#account=github-cancelled'));
  assert.equal(githubFetches, beforeDenied, 'denied authorization makes no provider calls');
  const denialReplay = await githubCallback(deniedAuthorization);
  assert(denialReplay.kind === 'json' && denialReplay.status === 400);
  const missingCode = await githubCallback(await githubStart(attackGuest.token), {});
  assert(missingCode.kind === 'redirect' && missingCode.location.endsWith('#account=github-failed'));
  const wrongCallbackOrigin = await githubCallback(await githubStart(attackGuest.token), { code: 'fixture-code' }, 'https://attacker.invalid');
  assert(wrongCallbackOrigin.kind === 'redirect' && wrongCallbackOrigin.location.endsWith('#account=github-failed'));
  const substitutionOrigin = await githubStart(attackGuest.token);
  const substitutionTarget = await githubStart(attackGuest.token);
  githubCodeChallenges.set('substituted-code', substitutionOrigin.searchParams.get('code_challenge')!);
  const substituted = await githubCallback(substitutionTarget, { code: 'substituted-code' });
  assert(substituted.kind === 'redirect' && substituted.location.endsWith('#account=github-failed'), 'code from another state cannot satisfy PKCE');
  const expiredAuthorization = await githubStart(attackGuest.token);
  now += 600_001;
  const expiredState = await githubCallback(expiredAuthorization);
  assert(expiredState.kind === 'json' && expiredState.status === 400);
  githubProfile = { id: 2472 };
  const expiredGithubHandoff = await githubHandoff(attackGuest.token);
  now += 120_001;
  assert.equal((await request('/account/redeem', undefined, { code: expiredGithubHandoff })).status, 400);
  for (const failure of ['token-http', 'token-error', 'profile-http', 'network', 'scopes'] as const) {
    githubFailure = failure;
    const failed = await githubCallback(await githubStart(attackGuest.token));
    assert(failed.kind === 'redirect' && failed.location.endsWith('#account=github-failed'), failure);
  }
  githubFailure = 'none';
  for (const id of ['2473', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    githubProfile = { id, login: 'untrusted-profile' };
    const invalidProfile = await githubCallback(await githubStart(attackGuest.token));
    assert(invalidProfile.kind === 'redirect' && invalidProfile.location.endsWith('#account=github-failed'), 'invalid numeric GitHub id');
  }
  githubProfile = { id: 2500 };
  const racingGithubGuests = await Promise.all([register(), register()]);
  const githubHandoffs = await Promise.all(racingGithubGuests.map(entry => githubHandoff(entry.token)));
  const githubClaims = await Promise.all(racingGithubGuests.map((entry, index) => request('/account/redeem', entry.token, { code: githubHandoffs[index] })));
  assert(githubClaims.every(result => result.status === 200));
  assert.equal((githubClaims[0]!.body as AccountSessionPayload).account.id, (githubClaims[1]!.body as AccountSessionPayload).account.id);
  assert.equal((await Promise.all(racingGithubGuests.map(entry => store.linksFor(entry.account.id)))).flat().filter(link => link.provider === 'github').length, 1);
  assert.equal((await store.findLink('github', '2468'))?.accountId, githubLinked.account.id);
  const persisted = db ? JSON.stringify(db.sqlite.prepare('SELECT * FROM auth_codes').all()) : readFileSync(filePath!, 'utf8');
  assert(!persisted.includes(githubAccessToken) && !persisted.includes(githubConfig.GITHUB_OAUTH_CLIENT_SECRET));
  console.log(`OK GitHub OAuth ${kind}: S256/code exchange/public id/rename/link/switch/recovery/concurrent claim; denial/failures/invalid id/state+handoff expiry/replay/origin; both forced-link directions; no scopes or credential disclosure`);

  const signedOut = await request('/account/signout', linkedSession.token);
  assert.equal(signedOut.status, 200);
  const nextGuest = signedOut.body as AccountSessionPayload;
  assert.notEqual(nextGuest.account.id, guest.account.id);
  assert.equal(nextGuest.account.links.length, 0);
  assert.equal(await service.authenticate(`Bearer ${linkedSession.token}`), null);
  assert.equal((await service.authenticate(`Bearer ${nextGuest.token}`))?.id, nextGuest.account.id);
  assert.equal((await request('/account/signout', linkedSession.token)).status, 401);
  const unconfigured = createAccountService({ ...deps, google: null, sendEmail: null, github: null });
  const unavailable = await unconfigured.handle({ method: 'POST', path: '/account/google/start', url: new URL('https://game.example/account/google/start'), authorization: `Bearer ${nextGuest.token}`, body: '{}' });
  assert(unavailable.kind === 'json' && unavailable.status === 503);
  const unavailableGithub = await unconfigured.handle({ method: 'POST', path: '/account/github/start', url: new URL('https://game.example/account/github/start'), authorization: `Bearer ${nextGuest.token}`, body: '{}' });
  assert(unavailableGithub.kind === 'json' && unavailableGithub.status === 503);
  db?.sqlite.close();
  console.log(`OK account service ${kind}: Google link/switch/race/expiry/replay/wrong-account, email link/recovery/expiry/replay/delivery failure, email+Steam pre-hijack rejection, Steam regression/return_to, signout revocation/new guest/unconfigured`);
}

const email: EmailMessage = { to: 'recipient@example.com', subject: 'Wandering Hand', text: 'fixture', html: '<p>fixture</p>' };
assert.equal(githubOAuthFor({}), null);
assert.equal(githubOAuthFor({ GITHUB_OAUTH_CLIENT_ID: 'fixture' }), null);
assert.equal(githubOAuthFor({ GITHUB_OAUTH_CLIENT_SECRET: 'fixture' }), null);
const emailEnv = { EMAIL_FROM: 'sender@example.com', EMAIL_ACCOUNT_ID: 'a'.repeat(32), EMAIL_API_TOKEN: 'fixture-only-token' };
assert.equal(accountEmailSender({}), null);
let nativeSent = false;
await accountEmailSender({ EMAIL_FROM: 'sender@example.com', EMAIL: { send: async message => { assert.equal(message.to, email.to); nativeSent = true; } } })!(email);
assert(nativeSent);
for (const delivered of [true, false]) {
  const sender = accountEmailSender(emailEnv, async (input, init) => {
    assert.equal(String(input), `https://api.cloudflare.com/client/v4/accounts/${emailEnv.EMAIL_ACCOUNT_ID}/email/sending/send`);
    assert.equal(JSON.parse(String(init?.body)).from, emailEnv.EMAIL_FROM);
    return Response.json({ success: true, result: { delivered: delivered ? [email.to] : [], queued: delivered ? [] : [email.to], permanent_bounces: [] } });
  })!;
  await sender(email);
}
for (const response of [Response.json({ success: false }, { status: 403 }), Response.json({ success: true, result: { delivered: [], queued: [], permanent_bounces: [email.to] } }), Response.json({ success: true, result: { delivered: [], queued: [] } })]) {
  const sender = accountEmailSender(emailEnv, async () => response)!;
  await assert.rejects(sender(email), { message: 'email-send-failed' });
}
console.log('OK email adapters: unavailable/native config, REST delivered/queued, rejected/bounced/unaccepted fail generically');
console.log('account sign-in audit OK: native JWT verification and file/D1 account security; isolated stores only; no live provider or email delivery');
