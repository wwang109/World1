import { GHOST_NAME_MAX } from '../run/ghost';
import { normalizeGhostName } from '../run/ghostValidate';

export type AccountProvider = 'steam' | 'email';
export type AuthCodePurpose = 'steam-state' | 'email' | 'handoff';

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
  linksFor(accountId: string): Promise<AccountLink[]>;
  findLink(provider: AccountProvider, subject: string): Promise<AccountLink | null>;
  addLink(link: AccountLink): Promise<void>;
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
}

export interface AccountSessionPayload {
  token: string;
  account: AccountView;
  features: AccountFeatures;
  notice?: AccountNotice;
}

export type AccountNotice =
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
export const EMAIL_MAX_LENGTH = 254;
export const ACCOUNT_BODY_MAX_BYTES = 2048;
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

export function createAccountService(deps: AccountServiceDeps) {
  const { store } = deps;
  const features: AccountFeatures = { email: deps.sendEmail !== null };

  async function view(account: AccountRecord): Promise<AccountView> {
    const links = await store.linksFor(account.id);
    return {
      id: account.id,
      displayName: account.displayName,
      links: links.map((link) => ({
        provider: link.provider,
        label: link.provider === 'email' ? maskEmail(link.subject) : 'Steam',
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
    if (code === null || !purposes.includes(code.purpose) || code.expiresAt < deps.now()) return null;
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
      if (account) return { account, notice: provider === 'steam' ? 'steam-signed-in' : 'email-signed-in' };
    }
    const requester = requesterId === null ? null : await store.getAccount(requesterId);
    const account = requester ?? await createAccount(null);
    await store.addLink({ provider, subject, accountId: account.id, createdAt: deps.now() });
    return { account, notice: provider === 'steam' ? 'steam-linked' : 'email-linked' };
  }

  async function verifySteam(url: URL): Promise<string | null> {
    const params = url.searchParams;
    if (params.get('openid.mode') !== 'id_res') return null;
    if (params.get('openid.op_endpoint') !== STEAM_OPENID_ENDPOINT) return null;
    const returnTo = params.get('openid.return_to');
    if (returnTo === null || new URL(returnTo).origin + new URL(returnTo).pathname !== url.origin + url.pathname) return null;
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
      const { account, notice } = await resolveProvider('steam', steamId, code.accountId);
      const handoff = await issueCode({
        purpose: 'handoff', accountId: account.id, subject: notice, returnTo: null,
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
      const code = await takeLiveCode(body.code, ['email', 'handoff']);
      if (code === null) return json(400, { error: 'link-expired' });
      if (code.purpose === 'handoff') {
        const account = code.accountId === null ? null : await store.getAccount(code.accountId);
        if (account === null) return json(400, { error: 'link-expired' });
        return json(200, await issueSession(account, (code.subject ?? undefined) as AccountNotice | undefined));
      }
      if (code.subject === null) return json(400, { error: 'link-expired' });
      const { account, notice } = await resolveProvider('email', code.subject, code.accountId);
      return json(200, await issueSession(account, notice));
    }

    const requester = await authenticate(req.authorization);

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
      await deps.sendEmail({
        to: email,
        subject: 'Your World1 sign-in link',
        text: `Open this link to sign in to World1:\n\n${link}\n\nIt works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
        html: `<p>Open this link to sign in to World1:</p><p><a href="${link}">Sign in to World1</a></p><p>It works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`,
      });
      return json(202, { ok: true });
    }

    if (requester === null) return json(401, { error: 'missing-account' });

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
