import { validateGhostSubmission, type GhostSubmissionInput } from '../src/run/ghostValidate';
import { createD1GhostStore } from './ghostStoreD1';
import type { D1Database } from './d1';

interface Env { GHOSTS_DB?: D1Database }

const CORS_HEADERS: Record<string, string> = { 'access-control-allow-origin': '*' };
const MAX_BODY_BYTES = 8192;

export const onRequestOptions = (): Response => new Response(null, {
  status: 204,
  headers: {
    ...CORS_HEADERS,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  },
});

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const url = new URL(request.url);
  const band = Number(url.searchParams.get('band'));
  if (!Number.isInteger(band) || band < 0) {
    return Response.json({ error: 'GET /ghosts requires an integer ?band=' }, { status: 400, headers: CORS_HEADERS });
  }
  if (!env.GHOSTS_DB) {
    return Response.json(null, { headers: CORS_HEADERS });
  }
  const exclude = url.searchParams.get('exclude') ?? undefined;
  try {
    const record = await createD1GhostStore(env.GHOSTS_DB).fetchForBand(band, exclude);
    return Response.json(record, { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
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
  let input: GhostSubmissionInput;
  try {
    input = JSON.parse(raw) as GhostSubmissionInput;
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
  const result = validateGhostSubmission(input);
  if (!result.ok) {
    return Response.json({ error: result.reason, detail: result.detail }, { status: 400, headers: CORS_HEADERS });
  }
  try {
    const record = await createD1GhostStore(env.GHOSTS_DB).save(result.record);
    return Response.json({ id: record.id }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: CORS_HEADERS });
  }
};
