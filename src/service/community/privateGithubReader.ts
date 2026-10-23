import { COMMUNITY_REPOSITORY } from '../../community/types';
import { parseCommunityJson, requireCommunity } from '../../community/validate';
import { githubAppJwt } from './mergerGithub';

export interface PrivateGithubBinding { fetch(request: Request): Promise<Response> }
export interface PrivateGithubReaderConfig { repositoryId: string; appId: string; installationId: string; appSlug: string; privateKeyPem: string; fetch?: typeof fetch; now?: () => number }
export const PRIVATE_GITHUB_ORIGIN = 'https://community-github-reader.internal';
const prefix = `/repos/${COMMUNITY_REPOSITORY}/`;
const safeId = (value: string): boolean => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
export function validationReadPath(url: URL): boolean {
  if (url.username || url.password || url.port || url.hash || /[%\\]/.test(url.pathname) || !url.pathname.startsWith(prefix)) return false;
  const path = url.pathname.slice(prefix.length), query = url.searchParams;
  const queryKeys: string[] = []; query.forEach((_value, key) => { queryKeys.push(key); });
  const only = (values: Record<string, string>): boolean => queryKeys.length === Object.keys(values).length && Object.entries(values).every(([key, value]) => query.getAll(key).length === 1 && query.get(key) === value);
  if (/^(?:actions\/workflows|actions\/runs|pulls)\/\d+$/.test(path)) return safeId(path.split('/').at(-1)!) && !url.search;
  const runs = /^actions\/workflows\/(\d+)\/runs$/.exec(path);
  if (runs) return safeId(runs[1]!) && only({ event: 'pull_request_target', status: 'success', per_page: '100' });
  const artifacts = /^actions\/runs\/(\d+)\/artifacts$/.exec(path);
  if (artifacts) return safeId(artifacts[1]!) && only({ per_page: '100' });
  const zip = /^actions\/artifacts\/(\d+)\/zip$/.exec(path);
  if (zip) return safeId(zip[1]!) && !url.search;
  if (/^compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}$/.test(path)) return !url.search;
  return path === 'contents/.github/workflows/validate-content.yml' && queryKeys.length === 1 && query.getAll('ref').length === 1 && /^[a-f0-9]{40}$/.test(query.get('ref') ?? '');
}
async function bounded(response: Response, maximum: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  requireCommunity(response.ok && response.body && (!length || /^\d+$/.test(length) && Number(length) <= maximum), 'private-reader-upstream-unavailable', 503);
  const reader = response.body!.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; requireCommunity(size <= maximum, 'private-reader-response-too-large', 503); chunks.push(item.value); } } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export function privateGithubTransport(binding: PrivateGithubBinding): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, { ...init, redirect: 'manual' }), url = new URL(request.url);
    requireCommunity(request.method === 'GET' && url.origin === 'https://api.github.com' && validationReadPath(url), 'private-reader-request-denied', 403);
    return binding.fetch(new Request(`${PRIVATE_GITHUB_ORIGIN}${url.pathname}${url.search}`, { method: 'GET', redirect: 'manual', signal: request.signal }));
  };
}
export function createPrivateGithubReader(config: PrivateGithubReaderConfig): (request: Request) => Promise<Response> {
  const transport = config.fetch ?? fetch, now = config.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null, pending: Promise<string> | null = null;
  const api = async (path: string, authorization?: string, body?: unknown): Promise<any> => {
    const bytes = await bounded(await transport(`https://api.github.com/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'Wandering-Hand-Community-Reader', 'x-github-api-version': '2022-11-28', ...(authorization ? { authorization } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: AbortSignal.timeout(15_000) }), 2_000_000);
    return parseCommunityJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  const acquire = async (): Promise<string> => {
    requireCommunity(config.repositoryId === '1426486653' && /^\d+$/.test(config.appId) && /^\d+$/.test(config.installationId) && /^[a-z0-9-]+$/.test(config.appSlug) && config.privateKeyPem, 'private-reader-unconfigured', 503);
    const repository = await api(`repos/${COMMUNITY_REPOSITORY}`);
    requireCommunity(String(repository.id) === config.repositoryId && repository.full_name?.toLowerCase() === COMMUNITY_REPOSITORY.toLowerCase() && repository.default_branch === 'main', 'private-reader-repository-mismatch', 503);
    const jwt = `Bearer ${await githubAppJwt(config.appId, config.privateKeyPem, now())}`;
    const installation = await api(`repos/${COMMUNITY_REPOSITORY}/installation`, jwt);
    requireCommunity(String(installation.id) === config.installationId && String(installation.app_id) === config.appId && installation.app_slug === config.appSlug && installation.account?.login?.toLowerCase() === 'wwang109' && installation.repository_selection === 'selected' && !installation.suspended_at, 'private-reader-installation-mismatch', 503);
    const result = await api(`app/installations/${config.installationId}/access_tokens`, jwt, { repository_ids: [Number(config.repositoryId)], permissions: { contents: 'read', pull_requests: 'read', actions: 'read' } });
    const expiresAt = Date.parse(result.expires_at);
    requireCommunity(typeof result.token === 'string' && result.token.length >= 20 && Number.isFinite(expiresAt) && expiresAt > now() + 60_000 && expiresAt <= now() + 65 * 60_000 && result.permissions && Object.entries(result.permissions).every(([name, permission]) => ['contents', 'pull_requests', 'actions', 'metadata'].includes(name) && permission === 'read') && ['contents', 'pull_requests', 'actions'].every(name => result.permissions[name] === 'read'), 'private-reader-token-scope-mismatch', 503);
    const scoped = await api('installation/repositories?per_page=100', `Bearer ${result.token}`);
    requireCommunity(scoped.total_count === 1 && String(scoped.repositories?.[0]?.id) === config.repositoryId && scoped.repositories[0].full_name?.toLowerCase() === COMMUNITY_REPOSITORY.toLowerCase(), 'private-reader-token-repository-mismatch', 503);
    cached = { token: result.token, expiresAt: Math.min(expiresAt - 60_000, now() + 10 * 60_000) }; return result.token;
  };
  const token = async (): Promise<string> => {
    if (cached && cached.expiresAt > now()) return cached.token;
    if (!pending) pending = acquire().finally(() => { pending = null; });
    return pending;
  };
  return async request => {
    if (request.method !== 'GET') return new Response('private-reader-method-denied', { status: 405 });
    const url = new URL(request.url);
    if (url.origin !== PRIVATE_GITHUB_ORIGIN || !validationReadPath(url)) return new Response('private-reader-path-denied', { status: 403 });
    try {
      const credential = await token();
      const artifact = /\/actions\/artifacts\/\d+\/zip$/.test(url.pathname);
      let response = await transport(`https://api.github.com${url.pathname}${url.search}`, { method: 'GET', headers: { authorization: `Bearer ${credential}`, accept: 'application/vnd.github+json', 'user-agent': 'Wandering-Hand-Community-Reader', 'x-github-api-version': '2022-11-28' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      if (response.status === 401 || response.status === 403) cached = null;
      if (artifact && response.status === 302) {
        const target = new URL(response.headers.get('location') ?? '');
        requireCommunity(target.protocol === 'https:' && !target.username && !target.password && !target.port && (target.hostname.endsWith('.blob.core.windows.net') || target.hostname.endsWith('.actions.githubusercontent.com')), 'private-reader-artifact-host-denied', 503);
        response = await transport(target.toString(), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      }
      const bytes = await bounded(response, artifact ? 1_048_576 : 2_000_000);
      const text = new TextDecoder().decode(bytes);
      requireCommunity(!text.includes(credential) && !text.includes(config.privateKeyPem), 'private-reader-sensitive-response', 503);
      const body = new ArrayBuffer(bytes.length); new Uint8Array(body).set(bytes);
      return new Response(body, { headers: { 'content-type': artifact ? 'application/zip' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    } catch { return new Response('private-github-read-unavailable', { status: 503, headers: { 'cache-control': 'no-store' } }); }
  };
}
