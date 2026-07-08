import type { SkillDef } from '../types';
import type { AuraMods } from './auras';
import type { CombatantState } from './state';
import type { Ctx } from './interpreter';

/**
 * Escape hatch for behavior the closed Action DSL can't express. Specials are
 * hand-coded here in the engine (never in src/data) so skill definitions stay
 * fully serializable. Promote to a DSL member once a third skill needs the
 * same behavior.
 */
export type SpecialFn = (
  ctx: Ctx,
  caster: CombatantState,
  skill: SkillDef,
  slot: number,
  mods: AuraMods,
) => void;

const registry: Record<string, SpecialFn> = {};

export function registerSpecial(key: string, fn: SpecialFn): void {
  registry[key] = fn;
}

export function getSpecial(key: string): SpecialFn {
  const fn = registry[key];
  if (!fn) throw new Error(`Unknown special: ${key}`);
  return fn;
}
