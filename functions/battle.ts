import { resolveBattle, type BattleRequest } from '../src/run/resolveBattle';

/**
 * Cloudflare Pages Function — production twin of `POST /battle` in
 * server/battleApi.ts.
 *
 * CORS: mirrors the dev service's wide-open `access-control-allow-origin: *`
 * rather than an origin allowlist. Deliberate, not a default: this route is
 * a stateless, unauthenticated pure function of its request body — no
 * cookies, no auth header, no per-caller state, nothing an allowlist would
 * protect. The client's same-origin default (`BASE_URL === ''`) never needs
 * this header at all, but `src/game/battleApi.ts` explicitly supports
 * `VITE_BATTLE_API` pointing at a DIFFERENT origin (e.g. a shared/staging
 * battle API), and the dev service already answers such cross-origin
 * requests with `*` — so a production build using that override was the
 * one path that could never be exercised in dev and would fail every single
 * battle on a real cross-origin deployment. Matching `*` here restores
 * dev/prod parity for the one asymmetry that existed; if this route ever
 * gains auth or per-caller state, revisit with a real allowlist then.
 */
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
    const payload = await request.json() as BattleRequest;
    return Response.json(resolveBattle(payload), { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: CORS_HEADERS },
    );
  }
};
