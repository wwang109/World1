import { GHOST_NAME_MAX } from '../run/ghost';
import { normalizeGhostName } from '../run/ghostValidate';
import type { GitHubOAuth } from './githubIdentity';

export type AccountProvider = 'google' | 'steam' | 'email' | 'github';
export type AuthCodePurpose = 'google-nonce' | 'steam-state' | 'email' | 'steam-handoff' | 'github-state' | 'github-handoff';

export interface AccountRecord {
  id: string;
  displayName: string;
  createdAt: number;
}

export interface AccountLink {
  provider: AccountProvider;
  subject: string;
  accountId: string;
  createdAt: number;
}

export interface AuthCode {
  codeHash: string;
  purpose: AuthCodePurpose;
  accountId: string | null;
  subject: string | null;
  returnTo: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface AccountStore {
  getAccount(id: string): Promise<AccountRecord | null>;
  createAccount(record: AccountRecord): Promise<void>;
  renameAccount(id: string, displayName: string): Promise<void>;
  addSession(tokenHash: string, accountId: string, createdAt: number): Promise<void>;
  accountIdForSession(tokenHash: string): Promise<string | null>;
  revokeSession(tokenHash: string): Promise<void>;
  linksFor(accountId: string): Promise<AccountLink[]>;
  findLink(provider: AccountProvider, subject: string): Promise<AccountLink | null>;
  addLink(link: AccountLink): Promise<AccountLink>;
  putCode(code: AuthCode): Promise<void>;
  takeCode(codeHash: string): Promise<AuthCode | null>;
  latestCodeFor(purpose: AuthCodePurpose, subject: string): Promise<AuthCode | null>;
}

export interface AccountLinkView {
  provider: AccountProvider;
  label: string;
}

export interface AccountView {
  id: string;
  displayName: string;
  links: AccountLinkView[];
}

export interface AccountFeatures {
  email: boolean;
  google: boolean;
  github: boolean;
}

export interface AccountSessionPayload {
  token: string;
  account: AccountView;
  features: AccountFeatures;
  notice?: AccountNotice;
}

export type AccountNotice =
  | 'github-linked'
  | 'github-signed-in'
  | 'github-failed'
  | 'github-expired'
  | 'github-cancelled'
  | 'google-linked'
  | 'google-signed-in'
  | 'signed-out'
  | 'steam-linked'
  | 'steam-signed-in'
  | 'email-linked'
  | 'email-signed-in'
  | 'steam-failed'
  | 'steam-expired'
  | 'link-expired';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface AccountServiceDeps {
  store: AccountStore;
  now: () => number;
  randomHex: (bytes: number) => string;
  sha256Hex: (value: string) => Promise<string>;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ text(): Promise<string> }>;
  sendEmail: ((message: EmailMessage) => Promise<void>) | null;
  google?: { clientId: string; verifyCredential: (credential: string, nonce: string) => Promise<string> } | null;
  github?: GitHubOAuth | null;
  allowReturnTo: (returnTo: URL, apiOrigin: string) => boolean;
}

export type AccountServiceResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'redirect'; location: string };

export interface AccountRequest {
  method: string;
  path: string;
  url: URL;
  authorization: string | null;
  body: string;
}

export const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
export const STEAM_STATE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
export const HANDOFF_TTL_MS = 2 * 60 * 1000;
export const EMAIL_COOLDOWN_MS = 60 * 1000;
export const GOOGLE_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const GITHUB_STATE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_MAX_LENGTH = 254;
export const ACCOUNT_BODY_MAX_BYTES = 16384;
export const HASH_EMAIL_PREFIX = 'account-email=';
export const HASH_HANDOFF_PREFIX = 'account-handoff=';
export const HASH_NOTICE_PREFIX = 'account=';

const GUEST_NOUNS = [
  'Rook', 'Ember', 'Ash', 'Wren', 'Moth', 'Fox', 'Vale', 'Thorn',
  'Brand', 'Crow', 'Sage', 'Flint', 'Drake', 'Pike', 'Shade', 'Rune',
] as const;

export function guestNameFor(accountId: string): string {
  const noun = GUEST_NOUNS[parseInt(accountId.charAt(0), 16) % GUEST_NOUNS.length] ?? 'Rook';
  return `${noun}-${accountId.slice(1, 5).toUpperCase()}`.slice(0, GHOST_NAME_MAX);
}

export function normalizeAccountName(raw: unknown): string | null {
  return typeof raw === 'string' ? normalizeGhostName(raw) : null;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.charAt(0)}***${email.slice(at)}`;
}

export function steamIdFromClaimedId(claimedId: string | null): string | null {
  if (claimedId === null) return null;
  const match = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimedId);
  return match ? match[1]! : null;
}

export function steamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function webCryptoRandomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toHex(buffer);
}

export async function webCryptoSha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

function bearerToken(authorization: string | null): string | null {
  if (authorization === null) return null;
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization.trim());
  return match ? match[1]! : null;
}

function json(status: number, body: unknown): AccountServiceResult {
  return { kind: 'json', status, body };
}

function parseBody(raw: string): Record<string, unknown> | null {
  if (raw.length > ACCOUNT_BODY_MAX_BYTES) return null;
  if (raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function withHash(base: URL, hash: string): string {
  const target = new URL(base.toString());
  target.hash = hash;
  return target.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function createAccountService(deps: AccountServiceDeps) {
  const { store } = deps;
  const features: AccountFeatures = { email: deps.sendEmail !== null, google: Boolean(deps.google?.clientId), github: Boolean(deps.github) };

  async function view(account: AccountRecord): Promise<AccountView> {
    const links = await store.linksFor(account.id);
    return {
      id: account.id,
      displayName: account.displayName,
      links: links.map((link) => ({
        provider: link.provider,
        label: link.provider === 'email' ? maskEmail(link.subject) : link.provider === 'google' ? 'Google' : link.provider === 'github' ? 'GitHub' : 'Steam',
      })),
    };
  }

  async function issueSession(account: AccountRecord, notice?: AccountNotice): Promise<AccountSessionPayload> {
    const token = deps.randomHex(32);
    await store.addSession(await deps.sha256Hex(token), account.id, deps.now());
    const payload: AccountSessionPayload = { token, account: await view(account), features };
    if (notice) payload.notice = notice;
    return payload;
  }

  async function createAccount(preferredId: string | null): Promise<AccountRecord> {
    let id = preferredId !== null && ACCOUNT_ID_PATTERN.test(preferredId) ? preferredId : deps.randomHex(16);
    if (await store.getAccount(id)) id = deps.randomHex(16);
    const record: AccountRecord = { id, displayName: guestNameFor(id), createdAt: deps.now() };
    await store.createAccount(record);
    return record;
  }

  async function authenticate(authorization: string | null): Promise<AccountRecord | null> {
    const token = bearerToken(authorization);
    if (token === null) return null;
    const accountId = await store.accountIdForSession(await deps.sha256Hex(token));
    return accountId === null ? null : store.getAccount(accountId);
  }

  async function issueCode(code: Omit<AuthCode, 'codeHash' | 'createdAt'>): Promise<string> {
    const raw = deps.randomHex(32);
    await store.putCode({ ...code, codeHash: await deps.sha256Hex(raw), createdAt: deps.now() });
    return raw;
  }

  async function takeLiveCode(raw: unknown, purposes: AuthCodePurpose[]): Promise<AuthCode | null> {
    if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) return null;
    const code = await store.takeCode(await deps.sha256Hex(raw));
    if (code === null || !purposes.includes(code.purpose) || code.expiresAt <= deps.now()) return null;
    return code;
  }

  function parseReturnTo(raw: unknown, apiOrigin: string): URL | null {
    if (typeof raw !== 'string') return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hash = '';
      return deps.allowReturnTo(url, apiOrigin) ? url : null;
    } catch {
      return null;
    }
  }

  async function resolveProvider(
    provider: AccountProvider,
    subject: string,
    requesterId: string | null,
  ): Promise<{ account: AccountRecord; notice: AccountNotice }> {
    const existing = await store.findLink(provider, subject);
    if (existing) {
      const account = await store.getAccount(existing.accountId);
      if (account) return { account, notice: `${provider}-signed-in` };
    }
    const requester = requesterId === null ? null : await store.getAccount(requesterId);
    const account = requester ?? await createAccount(null);
    const claimed = await store.addLink({ provider, subject, accountId: account.id, createdAt: deps.now() });
    if (claimed.accountId !== account.id) {
      const winner = await store.getAccount(claimed.accountId);
      if (!winner) throw new Error('account-unavailable');
      return { account: winner, notice: `${provider}-signed-in` };
    }
    return { account, notice: `${provider}-linked` };
  }

  async function verifySteam(url: URL): Promise<string | null> {
    const params = url.searchParams;
    if (params.get('openid.mode') !== 'id_res') return null;
    if (params.get('openid.op_endpoint') !== STEAM_OPENID_ENDPOINT) return null;
    const returnTo = params.get('openid.return_to');
    const expectedReturnTo = `${url.origin}${url.pathname}?state=${url.searchParams.get('state') ?? ''}`;
    if (returnTo !== expectedReturnTo) return null;
    const signed = (params.get('openid.signed') ?? '').split(',');
    if (['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'].some(key => !signed.includes(key))) return null;
    if (params.get('openid.identity') !== params.get('openid.claimed_id')) return null;
    const steamId = steamIdFromClaimedId(params.get('openid.claimed_id'));
    if (steamId === null) return null;
    const check = new URLSearchParams();
    params.forEach((value, key) => {
      if (key.startsWith('openid.')) check.set(key, value);
    });
    check.set('openid.mode', 'check_authentication');
    const res = await deps.fetch(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: check.toString(),
    });
    const text = await res.text();
    return /(^|\n)is_valid:true(\n|$)/.test(text) ? steamId : null;
  }

  async function handle(req: AccountRequest): Promise<AccountServiceResult> {
    const apiOrigin = req.url.origin;
    const route = `${req.method} ${req.path}`;

    if (route === 'GET /account/github/callback') {
      const code = await takeLiveCode(req.url.searchParams.get('state'), ['github-state']);
      if (code === null || code.returnTo === null) return json(400, { error: 'github-expired' });
      const back = new URL(code.returnTo);
      const failed = (notice: AccountNotice = 'github-failed'): AccountServiceResult => ({ kind: 'redirect', location: withHash(back, `${HASH_NOTICE_PREFIX}${notice}`) });
      if (!deps.github) return failed();
      if (req.url.searchParams.has('error')) return failed(req.url.searchParams.get('error') === 'access_denied' ? 'github-cancelled' : 'github-failed');
      const oauthCode = req.url.searchParams.get('code');
      if (!oauthCode || req.url.searchParams.getAll('state').length !== 1 || req.url.searchParams.getAll('code').length !== 1) return failed();
      let subject: string;
      try {
        const metadata = JSON.parse(code.subject ?? '') as { verifier?: unknown; callback?: unknown };
        const expectedCallback = `${apiOrigin}/account/github/callback`;
        if (typeof metadata.verifier !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.verifier) || metadata.callback !== expectedCallback) return failed();
        subject = await deps.github.verifyCode(oauthCode, expectedCallback, metadata.verifier);
      } catch {
        return failed();
      }
      const handoff = await issueCode({ purpose: 'github-handoff', accountId: code.accountId, subject, returnTo: null, expiresAt: deps.now() + HANDOFF_TTL_MS });
      return { kind: 'redirect', location: withHash(back, `${HASH_HANDOFF_PREFIX}${handoff}`) };
    }

    if (route === 'GET /account/steam/callback') {
      const code = await takeLiveCode(req.url.searchParams.get('state'), ['steam-state']);
      if (code === null || code.returnTo === null) {
        return json(400, { error: 'steam-expired' });
      }
      const back = new URL(code.returnTo);
      let steamId: string | null;
      try {
        steamId = await verifySteam(req.url);
      } catch {
        steamId = null;
      }
      if (steamId === null) return { kind: 'redirect', location: withHash(back, `${HASH_NOTICE_PREFIX}steam-failed`) };
      const handoff = await issueCode({
        purpose: 'steam-handoff', accountId: code.accountId, subject: steamId, returnTo: null,
        expiresAt: deps.now() + HANDOFF_TTL_MS,
      });
      return { kind: 'redirect', location: withHash(back, `${HASH_HANDOFF_PREFIX}${handoff}`) };
    }

    if (req.method !== 'GET' && req.method !== 'POST') return json(405, { error: 'method-not-allowed' });
    const body = parseBody(req.body);
    if (body === null) return json(400, { error: 'invalid-body' });

    if (route === 'POST /account/register') {
      const preferred = typeof body.localId === 'string' ? body.localId : null;
      return json(201, await issueSession(await createAccount(preferred)));
    }

    if (route === 'POST /account/redeem') {
      const code = await takeLiveCode(body.code, ['email', 'steam-handoff', 'github-handoff']);
      if (code === null) return json(400, { error: 'link-expired' });
      if (code.subject === null) return json(400, { error: 'link-expired' });
      const redeemer = await authenticate(req.authorization);
      const linkTarget = redeemer?.id === code.accountId ? redeemer.id : null;
      const provider: AccountProvider = code.purpose === 'email' ? 'email' : code.purpose === 'github-handoff' ? 'github' : 'steam';
      const { account, notice } = await resolveProvider(provider, code.subject, linkTarget);
      const oldToken = bearerToken(req.authorization);
      if (oldToken) await store.revokeSession(await deps.sha256Hex(oldToken));
      return json(200, await issueSession(account, notice));
    }

    const requester = await authenticate(req.authorization);

    if (route === 'POST /account/github/start') {
      if (requester === null) return json(401, { error: 'missing-account' });
      if (!deps.github) return json(503, { error: 'github-unavailable' });
      const returnTo = parseReturnTo(body.returnTo, apiOrigin);
      if (returnTo === null) return json(400, { error: 'invalid-return' });
      const verifier = deps.randomHex(32);
      const callback = `${apiOrigin}/account/github/callback`;
      const state = await issueCode({ purpose: 'github-state', accountId: requester.id, subject: JSON.stringify({ verifier, callback }),
        returnTo: returnTo.toString(), expiresAt: deps.now() + GITHUB_STATE_TTL_MS });
      return json(200, { url: await deps.github.authorizationUrl(state, callback, verifier) });
    }

    if (route === 'POST /account/google/start') {
      if (requester === null) return json(401, { error: 'missing-account' });
      if (!deps.google?.clientId) return json(503, { error: 'google-unavailable' });
      const challenge = await issueCode({
        purpose: 'google-nonce', accountId: requester.id, subject: null, returnTo: null,
        expiresAt: deps.now() + GOOGLE_CHALLENGE_TTL_MS,
      });
      return json(200, { challenge, nonce: challenge, clientId: deps.google.clientId });
    }

    if (route === 'POST /account/google/redeem') {
      if (requester === null) return json(401, { error: 'missing-account' });
      if (!deps.google?.clientId) return json(503, { error: 'google-unavailable' });
      const challenge = await takeLiveCode(body.challenge, ['google-nonce']);
      if (challenge === null || challenge.accountId !== requester.id) return json(400, { error: 'google-expired' });
      if (typeof body.credential !== 'string' || body.credential.length > 12000) return json(400, { error: 'google-failed' });
      let subject: string;
      try {
        subject = await deps.google.verifyCredential(body.credential, body.challenge as string);
      } catch {
        return json(400, { error: 'google-failed' });
      }
      const { account, notice } = await resolveProvider('google', subject, requester.id);
      await store.revokeSession(await deps.sha256Hex(bearerToken(req.authorization)!));
      return json(200, await issueSession(account, notice));
    }

    if (route === 'POST /account/steam/start') {
      const returnTo = parseReturnTo(body.returnTo, apiOrigin);
      if (returnTo === null) return json(400, { error: 'invalid-return' });
      const state = await issueCode({
        purpose: 'steam-state', accountId: requester?.id ?? null, subject: null, returnTo: returnTo.toString(),
        expiresAt: deps.now() + STEAM_STATE_TTL_MS,
      });
      const callback = `${apiOrigin}/account/steam/callback?state=${state}`;
      return json(200, { url: steamLoginUrl(callback, apiOrigin) });
    }

    if (route === 'POST /account/email') {
      if (deps.sendEmail === null) return json(503, { error: 'email-unavailable' });
      const email = normalizeEmail(body.email);
      if (email === null) return json(400, { error: 'invalid-email' });
      const returnTo = parseReturnTo(body.returnTo, apiOrigin);
      if (returnTo === null) return json(400, { error: 'invalid-return' });
      const latest = await store.latestCodeFor('email', email);
      if (latest && latest.createdAt + EMAIL_COOLDOWN_MS > deps.now()) return json(429, { error: 'email-cooldown' });
      const code = await issueCode({
        purpose: 'email', accountId: requester?.id ?? null, subject: email, returnTo: returnTo.toString(),
        expiresAt: deps.now() + EMAIL_CODE_TTL_MS,
      });
      const link = withHash(returnTo, `${HASH_EMAIL_PREFIX}${code}`);
      try { await deps.sendEmail({
        to: email,
        subject: 'Your Wandering Hand sign-in link',
        text: `Open this link to sign in to Wandering Hand:\n\n${link}\n\nIt works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
        html: `<p>Open this link to sign in to Wandering Hand:</p><p><a href="${escapeHtml(link)}">Sign in to Wandering Hand</a></p><p>It works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`,
      }); } catch {
        await store.takeCode(await deps.sha256Hex(code));
        return json(503, { error: 'email-send-failed' });
      }
      return json(202, { ok: true });
    }

    if (requester === null) return json(401, { error: 'missing-account' });

    if (route === 'POST /account/signout') {
      await store.revokeSession(await deps.sha256Hex(bearerToken(req.authorization)!));
      return json(200, await issueSession(await createAccount(null), 'signed-out'));
    }

    if (route === 'GET /account/me') {
      return json(200, { account: await view(requester), features });
    }

    if (route === 'POST /account/name') {
      const displayName = normalizeAccountName(body.displayName);
      if (displayName === null) return json(400, { error: 'empty-name' });
      await store.renameAccount(requester.id, displayName);
      return json(200, { account: await view({ ...requester, displayName }), features });
    }

    return json(404, { error: 'unknown-account-route' });
  }

  return { handle, authenticate };
}

export type AccountService = ReturnType<typeof createAccountService>;
