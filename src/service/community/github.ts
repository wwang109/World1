import { COMMUNITY_REPOSITORY, type ProposalKey } from '../../community/types';
import { requireCommunity, safeRepositoryPath, validateSha } from '../../community/validate';
export interface GitHubPr { key: ProposalKey; headSha: string; baseSha: string; state: 'open' | 'closed'; mergedCommitSha: string | null; url: string; manifestPath: string }
export interface RepositoryFile { path: string; bytes: Uint8Array; blobSha: string; mode: string }
export interface PrPage { keys: ProposalKey[]; nextCursor: string | null; versions?: { key: ProposalKey; headSha: string; baseSha: string; state: 'open' | 'closed' }[] }
export interface GitHubReadPort {
  readPr(key: ProposalKey): Promise<GitHubPr>;
  readFilesAtSha(key: ProposalKey, sha: string, paths: readonly string[]): Promise<readonly RepositoryFile[]>;
  listChangedPrs(cursor: string | null, pageSize?: number): Promise<PrPage>;
}
export interface GitHubReadConfig { repositoryId: string; token?: string; fetch?: typeof fetch; lookupCachedProposal?: (key: ProposalKey) => Promise<{ headSha: string; manifestPath: string } | null> }
async function boundedJson(response: Response, max = 2_000_000): Promise<unknown> {
  requireCommunity(response.ok, response.status === 404 ? 'github-source-unavailable' : 'github-read-unavailable', 503);
  requireCommunity(Number(response.headers.get('content-length') ?? 0) <= max, 'github-response-too-large', 503);
  const reader = response.body?.getReader();
  requireCommunity(reader, 'github-empty-response', 503);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > max) { await reader.cancel(); requireCommunity(false, 'github-response-too-large', 503); } chunks.push(item.value); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
}
export function createGitHubReadPort(config: GitHubReadConfig): GitHubReadPort {
  const transport = config.fetch ?? fetch;
  requireCommunity(/^\d+$/.test(config.repositoryId), 'github-repository-id-unconfigured', 503);
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Wandering-Hand-Community-Reader' };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const getAt = async (repository: string, path: string, max?: number): Promise<any> => boundedJson(await transport(`https://api.github.com/repos/${repository}/${path}`, { headers, redirect: 'error' }), max);
  const get = async (path: string, max?: number): Promise<any> => getAt(COMMUNITY_REPOSITORY, path, max);
  const verifiedHeadRepositories = new Map<string, string>();
  const validatedManifestPaths = new Map<string, string>();
  const checkKey = (key: ProposalKey): void => { requireCommunity(key.repositoryId === config.repositoryId && Number.isSafeInteger(key.number) && key.number > 0, 'repository-mismatch'); };
  return {
    async readPr(key) {
      checkKey(key);
      const pr = await get(`pulls/${key.number}`);
      requireCommunity(String(pr.base?.repo?.id) === config.repositoryId && pr.base?.repo?.full_name?.toLowerCase() === COMMUNITY_REPOSITORY, 'repository-mismatch');
      requireCommunity(pr.base?.ref === 'main' && !pr.draft, 'proposal-not-ready-for-import');
      const cached = await config.lookupCachedProposal?.(key);
      const headRepositoryAvailable = typeof pr.head?.repo?.full_name === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pr.head.repo.full_name) && Number.isSafeInteger(pr.head.repo.id);
      requireCommunity(headRepositoryAvailable || (pr.state === 'closed' && cached && cached.headSha === pr.head?.sha), 'head-repository-unavailable', pr.state === 'closed' ? 400 : 503);
      if (headRepositoryAvailable) verifiedHeadRepositories.set(validateSha(pr.head.sha), pr.head.repo.full_name);
      const cachedManifest = validatedManifestPaths.get(pr.head.sha) ?? (cached && cached.headSha === pr.head.sha ? cached.manifestPath : undefined);
      const paths: string[] = [];
      requireCommunity(Number.isSafeInteger(pr.changed_files) && pr.changed_files <= 300, 'too-many-pr-files');
      for (let page = 1; !cachedManifest && page <= Math.ceil(pr.changed_files / 100); page++) {
        const files = await get(`pulls/${key.number}/files?per_page=100&page=${page}`);
        requireCommunity(Array.isArray(files), 'invalid-github-files', 503);
        for (const file of files) {
          const changedPath = safeRepositoryPath(file.filename);
          requireCommunity(changedPath === 'content-manifest.v1.json' || changedPath === 'art-manifest.v1.json' || /^src\/data\/content\/.+\.json$/.test(changedPath) || /^public\/game-art\/.+\.(?:webp|png)$/.test(changedPath) || /^art-src\/.+\.png$/.test(changedPath) || /^community\/proposals\/[A-Za-z0-9_-]+\/.+\.(?:json|png|webp|md)$/.test(changedPath), 'proposal-changes-trusted-code');
          if (/^community\/proposals\/[A-Za-z0-9_-]+\/proposal\.json$/.test(changedPath) && file.status !== 'removed') paths.push(changedPath);
        }
      }
      if (cachedManifest) paths.push(cachedManifest);
      requireCommunity(paths.length === 1, 'expected-one-proposal-manifest');
      validatedManifestPaths.set(pr.head.sha, paths[0]!);
      return { key, headSha: validateSha(pr.head?.sha), baseSha: validateSha(pr.base?.sha), state: pr.state === 'open' ? 'open' : 'closed', mergedCommitSha: pr.merged_at ? validateSha(pr.merge_commit_sha) : null, url: `https://github.com/${COMMUNITY_REPOSITORY}/pull/${key.number}`, manifestPath: paths[0]! };
    },
    async readFilesAtSha(key, sha, paths) {
      checkKey(key); validateSha(sha);
      requireCommunity(paths.length <= 37, 'too-many-source-files');
      if (paths.length === 0) return [];
      if (!verifiedHeadRepositories.has(sha)) { const current = await this.readPr(key); requireCommunity(current.headSha === sha, 'immutable-head-source-unavailable', 503); }
      const sourceRepository = verifiedHeadRepositories.get(sha)!;
      const tree = await getAt(sourceRepository, `git/trees/${sha}?recursive=1`);
      requireCommunity(!tree.truncated && Array.isArray(tree.tree), 'source-tree-too-large', 503);
      const result: RepositoryFile[] = []; let totalBytes = 0;
      for (const rawPath of paths) {
        const path = safeRepositoryPath(rawPath);
        const entry = tree.tree.find((entry: any) => entry.path === path);
        const canonicalJson = path === 'art-manifest.v1.json' || /^src\/data\/content\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.json$/.test(path);
        requireCommunity(entry?.type === 'blob' && entry.mode === '100644' && Number.isSafeInteger(entry.size) && entry.size <= (path.endsWith('.json') && !canonicalJson ? 256 * 1024 : 8 * 1024 * 1024), 'invalid-source-file');
        totalBytes += entry.size; requireCommunity(totalBytes <= 40 * 1024 * 1024, 'source-batch-too-large');
        const blob = await getAt(sourceRepository, `git/blobs/${validateSha(entry.sha)}`, 12_000_000);
        requireCommunity(blob.encoding === 'base64' && blob.size === entry.size && typeof blob.content === 'string', 'invalid-source-blob', 503);
        const binary = atob(blob.content.replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        requireCommunity(bytes.length === entry.size, 'source-size-mismatch', 503);
        const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
        const framed = new Uint8Array(prefix.length + bytes.length); framed.set(prefix); framed.set(bytes, prefix.length);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', framed))).map(value => value.toString(16).padStart(2, '0')).join('');
        requireCommunity(digest === entry.sha, 'source-blob-hash-mismatch', 503);
        result.push({ path, bytes, blobSha: entry.sha, mode: entry.mode });
      }
      return result;
    },
    async listChangedPrs(cursor, pageSize = 50) {
      const page = cursor === null ? 1 : Number(cursor);
      requireCommunity(Number.isSafeInteger(page) && page > 0 && page <= 1000, 'invalid-github-cursor');
      requireCommunity(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 50, 'invalid-github-page-size');
      const prs = await get(`pulls?state=all&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`);
      requireCommunity(Array.isArray(prs), 'invalid-github-prs', 503);
      return { keys: prs.map((pr: any) => ({ repositoryId: config.repositoryId, number: Number(pr.number) })), nextCursor: prs.length === pageSize ? String(page + 1) : null, versions: prs.map((pr: any) => ({ key: { repositoryId: config.repositoryId, number: Number(pr.number) }, headSha: validateSha(pr.head?.sha), baseSha: validateSha(pr.base?.sha), state: pr.state === 'open' ? 'open' : 'closed' })) };
    },
  };
}
export function proposalKeyFromUrl(url: unknown, repositoryId: string): ProposalKey {
  requireCommunity(typeof url === 'string', 'invalid-pr-url');
  const match = /^https:\/\/github\.com\/wwang109\/wandering-hand-content\/pull\/([1-9]\d*)$/.exec(url);
  requireCommunity(match && Number.isSafeInteger(Number(match[1])), 'invalid-pr-url');
  return { repositoryId, number: Number(match[1]) };
}
