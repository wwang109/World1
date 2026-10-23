export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const KEY_REFRESH_COOLDOWN_MS = 30_000;
const MAX_KEY_CACHE_MS = 60 * 60 * 1000;

export interface GoogleVerifierOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

interface GoogleSigningKey extends JsonWebKey { kid: string }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-google-token');
  return value as Record<string, unknown>;
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('invalid-google-token');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  if (btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') !== value) throw new Error('invalid-google-token');
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function decodeObject(value: string): Record<string, unknown> {
  return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(value))));
}

function createKeyLoader(fetcher: typeof fetch, now: () => number) {
  let keys: GoogleSigningKey[] = [];
  let expiresAt = 0;
  let lastAttempt = -Infinity;
  let pending: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    lastAttempt = now();
    try {
      const response = await fetcher(GOOGLE_JWKS_URL, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('google-keys-unavailable');
      const raw = await response.text();
      if (raw.length > 100_000) throw new Error('google-keys-unavailable');
      const document = object(JSON.parse(raw));
      if (!Array.isArray(document.keys) || document.keys.length > 100) throw new Error('google-keys-unavailable');
      const next: GoogleSigningKey[] = [];
      for (const entry of document.keys) {
        const key = object(entry);
        if (key.kty !== 'RSA' || typeof key.kid !== 'string' || !key.kid || typeof key.n !== 'string' || typeof key.e !== 'string'
          || (key.alg !== undefined && key.alg !== 'RS256') || (key.use !== undefined && key.use !== 'sig')
          || (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')))) continue;
        if (next.some(entry => entry.kid === key.kid)) throw new Error('google-keys-unavailable');
        next.push({ kty: 'RSA', kid: key.kid, n: key.n, e: key.e, alg: 'RS256', use: 'sig' });
      }
      if (next.length === 0) throw new Error('google-keys-unavailable');
      const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
      const cacheMs = maxAge ? Math.min(Number(maxAge[1]) * 1000, MAX_KEY_CACHE_MS) : 300_000;
      keys = next;
      expiresAt = now() + cacheMs;
    } finally {
      clearTimeout(timeout);
    }
  }

  return async (kid: string): Promise<GoogleSigningKey> => {
    const cached = keys.find(key => key.kid === kid);
    if (cached && expiresAt > now()) return cached;
    if (pending) await pending;
    else if (now() - lastAttempt >= KEY_REFRESH_COOLDOWN_MS) {
      pending = refresh();
      try { await pending; } finally { pending = null; }
    }
    const matching = keys.filter(key => key.kid === kid);
    if (matching.length !== 1 || expiresAt <= now()) throw new Error('google-keys-unavailable');
    return matching[0]!;
  };
}

const defaultKeyLoader = createKeyLoader((...args) => fetch(...args), Date.now);

export function createGoogleIdentityVerifier(clientId: string, options: GoogleVerifierOptions = {}): (credential: string, nonce: string) => Promise<string> {
  const now = options.now ?? Date.now;
  const loadKey = options.fetch || options.now ? createKeyLoader(options.fetch ?? fetch, now) : defaultKeyLoader;
  return async (credential, nonce) => {
    if (credential.length > 12000 || !clientId || !nonce) throw new Error('invalid-google-token');
    const parts = credential.split('.');
    if (parts.length !== 3) throw new Error('invalid-google-token');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = decodeObject(encodedHeader);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 256
      || header.crit !== undefined || header.b64 !== undefined) throw new Error('invalid-google-token');
    const jwk = await loadKey(header.kid);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
    if (!valid) throw new Error('invalid-google-token');
    const payload = decodeObject(encodedPayload);
    const seconds = now() / 1000;
    const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
    if ((payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com')
      || !Array.isArray(audiences) || audiences.length === 0 || audiences.some(value => typeof value !== 'string' || !value)
      || !audiences.includes(clientId) || (audiences.length > 1 && payload.azp !== clientId)
      || (payload.azp !== undefined && payload.azp !== clientId)
      || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= seconds
      || (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isSafeInteger(payload.nbf) || payload.nbf > seconds))
      || (payload.iat !== undefined && (typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) || payload.iat > seconds))
      || typeof payload.sub !== 'string' || payload.sub.trim().length === 0 || payload.sub.length > 255
      || payload.nonce !== nonce) throw new Error('invalid-google-token');
    return payload.sub;
  };
}
