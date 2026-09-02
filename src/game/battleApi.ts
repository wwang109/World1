import type { BattleLog, BattleRequest, BattleFoeConfig } from '../run/resolveBattle';
import type { DamageBand } from '../run/analysis';
import type { CombatantSetup } from '../engine/types';
import type { BattleTimelineInput } from './battleTimeline';

/**
 * The client's only route to a battle result.
 *
 * Combat is NOT in this bundle — `src/game` may not import `simulate()` or
 * `resolveBattle()` (enforced by `scripts/check-boundaries.mjs`). The client
 * sends prep info and renders the log it gets back. Types above are type-only
 * imports, so nothing from the engine survives into the build.
 */

// Dev talks to the local tsx server; production is same-origin (Cloudflare
// Pages Functions in functions/ serve /battle and /damage-band).
const BASE_URL: string = (import.meta.env?.VITE_BATTLE_API as string | undefined)
  ?? (import.meta.env?.DEV ? 'http://localhost:8787' : '');

/** Prep info → request payload. The foe list is the multi-foe team when present. */
export function battleRequestOf(input: BattleTimelineInput): BattleRequest {
  const foes: BattleFoeConfig[] = input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam.map((c) => ({
      enemyId: c.enemyId, level: c.level, title: c.title, rank: c.rank, modifiers: [...(c.modifiers ?? [])], affix: c.affix ?? null,
      // Custom foe deck (sandbox): the recipe rides the request like every
      // other dial — the service re-resolves it, the client never ships a
      // resolved board. Copied so the payload is detached from live state.
      deck: c.deck?.map((card) => ({ ...card })) ?? null,
    }))
    : [{
      enemyId: input.enemyId,
      level: input.enemyLevel,
      title: input.enemyTitle,
      rank: input.enemyRank,
      modifiers: [...(input.enemyModifiers ?? [])],
      affix: input.enemyAffix ?? null,
    }];
  return {
    pieces: input.pieces.map((p) => ({ ...p })),
    heroLevel: input.heroLevel,
    heroAllocation: input.heroAllocation,
    foes,
    seed: input.seed,
  };
}

async function post<T>(route: string, payload: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`battle service ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return await res.json() as T;
}

/** POSTs the prep info to the battle service. Throws on a non-2xx or transport error. */
export async function fetchBattleLog(input: BattleTimelineInput): Promise<BattleLog> {
  return await post<BattleLog>('/battle', battleRequestOf(input));
}

/** A combatant's sustained damage-per-turn band — needs a sim, so it is served. */
export async function fetchDamageBand(
  setup: CombatantSetup,
  opts: { turns?: number; seeds?: number } = {},
): Promise<DamageBand> {
  return await post<DamageBand>('/damage-band', { setup, opts });
}

// The prep scenes re-render by full rebuild (scene.restart() / rerender()), so
// without a cache every stepper tap re-fetches a band the server already
// computed and flashes the "DMG/turn …" placeholder. The band is a pure
// function of (setup, opts) — cache it for the session. A cache hit resolves in
// a microtask, before the next paint, so rebuilt scenes show the number
// immediately. Failures are NOT cached; the next rebuild retries.
const bandCache = new Map<string, DamageBand>();
const bandPending = new Map<string, Promise<DamageBand>>();

/** `fetchDamageBand` with session caching + in-flight dedupe. Prefer this from scenes. */
export function cachedDamageBand(
  setup: CombatantSetup,
  opts: { turns?: number; seeds?: number } = {},
): Promise<DamageBand> {
  const key = JSON.stringify([setup, opts]);
  const hit = bandCache.get(key);
  if (hit) return Promise.resolve(hit);
  let pending = bandPending.get(key);
  if (!pending) {
    pending = fetchDamageBand(setup, opts)
      .then((band) => { bandCache.set(key, band); bandPending.delete(key); return band; })
      .catch((err: unknown) => { bandPending.delete(key); throw err; });
    bandPending.set(key, pending);
  }
  return pending;
}
