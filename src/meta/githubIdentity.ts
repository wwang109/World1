export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';

export interface GitHubOAuth {
  authorizationUrl(state: string, callback: string, verifier: string): Promise<string>;
  verifyCode(code: string, callback: string, verifier: string): Promise<string>;
}

export interface GitHubOAuthEnv {
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error('github-failed');
  const raw = await response.text();
  if (raw.length > 100_000) throw new Error('github-failed');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('github-failed');
  return value as Record<string, unknown>;
}

export function githubOAuthFor(env: GitHubOAuthEnv, fetcher: typeof fetch = fetch): GitHubOAuth | null {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    async authorizationUrl(state, callback, verifier) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const challenge = btoa(String.fromCharCode(...digest)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, state,
        scope: '', code_challenge: challenge, code_challenge_method: 'S256' });
      return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
    },
    async verifyCode(code, callback, verifier) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        if (!/^[A-Za-z0-9_-]{1,1024}$/.test(code) || !/^[0-9a-f]{64}$/.test(verifier)) throw new Error('github-failed');
        const token = await responseObject(await fetcher(GITHUB_TOKEN_URL, {
          method: 'POST', signal: controller.signal, redirect: 'error',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callback, code_verifier: verifier }).toString(),
        }));
        if (token.error !== undefined || token.token_type !== 'bearer' || typeof token.access_token !== 'string'
          || !/^[A-Za-z0-9._~-]{1,4096}$/.test(token.access_token) || (token.scope !== undefined && token.scope !== '')) throw new Error('github-failed');
        const profile = await responseObject(await fetcher(GITHUB_USER_URL, {
          method: 'GET', signal: controller.signal, redirect: 'error',
          headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}`, 'user-agent': 'Wandering-Hand-Account', 'x-github-api-version': '2022-11-28' },
        }));
        if (typeof profile.id !== 'number' || !Number.isSafeInteger(profile.id) || profile.id <= 0) throw new Error('github-failed');
        return String(profile.id);
      } catch {
        throw new Error('github-failed');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
