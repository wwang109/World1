import type { GhostRecord } from '../run/ghost';
import type { GhostValidationFailureReason } from '../run/ghostValidate';
import { battleApiBaseUrl } from './battleApi';

const BASE_URL = battleApiBaseUrl(
  import.meta.env?.VITE_BATTLE_API as string | undefined,
  Boolean(import.meta.env?.DEV),
  typeof window === 'undefined' ? undefined : window.location.hostname,
);

export interface GhostUploadInput {
  code: string;
  displayName: string;
  fightNumber: number;
  ownerLocalId: string;
}

export type GhostUploadResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function uploadGhost(input: GhostUploadInput): Promise<GhostUploadResult> {
  try {
    const res = await fetch(`${BASE_URL}/ghosts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = await res.json() as { id?: string; error?: string };
    if (!res.ok) return { ok: false, reason: payload.error ?? `ghost upload failed (${String(res.status)})` };
    return { ok: true, id: payload.id ?? '' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export type GhostFetchResult =
  | { ok: true; ghost: GhostRecord | null }
  | { ok: false; reason: string };

export async function reportGhostResult(id: string, ghostWon: boolean): Promise<void> {
  try {
    await fetch(`${BASE_URL}/ghosts/${id}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ghostWon }),
    });
  } catch {
  }
}

type GhostSaveFailureCode = GhostValidationFailureReason | 'no active run' | 'no save prompt pending';

const GHOST_SAVE_FAILURE_TEXT: Record<GhostSaveFailureCode, string> = {
  'missing-owner': "Couldn't identify this device.",
  'empty-name': 'Enter a name for your build.',
  'invalid-fight-number': 'This fight cannot be saved.',
  'invalid-code': "Couldn't read your build.",
  'empty-board': 'Your board is empty.',
  'decode-drift': "Couldn't verify your build.",
  'level-too-high': 'Build is too strong for this depth.',
  'no active run': 'No run in progress.',
  'no save prompt pending': 'Nothing to save right now.',
};

function isGhostSaveFailureCode(reason: string): reason is GhostSaveFailureCode {
  return reason in GHOST_SAVE_FAILURE_TEXT;
}

export function describeGhostSaveFailure(reason: string): string {
  return isGhostSaveFailureCode(reason) ? GHOST_SAVE_FAILURE_TEXT[reason] : "Couldn't reach the server.";
}

export async function fetchGhost(band: number, excludeOwnerLocalId?: string): Promise<GhostFetchResult> {
  try {
    const params = new URLSearchParams({ band: String(band) });
    if (excludeOwnerLocalId !== undefined) params.set('exclude', excludeOwnerLocalId);
    const res = await fetch(`${BASE_URL}/ghosts?${params.toString()}`);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}) as { error?: string });
      return { ok: false, reason: payload.error ?? `ghost fetch failed (${String(res.status)})` };
    }
    const ghost = await res.json() as GhostRecord | null;
    return { ok: true, ghost };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
