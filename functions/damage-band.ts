import { damagePerTurn, type DamageProfileOpts } from '../src/run/analysis';
import { skillBook } from '../src/data/skills';
import type { CombatantSetup } from '../src/engine/types';

/**
 * Cloudflare Pages Function — production twin of `POST /damage-band` in
 * server/battleApi.ts.
 *
 * CORS: see the matching comment in `functions/battle.ts` — same reasoning,
 * same wide-open `*` (a stateless, unauthenticated pure function of its
 * request body), kept in parity with the dev service and with `battle.ts`.
 */
interface DamageBandRequest { setup: CombatantSetup; opts?: DamageProfileOpts }

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
    const { setup, opts } = await request.json() as DamageBandRequest;
    return Response.json(damagePerTurn(setup, skillBook, opts ?? {}), { headers: CORS_HEADERS });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: CORS_HEADERS },
    );
  }
};
