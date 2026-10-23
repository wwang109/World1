import { COMMUNITY_BODY_MAX_BYTES } from '../../src/community/types';
import { CommunityError, requireCommunity } from '../../src/community/validate';
import { ACCOUNT_CORS_HEADERS } from '../accountService';
import { communityServiceFor, type CommunityEnv } from '../communityService';
export const onRequestOptions = (): Response => new Response(null, { status: 204, headers: ACCOUNT_CORS_HEADERS });
export const onRequest = async ({ request, env }: { request: Request; env: CommunityEnv }): Promise<Response> => {
  const headers = { ...ACCOUNT_CORS_HEADERS, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  try {
    const service = communityServiceFor(env); requireCommunity(service, 'community-store-unavailable', 503);
    const url = new URL(request.url);
    const preview = /^\/community\/proposals\/([1-9]\d*)\/previews$/.exec(url.pathname);
    if (request.method === 'GET' && preview) {
      const asset = await service.asset(Number(preview[1]), url.searchParams.get('sha') ?? '', url.searchParams.get('path') ?? '');
      requireCommunity(asset, 'preview-not-found', 404);
      return new Response(asset.bytes.slice().buffer, { headers: { ...headers, 'content-type': asset.contentType, 'cache-control': 'public,max-age=31536000,immutable', 'content-security-policy': "default-src 'none'", etag: `"${asset.hash}"` } });
    }
    const chunks: Uint8Array[] = []; let size = 0;
    if (request.method === 'POST') {
      const reader = request.body?.getReader();
      if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > COMMUNITY_BODY_MAX_BYTES) { await reader.cancel(); requireCommunity(false, 'body-too-large', 413); } chunks.push(chunk.value); }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = await service.handle({ method: request.method, path: url.pathname, url, authorization: request.headers.get('authorization'), body: new TextDecoder().decode(bytes) });
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    return Response.json({ error: error instanceof CommunityError ? error.message : 'community-unavailable' }, { status: error instanceof CommunityError ? error.status : 503, headers });
  }
};
