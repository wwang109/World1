import {
  HASH_EMAIL_PREFIX,
  HASH_HANDOFF_PREFIX,
  HASH_NOTICE_PREFIX,
  type AccountFeatures,
  type AccountSessionPayload,
  type AccountView,
} from '../meta/account';
import type { StorageDriver } from '../meta/lifetimeStats';
import { getOrCreateLocalId } from '../meta/localId';
import { battleApiBaseUrl } from './battleApi';
import { closeGoogleSignIn, disableGoogleAutoSelect, promptForGoogleSignIn } from './ui/googleSignIn';

const BASE_URL = battleApiBaseUrl(
  import.meta.env?.VITE_BATTLE_API as string | undefined,
  Boolean(import.meta.env?.DEV),
  typeof window === 'undefined' ? undefined : window.location.hostname,
);

export const ACCOUNT_TOKEN_STORAGE_KEY = 'world1:accountToken:v1';

export type AccountStatus = 'loading' | 'ready' | 'offline';

export interface AccountState {
  status: AccountStatus;
  account: AccountView | null;
  features: AccountFeatures;
  notice: string | null;
  pending: 'name' | 'email' | 'steam' | 'google' | 'github' | 'signout' | 'recovery' | null;
}

const NOTICE_TEXT: Record<string, string> = {
  'github-linked': 'GitHub linked to this account.',
  'github-signed-in': 'Signed in with GitHub.',
  'github-unavailable': 'GitHub sign-in is not available yet.',
  'github-expired': 'GitHub sign-in expired. Please try again.',
  'github-failed': "GitHub sign-in didn't go through. Please try again.",
  'github-cancelled': 'GitHub sign-in cancelled. You can keep playing.',
  'google-linked': 'Google linked to this account.',
  'google-signed-in': 'Signed in with Google.',
  'google-unavailable': 'Google sign-in is not available yet.',
  'google-expired': 'Google sign-in expired. Please try again.',
  'google-failed': "Google sign-in didn't go through. Please try again.",
  'google-load-failed': "Couldn't load Google sign-in. Check your connection and try again.",
  'signed-out': 'Signed out. You are playing as a new guest.',
  'steam-linked': 'Steam linked to this account.',
  'steam-signed-in': 'Signed in with Steam.',
  'email-linked': 'Email linked to this account.',
  'email-signed-in': 'Signed in with email.',
  'steam-failed': "Steam sign-in didn't go through.",
  'steam-expired': 'That sign-in link has expired.',
  'link-expired': 'That sign-in link has expired.',
  'email-sent': 'Check your email for a sign-in link.',
  'email-cooldown': 'Wait a minute before asking for another link.',
  'invalid-email': 'Enter a valid email address.',
  'email-unavailable': 'Email sign-in is not available yet.',
  'email-send-failed': "Couldn't send the link. Please try again later.",
  'empty-name': 'Name cannot be empty.',
  offline: "Can't reach the account server.",
};

function noticeText(code: string | undefined | null): string | null {
  if (!code) return null;
  return NOTICE_TEXT[code] ?? 'Something went wrong. Try again.';
}

const storage: StorageDriver = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};

let state: AccountState = { status: 'loading', account: null, features: { email: false, google: false, github: false }, notice: null, pending: null };
let token: string | null = storage.get(ACCOUNT_TOKEN_STORAGE_KEY);
let initPromise: Promise<void> | null = null;
let generation = 0;
const listeners = new Set<(next: AccountState) => void>();

function update(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

function adopt(payload: AccountSessionPayload, pending: AccountState['pending'] = null): void {
  token = payload.token;
  storage.set(ACCOUNT_TOKEN_STORAGE_KEY, payload.token);
  update({ status: 'ready', account: payload.account, features: payload.features, notice: noticeText(payload.notice), pending });
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T & { error?: string } }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  return { status: res.status, data };
}

function returnToUrl(): string {
  const url = new URL(window.location.href);
  url.hash = '';
  return url.toString();
}

function takeHashAction(): { code: string | null; notice: string | null } {
  if (typeof window === 'undefined') return { code: null, notice: null };
  const hash = window.location.hash.replace(/^#/, '');
  let code: string | null = null;
  let notice: string | null = null;
  if (hash.startsWith(HASH_HANDOFF_PREFIX)) code = hash.slice(HASH_HANDOFF_PREFIX.length);
  else if (hash.startsWith(HASH_EMAIL_PREFIX)) code = hash.slice(HASH_EMAIL_PREFIX.length);
  else if (hash.startsWith(HASH_NOTICE_PREFIX)) notice = hash.slice(HASH_NOTICE_PREFIX.length);
  else return { code: null, notice: null };
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return { code, notice };
}

async function register(expected: number, pending: AccountState['pending'] = null): Promise<void> {
  const { status, data } = await call<AccountSessionPayload>('POST', '/account/register', {
    localId: getOrCreateLocalId(storage),
  });
  if (generation !== expected) return;
  if (status === 201) adopt(data, pending);
  else update({ status: 'offline' });
}

async function bootstrap(expected: number): Promise<void> {
  const { code, notice } = takeHashAction();
  if (code) update({ pending: 'recovery' });
  if (notice) update({ notice: noticeText(notice) });
  try {
    if (token) {
      const { status, data } = await call<{ account: AccountView; features: AccountFeatures }>('GET', '/account/me');
      if (generation !== expected) return;
      if (status === 200) {
        update({ status: 'ready', account: data.account, features: data.features });
      } else if (status !== 401) {
        update({ status: 'offline' });
        return;
      } else {
        await register(expected, code ? 'recovery' : null);
      }
    } else await register(expected, code ? 'recovery' : null);
    if (generation !== expected || state.status !== 'ready') return;
    if (code) {
      const { status, data } = await call<AccountSessionPayload>('POST', '/account/redeem', { code });
      if (generation !== expected) return;
      if (status === 200) adopt(data);
      else update({ notice: noticeText(data.error ?? 'link-expired'), pending: null });
    } else if (notice) update({ notice: noticeText(notice) });
  } catch {
    if (generation === expected) update({ status: 'offline', pending: null });
  } finally {
    if (generation === expected && state.pending === 'recovery') update({ pending: null });
  }
}

export function initAccount(): Promise<void> {
  if (!initPromise) {
    const expected = generation;
    initPromise = bootstrap(expected).finally(() => {
      if (generation === expected && state.status === 'offline') initPromise = null;
    });
  }
  return initPromise;
}

export function getAccountState(): AccountState {
  return state;
}

export function onAccountChange(listener: (next: AccountState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearAccountNotice(): void {
  if (state.notice !== null) update({ notice: null });
}

export function accountOwnerId(): string {
  return state.account?.id ?? getOrCreateLocalId(storage);
}

export function accountToken(): string | null {
  return token;
}

export function accountDisplayName(): string | null {
  return state.account?.displayName ?? null;
}

export async function renameAccount(displayName: string): Promise<void> {
  const expected = begin('name');
  if (expected === null) return;
  try {
    const { status, data } = await call<{ account: AccountView; features: AccountFeatures }>('POST', '/account/name', { displayName });
    if (generation !== expected) return;
    if (status === 200) update({ account: data.account, features: data.features, notice: null });
    else update({ notice: noticeText(data.error) });
  } catch {
    if (generation === expected) update({ notice: noticeText('offline') });
  } finally {
    finish(expected);
  }
}

export async function startSteamSignIn(): Promise<void> {
  const expected = begin('steam');
  if (expected === null) return;
  try {
    const { status, data } = await call<{ url: string }>('POST', '/account/steam/start', { returnTo: returnToUrl() });
    if (generation !== expected) return;
    if (status === 200 && data.url) {
      window.location.assign(data.url);
      return;
    }
    update({ notice: noticeText(data.error) });
  } catch {
    if (generation === expected) update({ notice: noticeText('offline') });
  } finally {
    finish(expected);
  }
}

export async function startGitHubSignIn(): Promise<void> {
  if (!state.features.github) { update({ notice: noticeText('github-unavailable') }); return; }
  const expected = begin('github');
  if (expected === null) return;
  try {
    const { status, data } = await call<{ url: string }>('POST', '/account/github/start', { returnTo: returnToUrl() });
    if (generation !== expected) return;
    if (status === 200 && data.url) {
      window.location.assign(data.url);
      return;
    }
    update({ notice: noticeText(data.error) });
  } catch {
    if (generation === expected) update({ notice: noticeText('offline') });
  } finally {
    finish(expected);
  }
}

export async function sendEmailSignIn(email: string): Promise<void> {
  const expected = begin('email');
  if (expected === null) return;
  try {
    const { status, data } = await call<{ ok: boolean }>('POST', '/account/email', { email, returnTo: returnToUrl() });
    if (generation !== expected) return;
    update({ notice: noticeText(status === 202 ? 'email-sent' : data.error) });
  } catch {
    if (generation === expected) update({ notice: noticeText('offline') });
  } finally {
    finish(expected);
  }
}

function begin(pending: AccountState['pending']): number | null {
  if (state.status !== 'ready' || state.pending || !state.account) return null;
  const expected = ++generation;
  update({ pending, notice: null });
  return expected;
}

function finish(expected: number): void {
  if (generation === expected) update({ pending: null });
}

export async function startGoogleSignIn(): Promise<void> {
  if (!state.features.google) { update({ notice: noticeText('google-unavailable') }); return; }
  const expected = begin('google');
  if (expected === null) return;
  try {
    await promptForGoogleSignIn({
      load: async () => {
        const { status, data } = await call<{ challenge: string; nonce: string; clientId: string }>('POST', '/account/google/start');
        if (status !== 200) throw new Error(noticeText(data.error) ?? 'Google sign-in is unavailable.');
        return data;
      },
      current: () => generation === expected,
      redeem: async (challenge, credential) => {
        const { status, data } = await call<AccountSessionPayload>('POST', '/account/google/redeem', { challenge, credential });
        if (generation !== expected) return null;
        if (status !== 200) return noticeText(data.error) ?? 'Google sign-in failed. Please try again.';
        adopt(data, 'google');
        return null;
      },
    });
  } catch {
    if (generation === expected) update({ notice: noticeText('google-load-failed') });
  } finally {
    finish(expected);
    if (generation === expected) generation++;
  }
}

export async function signOutAccount(): Promise<void> {
  if (state.pending || !state.account?.links.length) return;
  const expected = ++generation;
  closeGoogleSignIn();
  disableGoogleAutoSelect();
  update({ pending: 'signout', notice: null });
  try {
    const { status, data } = await call<AccountSessionPayload>('POST', '/account/signout');
    if (generation !== expected) return;
    if (status === 200) adopt(data);
    else update({ notice: noticeText(data.error) });
  } catch {
    if (generation === expected) update({ notice: noticeText('offline') });
  } finally {
    finish(expected);
  }
}
