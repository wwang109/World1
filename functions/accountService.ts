import { createAccountService, webCryptoRandomHex, webCryptoSha256Hex, type AccountService } from '../src/meta/account';
import { createD1AccountStore } from './accountStoreD1';
import type { D1Database } from './d1';
import { createGoogleIdentityVerifier } from '../src/meta/googleIdentity';
import { accountEmailSender, type AccountEmailEnv } from './accountEmail';
import { githubOAuthFor, type GitHubOAuthEnv } from '../src/meta/githubIdentity';

export interface AccountEnv extends AccountEmailEnv, GitHubOAuthEnv {
  GHOSTS_DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
}

export const ACCOUNT_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export function accountServiceFor(env: AccountEnv): AccountService | null {
  if (!env.GHOSTS_DB) return null;
  return createAccountService({
    store: createD1AccountStore(env.GHOSTS_DB),
    now: () => Date.now(),
    randomHex: webCryptoRandomHex,
    sha256Hex: webCryptoSha256Hex,
    fetch: (url, init) => fetch(url, init),
    sendEmail: accountEmailSender(env),
    google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID, verifyCredential: createGoogleIdentityVerifier(env.GOOGLE_CLIENT_ID) } : null,
    github: githubOAuthFor(env),
    allowReturnTo: (returnTo, apiOrigin) => returnTo.origin === apiOrigin,
  });
}
