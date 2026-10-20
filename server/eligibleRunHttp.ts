import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountService } from '../src/meta/account';
import type { EligibleRunService } from '../src/service/runs/service';

export function createEligibleRunHttpHandler(service: EligibleRunService, authenticate: AccountService['authenticate'], allowCreate = false) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    const account = await authenticate(typeof request.headers.authorization === 'string' ? request.headers.authorization : null);
    if (!account) { response.writeHead(401); response.end(JSON.stringify({ error: 'Authentication required' })); return; }
    const path = new URL(request.url ?? '/runs', 'http://localhost').pathname;
    if (request.method === 'POST' && /^\/runs\/?$/.test(path) && !allowCreate) { response.writeHead(503); response.end(JSON.stringify({ error: 'Online earning runs are not enabled' })); return; }
    let input: unknown;
    if (request.method === 'POST') {
      let length = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string); length += bytes.length;
        if (length > 16384) { response.writeHead(413); response.end(JSON.stringify({ error: 'Request too large' })); return; }
        chunks.push(bytes);
      }
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response.writeHead(400); response.end(JSON.stringify({ error: 'Invalid JSON' })); return; }
    }
    const result = await service.handle(account.id, request.method ?? 'GET', path, input);
    response.writeHead(result.status); response.end(JSON.stringify(result.body));
  };
}
