import document from './content/examples/battle-passives.examples.v1.json';
import type { BattlePreparation, BattleRequest } from '../run/resolveBattle';
import type { BoardPiece } from '../engine/types';
import type { PassiveRequest } from '../engine/passives/types';
import { resolvePassiveRequest, validatePassiveRecipe } from '../engine/passives/validate';

export interface BattlePassiveExample {
  id: string;
  name: string;
  purpose: string;
  pieces: readonly BoardPiece[];
  preBattle: PassiveRequest;
  heroPieceRefs: NonNullable<BattlePreparation['heroPieceRefs']>;
}
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid battle example object');
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(key => !allowed.includes(key))) throw new Error('Unknown battle example field');
  return obj;
}
function identifier(value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid battle example identifier');
}
function seedValue(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) throw new Error('Battle example seed must be an unsigned 32-bit integer');
}
const raw = fields(document, ['schemaVersion', 'status', 'baseRequest', 'sourceCatalog', 'examples']);
if (raw.schemaVersion !== 1 || !Array.isArray(raw.sourceCatalog) || !Array.isArray(raw.examples)) throw new Error('Unsupported battle example document');
identifier(raw.status);
const catalog = validatePassiveRecipe({ schemaVersion: 1, sources: raw.sourceCatalog }).sources;
const base = fields(raw.baseRequest, ['heroLevel', 'heroAllocation', 'foes', 'seed']);
if (!Number.isSafeInteger(base.heroLevel) || (base.heroLevel as number) < 1 || !Array.isArray(base.foes)) throw new Error('Invalid battle example base request');
fields(base.heroAllocation, []);
seedValue(base.seed);
for (const foe of base.foes) {
  const def = fields(foe, ['enemyId', 'level', 'rank', 'title']);
  identifier(def.enemyId);
  if (!Number.isSafeInteger(def.level) || (def.level as number) < 1 || !Number.isSafeInteger(def.rank) || (def.rank as number) < 0 || !['mob', 'normal', 'elite', 'boss'].includes(def.title as string)) throw new Error('Invalid battle example foe');
}
const ids = new Set<string>();
const examples = raw.examples.map(value => {
  const example = fields(value, ['id', 'name', 'purpose', 'pieces', 'preBattle', 'heroPieceRefs']);
  identifier(example.id); identifier(example.name); identifier(example.purpose);
  if (ids.has(example.id as string)) throw new Error('Duplicate battle example id');
  ids.add(example.id as string);
  if (!Array.isArray(example.pieces) || !Array.isArray(example.heroPieceRefs)) throw new Error('Invalid battle example board/references');
  const slots = new Set<number>();
  for (const value of example.pieces) {
    const piece = fields(value, ['skillId', 'slot']);
    identifier(piece.skillId);
    if (!Number.isSafeInteger(piece.slot) || (piece.slot as number) < 0 || slots.has(piece.slot as number)) throw new Error('Invalid battle example anchor');
    slots.add(piece.slot as number);
  }
  const refs = new Set<string>(), mappedSlots = new Set<number>();
  for (const value of example.heroPieceRefs) {
    const ref = fields(value, ['slot', 'pieceRef']);
    identifier(ref.pieceRef);
    if (!slots.has(ref.slot as number) || refs.has(ref.pieceRef as string) || mappedSlots.has(ref.slot as number)) throw new Error('Invalid battle example card reference');
    refs.add(ref.pieceRef as string); mappedSlots.add(ref.slot as number);
  }
  resolvePassiveRequest(example.preBattle, catalog);
  return structuredClone(example) as unknown as BattlePassiveExample;
});
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
/** UI-safe descriptors: no transitive battle resolver or simulator import. */
export const battlePassiveExamples: readonly BattlePassiveExample[] = freeze(examples);
export function battlePassiveExample(id: string): BattlePassiveExample {
  const example = battlePassiveExamples.find(entry => entry.id === id);
  if (!example) throw new Error(`Unknown battle example '${id}'`);
  return example;
}
export function buildBattlePassiveExample(id: string, seed?: number): { request: BattleRequest; preparation: BattlePreparation } {
  const example = battlePassiveExample(id);
  const chosenSeed = seed === undefined ? base.seed : seed;
  seedValue(chosenSeed);
  return {
    request: structuredClone({ ...base, pieces: example.pieces, preBattle: example.preBattle, seed: chosenSeed }) as unknown as BattleRequest,
    preparation: { sourceCatalog: structuredClone(catalog), heroPieceRefs: structuredClone(example.heroPieceRefs) },
  };
}
