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
}

const NOTICE_TEXT: Record<string, string> = {
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

let state: AccountState = { status: 'loading', account: null, features: { email: false }, notice: null };
let token: string | null = storage.get(ACCOUNT_TOKEN_STORAGE_KEY);
let initPromise: Promise<void> | null = null;
const listeners = new Set<(next: AccountState) => void>();

function update(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

function adopt(payload: AccountSessionPayload): void {
  token = payload.token;
  storage.set(ACCOUNT_TOKEN_STORAGE_KEY, payload.token);
  update({ status: 'ready', account: payload.account, features: payload.features, notice: noticeText(payload.notice) ?? state.notice });
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T & { error?: string } }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
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

async function register(): Promise<void> {
  const { status, data } = await call<AccountSessionPayload>('POST', '/account/register', {
    localId: getOrCreateLocalId(storage),
  });
  if (status === 201) adopt(data);
  else update({ status: 'offline' });
}

async function bootstrap(): Promise<void> {
  const { code, notice } = takeHashAction();
  if (notice) update({ notice: noticeText(notice) });
  try {
    if (code) {
      const { status, data } = await call<AccountSessionPayload>('POST', '/account/redeem', { code });
      if (status === 200) {
        adopt(data);
        return;
      }
      update({ notice: noticeText(data.error ?? 'link-expired') });
    }
    if (token) {
      const { status, data } = await call<{ account: AccountView; features: AccountFeatures }>('GET', '/account/me');
      if (status === 200) {
        update({ status: 'ready', account: data.account, features: data.features });
        return;
      }
      if (status !== 401) {
        update({ status: 'offline' });
        return;
      }
    }
    await register();
  } catch {
    update({ status: 'offline' });
  }
}

export function initAccount(): Promise<void> {
  if (!initPromise) {
    initPromise = bootstrap().finally(() => {
      if (state.status === 'offline') initPromise = null;
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
  try {
    const { status, data } = await call<{ account: AccountView; features: AccountFeatures }>('POST', '/account/name', { displayName });
    if (status === 200) update({ account: data.account, features: data.features, notice: null });
    else update({ notice: noticeText(data.error) });
  } catch {
    update({ notice: noticeText('offline') });
  }
}

export async function startSteamSignIn(): Promise<void> {
  try {
    const { status, data } = await call<{ url: string }>('POST', '/account/steam/start', { returnTo: returnToUrl() });
    if (status === 200 && data.url) {
      window.location.assign(data.url);
      return;
    }
    update({ notice: noticeText(data.error) });
  } catch {
    update({ notice: noticeText('offline') });
  }
}

export async function sendEmailSignIn(email: string): Promise<void> {
  try {
    const { status, data } = await call<{ ok: boolean }>('POST', '/account/email', { email, returnTo: returnToUrl() });
    update({ notice: noticeText(status === 202 ? 'email-sent' : data.error) });
  } catch {
    update({ notice: noticeText('offline') });
  }
}
