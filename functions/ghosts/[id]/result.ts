import { createD1GhostStore } from '../../ghostStoreD1';
import type { D1Database } from '../../d1';

interface Env { GHOSTS_DB?: D1Database }

const CORS_HEADERS: Record<string, string> = { 'access-control-allow-origin': '*' };
const MAX_BODY_BYTES = 1024;

export const onRequestOptions = (): Response => new Response(null, {
  status: 204,
  headers: {
    ...CORS_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  },
});

export const onRequestPost = async (
  { request, env, params }: { request: Request; env: Env; params: { id: string } },
): Promise<Response> => {
  if (!env.GHOSTS_DB) {
    return Response.json({ error: 'ghost-store-unavailable' }, { status: 503, headers: CORS_HEADERS });
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return Response.json({ error: 'expected application/json body' }, { status: 400, headers: CORS_HEADERS });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'request body too large' }, { status: 400, headers: CORS_HEADERS });
  }
  let ghostWon: boolean;
  try {
    ({ ghostWon } = JSON.parse(raw) as { ghostWon: boolean });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
  try {
    const outcome = await createD1GhostStore(env.GHOSTS_DB).reportResult(params.id, Boolean(ghostWon));
    if (outcome.ok) return Response.json({ ok: true }, { headers: CORS_HEADERS });
    return Response.json({ error: outcome.reason }, { status: 404, headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
};
