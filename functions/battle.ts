import { resolveBattle, type BattleRequest } from '../src/run/resolveBattle';

/**
 * Cloudflare Pages Function — production twin of `POST /battle` in
 * server/battleApi.ts. Same origin as the deployed site, so the client's
 * same-origin default BASE_URL ('') reaches it with no CORS.
 */
export const onRequestPost = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    const payload = await request.json() as BattleRequest;
    return Response.json(resolveBattle(payload));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
};
