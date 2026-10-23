import { resolveDesignBattle, type DesignBattleRequest } from '../src/run/designBattle';
import { DESIGN_BATTLE_MAX_BYTES } from '../src/run/designProbe';

/** Cloudflare Pages Function — production twin of `POST /design-battle` in server/battleApi.ts. */
const CORS_HEADERS: Record<string, string> = { 'access-control-allow-origin': '*' };

export const onRequestOptions = (): Response => new Response(null, {
  status: 204,
  headers: {
    ...CORS_HEADERS,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  },
});

export const onRequestPost = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    const body = await request.text();
    if (body.length > DESIGN_BATTLE_MAX_BYTES) {
      return Response.json({ error: 'body-too-large' }, { status: 413, headers: CORS_HEADERS });
    }
    return Response.json(resolveDesignBattle(JSON.parse(body) as DesignBattleRequest), { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: CORS_HEADERS },
    );
  }
};
