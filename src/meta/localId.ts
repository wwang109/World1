import type { StorageDriver } from './lifetimeStats';

export const LOCAL_ID_STORAGE_KEY = 'world1:localId:v1';

export type LocalIdGenerator = () => string;

export function randomLocalId(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function isValidLocalId(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{32}$/.test(value);
}

export function getOrCreateLocalId(storage: StorageDriver, generate: LocalIdGenerator = randomLocalId): string {
  const existing = storage.get(LOCAL_ID_STORAGE_KEY);
  if (isValidLocalId(existing)) return existing;
  const id = generate();
  storage.set(LOCAL_ID_STORAGE_KEY, id);
  return id;
}
