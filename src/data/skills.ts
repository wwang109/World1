import type { SkillBook, SkillDef } from '../engine/types';
import defs from './skills.json';

// Card data lives in skills.json (the lookup/reference source of truth); this
// wrapper types it and indexes by id. JSON imports are structurally wide, so
// tests/data.test.ts validates every record against the engine's unions and
// the balance audit enforces each kit sums to its tier budget (Bronze 10 ·
// Silver 15 · Gold 20 · Diamond 25 PL, price table in src/engine/balance.ts).
//
// power semantics: % of the scaling stat (physical→Attack, magical→Magic
// Power, true damage→higher of the two); FLAT amounts for true heals/shields.
export const skillBook: SkillBook = Object.fromEntries(
  (defs as SkillDef[]).map((s) => [s.id, s]),
);
