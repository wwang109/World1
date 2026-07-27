import { damagePerTurn, type DamageProfileOpts } from '../src/run/analysis';
import { skillBook } from '../src/data/skills';
import type { CombatantSetup } from '../src/engine/types';

/**
 * Cloudflare Pages Function — production twin of `POST /damage-band` in
 * server/battleApi.ts.
 */
interface DamageBandRequest { setup: CombatantSetup; opts?: DamageProfileOpts }

export const onRequestPost = async ({ request }: { request: Request }): Promise<Response> => {
  try {
    const { setup, opts } = await request.json() as DamageBandRequest;
    return Response.json(damagePerTurn(setup, skillBook, opts ?? {}));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
};
