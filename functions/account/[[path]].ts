import { ACCOUNT_BODY_MAX_BYTES } from '../../src/meta/account';
import { ACCOUNT_CORS_HEADERS, accountServiceFor, type AccountEnv } from '../accountService';

export const onRequestOptions = (): Response => new Response(null, { status: 204, headers: ACCOUNT_CORS_HEADERS });

export const onRequest = async ({ request, env }: { request: Request; env: AccountEnv }): Promise<Response> => {
  const service = accountServiceFor(env);
  if (service === null) {
    return Response.json({ error: 'account-store-unavailable' }, { status: 503, headers: ACCOUNT_CORS_HEADERS });
  }
  const url = new URL(request.url);
  const body = request.method === 'POST' ? await request.text() : '';
  if (body.length > ACCOUNT_BODY_MAX_BYTES) {
    return Response.json({ error: 'invalid-body' }, { status: 400, headers: ACCOUNT_CORS_HEADERS });
  }
  try {
    const result = await service.handle({
      method: request.method,
      path: url.pathname,
      url,
      authorization: request.headers.get('authorization'),
      body,
    });
    if (result.kind === 'redirect') {
      return new Response(null, { status: 302, headers: { location: result.location, 'cache-control': 'no-store' } });
    }
    return Response.json(result.body, { status: result.status, headers: { ...ACCOUNT_CORS_HEADERS, 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: ACCOUNT_CORS_HEADERS },
    );
  }
};
