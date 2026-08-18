import type { SkillBook } from '../engine/types';
import { skillBookFromJson } from './skillsContent';

/**
 * THE skill book — loaded from `content/skills.v1.json` via `skillsContent.ts`.
 *
 * This file is now a ONE-LINE RE-EXPORT SHIM, kept so the 70+ modules already
 * importing `skillBook` from `src/data/skills` need no import churn. The
 * hand-written `SkillDef[]` literals that used to live here (and the
 * migration-proof-only `skillBookFromDefs` export) are gone: `skillsContent.ts`
 * / `content/skills.v1.json` is now the single source of truth, and
 * `tests/data/contentSchema.test.ts` is what pins its contract (runtime schema
 * validation, standing in for the compile-time checking the literals used to
 * give — see `validateSkillContent.ts`'s own doc comment for why that
 * substitution is sound).
 */
export const skillBook: SkillBook = skillBookFromJson;
