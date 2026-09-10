import type { StorageDriver } from '../../src/meta/runSave';

/** In-memory implementation of the persistence seam used by meta tests. */
export function fakeStorage(initial: Record<string, string> = {}): StorageDriver {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => { map.set(key, value); return true; },
  };
}

/** Storage implementation that consistently refuses writes. */
export function fakeQuotaExceededStorage(): StorageDriver {
  return {
    get: () => null,
    set: () => false,
  };
}
