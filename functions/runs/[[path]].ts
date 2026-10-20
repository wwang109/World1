import { accountServiceFor, ACCOUNT_CORS_HEADERS, type AccountEnv } from '../accountService';
import { createD1EligibleRunStore } from '../eligibleRunStoreD1';
import { createD1EligibleGhostPorts } from '../eligibleGhostPorts';
import { executorRegistry, presentEligibleRun } from '../../src/service/runs/executorRegistry';
import { createEligibleRunService } from '../../src/service/runs/service';

export interface RunEnv extends AccountEnv { ELIGIBLE_RUNS_ENABLED?: string }
export async function onRequest({ request, env }: { request: Request; env: RunEnv }): Promise<Response> {
  const headers = { ...ACCOUNT_CORS_HEADERS, 'cache-control': 'no-store' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!env.GHOSTS_DB) return Response.json({ error: 'Run store unavailable' }, { status: 503, headers });
  const account = await accountServiceFor(env)?.authenticate(request.headers.get('authorization'));
  if (!account) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && /^\/runs\/?$/.test(path) && env.ELIGIBLE_RUNS_ENABLED !== 'true') return Response.json({ error: 'Online earning runs are not enabled' }, { status: 503, headers });
  let input: unknown;
  if (request.method === 'POST') {
    const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    if (!reader) return Response.json({ error: 'JSON body required' }, { status: 400, headers });
    while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.length; if (bytes > 16384) { await reader.cancel(); return Response.json({ error: 'Request too large' }, { status: 413, headers }); } chunks.push(result.value); }
    const body = new Uint8Array(bytes); let position = 0; for (const chunk of chunks) { body.set(chunk, position); position += chunk.length; }
    try { input = JSON.parse(new TextDecoder().decode(body)); }
    catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }); }
  }
  const service = createEligibleRunService(createD1EligibleRunStore(env.GHOSTS_DB, presentEligibleRun), executorRegistry, createD1EligibleGhostPorts(env.GHOSTS_DB));
  const result = await service.handle(account.id, request.method, path, input);
  return Response.json(result.body, { status: result.status, headers });
}
