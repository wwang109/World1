import { createAccountService, webCryptoRandomHex, webCryptoSha256Hex, type AccountService, type EmailMessage } from '../src/meta/account';
import { createD1AccountStore } from './accountStoreD1';
import type { D1Database } from './d1';

interface SendEmailBinding {
  send(message: EmailMessage & { from: string }): Promise<unknown>;
}

export interface AccountEnv {
  GHOSTS_DB?: D1Database;
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
}

export const ACCOUNT_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export function accountServiceFor(env: AccountEnv): AccountService | null {
  if (!env.GHOSTS_DB) return null;
  const binding = env.EMAIL;
  const from = env.EMAIL_FROM;
  return createAccountService({
    store: createD1AccountStore(env.GHOSTS_DB),
    now: () => Date.now(),
    randomHex: webCryptoRandomHex,
    sha256Hex: webCryptoSha256Hex,
    fetch: (url, init) => fetch(url, init),
    sendEmail: binding && from ? async (message) => { await binding.send({ ...message, from }); } : null,
    allowReturnTo: (returnTo, apiOrigin) => returnTo.origin === apiOrigin,
  });
}
