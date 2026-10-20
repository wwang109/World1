import type { EligibleRunView, EncounterReceipt, RunCommand, RunReceipt } from '../run/online/types';
import { battleApiBaseUrl } from './battleApi';
import { accountToken } from './accountSession';

export class EligibleRunApiError extends Error {
  constructor(message: string, readonly status: number, readonly view?: EligibleRunView) { super(message); }
}
export interface EligibleRunTransport {
  get(): Promise<EligibleRunView | null>;
  post(path: string, body: unknown): Promise<RunReceipt | EncounterReceipt>;
}
export function isEligibleRunMutationPath(path: string): boolean { return /^\/runs(?:\/[A-Za-z0-9_-]{1,100}(?:\/actions|\/encounters\/[A-Za-z0-9_-]{1,100}\/resolve))?$/.test(path); }
const base = battleApiBaseUrl(import.meta.env?.VITE_BATTLE_API as string | undefined, Boolean(import.meta.env?.DEV), typeof window === 'undefined' ? undefined : window.location.hostname);
async function request(path: string, body?: unknown): Promise<unknown> {
  if (body === undefined ? path !== '/runs/active' : !isEligibleRunMutationPath(path)) throw new EligibleRunApiError('Invalid run route', 400);
  const token = accountToken();
  if (!token) throw new EligibleRunApiError('Connect your game account to play online.', 401);
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as { error?: string; view?: EligibleRunView };
  if (!response.ok) throw new EligibleRunApiError(result.error ?? 'Run service unavailable', response.status, result.view);
  return result;
}
export const eligibleRunTransport: EligibleRunTransport = {
  async get() { try { return await request('/runs/active') as EligibleRunView; } catch (error) { if (error instanceof EligibleRunApiError && error.status === 404) return null; throw error; } },
  post: (path, body) => request(path, body) as Promise<RunReceipt | EncounterReceipt>,
};
export type EligibleRunAction = RunCommand;
