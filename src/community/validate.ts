import { SHA_PATTERN, type ProposalKey, type ProposalManifest } from './types';

export class CommunityError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function requireCommunity(condition: unknown, error: string, status = 400): asserts condition {
  if (!condition) throw new CommunityError(status, error);
}
export function record(value: unknown): Record<string, unknown> {
  requireCommunity(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid-object');
  return value as Record<string, unknown>;
}
export function boundedText(value: unknown, max: number): string {
  requireCommunity(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'invalid-text');
  return value;
}
export function safeRepositoryPath(value: unknown): string {
  const path = boundedText(value, 240);
  requireCommunity(!path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !path.includes('%') && /^[A-Za-z0-9_.\-/]+$/.test(path), 'invalid-path');
  requireCommunity(path.split('/').every(part => part !== '.' && part !== '..' && part !== '' && !part.startsWith('.')), 'invalid-path');
  return path;
}
export function validateProposalManifest(value: unknown): ProposalManifest {
  const input = record(value);
  requireCommunity(Object.keys(input).every(key => ['version', 'title', 'category', 'description', 'attribution', 'contentPaths', 'previewPaths'].includes(key)), 'unknown-manifest-field');
  requireCommunity(input.version === 1, 'unsupported-manifest-version');
  requireCommunity(['card', 'gem', 'equipment', 'event', 'art'].includes(String(input.category)), 'invalid-category');
  const paths = (value: unknown, max: number): string[] => {
    requireCommunity(Array.isArray(value) && value.length <= max, 'invalid-path-list');
    const result = value.map(safeRepositoryPath);
    requireCommunity(new Set(result).size === result.length, 'duplicate-path');
    return result;
  };
  return { version: 1, title: boundedText(input.title, 100), category: input.category as ProposalManifest['category'], description: boundedText(input.description, 12_000), attribution: boundedText(input.attribution, 2000), contentPaths: paths(input.contentPaths, 32), previewPaths: paths(input.previewPaths, 4) };
}
export function validateProposalKey(value: unknown): ProposalKey {
  const input = record(value);
  requireCommunity(typeof input.repositoryId === 'string' && /^\d+$/.test(input.repositoryId) && Number.isSafeInteger(input.number) && Number(input.number) > 0, 'invalid-proposal-key');
  return { repositoryId: input.repositoryId, number: Number(input.number) };
}
export function validateOperationId(value: unknown): string {
  requireCommunity(typeof value === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(value), 'invalid-operation-id');
  return value;
}
export function validateSha(value: unknown): string {
  requireCommunity(typeof value === 'string' && SHA_PATTERN.test(value), 'invalid-sha');
  return value;
}
export function pageSize(value: string | null): number {
  const size = value === null ? 20 : Number(value);
  requireCommunity(Number.isSafeInteger(size) && size >= 1 && size <= 50, 'invalid-page-size');
  return size;
}
export function pageOffset(value: string | null): number {
  const offset = value === null ? 0 : Number(value);
  requireCommunity(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100_000, 'invalid-cursor');
  return offset;
}
export function parseCommunityJson(raw: string): unknown {
  let at = 0;
  const whitespace = (): void => { while (/\s/.test(raw[at] ?? '') && at < raw.length) at++; };
  const string = (): string => {
    const start = at++; let escaped = false;
    for (; at < raw.length; at++) {
      const char = raw[at];
      if (char === '"' && !escaped) { at++; return JSON.parse(raw.slice(start, at)) as string; }
      if (char === '\\' && !escaped) escaped = true; else escaped = false;
    }
    throw new CommunityError(400, 'invalid-json');
  };
  const value = (depth: number): void => {
    requireCommunity(depth <= 100, 'json-too-deep'); whitespace();
    if (raw[at] === '{') {
      at++; whitespace(); const keys = new Set<string>();
      if (raw[at] === '}') { at++; return; }
      for (;;) {
        whitespace(); requireCommunity(raw[at] === '"', 'invalid-json'); const key = string();
        requireCommunity(!keys.has(key), 'duplicate-json-key'); keys.add(key); whitespace(); requireCommunity(raw[at++] === ':', 'invalid-json'); value(depth + 1); whitespace();
        if (raw[at] === '}') { at++; return; } requireCommunity(raw[at++] === ',', 'invalid-json');
      }
    }
    if (raw[at] === '[') {
      at++; whitespace(); if (raw[at] === ']') { at++; return; }
      for (;;) { value(depth + 1); whitespace(); if (raw[at] === ']') { at++; return; } requireCommunity(raw[at++] === ',', 'invalid-json'); }
    }
    if (raw[at] === '"') { string(); return; }
    const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(at));
    requireCommunity(token, 'invalid-json'); at += token[0].length;
  };
  value(0); whitespace(); requireCommunity(at === raw.length, 'invalid-json');
  return JSON.parse(raw) as unknown;
}
